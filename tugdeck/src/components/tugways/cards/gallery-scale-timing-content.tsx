/**
 * gallery-scale-timing-content.tsx -- Scale & Timing interactive demo tab.
 *
 * Interactive controls for the three global CSS multipliers:
 *   --tug-scale   dimension multiplier (range 0.85–2.0)
 *   --tug-timing  animation-duration multiplier (range 0.1–10.0)
 *   --tug-motion  binary motion toggle (0 or 1)
 *
 * And component-level scale tokens:
 *   --tug-comp-button-scale  (range 0.5–2.0)
 *   --tug-comp-tab-scale     (range 0.5–2.0)
 *   --tug-comp-dock-scale    (forward-declared, range 0.5–2.0)
 *
 * Rules of Tugways compliance:
 *   - Slider/toggle state uses useState for local UI state only [D40]
 *   - CSS custom properties set via style.setProperty() on DOM elements [D08, D09]
 *   - useEffect cleanup restores all CSS custom properties on unmount [D40]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-scale-timing-content
 */

import React, { useState, useEffect, useCallback } from "react";
import { TugButton } from "@/components/tugways/tug-button";
import { getTugScale, getTugTiming, isTugMotionEnabled } from "@/components/tugways/scale-timing";
import { Star } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SCALE = 1;
const DEFAULT_TIMING = 1;
const DEFAULT_MOTION = true;
const DEFAULT_BUTTON_SCALE = 1;
const DEFAULT_TAB_SCALE = 1;
const DEFAULT_DOCK_SCALE = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(v: number, decimals: number = 2): string {
  return v.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// SliderRow
// ---------------------------------------------------------------------------

interface SliderRowProps {
  label: string;
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  note?: string;
}

function SliderRow({ label, id, min, max, step, value, onChange, note }: SliderRowProps) {
  return (
    <div className="cg-control-group cg-st-slider-row">
      <label className="cg-control-label cg-st-slider-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="cg-st-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="cg-st-value">{formatValue(value, step < 0.1 ? 2 : 1)}</span>
      {note && <span className="cg-st-note">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryScaleTimingContent
// ---------------------------------------------------------------------------

/**
 * GalleryScaleTimingContent -- Scale & Timing demo tab.
 *
 * Provides sliders and toggles for the global CSS multipliers and
 * component-level scale tokens. Sets CSS custom properties directly on
 * document.documentElement (for global tokens) or document.body (for
 * component-level tokens). Cleans up all changes on unmount.
 *
 * **Authoritative reference:** Spec S08 (#s08-gallery-tab)
 */
export function GalleryScaleTimingContent() {
  const [scale, setScaleState] = useState(DEFAULT_SCALE);
  const [timing, setTimingState] = useState(DEFAULT_TIMING);
  const [motionOn, setMotionOnState] = useState(DEFAULT_MOTION);
  const [buttonScale, setButtonScaleState] = useState(DEFAULT_BUTTON_SCALE);
  const [tabScale, setTabScaleState] = useState(DEFAULT_TAB_SCALE);
  const [dockScale, setDockScaleState] = useState(DEFAULT_DOCK_SCALE);

  // JS helper readout state — updated whenever sliders change
  const [readout, setReadout] = useState(() => ({
    scale: getTugScale(),
    timing: getTugTiming(),
    motionEnabled: isTugMotionEnabled(),
  }));

  const updateReadout = useCallback(() => {
    setReadout({
      scale: getTugScale(),
      timing: getTugTiming(),
      motionEnabled: isTugMotionEnabled(),
    });
  }, []);

  // Apply --tug-scale on :root
  const setScale = useCallback((v: number) => {
    setScaleState(v);
    document.documentElement.style.setProperty("--tug-scale", String(v));
    updateReadout();
  }, [updateReadout]);

  // Apply --tug-timing on :root
  const setTiming = useCallback((v: number) => {
    setTimingState(v);
    document.documentElement.style.setProperty("--tug-timing", String(v));
    updateReadout();
  }, [updateReadout]);

  // Apply --tug-motion on :root and manage data-tug-motion attribute on body
  const setMotionOn = useCallback((on: boolean) => {
    setMotionOnState(on);
    document.documentElement.style.setProperty("--tug-motion", on ? "1" : "0");
    if (on) {
      document.body.removeAttribute("data-tug-motion");
    } else {
      document.body.setAttribute("data-tug-motion", "off");
    }
    updateReadout();
  }, [updateReadout]);

  // Apply --tug-comp-button-scale on body
  const setButtonScale = useCallback((v: number) => {
    setButtonScaleState(v);
    document.body.style.setProperty("--tug-comp-button-scale", String(v));
    updateReadout();
  }, [updateReadout]);

  // Apply --tug-comp-tab-scale on body
  const setTabScale = useCallback((v: number) => {
    setTabScaleState(v);
    document.body.style.setProperty("--tug-comp-tab-scale", String(v));
    updateReadout();
  }, [updateReadout]);

  // Apply --tug-comp-dock-scale on body (forward-declared, no consumer yet)
  const setDockScale = useCallback((v: number) => {
    setDockScaleState(v);
    document.body.style.setProperty("--tug-comp-dock-scale", String(v));
    updateReadout();
  }, [updateReadout]);

  // Reset all multipliers to defaults
  const handleReset = useCallback(() => {
    setScale(DEFAULT_SCALE);
    setTiming(DEFAULT_TIMING);
    setMotionOn(DEFAULT_MOTION);
    setButtonScale(DEFAULT_BUTTON_SCALE);
    setTabScale(DEFAULT_TAB_SCALE);
    setDockScale(DEFAULT_DOCK_SCALE);
  }, [setScale, setTiming, setMotionOn, setButtonScale, setTabScale, setDockScale]);

  // Cleanup: restore all CSS custom properties to defaults on unmount.
  // Prevents non-default state from persisting after switching away from this tab.
  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("--tug-scale");
      document.documentElement.style.removeProperty("--tug-timing");
      document.documentElement.style.removeProperty("--tug-motion");
      document.body.style.removeProperty("--tug-comp-button-scale");
      document.body.style.removeProperty("--tug-comp-tab-scale");
      document.body.style.removeProperty("--tug-comp-dock-scale");
      document.body.removeAttribute("data-tug-motion");
    };
  }, []);

  return (
    <div className="cg-content" data-testid="gallery-scale-timing-content">

      {/* ---- Global Multipliers ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Global Multipliers</div>
        <div className="cg-controls cg-st-controls">
          <SliderRow
            label="--tug-scale"
            id="st-scale"
            min={0.85}
            max={2.0}
            step={0.05}
            value={scale}
            onChange={setScale}
            note="Scales all --td-space-* and --td-radius-* tokens"
          />
          <SliderRow
            label="--tug-timing"
            id="st-timing"
            min={0.1}
            max={10.0}
            step={0.1}
            value={timing}
            onChange={setTiming}
            note="Scales all --td-duration-* tokens"
          />
          <div className="cg-control-group cg-st-slider-row">
            <input
              id="st-motion"
              type="checkbox"
              className="cg-control-checkbox"
              checked={motionOn}
              onChange={(e) => setMotionOn(e.target.checked)}
            />
            <label className="cg-control-label" htmlFor="st-motion">
              Motion enabled (--tug-motion)
            </label>
            <span className="cg-st-note">
              {motionOn ? "1 — animations play" : "0 — all animation/transition zeroed via data-tug-motion"}
            </span>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Component-Level Scale ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Component Scale</div>
        <div className="cg-controls cg-st-controls">
          <SliderRow
            label="--tug-comp-button-scale"
            id="st-button-scale"
            min={0.5}
            max={2.0}
            step={0.1}
            value={buttonScale}
            onChange={setButtonScale}
            note="Scales all TugButton variants via CSS transform"
          />
          <SliderRow
            label="--tug-comp-tab-scale"
            id="st-tab-scale"
            min={0.5}
            max={2.0}
            step={0.1}
            value={tabScale}
            onChange={setTabScale}
            note="Scales .tug-tab-bar via CSS transform"
          />
          <SliderRow
            label="--tug-comp-dock-scale"
            id="st-dock-scale"
            min={0.5}
            max={2.0}
            step={0.1}
            value={dockScale}
            onChange={setDockScale}
            note="Forward-declared — no dock component yet"
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- JS Helper Readout ---- */}
      <div className="cg-section">
        <div className="cg-section-title">JS Helper Readout</div>
        <div className="cg-st-readout" data-testid="st-readout">
          <div className="cg-st-readout-row">
            <span className="cg-st-readout-fn">getTugScale()</span>
            <span className="cg-st-readout-value" data-testid="st-readout-scale">
              {formatValue(readout.scale)}
            </span>
          </div>
          <div className="cg-st-readout-row">
            <span className="cg-st-readout-fn">getTugTiming()</span>
            <span className="cg-st-readout-value" data-testid="st-readout-timing">
              {formatValue(readout.timing)}
            </span>
          </div>
          <div className="cg-st-readout-row">
            <span className="cg-st-readout-fn">isTugMotionEnabled()</span>
            <span className="cg-st-readout-value" data-testid="st-readout-motion">
              {String(readout.motionEnabled)}
            </span>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Live Preview ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Live Preview</div>
        <div className="cg-st-preview" data-testid="st-preview">
          <div className="cg-st-preview-row">
            <TugButton subtype="push" variant="primary" size="md">Primary</TugButton>
            <TugButton subtype="push" variant="secondary" size="md">Secondary</TugButton>
            <TugButton subtype="push" variant="ghost" size="md">Ghost</TugButton>
            <TugButton subtype="push" variant="destructive" size="md">Destructive</TugButton>
          </div>
          <div className="cg-st-preview-row">
            <TugButton subtype="push" variant="primary" size="sm">Small</TugButton>
            <TugButton subtype="push" variant="secondary" size="sm">Small</TugButton>
            <TugButton
              subtype="icon"
              variant="secondary"
              size="md"
              icon={<Star size={14} />}
              aria-label="Icon button"
            />
            <TugButton subtype="icon-text" variant="secondary" size="md" icon={<Star size={14} />}>
              Icon + Text
            </TugButton>
          </div>
          <div className="cg-st-preview-row">
            <TugButton subtype="push" variant="secondary" size="md" loading>Loading</TugButton>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Reset ---- */}
      <div className="cg-section">
        <TugButton subtype="push" variant="secondary" size="sm" onClick={handleReset}>
          Reset All to Defaults
        </TugButton>
      </div>

    </div>
  );
}
