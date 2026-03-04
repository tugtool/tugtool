/**
 * TugDropdown -- tugways public API for dropdown menus.
 *
 * Wraps shadcn's DropdownMenu as a private implementation detail.
 * App code imports TugDropdown; never imports from components/ui/dropdown-menu directly.
 *
 * **Authoritative references:**
 * - [D02] TugDropdown wraps shadcn DropdownMenu
 * - Spec S04: TugDropdownProps
 * - (#s04-tug-dropdown-props, #d02-tug-dropdown)
 */

import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import "./tug-dropdown.css";

// ---- Types (Spec S04) ----

/**
 * A single item in a TugDropdown menu.
 *
 * **Authoritative reference:** Spec S04 TugDropdownItem.
 */
export interface TugDropdownItem {
  /** Unique identifier for this item. Passed to onSelect when clicked. */
  id: string;
  /** Display label for this item. */
  label: string;
  /** Optional icon node rendered before the label. */
  icon?: React.ReactNode;
  /** Whether this item is disabled. Disabled items are not interactive. */
  disabled?: boolean;
}

/**
 * Props for TugDropdown.
 *
 * **Authoritative reference:** Spec S04 TugDropdownProps.
 */
export interface TugDropdownProps {
  /** The trigger element that opens the dropdown when clicked. */
  trigger: React.ReactNode;
  /** List of items to display in the dropdown. */
  items: TugDropdownItem[];
  /** Called with the selected item's id when an item is clicked. */
  onSelect: (id: string) => void;
}

// ---- TugDropdown ----

/**
 * TugDropdown -- tugways dropdown menu component.
 *
 * Renders a Radix-based dropdown via shadcn's DropdownMenu primitives.
 * Uses `--td-*` semantic tokens for all visual properties.
 * The content renders into a Radix portal (document root), avoiding
 * z-index conflicts with CardFrame and other stacked elements.
 *
 * All colors use var(--td-*) semantic tokens for zero-re-render theme switching.
 */
export function TugDropdown({ trigger, items, onSelect }: TugDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="tug-dropdown-content">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            className="tug-dropdown-item"
            disabled={item.disabled}
            onSelect={() => onSelect(item.id)}
          >
            {item.icon !== undefined && (
              <span className="tug-dropdown-item-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="tug-dropdown-item-label">{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
