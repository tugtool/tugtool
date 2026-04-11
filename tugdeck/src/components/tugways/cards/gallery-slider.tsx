/**
 * GallerySlider — TugSlider demos for the Component Gallery.
 *
 * Every slider here binds its value through `useResponderForm`'s
 * `setValueNumber` slot with a unary setter. The setter runs on every
 * dispatch phase (begin/change/commit/discrete/cancel) — for a
 * value-picker slider like volume or font size, every intermediate
 * drag value is a committed value, so there is no preview/commit
 * distinction to honor. The slider value is semantic data, not
 * appearance, so L06/L08 do not apply here. Sliders that need true
 * preview-then-commit semantics belong in mutation-tx territory
 * (see `gallery-mutation-tx.tsx`).
 */

import React, { useId, useState } from "react";
import { Volume1, Volume2 } from "lucide-react";
import { TugSlider } from "@/components/tugways/tug-slider";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { createNumberFormatter } from "@/lib/tug-format";
import "./gallery-slider.css";
import { TugLabel } from "@/components/tugways/tug-label";

// ---- Formatters (module scope to avoid recreation on each render) ----

const percentFormatter = createNumberFormatter({ style: "percent" });
const decimalFormatter = createNumberFormatter({ style: "decimal", decimals: 1 });

// ---- GallerySlider ----

export function GallerySlider() {
  // Section 1: Sizes
  const [smValue, setSmValue] = useState(25);
  const [mdValue, setMdValue] = useState(50);
  const [lgValue, setLgValue] = useState(75);

  // Section 2: Layouts
  const [inlineValue, setInlineValue] = useState(40);
  const [stackedValue, setStackedValue] = useState(60);

  // Section 3: Formatters
  const [percentValue, setPercentValue] = useState(0.5);
  const [decimalValue, setDecimalValue] = useState(5.0);
  const [integerValue, setIntegerValue] = useState(42);

  // Section 4: Disabled
  const [disabledValue] = useState(30);

  // Section 5: No value input
  const [noValueValue, setNoValueValue] = useState(65);

  // Section 6: Ticks + icons
  const [ticksValue, setTicksValue] = useState(4);
  const [volumeValue, setVolumeValue] = useState(6);

  // ---- Gensym'd sender ids ----
  const smId = useId();
  const mdId = useId();
  const lgId = useId();
  const inlineId = useId();
  const stackedId = useId();
  const percentId = useId();
  const decimalId = useId();
  const integerId = useId();
  const noValueId = useId();
  const ticksId = useId();
  const volumeId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    setValueNumber: {
      [smId]: setSmValue,
      [mdId]: setMdValue,
      [lgId]: setLgValue,
      [inlineId]: setInlineValue,
      [stackedId]: setStackedValue,
      [percentId]: setPercentValue,
      [decimalId]: setDecimalValue,
      [integerId]: setIntegerValue,
      [noValueId]: setNoValueValue,
      [ticksId]: setTicksValue,
      [volumeId]: setVolumeValue,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-slider"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Section 1: Sizes ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugSlider — Sizes</TugLabel>
        <div className="gs-size-row">
          <div className="gs-size-item">
            <span className="gs-demo-label">sm</span>
            <TugSlider
              size="sm"
              value={smValue}
              senderId={smId}
              label="Small"
            />
            <TugLabel size="2xs" color="muted">{`Value: ${smValue}`}</TugLabel>
          </div>
          <div className="gs-size-item">
            <span className="gs-demo-label">md</span>
            <TugSlider
              size="md"
              value={mdValue}
              senderId={mdId}
              label="Medium"
            />
            <TugLabel size="2xs" color="muted">{`Value: ${mdValue}`}</TugLabel>
          </div>
          <div className="gs-size-item">
            <span className="gs-demo-label">lg</span>
            <TugSlider
              size="lg"
              value={lgValue}
              senderId={lgId}
              label="Large"
            />
            <TugLabel size="2xs" color="muted">{`Value: ${lgValue}`}</TugLabel>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 2: Layouts ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugSlider — Layouts</TugLabel>
        <div className="gs-layout-col">
          <div className="gs-layout-item">
            <span className="gs-demo-label">inline</span>
            <TugSlider
              size="md"
              layout="inline"
              value={inlineValue}
              senderId={inlineId}
              label="Opacity"
            />
          </div>
          <div className="gs-layout-item">
            <span className="gs-demo-label">stacked</span>
            <TugSlider
              size="md"
              layout="stacked"
              value={stackedValue}
              senderId={stackedId}
              label="Volume"
            />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 3: Formatters ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugSlider — Formatters</TugLabel>
        <div className="gs-formatter-col">
          <div className="gs-formatter-item">
            <span className="gs-demo-label">percent</span>
            <TugSlider
              size="md"
              value={percentValue}
              senderId={percentId}
              min={0}
              max={1}
              step={0.01}
              label="Brightness"
              formatter={percentFormatter}
            />
          </div>
          <div className="gs-formatter-item">
            <span className="gs-demo-label">decimal</span>
            <TugSlider
              size="md"
              value={decimalValue}
              senderId={decimalId}
              min={0}
              max={10}
              step={0.1}
              label="Scale"
              formatter={decimalFormatter}
            />
          </div>
          <div className="gs-formatter-item">
            <span className="gs-demo-label">integer (no formatter)</span>
            <TugSlider
              size="md"
              value={integerValue}
              senderId={integerId}
              min={0}
              max={100}
              step={1}
              label="Count"
            />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 4: Disabled ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugSlider — Disabled</TugLabel>
        <TugSlider
          size="md"
          value={disabledValue}
          label="Locked"
          disabled
        />
      </div>

      <div className="cg-divider" />

      {/* ---- Section 5: No Value Input ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugSlider — No Value Input</TugLabel>
        <TugSlider
          size="md"
          value={noValueValue}
          senderId={noValueId}
          label="Track Only"
          showValue={false}
        />
      </div>

      <div className="cg-divider" />

      {/* ---- Section 6: Ticks + Icons ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugSlider — Ticks & Icons</TugLabel>
        <div className="gs-layout-col">
          <div className="gs-layout-item">
            <span className="gs-demo-label">ticks</span>
            <TugSlider
              size="md"
              value={ticksValue}
              senderId={ticksId}
              min={0}
              max={10}
              step={1}
              showTicks
              trackFilled
              showValue={false}
            />
          </div>
          <div className="gs-layout-item">
            <span className="gs-demo-label">ticks + icons (volume)</span>
            <TugSlider
              size="md"
              value={volumeValue}
              senderId={volumeId}
              min={0}
              max={10}
              step={1}
              showTicks
              trackFilled
              showValue={false}
              leadingIcon={<Volume1 size={20} />}
              trailingIcon={<Volume2 size={20} />}
            />
          </div>
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
