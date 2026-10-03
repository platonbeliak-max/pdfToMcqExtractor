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

interface StoredImage {
  buf: ArrayBuffer;
  type: string;
}

/** Fallback for private mode / quota errors, where IndexedDB writes fail. */
const memory = new Map<string, StoredImage>();

async function toStored(blob: Blob): Promise<StoredImage> {
  return { buf: await blob.arrayBuffer(), type: blob.type || "image/jpeg" };
}

export async function putImage(id: string, blob: Blob): Promise<void> {
  // Raw bytes are stored instead of a Blob: Safari and mobile browsers can
  // hand back unreadable Blobs from IndexedDB.
  const stored = await toStored(blob);
  memory.set(id, stored);
  await run("readwrite", (s) => void s.put(stored, id)).catch(() => undefined);
}

export async function getImage(id: string): Promise<Blob | undefined> {
  const raw = await run<StoredImage | Blob>("readonly", (s) => s.get(id)).catch(() => undefined);
  if (raw instanceof Blob) return raw.size > 0 ? raw : undefined;
  if (raw && raw.buf && raw.buf.byteLength > 0) return new Blob([raw.buf], { type: raw.type });
  const fallback = memory.get(id);
  return fallback ? new Blob([fallback.buf], { type: fallback.type }) : undefined;
}

export function deleteImages(ids: string[]): Promise<void> {
  if (!ids.length) return Promise.resolve();
  for (const id of ids) memory.delete(id);
  return run("readwrite", (s) => {
    for (const id of ids) s.delete(id);
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export function clearImages(): Promise<void> {
  memory.clear();
  return run("readwrite", (s) => void s.clear())
    .then(() => undefined)
    .catch(() => undefined);
}
