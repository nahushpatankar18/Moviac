import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CloudSyncStatus } from '../contexts/FirebaseContext';
import {
  deleteCloudWatchlistItem,
  fetchAllCloudWatchlist,
  makeWatchlistDocId,
  subscribeCloudWatchlist,
  updateCloudSeriesProgress,
  upsertCloudWatchlistItem,
} from '../services/cloudSync';
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
  lastCloudUid: 'moviac_last_cloud_uid',
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

function toWatchlistEntry(
  item: TmdbMediaItem,
  existingProgress?: { season: number; episode: number }
): WatchlistEntry {
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

interface UseWatchlistOptions {
  cloudUid?: string | null;
  onSyncStatusChange?: (status: CloudSyncStatus) => void;
}

export function useWatchlist(options: UseWatchlistOptions = {}) {
  const { cloudUid = null, onSyncStatusChange } = options;

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

  // Keep latest local lists accessible inside async cloud handshake without re-subscribing
  const listsRef = useRef({
    watchingMovies,
    watchingSeries,
    watchlistMovies,
    watchlistSeries,
    watchedMovies,
    watchedSeries,
  });
  listsRef.current = {
    watchingMovies,
    watchingSeries,
    watchlistMovies,
    watchlistSeries,
    watchedMovies,
    watchedSeries,
  };

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

  // Real-time Firestore synchronization when signed in with Gmail
  useEffect(() => {
    if (!cloudUid) return;

    let cancelled = false;
    let unsub: (() => void) | null = null;

    const runCloudSync = async () => {
      onSyncStatusChange?.('syncing');
      try {
        const previousUid = localStorage.getItem(KEYS.lastCloudUid);
        const shouldUploadLocalItems = !previousUid || previousUid === cloudUid;

        const existingCloud = await fetchAllCloudWatchlist(cloudUid);
        if (cancelled) return;

        const cloudKeys = new Set(existingCloud.map((r) => r.itemKey));

        if (shouldUploadLocalItems) {
          const snapshot = listsRef.current;
          const pendingUploads: Array<{ entry: WatchlistEntry; status: WatchlistStatus }> = [];

          const queueMissing = (items: WatchlistEntry[], status: WatchlistStatus) => {
            for (const entry of items) {
              const key = makeWatchlistDocId(entry.media_type, entry.id);
              if (!cloudKeys.has(key)) {
                cloudKeys.add(key);
                pendingUploads.push({ entry, status });
              }
            }
          };

          queueMissing(snapshot.watchingMovies, 'watching');
          queueMissing(snapshot.watchingSeries, 'watching');
          queueMissing(snapshot.watchlistMovies, 'to-watch');
          queueMissing(snapshot.watchlistSeries, 'to-watch');
          queueMissing(snapshot.watchedMovies, 'watched');
          queueMissing(snapshot.watchedSeries, 'watched');

          if (pendingUploads.length > 0) {
            await Promise.all(
              pendingUploads.map(({ entry, status }) =>
                upsertCloudWatchlistItem(cloudUid, entry, status)
              )
            );
          }
        }

        if (cancelled) return;
        vaultSetItem(KEYS.lastCloudUid, cloudUid);

        unsub = subscribeCloudWatchlist(
          cloudUid,
          (records) => {
            if (cancelled) return;
            const nextWatchingMovies: WatchlistEntry[] = [];
            const nextWatchingSeries: WatchlistEntry[] = [];
            const nextWatchlistMovies: WatchlistEntry[] = [];
            const nextWatchlistSeries: WatchlistEntry[] = [];
            const nextWatchedMovies: WatchlistEntry[] = [];
            const nextWatchedSeries: WatchlistEntry[] = [];

            for (const rec of records) {
              if (rec.entry.media_type === 'movie') {
                if (rec.status === 'watching') nextWatchingMovies.push(rec.entry);
                else if (rec.status === 'watched') nextWatchedMovies.push(rec.entry);
                else nextWatchlistMovies.push(rec.entry);
              } else {
                if (rec.status === 'watching') nextWatchingSeries.push(rec.entry);
                else if (rec.status === 'watched') nextWatchedSeries.push(rec.entry);
                else nextWatchlistSeries.push(rec.entry);
              }
            }

            const byRecent = (a: WatchlistEntry, b: WatchlistEntry) => b.addedAt - a.addedAt;
            setWatchingMovies(nextWatchingMovies.sort(byRecent));
            setWatchingSeries(nextWatchingSeries.sort(byRecent));
            setWatchlistMovies(nextWatchlistMovies.sort(byRecent));
            setWatchlistSeries(nextWatchlistSeries.sort(byRecent));
            setWatchedMovies(nextWatchedMovies.sort(byRecent));
            setWatchedSeries(nextWatchedSeries.sort(byRecent));
            onSyncStatusChange?.('synced');
          },
          () => {
            if (!cancelled) onSyncStatusChange?.('error');
          }
        );
      } catch {
        if (!cancelled) onSyncStatusChange?.('error');
      }
    };

    void runCloudSync();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [cloudUid, onSyncStatusChange]);

  const syncUpsert = useCallback(
    (entry: WatchlistEntry, status: WatchlistStatus) => {
      if (!cloudUid) return;
      onSyncStatusChange?.('syncing');
      upsertCloudWatchlistItem(cloudUid, entry, status)
        .then(() => onSyncStatusChange?.('synced'))
        .catch(() => onSyncStatusChange?.('error'));
    },
    [cloudUid, onSyncStatusChange]
  );

  const syncDelete = useCallback(
    (mediaType: MediaType, id: number) => {
      if (!cloudUid) return;
      onSyncStatusChange?.('syncing');
      deleteCloudWatchlistItem(cloudUid, mediaType, id)
        .then(() => onSyncStatusChange?.('synced'))
        .catch(() => onSyncStatusChange?.('error'));
    },
    [cloudUid, onSyncStatusChange]
  );

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

  const mergeCloudGenreAffinity = useCallback((cloudAffinity: Record<string, number>) => {
    if (!cloudAffinity || typeof cloudAffinity !== 'object') return;
    setGenreAffinity((prev) => {
      const next = { ...prev };
      for (const [k, val] of Object.entries(cloudAffinity)) {
        if (typeof val === 'number' && Number.isFinite(val)) {
          next[k] = Math.max(next[k] || 0, val);
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
        const exists = watchingMovies.some((i) => i.id === item.id);
        if (exists) {
          setWatchingMovies((prev) => prev.filter((i) => i.id !== item.id));
          syncDelete('movie', item.id);
        } else {
          const entry = toWatchlistEntry(item);
          setWatchingMovies((prev) => [entry, ...prev.filter((i) => i.id !== item.id)]);
          setWatchlistMovies((prev) => prev.filter((i) => i.id !== item.id));
          setWatchedMovies((prev) => prev.filter((i) => i.id !== item.id));
          syncUpsert(entry, 'watching');
        }
      } else {
        const exists = watchingSeries.some((i) => i.id === item.id);
        if (exists) {
          setWatchingSeries((prev) => prev.filter((i) => i.id !== item.id));
          syncDelete('tv', item.id);
        } else {
          const existingProgress = watchlistSeries.find((i) => i.id === item.id)?.progress;
          const entry = toWatchlistEntry(item, existingProgress);
          setWatchingSeries((prev) => [entry, ...prev.filter((i) => i.id !== item.id)]);
          setWatchlistSeries((prev) => prev.filter((i) => i.id !== item.id));
          setWatchedSeries((prev) => prev.filter((i) => i.id !== item.id));
          syncUpsert(entry, 'watching');
        }
      }
    },
    [watchingMovies, watchingSeries, watchlistSeries, syncDelete, syncUpsert]
  );

  const toggleWatchlist = useCallback(
    (item: TmdbMediaItem) => {
      if (item.media_type === 'movie') {
        const exists = watchlistMovies.some((i) => i.id === item.id);
        if (exists) {
          setWatchlistMovies((prev) => prev.filter((i) => i.id !== item.id));
          syncDelete('movie', item.id);
        } else {
          const entry = toWatchlistEntry(item);
          setWatchlistMovies((prev) => [entry, ...prev.filter((i) => i.id !== item.id)]);
          setWatchingMovies((prev) => prev.filter((i) => i.id !== item.id));
          setWatchedMovies((prev) => prev.filter((i) => i.id !== item.id));
          syncUpsert(entry, 'to-watch');
        }
      } else {
        const exists = watchlistSeries.some((i) => i.id === item.id);
        if (exists) {
          setWatchlistSeries((prev) => prev.filter((i) => i.id !== item.id));
          syncDelete('tv', item.id);
        } else {
          const existingProgress = watchingSeries.find((i) => i.id === item.id)?.progress;
          const entry = toWatchlistEntry(item, existingProgress);
          setWatchlistSeries((prev) => [entry, ...prev.filter((i) => i.id !== item.id)]);
          setWatchingSeries((prev) => prev.filter((i) => i.id !== item.id));
          setWatchedSeries((prev) => prev.filter((i) => i.id !== item.id));
          syncUpsert(entry, 'to-watch');
        }
      }
    },
    [watchlistMovies, watchlistSeries, watchingSeries, syncDelete, syncUpsert]
  );

  const toggleWatched = useCallback(
    (item: TmdbMediaItem) => {
      const entry = toWatchlistEntry(item);
      if (item.media_type === 'movie') {
        const exists = watchedMovies.some((i) => i.id === item.id);
        if (exists) {
          setWatchedMovies((prev) => prev.filter((i) => i.id !== item.id));
          syncDelete('movie', item.id);
        } else {
          setWatchedMovies((prev) => [entry, ...prev.filter((i) => i.id !== item.id)]);
          setWatchlistMovies((prev) => prev.filter((i) => i.id !== item.id));
          setWatchingMovies((prev) => prev.filter((i) => i.id !== item.id));
          syncUpsert(entry, 'watched');
        }
      } else {
        const exists = watchedSeries.some((i) => i.id === item.id);
        if (exists) {
          setWatchedSeries((prev) => prev.filter((i) => i.id !== item.id));
          syncDelete('tv', item.id);
        } else {
          setWatchedSeries((prev) => [entry, ...prev.filter((i) => i.id !== item.id)]);
          setWatchlistSeries((prev) => prev.filter((i) => i.id !== item.id));
          setWatchingSeries((prev) => prev.filter((i) => i.id !== item.id));
          syncUpsert(entry, 'watched');
        }
      }
    },
    [watchedMovies, watchedSeries, syncDelete, syncUpsert]
  );

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
      syncDelete(mediaType, id);
    },
    [syncDelete]
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
      syncUpsert(updated, toStatus);
    },
    [
      watchingMovies,
      watchlistMovies,
      watchedMovies,
      watchingSeries,
      watchlistSeries,
      watchedSeries,
      syncUpsert,
    ]
  );

  const updateSeriesProgress = useCallback(
    (id: number, season: number, episode: number) => {
      const safeSeason = Math.max(1, season);
      const safeEpisode = Math.max(1, episode);
      const apply = (prev: WatchlistEntry[]) =>
        prev.map((item) =>
          item.id === id ? { ...item, progress: { season: safeSeason, episode: safeEpisode } } : item
        );
      setWatchingSeries(apply);
      setWatchlistSeries(apply);

      if (cloudUid) {
        onSyncStatusChange?.('syncing');
        updateCloudSeriesProgress(cloudUid, id, safeSeason, safeEpisode)
          .then(() => onSyncStatusChange?.('synced'))
          .catch(() => onSyncStatusChange?.('error'));
      }
    },
    [cloudUid, onSyncStatusChange]
  );

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

  const importWatchlistsJson = useCallback(
    (jsonText: string): { ok: boolean; message: string } => {
      try {
        const data = JSON.parse(jsonText);
        if (!data || typeof data !== 'object') {
          return { ok: false, message: 'Invalid JSON file format.' };
        }

        const mergeUnique = (
          existing: WatchlistEntry[],
          incoming: unknown,
          fallbackType: MediaType
        ) => {
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

        const nextWatchingMovies = mergeUnique(listsRef.current.watchingMovies, data.watching_movies, 'movie');
        const nextWatchingSeries = mergeUnique(listsRef.current.watchingSeries, data.watching_series, 'tv');
        const nextWatchlistMovies = mergeUnique(listsRef.current.watchlistMovies, data.watchlist_movies, 'movie');
        const nextWatchlistSeries = mergeUnique(listsRef.current.watchlistSeries, data.watchlist_series, 'tv');
        const nextWatchedMovies = mergeUnique(listsRef.current.watchedMovies, data.watched_movies, 'movie');
        const nextWatchedSeries = mergeUnique(listsRef.current.watchedSeries, data.watched_series, 'tv');

        setWatchingMovies(nextWatchingMovies);
        setWatchingSeries(nextWatchingSeries);
        setWatchlistMovies(nextWatchlistMovies);
        setWatchlistSeries(nextWatchlistSeries);
        setWatchedMovies(nextWatchedMovies);
        setWatchedSeries(nextWatchedSeries);

        if (cloudUid) {
          onSyncStatusChange?.('syncing');
          const syncAll: Array<{ entry: WatchlistEntry; status: WatchlistStatus }> = [
            ...nextWatchingMovies.map((entry) => ({ entry, status: 'watching' as const })),
            ...nextWatchingSeries.map((entry) => ({ entry, status: 'watching' as const })),
            ...nextWatchlistMovies.map((entry) => ({ entry, status: 'to-watch' as const })),
            ...nextWatchlistSeries.map((entry) => ({ entry, status: 'to-watch' as const })),
            ...nextWatchedMovies.map((entry) => ({ entry, status: 'watched' as const })),
            ...nextWatchedSeries.map((entry) => ({ entry, status: 'watched' as const })),
          ];
          Promise.all(
            syncAll.map(({ entry, status }) => upsertCloudWatchlistItem(cloudUid, entry, status))
          )
            .then(() => onSyncStatusChange?.('synced'))
            .catch(() => onSyncStatusChange?.('error'));
        }

        return { ok: true, message: 'Watchlists imported successfully.' };
      } catch {
        return { ok: false, message: 'Could not parse JSON file.' };
      }
    },
    [cloudUid, onSyncStatusChange]
  );

  return {
    watchingMovies,
    watchingSeries,
    watchlistMovies,
    watchlistSeries,
    watchedMovies,
    watchedSeries,
    genreAffinity,
    mergeCloudGenreAffinity,
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
