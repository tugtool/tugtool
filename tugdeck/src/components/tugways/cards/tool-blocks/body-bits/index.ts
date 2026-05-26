/**
 * Tool-block body bits — small shared primitives for the *inside* of
 * a tool-block wrapper's body (the region inside `ToolBlockChrome`).
 *
 * Each bit is a self-contained component handling one repeating
 * pattern that, before extraction, was being copy-pasted across every
 * wrapper. Wrappers compose them and pass the variable parts; the
 * shared shape lives here so a body-padding change or a chevron
 * upgrade lands in one place instead of three.
 *
 *  - `ToolBlockBody` — the padded vertical-flex container every
 *    wrapper's body region used to hand-roll as
 *    `.<wrapper>-body { flex column, gap xs, padding sm }`.
 *  - `ToolBlockFieldRow` — the `<label>: <value>` row carrying the
 *    standard `TugLabel size="sm" emphasis="calm"` key + the
 *    baseline-aligned (or stacked) value. Inline by default;
 *    `layout="stacked"` for block-shaped values.
 *  - `ToolBlockDisclosure` — the native `<details>` + rotating
 *    lucide `ChevronRight` + active-tone label expand affordance.
 *    Carries no React state; the `[open]` attribute drives the
 *    chevron rotation via CSS.
 *  - `ToolBlockPre` — the standard mono-font, pre-wrap, no-margin
 *    `<pre>` for raw output blocks (log tails, watch snapshots,
 *    text echoes — anything not heavy enough for `TerminalBlock`).
 *
 * Adding a new bit: create the component (or hook) in this
 * directory, follow the same "encapsulate the contract, expose
 * the variability" shape the affordance library uses, and
 * re-export below. The downstream wrappers compose them as needed.
 *
 * @module components/tugways/cards/tool-blocks/body-bits
 */

export { ToolBlockBody } from "./tool-block-body";
export type { ToolBlockBodyProps } from "./tool-block-body";

export { ToolBlockFieldRow } from "./tool-block-field-row";
export type {
  ToolBlockFieldRowLayout,
  ToolBlockFieldRowProps,
} from "./tool-block-field-row";

export { ToolBlockDisclosure } from "./tool-block-disclosure";
export type { ToolBlockDisclosureProps } from "./tool-block-disclosure";

export { ToolBlockPre } from "./tool-block-pre";
export type { ToolBlockPreProps } from "./tool-block-pre";
