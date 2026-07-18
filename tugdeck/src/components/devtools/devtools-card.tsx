/**
 * devtools-card.tsx — DevTools card (app-level singleton).
 *
 * The interim home for the Log and Telemetry inspectors after the Lens
 * rework moved them off the rail. A single card hosting the two inspectors
 * behind an internal `TugTabBar` (the Settings-card idiom) — a fixed,
 * non-closable tab set, not a multi-card pane stack. Opened by ⌥⌘/ (the
 * `show-devtools` action), reachable only that way (`hidden` from the `[+]`
 * type picker).
 *
 * The Telemetry tab follows the last non-DevTools key card — "the session I'm
 * working in" — via `useTrackLastNonLensKeyCard(<this card's id>)`, the same
 * follow the Lens used, excluding this card from the follow.
 *
 * Laws: tab selection is card-local data (`useState`, [L02]); the tab bar
 * dispatches `selectTab` through the chain to this card's responder ([L11]);
 * layout lives in devtools-card.css ([L06]).
 *
 * @module components/devtools/devtools-card
 */

import React, { useContext, useId, useState } from "react";

import { registerCard } from "@/card-registry";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { CardIdContext } from "@/lib/card-id-context";
import type { CardState } from "@/layout-tree";
import { useTrackLastNonLensKeyCard } from "@/components/lens/lens-followed-card";
import { LogInspector } from "./log-inspector";
import { TelemetryInspector } from "./telemetry-inspector";
import "./devtools-card.css";

type DevToolsTabId = "log" | "telemetry";

interface DevToolsTabSpec {
  readonly id: DevToolsTabId;
  readonly label: string;
  readonly icon: string;
}

const TABS: readonly DevToolsTabSpec[] = [
  { id: "log", label: "Log", icon: "ScrollText" },
  { id: "telemetry", label: "Telemetry", icon: "Activity" },
];

const TAB_CARDS: readonly CardState[] = TABS.map((spec) => ({
  id: spec.id,
  componentId: "devtools-tab",
  title: spec.label,
  icon: spec.icon,
  closable: false,
}));

/** The Telemetry tab — follows the last non-DevTools key card. */
function DevToolsTelemetryPane(): React.ReactElement {
  const cardId = useContext(CardIdContext) ?? "";
  const followedId = useTrackLastNonLensKeyCard(cardId);
  return <TelemetryInspector selectedCardId={followedId} />;
}

export function DevToolsCardContent(): React.ReactElement {
  const [tab, setTab] = useState<DevToolsTabId>("log");

  const tabBarId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectTab: { [tabBarId]: (id: string) => setTab(id as DevToolsTabId) },
  });

  return (
    <ResponderScope>
      <div className="devtools-card" data-testid="devtools-card">
        <div className="devtools-card-tabs">
          <TugTabBar
            stackId="devtools"
            cards={TAB_CARDS}
            activeCardId={tab}
            senderId={tabBarId}
            addable={false}
            ref={responderRef as (el: HTMLDivElement | null) => void}
          />
        </div>
        <div className="devtools-card-panel">
          {tab === "log" ? <LogInspector /> : null}
          {tab === "telemetry" ? <DevToolsTelemetryPane /> : null}
        </div>
      </div>
    </ResponderScope>
  );
}

/**
 * Register the DevTools card. `hidden` keeps it out of the type-picker `[+]`
 * menu: it is reachable only through ⌥⌘/ (`show-devtools`).
 */
export function registerDevtoolsCard(): void {
  registerCard({
    componentId: "devtools",
    contentFactory: () => <DevToolsCardContent />,
    defaultMeta: { title: "DevTools", closable: true },
    hidden: true,
    sizePolicy: {
      min: { width: 420, height: 360 },
      preferred: { width: 560, height: 720 },
    },
  });
}
