/**
 * `TabStrip` — inspector-tab switcher built on `TugTabBar`.
 *
 * Reuses the deck-pane tab vocabulary (TugTabBar is the canonical tab
 * primitive in tugways; see `tug-choice-group.tsx`'s "NOT a tab bar"
 * disclaimer). Inspector tabs are non-closable (`closable: false`)
 * and the `+ Add` affordance is hidden via panel-scoped CSS (the
 * inspector catalog is fixed at compile time, not user-extensible).
 *
 * Dispatch wiring: `TugTabBar` emits `selectTab` through the responder
 * chain. The strip hosts its own `useResponderForm` so consumers
 * don't have to know that detail — externally the strip exposes a
 * simple `onSelect(id)` callback.
 *
 * @module components/tug-dev-panel/tab-strip
 */

import React, { useId } from "react";

import { cn } from "@/lib/utils";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import type { CardState } from "@/layout-tree";
import {
  VALID_DEV_PANEL_TABS,
  type TugDevPanelTabId,
} from "@/lib/tug-dev-panel-store/types";

export interface TabDescriptor {
  id: TugDevPanelTabId;
  label: string;
  /**
   * Optional override for the `componentId` placed on the synthesised
   * `CardState` passed into `TugTabBar`. The tab bar resolves the
   * tab's icon by looking up this id in the global card registry —
   * see `inspector-tab-registrations.tsx` for how the dev panel
   * registers icon-only "card types" for its inspector tabs.
   *
   * When omitted, falls back to `id` (the same value used as the tab
   * key) — useful for tabs that intentionally render with the default
   * `Diamond` placeholder icon.
   */
  componentId?: string;
}

export interface TabStripProps {
  tabs: ReadonlyArray<TabDescriptor>;
  activeTab: TugDevPanelTabId;
  onSelect: (tab: TugDevPanelTabId) => void;
  className?: string;
}

/**
 * Map inspector-tab descriptors onto `CardState` (TugTabBar's input
 * shape). `componentId` is taken from the descriptor when present
 * (so the tab bar's registry-driven icon lookup hits the inspector
 * registration) and otherwise falls back to the tab id.
 */
function tabsToCardStates(
  tabs: ReadonlyArray<TabDescriptor>,
): readonly CardState[] {
  return tabs.map((t) => ({
    id: t.id,
    componentId: t.componentId ?? t.id,
    title: t.label,
    closable: false,
  }));
}

function isValidTab(id: string): id is TugDevPanelTabId {
  return VALID_DEV_PANEL_TABS.has(id as TugDevPanelTabId);
}

export const TabStrip: React.FC<TabStripProps> = ({
  tabs,
  activeTab,
  onSelect,
  className,
}) => {
  const senderId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    selectTab: {
      [senderId]: (id: string) => {
        if (isValidTab(id)) {
          onSelect(id);
        }
      },
    },
    // closeTab + addTab never fire: tabs are non-closable and the
    // `+ Add` button is hidden via panel-scoped CSS. Registered as
    // no-ops so the responder framework has explicit bindings rather
    // than warning on unbound chain actions.
    closeTab: { [senderId]: () => {} },
    addTab: { [senderId]: () => {} },
  });

  const cardStates = tabsToCardStates(tabs);

  return (
    <ResponderScope>
      <div
        ref={responderRef as (el: HTMLDivElement | null) => void}
        className={cn("tug-devpanel-tabstrip", className)}
      >
        <TugTabBar
          stackId="tug-devpanel-inspector-tabs"
          cards={cardStates}
          activeCardId={activeTab}
          senderId={senderId}
          /* Empty `acceptedFamilies` ensures the type-picker yields no
           * items; the `+` button is additionally hidden via CSS so
           * the inspector chrome stays static. */
          acceptedFamilies={[]}
        />
      </div>
    </ResponderScope>
  );
};
TabStrip.displayName = "TabStrip";
