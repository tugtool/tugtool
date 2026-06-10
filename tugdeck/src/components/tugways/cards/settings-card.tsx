/**
 * settings-card.tsx — Settings card (app-level singleton).
 *
 * A single card hosting the app's settings behind an internal
 * `TugTabBar` — a fixed, non-closable tab set (the help-sheet /
 * permission-rules-editor idiom), not a multi-card pane stack. Shown
 * via the app menu's Settings… item (⌘,), which routes through
 * `DeckManager.showSingletonCard("settings")` — at most one Settings
 * card exists at a time.
 *
 * Laws: tab selection is card-local data (`useState`) [L02]; the tab
 * bar dispatches `selectTab` through the chain to this card's
 * responder scope ([L11] via `useResponderForm`); layout lives in
 * settings-card.css [L06].
 *
 * @module components/tugways/cards/settings-card
 */

import React, { useId, useState } from "react";
import { registerCard } from "@/card-registry";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import type { CardState } from "@/layout-tree";
import { SettingsGeneralBody } from "./settings-general-body";
import "./settings-card.css";

// ---------------------------------------------------------------------------
// Tabs — a fixed, non-closable tab set
// ---------------------------------------------------------------------------

type SettingsTabId = "general";

interface SettingsTabSpec {
  readonly id: SettingsTabId;
  readonly label: string;
}

const TABS: readonly SettingsTabSpec[] = [{ id: "general", label: "Dev Card" }];

/**
 * The tabs as `TugTabBar` cards: fixed and non-closable (`closable:
 * false` → no per-tab ×; the bar is `addable={false}` → no `[+]`). The
 * `componentId` is a non-registered sentinel — these are panel tabs,
 * not deck cards.
 */
const TAB_CARDS: readonly CardState[] = TABS.map((spec) => ({
  id: spec.id,
  componentId: "settings-tab",
  title: spec.label,
  closable: false,
}));

// ---------------------------------------------------------------------------
// SettingsCardContent
// ---------------------------------------------------------------------------

export function SettingsCardContent() {
  const [tab, setTab] = useState<SettingsTabId>("general");

  // TugTabBar dispatches `selectTab` through the chain to this responder.
  const tabBarId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectTab: { [tabBarId]: (id: string) => setTab(id as SettingsTabId) },
  });

  return (
    <ResponderScope>
      <div className="settings-card" data-testid="settings-card">
        <div className="settings-card-tabs">
          <TugTabBar
            stackId="settings"
            cards={TAB_CARDS}
            activeCardId={tab}
            senderId={tabBarId}
            addable={false}
            ref={responderRef as (el: HTMLDivElement | null) => void}
          />
        </div>
        <div className="settings-card-panel">
          {tab === "general" ? <SettingsGeneralBody /> : null}
        </div>
      </div>
    </ResponderScope>
  );
}

// ---------------------------------------------------------------------------
// registerSettingsCard
// ---------------------------------------------------------------------------

/**
 * Register the Settings card. `hidden` keeps it out of the type-picker
 * `[+]` menu: it is reachable only through the app menu (⌘,).
 */
export function registerSettingsCard(): void {
  registerCard({
    componentId: "settings",
    contentFactory: () => <SettingsCardContent />,
    defaultMeta: { title: "Settings", closable: true },
    hidden: true,
    sizePolicy: {
      min: { width: 420, height: 420 },
      preferred: { width: 560, height: 680 },
    },
  });
}
