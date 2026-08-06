/**
 * `TugNonRepoNotice` — the shared "this directory isn't a git repository yet"
 * affordance. Modeled on the {@link ConfigureTug} step plinth: a rounded block on
 * the transcript block surface with a left-aligned title + detail and a
 * right-aligned Initialize button ([D106]). Rendered in both the Changes shade
 * and the History shade so the non-repo state reads identically on either
 * route.
 *
 * The git-init round trip is owned here via {@link useChangesetGitInit} (keyed
 * by `projectDir`): the button sends the CONTROL request; on success the server
 * recomputes the aggregate and the project self-heals to a clean repo, dropping
 * this affordance (Spec S07). An in-flight request disables the button; an
 * error surfaces below the block.
 *
 * Laws: [L02] the git-init verb store enters React through
 * `useSyncExternalStore` (inside the hook); [L06] no appearance state in React.
 *
 * @module components/tugways/tug-non-repo-notice
 */

import "./tug-non-repo-notice.css";

import type { ReactElement } from "react";

import { TugPushButton } from "./tug-push-button";
import { useChangesetGitInit } from "@/lib/changeset-verb-store";

const TITLE = "Not a git repository.";
const DETAIL = "Initialize a new repository in this directory";

/**
 * Hint on the Initialize button while a Claude turn runs. Initialize git is a
 * durable verb and waits for the turn to end — the same gate the Changes shade
 * kept after its commit/join verbs moved to the composer.
 */
const TURN_GATE_HINT = "Unavailable while a turn is running";

export function TugNonRepoNotice({
  projectDir,
  turnInProgress = false,
}: {
  /** Repo-relative project directory to initialize. */
  projectDir: string;
  /** Gate the durable git-init verb while a turn runs (Changes shade only). */
  turnInProgress?: boolean;
}): ReactElement {
  const { phase, error, init } = useChangesetGitInit(projectDir);
  return (
    <div className="tug-non-repo-notice" role="group" data-testid="tug-non-repo-notice">
      <div className="tug-non-repo-notice-block">
        <div className="tug-non-repo-notice-main">
          <span className="tug-non-repo-notice-title">{TITLE}</span>
          <span className="tug-non-repo-notice-detail">{DETAIL}</span>
        </div>
        <div className="tug-non-repo-notice-action">
          <TugPushButton
            size="sm"
            emphasis="filled"
            role="action"
            onClick={init}
            disabled={phase === "pending" || turnInProgress}
            title={turnInProgress ? TURN_GATE_HINT : undefined}
            data-testid="tug-non-repo-notice-init"
          >
            Initialize
          </TugPushButton>
        </div>
      </div>
      {phase === "error" && error !== null ? (
        <div className="tug-non-repo-notice-error">{error}</div>
      ) : null}
    </div>
  );
}
