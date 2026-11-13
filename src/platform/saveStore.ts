import { migrateSave, type GameState } from '../engine';

/**
 * Where saves live. The game only talks to this interface, so the same code
 * runs in a browser, the Tauri desktop app and Android.
 */
export interface SaveStore {
  /** Every save this build can load, in no particular order. */
  list(): Promise<SaveRecord[]>;
  save(slotId: string, state: GameState): Promise<void>;
  remove(slotId: string): Promise<void>;
}

export interface SaveRecord {
  slotId: string;
  /** Milliseconds since the Unix epoch. */
  savedAt: number;
  state: GameState;
}

export const SAVE_SLOTS = ['slot-1', 'slot-2', 'slot-3'] as const;

/** What is actually written to storage: the state is checked again on the way back in. */
interface StoredRecord {
  slotId: string;
  savedAt: number;
  state: unknown;
}

function toRecord(stored: StoredRecord): SaveRecord | null {
  const state = migrateSave(stored.state);
  return state ? { slotId: stored.slotId, savedAt: stored.savedAt, state } : null;
}

/** Keeps saves in memory only. Used in tests and when no real storage is available. */
export function createMemorySaveStore(now: () => number = Date.now): SaveStore {
  const records = new Map<string, StoredRecord>();
  return {
    async list() {
      return [...records.values()].map(toRecord).filter((r): r is SaveRecord => r !== null);
    },
    async save(slotId, state) {
      // Round-trip through JSON so the stored copy cannot be changed from outside.
      records.set(slotId, { slotId, savedAt: now(), state: JSON.parse(JSON.stringify(state)) });
    },
    async remove(slotId) {
      records.delete(slotId);
    },
  };
}

const DB_NAME = 'allerya-heroes';
const STORE_NAME = 'saves';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'slotId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = work(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** Saves in the browser's IndexedDB, which also works inside Tauri and Android webviews. */
export function createIndexedDbSaveStore(): SaveStore {
  return {
    async list() {
      const stored = await run<StoredRecord[]>('readonly', (store) => store.getAll());
      return stored.map(toRecord).filter((r): r is SaveRecord => r !== null);
    },
    async save(slotId, state) {
      const record: StoredRecord = { slotId, savedAt: Date.now(), state };
      await run('readwrite', (store) => store.put(record));
    },
    async remove(slotId) {
      await run('readwrite', (store) => store.delete(slotId));
    },
  };
}

export function createDefaultSaveStore(): SaveStore {
  return typeof indexedDB === 'undefined' ? createMemorySaveStore() : createIndexedDbSaveStore();
}
