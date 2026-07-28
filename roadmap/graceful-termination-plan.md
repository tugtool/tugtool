# Graceful termination protocol — design brief

Status: SHIPPED 2026-07-27. The doctrine now lives in [LR9] (tuglaws/ledger-reliability.md) and the numbers in `tugcore::quiesce`; this file is the design record. Grounds in [LR3]/[LR4]: ledgers should close cleanly, and force-kill is the last rung of a ladder, never the first move.

## Where termination stands today (surveyed 2026-07-27)

Most of the tree already escalates rather than SIGKILLing first — but each site implements its own ladder with its own grace period, and none of them gives services a chance to flush ledgers/checkpoint WALs beyond whatever their signal handler happens to do:

- `tugapp/Sources/ProcessManager.swift` — SIGTERM to the process group, polls for drain, SIGKILL leftovers after a deadline. The host-side reference implementation.
- `tugrust/crates/tugcast/src/main.rs` — SIGTERM handler + parent-death watch; shuts the claude children down and exits. Also a cross-instance guard that SIGKILLs a *stale same-instance* tugcast (`main.rs:1846`) — kill-first, no TERM rung.
- `tugrust/crates/tugcast/src/feeds/shell.rs` — SIGTERM→grace→SIGKILL for wedged shell process groups (fine as-is: those are arbitrary user commands, not Tug services).
- `tugcode/src/session.ts` — SIGINT→grace→SIGKILL for the claude subprocess (fine as-is: claude is external).
- `tests/app-test/_harness/index.ts` — SIGTERM→5 s→SIGKILL for the app under test, plus a SIGKILL fallback teardown; the wedge-recovery ladder ([L23] work) has its own escalation.

## The protocol

One unified shutdown contract, `tug-quiesce`, that every **Tug service** (tugcast, tugcode, tugpulse; Tug.app as conductor) implements:

1. **Quiesce request** — the parent asks the child to stop: for processes with a control channel (tugcode stdin IPC, tugcast control socket) an explicit `shutdown` message; for everything else SIGTERM. The two are equivalent: the signal handler funnels into the same shutdown path as the message.
2. **Flush window** — on quiesce, a service: stops accepting new work, flushes ledgers (final `wal_checkpoint(TRUNCATE)` on sessions/changes/shell/tugbank connections), fsyncs journals, closes SQLite connections, then exits 0. Budget: 2 s per service, enforced by the service itself (exit anyway when the budget runs out — a hung flush must not wedge shutdown).
3. **Escalation** — the conductor waits `deadline = 4 s` for the group to drain, then SIGKILLs the remainder and logs *which* PIDs needed it (a SIGKILL that actually fires is a defect signal, tracked in telemetry, not routine).

Shared constants live in `tugcore` (Rust) and are mirrored in `InstanceConfig.swift` and the harness — one place to tune the ladder, not five.

## Steps (all shipped)

1. tugcast: `SessionLedger::final_flush` — `wal_checkpoint(TRUNCATE)` on both databases — runs on the SIGTERM path before exit, so the next open (possibly by a different build) starts WAL-less instead of running recovery. Owner-only for the shared database, per [LR8].
2. tugcode: every route out of the process (SIGTERM, SIGHUP, stdin EOF, a fatal main-loop error) funnels into one `quiesce()` that ends claude, closes the sessions.db handle, and — the part a bare `process.exit` skipped — drains the serialized stdout queue, so the last frames reach tugcast instead of dying in a half-written pipe. Bounded by `QUIESCE_FLUSH_BUDGET_MS`, which tugcode enforces on itself: budget expired means exit anyway, loudly. `SessionManager.shutdown({graceMs})` threads the budget down to claude's EOF wait, which used to be a flat 5 s — longer than the conductor's whole deadline, and the reason tugcode got SIGKILLed at all.
3. tugcast's stale-instance reclaim (`reclaim_stale_process`) is now SIGTERM → poll → SIGKILL on `STALE_RECLAIM_GRACE_MS`, not kill-first. The Swift side's port-orphan reclaim got the same ladder (it was a 200 ms token wait).
4. The harness teardown waits `QUIESCE_TEARDOWN_DEADLINE_MS` (8 s) instead of a hard-coded 5 s, and `at0282-quiesce-no-sigkill` is the canary: launch, quit through the real `applicationShouldTerminate` path, then assert the app's own report lists zero SIGKILLs.
5. Telemetry: `ProcessManager` records every escalation it fires and writes `quiesce-report.json` into the instance data dir at the end of each `stop()` — `{at, drainDeadlineMs, sigkills[]}`. Steady state is an empty `sigkills`; anything in it names the PID and how long it was given.

## Constants

`tugcore::quiesce` is the source of truth: `FLUSH_BUDGET_MS` 2 s (per service, self-enforced), `DRAIN_DEADLINE_MS` 4 s (conductor waits), `STALE_RECLAIM_GRACE_MS` 1 s, `TEARDOWN_DEADLINE_MS` 8 s (outer supervisor). Swift mirrors them in `InstanceConfig`, TypeScript in the harness and `tugcode/src/main.ts`; `quiesce_constants_are_mirrored` reads those exact lines and fails the Rust build when a mirror drifts.

## Non-goals

Arbitrary user processes (shell commands, claude itself) keep their existing TERM/INT→KILL ladders — the protocol governs Tug's own services, whose exit path owns ledger state.
