/**
 * use-landing-receipts — landing receipts as transcript ink ([P09], Spec S04).
 *
 * One subscription over the app-level changeset verb store per Session card:
 * when a commit, join, or release round-trip for this card's project
 * resolves successfully, append a non-context receipt row to the transcript
 * through the shell-exchange ink mechanism ([D111] — the row records what
 * the user did, never what Claude knows; it is not session context).
 * Initiator-agnostic: the `/commit`//`/join` verbs and the shade's own
 * buttons all resolve through the same store, so every landing leaves ink.
 *
 * Dash facts (name, rounds, dirt) are captured while the round-trip is
 * pending — the entry drops from the snapshot once the landing recomputes,
 * so the receipt names what was true at dispatch.
 *
 * Laws: [L22] store→store wiring observes the verb store's own
 * subscription directly (no useSyncExternalStore → useEffect round-trip).
 *
 * @module components/tugways/cards/use-landing-receipts
 */

import { useEffect } from "react";

import {
  getChangesetVerbStore,
  type CommitPhase,
  type JoinPhase,
  type ReleasePhase,
} from "@/lib/changeset-verb-store";
import {
  formatCommitReceiptInk,
  formatJoinReceiptInk,
  formatReleaseReceiptInk,
  type ReceiptInk,
} from "@/lib/landing-receipt";
import type { ChangesRouteController } from "@/lib/changes-route-controller";
import type { CodeSessionStore } from "@/lib/code-session-store";

interface DashFacts {
  name: string;
  rounds: number;
  dirty: boolean;
}

export function useLandingReceipts(
  codeSessionStore: CodeSessionStore,
  changesController: ChangesRouteController,
): void {
  useEffect(() => {
    const verbStore = getChangesetVerbStore();
    if (verbStore === null) return;
    const commitKey = changesController.entryKey;
    let prevCommit: CommitPhase = verbStore.commitState(commitKey).phase;
    const prevJoin = new Map<string, JoinPhase>();
    const prevRelease = new Map<string, ReleasePhase>();
    const pendingFacts = new Map<string, DashFacts>();

    const append = (ink: ReceiptInk): void => {
      const now = Date.now();
      codeSessionStore.ingestShellExchange({
        phase: "complete",
        exchangeId: `landing-${now}-${Math.random().toString(36).slice(2, 8)}`,
        command: ink.command,
        output: ink.output,
        exitCode: 0,
        cwd: changesController.projectDir,
        cwdAfter: null,
        startedAtMs: now,
        settledAtMs: now,
      });
    };

    const onChange = (): void => {
      const snap = changesController.getSnapshot();

      // Commit: idle/pending → done appends the receipt once.
      const commit = verbStore.commitState(commitKey);
      if (commit.phase === "done" && prevCommit !== "done") {
        append(
          formatCommitReceiptInk({
            sha: commit.sha ?? "",
            message:
              changesController.lastCommitMessage() ??
              snap.project.head_message,
            numstatReceipt: commit.receipt ?? "",
          }),
        );
      }
      prevCommit = commit.phase;

      // Joins / releases, keyed per dash entry. Capture the dash facts while
      // pending; the entry is gone from the snapshot by the time `done`
      // lands.
      for (const dash of snap.dashes) {
        const key = `dash:${snap.project.project_dir}:${dash.owner_id}`;
        if (!pendingFacts.has(key)) {
          pendingFacts.set(key, {
            name: dash.display_name,
            rounds: dash.rounds,
            dirty: dash.worktree_dirty,
          });
        } else if (
          verbStore.joinState(key).phase !== "pending" &&
          verbStore.releaseState(key).phase !== "pending"
        ) {
          // Quiet dash: keep the facts fresh for the next round-trip.
          pendingFacts.set(key, {
            name: dash.display_name,
            rounds: dash.rounds,
            dirty: dash.worktree_dirty,
          });
        }
      }
      for (const [key, facts] of pendingFacts) {
        const join = verbStore.joinState(key);
        const prevJoinPhase = prevJoin.get(key) ?? "idle";
        if (join.phase === "done" && prevJoinPhase !== "done") {
          append(
            formatJoinReceiptInk({
              commitHash: join.commitHash,
              dashName: facts.name,
              rounds: facts.rounds,
            }),
          );
        }
        prevJoin.set(key, join.phase);

        // Release has no `done` phase: a pending → idle transition is the
        // success signal (pending → error is the failure).
        const release = verbStore.releaseState(key);
        const prevReleasePhase = prevRelease.get(key) ?? "idle";
        if (release.phase === "idle" && prevReleasePhase === "pending") {
          append(
            formatReleaseReceiptInk({
              dashName: facts.name,
              rounds: facts.rounds,
              dirty: facts.dirty,
            }),
          );
        }
        prevRelease.set(key, release.phase);
      }
    };

    return verbStore.subscribe(onChange);
  }, [codeSessionStore, changesController]);
}
