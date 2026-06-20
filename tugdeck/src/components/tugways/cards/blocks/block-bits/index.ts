/**
 * Tool-block body bits — small shared primitives for the *inside* of
 * a tool-block wrapper's body (the region inside `BlockChrome`).
 *
 * Each bit is a self-contained component handling one repeating
 * pattern that, before extraction, was being copy-pasted across every
 * wrapper. Wrappers compose them and pass the variable parts; the
 * shared shape lives here so a body-padding change or a chevron
 * upgrade lands in one place instead of three.
 *
 *  - `BlockBody` — the padded vertical-flex container every
 *    wrapper's body region used to hand-roll as
 *    `.<wrapper>-body { flex column, gap xs, padding sm }`.
 *  - `BlockFieldRow` — the `<label>: <value>` row carrying the
 *    standard `TugLabel size="sm" emphasis="calm"` key + the
 *    baseline-aligned (or stacked) value. Inline by default;
 *    `layout="stacked"` for block-shaped values.
 *  - `BlockDisclosure` — the native `<details>` + rotating
 *    lucide `ChevronRight` + active-tone label expand affordance.
 *    Carries no React state; the `[open]` attribute drives the
 *    chevron rotation via CSS.
 *  - `BlockPre` — the standard mono-font, pre-wrap, no-margin
 *    `<pre>` for raw output blocks (log tails, watch snapshots,
 *    text echoes — anything not heavy enough for `TerminalBlock`).
 *
 * Adding a new bit: create the component (or hook) in this
 * directory, follow the same "encapsulate the contract, expose
 * the variability" shape the affordance library uses, and
 * re-export below. The downstream wrappers compose them as needed.
 *
 * @module components/tugways/cards/blocks/block-bits
 */

export { BlockBody } from "./block-body";
export type { BlockBodyProps } from "./block-body";

export { BlockFieldRow } from "./block-field-row";
export type {
  BlockFieldRowLayout,
  BlockFieldRowProps,
} from "./block-field-row";

export { BlockDisclosure } from "./block-disclosure";
export type { BlockDisclosureProps } from "./block-disclosure";

export { BlockPre } from "./block-pre";
export type { BlockPreProps } from "./block-pre";
