/**
 * TugPopupMenu — Internal building block for popup menus.
 *
 * Internal building block — app code should use TugPopupButton instead.
 * Composed by TugPopupButton (convenience wrapper) and TugTabBar (overflow/add menus).
 *
 * Wraps @radix-ui/react-dropdown-menu directly (no shadcn intermediary).
 * Callers pass a `trigger` ReactNode; TugPopupMenu wraps it in a Radix
 * Trigger with asChild, so the caller's element becomes the trigger.
 *
 * This architectural inversion allows callers to control all trigger
 * presentation: TugPopupButton passes a styled TugButton; tab bar triggers
 * pass TugButton ghost-option elements without chevrons.
 *
 * **Authoritative references:**
 * - [D02] TugPopupMenu takes a single ReactNode trigger prop
 *
 * **Law citations:** [L06] [L11] [L19]
 */

import "../tug-menu.css";

import React, { useRef } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { animate } from "@/components/tugways/tug-animator";

// ---- Types ----

/** A single item in a TugPopupMenu. */
export interface TugPopupMenuItem {
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
 * Props for TugPopupMenu.
 *
 * TugPopupMenu is headless: the caller provides the trigger ReactNode.
 * The trigger element must accept Radix-injected props (ref, data-state,
 * aria-expanded, etc.) -- any HTML element or forwardRef component does.
 */
export interface TugPopupMenuProps {
  /** Trigger element. Wrapped in Radix Trigger asChild -- must accept ref. */
  trigger: React.ReactNode;
  /** List of items to display in the popup menu. */
  items: TugPopupMenuItem[];
  /** Called with the selected item's id when an item is clicked. */
  onSelect: (id: string) => void;
  /** Menu alignment relative to the trigger. Default: "start". */
  align?: "start" | "center" | "end";
  /**
   * Distance in pixels between trigger and menu content.
   * Default: 3px (works well across sm/md/lg button sizes).
   * Callers requiring precise control can pass an explicit value.
   */
  sideOffset?: number;
  /** data-testid for the menu content element. */
  "data-testid"?: string;
}

// ---- TugPopupMenu ----

/**
 * TugPopupMenu -- headless popup menu component.
 *
 * Renders a Radix-based dropdown via @radix-ui/react-dropdown-menu primitives
 * directly (no shadcn wrapper). Uses `--tug-*` semantic tokens for all
 * visual properties via tug-menu.css. The content renders into a Radix portal
 * (document root), avoiding z-index conflicts with CardFrame and other stacked
 * elements.
 *
 * The trigger is the caller-provided ReactNode, wrapped in Radix Trigger asChild.
 * The caller owns trigger presentation; the menu owns dropdown behavior. [D02]
 *
 * Selection behavior ([L06], [D01]):
 * - `onSelect` is intercepted; Radix close is prevented via event.preventDefault().
 * - A double-blink background-color animation is driven by TugAnimator (programmatic
 *   lane, needs completion sequencing to know when to close the menu).
 * - animate().finished resolves when the blink completes; the callback fires and
 *   Escape is dispatched so Radix closes the menu -- no React state involved.
 */
export function TugPopupMenu({
  trigger,
  items,
  onSelect,
  align = "start",
  sideOffset = 3,
  "data-testid": dataTestId,
}: TugPopupMenuProps) {
  // Tracks whether a blink animation is in progress to guard against re-entrant calls.
  const blinkingRef = useRef(false);

  function handleItemSelect(id: string, event: Event) {
    // Prevent Radix from immediately closing the menu.
    event.preventDefault();

    if (blinkingRef.current) return;
    blinkingRef.current = true;

    const target = event.currentTarget as HTMLElement;

    // Read the computed filled-action colors for WAAPI keyframes.
    // getPropertyValue() returns a string with leading whitespace per CSS spec;
    // .trim() is required. WAAPI cannot interpolate CSS variable references
    // directly, so we must resolve to concrete color values. [D01]
    const computed = getComputedStyle(target);
    const blinkBg = computed
      .getPropertyValue("--tug7-surface-control-primary-filled-action-active")
      .trim() || "transparent";
    const blinkFg = computed
      .getPropertyValue("--tug7-element-control-text-filled-action-active")
      .trim() || "inherit";

    // Read the standard easing value at runtime -- WAAPI does not resolve
    // var() references in easing strings. [D01]
    const easing = computed
      .getPropertyValue("--tug-motion-easing-standard")
      .trim() || "cubic-bezier(0.2, 0, 0, 1)";

    // Double-blink keyframes: highlight -> transparent -> highlight -> highlight.
    // Uses filled-action colors for strong visual feedback. [D01]
    const blinkKeyframes = [
      { backgroundColor: blinkBg, color: blinkFg },
      { backgroundColor: "transparent", color: "inherit" },
      { backgroundColor: blinkBg, color: blinkFg },
      { backgroundColor: blinkBg, color: blinkFg },
    ];

    // Drive blink via TugAnimator; sequence menu close on animate().finished.
    // slow = 350ms. blinkingRef is reset inside .finished.then() so the
    // trigger (which persists after menu close) can accept new selections. [D01]
    //
    // .catch() handles WAAPI rejection (e.g. element removed from DOM before
    // animation completes). On rejection: reset blinkingRef so the popup menu
    // stays responsive, call onSelect as a best-effort fallback, and close
    // the menu. Without this guard, blinkingRef would stay true permanently
    // and all subsequent selections would be silently swallowed.
    animate(target, blinkKeyframes, {
      duration: "--tug-motion-duration-slow",
      easing,
    }).finished.then(() => {
      blinkingRef.current = false;

      // Fire caller's callback.
      onSelect(id);

      // Close the menu by dispatching Escape -- Radix handles this natively
      // without any React state re-render.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }).catch(() => {
      // Animation rejected (element detached, interrupted, etc.).
      // Reset guard and fire the callback so selection is never lost.
      blinkingRef.current = false;
      onSelect(id);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  }

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="tug-menu-content"
          align={align}
          sideOffset={sideOffset}
          data-testid={dataTestId}
        >
          {items.map((item) => (
            <DropdownMenuPrimitive.Item
              key={item.id}
              className="tug-menu-item"
              disabled={item.disabled}
              onSelect={(event) => handleItemSelect(item.id, event)}
            >
              {item.icon !== undefined && (
                <span className="tug-menu-item-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="tug-menu-item-label">{item.label}</span>
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
