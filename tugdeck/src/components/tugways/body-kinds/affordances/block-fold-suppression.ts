/**
 * `block-fold-suppression` — suppress a body kind's own fold when an
 * OUTER fold already governs it.
 *
 * A tool block collapsed by the per-tool table ([P06]) is gated by the
 * Quiet Line header's single expand/collapse chevron. Its body kind
 * (`TerminalBlock`, `FileBlock`, `DiffBlock`, …) ALSO has a
 * threshold-driven self-fold ("N more lines"). Stacking the two is the
 * "double-dip" — the user expands the block and the content is *still*
 * folded. When this context is `true`, `useBlockFoldState` defaults the
 * body OPEN, so one expand of the block reveals the full content; the
 * block's chevron is the single fold.
 *
 * The chrome provides it (`true`) around a collapse-wrapped block's body.
 * Default `false` everywhere else — body kinds outside a collapse wrapper
 * keep their own fold unchanged.
 *
 * @module components/tugways/body-kinds/affordances/block-fold-suppression
 */

import React from "react";

/** When true, a body kind defaults its self-fold OPEN (an outer fold governs it). */
export const BlockFoldSuppressedContext = React.createContext<boolean>(false);
