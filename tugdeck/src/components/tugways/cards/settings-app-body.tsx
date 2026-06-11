/**
 * settings-app-body.tsx — the App settings panel.
 *
 * App-level (not card-level) preferences. Today that is one switch:
 * **Maker Mode**, the gate on the app-maker tooling — the Maker menu
 * and dev serving from the source tree. The toggle reads its initial
 * state over the host's `getSettings` bridge and commits over
 * `setMakerMode` (`lib/maker-mode-bridge.ts`); flipping it reloads the
 * app, because the serving switch swaps where the frontend loads from.
 *
 * Graceful degradation: in browser dev the bridge is absent, so the
 * switch renders disabled with a hint (the `pickPath` availability
 * pattern).
 *
 * Laws: the switch dispatches `toggle` through the chain to this
 * panel's responder ([L11] via `useResponderForm`); toggle state is
 * session-local `useState` seeded from a bridge RPC — not an external
 * store, so no `useSyncExternalStore` is involved; layout lives in
 * settings-app-body.css [L06].
 *
 * @module components/tugways/cards/settings-app-body
 */

import React, { useEffect, useId, useState } from "react";
import { TugBox } from "../tug-box";
import { TugLabel } from "../tug-label";
import { TugSwitch } from "../tug-switch";
import { useResponderForm } from "../use-responder-form";
import {
  getSettings,
  isMakerModeBridgeAvailable,
  setMakerMode,
} from "@/lib/maker-mode-bridge";
import "./settings-app-body.css";

export function SettingsAppBody() {
  const bridgeAvailable = isMakerModeBridgeAvailable();

  // Session-local UI state, seeded from the one-shot bridge read.
  // `null` = not yet loaded (or bridge absent) — the switch renders
  // unchecked + disabled until the seed lands.
  const [makerMode, setMakerModeState] = useState<boolean | null>(null);

  useEffect(() => {
    if (!bridgeAvailable) return;
    let cancelled = false;
    void getSettings().then((settings) => {
      if (!cancelled && settings !== null) {
        setMakerModeState(settings.makerMode);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bridgeAvailable]);

  const makerModeSwitchId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    toggle: {
      [makerModeSwitchId]: (enabled: boolean) => {
        // Optimistic flip; the host confirms via the bridge promise.
        // Outside the app-test harness the commit reloads the page
        // (serving swap), so the confirmation is best-effort.
        setMakerModeState(enabled);
        void setMakerMode(enabled).then((confirmed) => {
          if (confirmed !== null) setMakerModeState(confirmed);
        });
      },
    },
  });

  return (
    <ResponderScope>
      <div
        className="settings-app"
        data-testid="settings-app"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <TugBox
          label="Maker"
          labelPosition="legend"
          variant="bordered"
          className="settings-app-group"
        >
          <div className="settings-app-switch-row">
            <TugSwitch
              label="Maker Mode"
              checked={makerMode === true}
              disabled={!bridgeAvailable || makerMode === null}
              senderId={makerModeSwitchId}
              size="md"
              data-testid="settings-maker-mode-switch"
            />
          </div>
          <TugLabel size="sm" emphasis="calm" className="settings-app-hint">
            {bridgeAvailable
              ? "Shows the Maker menu and serves the app from the dev source tree. Changing this reloads the app."
              : "Available when running inside the Tug app."}
          </TugLabel>
        </TugBox>
      </div>
    </ResponderScope>
  );
}
