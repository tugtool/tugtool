/**
 * `dev-card-restore-gate` — the pure predicate behind the Dev card's
 * cold-restore reveal gate.
 *
 * On a cold relaunch a tide card with a persisted session walks
 * pre-services → transport-restoring → replay preflight →
 * `phase === "replaying"` → `replay_complete`. Painting the card body
 * through that walk flickers six distinct states past the user. The
 * gate collapses them: while `deriveColdRestoreActive` is true the
 * card shows the single `DevRestoring` placeholder; once it is false
 * the body mounts exactly once, against a fully-reconstructed
 * transcript, and reveals in one paint.
 *
 * `deriveColdRestoreActive` is the *snapshot-derivable* half of the
 * gate. The `DevCardServicesGate` component ANDs in a one-shot
 * `revealed` latch so that, once the body has mounted, a later
 * `phase === "replaying"` (a mid-session transport reconnect) does
 * NOT route back to the placeholder — that path stays on [DT10]'s
 * in-body transcript-paint gate, body mounted. This module owns only
 * the pure, testable part; the latch is component state.
 *
 * Pure module — no DOM, no React, no time source.
 *
 * @module components/tugways/cards/dev-card-restore-gate
 */

import type { CodeSessionSnapshot } from "@/lib/code-session-store";

/**
 * The matrix-relevant subset of `CodeSessionSnapshot` the gate reads.
 * The full snapshot structurally satisfies this — declaring the narrow
 * shape keeps the dependency surface explicit and lets a pure test
 * supply a literal without fabricating the snapshot's unrelated fields.
 */
export interface ColdRestoreSignals {
  phase: CodeSessionSnapshot["phase"];
  sessionMode: CodeSessionSnapshot["sessionMode"];
  replayPreflightActive: boolean;
  lastError: CodeSessionSnapshot["lastError"];
}

/**
 * True while a cold restore's replay window is still in progress —
 * the window the `DevRestoring` placeholder holds across.
 *
 * It spans the cold-boot preflight beat (`replayPreflightActive`,
 * opened by `notifyResumeBindingLanded` and cleared by the first
 * `replay_started` / outcome / 12s tick) and the `phase === "replaying"`
 * window that follows, gated to `sessionMode === "resume"` so a fresh
 * new-mode binding's brief JSONL-missing round-trip is not gated.
 *
 * A non-null `lastError` forces the predicate false: any error must
 * mount the body so its error banner shows and `useDevCardObserver`
 * can route a `resume_failed` back to the picker — the placeholder
 * never swallows a failure.
 */
export function deriveColdRestoreActive(s: ColdRestoreSignals): boolean {
  if (s.lastError !== null) return false;
  if (s.replayPreflightActive) return true;
  return s.phase === "replaying" && s.sessionMode === "resume";
}
