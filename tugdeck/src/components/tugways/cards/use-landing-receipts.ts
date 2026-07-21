/**
 * use-landing-receipts — the commit landing as transcript ink ([P07]).
 *
 * One subscription over the app-level changeset verb store per Session card:
 * when a `changeset_commit` round-trip for this card's entry resolves, append
 * the server-formatted summary (S02) as a `/commit` row through the
 * shell-exchange ink mechanism ([D111] — the row records what the user did,
 * never what Claude knows; it is not session context). The server has already
 * persisted the same row to the shell ledger, so this live append is the
 * initiating client's copy; other decks pick it up on their next restore, and
 * the row survives reload + cold boot from the ledger.
 *
 * The summary string is the single source ([P07]): this hook ingests it
 * verbatim, and `session-commit-receipt-block` parses the identical string
 * live and on restore, so the two rows are byte-identical. Join/release have
 * no UI initiators left ([P10]), so they leave no receipts here.
 *
 * Laws: [L22] store→store wiring observes the verb store's own subscription
 * directly (no useSyncExternalStore → useEffect round-trip).
 *
 * @module components/tugways/cards/use-landing-receipts
 */

import { useEffect } from "react";

import {
  getChangesetVerbStore,
  type CommitPhase,
} from "@/lib/changeset-verb-store";
import type { ChangesRouteController } from "@/lib/changes-route-controller";
import type { CodeSessionStore } from "@/lib/code-session-store";

export function useLandingReceipts(
  codeSessionStore: CodeSessionStore,
  changesController: ChangesRouteController,
): void {
  useEffect(() => {
    const verbStore = getChangesetVerbStore();
    if (verbStore === null) return;
    const commitKey = changesController.entryKey;
    let prevCommit: CommitPhase = verbStore.commitState(commitKey).phase;

    const onChange = (): void => {
      // Commit: pending → done appends the server summary once. No fiction —
      // if the server sent no summary, nothing is appended.
      const commit = verbStore.commitState(commitKey);
      if (commit.phase === "done" && prevCommit !== "done" && commit.summary !== null) {
        const now = Date.now();
        codeSessionStore.ingestShellExchange({
          phase: "complete",
          exchangeId: `landing-${now}-${Math.random().toString(36).slice(2, 8)}`,
          command: "/commit",
          output: commit.summary,
          exitCode: 0,
          cwd: changesController.projectDir,
          cwdAfter: null,
          startedAtMs: now,
          settledAtMs: now,
        });
      }
      prevCommit = commit.phase;
    };

    return verbStore.subscribe(onChange);
  }, [codeSessionStore, changesController]);
}
