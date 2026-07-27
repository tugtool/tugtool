# Graceful termination protocol — design brief

Status: DESIGN — implementation not started. Grounds in [LR3]/[LR4] (tuglaws/ledger-reliability.md): ledgers should close cleanly, and force-kill is the last rung of a ladder, never the first move.

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

## Steps

1. tugcast: add the final-checkpoint/close flush to the existing SIGTERM path (today it kills children and exits; it should also checkpoint + close the ledgers). This is the highest-value single change and is self-contained.
2. tugcode: on `shutdown`/SIGTERM, after claude exits, flush any pending JSONL/IPC buffers before `process.exit`.
3. `main.rs:1846` stale-instance guard: TERM → 1 s → KILL instead of KILL-first.
4. Harness: raise the app-under-test teardown to the shared deadline and assert (in one canary test) that a normal run tears down with zero SIGKILLs fired.
5. Telemetry: count SIGKILL escalations per shutdown in the dev log; the target steady-state is zero.

## Non-goals

Arbitrary user processes (shell commands, claude itself) keep their existing TERM/INT→KILL ladders — the protocol governs Tug's own services, whose exit path owns ledger state.
