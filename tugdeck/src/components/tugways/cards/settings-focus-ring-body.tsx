/**
 * settings-focus-ring-body.tsx — the Settings **General** tab body.
 *
 * Hosts the Focus Ring modality control that outgrew the dev surface:
 * choose whether the focus ring moves with keyboard navigation only, or
 * also follows pointer clicks. The choice persists via tugbank
 * (`dev.tugtool.app` / `focusRingModality`, unchanged) and is pushed into
 * the FocusManager by the responder-chain provider.
 *
 * Laws: [L02] subscribes to `focusRingModalityStore` via
 * `useFocusRingModality`; [L11] the radio group emits a `selectValue`
 * action owned by this body's responder (via `useResponderForm`); [L19]
 * composes Tug primitives (`TugRadioGroup`, `TugLabel`).
 *
 * @module components/tugways/cards/settings-focus-ring-body
 */

import React, { useCallback } from "react";
import {
  focusRingModalityStore,
  normalizeFocusRingModality,
  useFocusRingModality,
} from "@/focus-ring-modality-store";
import { TugLabel } from "../tug-label";
import { TugRadioGroup, TugRadioItem } from "../tug-radio-group";
import { useResponderForm } from "../use-responder-form";
import { FieldSection } from "@/components/lens/internal/field-section";

/** Stable sender id so the responder routes this group's selectValue here. */
const RING_MODALITY_SENDER = "settings-focus-ring-modality";

export function SettingsFocusRingBody(): React.ReactElement {
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
        className="settings-general-body"
        data-testid="settings-general-body"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <FieldSection title="Focus Ring">
          <TugLabel size="xs" emphasis="calm">
            Choose what moves the focus ring. Keyboard only paints the ring on
            Tab / Shift-Tab navigation; Keyboard + pointer also paints it when a
            click lands on a control.
          </TugLabel>
          <TugRadioGroup
            size="sm"
            value={modality}
            senderId={RING_MODALITY_SENDER}
            aria-label="Focus ring modality"
            data-testid="settings-focus-ring-modality"
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
}
