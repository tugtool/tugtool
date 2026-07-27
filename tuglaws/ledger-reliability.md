# Ledger Reliability

The doctrine for Tug's SQLite ledgers — the machine-global `changes.db` (attribution + drafts), the per-instance `sessions.db`, `shell_exchanges.db`, and `tugbank.db`. Written after the 2026-07-27 corruption incident, in which both machine-global databases ran structurally corrupt for days while writers silently failed, checkpoints silently stalled, and the Changes card reported damage as the innocent-looking "no session claims these".

## Laws

**[LR1] One way to open a ledger.** Every writable open goes through `tugcore::ledger_db::open` / `attach`, which applies the one true pragma set (WAL, `busy_timeout=5000`, `synchronous=NORMAL`, `cell_size_check=ON`). No ad-hoc `Connection::open(` exists in production source — the `no_ad_hoc_ledger_opens` test in `tugcore/src/ledger_db.rs` scans the workspace and fails the build on one. Read-only opens use `open_with_flags(READ_ONLY)`.

**[LR2] No foreign SQLite touches a live ledger.** Apple's `sqlite3` CLI (or any non-Tug build) must never open the live files — a foreign build participating in WAL recovery, shm management, or close-time checkpointing is a corruption vector. Humans and agents inspect with `just db-inspect <name|path> ["SQL"]`, which copies db+WAL/shm to a temp dir first.

**[LR3] Never write into a known-corrupt database.** Every on-disk ledger open runs `PRAGMA quick_check` first (`tugcast/src/ledger_integrity.rs`). A failing database is quarantined — renamed with its WAL/shm siblings to `<name>.corrupt-<epoch-ms>`, kept for forensics — and a fresh database is built in its place: bootstrap → salvage readable rows from the quarantined file → replay the journal. Writers never compound damage.

**[LR4] Corruption is loud, and the UI never lies about it.** Any statement failing with `SQLITE_CORRUPT`/`SQLITE_NOTADB` latches the process-global degraded flag (`ledger_integrity::health`), error-logs once per ledger, and rides outbound `CHANGESET_ALL` frames as `ledger_degraded`. The deck renders "attribution ledger damaged — claims unavailable", never an empty result. `cell_size_check=ON` turns silent page damage into an immediate statement error; the checkpoint watchdog (5-minute passive checkpoints in tugcast's maintenance task) alarms when a WAL grows without being applied — the incident's three-day-silent signature.

**[LR5] An instance never reshapes the shared schema on its own.** The shared `changes.db` schema is governed by `PRAGMA changes.user_version` (`CHANGES_SCHEMA_VERSION` in `session_ledger.rs`). A build seeing a *newer* on-disk version refuses row INSERT/UPDATEs to the shared tables entirely (deletes, which are shape-safe, stay allowed). A schema change requires bumping the constant **and** registering a human-reviewed migration in `CHANGES_MIGRATIONS` — the drop-and-recreate "self-healing" pattern is banned for shared tables (it let any stray build destroy the machine-global truth; per-instance rebuildable caches like `turn_telemetry` may keep it). Corollary: any table-shape probe or `DROP TABLE` against a connection with attached databases must be schema-qualified (`main.…`) — an unqualified name resolves into an attached database when the local table is absent.

**[LR6] The journal is the durable truth; SQLite is the index.** Every shared-table mutation is appended (fsync'd, one JSON line) to `changes.db.journal.jsonl` (`tugcast/src/changes_journal.rs`) after it lands: inserts (only when they actually landed — replays are not re-journaled), session-eviction deletes, ownership severing, canonicalization rewrites, draft upserts and deletes. Post-quarantine rebuild replays it; all records are idempotent. `VACUUM INTO` snapshots (5 retained, on startup + every 6 h, in `backups/` beside each db) cover history from before the journal existed.

**[LR7] Short-lived CLIs don't write shared ledgers.** `tugutil draft set|clear` posts to the running tugcast's `/api/draft`; the CLI opens the changes ledger read-only, and writes locally only under `TUG_CHANGES_DB` test isolation. Every write path funnels through the long-lived server: one writer surface, one journal, one pragma set.

## Recovery runbook

1. Corruption is announced by [LR4] (log line, telemetry, deck banner) — or found via `just db-inspect <db> "PRAGMA integrity_check;"`.
2. Restart the instance: the [LR3] gate quarantines, salvages, and replays the journal automatically. Nothing else is usually required.
3. If the automatic rebuild is suspected short (pre-journal history), recover from the newest `backups/` snapshot: verify it (`quick_check`), then re-apply the journal on top.
4. Keep the quarantined `<name>.corrupt-*` files; they are the forensic record.

## Pending extensions

- **Single-writer ownership for `changes.db`** — design at `roadmap/ledger-single-writer-plan.md`; removes multi-process WAL writes to the shared ledger entirely.
- **Graceful termination protocol** — design at `roadmap/graceful-termination-plan.md`; retires SIGKILL-first process management so ledgers always close cleanly.
