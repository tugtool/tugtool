/**
 * TugTranscriptEntry — Slot-based transcript-row primitive.
 *
 * Renders one participant's contribution to a transcript: a left-aligned
 * icon column, then a body column with bold identifier + optional small
 * timestamp, the body slot, and an optional controls slot beneath. Slack-
 * style — no per-row container, no chat bubbles, no left-vs-right
 * alignment by speaker.
 *
 * Four participants are supported: `user`, `code`, `shell`, `command`.
 * Per-variant differences come exclusively from `[data-participant="..."]`
 * cascade onto `--tugx-transcript-*` tokens — adding a participant is a
 * token + a registry entry, never a primitive edit.
 *
 * `body` and `controls` are `React.ReactNode` slots; the primitive imposes
 * no opinion on text rendering. Consumers pass markdown views, atom-flavored
 * text, or structured renderers as the situation calls for.
 *
 * No production wiring lives in this primitive. Live transcript binding
 * (CodeSessionStore, streaming, atom rendering for user submissions) is
 * the consumer's concern.
 *
 * Laws: [L02] no React state — primitive is presentational; consumers pass
 *       slot contents directly. [L06] appearance via CSS / data-participant
 *       cascade. [L19] component authoring guide — file pair, module
 *       docstring, exported props interface, data-slot. [L20] component-
 *       token sovereignty — only `--tugx-transcript-*` drives variant
 *       differences; base `--tug-*` tokens are read but never redefined.
 */

import "./tug-transcript-entry.css";

import React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Participant model
// ---------------------------------------------------------------------------

/**
 * Speakers a Tide transcript can mix. The set is open by design — adding
 * a participant means extending this union, registering a glyph in
 * {@link PARTICIPANT_ICONS}, and (optionally) defining new
 * `--tugx-transcript-*-<participant>` flavor tokens. No primitive edit.
 */
export type Participant = "user" | "code" | "shell" | "command";

/**
 * Glyph rendered in the icon column for each participant. Limited to the
 * three route-prefix characters in current use:
 *
 *   - `>` for `user` and `code` — both occupy the Code-route channel; the
 *     speaker distinction comes from the bold identifier text rather than
 *     a separate glyph.
 *   - `$` for `shell` — Shell-route prefix.
 *   - `:` for `command` — Command-route prefix.
 *
 * No invented icons. New participants extend this registry with whatever
 * glyph a future design pass calls for.
 */
const PARTICIPANT_ICONS: Record<Participant, React.ReactNode> = {
  user: ">",
  code: ">",
  shell: "$",
  command: ":",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TugTranscriptEntryProps {
  /** Which participant this row represents. Drives `data-participant` and the icon. */
  participant: Participant;
  /** Bold leading label in the header row. Plain string or styled node. */
  identifier: React.ReactNode;
  /** Optional small timestamp rendered next to the identifier. */
  timestamp?: React.ReactNode;
  /** Row body content. The primitive imposes no opinion on text rendering. */
  body: React.ReactNode;
  /** Optional trailing affordance row beneath the body (badges, copy button, etc.). */
  controls?: React.ReactNode;
  /** Forwarded class name for consumer overrides. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TugTranscriptEntry: React.FC<TugTranscriptEntryProps> = ({
  participant,
  identifier,
  timestamp,
  body,
  controls,
  className,
}) => {
  // The article's accessible name is its bold identifier. We don't try to
  // serialize a `ReactNode` identifier into a string `aria-label` — using
  // `aria-labelledby` lets the rendered identifier (string or rich node)
  // serve as the name verbatim.
  const labelledById = React.useId();

  return (
    <div
      data-slot="tug-transcript-entry"
      data-participant={participant}
      role="article"
      aria-labelledby={labelledById}
      className={cn("tug-transcript-entry", className)}
    >
      <div className="tug-transcript-entry__icon" aria-hidden="true">
        {PARTICIPANT_ICONS[participant]}
      </div>
      <div className="tug-transcript-entry__body-column">
        <div className="tug-transcript-entry__header">
          <strong
            id={labelledById}
            className="tug-transcript-entry__identifier"
          >
            {identifier}
          </strong>
          {timestamp !== undefined && (
            <span className="tug-transcript-entry__timestamp">{timestamp}</span>
          )}
        </div>
        <div className="tug-transcript-entry__body">{body}</div>
        {controls !== undefined && (
          <div className="tug-transcript-entry__controls">{controls}</div>
        )}
      </div>
    </div>
  );
};
