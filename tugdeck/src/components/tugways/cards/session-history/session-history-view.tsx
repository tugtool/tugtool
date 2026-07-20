/**
 * `SessionHistoryView` — the History view-route's transcript-slot view
 * ([P01]/[P10]). On the `↺` route this replaces the transcript with the
 * card's own project git log rendered as one `BlockChrome` block per
 * commit; submitting a question on this route sends an on-record
 * `/tugplug:history` turn (wired in the prompt entry).
 *
 * Data rides the shared `gitLogStore()` (`GIT_LOG` feed) — the card knows
 * its own `projectDir` from the binding, so the Lens-follow indirection is
 * gone. The store is an app-level singleton keyed by one requested root, so
 * `requestLog` fires only while THIS card's History view is the active slot
 * (`active`), and the render gates on `requestedRoot === projectDir` — two
 * cards viewing history of different projects at once is a known
 * single-store limitation, not a correctness hazard (each re-requests when
 * it regains focus). `GIT_HEAD` auto-refreshes the store after a commit.
 *
 * [Q01] resolution: the `range` diff descriptor is dash-shaped (it resolves
 * through a worktree + `merge-base`), so it does not cleanly express a
 * per-commit `<sha>~1..<sha>` two-dot diff. Inline per-commit diff bodies
 * are therefore deferred to a follow-on; each block renders the commit's
 * subject, author, date, and full sha.
 *
 * Laws: [L02] the log store enters React through `useSyncExternalStore`;
 * [L06] no appearance state in React.
 *
 * @module components/tugways/cards/session-history/session-history-view
 */

import "./session-history-view.css";

import { useEffect, useSyncExternalStore } from "react";
import type React from "react";
import { History as HistoryIcon, X } from "lucide-react";

import { BlockChrome } from "@/components/tugways/blocks/block-chrome";
import { dashNameFromTrailer } from "@/lib/landing-receipt";
import { BlockStrip } from "@/components/tugways/blocks/block-strip";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import {
  gitLogStore,
  type GitLogCommit,
  type GitLogStoreSnapshot,
} from "@/lib/git-log-store";

const EMPTY_SNAPSHOT: GitLogStoreSnapshot = {
  phase: "idle",
  requestId: null,
  requestedRoot: null,
  payload: null,
  error: null,
};

/** Read the shared Git History store reactively ([L02]). */
function useGitLogSnapshot(): GitLogStoreSnapshot {
  const store = gitLogStore();
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
    () => EMPTY_SNAPSHOT,
  );
}

function CommitBlock({ commit }: { commit: GitLogCommit }): React.ReactElement {
  const meta = `${commit.sha.slice(0, 10)} · ${commit.author} · ${commit.date}`;
  // A commit that landed as a dash join carries the `Tug-Dash:` trailer;
  // History badges it so joins read differently from hand commits ([P09]).
  const dashName = dashNameFromTrailer(commit.tug_dash);
  return (
    <div className="session-history-commit" data-testid="session-history-commit">
      <BlockChrome
        variant="tool"
        phase="idle"
        identity={
          <span className="session-history-commit-subject" title={commit.subject}>
            {commit.subject}
            {dashName !== null ? (
              <span
                className="session-history-join-badge"
                data-testid="session-history-join-badge"
              >
                from dash {dashName}
              </span>
            ) : null}
          </span>
        }
        resultSummary={{ kind: "text", text: meta }}
      >
        <div className="session-history-commit-body">
          <pre className="session-history-commit-sha">{commit.sha}</pre>
        </div>
      </BlockChrome>
    </div>
  );
}

export interface SessionHistoryViewProps {
  /** Repo-relative project directory the card is bound to. */
  projectDir: string | null;
  /** True while the `↺` route is the active slot — gates the singleton request. */
  active: boolean;
  /** Hide the Shade — the header's close affordance ([P05]). */
  onClose?: () => void;
}

export function SessionHistoryView({
  projectDir,
  active,
  onClose,
}: SessionHistoryViewProps): React.ReactElement {
  const snapshot = useGitLogSnapshot();

  // Request only while this card's History view is the active slot (the store
  // is a singleton keyed by one root). Idempotent via the store's
  // requested-key guard; `GIT_HEAD` auto-refreshes the store after a commit.
  // Re-request when the singleton's root has drifted away from ours (another
  // card requested its project while we were away).
  useEffect(() => {
    if (!active || projectDir === null) return;
    if (snapshot.requestedRoot === projectDir && snapshot.phase !== "error") {
      return;
    }
    gitLogStore()?.requestLog(projectDir);
  }, [active, projectDir, snapshot.requestedRoot, snapshot.phase]);

  // The view fills the sheet's shade body ([P17]): the header strip pinned
  // above, the scrolling view below. The shade panel (geometry, scrim,
  // grabber, modality, Escape close) is `TugSheetContent
  // presentation="shade"` — mounted by the Session card around this view.
  const shell = (children: React.ReactNode): React.ReactElement => (
    <>
      <div className="tug-sheet-shade-header">
        <BlockStrip
          altitude="section"
          className="tool-call-header"
          dataTestid="session-history-header"
          leading={
            <span className="tool-call-header-leading" aria-hidden="true">
              <HistoryIcon size={14} />
            </span>
          }
          name="History"
          actions={
            onClose !== undefined ? (
              <TugIconButton
                icon={<X size={12} strokeWidth={2.5} />}
                aria-label="Close"
                size="2xs"
                emphasis="ghost"
                onClick={onClose}
              />
            ) : undefined
          }
        />
      </div>
      <div
        className="session-history-view"
        data-slot="session-history-view"
        data-tug-focus="refuse"
      >
        {children}
      </div>
    </>
  );

  if (projectDir === null) {
    return shell(
      <div className="session-history-empty">No project bound to this session.</div>,
    );
  }

  // While the singleton is showing another card's project, treat it as loading
  // for us until our request lands.
  const payload =
    snapshot.requestedRoot === projectDir ? snapshot.payload : null;

  if (payload?.no_repo) {
    return shell(
      <div className="session-history-empty">Not a git repository.</div>,
    );
  }
  if (snapshot.requestedRoot === projectDir && snapshot.phase === "error") {
    return shell(
      <div className="session-history-empty">
        {snapshot.error ?? "Failed to load history."}
      </div>,
    );
  }
  if (payload === null) {
    return shell(<div className="session-history-empty">Loading history…</div>);
  }
  if (payload.commits.length === 0) {
    return shell(<div className="session-history-empty">No commits yet.</div>);
  }

  return shell(
    <div className="session-history-view-body">
      {payload.commits.map((commit) => (
        <CommitBlock key={commit.sha} commit={commit} />
      ))}
    </div>,
  );
}
