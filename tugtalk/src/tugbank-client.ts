// Direct bun:sqlite client for the tugbank defaults store.
// Replaces Bun.spawnSync(['tugbank', ...]) calls with in-process SQLite access.

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Value kind discriminators (must match tugbank-core/src/value.rs) ─────────

const KIND_NULL = 0;
const KIND_BOOL = 1;
const KIND_I64 = 2;
const KIND_F64 = 3;
const KIND_STRING = 4;
const KIND_BYTES = 5;
const KIND_JSON = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

export type TugbankValue = boolean | number | string | object | Buffer | null;

interface EntryRow {
  value_kind: number;
  value_i64: number | null;
  value_f64: number | null;
  value_text: string | null;
  value_blob: Buffer | null;
}

interface DomainEntryRow extends EntryRow {
  key: string;
}

// ── Value decode/encode ───────────────────────────────────────────────────────

function decodeValue(row: EntryRow): TugbankValue {
  switch (row.value_kind) {
    case KIND_NULL:
      return null;
    case KIND_BOOL:
      return (row.value_i64 ?? 0) !== 0;
    case KIND_I64:
      return row.value_i64 ?? 0;
    case KIND_F64:
      return row.value_f64 ?? 0;
    case KIND_STRING:
      return row.value_text ?? "";
    case KIND_BYTES:
      return row.value_blob ?? Buffer.alloc(0);
    case KIND_JSON:
      return JSON.parse(row.value_text ?? "null") as object;
    default:
      throw new Error(`Unknown value_kind: ${row.value_kind}`);
  }
}

interface EncodedValue {
  kind: number;
  i64: number | null;
  f64: number | null;
  text: string | null;
  blob: Buffer | null;
}

function encodeValue(value: TugbankValue): EncodedValue {
  if (value === null) {
    return { kind: KIND_NULL, i64: null, f64: null, text: null, blob: null };
  }
  if (typeof value === "boolean") {
    return { kind: KIND_BOOL, i64: value ? 1 : 0, f64: null, text: null, blob: null };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { kind: KIND_I64, i64: value, f64: null, text: null, blob: null };
    }
    return { kind: KIND_F64, i64: null, f64: value, text: null, blob: null };
  }
  if (typeof value === "string") {
    return { kind: KIND_STRING, i64: null, f64: null, text: value, blob: null };
  }
  if (Buffer.isBuffer(value)) {
    return { kind: KIND_BYTES, i64: null, f64: null, text: null, blob: value };
  }
  // object — treat as JSON
  return { kind: KIND_JSON, i64: null, f64: null, text: JSON.stringify(value), blob: null };
}

function nowRfc3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ── TugbankClient ─────────────────────────────────────────────────────────────

/**
 * Direct bun:sqlite client for the tugbank defaults store at ~/.tugbank.db.
 *
 * Provides get/set/readDomain/listDomains with an in-memory domain cache.
 * The cache is invalidated by polling PRAGMA data_version every 500 ms so
 * changes written by other processes (e.g. the tugbank CLI) are picked up
 * automatically.
 *
 * Call close() to release the database connection and stop the poll timer.
 */
export class TugbankClient {
  private readonly db: Database;
  private readonly domainCache = new Map<string, Record<string, TugbankValue>>();
  private lastDataVersion: number = -1;
  private readonly pollTimer: ReturnType<typeof setInterval>;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(homedir(), ".tugbank.db");
    this.db = new Database(path, { create: true });

    // Match the pragmas applied by tugbank-core on every open.
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run("PRAGMA synchronous = NORMAL");

    // Initialise our baseline data_version.
    this.lastDataVersion = this.readDataVersion();

    // Poll for external changes every 500 ms.
    this.pollTimer = setInterval(() => {
      this.checkForChanges();
    }, 500);

    // Don't let the timer prevent process exit.
    if (this.pollTimer.unref) {
      this.pollTimer.unref();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Read a single key from a domain.
   * Returns null if the key does not exist.
   */
  get(domain: string, key: string): TugbankValue {
    const stmt = this.db.prepare<EntryRow, [string, string]>(
      `SELECT value_kind, value_i64, value_f64, value_text, value_blob
       FROM entries WHERE domain = ? AND key = ?`
    );
    const row = stmt.get(domain, key);
    if (!row) return null;
    return decodeValue(row);
  }

  /**
   * Write a single key/value pair to a domain.
   * Creates the domain row if it does not exist and bumps the generation.
   */
  set(domain: string, key: string, value: TugbankValue): void {
    const enc = encodeValue(value);
    const now = nowRfc3339();

    this.db.transaction(() => {
      // Ensure domain row exists.
      this.db.run(
        `INSERT OR IGNORE INTO domains (name, generation, updated_at) VALUES (?, 0, ?)`,
        [domain, now]
      );
      // Upsert the entry.
      this.db.run(
        `INSERT INTO entries
           (domain, key, value_kind, value_i64, value_f64, value_text, value_blob, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(domain, key) DO UPDATE SET
           value_kind = excluded.value_kind,
           value_i64  = excluded.value_i64,
           value_f64  = excluded.value_f64,
           value_text = excluded.value_text,
           value_blob = excluded.value_blob,
           updated_at = excluded.updated_at`,
        [domain, key, enc.kind, enc.i64, enc.f64, enc.text, enc.blob, now]
      );
      // Bump generation.
      this.db.run(
        `UPDATE domains SET generation = generation + 1, updated_at = ? WHERE name = ?`,
        [now, domain]
      );
    })();

    // Invalidate cache for this domain.
    this.domainCache.delete(domain);
  }

  /**
   * Read all key/value pairs for a domain as a plain object.
   * Returns a cached snapshot; cache is refreshed when data_version changes.
   */
  readDomain(domain: string): Record<string, TugbankValue> {
    const cached = this.domainCache.get(domain);
    if (cached) return cached;

    const rows = this.db
      .prepare<DomainEntryRow, [string]>(
        `SELECT key, value_kind, value_i64, value_f64, value_text, value_blob
         FROM entries WHERE domain = ?`
      )
      .all(domain);

    const result: Record<string, TugbankValue> = {};
    for (const row of rows) {
      result[row.key] = decodeValue(row);
    }

    this.domainCache.set(domain, result);
    return result;
  }

  /**
   * List all domain names that have at least one entry.
   */
  listDomains(): string[] {
    const rows = this.db
      .prepare<{ name: string }, []>(`SELECT name FROM domains ORDER BY name`)
      .all();
    return rows.map((r) => r.name);
  }

  /**
   * Release the database connection and stop the poll timer.
   */
  close(): void {
    clearInterval(this.pollTimer);
    this.db.close();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private readDataVersion(): number {
    const row = this.db.prepare<{ data_version: number }, []>("PRAGMA data_version").get();
    return row?.data_version ?? 0;
  }

  private checkForChanges(): void {
    try {
      const current = this.readDataVersion();
      if (current !== this.lastDataVersion) {
        this.lastDataVersion = current;
        this.domainCache.clear();
      }
    } catch {
      // Ignore errors during poll (db may be closing).
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/**
 * Module-level singleton TugbankClient.
 *
 * Created lazily on first access so that importing this module in test
 * environments that don't have ~/.tugbank.db doesn't immediately fail.
 */
let _client: TugbankClient | null = null;

export function getTugbankClient(): TugbankClient {
  if (!_client) {
    _client = new TugbankClient();
  }
  return _client;
}
