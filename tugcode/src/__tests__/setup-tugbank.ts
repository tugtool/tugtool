/**
 * Test-only preload that redirects `TugbankClient` to a throw-away
 * SQLite file for the duration of the test process.
 *
 * `tugbank-client.ts` resolves its database path in this order:
 * explicit `dbPath` → `process.env.TUGBANK_PATH` → `~/.tugbank.db`.
 * Without this preload, every `SessionManager` test that touches
 * `persistSessionId` / `readSessionId` (directly or via the
 * `system:init` routing path) writes mock session ids into the
 * developer's real tugbank — exactly how the bogus `"s-rl"` value
 * leaked during the T3.4.c 4f live smoke.
 *
 * The file is created fresh with the tugbank schema (`meta`,
 * `domains`, `entries`, plus the domain index). The schema mirrors
 * `tugrust/crates/tugbank-core/src/schema.rs::bootstrap_schema` —
 * keep the two in sync when schema evolves. The file is cleaned up
 * on process exit. Multiple simultaneous test processes are
 * insulated from each other by the time+random suffix.
 */
import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDbPath = join(
  tmpdir(),
  `tugcode-test-tugbank-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);

process.env.TUGBANK_PATH = tempDbPath;

// Bootstrap the schema so `TugbankClient.set()` has the `domains` and
// `entries` tables it expects. Mirrors the Rust bootstrap in
// `tugbank-core/src/schema.rs`.
{
  const db = new Database(tempDbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS domains (
      name        TEXT PRIMARY KEY,
      generation  INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS entries (
      domain       TEXT NOT NULL,
      key          TEXT NOT NULL,
      value_kind   INTEGER NOT NULL,
      value_i64    INTEGER,
      value_f64    REAL,
      value_text   TEXT,
      value_blob   BLOB,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (domain, key),
      FOREIGN KEY (domain) REFERENCES domains(name) ON DELETE CASCADE
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_entries_domain ON entries(domain);");
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');");
  db.close();
}

process.on("exit", () => {
  if (existsSync(tempDbPath)) {
    try {
      unlinkSync(tempDbPath);
    } catch {
      /* best-effort cleanup */
    }
  }
});
