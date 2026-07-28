# Single-writer ownership for changes.db — design brief

Status: SHIPPED 2026-07-27 (decisions D1/D2 locked the same day). The doctrine now lives in [LR8] (tuglaws/ledger-reliability.md); this file is the design record. Grounds in [LR1]–[LR7] and [D112] (one machine-global changes ledger).

## Problem

`changes.db` is written by every tugcast instance on the machine (Release app, Debug app, dash-worktree builds) plus, until recently, short-lived CLIs. Multi-process WAL writing is legal SQLite, and after the 2026-07 hardening every writer is the same bundled build behind one chokepoint — but the 2026-07-27 incident showed the blast radius when *anything* violates the WAL invariants on a shared file. Reducing the shared ledger to exactly one writing process makes the entire class of cross-process lock/shm hazards structurally impossible, instead of merely guarded against.

## Design

**Ownership claim.** One tugcast instance owns writes at a time. The claim is an exclusive advisory lock (`flock(LOCK_EX | LOCK_NB)`) on a dedicated lockfile `changes.db.writer-lock` beside the database, held for the owner's lifetime. `flock` releases automatically on process death — no stale-lock protocol, no PID scanning. The owner records `{instance_id, pid, port}` as the lockfile's content for diagnostics only.

**Non-owner behavior.** An instance that fails the claim opens the changes attach **read-only** and forwards every would-be mutation to the owner over HTTP: `POST /api/changes-write` on the owner's port (discovered from the lockfile content, verified via the registry), body = one `changes_journal::Record` — the exact enum the journal already serializes, so the wire format, the durable format, and the replay applier are the same code. The owner applies it through the normal ledger path (journal + SQL). Loopback-only, like every tugcast API.

**Failover.** Forward failure (owner died, port gone) → retry the claim; on success, reopen the attach read-write and drain a small in-memory pending queue (bounded, e.g. 256 records; overflow logs and drops with a telemetry alarm — the JSONL side of attribution capture is unaffected). The checkpoint watchdog runs only in the owner.

**Why HTTP and not a shared queue file:** the port + registry machinery exists, the payload is already a serde enum, and a request/response gives the caller a durable-ack (the owner journals before responding 200).

## Steps (all shipped)

1. `tugcore::ledger_db::claim_writer(path, owner) -> Option<WriterLock>` (flock wrapper; drop releases; publishes `{instance_id, pid, port}` for routing).
2. tugcast open path: claim → attach RW as today; no claim → `attach_read_only` + a `ChangesForwarder` (owner port from lockfile, cross-checked against the registry). Owner-only duties moved behind the claim: the integrity gate, schema bootstrap and migrations, journaling, checkpoint health, `final_flush`, and snapshot backups.
3. `POST /api/changes-write`: deserialize `Record`, apply via the existing `apply_journal_record` + journal append, answer `{status, applied}` — a durable ack.
4. `SessionLedger` mutations funnel through `write_change`, which applies locally when owned and forwards otherwise. Session eviction is the one split case: the attribution cascade runs inside the eviction transaction for the owner, and is forwarded after the commit by a non-owner (whose attach cannot write).
5. Takeover: a failed forward re-claims (jittered floor between attempts), drains the bounded queue, and continues locally; the maintenance tick nudges the same path so an idle instance recovers too. Pinned by `a_non_owner_forwards_its_writes_and_takes_over_when_the_owner_exits` — two ledgers on one changes database over a real loopback endpoint, asserting the forward lands, the read-only attach refuses a direct write, an undeliverable record is held, and the takeover drains it with nothing lost.

## Decisions (locked 2026-07-27)

- **D1 — Ownership is first-come via flock.** No Release-app preference, no cooperative handoff protocol. Takeover on owner exit rides the same re-claim retry path as crash recovery; the rare sub-second takeover blip (and a Debug build occasionally owning writes while Release forwards) is accepted in exchange for having exactly one ownership mechanism.
- **D2 — Draft-engine regeneration stays per-instance; only its writes forward.** Each instance regenerates drafts for its own open projects (an owner-only loop would leave projects open solely in a non-owner instance draft-stale). Its writes travel the same forwarding route as attribution.
  - The decision's second half — a pre-scribe fingerprint re-read to suppress duplicate scribe calls — was **not** implemented, because the premise no longer holds: draft generation is on-demand only (`spawn_on_demand_draft` is reached solely from an explicit `changeset_draft_request`), so there is no background regeneration loop for two instances to duplicate. Two scribe runs happen only when a human asks in both instances, and suppressing that would contradict [P02] (an explicit request regenerates unconditionally, pinned by `on_demand_regenerates_ignoring_fingerprint`). Revisit if an idle regeneration loop is ever reintroduced.
