/**
 * CardHeader — React component for the standard 28px header bar.
 *
 * Structure (left to right):
 *   icon (14px lucide-react) | title | spacer | [menu btn] | [collapse btn] | [close btn]
 *
 * Drag initiation: onPointerDown on the header root (excluding buttons)
 * calls onDragStart, enabling cards to be dragged by the header.
 *
 * The `isKey` prop applies the `card-header-key` class for the key-panel tint.
 *
 * CSS class names preserved for test selector compatibility:
 *   .card-header, .card-header-icon, .card-header-title,
 *   .card-header-spacer, .card-header-btn, .card-header-key
 *
 * [D02] React synthetic events for all pointer interactions
 * [D07] lucide-react replaces vanilla lucide for chrome icons
 * Spec S02
 */

import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  MessageSquare,
  Terminal,
  GitBranch,
  FolderOpen,
  Activity,
  Info,
  Settings,
  Code,
  Box,
  EllipsisVertical,
  Minus,
  X,
} from "lucide-react";
import type { TugCardMeta } from "@/cards/card";
import { CardDropdownMenu } from "@/components/chrome/card-dropdown-menu";

// ---- Icon lookup map (string name → lucide-react component) ----

const ICON_MAP: Record<string, LucideIcon> = {
  MessageSquare,
  Terminal,
  GitBranch,
  FolderOpen,
  Activity,
  Info,
  Settings,
  Code,
};

// ---- Props ----

export interface CardHeaderProps {
  meta: TugCardMeta;
  isKey: boolean;
  showCollapse?: boolean;
  onClose: () => void;
  onCollapse: () => void;
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Additional inline styles merged onto the header root element. Used by CardFrame to apply docked border-radius. */
  style?: React.CSSProperties;
}

// ---- Component ----

export function CardHeader({
  meta,
  isKey,
  showCollapse = false,
  onClose,
  onCollapse,
  onDragStart,
  style: extraStyle,
}: CardHeaderProps) {
  const IconComponent = ICON_MAP[meta.icon] ?? Box;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore events that originate from buttons
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    onDragStart?.(e);
  };

  const baseStyle: React.CSSProperties = onDragStart ? { cursor: "grab" } : {};
  const mergedStyle: React.CSSProperties = extraStyle
    ? { ...baseStyle, ...extraStyle }
    : baseStyle;

  return (
    <div
      className={`card-header${isKey ? " card-header-key" : ""}`}
      style={Object.keys(mergedStyle).length > 0 ? mergedStyle : undefined}
      onPointerDown={onDragStart ? handlePointerDown : undefined}
    >
      {/* Icon */}
      <div className="card-header-icon">
        <IconComponent width={14} height={14} />
      </div>

      {/* Title */}
      <div className="card-header-title">{meta.title}</div>

      {/* Spacer */}
      <div className="card-header-spacer" />

      {/* Menu button — only rendered when menuItems are present */}
      {meta.menuItems.length > 0 && (
        <CardDropdownMenu
          items={meta.menuItems}
          trigger={
            <button
              className="card-header-btn"
              aria-label="Card menu"
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <EllipsisVertical width={14} height={14} />
            </button>
          }
          align="end"
          side="bottom"
        />
      )}

      {/* Collapse button — docked panels only */}
      {showCollapse && (
        <button
          className="card-header-btn"
          aria-label="Collapse card"
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
        >
          <Minus width={14} height={14} />
        </button>
      )}

      {/* Close button — only rendered when meta.closable */}
      {meta.closable && (
        <button
          className="card-header-btn"
          aria-label="Close card"
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X width={14} height={14} />
        </button>
      )}
    </div>
  );
}
