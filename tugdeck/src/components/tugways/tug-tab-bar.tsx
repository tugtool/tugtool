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
 * - Table T01: Tab visual states
 * - (#s01-tab-bar-props, #t01-tab-visual-states, #d03-tab-bar-accessory)
 */

import React, { useCallback } from "react";
import { icons } from "lucide-react";
import type { TabItem } from "@/layout-tree";
import { getAllRegistrations } from "@/card-registry";
import { TugDropdown } from "./tug-dropdown";
import type { TugDropdownItem } from "./tug-dropdown";
import "./tug-tab-bar.css";

// ---- Types (Spec S01) ----

/**
 * Props for TugTabBar.
 *
 * **Authoritative reference:** Spec S01 TugTabBarProps.
 */
export interface TugTabBarProps {
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
 * All interactive elements have `user-select: none` (enforced in CSS).
 * All appearance changes go through CSS `data-active` attribute, never React state.
 */
export function TugTabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabAdd,
}: TugTabBarProps) {
  // Build the type-picker dropdown items from all registered card types.
  const typePickerItems: TugDropdownItem[] = Array.from(getAllRegistrations().values()).map(
    (reg) => ({
      id: reg.componentId,
      label: reg.defaultMeta.title,
      icon: renderIcon(reg.defaultMeta.icon),
    }),
  );

  // Stable handler for [+] button type picker selection.
  const handleTypeSelect = useCallback(
    (componentId: string) => {
      onTabAdd(componentId);
    },
    [onTabAdd],
  );

  return (
    <div className="tug-tab-bar" role="tablist" data-testid="tug-tab-bar">
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
