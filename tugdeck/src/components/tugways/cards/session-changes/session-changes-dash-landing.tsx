/**
 * `SessionChangesDashLanding` — the dash row's landing face.
 *
 * One line answering "what would landing this dash do right now?", and the act
 * that clears whatever the answer is. The outcome word comes from
 * `deriveJoinOutcome` ([#outcome-derivation]) so the lane and the join-mode
 * controller cannot disagree; each blocker renders its server-written detail
 * plus the one act that clears it ([#blocker-acts]).
 *
 * The face belongs to the **fronted** row only. `JoinState` is one slot per
 * card, not per dash, so two rows previewing would overwrite each other and the
 * loser would render the winner's blockers under its own name — and landing is
 * a gesture on this card's own dash anyway.
 *
 * Laws: [L02] every value here arrives as a prop from the view's store reads;
 * [L06] tone paints through `data-outcome` and CSS; [L19] the face composes
 * `TugBadge` / `TugPushButton` rather than hand-rolling chrome.
 *
 * @module components/tugways/cards/session-changes/session-changes-dash-landing
 */

import "./session-changes-dash-landing.css";

import React from "react";

import { TugBadge, type TugBadgeRole } from "@/components/tugways/tug-badge";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { DashChangesetEntry } from "@/lib/changeset-types";
import type { JoinBlocker, JoinPhase } from "@/lib/changeset-verb-store";
import type { ResolvePhase, ResolveState } from "@/lib/changeset-join-store";
import { evaluateJoinLandGate, type JoinOutcome } from "@/lib/join-mode-controller";

/** The lane's landing gestures, supplied by the card that owns the dash. */
export interface DashLandingActions {
  /** Ask the server what this join would do; fired when the fronted row opens. */
  preview: (entry: DashChangesetEntry) => void;
  /** Open the join-message editor over the previewed merge. */
  join: (entry: DashChangesetEntry) => void;
  /** Resume an interrupted teardown from the dash's join journal. */
  resumeTeardown: (entry: DashChangesetEntry) => void;
  /** Run the resolution ladder over a conflicted join. */
  resolve: (entry: DashChangesetEntry) => void;
  /** Discard the dash — branch, worktree, and dirt. The confirm's second beat. */
  release: (entry: DashChangesetEntry) => void;
}

/**
 * What the resolve lane shows, derived from the ladder's phase and whether it
 * built anything landable ([#outcome-derivation]).
 *
 * - `offer` — conflicted and untried: the ladder is the act that clears it.
 * - `progress` — running, streaming per file.
 * - `resolved` — a candidate exists; the join is landable after all.
 * - `partial` — the ladder's honest dead end. Some files are still conflicting,
 *   so there is nothing to land and no button that could pretend otherwise.
 * - `error` / `none` — the ladder refused, or has nothing to say here.
 *
 * A `resolved` phase with no candidate reads as `partial` for the same reason:
 * whatever it resolved, there is no commit to land.
 */
export type ResolveFace = "none" | "offer" | "progress" | "resolved" | "partial" | "error";

export function deriveResolveFace(
  outcome: JoinOutcome,
  phase: ResolvePhase,
  candidateCommit: string | null,
): ResolveFace {
  switch (phase) {
    case "resolving":
      return "progress";
    case "resolved":
      return candidateCommit !== null ? "resolved" : "partial";
    case "partial":
      return "partial";
    case "error":
      return "error";
    default:
      return outcome === "conflicted" ? "offer" : "none";
  }
}

export interface SessionChangesDashLandingProps {
  /** The dash this face describes — always the card's own. */
  entry: DashChangesetEntry;
  /** The derived landing outcome ([#outcome-derivation]). */
  outcome: JoinOutcome;
  /** The join round trip's phase, for the pending gate. */
  joinPhase: JoinPhase;
  /** Conflicting paths from the preview or an aborted execute. */
  conflicts: readonly string[];
  /** What would refuse this join, from the preview's preflight (Spec S03). */
  blockers: readonly JoinBlocker[];
  /** A verb-level refusal from an execute, if one came back. */
  error: string | null;
  /** A candidate commit from the resolution ladder, if one was built. */
  candidateCommit: string | null;
  /** A Claude turn is in flight — durable acts wait. */
  turnInProgress: boolean;
  /** The resolution ladder's live state for this dash. */
  resolve: ResolveState;
  actions: DashLandingActions;
}

/** The word the face fronts for each outcome. */
const OUTCOME_WORDS: Record<JoinOutcome, string> = {
  unknown: "not previewed",
  previewing: "previewing…",
  clean: "clean",
  conflicted: "conflicted",
  blocked: "blocked",
  empty: "empty",
};

const OUTCOME_ROLES: Record<JoinOutcome, TugBadgeRole> = {
  unknown: "data",
  previewing: "data",
  clean: "success",
  conflicted: "danger",
  blocked: "caution",
  empty: "data",
};

/**
 * The act that clears a blocker ([#blocker-acts]). Pure, and `null` for a kind
 * this deck has never heard of — an unknown blocker still renders its `detail`,
 * so a new server-side refusal is shown rather than swallowed (Spec S03).
 */
export function blockerAct(blocker: JoinBlocker, base: string): string | null {
  switch (blocker.kind) {
    case "off-base":
      return `Check out ${base} first`;
    case "base-dirt":
      return blocker.paths.length > 0
        ? `Commit or stash ${blocker.paths.join(", ")}`
        : "Commit or stash the overlapping changes";
    case "stale-journal":
      return "Resume the interrupted teardown";
    case "empty":
      return "Release this dash";
    default:
      return null;
  }
}

/** Why the Join affordance is disabled, in the gate's own precedence ([P05]). */
export function joinDisabledReason(
  reason: "turn" | "pending" | "outcome" | "empty-message",
  outcome: JoinOutcome,
): string {
  if (reason === "turn") return "Wait for the turn to finish";
  if (reason === "pending") return "Previewing…";
  switch (outcome) {
    case "unknown":
      return "Not previewed yet";
    case "previewing":
      return "Previewing…";
    case "conflicted":
      return "Resolve the conflicts first";
    case "blocked":
      return "Clear what blocks this join first";
    case "empty":
      return "Nothing to join";
    default:
      return "This join cannot land yet";
  }
}

/**
 * What a discard would destroy, as one line ([P06]'s two-beat rule: beat 1
 * shows exactly what beat 2 does). Pure, so the sentence the confirm is
 * measured against is testable without a surface.
 */
export function discardPreflightLine(rounds: number, files: number): string {
  const parts: string[] = [];
  if (rounds > 0) parts.push(`${rounds} round${rounds === 1 ? "" : "s"}`);
  // The entry's `files` is the dash's range diff, not worktree dirt, so the
  // line says `file` — the receipt (Spec S02) counts the same way.
  if (files > 0) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  // A dash with neither is the light confirm: there is nothing to warn about,
  // and saying "discards 0 rounds" would invent a stake that is not there.
  if (parts.length === 0) return "Discards nothing — this dash has no work";
  return `Discards ${parts.join(" · ")}`;
}

export function SessionChangesDashLanding({
  entry,
  outcome,
  joinPhase,
  conflicts,
  blockers,
  error,
  candidateCommit,
  turnInProgress,
  resolve,
  actions,
}: SessionChangesDashLandingProps): React.ReactElement {
  // The message lives in the composer, not here, so the affordance asks the
  // gate everything *except* the message — opening the editor is what supplies
  // it. Same gate as the land itself ([P05]), so the two never disagree.
  const gate = evaluateJoinLandGate({
    turnInProgress,
    joinPhase,
    outcome,
    candidateCommit,
    message: "x",
  });
  const disabledReason = gate.ok ? null : joinDisabledReason(gate.reason, outcome);
  // A stale journal blocks every other act, so the resume renders whatever the
  // outcome says — it is the one gesture that can make the rest reachable.
  const interrupted = entry.stage === "landing";
  const resolveFace = deriveResolveFace(outcome, resolve.phase, resolve.candidateCommit);
  // The discard's first beat. View-scope state ([L24]): the shade is a glance
  // surface, and a half-armed confirm is not something to remember.
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);
  const releaseHint = turnInProgress ? "Wait for the turn to finish" : null;

  return (
    <div
      className="session-changes-dash-landing"
      data-slot="session-changes-dash-landing"
      data-outcome={outcome}
    >
      <div className="session-changes-dash-landing-head">
        <TugBadge
          emphasis="tinted"
          role={OUTCOME_ROLES[outcome]}
          size="2xs"
          data-slot="session-changes-dash-landing-outcome"
        >
          {OUTCOME_WORDS[outcome]}
        </TugBadge>
        <span className="session-changes-dash-landing-acts">
          {resolveFace === "offer" ? (
            <TugPushButton
              size="xs"
              emphasis="outlined"
              role="action"
              onClick={() => actions.resolve(entry)}
              disabled={turnInProgress}
              title={turnInProgress ? "Wait for the turn to finish" : undefined}
              data-slot="session-changes-dash-resolve"
            >
              Resolve
            </TugPushButton>
          ) : null}
          {interrupted ? (
            <TugPushButton
              size="xs"
              emphasis="filled"
              role="accent"
              onClick={() => actions.resumeTeardown(entry)}
              disabled={turnInProgress || joinPhase === "pending"}
              title={turnInProgress ? "Wait for the turn to finish" : undefined}
              data-slot="session-changes-dash-resume"
            >
              Resume teardown
            </TugPushButton>
          ) : null}
          <TugPushButton
            size="xs"
            emphasis="filled"
            role="action"
            onClick={() => actions.join(entry)}
            disabled={disabledReason !== null}
            title={disabledReason ?? undefined}
            data-slot="session-changes-dash-join"
          >
            Join
          </TugPushButton>
          {/* Shade-only, on the row: a discard is not a thing to reach by
              chord or by typing a verb. Two beats — the first arms it and
              opens the preflight below, the second destroys the dash — and
              the label reserves the wider word's width so the row does not
              jump between them. */}
          <TugPushButton
            size="xs"
            emphasis={confirmingDiscard ? "filled" : "outlined"}
            role="danger"
            onClick={() => {
              if (!confirmingDiscard) {
                setConfirmingDiscard(true);
                return;
              }
              setConfirmingDiscard(false);
              actions.release(entry);
            }}
            disabled={releaseHint !== null}
            title={releaseHint ?? undefined}
            widthStabilize={{ alternateLabel: "Discard" }}
            data-slot="session-changes-dash-release"
            data-confirming={confirmingDiscard ? "true" : undefined}
          >
            {confirmingDiscard ? "Discard" : "Release"}
          </TugPushButton>
        </span>
      </div>
      {confirmingDiscard ? (
        <div
          className="session-changes-dash-landing-discard"
          data-slot="session-changes-dash-landing-discard"
        >
          <div className="session-changes-dash-landing-note">
            {discardPreflightLine(entry.rounds, entry.files.length)}
          </div>
          {(entry.round_subjects ?? []).length > 0 ? (
            <ul className="session-changes-dash-landing-discard-subjects">
              {(entry.round_subjects ?? []).map((subject, index) => (
                <li key={`${index}:${subject}`}>{subject}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {outcome === "empty" ? (
        <div
          className="session-changes-dash-landing-note"
          data-slot="session-changes-dash-landing-empty"
        >
          Nothing to join — release this dash.
        </div>
      ) : null}
      {blockers.length > 0 ? (
        <ul
          className="session-changes-dash-landing-blockers"
          data-slot="session-changes-dash-landing-blockers"
        >
          {blockers.map((blocker, index) => {
            const act = blockerAct(blocker, entry.base);
            return (
              <li key={`${index}:${blocker.kind}`} data-blocker={blocker.kind}>
                <span className="session-changes-dash-landing-detail">
                  {blocker.detail}
                </span>
                {act !== null ? (
                  <span className="session-changes-dash-landing-act">{act}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {resolveFace === "progress" ? (
        <ul
          className="session-changes-dash-landing-rungs"
          data-slot="session-changes-dash-landing-progress"
        >
          {resolve.progress.map((file) => (
            <li key={file.path} data-status={file.status}>
              <span className="session-changes-dash-landing-rung-path">{file.path}</span>
              <span className="session-changes-dash-landing-rung-word">
                {file.rung} · {file.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {resolveFace === "resolved" || resolveFace === "partial" ? (
        <ul
          className="session-changes-dash-landing-rungs"
          data-slot="session-changes-dash-landing-resolved"
        >
          {resolve.resolved.map((file) => (
            <li key={file.path} data-resolved-by={file.resolvedBy}>
              <span className="session-changes-dash-landing-rung-path">{file.path}</span>
              <span className="session-changes-dash-landing-rung-word">
                {file.resolvedBy}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {resolveFace === "partial" ? (
        <div
          className="session-changes-dash-landing-note"
          data-slot="session-changes-dash-landing-partial"
        >
          Still conflicting — resolve by hand:{" "}
          {resolve.unresolved.join(", ")}
        </div>
      ) : null}
      {resolveFace === "error" ? (
        <div className="session-changes-dash-landing-error" role="alert">
          {resolve.error}
        </div>
      ) : null}
      {conflicts.length > 0 ? (
        <ul
          className="session-changes-dash-landing-conflicts"
          data-slot="session-changes-dash-landing-conflicts"
        >
          {conflicts.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      ) : null}
      {error !== null ? (
        <div className="session-changes-dash-landing-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
