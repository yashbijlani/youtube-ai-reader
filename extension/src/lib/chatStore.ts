import type { Conversation, StoredMessage } from "../types";

const DB_NAME = "youtube-ai-reader";
const DB_VERSION = 1;
const STORE = "conversations";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "videoId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export async function loadConversation(videoId: string): Promise<Conversation | null> {
  const result = await tx<Conversation | undefined>("readonly", (store) => store.get(videoId));
  return result ?? null;
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  conversation.updatedAt = Date.now();
  await tx("readwrite", (store) => store.put(conversation));
}

export async function clearConversation(videoId: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(videoId));
}

export async function clearAllConversations(): Promise<void> {
  await tx("readwrite", (store) => store.clear());
}

export function newMessage(partial: Omit<StoredMessage, "id" | "createdAt"> & { id?: string }): StoredMessage {
  return {
    id: partial.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: partial.role,
    content: partial.content,
    citations: partial.citations ?? [],
    createdAt: Date.now(),
    pending: partial.pending ?? false,
    error: partial.error ?? null,
    model: partial.model ?? null,
  };
}
