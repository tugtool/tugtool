/**
 * commit-route-controller — per-card state + land path for the commit route
 * ([P03], Spec S03, revised for the prefix-chip redesign).
 *
 * The commit route is "the composer leads with a `!changes` chip": ⇧⌘C /
 * `/commit` / `!changes` insert that chip, turning the prompt entry into the
 * commit-message editor while the bottom-anchored changes sheet is up, and Z5
 * swaps to cancel / auto-message / commit. This controller is the single
 * façade the generic `TugPromptEntry` reads to drive that mode — it holds the
 * `active` flag and folds the four upstream stores (code-session turn state,
 * the changeset snapshot, the draft overlay, the commit verb round-trip) into
 * one referentially-stable snapshot, plus the enter / exit / land / draft
 * triggers.
 *
 * The route is orthogonal to the changes sheet's visibility ([P03] revised):
 * the sheet can be up as a read-only glance with no route active, and the
 * session card owns the coupling (⇧⌘C toggles the sheet and, only when the
 * composer is empty, the route). This controller no longer knows about the
 * shade. The route is transient / in-memory; the composer force-exits on
 * deactivate so the editor's own persistence only ever sees the prompt draft.
 * The commit message itself is durable in the changeset draft store (the
 * debounced `persistMessage` write), so re-entering the route resumes it.
 *
 * @module lib/commit-route-controller
 */

import type { ChangesRouteController } from "@/lib/changes-route-controller";
import type { CodeSessionStore } from "@/lib/code-session-store";
import {
  getChangesetVerbStore,
  type CommitPhase,
} from "@/lib/changeset-verb-store";
import {
  getChangesetDraftStore,
  type DraftOverlayPhase,
} from "@/lib/changeset-draft-store";

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
 * exported so the composer's Commit-disable state and the controller's land
 * path share one gate. Order matters — the reasons map to the Commit button's
 * disable + hint precedence (turn gate first).
 */
export function evaluateCommitLandGate(input: CommitLandGateInput): CommitLandGate {
  if (input.turnInProgress) return { ok: false, reason: "turn" };
  if (input.commitPhase === "pending") return { ok: false, reason: "pending" };
  if (input.fileCount === 0) return { ok: false, reason: "empty-changeset" };
  if (input.message.trim().length === 0) return { ok: false, reason: "empty-message" };
  return { ok: true };
}

/** The controller's subscribable snapshot — everything the composer + Z5 read. */
export interface CommitRouteSnapshot {
  /** Whether the commit route is active (sheet up, composer in message mode). */
  active: boolean;
  /** The `/commit <message>` seed carried into the route, or null. */
  seedMessage: string | null;
  /**
   * The land gate ignoring message emptiness (turn / pending / changeset). The
   * Commit button's JS-disabled state; message-empty is CSS-gated on the
   * entry's `data-empty` so per-keystroke React state is avoided ([L22]).
   */
  canLandIgnoringMessage: boolean;
  /** Number of files the commit would land (0 ⇒ the "No changes" state). */
  fileCount: number;
  /** The auto-message draft overlay phase (drives the pencil pose + pulse). */
  draftPhase: DraftOverlayPhase;
  /** Live draft text — streaming while drafting, the settled message otherwise. */
  draftText: string;
  /** The settled persisted message from the changeset entry (the seed source). */
  persistedMessage: string;
  /** Whether the persisted draft was user-edited (guards the Replace confirm). */
  edited: boolean;
  /** Commit round-trip phase — `"pending"` drives the Committing… button label. */
  commitPhase: CommitPhase;
  /** Commit error detail to surface, or null. */
  commitError: string | null;
  /** Draft error detail to surface, or null. */
  draftError: string | null;
}

export interface CommitRouteControllerDeps {
  changesController: ChangesRouteController;
  codeSessionStore: CodeSessionStore;
}

export class CommitRouteController {
  private readonly deps: CommitRouteControllerDeps;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribes: (() => void)[] = [];

  private active = false;
  private seedMessage: string | null = null;
  private snapshot: CommitRouteSnapshot;

  constructor(deps: CommitRouteControllerDeps) {
    this.deps = deps;
    this.snapshot = this.derive();

    // Recompute the snapshot whenever any upstream store moves.
    this.unsubscribes.push(deps.codeSessionStore.subscribe(() => this.recompute()));
    this.unsubscribes.push(deps.changesController.subscribe(() => this.recompute()));
    const verbStore = getChangesetVerbStore();
    if (verbStore !== null) {
      this.unsubscribes.push(verbStore.subscribe(() => this.recompute()));
    }
    const draftStore = getChangesetDraftStore();
    if (draftStore !== null) {
      this.unsubscribes.push(draftStore.subscribe(() => this.recompute()));
    }
  }

  // ── Store surface ([L02]) ──────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CommitRouteSnapshot => this.snapshot;

  // ── Derivation ─────────────────────────────────────────────────────────

  private derive(): CommitRouteSnapshot {
    const { changesController, codeSessionStore } = this.deps;
    const changes = changesController.getSnapshot();
    const fileCount = changes.committedPaths.size;
    const turnInProgress = codeSessionStore.getSnapshot().canInterrupt === true;

    const verbStore = getChangesetVerbStore();
    const commit = verbStore?.commitState(changesController.entryKey) ?? null;
    const commitPhase: CommitPhase = commit?.phase ?? "idle";
    const commitError = commit?.error ?? null;

    const draftStore = getChangesetDraftStore();
    const overlay =
      draftStore?.overlay(changesController.projectDir, "session", changesController.tugSessionId) ??
      null;
    const draftPhase: DraftOverlayPhase = overlay?.phase ?? "idle";
    const persistedMessage = changes.entry?.draft?.message ?? "";
    // While the scribe streams, the overlay text is the live document; once it
    // settles the persisted message is the source of truth.
    const draftText =
      draftPhase === "drafting" || draftPhase === "ready"
        ? overlay?.text ?? persistedMessage
        : persistedMessage;
    const draftError = draftPhase === "error" ? overlay?.detail ?? null : null;

    const gate = evaluateCommitLandGate({
      turnInProgress,
      commitPhase,
      message: "x", // ignore message emptiness here (CSS-gated on data-empty)
      fileCount,
    });

    return {
      active: this.active,
      seedMessage: this.seedMessage,
      canLandIgnoringMessage: gate.ok,
      fileCount,
      draftPhase,
      draftText,
      persistedMessage,
      edited: changes.entry?.draft?.edited === true,
      commitPhase,
      commitError,
      draftError,
    };
  }

  private recompute(): void {
    const next = this.derive();
    if (!snapshotsEqual(next, this.snapshot)) {
      this.snapshot = next;
      this.fire();
    }
  }

  private fire(): void {
    for (const listener of [...this.listeners]) listener();
  }

  // ── Triggers ───────────────────────────────────────────────────────────

  /**
   * Enter the commit route (mark it active). A `/commit <message>` seed is
   * written into the changeset draft as an edited draft so [P05] semantics
   * apply and the composer seeds its `!changes` chip payload from it. The
   * session card ensures the changes sheet is up.
   */
  enter(seedMessage?: string): void {
    const seed = seedMessage?.trim() ?? "";
    if (seed.length > 0) {
      getChangesetDraftStore()?.setDraft(
        this.deps.changesController.projectDir,
        "session",
        this.deps.changesController.tugSessionId,
        { message: seed, edited: true },
      );
    }
    this.seedMessage = seed.length > 0 ? seed : null;
    this.active = true;
    this.snapshot = this.derive();
    this.fire();
  }

  /** Exit the route (the composer removes the `!changes` chip + payload). */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.seedMessage = null;
    this.snapshot = this.derive();
    this.fire();
  }

  /** Persist a message edit into the changeset draft ([P05]; `edited` pin rides). */
  persistMessage(text: string): void {
    getChangesetDraftStore()?.setDraft(
      this.deps.changesController.projectDir,
      "session",
      this.deps.changesController.tugSessionId,
      { message: text, edited: true },
    );
  }

  /** Request an auto-message draft ([P06]); `force` is the confirmed Regenerate. */
  requestDraft(force = false): void {
    this.deps.changesController.requestDraft(force);
  }

  /**
   * Cancel an in-flight auto-message draft ([P06]) — the Z5 cancel button,
   * Escape, or Cmd-. while the scribe streams. Aborts only the draft's scribe
   * child; the session's turn is untouched. A no-op when nothing is drafting.
   */
  cancelDraft(): void {
    const { changesController } = this.deps;
    getChangesetDraftStore()?.cancelDraft(
      changesController.projectDir,
      "session",
      changesController.tugSessionId,
    );
  }

  /**
   * Land the commit ([P09]): re-check the gates against live state, send the
   * commit, and on success clear the draft and exit the route. On error the
   * route stays active and the snapshot's `commitError` surfaces inline.
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
        this.exit();
      }
    });
  }

  dispose(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.listeners.clear();
  }
}

/** Field-by-field snapshot equality so `getSnapshot` stays referentially stable. */
function snapshotsEqual(a: CommitRouteSnapshot, b: CommitRouteSnapshot): boolean {
  return (
    a.active === b.active &&
    a.seedMessage === b.seedMessage &&
    a.canLandIgnoringMessage === b.canLandIgnoringMessage &&
    a.fileCount === b.fileCount &&
    a.draftPhase === b.draftPhase &&
    a.draftText === b.draftText &&
    a.persistedMessage === b.persistedMessage &&
    a.edited === b.edited &&
    a.commitPhase === b.commitPhase &&
    a.commitError === b.commitError &&
    a.draftError === b.draftError
  );
}
