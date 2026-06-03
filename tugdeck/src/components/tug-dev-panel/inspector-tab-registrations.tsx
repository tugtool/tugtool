/**
 * `inspector-tab-registrations` — register lightweight card-registry
 * entries for the dev panel's inspector tabs.
 *
 * Background: `TugTabBar` resolves each tab's icon by looking up
 * `card.componentId` in the global card registry and reading
 * `defaultMeta.icon`. The dev panel's inspector tabs are not real
 * cards — there is no content factory used at runtime (the panel
 * branches on `activeTab` and renders the appropriate inspector
 * directly). But we still want each tab to carry a meaningful icon.
 *
 * This module registers the inspector tab ids as "card types" purely
 * so their icons resolve. The `contentFactory` returns `null` because
 * it is never invoked — `TugDevPanel` is the consumer, not
 * `DeckCanvas`.
 *
 * Family namespacing: registrations use the `"_devpanel_inspector"`
 * family, which no other registration uses. Since the default tab
 * picker family is `"standard"`, these inspector "card types" never
 * surface in user-facing tab pickers — they exist exclusively for
 * icon resolution.
 *
 * @module components/tug-dev-panel/inspector-tab-registrations
 */

import { registerCard } from "@/card-registry";

/**
 * Component ids the dev panel uses for its inspector tabs. The shape
 * mirrors `TugDevPanelTabId` so the mapping at the consumer is a
 * direct dictionary lookup.
 */
export const DEV_PANEL_INSPECTOR_COMPONENT_IDS = {
  telemetry: "_devpanel_inspector_telemetry",
  log: "_devpanel_inspector_log",
  settings: "_devpanel_inspector_settings",
} as const;

/** Lucide icon name used for the Telemetry tab. */
const TELEMETRY_TAB_ICON = "RadioTower";

/** Lucide icon name used for the Log tab. */
const LOG_TAB_ICON = "Logs";

/** Lucide icon name used for the Settings tab. */
const SETTINGS_TAB_ICON = "SlidersHorizontal";

/**
 * Register the inspector tabs. Idempotent — `registerCard` warns and
 * overwrites on duplicate, so a second call (e.g. after HMR) replaces
 * the existing entries.
 *
 * Called once at app boot from `main.tsx`.
 */
export function registerDevPanelInspectorTabs(): void {
  registerCard({
    componentId: DEV_PANEL_INSPECTOR_COMPONENT_IDS.telemetry,
    family: "_devpanel_inspector",
    // Never invoked — TugDevPanel renders TelemetryInspector directly.
    contentFactory: () => null,
    defaultMeta: {
      title: "Telemetry",
      icon: TELEMETRY_TAB_ICON,
      closable: false,
    },
  });
  registerCard({
    componentId: DEV_PANEL_INSPECTOR_COMPONENT_IDS.log,
    family: "_devpanel_inspector",
    contentFactory: () => null,
    defaultMeta: {
      title: "Log",
      icon: LOG_TAB_ICON,
      closable: false,
    },
  });
  registerCard({
    componentId: DEV_PANEL_INSPECTOR_COMPONENT_IDS.settings,
    family: "_devpanel_inspector",
    contentFactory: () => null,
    defaultMeta: {
      title: "Settings",
      icon: SETTINGS_TAB_ICON,
      closable: false,
    },
  });
}
