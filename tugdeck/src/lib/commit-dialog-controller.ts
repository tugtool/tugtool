/**
 * commit-dialog-controller — per-card open state + land path for the
 * transcript-resident `TugCommitDialog` ([P03], Spec S03).
 *
 * `/commit` (and Session ▸ Commit…) is user-driven, not turn-driven, so the
 * dialog can't hang off `CodeSessionStore`'s reducer the way the
 * Permission/Question dialogs do ([Q02]). This controller is the
 * `ShadeViewController`-shaped store that holds "is the commit dialog open?"
 * for one card: `subscribe`/`getSnapshot` over `{ open, seedMessage }`,
 * `show(seedMessage?)` / `hide()`, and the commit land path — the gate set
 * that used to live in `session-card.tsx`'s `landSessionCommit` ([P09]).
 *
 * Only one of dialog-open / shade-open at a time ([P03]): `show()` hides the
 * shade, and opening the shade hides the dialog (via a subscription on the
 * injected `ShadeViewController`).
 *
 * @module lib/commit-dialog-controller
 */

import type { ChangesRouteController } from "@/lib/changes-route-controller";
import type { ShadeViewController } from "@/lib/shade-view-controller";
import type { CodeSessionStore } from "@/lib/code-session-store";
import {
  getChangesetVerbStore,
  type CommitPhase,
} from "@/lib/changeset-verb-store";
import { getChangesetDraftStore } from "@/lib/changeset-draft-store";

/** The controller's subscribable snapshot. */
export interface CommitDialogSnapshot {
  /** Whether the dialog is mounted-and-open at the transcript tail. */
  open: boolean;
  /** The seed message `/commit <message>` carried, or null. Informational —
   *  the seed is also written to the draft store so the editor picks it up. */
  seedMessage: string | null;
}

/** Inputs to the pure commit land-gate. */
export interface CommitLandGateInput {
  /** A Claude turn is in flight (`canInterrupt`) — durable mutations wait. */
  turnInProgress: boolean;
  /** The current commit round-trip phase for this entry. */
  commitPhase: CommitPhase;
  /** The trimmed commit message. */
  message: string;
  /** The number of files the commit would land. */
  fileCount: number;
}

/** The land-gate verdict — `ok`, or the first failing reason. */
export type CommitLandGate =
  | { ok: true }
  | { ok: false; reason: "turn" | "pending" | "empty-changeset" | "empty-message" };

/**
 * Whether a commit may land, and if not, why ([P04]/[P09]/[P11]). Pure;
 * exported so the dialog's Commit-disable state and the controller's land
 * path share one gate. Order matters — the reasons map to the dialog's
 * button-disable + hint precedence (turn gate first).
 */
export function evaluateCommitLandGate(input: CommitLandGateInput): CommitLandGate {
  if (input.turnInProgress) return { ok: false, reason: "turn" };
  if (input.commitPhase === "pending") return { ok: false, reason: "pending" };
  if (input.fileCount === 0) return { ok: false, reason: "empty-changeset" };
  if (input.message.trim().length === 0) return { ok: false, reason: "empty-message" };
  return { ok: true };
}

export interface CommitDialogControllerDeps {
  changesController: ChangesRouteController;
  shadeViewController: ShadeViewController;
  codeSessionStore: CodeSessionStore;
}

const CLOSED: CommitDialogSnapshot = Object.freeze({ open: false, seedMessage: null });

export class CommitDialogController {
  private snapshot: CommitDialogSnapshot = CLOSED;
  private readonly listeners = new Set<() => void>();
  private readonly deps: CommitDialogControllerDeps;
  private readonly unsubscribeShade: () => void;

  constructor(deps: CommitDialogControllerDeps) {
    this.deps = deps;
    // Mutual exclusion ([P03]): when the shade opens, close the dialog. `show`
    // hides the shade first, so the shade→"none" edge never closes the dialog.
    this.unsubscribeShade = deps.shadeViewController.subscribe(() => {
      if (deps.shadeViewController.getSnapshot() !== "none" && this.snapshot.open) {
        this.hide();
      }
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CommitDialogSnapshot => this.snapshot;

  private commit(next: CommitDialogSnapshot): void {
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Open the dialog at the transcript tail. Hides the shade ([P03]). When a
   * `/commit <message>` carried a seed, it is written into the draft store as
   * an edited draft so [P05] semantics apply and the editor seeds from it.
   */
  show(seedMessage?: string): void {
    this.deps.shadeViewController.hide();
    const seed = seedMessage?.trim() ?? "";
    if (seed.length > 0) {
      getChangesetDraftStore()?.setDraft(
        this.deps.changesController.projectDir,
        "session",
        this.deps.changesController.tugSessionId,
        { message: seed, edited: true },
      );
    }
    this.commit({ open: true, seedMessage: seed.length > 0 ? seed : null });
  }

  /** Close the dialog (the tail slot reserves its height on dismiss). */
  hide(): void {
    if (!this.snapshot.open) return;
    this.commit(CLOSED);
  }

  /**
   * Land the commit ([P09]): re-check the gates against live state, send the
   * commit, and on success clear the draft and close the dialog. On error the
   * dialog stays open and surfaces `commit.error` inline (it observes the verb
   * store itself).
   */
  land(message: string): void {
    const { changesController, codeSessionStore } = this.deps;
    const verbStore = getChangesetVerbStore();
    const text = message.trim();
    const gate = evaluateCommitLandGate({
      turnInProgress: codeSessionStore.getSnapshot().canInterrupt === true,
      commitPhase: verbStore?.commitState(changesController.entryKey).phase ?? "idle",
      message: text,
      fileCount: changesController.getSnapshot().committedPaths.size,
    });
    if (!gate.ok) return;
    changesController.commit(text);
    if (verbStore === null) return;
    const unsubscribe = verbStore.subscribe(() => {
      const phase = verbStore.commitState(changesController.entryKey).phase;
      if (phase === "pending") return;
      unsubscribe();
      if (phase === "done") {
        getChangesetDraftStore()?.setDraft(
          changesController.projectDir,
          "session",
          changesController.tugSessionId,
          { clear: true },
        );
        this.hide();
      }
    });
  }

  dispose(): void {
    this.unsubscribeShade();
    this.listeners.clear();
  }
}
