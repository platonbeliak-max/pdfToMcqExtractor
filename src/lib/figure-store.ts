/**
 * Figure pictures are too large for localStorage (where the question bank
 * lives), so they are kept in IndexedDB as Blobs keyed by image id.
 */

const DB_NAME = "mcq_figures";
const STORE = "images";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function putImage(id: string, blob: Blob): Promise<void> {
  return run("readwrite", (s) => void s.put(blob, id)).then(() => undefined);
}

export function getImage(id: string): Promise<Blob | undefined> {
  return run<Blob>("readonly", (s) => s.get(id)).catch(() => undefined);
}

export function deleteImages(ids: string[]): Promise<void> {
  if (!ids.length) return Promise.resolve();
  return run("readwrite", (s) => {
    for (const id of ids) s.delete(id);
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export function clearImages(): Promise<void> {
  return run("readwrite", (s) => void s.clear())
    .then(() => undefined)
    .catch(() => undefined);
}
