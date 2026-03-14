/**
 * TugPopupButton -- convenience popup button composing TugPopupMenu + TugButton.
 *
 * TugPopupButton is a macOS-style popup button with a fixed visual identity:
 *   emphasis="outlined", role="option", rounded="none", ChevronDown trailing icon.
 *
 * These defaults are intentionally not configurable. [D04] Callers who need a
 * different trigger appearance use TugPopupMenu directly with their own trigger.
 *
 * **Authoritative references:**
 * - [D04] TugPopupButton defaults are not configurable
 * - [D02] TugPopupMenu takes a single ReactNode trigger prop
 * - Spec S04: TugPopupButtonProps interface
 */

import React from "react";
import { ChevronDown } from "lucide-react";
import { TugButton } from "./tug-button";
import type { TugButtonSize } from "./tug-button";
import { TugPopupMenu } from "./tug-popup-menu";
import type { TugPopupMenuItem } from "./tug-popup-menu";

// Re-export TugPopupMenuItem so callers only need to import from tug-popup-button
// when they also use TugPopupButton.
export type { TugPopupMenuItem };

// ---- Types (Spec S04) ----

/**
 * Props for TugPopupButton.
 *
 * TugPopupButton always renders a TugButton with emphasis="outlined",
 * role="option", rounded="none", and a ChevronDown trailing icon.
 * These are fixed; pass label, items, onSelect, and optional size/className.
 *
 * **Authoritative reference:** Spec S04 TugPopupButtonProps.
 */
export interface TugPopupButtonProps {
  /** Label content rendered inside the trigger button. */
  label: React.ReactNode;
  /** List of items to display in the popup menu. */
  items: TugPopupMenuItem[];
  /** Called with the selected item's id when an item is clicked. */
  onSelect: (id: string) => void;
  /** Trigger button size. Default: "md". */
  size?: TugButtonSize;
  /** Additional CSS class names for the trigger button. */
  className?: string;
  /** aria-label for the trigger button. */
  "aria-label"?: string;
  /** data-testid forwarded to the menu content element. */
  "data-testid"?: string;
}

// ---- TugPopupButton ----

/**
 * TugPopupButton -- convenience composition of TugPopupMenu + TugButton.
 *
 * Renders a styled TugButton (outlined-option, no border radius, ChevronDown)
 * as the trigger for a TugPopupMenu. The button trigger is passed via the
 * TugPopupMenu `trigger` ReactNode prop, implementing the architectural
 * inversion where the trigger owns the menu. [D02, D04]
 *
 * Use TugPopupButton for configuration controls that need a standard
 * macOS-style popup button appearance (muted border, neutral color, chevron).
 * Use TugPopupMenu directly when the trigger needs custom appearance
 * (e.g., tab bar buttons, icon-only triggers).
 */
export function TugPopupButton({
  label,
  items,
  onSelect,
  size = "md",
  className,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
}: TugPopupButtonProps) {
  const trigger = (
    <TugButton
      emphasis="outlined"
      role="option"
      rounded="none"
      size={size}
      trailingIcon={<ChevronDown size={12} />}
      className={className}
      aria-label={ariaLabel}
    >
      {label}
    </TugButton>
  );

  return (
    <TugPopupMenu
      trigger={trigger}
      items={items}
      onSelect={onSelect}
      data-testid={dataTestId}
    />
  );
}
