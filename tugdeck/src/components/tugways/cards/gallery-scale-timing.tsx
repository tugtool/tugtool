/**
 * gallery-scale-timing.tsx -- Scale & Timing interactive demo tab.
 *
 * Interactive controls for the three global CSS multipliers:
 *   --tug-zoom   dimension multiplier (range 0.85–2.0), applied via CSS zoom on body
 *   --tug-timing  animation-duration multiplier (range 0.1–10.0)
 *   --tug-motion  binary motion toggle (0 or 1)
 *
 * Rules of Tugways compliance:
 *   - Slider/toggle state uses useState for local UI state only [D40]
 *   - CSS custom properties set via style.setProperty() on DOM elements [D08, D09]
 *   - useEffect cleanup restores all CSS custom properties on unmount [D40]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-scale-timing
 */

import React, { useState, useEffect, useCallback } from "react";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { getTugZoom, getTugTiming, isTugMotionEnabled } from "@/components/tugways/scale-timing";
import { Star } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SCALE = 1;
const DEFAULT_TIMING = 1;
const DEFAULT_MOTION = true;

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
  /** Called on pointer release — use for expensive CSS changes like zoom. */
  onCommit?: (v: number) => void;
  note?: string;
}

function SliderRow({ label, id, min, max, step, value, onChange, onCommit, note }: SliderRowProps) {
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
        onPointerUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            onCommit?.(parseFloat((e.target as HTMLInputElement).value));
          }
        }}
      />
      <span className="cg-st-value">{formatValue(value, step < 0.1 ? 2 : 1)}</span>
      {note && <span className="cg-st-note">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryScaleTiming
// ---------------------------------------------------------------------------

/**
 * GalleryScaleTiming -- Scale & Timing demo tab.
 *
 * Provides sliders and toggles for the global CSS multipliers.
 * Sets CSS custom properties directly on document.documentElement
 * (for global tokens). Cleans up all changes on unmount.
 *
 * The scale slider applies CSS zoom on pointer release (not continuously)
 * because zoom triggers a full layout recalculation.
 *
 * **Authoritative reference:** Spec S08 (#s08-gallery-tab)
 */
export function GalleryScaleTiming() {
  const [scale, setScaleState] = useState(DEFAULT_SCALE);
  const [timing, setTimingState] = useState(DEFAULT_TIMING);
  const [motionOn, setMotionOnState] = useState(DEFAULT_MOTION);

  // JS helper readout state — updated whenever sliders change
  const [readout, setReadout] = useState(() => ({
    scale: getTugZoom(),
    timing: getTugTiming(),
    motionEnabled: isTugMotionEnabled(),
  }));

  const updateReadout = useCallback(() => {
    setReadout({
      scale: getTugZoom(),
      timing: getTugTiming(),
      motionEnabled: isTugMotionEnabled(),
    });
  }, []);

  // Scale slider: track value in state (slider moves), apply zoom on commit
  const setScale = useCallback((v: number) => {
    setScaleState(v);
  }, []);

  const commitScale = useCallback((v: number) => {
    document.documentElement.style.setProperty("--tug-zoom", String(v));
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

  // Reset all multipliers to defaults
  const handleReset = useCallback(() => {
    setScale(DEFAULT_SCALE);
    commitScale(DEFAULT_SCALE);
    setTiming(DEFAULT_TIMING);
    setMotionOn(DEFAULT_MOTION);
  }, [setScale, commitScale, setTiming, setMotionOn]);

  // Cleanup: restore all CSS custom properties to defaults on unmount.
  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("--tug-zoom");
      document.documentElement.style.removeProperty("--tug-timing");
      document.documentElement.style.removeProperty("--tug-motion");
      document.body.removeAttribute("data-tug-motion");
    };
  }, []);

  return (
    <div className="cg-content" data-testid="gallery-scale-timing">

      {/* ---- Global Multipliers ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Global Multipliers</div>
        <div className="cg-controls cg-st-controls">
          <SliderRow
            label="--tug-zoom"
            id="st-scale"
            min={0.85}
            max={2.0}
            step={0.05}
            value={scale}
            onChange={setScale}
            onCommit={commitScale}
            note="CSS zoom on body — scales entire UI including layout"
          />
          <SliderRow
            label="--tug-timing"
            id="st-timing"
            min={0.1}
            max={10.0}
            step={0.1}
            value={timing}
            onChange={setTiming}
            note="Scales all --tug-motion-duration-* tokens"
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

      {/* ---- JS Helper Readout ---- */}
      <div className="cg-section">
        <div className="cg-section-title">JS Helper Readout</div>
        <div className="cg-st-readout" data-testid="st-readout">
          <div className="cg-st-readout-row">
            <span className="cg-st-readout-fn">getTugZoom()</span>
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
            <TugPushButton emphasis="filled" role="accent" size="md">Filled Accent</TugPushButton>
            <TugPushButton size="md">Outlined Active</TugPushButton>
            <TugPushButton emphasis="ghost" size="md">Ghost Active</TugPushButton>
            <TugPushButton emphasis="filled" role="danger" size="md">Filled Danger</TugPushButton>
          </div>
          <div className="cg-st-preview-row">
            <TugPushButton emphasis="filled" role="accent" size="sm">Small</TugPushButton>
            <TugPushButton size="sm">Small</TugPushButton>
            <TugButton
              subtype="icon"
              size="md"
              icon={<Star size={14} />}
              aria-label="Icon button"
            />
            <TugButton subtype="icon-text" size="md" icon={<Star size={14} />}>
              Icon + Text
            </TugButton>
          </div>
          <div className="cg-st-preview-row">
            <TugPushButton size="md" loading>Loading</TugPushButton>
          </div>

          {/* ---- Petals Spinner ---- */}
          <div className="cg-st-preview-row">
            <span className="cg-st-indicator-label">Petals</span>
            {[18].map((sz) => (
              <span
                key={sz}
                className="tug-petals"
                style={{ "--tug-petals-size": `${sz}px` } as React.CSSProperties}
              >
                <span className="petal" /><span className="petal" /><span className="petal" /><span className="petal" />
                <span className="petal" /><span className="petal" /><span className="petal" /><span className="petal" />
              </span>
            ))}
          </div>

          {/* ---- Pole Progress Bar ---- */}
          <div className="cg-st-preview-row">
            <span className="cg-st-indicator-label">Pole</span>
            <div style={{ width: "30%" }}>
              <div className="tug-pole"><div className="tug-pole-inner" /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Reset ---- */}
      <div className="cg-section">
        <TugPushButton size="sm" onClick={handleReset}>
          Reset All to Defaults
        </TugPushButton>
      </div>

    </div>
  );
}
