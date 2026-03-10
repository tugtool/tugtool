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

import React, { useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { animate } from "@/components/tugways/tug-animator";
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
 * Uses `--tug-base-*` semantic tokens for all visual properties.
 * The content renders into a Radix portal (document root), avoiding
 * z-index conflicts with CardFrame and other stacked elements.
 *
 * All colors use var(--tug-base-*) semantic tokens for zero-re-render theme switching.
 *
 * Selection behavior (Rule 4 compliant, [D02]):
 * - `onSelect` is intercepted; Radix close is prevented via event.preventDefault().
 * - A double-blink background-color animation is driven by TugAnimator (programmatic
 *   lane, Rule 13 — needs completion sequencing to know when to close the menu).
 * - animate().finished resolves when the blink completes; the callback fires and
 *   Escape is dispatched so Radix closes the menu — no React state involved.
 */
export function TugDropdown({ trigger, items, onSelect }: TugDropdownProps) {
  // Tracks whether a blink animation is in progress to guard against re-entrant calls.
  const blinkingRef = useRef(false);

  function handleItemSelect(id: string, event: Event) {
    // Prevent Radix from immediately closing the menu.
    event.preventDefault();

    if (blinkingRef.current) return;
    blinkingRef.current = true;

    const target = event.currentTarget as HTMLElement;

    // Read the computed surface color for WAAPI keyframes.
    // getPropertyValue() returns a string with leading whitespace per CSS spec;
    // .trim() is required. WAAPI cannot interpolate CSS variable references
    // directly, so we must resolve to a concrete color value. [D02]
    const surfaceDefault = getComputedStyle(target)
      .getPropertyValue("--tug-base-surface-default")
      .trim() || "transparent";

    // Read the standard easing value at runtime — WAAPI does not resolve
    // var() references in easing strings. [D02]
    const easing = getComputedStyle(target)
      .getPropertyValue("--tug-base-motion-easing-standard")
      .trim() || "cubic-bezier(0.2, 0, 0, 1)";

    // Double-blink keyframes: highlight → transparent → highlight → highlight.
    // Reproduces the Mac-style menu selection blink. [D02]
    const blinkKeyframes = [
      { backgroundColor: surfaceDefault },
      { backgroundColor: "transparent" },
      { backgroundColor: surfaceDefault },
      { backgroundColor: surfaceDefault },
    ];

    // Drive blink via TugAnimator; sequence menu close on animate().finished.
    // moderate = 200ms. blinkingRef is reset inside .finished.then() so the
    // trigger (which persists after menu close) can accept new selections. [D02]
    animate(target, blinkKeyframes, {
      duration: "--tug-base-motion-duration-moderate",
      easing,
    }).finished.then(() => {
      blinkingRef.current = false;

      // Fire caller's callback.
      onSelect(id);

      // Close the menu by dispatching Escape — Radix handles this natively
      // without any React state re-render.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="tug-dropdown-content" align="start">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            className="tug-dropdown-item"
            disabled={item.disabled}
            onSelect={(event) => handleItemSelect(item.id, event)}
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
