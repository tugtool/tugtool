/**
 * TugToggleButton — a standalone two-state (on/off) press-toggle button.
 *
 * The missing sibling to {@link TugPushButton}: where a push button fires a
 * momentary action, a toggle button carries a **persistent** pressed state.
 * It is the single-button analog of {@link TugOptionGroup} (which is a *group*
 * of independent toggles) and the flat-button analog of {@link TugSwitch}
 * (which wears a track + thumb). Use it when one control flips between two
 * named states and should look like a button, not a switch.
 *
 * It wraps {@link TugButton} so it inherits the full emphasis × role × size ×
 * layout system — a toggle can be a `label-top` tinted chip that families with
 * the Mode / Model / Effort chips, or a plain `text` button, etc. On top of
 * that it adds the persistent on-state: `aria-pressed` for assistive tech and a
 * `data-state="on"|"off"` hook the CSS paints with the shared selection-axis
 * "on" fill (the same `--tug7-surface-toggle-primary-*` tokens the option group
 * uses), so a pressed toggle reads as engaged rather than merely hovered.
 *
 * Controlled only: the consumer owns `pressed` and updates it in
 * `onPressedChange`. There is no internal mirror.
 *
 * Laws: [L06] appearance via CSS/DOM (state rides `data-state`, not React
 *       style), [L19] component authoring guide, [L20] reuses the shared
 *       toggle on-color tokens — no new tokens.
 * Decisions: [D02] emphasis × role system (inherited from TugButton).
 *
 * @module components/tugways/tug-toggle-button
 */

import "./tug-toggle-button.css";

import React from "react";
import { cn } from "@/lib/utils";
import { TugButton } from "./internal/tug-button";
import type { TugButtonProps } from "./internal/tug-button";
import { buildRoleStyle, type TugGroupRole } from "./internal/tug-group-utils";

// Re-export the button vocabulary app code needs to shape a toggle.
export type {
  TugButtonEmphasis,
  TugButtonLayout,
  TugButtonRole,
  TugButtonSize,
} from "./internal/tug-button";

export interface TugToggleButtonProps
  extends Omit<TugButtonProps, "action" | "target"> {
  /** Current on/off state. Controlled — the consumer owns it. */
  pressed: boolean;
  /** Called with the next state when the user toggles the button. */
  onPressedChange?: (next: boolean) => void;
  /**
   * Semantic color for the on-state fill. Omit for the selection axis (blue),
   * the conventional "on" color; pass a role for a semantic signal. Mirrors
   * {@link TugOptionGroup}'s on-color pipeline via `buildRoleStyle`.
   */
  onColorRole?: TugGroupRole;
}

export const TugToggleButton = React.forwardRef<HTMLButtonElement, TugToggleButtonProps>(
  function TugToggleButton(
    { className, pressed, onPressedChange, onColorRole, onClick, style, ...props },
    ref,
  ) {
    // On-color injection ([L06]/[L20]) — the same `--tugx-toggle-on-*` custom
    // properties the CSS reads for the pressed fill.
    const roleStyle = buildRoleStyle("toggle", onColorRole);
    return (
      <TugButton
        ref={ref}
        data-slot="tug-toggle-button"
        aria-pressed={pressed}
        data-state={pressed ? "on" : "off"}
        className={cn("tug-toggle-button", className)}
        style={{ ...roleStyle, ...style }}
        onClick={(e) => {
          onClick?.(e);
          onPressedChange?.(!pressed);
        }}
        {...props}
      />
    );
  },
);
