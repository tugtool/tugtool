/**
 * gallery-box.tsx -- TugBox demo tab for the Component Gallery.
 *
 * Shows TugBox in all variants, both label positions, nested boxes, the
 * disabled cascade with an interactive toggle, and border radius options.
 *
 * Rules of Tugways compliance:
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-box
 */

import React, { useCallback, useId, useState } from "react";
import { TugBox } from "@/components/tugways/tug-box";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugSwitch } from "@/components/tugways/tug-switch";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { narrowValue } from "@/components/tugways/action-vocabulary";

// ---------------------------------------------------------------------------
// GalleryBox
// ---------------------------------------------------------------------------

export function GalleryBox() {
  // Variants section
  const [plainCb1, setPlainCb1] = useState(false);
  const [plainCb2, setPlainCb2] = useState(true);
  const [borderedSw1, setBorderedSw1] = useState(false);
  const [borderedSw2, setBorderedSw2] = useState(true);
  const [filledCb1, setFilledCb1] = useState(true);
  const [filledSw1, setFilledSw1] = useState(false);

  // Label positions section
  const [legendCb, setLegendCb] = useState(false);
  const [legendSw, setLegendSw] = useState(true);
  const [aboveCb, setAboveCb] = useState(false);
  const [aboveSw, setAboveSw] = useState(true);

  // Nested boxes section
  const [nestedCb, setNestedCb] = useState(true);
  const [nestedSw, setNestedSw] = useState(false);
  const [nestedRadio, setNestedRadio] = useState("https");

  // Interactive toggle section
  const [boxEnabled, setBoxEnabled] = useState(true);
  const [toggleCb, setToggleCb] = useState(true);
  const [toggleSw, setToggleSw] = useState(false);
  const [toggleRadio, setToggleRadio] = useState("https");
  const [toggleSeg, setToggleSeg] = useState("grid");

  // Rounded section
  const [roundedCb, setRoundedCb] = useState(true);

  // L11 migration pattern: single responder for every interactive
  // control in this card. Separate handlers per action (toggle,
  // selectValue) share the same senderId namespace.
  // See gallery-checkbox.tsx for the annotated reference.
  const toggleSetters: Record<string, (v: boolean) => void> = {
    "plain-cb-1": setPlainCb1,
    "plain-cb-2": setPlainCb2,
    "bordered-sw-1": setBorderedSw1,
    "bordered-sw-2": setBorderedSw2,
    "filled-cb-1": setFilledCb1,
    "filled-sw-1": setFilledSw1,
    "legend-cb": setLegendCb,
    "legend-sw": setLegendSw,
    "above-cb": setAboveCb,
    "above-sw": setAboveSw,
    "nested-cb": setNestedCb,
    "nested-sw": setNestedSw,
    "box-enabled": setBoxEnabled,
    "toggle-cb": setToggleCb,
    "toggle-sw": setToggleSw,
    "rounded-cb": setRoundedCb,
  };
  const handleToggle = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : null;
    if (!sender) return;
    const setter = toggleSetters[sender];
    if (!setter) return;
    const v = narrowValue(event, (val): val is boolean => typeof val === "boolean");
    if (v === null) return;
    setter(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // selectValue handler for radio groups and choice groups.
  const selectSetters: Record<string, (v: string) => void> = {
    "nested-radio": setNestedRadio,
    "toggle-radio": setToggleRadio,
    "toggle-seg": setToggleSeg,
  };
  const handleSelectValue = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : null;
    if (!sender) return;
    const setter = selectSetters[sender];
    if (!setter) return;
    const v = narrowValue(event, (val): val is string => typeof val === "string");
    if (v === null) return;
    setter(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const responderId = useId();
  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: {
      toggle: handleToggle,
      selectValue: handleSelectValue,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-box"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* plain */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>plain</div>
            <TugBox variant="plain" label="Preferences" labelPosition="above">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugCheckbox label="Enable notifications" checked={plainCb1} senderId="plain-cb-1" />
                <TugCheckbox label="Auto-save changes" checked={plainCb2} senderId="plain-cb-2" />
              </div>
            </TugBox>
          </div>

          {/* bordered */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>bordered</div>
            <TugBox variant="bordered" label="Display">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugSwitch label="Dark mode" checked={borderedSw1} senderId="bordered-sw-1" />
                <TugSwitch label="Reduce motion" checked={borderedSw2} senderId="bordered-sw-2" />
              </div>
            </TugBox>
          </div>

          {/* filled */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>filled</div>
            <TugBox variant="filled" label="Access">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugCheckbox label="Remember me" checked={filledCb1} senderId="filled-cb-1" />
                <TugSwitch label="Two-factor auth" checked={filledSw1} senderId="filled-sw-1" />
              </div>
            </TugBox>
          </div>

          {/* separator */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>separator</div>
            <TugBox variant="separator" />
          </div>

        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Label Positions ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Label Positions</div>
        <div style={{ display: "flex", flexDirection: "row", gap: "24px", alignItems: "flex-start" }}>

          {/* legend (in border line) */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>labelPosition="legend"</div>
            <TugBox variant="bordered" label="Notifications" labelPosition="legend">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugCheckbox label="Email alerts" checked={legendCb} senderId="legend-cb" />
                <TugSwitch label="Push notifications" checked={legendSw} senderId="legend-sw" />
              </div>
            </TugBox>
          </div>

          {/* above */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>labelPosition="above"</div>
            <TugBox variant="bordered" label="Notifications" labelPosition="above">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugCheckbox label="Email alerts" checked={aboveCb} senderId="above-cb" />
                <TugSwitch label="Push notifications" checked={aboveSw} senderId="above-sw" />
              </div>
            </TugBox>
          </div>

        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Nested Boxes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Nested Boxes</div>
        <TugBox variant="bordered" label="Account Settings">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <TugCheckbox label="Enable notifications" checked={nestedCb} senderId="nested-cb" />
            <TugSwitch label="Dark mode" checked={nestedSw} senderId="nested-sw" />

            <TugBox variant="filled" label="Advanced">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugRadioGroup
                  label="Protocol"
                  value={nestedRadio}
                  senderId="nested-radio"
                  orientation="horizontal"
                >
                  <TugRadioItem value="http">HTTP</TugRadioItem>
                  <TugRadioItem value="https">HTTPS</TugRadioItem>
                  <TugRadioItem value="ws">WebSocket</TugRadioItem>
                </TugRadioGroup>
              </div>
            </TugBox>
          </div>
        </TugBox>
      </div>

      <div className="cg-divider" />

      {/* ---- Interactive Disable Toggle ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Disabled Cascade</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TugSwitch
            label="Enable settings"
            checked={boxEnabled}
            senderId="box-enabled"
          />
          <TugBox variant="bordered" label="Settings" disabled={!boxEnabled}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <TugCheckbox label="Notifications" checked={toggleCb} senderId="toggle-cb" />
              <TugSwitch label="Dark mode" checked={toggleSw} senderId="toggle-sw" />
              <TugRadioGroup
                aria-label="Protocol"
                value={toggleRadio}
                senderId="toggle-radio"
                orientation="horizontal"
              >
                <TugRadioItem value="http">HTTP</TugRadioItem>
                <TugRadioItem value="https">HTTPS</TugRadioItem>
                <TugRadioItem value="ws">WebSocket</TugRadioItem>
              </TugRadioGroup>
              <TugChoiceGroup
                value={toggleSeg}
                senderId="toggle-seg"
                aria-label="View mode"
                items={[
                  { value: "grid",  label: "Grid"  },
                  { value: "list",  label: "List"  },
                  { value: "table", label: "Table" },
                ]}
              />
              <TugBox variant="filled" label="Nested (also cascades)">
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <TugCheckbox label="Auto-save" checked={true} />
                  <TugSwitch label="Sync changes" checked={false} />
                </div>
              </TugBox>
            </div>
          </TugBox>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Rounded ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Border Radius</div>
        <div style={{ display: "flex", flexDirection: "row", gap: "16px", flexWrap: "wrap", alignItems: "flex-start" }}>
          {(["none", "sm", "md", "lg", "full"] as const).map((r) => (
            <div key={r} style={{ width: "180px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>rounded="{r}"</div>
              <TugBox variant="bordered" label={r} rounded={r}>
                <TugCheckbox label="Option" checked={roundedCb} senderId="rounded-cb" />
              </TugBox>
            </div>
          ))}
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
