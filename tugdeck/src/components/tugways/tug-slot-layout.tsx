/**
 * TugSlotLayout — a set of numbered slots read as one arrangement.
 *
 * The layout is the plural of {@link TugSlot}: `count` slots side by side,
 * numbered 1..N, each carrying its own resting look. It has two lives, and
 * they are the same component because they must look like the same thing:
 *
 *  - **Exemplar** — no `onSelectSlot`. Every slot is inert, and the layout is
 *    a picture of an arrangement, for a chooser to label one of its options
 *    with. The enclosing control owns selection and hover.
 *  - **Control** — with `onSelectSlot`. Every slot is a button, and clicking
 *    one asks for that position. This is the in-row form on a Lens Sessions or
 *    Text Files row.
 *
 * `states` gives the per-slot look; anything it does not cover reads as
 * `"rest"`. A layout with no `states` at all is therefore an empty
 * arrangement — the right picture for a chooser option.
 *
 * Laws: [L06] appearance via CSS and DOM attributes, never React state;
 *       [L11] the control form emits through `onSelectSlot`; [L16] pairings
 *       declared; [L19] component authoring guide; [L20] token sovereignty —
 *       the composed slots keep their own tokens.
 * Decisions: [D121] layout imposition.
 *
 * @module components/tugways/tug-slot-layout
 */

import "./tug-slot-layout.css";

import React from "react";

import { cn } from "@/lib/utils";
import { TugSlot } from "./tug-slot";
import type { TugSlotSize, TugSlotState } from "./tug-slot";

/* ---------------------------------------------------------------------------
 * TugSlotLayoutProps
 * ---------------------------------------------------------------------------*/

export interface TugSlotLayoutProps
  extends Omit<React.ComponentPropsWithoutRef<"span">, "onSelect" | "children"> {
  /** How many slots the arrangement has. Rendered numbered 1..count. */
  count: number;
  /**
   * Per-slot resting look, indexed by slot. Short or absent arrays read the
   * missing slots as `"rest"`.
   */
  states?: readonly TugSlotState[];
  /**
   * Makes every slot a control. Called with the 0-based slot index and the
   * click. Omit for the exemplar form.
   */
  onSelectSlot?: (
    slot: number,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  /**
   * Non-interactive appearance for the control form — the whole arrangement at
   * once.
   * @selector [data-disabled="true"]
   * @default false
   */
  disabled?: boolean;
  /**
   * Slot size.
   * @selector .tug-slot-layout-size-sm | .tug-slot-layout-size-md
   * @default "sm"
   */
  size?: TugSlotSize;
  /**
   * Accessible label for a slot, given its 0-based index. Only consulted on
   * the control form, where each slot is a button that needs a name.
   */
  slotLabel?: (slot: number) => string;
}

/* ---------------------------------------------------------------------------
 * TugSlotLayout
 * ---------------------------------------------------------------------------*/

export const TugSlotLayout = React.forwardRef<HTMLSpanElement, TugSlotLayoutProps>(
  function TugSlotLayout(
    {
      count,
      states,
      onSelectSlot,
      disabled = false,
      size = "sm",
      slotLabel,
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <span
        ref={ref}
        data-slot="tug-slot-layout"
        data-count={count}
        data-disabled={disabled ? "true" : undefined}
        className={cn("tug-slot-layout", `tug-slot-layout-size-${size}`, className)}
        {...rest}
      >
        {Array.from({ length: count }, (_, slot) => {
          const label = slotLabel?.(slot) ?? `Position ${slot + 1}`;
          return (
            <TugSlot
              key={slot}
              number={slot + 1}
              state={states?.[slot] ?? "rest"}
              size={size}
              disabled={disabled}
              aria-label={onSelectSlot !== undefined ? label : undefined}
              title={onSelectSlot !== undefined ? label : undefined}
              onSelect={
                onSelectSlot !== undefined
                  ? (event) => onSelectSlot(slot, event)
                  : undefined
              }
            />
          );
        })}
      </span>
    );
  },
);
