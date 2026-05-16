/**
 * `TugDevPanel` — persistent dev inspector surface. Mounts ONCE at
 * app root and toggles visibility via DOM (per [L06]) — never
 * re-mounted or torn down by parent state.
 *
 * Composed entirely from Tug components: `TugLabel`, `TugPushButton`,
 * `TugIconButton`, `TugPopupMenu`, `TugSeparator`. No raw `<button>` /
 * `<select>` / `<h2>` elements — the dev surface uses the same
 * primitives consumers do, so it stays themed and consistent.
 *
 * Conformance:
 *   - [L02] subscribes to `tugDevPanelStore` via `useSyncExternalStore`.
 *   - [L06] visibility toggles `display: none` via the `data-open`
 *     attribute; the panel tree stays in the DOM.
 *   - [L19] composes small focused components.
 *   - [L20] reads `--tugx-devpanel-*` slots only (chrome / surface
 *     tokens). Child Tug components own their own token families.
 *   - [L23] open/tab/selection persist via tugbank (TugDevPanelStore).
 *   - [L26] mount identity stable for the app lifetime.
 *   - `feedback_no_localstorage` — never used.
 *   - `feedback_persistent_text_entry` — panel does not claim a
 *     persistent text-entry destination.
 *
 * @module components/tug-dev-panel/tug-dev-panel
 */

import "./tug-dev-panel.css";

import React, { useCallback, useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";

import { tugDevPanelStore } from "@/lib/tug-dev-panel-store/tug-dev-panel-store";
import type { TugDevPanelTabId } from "@/lib/tug-dev-panel-store/types";

import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugLabel } from "@/components/tugways/tug-label";

import { CardPicker } from "./card-picker";
import { ResizeHandle } from "./resize-handle";
import { TabStrip, type TabDescriptor } from "./tab-strip";
import { TelemetryInspector } from "./inspectors/telemetry-inspector";

const TABS: ReadonlyArray<TabDescriptor> = [
  { id: "telemetry", label: "Telemetry" },
];

export const TugDevPanel: React.FC = () => {
  const snapshot = useSyncExternalStore(
    tugDevPanelStore.subscribe,
    tugDevPanelStore.getSnapshot,
  );

  const handleSelectTab = useCallback((tab: TugDevPanelTabId) => {
    tugDevPanelStore.selectTab(tab);
  }, []);

  const handleSelectCard = useCallback((cardId: string | null) => {
    tugDevPanelStore.selectCard(cardId);
  }, []);

  const handleClose = useCallback(() => {
    tugDevPanelStore.setOpen(false);
  }, []);

  const panelRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={panelRef}
      className="tug-devpanel"
      data-open={snapshot.open ? "true" : "false"}
      aria-hidden={!snapshot.open}
      role="dialog"
      aria-label="Tug Dev Panel"
      style={
        // Live width comes from the snapshot. The drag handle
        // overrides this transiently via inline `style.setProperty`
        // during a drag (per [L06]) and clears the override on
        // pointerup, so the store-derived value takes back over.
        { ["--tugx-devpanel-width" as string]: `${snapshot.widthPx}px` } as React.CSSProperties
      }
    >
      <ResizeHandle panelRef={panelRef} />
      <header className="tug-devpanel-header">
        <TugLabel size="sm" className="tug-devpanel-title">
          Tug Dev Panel
        </TugLabel>
        <TugIconButton
          icon={<X size={14} />}
          aria-label="Close dev panel (⌥⌘/)"
          onClick={handleClose}
          size="sm"
        />
      </header>

      <div className="tug-devpanel-controls">
        <TabStrip
          tabs={TABS}
          activeTab={snapshot.activeTab}
          onSelect={handleSelectTab}
        />
        <CardPicker
          selectedCardId={snapshot.selectedCardId}
          onSelect={handleSelectCard}
        />
      </div>

      <div className="tug-devpanel-body">
        {snapshot.activeTab === "telemetry" ? (
          <TelemetryInspector selectedCardId={snapshot.selectedCardId} />
        ) : null}
      </div>
    </div>
  );
};
TugDevPanel.displayName = "TugDevPanel";
