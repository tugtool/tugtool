/**
 * TugCompletionMenu — Floating completion popup for @-trigger typeahead.
 *
 * Displays filtered completion items anchored to the caret position.
 * Keyboard navigation is handled by the engine; this component only
 * renders the list and handles click-to-accept.
 *
 * [L06] appearance via CSS, [L15] token-driven states,
 * [L16] pairings declared, [L19] component authoring guide
 */

import "./tug-completion-menu.css";

import React, { useRef, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import type { CompletionItem } from "@/lib/tug-text-engine";

// Re-export for convenience
export type { CompletionItem };

/**
 * TugCompletionMenu props.
 */
export interface TugCompletionMenuProps {
  /** Filtered completion items to display. */
  items: CompletionItem[];
  /**
   * Index of the keyboard-selected item.
   * @selector .tug-completion-menu-item-selected
   */
  selectedIndex: number;
  /** Called when an item is clicked. */
  onAccept: (index: number) => void;
  /** Caret bounding rect for positioning. Null hides the menu. */
  anchorRect: DOMRect | null;
  /** Container element for relative positioning. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Additional CSS class names. */
  className?: string;
}

/**
 * Floating completion menu anchored to the caret.
 */
export function TugCompletionMenu({
  items,
  selectedIndex,
  onAccept,
  anchorRect,
  containerRef,
  className,
}: TugCompletionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const selected = menu.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!anchorRect || items.length === 0) return null;

  // Position relative to container
  const containerRect = containerRef.current?.getBoundingClientRect();
  const style: React.CSSProperties = containerRect
    ? {
        left: anchorRect.left - containerRect.left,
        bottom: containerRect.bottom - anchorRect.top + 4,
      }
    : {};

  return (
    <div
      ref={menuRef}
      data-slot="tug-completion-menu"
      className={cn("tug-completion-menu", className)}
      style={style}
    >
      {items.map((item, i) => (
        <div
          key={`${item.atom.type}:${item.label}`}
          className={cn(
            "tug-completion-menu-item",
            i === selectedIndex && "tug-completion-menu-item-selected",
          )}
          onPointerDown={(e) => {
            e.preventDefault(); // Don't steal focus from editor
            onAccept(i);
          }}
        >
          <span className="tug-completion-menu-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
