/**
 * text-card-controls.tsx — the shared Editing + Display controls for
 * the Text Card's view settings, rendered identically in two places:
 * the Settings card's "Text Card" tab (bound to the deck-wide
 * defaults) and each Text card's gear popover (bound to that card's
 * local settings). One component so the two always look the same.
 *
 * Presentational + chain-wired: the caller passes the current
 * `settings` and an `onChange` that persists a partial; the controls
 * dispatch through this component's own `useResponderForm` responder.
 * The deck-wide `openTarget` behavior is NOT here — it is a
 * defaults-only concern rendered by the settings body.
 *
 * Laws: controls emit actions to this panel's responder ([L11]);
 * layout lives in text-card-controls.css [L06]; composes real Tug
 * components [use-tug-components].
 *
 * @module components/tugways/cards/text-card-controls
 */

import React, { useId } from "react";
import { TugBox } from "../tug-box";
import { TugLabel } from "../tug-label";
import { TugSwitch } from "../tug-switch";
import { TugValueInput } from "../tug-value-input";
import { useResponderForm } from "../use-responder-form";
import { clampTabSize, type TextCardSettings } from "@/lib/text-card-settings";
import "./text-card-controls.css";

export interface TextCardControlsProps {
  settings: TextCardSettings;
  onChange: (partial: Partial<TextCardSettings>) => void;
}

export function TextCardControls({ settings, onChange }: TextCardControlsProps) {
  const softTabsId = useId();
  const lineWrapId = useId();
  const tabSizeId = useId();
  const lineNumbersId = useId();
  const foldGutterId = useId();
  const activeLineId = useId();
  const showSpacesId = useId();
  const showTabsId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    toggle: {
      [softTabsId]: (v: boolean) => onChange({ softTabs: v }),
      [lineWrapId]: (v: boolean) => onChange({ lineWrap: v }),
      [lineNumbersId]: (v: boolean) => onChange({ lineNumbers: v }),
      [foldGutterId]: (v: boolean) => onChange({ foldGutter: v }),
      [activeLineId]: (v: boolean) => onChange({ highlightActiveLine: v }),
      [showSpacesId]: (v: boolean) => onChange({ showSpaces: v }),
      [showTabsId]: (v: boolean) => onChange({ showTabs: v }),
    },
    setValueNumber: {
      [tabSizeId]: (v: number) => onChange({ tabSize: clampTabSize(v) }),
    },
  });

  return (
    <ResponderScope>
      <div
        className="text-card-controls"
        data-slot="text-card-controls"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <TugBox
          label="Tabs & Spaces"
          labelPosition="legend"
          variant="bordered"
          className="text-card-controls-group"
        >
          <div className="text-card-controls-switches">
            <TugSwitch
              label="Auto-expand tabs"
              checked={settings.softTabs}
              senderId={softTabsId}
              size="md"
              data-testid="text-card-option-soft-tabs"
            />
            <TugSwitch
              label="Soft wrap text"
              checked={settings.lineWrap}
              senderId={lineWrapId}
              size="md"
              data-testid="text-card-option-line-wrap"
            />
          </div>
          <div className="text-card-controls-row">
            <TugLabel size="sm">Spaces per tab</TugLabel>
            <TugValueInput
              value={settings.tabSize}
              senderId={tabSizeId}
              min={1}
              max={16}
              step={1}
              size="sm"
            />
          </div>
        </TugBox>

        <TugBox
          label="Display"
          labelPosition="legend"
          variant="bordered"
          className="text-card-controls-group"
        >
          <div className="text-card-controls-switches">
            <TugSwitch
              label="Line numbers"
              checked={settings.lineNumbers}
              senderId={lineNumbersId}
              size="md"
              data-testid="text-card-option-line-numbers"
            />
            <TugSwitch
              label="Fold gutter"
              checked={settings.foldGutter}
              senderId={foldGutterId}
              size="md"
              data-testid="text-card-option-fold-gutter"
            />
            <TugSwitch
              label="Active line"
              checked={settings.highlightActiveLine}
              senderId={activeLineId}
              size="md"
              data-testid="text-card-option-active-line"
            />
            <TugSwitch
              label="Show spaces"
              checked={settings.showSpaces}
              senderId={showSpacesId}
              size="md"
              data-testid="text-card-option-show-spaces"
            />
            <TugSwitch
              label="Show tabs"
              checked={settings.showTabs}
              senderId={showTabsId}
              size="md"
              data-testid="text-card-option-show-tabs"
            />
          </div>
        </TugBox>
      </div>
    </ResponderScope>
  );
}
