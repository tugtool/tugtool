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
 * ## Pin-stack contract — `--tugx-pin-stack-top`
 *
 * The `__header` is `position: sticky; top: 0; z-index: 2` (see the .css
 * pair) so the speaker identifier + timestamp remain visible while a
 * long entry body scrolls past — multi-hunk DiffBlocks, tall
 * TerminalBlocks, deep FileBlocks. Block-level pinned chrome inside
 * the entry body (FileBlock / DiffBlock / TerminalBlock / fenced-code
 * headers + their actions rows; ToolWrapperChrome's header) consumes
 * the variable `--tugx-pin-stack-top` to telescope BELOW the entry
 * header rather than overlap it.
 *
 * To make that work, this primitive's `useLayoutEffect` registers a
 * `ResizeObserver` on the rendered `__header` element and writes the
 * live measured height to `--tugx-pin-stack-top` on the entry root
 * via `style.setProperty`. The variable cascades to descendants so any
 * sticky header in the body can stack underneath without each consumer
 * needing to query the entry's geometry. The observer disconnect lives
 * in the effect cleanup; height changes (timestamp re-render,
 * identifier swap, font-size change from `--tugx-tide-magnification`)
 * re-fire the observer and the variable stays accurate.
 *
 * Laws:
 *  - [L03] the ResizeObserver registration runs in `useLayoutEffect`
 *    (before paint) so the first sticky pass in the children sees a
 *    correct offset rather than a one-frame-late value.
 *  - [L06] the variable is written to DOM via `style.setProperty`,
 *    never to React state. Appearance flows through CSS, not renders.
 *  - [L19] file pair, module docstring, exported props interface,
 *    `data-slot="tug-transcript-entry"` on the root.
 *  - [L20] component-token sovereignty — only `--tugx-transcript-*`
 *    drives variant differences; `--tugx-pin-stack-top` is the
 *    contract this primitive WRITES (entry-header height), not a
 *    redefinition of any neighbor's slot.
 */

import "./tug-transcript-entry.css";

import React from "react";
import { Bot, Command, Shell, User } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Participant model
// ---------------------------------------------------------------------------

/**
 * Speakers a Tide transcript can mix. The set is open by design — adding
 * a participant means extending this union, registering an icon in
 * {@link PARTICIPANT_ICONS}, and (optionally) defining new
 * `--tugx-transcript-*-<participant>` flavor tokens. No primitive edit.
 */
export type Participant = "user" | "code" | "shell" | "command";

/**
 * Icon rendered in the gutter for each participant. Lucide glyphs picked
 * to read at a glance:
 *
 *   - `User` for `user` — the human in the session.
 *   - `Bot` for `code` — the assistant.
 *   - `Shell` for `shell` — shell command output.
 *   - `Command` for `command` — `:` surface built-ins.
 *
 * The route prefix character (`>` / `$` / `:`) lives alongside the typed
 * input itself — in the body for `user`, in the identifier for `shell`
 * and `command` — not in the gutter. New participants extend this
 * registry with whatever icon a future design pass calls for.
 */
const ICON_PIXEL_SIZE = 16;
const PARTICIPANT_ICONS: Record<Participant, React.ReactNode> = {
  user: <User size={ICON_PIXEL_SIZE} />,
  code: <Bot size={ICON_PIXEL_SIZE} />,
  shell: <Shell size={ICON_PIXEL_SIZE} />,
  command: <Command size={ICON_PIXEL_SIZE} />,
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

  // Refs for the pin-stack-top measurement. Root holds the CSS variable
  // (so descendants inherit it via cascade); header is the observed
  // element whose height is the value.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const headerRef = React.useRef<HTMLDivElement | null>(null);

  // Write `--tugx-pin-stack-top` = live header height onto the entry
  // root. See the module docstring for the full pin-stack contract.
  // [L03] useLayoutEffect runs before paint so the first sticky pass
  // in the children sees the right offset. [L06] DOM write, not React
  // state — appearance flows through CSS variables.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (root === null || header === null) return;
    // Tier-gap: descendant sticky chrome (wrapper-chrome header,
    // body-kind identity / actions / find rows) pins at
    // `top: var(--tugx-pin-stack-top, 0)` — i.e. the chrome's TOP
    // edge lands at the entry header's BOTTOM edge. With sub-pixel
    // header heights (font line-height + padding rarely lands on an
    // integer pixel boundary, especially under `--tugx-tide-
    // magnification`), `offsetHeight` rounds down, so a strict
    // `top = offsetHeight` leaves the chrome overlapping the entry
    // by < 1px. Adding a small tier-gap (and using `Math.ceil` on
    // the float-precise measurement) guarantees the chrome sits a
    // few px below the entry header rather than slipping under it.
    const TIER_GAP_PX = 4;
    const write = (px: number): void => {
      root.style.setProperty(
        "--tugx-pin-stack-top",
        `${Math.ceil(px) + TIER_GAP_PX}px`,
      );
    };
    // Seed from getBoundingClientRect (float-precise) so the first
    // paint already has the right value; the observer fires for
    // subsequent changes only.
    write(header.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      // `borderBoxSize` is the box-model height the browser laid out
      // (matches `offsetHeight`); fall back to `contentRect.height` for
      // older WebKit if the property isn't available.
      const boxes = entry.borderBoxSize;
      const next =
        boxes !== undefined && boxes.length > 0
          ? boxes[0].blockSize
          : entry.contentRect.height;
      write(next);
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={rootRef}
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
        <div ref={headerRef} className="tug-transcript-entry__header">
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
