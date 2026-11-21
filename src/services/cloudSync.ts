import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { WatchlistStatus } from '../hooks/useWatchlist';
import type { MediaType, WatchlistEntry } from '../types/tmdb';

export interface CloudWatchlistRecord {
  itemKey: string;
  status: WatchlistStatus;
  entry: WatchlistEntry;
}

export interface CloudPreferencesData {
  tmdbApiKey: string;
  recentSearches: string[];
  genreAffinity: Record<string, number>;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export function makeWatchlistDocId(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}_${Math.trunc(tmdbId)}`;
}

function sanitizeString(value: unknown, maxLength: number, fallback = ''): string {
  const str = typeof value === 'string' ? value : fallback;
  return str.slice(0, maxLength);
}

function sanitizePositiveInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, num));
}

function sanitizeWatchlistPayload(
  uid: string,
  entry: WatchlistEntry,
  status: WatchlistStatus
) {
  const title = sanitizeString(entry.title?.trim() || 'Untitled', 300, 'Untitled') || 'Untitled';
  const voteAvgRaw =
    typeof entry.vote_average === 'number' && Number.isFinite(entry.vote_average)
      ? entry.vote_average
      : 0;
  const voteAverage = Math.min(10, Math.max(0, Math.round(voteAvgRaw * 10) / 10));
  const genreIds = Array.isArray(entry.genre_ids)
    ? entry.genre_ids
        .filter((gid): gid is number => typeof gid === 'number' && Number.isInteger(gid))
        .slice(0, 15)
    : [];
  const addedAt =
    typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt) && entry.addedAt >= 0
      ? entry.addedAt
      : Date.now();

  return {
    ownerId: uid,
    tmdbId: sanitizePositiveInt(entry.id, 1, 999999999, 1),
    mediaType: entry.media_type === 'tv' ? ('tv' as const) : ('movie' as const),
    status,
    title,
    posterPath: sanitizeString(entry.poster_path, 300, ''),
    backdropPath: sanitizeString(entry.backdrop_path, 300, ''),
    year: sanitizeString(entry.year, 16, ''),
    voteAverage,
    genreIds,
    addedAt,
    season: sanitizePositiveInt(entry.progress?.season, 1, 500, 1),
    episode: sanitizePositiveInt(entry.progress?.episode, 1, 5000, 1),
  };
}

function sanitizePreferencesPayload(uid: string, prefs: CloudPreferencesData) {
  const recentSearches = Array.isArray(prefs.recentSearches)
    ? prefs.recentSearches
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .slice(0, 10)
        .map((s) => s.trim().slice(0, 120))
    : [];

  const genreAffinity: Record<string, number> = {};
  if (prefs.genreAffinity && typeof prefs.genreAffinity === 'object') {
    for (const [k, v] of Object.entries(prefs.genreAffinity).slice(0, 30)) {
      if (typeof v === 'number' && Number.isFinite(v) && k.length > 0 && k.length <= 32) {
        genreAffinity[k] = v;
      }
    }
  }

  return {
    ownerId: uid,
    tmdbApiKey: sanitizeString(prefs.tmdbApiKey?.trim(), 512, ''),
    recentSearches,
    genreAffinity,
  };
}

export async function ensureUserProfile(user: User): Promise<void> {
  if (!VALID_ID_REGEX.test(user.uid)) return;
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const profileData = {
    uid: user.uid,
    email: sanitizeString(user.email, 254, ''),
    displayName: sanitizeString(user.displayName, 120, ''),
    photoURL: sanitizeString(user.photoURL, 500, ''),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...profileData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email: profileData.email,
        displayName: profileData.displayName,
        photoURL: profileData.photoURL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function fetchCloudPreferences(uid: string): Promise<CloudPreferencesData | null> {
  const path = `users/${uid}/preferences/main`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'preferences', 'main'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      tmdbApiKey: typeof data.tmdbApiKey === 'string' ? data.tmdbApiKey : '',
      recentSearches: Array.isArray(data.recentSearches) ? data.recentSearches : [],
      genreAffinity:
        data.genreAffinity && typeof data.genreAffinity === 'object' ? data.genreAffinity : {},
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function saveCloudPreferences(
  uid: string,
  prefs: CloudPreferencesData,
  changedFields?: Array<'tmdbApiKey' | 'recentSearches' | 'genreAffinity'>
): Promise<void> {
  const path = `users/${uid}/preferences/main`;
  const ref = doc(db, 'users', uid, 'preferences', 'main');
  const sanitized = sanitizePreferencesPayload(uid, prefs);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...sanitized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const updateBody: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
      };
      if (!changedFields || changedFields.includes('tmdbApiKey')) {
        updateBody.tmdbApiKey = sanitized.tmdbApiKey;
      }
      if (!changedFields || changedFields.includes('recentSearches')) {
        updateBody.recentSearches = sanitized.recentSearches;
      }
      if (!changedFields || changedFields.includes('genreAffinity')) {
        updateBody.genreAffinity = sanitized.genreAffinity;
      }
      await updateDoc(ref, updateBody);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function fetchAllCloudWatchlist(uid: string): Promise<CloudWatchlistRecord[]> {
  const path = `users/${uid}/watchlist`;
  try {
    const q = query(collection(db, 'users', uid, 'watchlist'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => docToCloudRecord(d.id, d.data()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeCloudWatchlist(
  uid: string,
  onRecords: (records: CloudWatchlistRecord[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/watchlist`;
  const q = query(collection(db, 'users', uid, 'watchlist'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const records = snapshot.docs.map((d) => docToCloudRecord(d.id, d.data()));
      onRecords(records);
    },
    (error) => {
      if (onError) {
        onError(error);
      }
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

function docToCloudRecord(itemKey: string, data: Record<string, unknown>): CloudWatchlistRecord {
  const mediaType: MediaType = data.mediaType === 'tv' ? 'tv' : 'movie';
  const status: WatchlistStatus =
    data.status === 'watching' || data.status === 'watched' ? data.status : 'to-watch';

  const entry: WatchlistEntry = {
    id: typeof data.tmdbId === 'number' ? data.tmdbId : 0,
    title: typeof data.title === 'string' ? data.title : 'Untitled',
    poster_path: typeof data.posterPath === 'string' && data.posterPath ? data.posterPath : null,
    backdrop_path:
      typeof data.backdropPath === 'string' && data.backdropPath ? data.backdropPath : null,
    media_type: mediaType,
    vote_average: typeof data.voteAverage === 'number' ? data.voteAverage : 0,
    year: typeof data.year === 'string' ? data.year : '',
    genre_ids: Array.isArray(data.genreIds)
      ? data.genreIds.filter((g): g is number => typeof g === 'number')
      : [],
    addedAt: typeof data.addedAt === 'number' ? data.addedAt : Date.now(),
    ...(mediaType === 'tv'
      ? {
          progress: {
            season: typeof data.season === 'number' && data.season >= 1 ? data.season : 1,
            episode: typeof data.episode === 'number' && data.episode >= 1 ? data.episode : 1,
          },
        }
      : {}),
  };

  return { itemKey, status, entry };
}

export async function upsertCloudWatchlistItem(
  uid: string,
  entry: WatchlistEntry,
  status: WatchlistStatus
): Promise<void> {
  const itemKey = makeWatchlistDocId(entry.media_type, entry.id);
  const path = `users/${uid}/watchlist/${itemKey}`;
  const ref = doc(db, 'users', uid, 'watchlist', itemKey);
  const payload = sanitizeWatchlistPayload(uid, entry, status);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        status: payload.status,
        title: payload.title,
        posterPath: payload.posterPath,
        backdropPath: payload.backdropPath,
        year: payload.year,
        voteAverage: payload.voteAverage,
        genreIds: payload.genreIds,
        addedAt: payload.addedAt,
        season: payload.season,
        episode: payload.episode,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateCloudSeriesProgress(
  uid: string,
  tmdbId: number,
  season: number,
  episode: number
): Promise<void> {
  const itemKey = makeWatchlistDocId('tv', tmdbId);
  const path = `users/${uid}/watchlist/${itemKey}`;
  const ref = doc(db, 'users', uid, 'watchlist', itemKey);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await updateDoc(ref, {
      season: sanitizePositiveInt(season, 1, 500, 1),
      episode: sanitizePositiveInt(episode, 1, 5000, 1),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteCloudWatchlistItem(
  uid: string,
  mediaType: MediaType,
  tmdbId: number
): Promise<void> {
  const itemKey = makeWatchlistDocId(mediaType, tmdbId);
  const path = `users/${uid}/watchlist/${itemKey}`;
  const ref = doc(db, 'users', uid, 'watchlist', itemKey);

  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
