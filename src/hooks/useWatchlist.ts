import { useCallback, useEffect, useMemo, useState } from 'react';
import { vaultSetItem } from '../services/persistentStorage';
import { GENRE_CHIPS } from '../services/tmdb';
import { GenreChipId, MediaType, TmdbMediaItem, WatchlistEntry } from '../types/tmdb';

export type WatchlistStatus = 'watching' | 'to-watch' | 'watched';

const KEYS = {
  watchingMovies: 'watching_movies',
  watchingSeries: 'watching_series',
  watchlistMovies: 'watchlist_movies',
  watchlistSeries: 'watchlist_series',
  watchedMovies: 'watched_movies',
  watchedSeries: 'watched_series',
  genreAffinity: 'cinedeck_genre_affinity',
} as const;

function readList(key: string): WatchlistEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: WatchlistEntry[]): void {
  vaultSetItem(key, JSON.stringify(items));
}

function readAffinity(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEYS.genreAffinity);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toWatchlistEntry(item: TmdbMediaItem, existingProgress?: { season: number; episode: number }): WatchlistEntry {
  return {
    id: item.id,
    title: item.title,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    media_type: item.media_type,
    vote_average: item.vote_average,
    year: item.year,
    genre_ids: item.genre_ids || [],
    addedAt: Date.now(),
    ...(item.media_type === 'tv'
      ? { progress: existingProgress || { season: 1, episode: 1 } }
      : {}),
  };
}

export function useWatchlist() {
  const [watchingMovies, setWatchingMovies] = useState<WatchlistEntry[]>(() =>
    readList(KEYS.watchingMovies)
  );
  const [watchingSeries, setWatchingSeries] = useState<WatchlistEntry[]>(() =>
    readList(KEYS.watchingSeries)
  );
  const [watchlistMovies, setWatchlistMovies] = useState<WatchlistEntry[]>(() =>
    readList(KEYS.watchlistMovies)
  );
  const [watchlistSeries, setWatchlistSeries] = useState<WatchlistEntry[]>(() =>
    readList(KEYS.watchlistSeries)
  );
  const [watchedMovies, setWatchedMovies] = useState<WatchlistEntry[]>(() =>
    readList(KEYS.watchedMovies)
  );
  const [watchedSeries, setWatchedSeries] = useState<WatchlistEntry[]>(() =>
    readList(KEYS.watchedSeries)
  );
  const [genreAffinity, setGenreAffinity] = useState<Record<string, number>>(() =>
    readAffinity()
  );

  useEffect(() => {
    writeList(KEYS.watchingMovies, watchingMovies);
  }, [watchingMovies]);

  useEffect(() => {
    writeList(KEYS.watchingSeries, watchingSeries);
  }, [watchingSeries]);

  useEffect(() => {
    writeList(KEYS.watchlistMovies, watchlistMovies);
  }, [watchlistMovies]);

  useEffect(() => {
    writeList(KEYS.watchlistSeries, watchlistSeries);
  }, [watchlistSeries]);

  useEffect(() => {
    writeList(KEYS.watchedMovies, watchedMovies);
  }, [watchedMovies]);

  useEffect(() => {
    writeList(KEYS.watchedSeries, watchedSeries);
  }, [watchedSeries]);

  useEffect(() => {
    vaultSetItem(KEYS.genreAffinity, JSON.stringify(genreAffinity));
  }, [genreAffinity]);

  const recordGenreSelection = useCallback((chipIds: GenreChipId[]) => {
    if (chipIds.length === 0) return;
    setGenreAffinity((prev) => {
      const next = { ...prev };
      for (const chipId of chipIds) {
        const cfg = GENRE_CHIPS.find((c) => c.id === chipId);
        if (!cfg) continue;
        for (const gid of [...cfg.fallbackMovieIds, ...cfg.fallbackTvIds]) {
          const key = String(gid);
          next[key] = (next[key] || 0) + 1;
        }
      }
      return next;
    });
  }, []);

  const isWatching = useCallback(
    (id: number, mediaType: MediaType): boolean => {
      const list = mediaType === 'movie' ? watchingMovies : watchingSeries;
      return list.some((i) => i.id === id);
    },
    [watchingMovies, watchingSeries]
  );

  const isInWatchlist = useCallback(
    (id: number, mediaType: MediaType): boolean => {
      const list = mediaType === 'movie' ? watchlistMovies : watchlistSeries;
      return list.some((i) => i.id === id);
    },
    [watchlistMovies, watchlistSeries]
  );

  const isWatched = useCallback(
    (id: number, mediaType: MediaType): boolean => {
      const list = mediaType === 'movie' ? watchedMovies : watchedSeries;
      return list.some((i) => i.id === id);
    },
    [watchedMovies, watchedSeries]
  );

  const toggleWatching = useCallback(
    (item: TmdbMediaItem) => {
      if (item.media_type === 'movie') {
        setWatchingMovies((prev) => {
          const exists = prev.some((i) => i.id === item.id);
          if (exists) return prev.filter((i) => i.id !== item.id);
          setWatchlistMovies((wl) => wl.filter((i) => i.id !== item.id));
          setWatchedMovies((wd) => wd.filter((i) => i.id !== item.id));
          return [toWatchlistEntry(item), ...prev];
        });
      } else {
        const existingProgress = watchlistSeries.find((i) => i.id === item.id)?.progress;
        setWatchingSeries((prev) => {
          const exists = prev.some((i) => i.id === item.id);
          if (exists) return prev.filter((i) => i.id !== item.id);
          setWatchlistSeries((wl) => wl.filter((i) => i.id !== item.id));
          setWatchedSeries((wd) => wd.filter((i) => i.id !== item.id));
          return [toWatchlistEntry(item, existingProgress), ...prev];
        });
      }
    },
    [watchlistSeries]
  );

  const toggleWatchlist = useCallback(
    (item: TmdbMediaItem) => {
      if (item.media_type === 'movie') {
        setWatchlistMovies((prev) => {
          const exists = prev.some((i) => i.id === item.id);
          if (exists) return prev.filter((i) => i.id !== item.id);
          setWatchingMovies((wt) => wt.filter((i) => i.id !== item.id));
          setWatchedMovies((wd) => wd.filter((i) => i.id !== item.id));
          return [toWatchlistEntry(item), ...prev];
        });
      } else {
        const existingProgress = watchingSeries.find((i) => i.id === item.id)?.progress;
        setWatchlistSeries((prev) => {
          const exists = prev.some((i) => i.id === item.id);
          if (exists) return prev.filter((i) => i.id !== item.id);
          setWatchingSeries((wt) => wt.filter((i) => i.id !== item.id));
          setWatchedSeries((wd) => wd.filter((i) => i.id !== item.id));
          return [toWatchlistEntry(item, existingProgress), ...prev];
        });
      }
    },
    [watchingSeries]
  );

  const toggleWatched = useCallback((item: TmdbMediaItem) => {
    const entry = toWatchlistEntry(item);
    if (item.media_type === 'movie') {
      setWatchedMovies((prev) => {
        const exists = prev.some((i) => i.id === item.id);
        if (exists) return prev.filter((i) => i.id !== item.id);
        setWatchlistMovies((wl) => wl.filter((i) => i.id !== item.id));
        setWatchingMovies((wt) => wt.filter((i) => i.id !== item.id));
        return [entry, ...prev];
      });
    } else {
      setWatchedSeries((prev) => {
        const exists = prev.some((i) => i.id === item.id);
        if (exists) return prev.filter((i) => i.id !== item.id);
        setWatchlistSeries((wl) => wl.filter((i) => i.id !== item.id));
        setWatchingSeries((wt) => wt.filter((i) => i.id !== item.id));
        return [entry, ...prev];
      });
    }
  }, []);

  const removeFromList = useCallback(
    (id: number, mediaType: MediaType, status: WatchlistStatus) => {
      if (mediaType === 'movie') {
        if (status === 'watching') {
          setWatchingMovies((prev) => prev.filter((i) => i.id !== id));
        } else if (status === 'to-watch') {
          setWatchlistMovies((prev) => prev.filter((i) => i.id !== id));
        } else {
          setWatchedMovies((prev) => prev.filter((i) => i.id !== id));
        }
      } else {
        if (status === 'watching') {
          setWatchingSeries((prev) => prev.filter((i) => i.id !== id));
        } else if (status === 'to-watch') {
          setWatchlistSeries((prev) => prev.filter((i) => i.id !== id));
        } else {
          setWatchedSeries((prev) => prev.filter((i) => i.id !== id));
        }
      }
    },
    []
  );

  const moveBetweenLists = useCallback(
    (
      id: number,
      mediaType: MediaType,
      fromStatus: WatchlistStatus,
      toStatus: WatchlistStatus
    ) => {
      if (fromStatus === toStatus) return;

      const setters =
        mediaType === 'movie'
          ? {
              watching: setWatchingMovies,
              'to-watch': setWatchlistMovies,
              watched: setWatchedMovies,
            }
          : {
              watching: setWatchingSeries,
              'to-watch': setWatchlistSeries,
              watched: setWatchedSeries,
            };

      const sourceList =
        mediaType === 'movie'
          ? { watching: watchingMovies, 'to-watch': watchlistMovies, watched: watchedMovies }[
              fromStatus
            ]
          : { watching: watchingSeries, 'to-watch': watchlistSeries, watched: watchedSeries }[
              fromStatus
            ];

      const target = sourceList.find((i) => i.id === id);
      if (!target) return;

      const updated: WatchlistEntry = {
        ...target,
        addedAt: Date.now(),
        ...(mediaType === 'tv' && toStatus === 'watching' && !target.progress
          ? { progress: { season: 1, episode: 1 } }
          : {}),
      };

      setters[fromStatus]((prev) => prev.filter((i) => i.id !== id));
      setters[toStatus]((prev) => [updated, ...prev.filter((i) => i.id !== id)]);
    },
    [
      watchingMovies,
      watchlistMovies,
      watchedMovies,
      watchingSeries,
      watchlistSeries,
      watchedSeries,
    ]
  );

  const updateSeriesProgress = useCallback((id: number, season: number, episode: number) => {
    const safeSeason = Math.max(1, season);
    const safeEpisode = Math.max(1, episode);
    const apply = (prev: WatchlistEntry[]) =>
      prev.map((item) =>
        item.id === id ? { ...item, progress: { season: safeSeason, episode: safeEpisode } } : item
      );
    setWatchingSeries(apply);
    setWatchlistSeries(apply);
  }, []);

  const getSeriesProgress = useCallback(
    (id: number): { season: number; episode: number } | undefined => {
      return (
        watchingSeries.find((i) => i.id === id)?.progress ||
        watchlistSeries.find((i) => i.id === id)?.progress
      );
    },
    [watchingSeries, watchlistSeries]
  );

  const topGenreIds = useMemo(() => {
    const counts = new Map<number, number>();
    for (const [gidStr, score] of Object.entries(genreAffinity)) {
      const gid = Number(gidStr);
      if (Number.isFinite(gid)) counts.set(gid, (counts.get(gid) || 0) + score);
    }
    for (const item of [
      ...watchingMovies,
      ...watchingSeries,
      ...watchlistMovies,
      ...watchlistSeries,
      ...watchedMovies,
      ...watchedSeries,
    ]) {
      for (const gid of item.genre_ids || []) {
        counts.set(gid, (counts.get(gid) || 0) + 2);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([gid]) => gid);
  }, [
    genreAffinity,
    watchingMovies,
    watchingSeries,
    watchlistMovies,
    watchlistSeries,
    watchedMovies,
    watchedSeries,
  ]);

  const allWatchlistSeeds = useMemo(
    () =>
      [
        ...watchingMovies,
        ...watchingSeries,
        ...watchlistMovies,
        ...watchlistSeries,
        ...watchedMovies,
        ...watchedSeries,
      ].map((item) => ({
        id: item.id,
        media_type: item.media_type,
      })),
    [
      watchingMovies,
      watchingSeries,
      watchlistMovies,
      watchlistSeries,
      watchedMovies,
      watchedSeries,
    ]
  );

  const exportWatchlistsJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'Moviac',
      watching_movies: watchingMovies,
      watching_series: watchingSeries,
      watchlist_movies: watchlistMovies,
      watchlist_series: watchlistSeries,
      watched_movies: watchedMovies,
      watched_series: watchedSeries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `moviac-watchlists-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [
    watchingMovies,
    watchingSeries,
    watchlistMovies,
    watchlistSeries,
    watchedMovies,
    watchedSeries,
  ]);

  const importWatchlistsJson = useCallback((jsonText: string): { ok: boolean; message: string } => {
    try {
      const data = JSON.parse(jsonText);
      if (!data || typeof data !== 'object') {
        return { ok: false, message: 'Invalid JSON file format.' };
      }

      const mergeUnique = (existing: WatchlistEntry[], incoming: unknown, fallbackType: MediaType) => {
        if (!Array.isArray(incoming)) return existing;
        const map = new Map<number, WatchlistEntry>();
        for (const item of existing) map.set(item.id, item);
        for (const raw of incoming) {
          if (raw && typeof raw === 'object' && typeof (raw as WatchlistEntry).id === 'number') {
            const entry = raw as WatchlistEntry;
            map.set(entry.id, {
              ...entry,
              media_type: entry.media_type || fallbackType,
              addedAt: entry.addedAt || Date.now(),
            });
          }
        }
        return Array.from(map.values()).sort((a, b) => b.addedAt - a.addedAt);
      };

      setWatchingMovies((prev) => mergeUnique(prev, data.watching_movies, 'movie'));
      setWatchingSeries((prev) => mergeUnique(prev, data.watching_series, 'tv'));
      setWatchlistMovies((prev) => mergeUnique(prev, data.watchlist_movies, 'movie'));
      setWatchlistSeries((prev) => mergeUnique(prev, data.watchlist_series, 'tv'));
      setWatchedMovies((prev) => mergeUnique(prev, data.watched_movies, 'movie'));
      setWatchedSeries((prev) => mergeUnique(prev, data.watched_series, 'tv'));

      return { ok: true, message: 'Watchlists imported successfully.' };
    } catch {
      return { ok: false, message: 'Could not parse JSON file.' };
    }
  }, []);

  return {
    watchingMovies,
    watchingSeries,
    watchlistMovies,
    watchlistSeries,
    watchedMovies,
    watchedSeries,
    isWatching,
    isInWatchlist,
    isWatched,
    toggleWatching,
    toggleWatchlist,
    toggleWatched,
    removeFromList,
    moveBetweenLists,
    updateSeriesProgress,
    getSeriesProgress,
    recordGenreSelection,
    topGenreIds,
    allWatchlistSeeds,
    exportWatchlistsJson,
    importWatchlistsJson,
  };
}
