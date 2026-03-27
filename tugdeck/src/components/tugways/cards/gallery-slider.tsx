/**
 * GallerySlider — TugSlider demos for the Component Gallery.
 */

import React, { useState } from "react";
import { TugSlider } from "@/components/tugways/tug-slider";
import { createNumberFormatter } from "@/lib/tug-format";
import "./gallery-slider.css";

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

  return (
    <div className="cg-content" data-testid="gallery-slider">

      {/* ---- Section 1: Sizes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugSlider — Sizes</div>
        <div className="gs-size-row">
          <div className="gs-size-item">
            <span className="gs-demo-label">sm</span>
            <TugSlider
              size="sm"
              value={smValue}
              onValueChange={setSmValue}
              label="Small"
            />
            <div className="cg-demo-status">Value: <code>{smValue}</code></div>
          </div>
          <div className="gs-size-item">
            <span className="gs-demo-label">md</span>
            <TugSlider
              size="md"
              value={mdValue}
              onValueChange={setMdValue}
              label="Medium"
            />
            <div className="cg-demo-status">Value: <code>{mdValue}</code></div>
          </div>
          <div className="gs-size-item">
            <span className="gs-demo-label">lg</span>
            <TugSlider
              size="lg"
              value={lgValue}
              onValueChange={setLgValue}
              label="Large"
            />
            <div className="cg-demo-status">Value: <code>{lgValue}</code></div>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 2: Layouts ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugSlider — Layouts</div>
        <div className="gs-layout-col">
          <div className="gs-layout-item">
            <span className="gs-demo-label">inline</span>
            <TugSlider
              size="md"
              layout="inline"
              value={inlineValue}
              onValueChange={setInlineValue}
              label="Opacity"
            />
          </div>
          <div className="gs-layout-item">
            <span className="gs-demo-label">stacked</span>
            <TugSlider
              size="md"
              layout="stacked"
              value={stackedValue}
              onValueChange={setStackedValue}
              label="Volume"
            />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 3: Formatters ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugSlider — Formatters</div>
        <div className="gs-formatter-col">
          <div className="gs-formatter-item">
            <span className="gs-demo-label">percent</span>
            <TugSlider
              size="md"
              value={percentValue}
              onValueChange={setPercentValue}
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
              onValueChange={setDecimalValue}
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
              onValueChange={setIntegerValue}
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
        <div className="cg-section-title">TugSlider — Disabled</div>
        <TugSlider
          size="md"
          value={disabledValue}
          onValueChange={() => {}}
          label="Locked"
          disabled
        />
      </div>

      <div className="cg-divider" />

      {/* ---- Section 5: No Value Input ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugSlider — No Value Input</div>
        <TugSlider
          size="md"
          value={noValueValue}
          onValueChange={setNoValueValue}
          label="Track Only"
          showValue={false}
        />
      </div>

    </div>
  );
}
