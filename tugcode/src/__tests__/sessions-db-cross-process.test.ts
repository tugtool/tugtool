// Cross-process WAL verification for the SessionLedger.
//
// In production, tugcast (Rust, rusqlite) is the writer and tugcode (TS,
// bun:sqlite) is the reader on the same `sessions.db` file. This test
// pins the cross-process invariant by:
//
//   1. Bootstrapping schema + writing one row via bun:sqlite (one
//      process's view).
//   2. Inserting a second row via the `sqlite3` CLI subprocess (a
//      separate OS process — proves writes from outside bun:sqlite are
//      visible after bun:sqlite re-opens the file).
//   3. Re-opening the file via bun:sqlite **read-only** and asserting
//      both rows are visible.
//
// Run-first gate per tugplan-tide-mid-turn-replay step 4.6: if this test
// fails on any platform, the whole Step 4 architecture has to fall back
// to RPC-via-stdin (tugcast reads on tugcode's behalf) — a much larger
// redesign. Verifying here keeps the rest of 4.6 (the ledger-driven
// `runReplay`) on safe ground.
//
// Why sqlite3 CLI as the external writer rather than rusqlite directly:
// the CLI is the most portable external sqlite client available in
// `$PATH` on macOS/Linux dev machines, requires no Rust build step, and
// exercises the same underlying sqlite C library as rusqlite — so the
// cross-process WAL invariant it pins is the same one rusqlite would.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "tide-sessions-db-cross-"));
}

function bootstrapSchema(path: string): void {
  // Create schema + WAL via bun:sqlite. Mirrors the Rust-side
  // `bootstrap_schema` so the file shape matches what tugcast writes
  // in production. Writeable handle (so we can also seed the first
  // row); closed before the external CLI write.
  const db = new Database(path);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
          session_id        TEXT PRIMARY KEY,
          workspace_key     TEXT NOT NULL,
          project_dir       TEXT NOT NULL,
          created_at        INTEGER NOT NULL,
          last_used_at      INTEGER NOT NULL,
          turn_count        INTEGER NOT NULL DEFAULT 0,
          first_user_prompt TEXT,
          state             TEXT NOT NULL,
          card_id_live      TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_workspace_recent
          ON sessions(workspace_key, last_used_at DESC);
      CREATE TABLE IF NOT EXISTS turns (
          tug_turn_id        TEXT PRIMARY KEY,
          session_id         TEXT NOT NULL,
          ordinal            INTEGER NOT NULL,
          claude_message_id  TEXT,
          user_text          TEXT NOT NULL,
          user_attachments   BLOB NOT NULL,
          state              TEXT NOT NULL,
          partial_text       TEXT,
          created_at         INTEGER NOT NULL,
          completed_at       INTEGER
      );
      CREATE INDEX IF NOT EXISTS turns_session_ordinal
          ON turns(session_id, ordinal);
      CREATE TRIGGER IF NOT EXISTS turns_cascade_delete_on_session
      AFTER DELETE ON sessions
      FOR EACH ROW
      BEGIN
          DELETE FROM turns WHERE session_id = OLD.session_id;
      END;
      CREATE TABLE IF NOT EXISTS migrations (
          version    INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO migrations (version, applied_at) VALUES (2, 1000);
      INSERT INTO sessions (
          session_id, workspace_key, project_dir,
          created_at, last_used_at, turn_count,
          first_user_prompt, state, card_id_live
      ) VALUES ('sess-cross-proc', 'ws-1', '/proj',
                1000, 1000, 0, NULL, 'live', 'card-1');
      INSERT INTO turns (
          tug_turn_id, session_id, ordinal, claude_message_id,
          user_text, user_attachments, state, partial_text,
          created_at, completed_at
      ) VALUES ('tt-internal', 'sess-cross-proc', 0, NULL,
                'from bun:sqlite', X'5b5d', 'pending', NULL,
                1000, NULL);
    `);
  } finally {
    db.close();
  }
}

function insertRowViaSqlite3CLI(
  path: string,
  tugTurnId: string,
  userText: string,
  ordinal: number,
): void {
  // Run the system sqlite3 CLI as a separate OS process. The INSERT
  // here is the cross-process write that bun:sqlite must see when it
  // re-opens the file.
  const sql = `INSERT INTO turns (tug_turn_id, session_id, ordinal, claude_message_id, user_text, user_attachments, state, partial_text, created_at, completed_at) VALUES ('${tugTurnId}', 'sess-cross-proc', ${ordinal}, NULL, '${userText}', X'5b5d', 'pending', NULL, 2000, NULL);`;
  const result = spawnSync("/usr/bin/sqlite3", [path, sql], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `sqlite3 CLI exited with status=${result.status}, stderr=${result.stderr}`,
    );
  }
}

describe("cross-process WAL — bun:sqlite reads writes from external sqlite client", () => {
  test("read-only bun:sqlite sees rows written by sqlite3 CLI subprocess", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "sessions.db");
    try {
      // 1. Bootstrap schema + seed an internal row via bun:sqlite.
      bootstrapSchema(dbPath);
      expect(existsSync(dbPath)).toBe(true);

      // 2. Write a SECOND row from a separate OS process via sqlite3 CLI.
      insertRowViaSqlite3CLI(dbPath, "tt-external-1", "from sqlite3 CLI", 1);

      // 3. Open via bun:sqlite read-only. Both rows must be visible.
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db
          .query<
            { tug_turn_id: string; user_text: string; ordinal: number },
            [string]
          >(
            "SELECT tug_turn_id, user_text, ordinal FROM turns WHERE session_id = ? ORDER BY ordinal ASC",
          )
          .all("sess-cross-proc");
        expect(rows).toHaveLength(2);
        expect(rows[0].tug_turn_id).toBe("tt-internal");
        expect(rows[0].user_text).toBe("from bun:sqlite");
        expect(rows[0].ordinal).toBe(0);
        expect(rows[1].tug_turn_id).toBe("tt-external-1");
        expect(rows[1].user_text).toBe("from sqlite3 CLI");
        expect(rows[1].ordinal).toBe(1);
      } finally {
        db.close();
      }

      // 4. Write a THIRD row via sqlite3 CLI; re-open bun:sqlite; verify
      //    visibility on a fresh read-only handle. Pins the "writes
      //    happening between bun:sqlite opens are picked up" invariant.
      insertRowViaSqlite3CLI(dbPath, "tt-external-2", "second external write", 2);
      const db2 = new Database(dbPath, { readonly: true });
      try {
        const ids = db2
          .query<{ tug_turn_id: string }, [string]>(
            "SELECT tug_turn_id FROM turns WHERE session_id = ? ORDER BY ordinal ASC",
          )
          .all("sess-cross-proc")
          .map((r) => r.tug_turn_id);
        expect(ids).toEqual(["tt-internal", "tt-external-1", "tt-external-2"]);
      } finally {
        db2.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("read-only handle survives an external WAL-mode write while held open", () => {
    // Stronger invariant: `runReplay` opens the read-only handle once
    // at SessionManager construction and reuses it across every replay
    // call. If tugcast writes between two `runReplay` invocations, the
    // re-query must see the new data without reopening the connection.
    // bun:sqlite respects WAL semantics on read end-of-transaction
    // boundaries — each prepared-statement invocation begins a fresh
    // read transaction by default.
    const dir = makeTempDir();
    const dbPath = join(dir, "sessions.db");
    try {
      bootstrapSchema(dbPath);
      // Open the long-lived read-only handle (this mirrors the
      // production runReplay path where the handle outlives any single
      // turn).
      const reader = new Database(dbPath, { readonly: true });
      try {
        const initial = reader
          .query<
            { count: number },
            [string]
          >("SELECT COUNT(*) AS count FROM turns WHERE session_id = ?")
          .get("sess-cross-proc");
        expect(initial?.count).toBe(1);

        // External write happens while the reader handle is still open.
        insertRowViaSqlite3CLI(dbPath, "tt-mid-life", "added while reader open", 1);

        // Re-query on the same long-lived handle — the new row is visible.
        const after = reader
          .query<
            { tug_turn_id: string },
            [string]
          >(
            "SELECT tug_turn_id FROM turns WHERE session_id = ? ORDER BY ordinal ASC",
          )
          .all("sess-cross-proc")
          .map((r) => r.tug_turn_id);
        expect(after).toEqual(["tt-internal", "tt-mid-life"]);
      } finally {
        reader.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
