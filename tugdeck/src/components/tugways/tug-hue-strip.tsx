/**
 * tug-hue-strip.tsx — Shared hue swatch strip component.
 *
 * Renders a row of 48 color swatches in ADJACENCY_RING order with rotated
 * full-name labels. Used by both the Palette Engine and Theme Generator
 * gallery cards.
 *
 * Rules of Tugways compliance:
 *   - Swatch colors set via inline style, not React appearance state [D08, D09]
 *
 * @module components/tugways/tug-hue-strip
 */

import React from "react";
import {
  ADJACENCY_RING,
  tugColor,
  DEFAULT_CANONICAL_L,
} from "@/components/tugways/palette-engine";
import "./tug-hue-strip.css";

const HUE_NAMES: readonly string[] = ADJACENCY_RING;

export interface TugHueStripProps {
  /** Optional per-hue canonical L overrides (defaults to DEFAULT_CANONICAL_L). */
  canonicalL?: Record<string, number>;
  /** Currently selected hue name, or null. */
  selectedHue: string | null;
  /** Called when a swatch is clicked. */
  onSelectHue: (hueName: string) => void;
  /** Optional data-testid for the strip container. */
  "data-testid"?: string;
}

export function TugHueStrip({
  canonicalL,
  selectedHue,
  onSelectHue,
  "data-testid": testId,
}: TugHueStripProps) {
  const lValues = canonicalL ?? DEFAULT_CANONICAL_L;

  return (
    <div className="tug-hue-strip" data-testid={testId}>
      {HUE_NAMES.map((name) => {
        const color = tugColor(name, 50, 50, lValues[name]);
        const isSelected = name === selectedHue;
        return (
          <div
            key={name}
            className={`tug-hue-strip__item${isSelected ? " tug-hue-strip__item--selected" : ""}`}
            onClick={() => onSelectHue(name)}
          >
            <div
              className="tug-hue-strip__swatch"
              style={{ backgroundColor: color }}
              title={`${name}: ${color}`}
              data-testid="tug-hue-strip-swatch"
              data-color={color}
            />
            <div className="tug-hue-strip__label">{name}</div>
          </div>
        );
      })}
    </div>
  );
}
