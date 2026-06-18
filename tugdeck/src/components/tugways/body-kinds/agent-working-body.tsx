/**
 * `AgentWorkingBody` — Agent-only placeholder body for a subagent run
 * that is still spinning up, before any nested call or text answer has
 * arrived.
 *
 * `TaskToolBlock` mounts this when its composed transcript has zero
 * entries: the moment the first reducer-linked child call (or the
 * structured result's text) lands, the real `AgentTranscriptBlock`
 * replaces it, so the placeholder never paints over real content. Its
 * sole job is to give the expanded body calm, measured height in the
 * zero-entries window — without it the chrome body collapses to a
 * one-pixel marker and the block visibly jumps when work appears.
 *
 * This is deliberately Agent-only. Per [D02] the header's pulsing dot
 * is the single in-flight *status* signal, and every other tool keeps
 * an empty streaming body; an Agent simply lives in its working state
 * long enough, and is expanded often enough mid-run, that the empty
 * body is a real papercut. The placeholder is quiet *content*, not a
 * second status indicator — no motion, no spinner, nothing that
 * competes with the dot.
 *
 * Laws:
 *  - [L06] appearance is pure CSS/DOM; the component holds no state.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    module docstring, `data-slot="agent-working-body"` on the root.
 *  - [L20] consumes the shared `--tugx-block-*` text tones only — it
 *    introduces no new token family and no status-color tokens.
 *
 * @module components/tugways/body-kinds/agent-working-body
 */

import "./agent-working-body.css";

import React from "react";

export interface AgentWorkingBodyProps {
  /**
   * The quiet line shown in the body. Defaults to `"Working…"` — the
   * same word the Dev card's footer STATE uses for an in-flight turn.
   */
  label?: string;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

export const AgentWorkingBody: React.FC<AgentWorkingBodyProps> = ({
  label = "Working…",
  className,
}) => (
  <div
    data-slot="agent-working-body"
    className={
      className === undefined
        ? "agent-working-body"
        : `agent-working-body ${className}`
    }
  >
    {label}
  </div>
);
