import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AlertTriangle, Info, RefreshCw, X } from 'lucide-react';
import { ApiKeySetup } from './components/ApiKeySetup';
import { DetailModal } from './components/DetailModal';
import { GenreBar } from './components/GenreBar';
import { MovieGrid } from './components/MovieGrid';
import { MyLists } from './components/MyLists';
import { AppView, Navbar } from './components/Navbar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { Row } from './components/Row';
import { SearchResultsPanel } from './components/SearchBar';
import { TypeTabs } from './components/TypeTabs';
import { useFirebaseAuth } from './contexts/FirebaseContext';
import { useMedia } from './hooks/useMedia';
import { useSearch } from './hooks/useSearch';
import { useWatchlist } from './hooks/useWatchlist';
import { fetchCloudPreferences, saveCloudPreferences } from './services/cloudSync';
import {
  GENRE_CHIPS,
  getBackdropUrl,
  getStoredApiKey,
  getSurprisePick,
  saveApiKey,
  TmdbError,
} from './services/tmdb';
import {
  ContentFilter,
  DiscoverFilters,
  EraFilter,
  GenreChipId,
  TmdbMediaItem,
} from './types/tmdb';

const INITIAL_FILTERS: DiscoverFilters = {
  genres: [],
  minRating: 0,
  yearFrom: '',
  yearTo: '',
  language: '',
  era: 'all',
  sortBy: 'popularity.desc',
};

export default function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean>(() => Boolean(getStoredApiKey()));
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('discover');
  const [contentType, setContentType] = useState<ContentFilter>('all');
  const [era, setEra] = useState<EraFilter>('all');
  const [filters, setFilters] = useState<DiscoverFilters>(INITIAL_FILTERS);

  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedTitle, setSelectedTitle] = useState<{
    item: TmdbMediaItem;
    layoutKey: string;
  } | null>(null);

  const [activeBackdropPath, setActiveBackdropPath] = useState<string | null>(null);
  const [surprising, setSurprising] = useState(false);

  const { profileReadyUid, setSyncStatus, authError, clearAuthError } = useFirebaseAuth();

  const watchlist = useWatchlist({
    cloudUid: profileReadyUid,
    onSyncStatusChange: setSyncStatus,
  });
  const search = useSearch(hasApiKey);

  const media = useMedia(
    hasApiKey,
    contentType,
    era,
    filters,
    watchlist.topGenreIds,
    watchlist.allWatchlistSeeds
  );

  // Sync TMDB API key & genre affinity with Firestore preferences when signed in
  const prefsHydratedUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profileReadyUid) {
      prefsHydratedUidRef.current = null;
      return;
    }
    let cancelled = false;
    fetchCloudPreferences(profileReadyUid)
      .then(async (cloudPrefs) => {
        if (cancelled) return;
        const localKey = getStoredApiKey();
        if (cloudPrefs?.tmdbApiKey && !localKey) {
          saveApiKey(cloudPrefs.tmdbApiKey);
          setHasApiKey(true);
        }
        if (cloudPrefs?.genreAffinity) {
          watchlist.mergeCloudGenreAffinity(cloudPrefs.genreAffinity);
        }
        if (!cloudPrefs || (localKey && !cloudPrefs.tmdbApiKey)) {
          await saveCloudPreferences(profileReadyUid, {
            tmdbApiKey: localKey || cloudPrefs?.tmdbApiKey || '',
            recentSearches: search.recentSearches,
            genreAffinity: watchlist.genreAffinity,
          });
        }
        if (!cancelled) {
          prefsHydratedUidRef.current = profileReadyUid;
        }
      })
      .catch(() => {
        // non-blocking preference sync
      });

    return () => {
      cancelled = true;
    };
  }, [profileReadyUid]);

  // Persist genre affinity & recent search changes to cloud preferences (debounced)
  useEffect(() => {
    if (!profileReadyUid || prefsHydratedUidRef.current !== profileReadyUid) return;
    const timer = setTimeout(() => {
      void saveCloudPreferences(
        profileReadyUid,
        {
          tmdbApiKey: getStoredApiKey(),
          recentSearches: search.recentSearches,
          genreAffinity: watchlist.genreAffinity,
        },
        ['recentSearches', 'genreAffinity']
      ).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [profileReadyUid, search.recentSearches, watchlist.genreAffinity]);

  // Set default backdrop from spotlight item
  useEffect(() => {
    if (!activeBackdropPath && media.feed.trendingToday.length > 0) {
      const first = media.feed.trendingToday[0];
      setActiveBackdropPath(first.backdrop_path || first.poster_path);
    }
  }, [activeBackdropPath, media.feed.trendingToday]);

  // Global keyboard shortcuts: "/" or Ctrl+K / Cmd+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === '/' && !isTypingField) {
        e.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'Escape' && searchOpen && !selectedTitle && !showSettingsModal) {
        setSearchOpen(false);
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, selectedTitle, showSettingsModal]);

  const handleToggleGenre = useCallback(
    (genreId: GenreChipId) => {
      setFilters((prev) => {
        const exists = prev.genres.includes(genreId);
        const nextGenres = exists
          ? prev.genres.filter((g) => g !== genreId)
          : [...prev.genres, genreId];
        if (!exists) {
          watchlist.recordGenreSelection([genreId]);
        }
        return { ...prev, genres: nextGenres };
      });
    },
    [watchlist]
  );

  const handleUpdateFilters = useCallback((partial: Partial<DiscoverFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
    setEra('all');
  }, []);

  const handleSurpriseMe = useCallback(async () => {
    setSurprising(true);
    try {
      const pick = await getSurprisePick(contentType, filters.genres, era);
      if (pick) {
        setActiveBackdropPath(pick.backdrop_path || pick.poster_path);
        setSelectedTitle({ item: pick, layoutKey: `surprise-${pick.media_type}-${pick.id}` });
      }
    } finally {
      setSurprising(false);
    }
  }, [contentType, filters.genres, era]);

  const handleSelectItem = useCallback((item: TmdbMediaItem, layoutKey: string) => {
    setActiveBackdropPath(item.backdrop_path || item.poster_path);
    setSelectedTitle({ item, layoutKey });
  }, []);

  const handleGoHome = useCallback(() => {
    setSearchOpen(false);
    search.setQuery('');
    setActiveView('discover');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [search]);

  const totalWatchlistCount = useMemo(
    () =>
      watchlist.watchingMovies.length +
      watchlist.watchingSeries.length +
      watchlist.watchlistMovies.length +
      watchlist.watchlistSeries.length +
      watchlist.watchedMovies.length +
      watchlist.watchedSeries.length,
    [
      watchlist.watchingMovies.length,
      watchlist.watchingSeries.length,
      watchlist.watchlistMovies.length,
      watchlist.watchlistSeries.length,
      watchlist.watchedMovies.length,
      watchlist.watchedSeries.length,
    ]
  );

  const currentlyWatchingItems = useMemo<TmdbMediaItem[]>(() => {
    const entries =
      contentType === 'movie'
        ? watchlist.watchingMovies
        : contentType === 'tv'
        ? watchlist.watchingSeries
        : [...watchlist.watchingMovies, ...watchlist.watchingSeries].sort(
            (a, b) => b.addedAt - a.addedAt
          );
    return entries.map((entry) => ({
      id: entry.id,
      media_type: entry.media_type,
      title: entry.title,
      overview: '',
      poster_path: entry.poster_path,
      backdrop_path: entry.backdrop_path,
      release_date: entry.year ? `${entry.year}-01-01` : '',
      year: entry.year,
      vote_average: entry.vote_average,
      vote_count: 0,
      popularity: 0,
      genre_ids: entry.genre_ids || [],
      original_language: 'en',
    }));
  }, [contentType, watchlist.watchingMovies, watchlist.watchingSeries]);

  const backdropUrl = getBackdropUrl(activeBackdropPath, 'w1280');

  if (!hasApiKey) {
    return (
      <MotionConfig reducedMotion="user">
        <ApiKeySetup
          onSuccess={() => {
            setHasApiKey(true);
            if (profileReadyUid) {
              void saveCloudPreferences(
                profileReadyUid,
                {
                  tmdbApiKey: getStoredApiKey(),
                  recentSearches: search.recentSearches,
                  genreAffinity: watchlist.genreAffinity,
                },
                ['tmdbApiKey']
              ).catch(() => {});
            }
          }}
        />
      </MotionConfig>
    );
  }

  const activeError = media.feedError || media.discoverError;
  const isInvalidKeyError =
    activeError instanceof TmdbError && activeError.code === 'INVALID_KEY';

  const activeGenreLabels = filters.genres
    .map((id) => GENRE_CHIPS.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join(' + ');

  return (
    <MotionConfig reducedMotion="user">
      <div className="aurora-canvas relative min-h-screen overflow-x-hidden text-slate-100">
        {/* Dynamic Crossfading Blurred Backdrop */}
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <AnimatePresence mode="sync">
            {backdropUrl && (
              <motion.img
                key={backdropUrl}
                src={backdropUrl}
                alt=""
                referrerPolicy="no-referrer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.22 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                className="h-full w-full scale-110 object-cover blur-3xl saturate-150"
              />
            )}
          </AnimatePresence>
          <div className="absolute inset-0 bg-gradient-to-b from-[#06070d]/70 via-[#06070d]/80 to-[#06070d]" />
        </div>

        <Navbar
          activeView={activeView}
          onNavigate={(view) => {
            setSearchOpen(false);
            setActiveView(view);
          }}
          contentType={contentType}
          onSelectContentType={(type) => {
            setSearchOpen(false);
            setActiveView('discover');
            setContentType(type);
          }}
          searchQuery={search.query}
          onSearchChange={(val) => {
            search.setQuery(val);
            if (!searchOpen) setSearchOpen(true);
          }}
          onSearchFocus={() => setSearchOpen(true)}
          searchInputRef={searchInputRef}
          totalWatchlistCount={totalWatchlistCount}
          onOpenSettings={() => setShowSettingsModal(true)}
          onGoHome={handleGoHome}
        />

        {/* Main Content */}
        <main className="relative z-10 pt-16 pb-20 md:pb-12">
          {authError && (
            <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
              <div
                role="alert"
                className="glass-surface flex items-center justify-between gap-3 rounded-2xl border border-rose-400/35 bg-rose-500/15 px-4 py-3 text-xs text-rose-100"
              >
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />
                  <span>{authError}</span>
                </div>
                <button
                  type="button"
                  onClick={clearAuthError}
                  aria-label="Dismiss auth error"
                  className="rounded-lg p-1 text-rose-200 hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          {searchOpen ? (
            <SearchResultsPanel
              query={search.query}
              debouncedQuery={search.debouncedQuery}
              movies={search.movies}
              series={search.series}
              people={search.people}
              smartMatches={search.smartMatches}
              smartSummary={search.smartSummary}
              trendingSuggestions={search.trendingSuggestions}
              recentSearches={search.recentSearches}
              loading={search.loading}
              loadingMore={search.loadingMore}
              error={search.error}
              hasMore={search.hasMore}
              onSelectSuggestion={(term) => search.setQuery(term)}
              onClearRecent={search.clearRecentSearches}
              onLoadMore={search.loadMore}
              onClose={() => setSearchOpen(false)}
              onSelectItem={handleSelectItem}
              isInWatchlist={watchlist.isInWatchlist}
              isWatching={watchlist.isWatching}
              onToggleWatchlist={watchlist.toggleWatchlist}
              onToggleWatching={watchlist.toggleWatching}
              onHoverBackdrop={setActiveBackdropPath}
            />
          ) : activeView === 'lists' ? (
            <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
              <MyLists
                watchingMovies={watchlist.watchingMovies}
                watchingSeries={watchlist.watchingSeries}
                watchlistMovies={watchlist.watchlistMovies}
                watchlistSeries={watchlist.watchlistSeries}
                watchedMovies={watchlist.watchedMovies}
                watchedSeries={watchlist.watchedSeries}
                onSelectEntry={handleSelectItem}
                onRemove={watchlist.removeFromList}
                onMoveStatus={watchlist.moveBetweenLists}
                onUpdateSeriesProgress={watchlist.updateSeriesProgress}
                onExportJson={watchlist.exportWatchlistsJson}
                onImportJson={watchlist.importWatchlistsJson}
              />
            </div>
          ) : (
            <div className="mx-auto max-w-7xl space-y-8 px-4 pt-5 sm:px-6 lg:px-8">
              {/* Error Banner */}
              {activeError && (
                <div
                  role="alert"
                  className="glass-surface flex flex-wrap items-center justify-between gap-4 rounded-2xl border-rose-400/35 bg-rose-500/15 p-4 text-sm text-rose-100"
                >
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-rose-300" />
                    <span>{activeError.message}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isInvalidKeyError ? (
                      <button
                        type="button"
                        onClick={() => setShowSettingsModal(true)}
                        className="rounded-xl bg-white/15 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/25"
                      >
                        Update API Key
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={media.reloadFeed}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/25"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Content Type & Era Switcher */}
              <TypeTabs
                activeType={contentType}
                onTypeChange={setContentType}
                activeEra={era}
                onEraChange={setEra}
              />

              {/* Genre Chips, Advanced Filters & Surprise Me */}
              <GenreBar
                filters={filters}
                onToggleGenre={handleToggleGenre}
                onUpdateFilters={handleUpdateFilters}
                onResetFilters={handleResetFilters}
                onSurpriseMe={handleSurpriseMe}
                surprising={surprising}
              />

              {/* Filtered Discovery Grid OR Curated Home Rows */}
              {media.hasActiveDiscoverFilters ? (
                <MovieGrid
                  title={
                    activeGenreLabels
                      ? `${activeGenreLabels} Discovery`
                      : 'Filtered Discovery'
                  }
                  subtitle="Matched using TMDB genres, keywords, era, and rating filters"
                  items={media.discoverItems}
                  loading={media.loadingDiscover}
                  hasMore={media.hasMoreDiscover}
                  onLoadMore={media.loadMoreDiscover}
                  isInWatchlist={watchlist.isInWatchlist}
                  isWatching={watchlist.isWatching}
                  isWatched={watchlist.isWatched}
                  onToggleWatchlist={watchlist.toggleWatchlist}
                  onToggleWatching={watchlist.toggleWatching}
                  onSelectItem={handleSelectItem}
                  onHoverBackdrop={setActiveBackdropPath}
                  gridId="discover-grid"
                />
              ) : (
                <div className="space-y-10">
                  {currentlyWatchingItems.length > 0 && (
                    <Row
                      rowId="currently-watching"
                      title="Currently Watching"
                      subtitle="Jump back into movies and series you are watching right now"
                      items={currentlyWatchingItems}
                      isInWatchlist={watchlist.isInWatchlist}
                      isWatching={watchlist.isWatching}
                      isWatched={watchlist.isWatched}
                      onToggleWatchlist={watchlist.toggleWatchlist}
                      onToggleWatching={watchlist.toggleWatching}
                      onSelectItem={handleSelectItem}
                      onHoverBackdrop={setActiveBackdropPath}
                    />
                  )}

                  <Row
                    rowId="trending-day"
                    title="Trending Today"
                    subtitle="Fastest-rising titles across your selected format"
                    items={media.feed.trendingToday}
                    loading={media.loadingFeed}
                    isInWatchlist={watchlist.isInWatchlist}
                    isWatching={watchlist.isWatching}
                    isWatched={watchlist.isWatched}
                    onToggleWatchlist={watchlist.toggleWatchlist}
                    onToggleWatching={watchlist.toggleWatching}
                    onSelectItem={handleSelectItem}
                    onHoverBackdrop={setActiveBackdropPath}
                  />

                  <Row
                    rowId="recommended"
                    title="Recommended For You"
                    subtitle={
                      watchlist.allWatchlistSeeds.length > 0 || watchlist.topGenreIds.length > 0
                        ? 'Curated from your saved watchlists and favorite genres'
                        : 'Select genres or save titles to tailor this shelf'
                    }
                    items={media.feed.recommended}
                    loading={media.loadingFeed}
                    isInWatchlist={watchlist.isInWatchlist}
                    isWatching={watchlist.isWatching}
                    isWatched={watchlist.isWatched}
                    onToggleWatchlist={watchlist.toggleWatchlist}
                    onToggleWatching={watchlist.toggleWatching}
                    onSelectItem={handleSelectItem}
                    onHoverBackdrop={setActiveBackdropPath}
                  />

                  <Row
                    rowId="trending-week"
                    title="Trending This Week"
                    subtitle="Most talked-about movies and series over the last 7 days"
                    items={media.feed.trendingWeek}
                    loading={media.loadingFeed}
                    isInWatchlist={watchlist.isInWatchlist}
                    isWatching={watchlist.isWatching}
                    isWatched={watchlist.isWatched}
                    onToggleWatchlist={watchlist.toggleWatchlist}
                    onToggleWatching={watchlist.toggleWatching}
                    onSelectItem={handleSelectItem}
                    onHoverBackdrop={setActiveBackdropPath}
                  />

                  <Row
                    rowId="new-releases"
                    title="New Releases"
                    subtitle="Currently in theaters and newly airing series"
                    items={media.feed.newReleases}
                    loading={media.loadingFeed}
                    isInWatchlist={watchlist.isInWatchlist}
                    isWatching={watchlist.isWatching}
                    isWatched={watchlist.isWatched}
                    onToggleWatchlist={watchlist.toggleWatchlist}
                    onToggleWatching={watchlist.toggleWatching}
                    onSelectItem={handleSelectItem}
                    onHoverBackdrop={setActiveBackdropPath}
                  />

                  <Row
                    rowId="top-rated"
                    title="Top Rated"
                    subtitle="Critically acclaimed standouts"
                    items={media.feed.topRated}
                    loading={media.loadingFeed}
                    isInWatchlist={watchlist.isInWatchlist}
                    isWatching={watchlist.isWatching}
                    isWatched={watchlist.isWatched}
                    onToggleWatchlist={watchlist.toggleWatchlist}
                    onToggleWatching={watchlist.toggleWatching}
                    onSelectItem={handleSelectItem}
                    onHoverBackdrop={setActiveBackdropPath}
                  />

                  {era !== 'new' && (
                    <Row
                      rowId="classics"
                      title="Classics / Old Gems"
                      subtitle="Highest-rated releases from before 2005"
                      items={media.feed.classics}
                      loading={media.loadingFeed}
                      isInWatchlist={watchlist.isInWatchlist}
                      isWatching={watchlist.isWatching}
                      isWatched={watchlist.isWatched}
                      onToggleWatchlist={watchlist.toggleWatchlist}
                      onToggleWatching={watchlist.toggleWatching}
                      onSelectItem={handleSelectItem}
                      onHoverBackdrop={setActiveBackdropPath}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Footer Credit */}
        <footer className="relative z-10 border-t border-white/10 px-4 py-6 pb-20 text-center text-xs text-slate-400 md:pb-8">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 sm:flex-row">
            <p className="inline-flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-cyan-400" />
              This product uses the TMDB API but is not endorsed or certified by TMDB.
            </p>
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="text-slate-300 underline decoration-white/25 underline-offset-4 hover:text-white"
            >
              Change TMDB API Key
            </button>
          </div>
        </footer>

        {/* Shared-Element Detail Modal */}
        <AnimatePresence>
          {selectedTitle && (
            <DetailModal
              key={`${selectedTitle.item.media_type}-${selectedTitle.item.id}`}
              item={selectedTitle.item}
              layoutKey={selectedTitle.layoutKey}
              onClose={() => setSelectedTitle(null)}
              onSelectSimilar={(simItem, simKey) => {
                setActiveBackdropPath(simItem.backdrop_path || simItem.poster_path);
                setSelectedTitle({ item: simItem, layoutKey: simKey });
              }}
              isInWatchlist={watchlist.isInWatchlist}
              isWatching={watchlist.isWatching}
              isWatched={watchlist.isWatched}
              onToggleWatchlist={watchlist.toggleWatchlist}
              onToggleWatching={watchlist.toggleWatching}
              onToggleWatched={watchlist.toggleWatched}
              getSeriesProgress={watchlist.getSeriesProgress}
              onUpdateSeriesProgress={watchlist.updateSeriesProgress}
            />
          )}
        </AnimatePresence>

        {/* Change API Key Settings Modal */}
        {showSettingsModal && (
          <ApiKeySetup
            isModal
            initialKey={getStoredApiKey()}
            onClose={() => setShowSettingsModal(false)}
            onSuccess={() => {
              setShowSettingsModal(false);
              media.reloadFeed();
              if (profileReadyUid) {
                void saveCloudPreferences(
                  profileReadyUid,
                  {
                    tmdbApiKey: getStoredApiKey(),
                    recentSearches: search.recentSearches,
                    genreAffinity: watchlist.genreAffinity,
                  },
                  ['tmdbApiKey']
                ).catch(() => {});
              }
            }}
          />
        )}

        <OfflineIndicator />
      </div>
    </MotionConfig>
  );
}
