/**
 * `SettingsInspector` — the dev panel's Settings tab. Surfaces app-wide
 * appearance/behavior toggles that are still being vetted before they earn a
 * user-facing home.
 *
 * Focus Ring modality: choose whether the focus ring moves with keyboard
 * navigation only, or also follows pointer clicks that land on a focusable.
 * The choice persists via tugbank (`dev.tugtool.app` / `focusRingModality`)
 * and is pushed into the FocusManager by the responder-chain provider.
 *
 * Conformance:
 *   - [L02] subscribes to `focusRingModalityStore` via `useFocusRingModality`.
 *   - [L11] the radio group emits a `selectValue` action; this inspector is the
 *     responder that owns the resulting state write (via `useResponderForm`).
 *   - [L19] composes Tug primitives (`TugRadioGroup`, `TugLabel`); no raw
 *     controls.
 *   - [L20] reads only `--tugx-devpanel-*` slots for its own chrome.
 *
 * @module components/tug-dev-panel/inspectors/settings-inspector
 */

import React, { useCallback } from "react";

import {
  focusRingModalityStore,
  normalizeFocusRingModality,
  useFocusRingModality,
} from "@/focus-ring-modality-store";
import { TugLabel } from "@/components/tugways/tug-label";
import {
  TugRadioGroup,
  TugRadioItem,
} from "@/components/tugways/tug-radio-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";

import { FieldSection } from "../field-section";

/** Stable sender id so the responder routes this group's selectValue here. */
const RING_MODALITY_SENDER = "devpanel-focus-ring-modality";

export const SettingsInspector: React.FC = () => {
  const modality = useFocusRingModality();

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [RING_MODALITY_SENDER]: useCallback((value: string) => {
        focusRingModalityStore.setMode(normalizeFocusRingModality(value));
      }, []),
    },
  });

  return (
    <ResponderScope>
      <div
        className="tug-devpanel-settings"
        data-testid="devpanel-settings"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <FieldSection title="Focus Ring">
          <TugLabel size="xs" emphasis="calm" className="tug-devpanel-settings-hint">
            Choose what moves the focus ring. Keyboard only paints the ring on
            Tab / Shift-Tab navigation; Keyboard + pointer also paints it when a
            click lands on a control.
          </TugLabel>
          <TugRadioGroup
            size="sm"
            value={modality}
            senderId={RING_MODALITY_SENDER}
            aria-label="Focus ring modality"
            data-testid="devpanel-focus-ring-modality"
          >
            <TugRadioItem
              value="keyboard"
              description="Ring follows Tab / Shift-Tab only"
            >
              Keyboard only
            </TugRadioItem>
            <TugRadioItem
              value="pointer"
              description="Ring also follows mouse clicks"
            >
              Keyboard + pointer
            </TugRadioItem>
          </TugRadioGroup>
        </FieldSection>
      </div>
    </ResponderScope>
  );
};
SettingsInspector.displayName = "SettingsInspector";
