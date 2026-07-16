/**
 * `BlockGrip` — the shared drag-handle affordance for the Block family.
 *
 * A `GripVertical` glyph in a grab-cursor box that forwards `onPointerDown`
 * so the owner can begin a reorder drag. It fills {@link BlockStrip}'s
 * leftmost `grip` slot — today only the Lens section bands populate it, but
 * the handle lives in the shared affordance library (not a section one-off)
 * so a future entry-level reorder reuses it ([P04]).
 *
 * The grip rides the same one-line box as the strip's dot / name / actions
 * (`--tugx-toolheader-line`) so it centers on the first row alongside them.
 * `touch-action: none` keeps a touch-drag from scrolling the pane; the
 * grabbing cursor while a drag is live is the owning section's concern
 * (keyed on its `data-dragging`).
 *
 * Laws: [L06] appearance via CSS + the `data-dragging` attribute the owner
 * sets, never React state; [L19] file pair, docstring, `data-slot`.
 *
 * @module components/tugways/body-kinds/affordances/block-grip
 */

import "./block-grip.css";

import React from "react";
import { GripVertical } from "lucide-react";

export interface BlockGripProps {
  /** Begin a drag from the grip. The owner captures the pointer + drives the reorder. */
  onPointerDown?: (event: React.PointerEvent) => void;
  /** Per-consumer test selector (e.g. `"lens-section-grip"`). */
  "data-testid"?: string;
  /** Optional className for cascade-scoped customization. */
  className?: string;
}

/** Glyph-box size of the grip (matches the strip's leading dot). */
const GRIP_SIZE = 14;

export function BlockGrip({
  onPointerDown,
  "data-testid": dataTestid,
  className,
}: BlockGripProps): React.ReactElement {
  return (
    <span
      className={className === undefined ? "block-grip" : `block-grip ${className}`}
      data-slot="block-grip"
      data-testid={dataTestid}
      onPointerDown={onPointerDown}
    >
      <GripVertical size={GRIP_SIZE} aria-hidden="true" />
    </span>
  );
}
