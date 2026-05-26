/**
 * tide-card-z1c.ts — pure-logic helpers for the TideZ1C in-flight
 * indicator.
 *
 * The React component lives inline in `tide-card-transcript.tsx`
 * (per [D19] / `#spec-z1c`); this file owns the phase →
 * `{tone, label}` mapping so tests pin the contract without
 * dragging the renderer in.
 *
 * The component's visibility is gated structurally by the parent
 * `CodeRowCell` (mounted iff `!isCommitted`), so there is no
 * visibility helper here — only the content map.
 *
 * Per [D19], the `interruptInFlight === true` branch wins over
 * every phase — the user's stop request reads as the dominant
 * signal, regardless of what the wire is doing underneath.
 *
 * @module components/tugways/cards/tide-card-z1c
 */

import type { CodeSessionPhase } from "@/lib/code-session-store/types";

/**
 * Visual tone for the indicator. `"default"` paints the standard
 * thinking-indicator bars + label; `"caution"` re-colors both to
 * the caution text token. The component's CSS owns the tone →
 * color mapping; this module only signals which one applies.
 */
export type TideZ1CTone = "default" | "caution";

/**
 * What TideZ1C should render. `null` means the indicator surface
 * is empty (phase has no defined indicator and no interrupt is in
 * flight) — the component still mounts but paints nothing inside.
 */
export interface TideZ1CContent {
  tone: TideZ1CTone;
  label: string;
}

/**
 * Resolve the indicator content for a given snapshot phase +
 * `interruptInFlight` flag per the [D19] table.
 *
 * Precedence: `interruptInFlight === true` overrides the phase so
 * the user's stop request stays visible even as the wire keeps
 * moving underneath.
 */
export function tideZ1CContent(
  phase: CodeSessionPhase,
  interruptInFlight: boolean,
): TideZ1CContent | null {
  if (interruptInFlight) {
    return { tone: "caution", label: "Interrupting…" };
  }
  switch (phase) {
    case "submitting":
      return { tone: "default", label: "Submitting…" };
    case "awaiting_first_token":
      return { tone: "default", label: "Thinking…" };
    case "streaming":
      return { tone: "default", label: "Streaming…" };
    case "tool_work":
      return { tone: "default", label: "Tool work…" };
    case "awaiting_approval":
      return { tone: "caution", label: "Awaiting approval" };
    case "waking":
      return { tone: "default", label: "Waking…" };
    case "idle":
    case "replaying":
    case "errored":
      return null;
  }
}
