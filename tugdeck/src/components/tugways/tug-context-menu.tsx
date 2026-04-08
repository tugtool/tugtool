/**
 * TugContextMenu — Right-click context menu wrapping @radix-ui/react-context-menu.
 *
 * A compositional component: all visual identity is delegated to tug-menu.css [L20].
 * No component CSS file — uses the same `.tug-menu-*` classes and `--tugx-menu-*`
 * tokens as TugPopupMenu, sharing the menu token owner without duplication.
 *
 * The `children` prop is the right-click target area (a card, a row, a region),
 * wrapped by Radix ContextMenu.Trigger with asChild. Selection triggers the same
 * double-blink WAAPI animation used by TugPopupMenu — appearance via CSS/DOM,
 * never React state [L06]. Radix close is deferred until animation completes
 * via animate().finished sequencing [L16]. Items, separators, and labels render
 * with their own Radix primitives into a Portal, giving correct z-index stacking
 * without CSS conflicts [L19].
 *
 * Laws: [L06] appearance via CSS/DOM, [L16] foreground rules declare surfaces,
 *       [L19] component authoring guide, [L20] token sovereignty
 */

import "./tug-menu.css";

import React, { useRef } from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { playMenuItemBlink } from "@/components/tugways/tug-menu-item-blink";

// ---- Types ----

/** An action item in the context menu. */
export interface TugContextMenuItem {
  /**
   * Entry type. Omit or set to "item" for action items.
   * @default "item"
   */
  type?: "item";
  /** Unique identifier passed to onSelect when clicked. */
  id: string;
  /** Display label for this item. */
  label: string;
  /** Optional icon node rendered before the label. */
  icon?: React.ReactNode;
  /** Optional keyboard shortcut hint rendered after the label. */
  shortcut?: string;
  /** Whether this item is disabled. Disabled items are not interactive. */
  disabled?: boolean;
}

/** A horizontal rule separating item groups. */
export interface TugContextMenuSeparator {
  type: "separator";
}

/** A non-interactive section label. */
export interface TugContextMenuLabel {
  type: "label";
  /** Label text. */
  label: string;
}

/** Discriminated union of all entry types in a TugContextMenu items array. */
export type TugContextMenuEntry =
  | TugContextMenuItem
  | TugContextMenuSeparator
  | TugContextMenuLabel;

// ---- Props ----

export interface TugContextMenuProps {
  /** Menu entries — items, separators, and section labels. */
  items: TugContextMenuEntry[];
  /** Called with the selected item's id when an item is activated. */
  onSelect?: (id: string) => void;
  /** Called when the open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** The right-click target area. Wrapped by Radix ContextMenu.Trigger with asChild. */
  children: React.ReactElement;
}

// ---- TugContextMenu ----

/**
 * TugContextMenu — right-click context menu.
 *
 * Wraps @radix-ui/react-context-menu directly (no shadcn intermediary).
 * Visual identity delegated entirely to tug-menu.css [L20].
 *
 * Selection behavior:
 * - onSelect fires after a double-blink WAAPI animation, identical to TugPopupMenu.
 * - event.preventDefault() prevents Radix from closing the menu immediately.
 * - animate().finished sequences the menu close via an Escape KeyboardEvent dispatch.
 * - blinkingRef guards against re-entrant calls during the animation. [L06]
 */
export function TugContextMenu({
  items,
  onSelect,
  onOpenChange,
  children,
}: TugContextMenuProps) {
  // Guards against re-entrant blink calls during animation.
  const blinkingRef = useRef(false);

  function handleItemSelect(id: string, event: Event) {
    // Prevent Radix from immediately closing the menu.
    event.preventDefault();

    if (blinkingRef.current) return;
    blinkingRef.current = true;

    const target = event.currentTarget as HTMLElement;

    // Drive the shared double-blink feedback, then fire onSelect and
    // close the menu by dispatching Escape — Radix handles close
    // natively, no React state re-render required [L06]. The blink
    // helper resolves even if the animation is interrupted, so the
    // callback is never lost.
    playMenuItemBlink(target).then(() => {
      blinkingRef.current = false;
      onSelect?.(id);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  }

  return (
    <ContextMenuPrimitive.Root onOpenChange={onOpenChange}>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          data-slot="tug-context-menu"
          className="tug-menu-content"
        >
          {items.map((entry, index) => {
            if (entry.type === "separator") {
              return (
                <ContextMenuPrimitive.Separator
                  key={index}
                  className="tug-menu-separator"
                />
              );
            }

            if (entry.type === "label") {
              return (
                <ContextMenuPrimitive.Label
                  key={index}
                  className="tug-menu-label"
                >
                  {entry.label}
                </ContextMenuPrimitive.Label>
              );
            }

            // Default: action item (type === "item" or type is undefined)
            return (
              <ContextMenuPrimitive.Item
                key={entry.id}
                className="tug-menu-item"
                disabled={entry.disabled}
                onSelect={(event) => handleItemSelect(entry.id, event)}
              >
                {entry.icon !== undefined && (
                  <span className="tug-menu-item-icon" aria-hidden="true">
                    {entry.icon}
                  </span>
                )}
                <span className="tug-menu-item-label">{entry.label}</span>
                {entry.shortcut !== undefined && (
                  <span className="tug-menu-item-shortcut">{entry.shortcut}</span>
                )}
              </ContextMenuPrimitive.Item>
            );
          })}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
