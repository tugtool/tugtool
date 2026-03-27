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

import React, { useState } from "react";
import { TugBox } from "@/components/tugways/tug-box";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugSwitch } from "@/components/tugways/tug-switch";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { TugSegmentedChoice } from "@/components/tugways/tug-segmented-choice";

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

  return (
    <div className="cg-content" data-testid="gallery-box">

      {/* ---- Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* plain */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>plain</div>
            <TugBox variant="plain" label="Preferences">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugCheckbox label="Enable notifications" checked={plainCb1} onCheckedChange={(v) => setPlainCb1(v === true)} />
                <TugCheckbox label="Auto-save changes" checked={plainCb2} onCheckedChange={(v) => setPlainCb2(v === true)} />
              </div>
            </TugBox>
          </div>

          {/* bordered */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>bordered</div>
            <TugBox variant="bordered" label="Display">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugSwitch label="Dark mode" checked={borderedSw1} onCheckedChange={setBorderedSw1} />
                <TugSwitch label="Reduce motion" checked={borderedSw2} onCheckedChange={setBorderedSw2} />
              </div>
            </TugBox>
          </div>

          {/* filled */}
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>filled</div>
            <TugBox variant="filled" label="Access">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugCheckbox label="Remember me" checked={filledCb1} onCheckedChange={(v) => setFilledCb1(v === true)} />
                <TugSwitch label="Two-factor auth" checked={filledSw1} onCheckedChange={setFilledSw1} />
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
                <TugCheckbox label="Email alerts" checked={legendCb} onCheckedChange={(v) => setLegendCb(v === true)} />
                <TugSwitch label="Push notifications" checked={legendSw} onCheckedChange={setLegendSw} />
              </div>
            </TugBox>
          </div>

          {/* above */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>labelPosition="above"</div>
            <TugBox variant="bordered" label="Notifications" labelPosition="above">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugCheckbox label="Email alerts" checked={aboveCb} onCheckedChange={(v) => setAboveCb(v === true)} />
                <TugSwitch label="Push notifications" checked={aboveSw} onCheckedChange={setAboveSw} />
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
            <TugCheckbox label="Enable notifications" checked={nestedCb} onCheckedChange={(v) => setNestedCb(v === true)} />
            <TugSwitch label="Dark mode" checked={nestedSw} onCheckedChange={setNestedSw} />

            <TugBox variant="filled" label="Advanced">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TugRadioGroup
                  label="Protocol"
                  value={nestedRadio}
                  onValueChange={setNestedRadio}
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
            onCheckedChange={setBoxEnabled}
          />
          <TugBox variant="bordered" label="Settings" disabled={!boxEnabled}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <TugCheckbox label="Notifications" checked={toggleCb} onCheckedChange={(v) => setToggleCb(v === true)} />
              <TugSwitch label="Dark mode" checked={toggleSw} onCheckedChange={setToggleSw} />
              <TugRadioGroup
                aria-label="Protocol"
                value={toggleRadio}
                onValueChange={setToggleRadio}
                orientation="horizontal"
              >
                <TugRadioItem value="http">HTTP</TugRadioItem>
                <TugRadioItem value="https">HTTPS</TugRadioItem>
                <TugRadioItem value="ws">WebSocket</TugRadioItem>
              </TugRadioGroup>
              <TugSegmentedChoice
                value={toggleSeg}
                onValueChange={setToggleSeg}
                aria-label="View mode"
                items={[
                  { value: "grid",  label: "Grid"  },
                  { value: "list",  label: "List"  },
                  { value: "table", label: "Table" },
                ]}
              />
              <TugBox variant="filled" label="Nested (also cascades)">
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <TugCheckbox label="Auto-save" checked={true} onCheckedChange={() => {}} />
                  <TugSwitch label="Sync changes" checked={false} onCheckedChange={() => {}} />
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
                <TugCheckbox label="Option" checked={roundedCb} onCheckedChange={(v) => setRoundedCb(v === true)} />
              </TugBox>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
