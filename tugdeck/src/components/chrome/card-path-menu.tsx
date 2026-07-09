/**
 * card-path-menu.tsx — the Finder-style breadcrumb menu a Cmd-click on
 * a card's title/icon opens, showing the path to the card's bound
 * resource (Dev card → project directory, File card → edited file).
 *
 * Segments are listed innermost-first (leaf at the top, like the macOS
 * title-bar path menu), the leaf carrying a check. Anchored to the
 * title element via a virtual ref, controlled open — the same anchored,
 * programmatically-opened popover shape the close-confirm popover in
 * the title bar uses. Display-only for now: no per-segment navigation.
 *
 * Laws: composes `TugPopover` + `TugPopupList` (each keeps its own
 * tokens [L20]); anchored controlled-open popover, no card-local state.
 *
 * @module components/chrome/card-path-menu
 */

import React, { useMemo } from "react";
import { Check, File as FileIcon, Folder } from "lucide-react";

import {
  TugPopover,
  TugPopoverAnchor,
  TugPopoverContent,
} from "@/components/tugways/tug-popover";
import {
  TugPopupListFrame,
  TugPopupListItem,
} from "@/components/tugways/tug-popup-list";
import type { CardResourcePath } from "@/lib/card-resource-path";

export interface CardPathMenuProps {
  open: boolean;
  /** The title element the menu anchors to (a virtual Radix anchor). */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** The resource path to display; null closes / renders nothing. */
  resource: CardResourcePath | null;
  onOpenChange: (open: boolean) => void;
}

/** Split an absolute path into innermost-first segments. */
function segmentsOf(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0).reverse();
}

export function CardPathMenu({
  open,
  anchorRef,
  resource,
  onOpenChange,
}: CardPathMenuProps) {
  const segments = useMemo(
    () => (resource !== null ? segmentsOf(resource.path) : []),
    [resource],
  );

  // Radix reads the virtual anchor only while open; gate on a resolved
  // resource so it never reads a stale/empty path.
  if (resource === null) return null;

  return (
    <TugPopover open={open} onOpenChange={onOpenChange}>
      <TugPopoverAnchor virtualRef={anchorRef} />
      <TugPopoverContent side="bottom" align="start" sideOffset={6}>
        <TugPopupListFrame title="Path" kind="item">
          {segments.map((name, i) => {
            const isLeaf = i === 0;
            const leafIsFile = isLeaf && resource.kind === "file";
            return (
              <TugPopupListItem
                key={`${i}-${name}`}
                indicator={leafIsFile ? <FileIcon /> : <Folder />}
                action={isLeaf ? <Check /> : undefined}
              >
                {name}
              </TugPopupListItem>
            );
          })}
        </TugPopupListFrame>
      </TugPopoverContent>
    </TugPopover>
  );
}
