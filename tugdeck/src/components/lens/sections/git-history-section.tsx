/**
 * git-history-section.tsx — the Lens **Git History** section.
 *
 * A read-only view of the followed session card's recent commits. Follows the
 * active card's project ([P02]): `useFollowedProject()` chains
 * `useLensFollowedCard()` → `cardSessionBindingStore` to yield the followed
 * card's `projectDir`, and the body and collapsed summary both read it so they
 * agree across collapse toggles. A `useEffect` keyed on `projectDir` requests
 * the log through the shared `gitLogStore()` — a data request, not a
 * paint-order registration, so it stays out of the layout phase ([L03] does not
 * apply); the store's requested-key guard makes it idempotent ([P06]).
 *
 * The commit list renders as one read-only `TugCodeView` ([L20]) — never a
 * hand-rolled `<pre>`. `TugCodeView` is sized-to-content with no inner scroll,
 * so the `.lens-content` scroll stays the only scroll (M3b [P08]). Store state
 * enters React via `useSyncExternalStore` ([L02]); appearance is CSS/DOM ([L06]).
 *
 * Host-agnostic ([P07]): imports nothing from `lens/` beyond the registry and
 * the followed-card hook.
 *
 * @module components/lens/sections/git-history-section
 */

import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { History } from "lucide-react";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import { useFrontmostProjectBinding } from "@/lib/frontmost-project";
import { TugCodeView } from "@/components/tugways/tug-code-view";
import {
  gitLogStore,
  formatGitLog,
  type GitLogStoreSnapshot,
} from "@/lib/git-log-store";
import { useLensFollowedCard } from "../lens-followed-card";
import { registerLensSection } from "../lens-section-registry";
import "./git-history-section.css";

interface FollowedProject {
  projectDir: string;
  workspaceKey: string;
}

/** Resolve the project the section follows. Prefer the last non-lens key card's
 *  binding (the card the user is working in, via the shared `LensContent`
 *  tracker [P11]); when there is no such card — or it has no session binding —
 *  fall back to the **topmost bound card** in the deck. A lens section must
 *  keep tracking a card even when none is actively focused. `null` only when no
 *  card anywhere is bound to a project. */
function useFollowedProject(): FollowedProject | null {
  const followedId = useLensFollowedCard();
  const followedBinding = useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    useCallback(
      (): CardSessionBinding | null =>
        followedId ? cardSessionBindingStore.getBinding(followedId) ?? null : null,
      [followedId],
    ),
  );
  const frontmost = useFrontmostProjectBinding();
  const binding =
    followedId !== null && followedBinding !== null ? followedBinding : frontmost;
  if (binding === null || binding.projectDir.length === 0) return null;
  return { projectDir: binding.projectDir, workspaceKey: binding.workspaceKey };
}

const NOOP_SUBSCRIBE = (): (() => void) => () => {};
const EMPTY_STORE_SNAPSHOT: GitLogStoreSnapshot = {
  phase: "idle",
  requestId: null,
  requestedRoot: null,
  payload: null,
  error: null,
};
const getEmptyStoreSnapshot = (): GitLogStoreSnapshot => EMPTY_STORE_SNAPSHOT;

/** Read the shared Git History store reactively ([L02]). Yields the idle empty
 *  snapshot until a connection exists (gallery / fixtures). */
function useGitLogSnapshot(): GitLogStoreSnapshot {
  const store = gitLogStore();
  return useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    store ? store.getSnapshot : getEmptyStoreSnapshot,
  );
}

/** The trailing path component of a project dir, for the not-yet-resolved
 *  collapsed summary. */
function basename(dir: string): string {
  const parts = dir.split("/").filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : dir;
}

/** Collapsed summary (Spec S03): `<branch> · <n> commits`. */
function GitHistoryCollapsedSummary(): React.ReactElement {
  const followed = useFollowedProject();
  const snapshot = useGitLogSnapshot();
  if (followed === null) return <>No project</>;
  const payload = snapshot.payload;
  if (payload?.no_repo) return <>no repo</>;
  if (payload === null) return <>{basename(followed.projectDir)}</>;
  const n = payload.commits.length;
  const noun = n === 1 ? "commit" : "commits";
  return <>{`${payload.branch} · ${n} ${noun}`}</>;
}

function GitHistorySectionBody(): React.ReactElement {
  const followed = useFollowedProject();
  const snapshot = useGitLogSnapshot();
  const projectDir = followed?.projectDir ?? null;

  // Request on mount and whenever the followed project changes ([P05]). Keyed on
  // projectDir; idempotent via the store's requested-key guard ([P06]).
  useEffect(() => {
    if (projectDir === null) return;
    gitLogStore()?.requestLog(projectDir);
  }, [projectDir]);

  if (followed === null) {
    return (
      <div className="lens-git-history-empty" data-testid="lens-git-history-empty">
        No project open.
      </div>
    );
  }
  const payload = snapshot.payload;
  if (payload?.no_repo) {
    return (
      <div className="lens-git-history-empty" data-testid="lens-git-history-empty">
        Not a git repository.
      </div>
    );
  }
  if (snapshot.phase === "error") {
    return (
      <div className="lens-git-history-empty" data-testid="lens-git-history-empty">
        {snapshot.error ?? "Failed to load history."}
      </div>
    );
  }
  if (payload === null) {
    return (
      <div className="lens-git-history-empty" data-testid="lens-git-history-empty">
        Loading history…
      </div>
    );
  }
  return (
    <div className="lens-git-history" data-testid="lens-git-history">
      <TugCodeView value={formatGitLog(payload)} lineNumbers={false} />
    </div>
  );
}

/** Register the Git History section. Called once at boot from `main.tsx`. */
export function registerGitHistorySection(): void {
  registerLensSection({
    kind: "git-history",
    title: "Git History",
    glyph: <History size={14} />,
    collapsedSummary: () => <GitHistoryCollapsedSummary />,
    body: () => <GitHistorySectionBody />,
  });
}
