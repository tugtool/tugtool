# Single-writer ownership for changes.db — design brief

Status: DESIGN — implementation not started. Grounds in [LR1]–[LR7] (tuglaws/ledger-reliability.md) and [D112] (one machine-global changes ledger).

## Problem

`changes.db` is written by every tugcast instance on the machine (Release app, Debug app, dash-worktree builds) plus, until recently, short-lived CLIs. Multi-process WAL writing is legal SQLite, and after the 2026-07 hardening every writer is the same bundled build behind one chokepoint — but the 2026-07-27 incident showed the blast radius when *anything* violates the WAL invariants on a shared file. Reducing the shared ledger to exactly one writing process makes the entire class of cross-process lock/shm hazards structurally impossible, instead of merely guarded against.

## Design

**Ownership claim.** One tugcast instance owns writes at a time. The claim is an exclusive advisory lock (`flock(LOCK_EX | LOCK_NB)`) on a dedicated lockfile `changes.db.writer-lock` beside the database, held for the owner's lifetime. `flock` releases automatically on process death — no stale-lock protocol, no PID scanning. The owner records `{instance_id, pid, port}` as the lockfile's content for diagnostics only.

**Non-owner behavior.** An instance that fails the claim opens the changes attach **read-only** and forwards every would-be mutation to the owner over HTTP: `POST /api/changes-write` on the owner's port (discovered from the lockfile content, verified via the registry), body = one `changes_journal::Record` — the exact enum the journal already serializes, so the wire format, the durable format, and the replay applier are the same code. The owner applies it through the normal ledger path (journal + SQL). Loopback-only, like every tugcast API.

**Failover.** Forward failure (owner died, port gone) → retry the claim; on success, reopen the attach read-write and drain a small in-memory pending queue (bounded, e.g. 256 records; overflow logs and drops with a telemetry alarm — the JSONL side of attribution capture is unaffected). The checkpoint watchdog runs only in the owner.

**Why HTTP and not a shared queue file:** the port + registry machinery exists, the payload is already a serde enum, and a request/response gives the caller a durable-ack (the owner journals before responding 200).

## Steps

1. `tugcore::ledger_db::claim_writer(path) -> Option<WriterLock>` (flock wrapper; drop releases).
2. tugcast open path: claim → attach RW as today; no claim → attach RO, construct a `ChangesForwarder` (owner port from lockfile + registry cross-check).
3. `POST /api/changes-write` handler: deserialize `Record`, apply via the existing `apply_journal_record` + journal append; 200 after fsync.
4. `SessionLedger` mutation methods: when in forwarding mode, send instead of executing locally (the guard mirrors `guard_changes_write`).
5. Owner-exit takeover: forwarding failure triggers re-claim with jittered retry; integration test = two ledgers on one changes path, kill the owner, assert the survivor takes over and no records are lost below the queue bound.

## Open questions for review

- Should the *Release app* instance be preferred as owner (steal the claim on launch) so the long-lived production process serves dash-build bursts, or is first-come ownership enough? (Proposal: first-come; simplicity wins, flock has no fairness problem at n≤3.)
- Draft-engine writes originate in every instance; forwarding them is covered by the same path, but the draft engine's fingerprint regeneration loop should probably run only in the owner to avoid duplicate scribe work. Decide when implementing.
