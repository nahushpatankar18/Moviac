const DB_NAME = 'moviac_vault';
const STORE_NAME = 'kv';

export const VAULT_KEYS = [
  'cinedeck_tmdb_api_key',
  'watching_movies',
  'watching_series',
  'watchlist_movies',
  'watchlist_series',
  'watched_movies',
  'watched_series',
  'cinedeck_genre_affinity',
  'cinedeck_recent_searches',
  'moviac_last_cloud_uid',
] as const;

function isEffectivelyEmpty(val: string | null): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  return trimmed === '' || trimmed === '[]' || trimmed === '{}';
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

async function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      const alreadyPersisted = await navigator.storage.persisted?.();
      if (alreadyPersisted) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // ignore browser restrictions
  }
  return false;
}

export async function restoreVaultToLocalStorage(): Promise<void> {
  const work = async () => {
    await requestPersistentStorage();
    const db = await openVaultDb();
    try {
      await Promise.all(
        VAULT_KEYS.map(async (key) => {
          let localVal: string | null = null;
          try {
            localVal = localStorage.getItem(key);
          } catch {
            localVal = null;
          }

          const idbVal = await idbGet(db, key);

          if (isEffectivelyEmpty(localVal) && !isEffectivelyEmpty(idbVal)) {
            try {
              localStorage.setItem(key, idbVal!);
            } catch {
              // ignore quota errors
            }
          } else if (!isEffectivelyEmpty(localVal) && isEffectivelyEmpty(idbVal)) {
            await idbSet(db, key, localVal!);
          }
        })
      );
    } finally {
      db.close();
    }
  };

  // Never block initial render longer than 400ms
  await Promise.race([
    work().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 400)),
  ]);
}

export function vaultSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota errors
  }
  openVaultDb()
    .then(async (db) => {
      try {
        await idbSet(db, key, value);
      } finally {
        db.close();
      }
    })
    .catch(() => {});
}

export function vaultRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  openVaultDb()
    .then(async (db) => {
      try {
        await idbDelete(db, key);
      } finally {
        db.close();
      }
    })
    .catch(() => {});
}
