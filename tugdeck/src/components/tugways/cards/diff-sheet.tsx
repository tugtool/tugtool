/**
 * diff-sheet.tsx — the `/diff` uncommitted-changes sheet ([#step-10b]).
 *
 * `/diff` shows `git diff HEAD` for the card's project dir as a single
 * card-scoped overlay ([D15]). The Tug-native shape is one document of
 * per-file collapsible hunks — that document layer is the shared
 * {@link TugDiffDocument} ([P18]), which this sheet composes: the sheet owns
 * the chrome (title, pre-open alert branching, Refresh, Done) and hands the
 * document the parsed payload.
 *
 * Sourcing is single-shot, not a feed ([D21]): {@link useDiffSheet} fires a
 * `git_diff_request` for the project dir on open (and on the in-sheet refresh)
 * via {@link GitDiffStore}, and the body renders the matching response read
 * through `useSyncExternalStore` ([L02]). The document header mirrors Claude
 * Code's "Uncommitted changes (git diff HEAD)" / "N files changed +X −Y".
 *
 * Compositional — composes `TugSheet` (via the card's shared `showSheet`),
 * `TugDiffDocument`, `TugPushButton`, `TugLabel`; composed children keep their
 * own tokens ([L20]).
 *
 * Laws: [L02] store reads via `useSyncExternalStore`, [L06] appearance via
 *       CSS, [L20] composed children keep tokens.
 * Decisions: [D15] pane sheets are overlays, [D21] `/diff` dedicated command,
 *            [P18] the shared document-level diff surface.
 *
 * @module components/tugways/cards/diff-sheet
 */

import "./diff-sheet.css";

import React, { useCallback, useSyncExternalStore } from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugDiffDocument } from "@/components/tugways/tug-diff-document";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import { TugSheetScaffold } from "@/components/tugways/tug-sheet-scaffold";
import { useSeedKeyView } from "@/components/tugways/use-focusable";
import { presentAlertSheet } from "@/components/tugways/tug-alert-sheet";
import { type GitDiffScope, type GitDiffStore } from "@/lib/git-diff-store";

// ---------------------------------------------------------------------------
// useDiffSheet — the card-hosted /diff sheet
// ---------------------------------------------------------------------------

export interface UseDiffSheetArgs {
  /**
   * Store that fires `git_diff_request` and resolves the single-shot reply.
   * `null` (no connection yet — gallery/fixtures) renders the affordance
   * inert: `openDiffSheet` no-ops.
   */
  gitDiffStore: GitDiffStore | null;
  /** The card's shared sheet host (`useTugSheet().showSheet`). */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
}

export interface DiffSheetController {
  /**
   * Present the `/diff` sheet, firing a fresh request. A `scope` narrows the
   * diff to a pathspec and/or names the project (the changeset card);
   * omitting it diffs the whole tree of the store's own project (`/diff`).
   */
  openDiffSheet: (scope?: GitDiffScope) => void;
}

export function useDiffSheet({
  gitDiffStore,
  showSheet,
}: UseDiffSheetArgs): DiffSheetController {
  const openDiffSheet = useCallback((scope?: GitDiffScope) => {
    if (gitDiffStore === null) return;
    gitDiffStore.requestDiff(scope ?? {});

    // Branch on the first resolved response: there's no point opening the
    // (resizable, document-width) diff sheet only to show "nothing here" — a
    // clean tree, a non-git dir, or an error is better surfaced as a
    // lightweight pane-modal alert. The full sheet opens only when there are
    // actual changes to read. (In-sheet Refresh keeps its own inline states.)
    let unsubscribe: (() => void) | null = null;
    const decide = (): void => {
      const snap = gitDiffStore.getSnapshot();
      if (snap.phase === "loading") return; // still in flight — wait
      unsubscribe?.();
      unsubscribe = null;

      if (snap.phase === "error") {
        void presentAlertSheet(showSheet, {
          title: "Couldn't Load the Diff",
          message: snap.error ?? "Something went wrong fetching the diff.",
        });
        return;
      }
      const payload = snap.payload;
      if (payload === null) return; // defensive — ready implies a payload
      if (payload.no_repo) {
        void presentAlertSheet(showSheet, {
          title: "Not a Git Repository",
          message:
            "This project isn't a git repository, so there are no changes to show.",
        });
        return;
      }
      if (payload.files.length === 0) {
        void presentAlertSheet(showSheet, {
          title: "No Uncommitted Changes",
          message: "The working tree is clean — nothing to diff against HEAD.",
        });
        return;
      }
      void showSheet({
        title: "Diff",
        icon: "GitCompareArrows",
        displayWidth: "xl",
        content: (close) => (
          <DiffSheetBody gitDiffStore={gitDiffStore} onClose={close} />
        ),
      });
    };

    unsubscribe = gitDiffStore.subscribe(decide);
    decide(); // resolve synchronously if the response is already cached
  }, [gitDiffStore, showSheet]);

  return { openDiffSheet };
}

// ---------------------------------------------------------------------------
// Sheet body — the shared diff document + refresh, inside the sheet scaffold
// ---------------------------------------------------------------------------

interface DiffSheetBodyProps {
  gitDiffStore: GitDiffStore;
  onClose: (value?: string) => void;
}

function DiffSheetBody({
  gitDiffStore,
  onClose,
}: DiffSheetBodyProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    gitDiffStore.subscribe,
    gitDiffStore.getSnapshot,
  );
  const refresh = useCallback(() => gitDiffStore.requestDiff(), [gitDiffStore]);

  // Seed the Done button as the sheet's live default (filled+ring) on open.
  const doneFocusGroup = React.useId();
  useSeedKeyView(`${doneFocusGroup}:0`);

  const payload = snapshot.payload;
  const files = payload?.files ?? [];
  const hasFiles = files.length > 0;

  // Body by phase. The empty / no-repo / error states render a single
  // centered notice; a resolved payload with files renders the shared
  // document (its own summary header + view toggle + Expand/Collapse All).
  let body: React.ReactElement;
  if (snapshot.phase === "error") {
    body = (
      <p className="diff-sheet-notice" role="alert">
        {snapshot.error ?? "Couldn't load the diff."}
      </p>
    );
  } else if (snapshot.phase === "loading" || payload === null) {
    body = (
      <p className="diff-sheet-notice" role="status">
        Loading changes…
      </p>
    );
  } else if (payload.no_repo) {
    body = (
      <div className="diff-sheet-notice" role="status">
        <TugLabel emphasis="proposal" size="lg" align="center">
          Not a git repository
        </TugLabel>
      </div>
    );
  } else if (!hasFiles) {
    body = (
      <div className="diff-sheet-notice" role="status">
        <TugLabel emphasis="proposal" size="lg" align="center">
          No uncommitted changes
        </TugLabel>
      </div>
    );
  } else {
    body = (
      <TugDiffDocument
        payload={payload}
        label="Uncommitted changes (git diff HEAD)"
        className="diff-sheet-document"
      />
    );
  }

  return (
    <TugSheetScaffold
      className="diff-sheet"
      footer={
        <div className="tug-sheet-actions">
          <TugPushButton
            size="sm"
            emphasis="ghost"
            onClick={refresh}
            disabled={snapshot.phase === "loading"}
            data-testid="diff-refresh"
          >
            Refresh
          </TugPushButton>
          <span className="diff-sheet-footer-spacer" />
          <TugPushButton
            size="sm"
            emphasis="primary"
            onClick={() => onClose()}
            data-testid="diff-done"
            focusGroup={doneFocusGroup}
            focusOrder={0}
          >
            Done
          </TugPushButton>
        </div>
      }
    >
      {body}
    </TugSheetScaffold>
  );
}
