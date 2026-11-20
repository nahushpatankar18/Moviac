import {
  ContentFilter,
  DiscoverFilters,
  EraFilter,
  GenreChipId,
  TmdbEpisode,
  TmdbGenre,
  TmdbMediaDetail,
  TmdbMediaItem,
  TmdbPersonResult,
  TmdbVideo,
} from '../types/tmdb';
import { vaultRemoveItem, vaultSetItem } from './persistentStorage';

const BASE_URL = 'https://api.themoviedb.org/3';
const API_KEY_STORAGE_KEY = 'cinedeck_tmdb_api_key';
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const keywordIdCache = new Map<string, number[]>();

export class TmdbError extends Error {
  status: number;
  code: 'INVALID_KEY' | 'NETWORK' | 'NOT_FOUND' | 'UNKNOWN';

  constructor(
    message: string,
    status: number,
    code: 'INVALID_KEY' | 'NETWORK' | 'NOT_FOUND' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
    this.code = code;
  }
}

export interface GenreChipConfig {
  id: GenreChipId;
  label: string;
  movieGenreNames: string[];
  tvGenreNames: string[];
  fallbackMovieIds: number[];
  fallbackTvIds: number[];
  keywordTerms?: string[];
}

export const GENRE_CHIPS: GenreChipConfig[] = [
  {
    id: 'comedy',
    label: 'Comedy',
    movieGenreNames: ['Comedy'],
    tvGenreNames: ['Comedy'],
    fallbackMovieIds: [35],
    fallbackTvIds: [35],
  },
  {
    id: 'action',
    label: 'Action',
    movieGenreNames: ['Action'],
    tvGenreNames: ['Action & Adventure'],
    fallbackMovieIds: [28],
    fallbackTvIds: [10759],
  },
  {
    id: 'martial-arts',
    label: 'Fight/Martial Arts',
    movieGenreNames: ['Action'],
    tvGenreNames: ['Action & Adventure'],
    fallbackMovieIds: [28],
    fallbackTvIds: [10759],
    keywordTerms: ['martial arts', 'kung fu', 'hand to hand combat'],
  },
  {
    id: 'sci-fi',
    label: 'Sci-Fi',
    movieGenreNames: ['Science Fiction'],
    tvGenreNames: ['Sci-Fi & Fantasy'],
    fallbackMovieIds: [878],
    fallbackTvIds: [10765],
  },
  {
    id: 'mystery',
    label: 'Mystery',
    movieGenreNames: ['Mystery'],
    tvGenreNames: ['Mystery'],
    fallbackMovieIds: [9648],
    fallbackTvIds: [9648],
  },
  {
    id: 'spy-thriller',
    label: 'Spy Thriller',
    movieGenreNames: ['Thriller', 'Action'],
    tvGenreNames: ['Action & Adventure', 'Crime'],
    fallbackMovieIds: [53, 28],
    fallbackTvIds: [10759, 80],
    keywordTerms: ['spy', 'espionage', 'secret agent'],
  },
  {
    id: 'thriller',
    label: 'Thriller',
    movieGenreNames: ['Thriller'],
    tvGenreNames: ['Mystery', 'Crime'],
    fallbackMovieIds: [53],
    fallbackTvIds: [9648, 80],
  },
  {
    id: 'crime',
    label: 'Crime',
    movieGenreNames: ['Crime'],
    tvGenreNames: ['Crime'],
    fallbackMovieIds: [80],
    fallbackTvIds: [80],
  },
  {
    id: 'adventure',
    label: 'Adventure',
    movieGenreNames: ['Adventure'],
    tvGenreNames: ['Action & Adventure'],
    fallbackMovieIds: [12],
    fallbackTvIds: [10759],
  },
  {
    id: 'horror',
    label: 'Horror',
    movieGenreNames: ['Horror'],
    tvGenreNames: ['Mystery'],
    fallbackMovieIds: [27],
    fallbackTvIds: [9648],
  },
  {
    id: 'drama',
    label: 'Drama',
    movieGenreNames: ['Drama'],
    tvGenreNames: ['Drama'],
    fallbackMovieIds: [18],
    fallbackTvIds: [18],
  },
  {
    id: 'romance',
    label: 'Romance',
    movieGenreNames: ['Romance'],
    tvGenreNames: ['Drama'],
    fallbackMovieIds: [10749],
    fallbackTvIds: [18],
  },
  {
    id: 'animation',
    label: 'Animation',
    movieGenreNames: ['Animation'],
    tvGenreNames: ['Animation'],
    fallbackMovieIds: [16],
    fallbackTvIds: [16],
  },
];

export function getStoredApiKey(): string {
  try {
    const local = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (local && local.trim()) return local.trim();
  } catch {
    // ignore storage errors
  }
  const envKey = import.meta.env?.VITE_TMDB_API_KEY;
  return typeof envKey === 'string' ? envKey.trim() : '';
}

export function saveApiKey(key: string): void {
  vaultSetItem(API_KEY_STORAGE_KEY, key.trim());
  clearTmdbCache();
}

export function clearApiKey(): void {
  vaultRemoveItem(API_KEY_STORAGE_KEY);
  clearTmdbCache();
}

export function clearTmdbCache(): void {
  memoryCache.clear();
  keywordIdCache.clear();
}

export function getPosterUrl(path: string | null | undefined, size: 'w500' | 'w780' | 'original' = 'w500'): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function getBackdropUrl(path: string | null | undefined, size: 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function getProfileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/w185${path}`;
}

export function getProviderLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/w92${path}`;
}

function isBearerToken(key: string): boolean {
  return key.startsWith('eyJ') && key.length > 40;
}

async function tmdbFetch<T>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined> = {},
  options: { signal?: AbortSignal; skipCache?: boolean; overrideKey?: string } = {}
): Promise<T> {
  const apiKey = (options.overrideKey ?? getStoredApiKey()).trim();
  if (!apiKey) {
    throw new TmdbError('TMDB API key is missing.', 401, 'INVALID_KEY');
  }

  const searchParams = new URLSearchParams();
  searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      searchParams.set(k, String(v));
    }
  }

  const useBearer = isBearerToken(apiKey);
  if (!useBearer) {
    searchParams.set('api_key', apiKey);
  }

  const cacheKey = `${endpoint}?${searchParams.toString()}:${apiKey.slice(0, 8)}`;
  if (!options.skipCache) {
    const cached = memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  const url = `${BASE_URL}${endpoint}?${searchParams.toString()}`;
  const headers: HeadersInit = useBearer
    ? { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    : { Accept: 'application/json' };

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: options.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new TmdbError('Network error while connecting to TMDB. Check your connection.', 0, 'NETWORK');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new TmdbError('Invalid TMDB API key. Please check your key in Settings.', response.status, 'INVALID_KEY');
    }
    if (response.status === 404) {
      throw new TmdbError('Requested title was not found on TMDB.', 404, 'NOT_FOUND');
    }
    throw new TmdbError(`TMDB request failed (${response.status}).`, response.status, 'UNKNOWN');
  }

  const data = (await response.json()) as T;
  if (!options.skipCache) {
    memoryCache.set(cacheKey, { timestamp: Date.now(), data });
  }
  return data;
}

export async function validateApiKey(key: string): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new TmdbError('Please enter a TMDB API key.', 401, 'INVALID_KEY');
  }
  await tmdbFetch('/configuration', {}, { skipCache: true, overrideKey: trimmed });
  return true;
}

interface RawMedia {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  genre_ids?: number[];
  original_language?: string;
}

export function normalizeMediaItem(raw: RawMedia, fallbackType: 'movie' | 'tv'): TmdbMediaItem {
  const mediaType: 'movie' | 'tv' =
    raw.media_type === 'movie' || raw.media_type === 'tv' ? raw.media_type : fallbackType;
  const dateStr = raw.release_date || raw.first_air_date || '';
  const year = dateStr ? dateStr.slice(0, 4) : '—';

  return {
    id: raw.id,
    media_type: mediaType,
    title: raw.title || raw.name || 'Untitled',
    original_title: raw.original_title || raw.original_name,
    overview: raw.overview || '',
    poster_path: raw.poster_path ?? null,
    backdrop_path: raw.backdrop_path ?? null,
    release_date: dateStr,
    year,
    vote_average: Number((raw.vote_average ?? 0).toFixed(1)),
    vote_count: raw.vote_count ?? 0,
    popularity: raw.popularity ?? 0,
    genre_ids: raw.genre_ids ?? [],
    original_language: raw.original_language || 'en',
  };
}

export async function getGenreLists(): Promise<{ movie: TmdbGenre[]; tv: TmdbGenre[] }> {
  const [movieRes, tvRes] = await Promise.all([
    tmdbFetch<{ genres: TmdbGenre[] }>('/genre/movie/list'),
    tmdbFetch<{ genres: TmdbGenre[] }>('/genre/tv/list'),
  ]);
  return { movie: movieRes.genres, tv: tvRes.genres };
}

export async function resolveKeywordIds(term: string, signal?: AbortSignal): Promise<number[]> {
  const normalized = term.toLowerCase().trim();
  if (keywordIdCache.has(normalized)) {
    return keywordIdCache.get(normalized)!;
  }
  try {
    const res = await tmdbFetch<{ results: Array<{ id: number; name: string }> }>(
      '/search/keyword',
      { query: normalized },
      { signal }
    );
    const ids = res.results.slice(0, 3).map((k) => k.id);
    keywordIdCache.set(normalized, ids);
    return ids;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return [];
  }
}

export function getEraDateBounds(era: EraFilter): { gte?: string; lte?: string } {
  const currentYear = new Date().getFullYear();
  if (era === 'new') {
    return { gte: `${currentYear - 2}-01-01` };
  }
  if (era === 'modern') {
    return { gte: '2005-01-01' };
  }
  if (era === 'classic') {
    return { lte: '2004-12-31' };
  }
  return {};
}

export function matchesEra(item: TmdbMediaItem, era: EraFilter): boolean {
  if (era === 'all') return true;
  const yearNum = Number(item.year);
  if (!Number.isFinite(yearNum) || yearNum === 0) return false;
  const currentYear = new Date().getFullYear();
  if (era === 'new') return yearNum >= currentYear - 2;
  if (era === 'modern') return yearNum >= 2005;
  if (era === 'classic') return yearNum < 2005;
  return true;
}

function interleaveMedia(movies: TmdbMediaItem[], series: TmdbMediaItem[]): TmdbMediaItem[] {
  const combined: TmdbMediaItem[] = [];
  const maxLen = Math.max(movies.length, series.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < movies.length) combined.push(movies[i]);
    if (i < series.length) combined.push(series[i]);
  }
  return combined;
}

export async function getTrending(
  type: ContentFilter,
  window: 'day' | 'week',
  era: EraFilter = 'all'
): Promise<TmdbMediaItem[]> {
  if (era === 'classic') {
    // Trending mostly returns recent titles; use discover sorted by popularity for classics
    return discoverByParams(type, {
      genres: [],
      minRating: 7,
      yearFrom: '',
      yearTo: '2004',
      language: '',
      era: 'classic',
      sortBy: 'popularity.desc',
    }).then((r) => r.results);
  }

  if (type === 'all') {
    const [mRes, tRes] = await Promise.all([
      tmdbFetch<{ results: RawMedia[] }>(`/trending/movie/${window}`),
      tmdbFetch<{ results: RawMedia[] }>(`/trending/tv/${window}`),
    ]);
    const movies = mRes.results.map((r) => normalizeMediaItem(r, 'movie')).filter((i) => matchesEra(i, era));
    const series = tRes.results.map((r) => normalizeMediaItem(r, 'tv')).filter((i) => matchesEra(i, era));
    return interleaveMedia(movies, series);
  }

  const res = await tmdbFetch<{ results: RawMedia[] }>(`/trending/${type}/${window}`);
  const items = res.results.map((r) => normalizeMediaItem(r, type)).filter((i) => matchesEra(i, era));
  if (items.length < 6 && era === 'new') {
    return discoverByParams(type, {
      genres: [],
      minRating: 6.5,
      yearFrom: '',
      yearTo: '',
      language: '',
      era: 'new',
      sortBy: 'popularity.desc',
    }).then((r) => r.results);
  }
  return items;
}

export async function getNewReleases(type: ContentFilter, era: EraFilter = 'all'): Promise<TmdbMediaItem[]> {
  if (era === 'classic') {
    return discoverByParams(type, {
      genres: [],
      minRating: 7.2,
      yearFrom: '1980',
      yearTo: '2004',
      language: '',
      era: 'classic',
      sortBy: 'vote_count.desc',
    }).then((r) => r.results);
  }

  if (type === 'all') {
    const [mRes, tRes] = await Promise.all([
      tmdbFetch<{ results: RawMedia[] }>('/movie/now_playing'),
      tmdbFetch<{ results: RawMedia[] }>('/tv/on_the_air'),
    ]);
    return interleaveMedia(
      mRes.results.map((r) => normalizeMediaItem(r, 'movie')).filter((i) => matchesEra(i, era)),
      tRes.results.map((r) => normalizeMediaItem(r, 'tv')).filter((i) => matchesEra(i, era))
    );
  }

  const endpoint = type === 'movie' ? '/movie/now_playing' : '/tv/on_the_air';
  const res = await tmdbFetch<{ results: RawMedia[] }>(endpoint);
  return res.results.map((r) => normalizeMediaItem(r, type)).filter((i) => matchesEra(i, era));
}

export async function getTopRated(type: ContentFilter, era: EraFilter = 'all'): Promise<TmdbMediaItem[]> {
  if (era !== 'all') {
    return discoverByParams(type, {
      genres: [],
      minRating: 7.5,
      yearFrom: '',
      yearTo: '',
      language: '',
      era,
      sortBy: 'vote_average.desc',
    }).then((r) => r.results);
  }

  if (type === 'all') {
    const [mRes, tRes] = await Promise.all([
      tmdbFetch<{ results: RawMedia[] }>('/movie/top_rated'),
      tmdbFetch<{ results: RawMedia[] }>('/tv/top_rated'),
    ]);
    return interleaveMedia(
      mRes.results.map((r) => normalizeMediaItem(r, 'movie')),
      tRes.results.map((r) => normalizeMediaItem(r, 'tv'))
    );
  }

  const endpoint = type === 'movie' ? '/movie/top_rated' : '/tv/top_rated';
  const res = await tmdbFetch<{ results: RawMedia[] }>(endpoint);
  return res.results.map((r) => normalizeMediaItem(r, type));
}

export async function getClassics(type: ContentFilter): Promise<TmdbMediaItem[]> {
  return discoverByParams(type, {
    genres: [],
    minRating: 7.4,
    yearFrom: '',
    yearTo: '2004',
    language: '',
    era: 'classic',
    sortBy: 'vote_average.desc',
  }).then((r) => r.results);
}

async function resolveChipIdsAndKeywords(
  chips: GenreChipId[],
  mediaType: 'movie' | 'tv',
  signal?: AbortSignal
): Promise<{ genreIds: number[]; keywordIds: number[] }> {
  const lists = await getGenreLists().catch(() => ({ movie: [], tv: [] }));
  const genreIds = new Set<number>();
  const keywordIds = new Set<number>();

  for (const chipId of chips) {
    const cfg = GENRE_CHIPS.find((c) => c.id === chipId);
    if (!cfg) continue;

    const targetNames = mediaType === 'movie' ? cfg.movieGenreNames : cfg.tvGenreNames;
    const sourceList = mediaType === 'movie' ? lists.movie : lists.tv;
    let matchedAny = false;

    for (const name of targetNames) {
      const found = sourceList.find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (found) {
        genreIds.add(found.id);
        matchedAny = true;
      }
    }

    if (!matchedAny) {
      const fallbacks = mediaType === 'movie' ? cfg.fallbackMovieIds : cfg.fallbackTvIds;
      fallbacks.forEach((id) => genreIds.add(id));
    }

    if (cfg.keywordTerms && cfg.keywordTerms.length > 0) {
      const kwGroups = await Promise.all(cfg.keywordTerms.map((term) => resolveKeywordIds(term, signal)));
      kwGroups.flat().forEach((id) => keywordIds.add(id));
    }
  }

  return {
    genreIds: Array.from(genreIds),
    keywordIds: Array.from(keywordIds),
  };
}

export async function discoverByParams(
  type: ContentFilter,
  filters: DiscoverFilters,
  signal?: AbortSignal
): Promise<{ results: TmdbMediaItem[]; totalPages: number }> {
  const page = filters.page ?? 1;
  const eraBounds = getEraDateBounds(filters.era);

  const runSingle = async (mediaType: 'movie' | 'tv') => {
    const { genreIds, keywordIds } = await resolveChipIdsAndKeywords(filters.genres, mediaType, signal);
    const dateKeyGte = mediaType === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
    const dateKeyLte = mediaType === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';

    const gteYear = filters.yearFrom ? `${filters.yearFrom}-01-01` : eraBounds.gte;
    const lteYear = filters.yearTo ? `${filters.yearTo}-12-31` : eraBounds.lte;

    // Combine explicit year filters with era bounds safely
    let finalGte = gteYear;
    if (filters.yearFrom && eraBounds.gte) {
      finalGte = `${filters.yearFrom}-01-01` > eraBounds.gte ? `${filters.yearFrom}-01-01` : eraBounds.gte;
    }
    let finalLte = lteYear;
    if (filters.yearTo && eraBounds.lte) {
      finalLte = `${filters.yearTo}-12-31` < eraBounds.lte ? `${filters.yearTo}-12-31` : eraBounds.lte;
    }

    const baseParams: Record<string, string | number | undefined> = {
      page,
      sort_by: filters.sortBy || 'popularity.desc',
      'vote_count.gte': filters.sortBy === 'vote_average.desc' ? 250 : 40,
      'vote_average.gte': filters.minRating > 0 ? filters.minRating : undefined,
      with_original_language: filters.language || undefined,
      [dateKeyGte]: finalGte,
      [dateKeyLte]: finalLte,
      with_genres: genreIds.length > 0 ? genreIds.join(',') : undefined,
      with_keywords: keywordIds.length > 0 ? keywordIds.join('|') : undefined,
    };

    let res = await tmdbFetch<{ results: RawMedia[]; total_pages: number }>(
      `/discover/${mediaType}`,
      baseParams,
      { signal }
    );

    // If strict AND genres returned too few results, retry with OR (pipe)
    if (res.results.length < 4 && genreIds.length > 1) {
      res = await tmdbFetch<{ results: RawMedia[]; total_pages: number }>(
        `/discover/${mediaType}`,
        { ...baseParams, with_genres: genreIds.join('|') },
        { signal }
      );
    }

    return {
      items: res.results.map((r) => normalizeMediaItem(r, mediaType)),
      totalPages: res.total_pages,
    };
  };

  if (type === 'all') {
    const [m, t] = await Promise.all([runSingle('movie'), runSingle('tv')]);
    return {
      results: interleaveMedia(m.items, t.items),
      totalPages: Math.max(m.totalPages, t.totalPages),
    };
  }

  const single = await runSingle(type);
  return { results: single.items, totalPages: single.totalPages };
}

export async function getPersonalizedRecommendations(
  topGenreIds: number[],
  watchlistItems: Array<{ id: number; media_type: 'movie' | 'tv' }>,
  type: ContentFilter,
  era: EraFilter
): Promise<TmdbMediaItem[]> {
  const tasks: Array<Promise<TmdbMediaItem[]>> = [];

  // Pull recommendations from up to 2 recent watchlist titles
  const seeds = watchlistItems
    .filter((item) => type === 'all' || item.media_type === type)
    .slice(0, 2);

  for (const seed of seeds) {
    tasks.push(
      tmdbFetch<{ results: RawMedia[] }>(`/${seed.media_type}/${seed.id}/recommendations`)
        .then((res) => res.results.map((r) => normalizeMediaItem(r, seed.media_type)))
        .catch(() => [])
    );
  }

  // Also discover using user's top interacted TMDB genre IDs
  if (topGenreIds.length > 0) {
    const eraBounds = getEraDateBounds(era);
    const topStr = topGenreIds.slice(0, 3).join('|');
    if (type === 'all' || type === 'movie') {
      tasks.push(
        tmdbFetch<{ results: RawMedia[] }>('/discover/movie', {
          with_genres: topStr,
          'vote_average.gte': 7,
          'vote_count.gte': 150,
          sort_by: 'popularity.desc',
          'primary_release_date.gte': eraBounds.gte,
          'primary_release_date.lte': eraBounds.lte,
        })
          .then((res) => res.results.map((r) => normalizeMediaItem(r, 'movie')))
          .catch(() => [])
      );
    }
    if (type === 'all' || type === 'tv') {
      tasks.push(
        tmdbFetch<{ results: RawMedia[] }>('/discover/tv', {
          with_genres: topStr,
          'vote_average.gte': 7,
          'vote_count.gte': 80,
          sort_by: 'popularity.desc',
          'first_air_date.gte': eraBounds.gte,
          'first_air_date.lte': eraBounds.lte,
        })
          .then((res) => res.results.map((r) => normalizeMediaItem(r, 'tv')))
          .catch(() => [])
      );
    }
  }

  if (tasks.length === 0) {
    // Friendly high-rated discovery fallback when user is brand new
    return discoverByParams(type, {
      genres: ['sci-fi', 'thriller'],
      minRating: 7.4,
      yearFrom: '',
      yearTo: '',
      language: '',
      era,
      sortBy: 'vote_average.desc',
    }).then((r) => r.results);
  }

  const batches = await Promise.all(tasks);
  const seen = new Set<string>(watchlistItems.map((w) => `${w.media_type}-${w.id}`));
  const merged: TmdbMediaItem[] = [];

  for (const list of batches) {
    for (const item of list) {
      const key = `${item.media_type}-${item.id}`;
      if (!seen.has(key) && matchesEra(item, era)) {
        seen.add(key);
        merged.push(item);
      }
    }
  }

  return merged.slice(0, 20);
}

export async function getSurprisePick(
  type: ContentFilter,
  genres: GenreChipId[],
  era: EraFilter
): Promise<TmdbMediaItem | null> {
  const randomPage = Math.floor(Math.random() * 4) + 1;
  const { results } = await discoverByParams(type, {
    genres,
    minRating: 7.4,
    yearFrom: '',
    yearTo: '',
    language: '',
    era,
    page: randomPage,
    sortBy: 'vote_average.desc',
  });

  const pool = results.length > 0 ? results : (await getTopRated(type, era));
  if (pool.length === 0) return null;
  const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 15))];
  return pick;
}

export async function searchMulti(
  query: string,
  page = 1,
  signal?: AbortSignal
): Promise<{
  movies: TmdbMediaItem[];
  series: TmdbMediaItem[];
  people: TmdbPersonResult[];
  totalPages: number;
  totalResults: number;
}> {
  const res = await tmdbFetch<{
    results: Array<
      RawMedia & {
        known_for_department?: string;
        profile_path?: string | null;
        known_for?: RawMedia[];
      }
    >;
    total_pages: number;
    total_results: number;
  }>('/search/multi', { query, page, include_adult: false }, { signal });

  const movies: TmdbMediaItem[] = [];
  const series: TmdbMediaItem[] = [];
  const people: TmdbPersonResult[] = [];

  for (const item of res.results) {
    if (item.media_type === 'movie') {
      movies.push(normalizeMediaItem(item, 'movie'));
    } else if (item.media_type === 'tv') {
      series.push(normalizeMediaItem(item, 'tv'));
    } else if (item.media_type === 'person') {
      const knownFor = (item.known_for || [])
        .filter((k) => k.media_type === 'movie' || k.media_type === 'tv')
        .map((k) => normalizeMediaItem(k, k.media_type === 'tv' ? 'tv' : 'movie'));
      people.push({
        id: item.id,
        name: item.name || item.title || 'Unknown',
        profile_path: item.profile_path ?? null,
        known_for_department: item.known_for_department || 'Acting',
        known_for: knownFor,
      });
    }
  }

  return {
    movies,
    series,
    people,
    totalPages: res.total_pages,
    totalResults: res.total_results,
  };
}

const DESCRIPTIVE_STOPWORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'of', 'for', 'with', 'about', 'set', 'from',
  'by', 'to', 'and', 'or', 'like', 'that', 'movie', 'movies', 'film', 'films',
  'series', 'show', 'shows', 'tv', 'web', 'good', 'best', 'top', 'great', 'watch',
  'before', 'after', 'during', 'starring', 'directed',
]);

const SMART_GENRE_HINTS: Array<{ pattern: RegExp; chip: GenreChipId }> = [
  { pattern: /\b(spy|espionage|agent|cia|mi6)\b/i, chip: 'spy-thriller' },
  { pattern: /\b(martial\s*arts|kung\s*fu|karate|fight|fighting|boxing)\b/i, chip: 'martial-arts' },
  { pattern: /\b(sci-fi|scifi|science\s*fiction|space|cyberpunk|alien|dystopian)\b/i, chip: 'sci-fi' },
  { pattern: /\b(comedy|funny|hilarious|romcom|sitcom)\b/i, chip: 'comedy' },
  { pattern: /\b(action|explosion|superhero)\b/i, chip: 'action' },
  { pattern: /\b(mystery|whodunit|detective)\b/i, chip: 'mystery' },
  { pattern: /\b(thriller|suspense|psychological)\b/i, chip: 'thriller' },
  { pattern: /\b(crime|heist|mafia|gangster|noir)\b/i, chip: 'crime' },
  { pattern: /\b(adventure|quest|expedition)\b/i, chip: 'adventure' },
  { pattern: /\b(horror|scary|ghost|haunted|zombie|slasher)\b/i, chip: 'horror' },
  { pattern: /\b(drama|emotional)\b/i, chip: 'drama' },
  { pattern: /\b(romance|romantic|love\s*story|romcom)\b/i, chip: 'romance' },
  { pattern: /\b(animation|animated|anime|cartoon)\b/i, chip: 'animation' },
];

const SMART_LANGUAGE_HINTS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /\b(korean|k-drama|kdrama)\b/i, code: 'ko' },
  { pattern: /\b(japanese|anime)\b/i, code: 'ja' },
  { pattern: /\b(french)\b/i, code: 'fr' },
  { pattern: /\b(spanish)\b/i, code: 'es' },
  { pattern: /\b(hindi|bollywood|indian)\b/i, code: 'hi' },
  { pattern: /\b(german)\b/i, code: 'de' },
];

export function isDescriptiveQuery(query: string): boolean {
  const words = query.trim().split(/\s+/);
  if (words.length >= 3) return true;
  return SMART_GENRE_HINTS.some((h) => h.pattern.test(query));
}

export async function smartSearchDiscover(
  query: string,
  signal?: AbortSignal
): Promise<{ results: TmdbMediaItem[]; summary: string }> {
  const q = query.trim();
  if (!q) return { results: [], summary: '' };

  let targetType: ContentFilter = 'all';
  if (/\b(movie|movies|film|films)\b/i.test(q) && !/\b(series|show|shows|tv)\b/i.test(q)) {
    targetType = 'movie';
  } else if (/\b(series|show|shows|tv|kdrama|k-drama|anime)\b/i.test(q)) {
    targetType = 'tv';
  }

  const matchedChips: GenreChipId[] = [];
  for (const hint of SMART_GENRE_HINTS) {
    if (hint.pattern.test(q) && !matchedChips.includes(hint.chip)) {
      matchedChips.push(hint.chip);
    }
  }

  let language = '';
  for (const lang of SMART_LANGUAGE_HINTS) {
    if (lang.pattern.test(q)) {
      language = lang.code;
      break;
    }
  }

  let yearFrom = '';
  let yearTo = '';
  const decadeMatch = q.match(/\b(19\d0|20\d0|\d0)s\b/i);
  if (decadeMatch) {
    const raw = decadeMatch[1];
    const startYear = raw.length === 2 ? Number(`19${raw}`) : Number(raw);
    yearFrom = String(startYear);
    yearTo = String(startYear + 9);
  }
  const beforeMatch = q.match(/\bbefore\s+(19\d{2}|20\d{2})\b/i);
  if (beforeMatch) yearTo = String(Number(beforeMatch[1]) - 1);
  const afterMatch = q.match(/\bafter\s+(19\d{2}|20\d{2})\b/i);
  if (afterMatch) yearFrom = String(Number(afterMatch[1]) + 1);

  // Extract place / theme keywords for /search/keyword
  const rawWords = q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !DESCRIPTIVE_STOPWORDS.has(w) && !/^\d{2,4}s?$/.test(w));

  const keywordLookupWords = rawWords
    .filter((w) => !SMART_GENRE_HINTS.some((h) => h.pattern.test(w)))
    .filter((w) => !SMART_LANGUAGE_HINTS.some((l) => l.pattern.test(w)))
    .slice(0, 2);

  const keywordIds = (
    await Promise.all(keywordLookupWords.map((word) => resolveKeywordIds(word, signal)))
  ).flat();

  if (matchedChips.length === 0 && keywordIds.length === 0 && !language && !yearFrom && !yearTo) {
    return { results: [], summary: '' };
  }

  const runDiscover = async (mediaType: 'movie' | 'tv') => {
    const resolved = await resolveChipIdsAndKeywords(matchedChips, mediaType, signal);
    const combinedKw = Array.from(new Set([...resolved.keywordIds, ...keywordIds]));
    const dateKeyGte = mediaType === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
    const dateKeyLte = mediaType === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';

    const params: Record<string, string | number | undefined> = {
      sort_by: 'popularity.desc',
      'vote_count.gte': 30,
      with_original_language: language || undefined,
      [dateKeyGte]: yearFrom ? `${yearFrom}-01-01` : undefined,
      [dateKeyLte]: yearTo ? `${yearTo}-12-31` : undefined,
      with_genres: resolved.genreIds.length > 0 ? resolved.genreIds.join(',') : undefined,
      with_keywords: combinedKw.length > 0 ? combinedKw.join('|') : undefined,
    };

    let res = await tmdbFetch<{ results: RawMedia[] }>(`/discover/${mediaType}`, params, { signal });
    // Relax keyword constraint if genre + keyword together yields zero
    if (res.results.length === 0 && combinedKw.length > 0 && resolved.genreIds.length > 0) {
      res = await tmdbFetch<{ results: RawMedia[] }>(
        `/discover/${mediaType}`,
        { ...params, with_keywords: undefined },
        { signal }
      );
    }
    return res.results.map((r) => normalizeMediaItem(r, mediaType));
  };

  let results: TmdbMediaItem[] = [];
  if (targetType === 'all') {
    const [m, t] = await Promise.all([runDiscover('movie'), runDiscover('tv')]);
    results = interleaveMedia(m, t);
  } else {
    results = await runDiscover(targetType);
  }

  const summaryParts: string[] = [];
  if (matchedChips.length > 0) {
    summaryParts.push(
      matchedChips
        .map((id) => GENRE_CHIPS.find((c) => c.id === id)?.label || id)
        .join(' + ')
    );
  }
  if (keywordLookupWords.length > 0) {
    summaryParts.push(`"${keywordLookupWords.join(', ')}"`);
  }
  if (yearFrom || yearTo) {
    summaryParts.push(`${yearFrom || '...'}–${yearTo || 'now'}`);
  }

  return {
    results: results.slice(0, 18),
    summary: summaryParts.join(' · '),
  };
}

interface RawDetailResponse extends RawMedia {
  tagline?: string;
  runtime?: number | null;
  episode_run_time?: number[];
  genres?: TmdbGenre[];
  status?: string;
  credits?: {
    cast?: Array<{ id: number; name: string; character: string; profile_path: string | null; order: number }>;
    crew?: Array<{ id: number; name: string; job: string; department: string }>;
  };
  created_by?: Array<{ id: number; name: string }>;
  videos?: { results: TmdbVideo[] };
  'watch/providers'?: {
    results?: Record<string, {
      link?: string;
      flatrate?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
      rent?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
      buy?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
    }>;
  };
  recommendations?: { results: RawMedia[] };
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: Array<{
    id: number;
    name: string;
    overview: string;
    poster_path: string | null;
    season_number: number;
    episode_count: number;
    air_date: string;
  }>;
  networks?: Array<{ id: number; name: string; logo_path: string | null }>;
}

export async function getMediaDetail(
  id: number,
  mediaType: 'movie' | 'tv',
  signal?: AbortSignal
): Promise<TmdbMediaDetail> {
  const raw = await tmdbFetch<RawDetailResponse>(
    `/${mediaType}/${id}`,
    { append_to_response: 'credits,videos,recommendations,watch/providers' },
    { signal }
  );

  const base = normalizeMediaItem({ ...raw, media_type: mediaType }, mediaType);
  const cast = (raw.credits?.cast || []).slice(0, 5);
  const directors =
    mediaType === 'movie'
      ? (raw.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name)
      : (raw.created_by || []).map((c) => c.name);

  const youtubeVideos = (raw.videos?.results || []).filter((v) => v.site === 'YouTube');
  const trailer =
    youtubeVideos.find((v) => v.type === 'Trailer' && v.official) ||
    youtubeVideos.find((v) => v.type === 'Trailer') ||
    youtubeVideos.find((v) => v.type === 'Teaser') ||
    youtubeVideos[0] ||
    null;

  const runtime =
    mediaType === 'movie'
      ? raw.runtime ?? null
      : raw.episode_run_time && raw.episode_run_time.length > 0
      ? raw.episode_run_time[0]
      : null;

  const watchProvidersIN = raw['watch/providers']?.results?.['IN'] ?? null;
  const recommendations = (raw.recommendations?.results || [])
    .slice(0, 12)
    .map((r) => normalizeMediaItem(r, mediaType));

  return {
    ...base,
    genre_ids: (raw.genres || []).map((g) => g.id),
    tagline: raw.tagline,
    runtime,
    genres: raw.genres || [],
    status: raw.status || '',
    cast,
    directorsOrCreators: directors,
    trailer,
    videos: youtubeVideos,
    watchProvidersIN,
    recommendations,
    number_of_seasons: raw.number_of_seasons,
    number_of_episodes: raw.number_of_episodes,
    seasons: (raw.seasons || []).filter((s) => s.season_number >= 0),
    networks: raw.networks || [],
  };
}

export async function getSeasonEpisodes(
  tvId: number,
  seasonNumber: number,
  signal?: AbortSignal
): Promise<TmdbEpisode[]> {
  const res = await tmdbFetch<{ episodes?: TmdbEpisode[] }>(
    `/tv/${tvId}/season/${seasonNumber}`,
    {},
    { signal }
  );
  return res.episodes || [];
}
