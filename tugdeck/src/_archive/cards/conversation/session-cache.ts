/**
 * Session cache using IndexedDB for conversation persistence
 */

import type { ContentBlock } from "./types";

export interface StoredMessage {
  msg_id: string;
  seq: number;
  rev: number;
  status: "partial" | "complete" | "cancelled";
  role: "user" | "assistant";
  text: string;
  blocks?: ContentBlock[];
}

export interface ReconcileResult {
  keep: StoredMessage[]; // Messages unchanged
  update: Array<{ old: StoredMessage; new: StoredMessage }>; // Messages changed
  insert: Array<{ message: StoredMessage; position: number }>; // New messages
  remove: StoredMessage[]; // Messages to delete
}

export class SessionCache {
  private dbName: string;
  private db: IDBDatabase | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMessages: StoredMessage[] | null = null;

  constructor(projectHash: string = "default") {
    this.dbName = `tugdeck-${projectHash}`;
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create messages object store if it doesn't exist
        if (!db.objectStoreNames.contains("messages")) {
          const store = db.createObjectStore("messages", { keyPath: "msg_id" });
          store.createIndex("seq", "seq", { unique: false });
        }
      };
    });
  }

  /**
   * Write messages to IndexedDB (debounced 1 second)
   */
  writeMessages(messages: StoredMessage[]): void {
    // Clear existing timer
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    // Store messages for debounced write
    this.pendingMessages = messages;

    // Schedule write in 1 second
    this.writeTimer = setTimeout(() => {
      this.flushWrites().catch((error) => {
        console.error("Failed to write messages to cache:", error);
      });
    }, 1000);
  }

  private async flushWrites(): Promise<void> {
    if (!this.pendingMessages) return;

    const messages = this.pendingMessages;
    this.pendingMessages = null;
    this.writeTimer = null;

    const db = await this.openDB();
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");

    // Clear store first
    store.clear();

    // Write all messages
    for (const msg of messages) {
      store.add(msg);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Read all messages ordered by seq
   */
  async readMessages(): Promise<StoredMessage[]> {
    const db = await this.openDB();
    const tx = db.transaction("messages", "readonly");
    const store = tx.objectStore("messages");
    const index = store.index("seq");

    return new Promise((resolve, reject) => {
      const request = index.openCursor();
      const messages: StoredMessage[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          messages.push(cursor.value);
          cursor.continue();
        } else {
          resolve(messages);
        }
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Reconcile authoritative messages with cached messages
   * Returns a diff result for minimal DOM updates
   */
  reconcile(authoritative: StoredMessage[], cached: StoredMessage[]): ReconcileResult {
    const result: ReconcileResult = {
      keep: [],
      update: [],
      insert: [],
      remove: [],
    };

    // Build maps for efficient lookup
    const authMap = new Map<string, StoredMessage>();
    const cachedMap = new Map<string, StoredMessage>();

    for (const msg of authoritative) {
      authMap.set(msg.msg_id, msg);
    }

    for (const msg of cached) {
      cachedMap.set(msg.msg_id, msg);
    }

    // Walk authoritative list in seq order
    const sortedAuth = [...authoritative].sort((a, b) => a.seq - b.seq);

    for (let i = 0; i < sortedAuth.length; i++) {
      const authMsg = sortedAuth[i];
      const cachedMsg = cachedMap.get(authMsg.msg_id);

      if (cachedMsg) {
        // Message exists in cache
        if (this.messagesEqual(authMsg, cachedMsg)) {
          result.keep.push(authMsg);
        } else {
          result.update.push({ old: cachedMsg, new: authMsg });
        }
      } else {
        // New message not in cache
        result.insert.push({ message: authMsg, position: i });
      }
    }

    // Find removed messages (in cache but not in authoritative)
    for (const cachedMsg of cached) {
      if (!authMap.has(cachedMsg.msg_id)) {
        result.remove.push(cachedMsg);
      }
    }

    return result;
  }

  private messagesEqual(a: StoredMessage, b: StoredMessage): boolean {
    return (
      a.msg_id === b.msg_id &&
      a.seq === b.seq &&
      a.rev === b.rev &&
      a.status === b.status &&
      a.text === b.text
    );
  }

  /**
   * Clear all conversation history
   */
  async clearHistory(): Promise<void> {
    // Close database connection first
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    // Delete the database
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn("Database deletion blocked - waiting for connections to close");
      };
    });
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
