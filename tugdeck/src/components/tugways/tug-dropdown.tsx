/**
 * TugDropdown -- tugways public API for dropdown menus.
 *
 * Wraps @radix-ui/react-dropdown-menu directly (no shadcn intermediary).
 * App code imports TugDropdown; never imports from components/ui/dropdown-menu.
 *
 * TugDropdown owns its trigger button internally. Callers pass label,
 * emphasis, role, size, and icon props instead of a trigger ReactNode.
 * TugDropdown renders a TugButton with a ChevronDown trailing icon.
 *
 * **Authoritative references:**
 * - [D01] Radix-direct wrapping replaces shadcn
 * - [D05] TugDropdown owns its trigger button
 * - Spec S04: TugDropdownProps
 * - (#s04-tug-dropdown-props, #d01-radix-direct, #d05-dropdown-owns-trigger)
 */

import React, { useRef, useState, useCallback } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { TugButton } from "./tug-button";
import type { TugButtonEmphasis, TugButtonRole, TugButtonSize } from "./tug-button";
import { animate } from "@/components/tugways/tug-animator";
import "./tug-menu.css";

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
 * TugDropdown renders its own trigger button internally. Pass label,
 * emphasis, role, size, and icon to configure the trigger appearance.
 * When icon is provided, the trigger uses icon-text subtype; otherwise text.
 *
 * **Authoritative reference:** Spec S04 TugDropdownProps.
 */
export interface TugDropdownProps {
  /** Trigger button label content. Accepts string or ReactNode (e.g., styled badge span). */
  label: React.ReactNode;
  /** Trigger button emphasis. Default: "outlined". */
  emphasis?: TugButtonEmphasis;
  /** Trigger button role. Default: "action". */
  role?: TugButtonRole;
  /** Trigger button size. Default: "md". */
  size?: TugButtonSize;
  /** Optional leading icon for the trigger button. When provided, uses icon-text subtype. */
  icon?: React.ReactNode;
  /** List of items to display in the dropdown. */
  items: TugDropdownItem[];
  /** Called with the selected item's id when an item is clicked. */
  onSelect: (id: string) => void;
  /** Additional CSS class names for the trigger button. */
  className?: string;
  /** aria-label for the trigger button. */
  "aria-label"?: string;
  /** data-testid for the trigger button. */
  "data-testid"?: string;
}

// ---- TugDropdown ----

/**
 * TugDropdown -- tugways dropdown menu component.
 *
 * Renders a Radix-based dropdown via @radix-ui/react-dropdown-menu primitives
 * directly (no shadcn wrapper). Uses `--tug-base-*` semantic tokens for all
 * visual properties. The content renders into a Radix portal (document root),
 * avoiding z-index conflicts with CardFrame and other stacked elements.
 *
 * The trigger is a TugButton rendered internally with a ChevronDown trailing
 * icon. Radix's Trigger with asChild automatically composes its internal ref
 * with TugButton's forwardRef -- no manual ref merging utility is needed.
 * [D05] TugDropdown owns its trigger button.
 *
 * All colors use var(--tug-base-*) semantic tokens for zero-re-render theme switching.
 *
 * Selection behavior (Rule 4 compliant, [D01]):
 * - `onSelect` is intercepted; Radix close is prevented via event.preventDefault().
 * - A double-blink background-color animation is driven by TugAnimator (programmatic
 *   lane, Rule 13 — needs completion sequencing to know when to close the menu).
 * - animate().finished resolves when the blink completes; the callback fires and
 *   Escape is dispatched so Radix closes the menu — no React state involved.
 */
/** Side offset between trigger and dropdown content, in ems. */
const SIDE_OFFSET_EM = 0.25;

export function TugDropdown({
  label,
  emphasis,
  role,
  size,
  icon,
  items,
  onSelect,
  className,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
}: TugDropdownProps) {
  // Tracks whether a blink animation is in progress to guard against re-entrant calls.
  const blinkingRef = useRef(false);

  // Resolve em-based offset to pixels from the trigger's font size.
  const [sideOffsetPx, setSideOffsetPx] = useState(3); // sensible fallback

  // triggerRef: narrowed to HTMLButtonElement to match TugButton's Ref<HTMLButtonElement>.
  // The function body only calls getComputedStyle(node) which accepts any Element,
  // so narrowing from HTMLElement to HTMLButtonElement is safe. [D05]
  const triggerRef = useCallback((node: HTMLButtonElement | null) => {
    if (node) {
      const fontSize = parseFloat(getComputedStyle(node).fontSize) || 13;
      setSideOffsetPx(Math.round(SIDE_OFFSET_EM * fontSize));
    }
  }, []);

  // Determine subtype: icon-text when icon is provided, text otherwise. [D05]
  const subtype = icon ? "icon-text" : "text";

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
      .getPropertyValue("--tug-base-control-filled-action-bg-active")
      .trim() || "transparent";
    const blinkFg = computed
      .getPropertyValue("--tug-base-control-filled-action-fg-active")
      .trim() || "inherit";

    // Read the standard easing value at runtime — WAAPI does not resolve
    // var() references in easing strings. [D01]
    const easing = computed
      .getPropertyValue("--tug-base-motion-easing-standard")
      .trim() || "cubic-bezier(0.2, 0, 0, 1)";

    // Double-blink keyframes: highlight → transparent → highlight → highlight.
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
    // animation completes). On rejection: reset blinkingRef so the dropdown
    // stays responsive, call onSelect as a best-effort fallback, and close
    // the menu. Without this guard, blinkingRef would stay true permanently
    // and all subsequent selections would be silently swallowed.
    animate(target, blinkKeyframes, {
      duration: "--tug-base-motion-duration-slow",
      easing,
    }).finished.then(() => {
      blinkingRef.current = false;

      // Fire caller's callback.
      onSelect(id);

      // Close the menu by dispatching Escape — Radix handles this natively
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
        <TugButton
          ref={triggerRef}
          subtype={subtype}
          emphasis={emphasis}
          role={role}
          size={size}
          icon={icon}
          trailingIcon={<ChevronDown size={12} />}
          className={className}
          aria-label={ariaLabel}
          data-testid={dataTestId}
        >
          {label}
        </TugButton>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content className="tug-dropdown-content" align="start" sideOffset={sideOffsetPx}>
          {items.map((item) => (
            <DropdownMenuPrimitive.Item
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
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
