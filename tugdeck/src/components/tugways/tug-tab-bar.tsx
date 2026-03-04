/**
 * TugTabBar -- presentational tab strip for multi-tab Tugcards.
 *
 * Renders in the Tugcard accessory slot when a card has more than one tab.
 * Purely presentational: no DeckManager coupling. All state changes flow
 * through callback props to DeckManager which updates CardState.
 *
 * **Authoritative references:**
 * - [D03] Tab bar uses the Tugcard accessory slot
 * - Spec S01: TugTabBarProps
 * - Spec S08: Tab drag initiation (threshold + coordinator.startDrag)
 * - Table T01: Tab visual states
 * - (#s01-tab-bar-props, #t01-tab-visual-states, #d03-tab-bar-accessory,
 *   #s08-tab-bar-drag-init, #tab-bar-drag-integration)
 */

import React, { useCallback } from "react";
import { icons } from "lucide-react";
import type { TabItem } from "@/layout-tree";
import { getAllRegistrations } from "@/card-registry";
import { TugDropdown } from "./tug-dropdown";
import type { TugDropdownItem } from "./tug-dropdown";
import { tabDragCoordinator, exceedsDragThreshold } from "@/tab-drag-coordinator";
import "./tug-tab-bar.css";

// ---- Types (Spec S01) ----

/**
 * Props for TugTabBar.
 *
 * **Authoritative reference:** Spec S01 TugTabBarProps.
 */
export interface TugTabBarProps {
  /** Unique card instance ID. Stamped as data-card-id on the bar div so the
   *  TabDragCoordinator's hit-test cache can locate this bar at drag-start. */
  cardId: string;
  /** All tabs on this card. */
  tabs: TabItem[];
  /** The currently active tab id. */
  activeTabId: string;
  /** Called when the user clicks a tab to select it. */
  onTabSelect: (tabId: string) => void;
  /** Called when the user clicks the close button on a tab. */
  onTabClose: (tabId: string) => void;
  /** Called when the user selects a card type from the [+] type picker. */
  onTabAdd: (componentId: string) => void;
  /**
   * Families of card types to show in the [+] type picker.
   * Only registrations whose `family` matches one of these strings appear.
   * Defaults to `["standard"]` when omitted.
   *
   * **Authoritative reference:** [D03] acceptsFamilies field, Spec S05.
   */
  acceptedFamilies?: readonly string[];
}

// ---- Helpers ----

/**
 * Render a lucide icon by name, or null if the name is absent or unrecognised.
 * Mirrors the pattern in tugcard.tsx.
 */
function renderIcon(iconName: string | undefined): React.ReactNode {
  if (!iconName) return null;
  const IconComponent = icons[iconName as keyof typeof icons];
  if (!IconComponent) return null;
  return React.createElement(IconComponent, { size: 12 });
}

// ---- TugTabBar ----

/**
 * TugTabBar -- horizontal tab strip component.
 *
 * Renders each tab as a button with an optional icon and title.
 * The active tab has `data-active="true"` set for CSS targeting (Table T01).
 * A [+] button at the end opens a TugDropdown type picker listing all
 * registered card types; selecting one calls `onTabAdd(componentId)`.
 *
 * Tab drag initiation uses a 5px threshold pattern: onPointerDown registers
 * document-level listeners to track movement without acquiring pointer capture.
 * Once the threshold is exceeded, document-level listeners are removed and
 * `tabDragCoordinator.startDrag()` is called, which acquires pointer capture
 * and takes over the drag gesture. Sub-threshold pointer moves do not
 * interfere with the click event sequence, so click-to-select still works.
 * [D01, Spec S08]
 *
 * All interactive elements have `user-select: none` (enforced in CSS).
 * All appearance changes go through CSS `data-active` attribute, never React state.
 */
export function TugTabBar({
  cardId,
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabAdd,
  acceptedFamilies,
}: TugTabBarProps) {
  // Resolve effective families: default to ["standard"] when prop is omitted.
  const effectiveFamilies = acceptedFamilies ?? ["standard"];

  // Build the type-picker dropdown items from registered card types,
  // filtered by family. A registration with no `family` field is treated as
  // "standard" (default family). Only registrations whose family is in
  // effectiveFamilies are shown.
  const typePickerItems: TugDropdownItem[] = Array.from(getAllRegistrations().values())
    .filter((reg) => effectiveFamilies.includes(reg.family ?? "standard"))
    .map((reg) => ({
      id: reg.componentId,
      label: reg.defaultMeta.title,
      icon: renderIcon(reg.defaultMeta.icon),
    }));

  // Stable handler for [+] button type picker selection.
  const handleTypeSelect = useCallback(
    (componentId: string) => {
      onTabAdd(componentId);
    },
    [onTabAdd],
  );

  return (
    <div
      className="tug-tab-bar"
      role="tablist"
      data-testid="tug-tab-bar"
      data-card-id={cardId}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        const handleTabClick = () => {
          onTabSelect(tab.id);
        };

        const handleCloseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
          // Stop propagation so the close click does not trigger tab select.
          event.stopPropagation();
          onTabClose(tab.id);
        };

        const iconName = getAllRegistrations().get(tab.componentId)?.defaultMeta.icon;
        const iconNode = renderIcon(iconName);

        /**
         * Drag initiation with 5px threshold. [D01, Spec S08]
         *
         * On pointerdown: register document-level pointermove/pointerup to
         * track movement without acquiring pointer capture. This preserves the
         * normal click sequence for sub-threshold interactions.
         *
         * On first pointermove exceeding 5px: remove document-level listeners
         * and hand off to tabDragCoordinator.startDrag(), which acquires
         * pointer capture on the tab element.
         *
         * On pointerup before threshold: remove document-level listeners so
         * the normal onClick fires unimpeded.
         */
        const handleTabPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
          // Only primary pointer button (left click / touch).
          if (event.button !== 0) return;

          const nativeEvent = event.nativeEvent;
          const tabElement = event.currentTarget;
          const startX = nativeEvent.clientX;
          const startY = nativeEvent.clientY;

          function onDocumentMove(e: PointerEvent) {
            if (exceedsDragThreshold(startX, startY, e.clientX, e.clientY)) {
              cleanup();
              tabDragCoordinator.startDrag(e, tabElement, cardId, tab.id, tabs.length);
            }
          }

          function onDocumentUp() {
            cleanup();
            // Allow normal onClick to fire -- no intervention needed.
          }

          function cleanup() {
            document.removeEventListener("pointermove", onDocumentMove);
            document.removeEventListener("pointerup", onDocumentUp);
          }

          document.addEventListener("pointermove", onDocumentMove);
          document.addEventListener("pointerup", onDocumentUp);
        };

        return (
          <div
            key={tab.id}
            role="tab"
            className="tug-tab"
            data-active={isActive ? "true" : undefined}
            data-testid={`tug-tab-${tab.id}`}
            aria-selected={isActive}
            tabIndex={0}
            onClick={handleTabClick}
            onPointerDown={handleTabPointerDown}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleTabClick();
            }}
          >
            {iconNode !== null && (
              <span className="tug-tab-icon" aria-hidden="true">
                {iconNode}
              </span>
            )}
            <span className="tug-tab-title">{tab.title}</span>
            {tab.closable && (
              <button
                type="button"
                className="tug-tab-close"
                onClick={handleCloseClick}
                aria-label={`Close ${tab.title} tab`}
                data-testid={`tug-tab-close-${tab.id}`}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {/* [+] type picker button */}
      <TugDropdown
        trigger={
          <button
            type="button"
            className="tug-tab-add"
            aria-label="Add tab"
            data-testid="tug-tab-add"
          >
            +
          </button>
        }
        items={typePickerItems}
        onSelect={handleTypeSelect}
      />
    </div>
  );
}
