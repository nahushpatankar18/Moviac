import { useCallback, useEffect, useRef, useState } from 'react';
import { vaultSetItem } from '../services/persistentStorage';
import {
  getTrending,
  isDescriptiveQuery,
  searchMulti,
  smartSearchDiscover,
} from '../services/tmdb';
import { TmdbMediaItem, TmdbPersonResult } from '../types/tmdb';
import { useDebounce } from './useDebounce';

const RECENT_SEARCHES_KEY = 'cinedeck_recent_searches';

function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useSearch(hasApiKey: boolean) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 400);

  const [movies, setMovies] = useState<TmdbMediaItem[]>([]);
  const [series, setSeries] = useState<TmdbMediaItem[]>([]);
  const [people, setPeople] = useState<TmdbPersonResult[]>([]);
  const [smartMatches, setSmartMatches] = useState<TmdbMediaItem[]>([]);
  const [smartSummary, setSmartSummary] = useState('');

  const [trendingSuggestions, setTrendingSuggestions] = useState<TmdbMediaItem[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const requestSeqRef = useRef(0);

  useEffect(() => {
    vaultSetItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches));
  }, [recentSearches]);

  useEffect(() => {
    if (!hasApiKey) return;
    getTrending('all', 'day', 'all')
      .then((items) => setTrendingSuggestions(items.slice(0, 8)))
      .catch(() => {});
  }, [hasApiKey]);

  const addRecentSearch = useCallback((term: string) => {
    const clean = term.trim();
    if (clean.length < 2) return;
    setRecentSearches((prev) => {
      const next = [clean, ...prev.filter((t) => t.toLowerCase() !== clean.toLowerCase())];
      return next.slice(0, 8);
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
  }, []);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!hasApiKey || !trimmed) {
      setMovies([]);
      setSeries([]);
      setPeople([]);
      setSmartMatches([]);
      setSmartSummary('');
      setError(null);
      setLoading(false);
      setPage(1);
      setTotalPages(1);
      return;
    }

    const controller = new AbortController();
    const seq = ++requestSeqRef.current;

    setLoading(true);
    setError(null);

    const shouldRunSmart = isDescriptiveQuery(trimmed);

    Promise.all([
      searchMulti(trimmed, 1, controller.signal),
      shouldRunSmart
        ? smartSearchDiscover(trimmed, controller.signal).catch(() => ({ results: [], summary: '' }))
        : Promise.resolve({ results: [], summary: '' }),
    ])
      .then(([multiRes, smartRes]) => {
        if (seq !== requestSeqRef.current || controller.signal.aborted) return;
        setMovies(multiRes.movies);
        setSeries(multiRes.series);
        setPeople(multiRes.people);
        setPage(1);
        setTotalPages(multiRes.totalPages);
        setSmartMatches(smartRes.results);
        setSmartSummary(smartRes.summary);
        addRecentSearch(trimmed);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : 'Search failed.');
      })
      .finally(() => {
        if (seq === requestSeqRef.current && !controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [debouncedQuery, hasApiKey, addRecentSearch]);

  const loadMore = useCallback(async () => {
    const trimmed = debouncedQuery.trim();
    if (!hasApiKey || !trimmed || loadingMore || page >= totalPages) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await searchMulti(trimmed, nextPage);
      setMovies((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...res.movies.filter((m) => !seen.has(m.id))];
      });
      setSeries((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...res.series.filter((s) => !seen.has(s.id))];
      });
      setPage(nextPage);
      setTotalPages(res.totalPages);
    } catch {
      // ignore load more error
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQuery, hasApiKey, loadingMore, page, totalPages]);

  return {
    query,
    setQuery,
    debouncedQuery,
    movies,
    series,
    people,
    smartMatches,
    smartSummary,
    trendingSuggestions,
    recentSearches,
    clearRecentSearches,
    loading,
    loadingMore,
    error,
    hasMore: page < totalPages,
    loadMore,
  };
}
