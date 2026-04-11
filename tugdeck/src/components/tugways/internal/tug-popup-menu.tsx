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
 * ## Open state is locally controlled
 *
 * The Radix Root is bound to a `useState<boolean>` here so TugPopupMenu
 * knows its own open state in React. Callers still get the uncontrolled
 * ergonomics — they pass a `trigger` and `items`, never touch open/close —
 * but the menu itself can observe the chain and react to external
 * dispatches. The activation close path ("an item was picked") also uses
 * this controlled state to close cleanly instead of synthesizing a
 * document-level Escape keydown.
 *
 * ## Chain-reactive dismissal via observeDispatch
 *
 * While the menu is open, TugPopupMenu subscribes to
 * `manager.observeDispatch` (matching the `tug-editor-context-menu`
 * precedent). Any action flowing through the responder chain — a keyboard
 * shortcut from the keybinding map, a button click elsewhere, a
 * programmatic dispatch — dismisses the menu. The only dispatches that do
 * NOT dismiss are the menu's own item activations, which are guarded by
 * `blinkingRef`: during the blink-animate-then-onSelect window,
 * blinkingRef is true and the observer callback skips its close. This
 * generalizes "close on external shortcut" through a single signal, per
 * [L11].
 *
 * When rendered outside a ResponderChainProvider (standalone previews,
 * unit tests that don't mount a provider), `useResponderChain()` returns
 * null and the subscription is skipped — the menu still renders and
 * opens/closes normally, it just doesn't get the chain-reactive dismiss.
 *
 * **Authoritative references:**
 * - [D02] TugPopupMenu takes a single ReactNode trigger prop
 *
 * **Law citations:** [L06] [L11] [L19]
 */

import "../tug-menu.css";

import React, { useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { animate } from "@/components/tugways/tug-animator";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";

// ---- Types ----

/** A single selectable item in a TugPopupMenu. */
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

/** A visual separator line between menu sections. */
export interface TugPopupMenuSeparator {
  type: "separator";
}

/** A non-interactive section label in the menu. */
export interface TugPopupMenuLabel {
  type: "label";
  label: string;
}

/** A sub-menu group with its own trigger and nested items. */
export interface TugPopupMenuSub {
  type: "sub";
  /** Display label for the sub-menu trigger. */
  label: string;
  /** Optional icon node rendered before the trigger label. */
  icon?: React.ReactNode;
  /** Nested entries inside the sub-menu. Supports items, separators, and labels (not nested subs). */
  items: TugPopupMenuEntry[];
}

/**
 * A single entry in a TugPopupMenu items array.
 *
 * Plain objects without a `type` field are selectable items.
 * Objects with `type: "separator"` render a divider line.
 * Objects with `type: "label"` render a non-interactive section heading.
 * Objects with `type: "sub"` render a sub-menu with a trigger and nested content.
 */
export type TugPopupMenuEntry = TugPopupMenuItem | TugPopupMenuSeparator | TugPopupMenuLabel | TugPopupMenuSub;

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
  /** List of entries to display in the popup menu. Accepts items, separators, and labels. */
  items: TugPopupMenuEntry[];
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
  /**
   * Seed the initial open state. Useful for test setups that want to
   * render a pre-opened menu without synthesizing trigger clicks through
   * Radix. Defaults to false; real consumers never set this.
   */
  defaultOpen?: boolean;
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
 * - animate().finished resolves when the blink completes; the caller's
 *   onSelect is invoked and then the locally controlled open state
 *   flips to false, closing the menu through Radix's onOpenChange path.
 */
export function TugPopupMenu({
  trigger,
  items,
  onSelect,
  align = "start",
  sideOffset = 3,
  defaultOpen = false,
  "data-testid": dataTestId,
}: TugPopupMenuProps) {
  // Tracks whether a blink animation is in progress to guard against re-entrant calls.
  const blinkingRef = useRef(false);

  // Locally controlled open state. Radix Root is bound to this so
  // TugPopupMenu can react to chain-driven dismiss requests without
  // losing any of the built-in trigger/escape/click-outside behavior:
  // those all continue to flow through Radix's internal open handlers
  // back into our setOpen via onOpenChange.
  const [open, setOpen] = useState(defaultOpen);

  // Chain manager — null when rendered outside a ResponderChainProvider
  // (standalone previews, unit tests that don't mount a provider). In
  // that case the observeDispatch subscription effect below is a no-op
  // and the menu still opens/closes normally via Radix; it just does
  // not get the chain-reactive dismiss.
  const manager = useResponderChain();

  // Subscribe to observeDispatch while the menu is open. Any action
  // flowing through the chain dismisses the menu, with one exception:
  // the menu's own item activation sets blinkingRef=true for the
  // duration of the blink-animate-then-onSelect window, and the
  // observer skips its close so the menu can finish its animation.
  // Matches the tug-editor-context-menu precedent. Uses
  // useLayoutEffect per [L03] so the subscription is in place before
  // any paint that could deliver a pointer or key event through the
  // chain. [L11]
  useLayoutEffect(() => {
    if (!open || !manager) return;
    return manager.observeDispatch(() => {
      if (blinkingRef.current) return;
      setOpen(false);
    });
  }, [open, manager]);

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
    // slow = 350ms. The close path uses the locally controlled open
    // state (setOpen(false)) rather than synthesizing a document-level
    // Escape keydown. blinkingRef stays true across the onSelect call
    // so that any chain dispatches issued by the handler (e.g.,
    // TugPopupButton's sendToFirstResponderForContinuation) are skipped by the
    // observeDispatch subscription above and do not double-close the
    // menu. blinkingRef is reset only after onSelect completes. [D01]
    //
    // .catch() handles WAAPI rejection (e.g. element removed from DOM before
    // animation completes). On rejection: fire onSelect as a best-effort
    // fallback, reset blinkingRef, and close the menu. Without this guard,
    // blinkingRef would stay true permanently and all subsequent selections
    // would be silently swallowed.
    animate(target, blinkKeyframes, {
      duration: "--tug-motion-duration-slow",
      easing,
    }).finished.then(() => {
      // Fire caller's callback while the blink guard is still active so
      // any downstream dispatches do not dismiss our own menu prematurely.
      onSelect(id);

      blinkingRef.current = false;
      setOpen(false);
    }).catch(() => {
      // Animation rejected (element detached, interrupted, etc.).
      // Fire the callback so selection is never lost, then reset guard
      // and close via controlled state.
      onSelect(id);
      blinkingRef.current = false;
      setOpen(false);
    });
  }

  /**
   * Render a list of menu entries. Extracted so the same logic handles
   * both top-level content and sub-menu content.
   */
  function renderEntries(entries: TugPopupMenuEntry[], keyPrefix: string) {
    return entries.map((entry, idx) => {
      if ("type" in entry && entry.type === "separator") {
        return (
          <DropdownMenuPrimitive.Separator
            key={`${keyPrefix}-sep-${idx}`}
            className="tug-menu-separator"
          />
        );
      }
      if ("type" in entry && entry.type === "label") {
        return (
          <DropdownMenuPrimitive.Label
            key={`${keyPrefix}-label-${idx}`}
            className="tug-menu-label"
          >
            {entry.label}
          </DropdownMenuPrimitive.Label>
        );
      }
      if ("type" in entry && entry.type === "sub") {
        return (
          <DropdownMenuPrimitive.Sub key={`${keyPrefix}-sub-${idx}`}>
            <DropdownMenuPrimitive.SubTrigger className="tug-menu-item tug-menu-sub-trigger">
              {entry.icon !== undefined && (
                <span className="tug-menu-item-icon" aria-hidden="true">
                  {entry.icon}
                </span>
              )}
              <span className="tug-menu-item-label">{entry.label}</span>
              <span className="tug-menu-sub-chevron" aria-hidden="true">
                <ChevronRight size={12} />
              </span>
            </DropdownMenuPrimitive.SubTrigger>
            <DropdownMenuPrimitive.Portal>
              <DropdownMenuPrimitive.SubContent
                className="tug-menu-content"
                sideOffset={4}
              >
                {renderEntries(entry.items, `${keyPrefix}-sub-${idx}`)}
              </DropdownMenuPrimitive.SubContent>
            </DropdownMenuPrimitive.Portal>
          </DropdownMenuPrimitive.Sub>
        );
      }
      const item = entry as TugPopupMenuItem;
      return (
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
      );
    });
  }

  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
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
          {renderEntries(items, "root")}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
