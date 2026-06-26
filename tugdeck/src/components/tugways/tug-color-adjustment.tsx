/**
 * TugColorAdjustment — edits an offset off a base color expressed as additive
 * OKLCH lightness / chroma / alpha DELTAS, not a chroma multiplier or hue shift.
 *
 * Shows the base swatch → the adjusted-result swatch, with three delta steppers
 * (lΔ, cΔ, aΔ). Each stepper is a TugValueInput that dispatches SET_VALUE to the
 * host responder under its own sub-sender id; the host maps the three ids back
 * to the delta fields. Use `colorAdjustSenders(id)` to build those bindings.
 */

import React, { useId } from "react";
import { cn } from "@/lib/utils";
import { TugValueInput } from "./tug-value-input";
import { TugColorWell } from "./tug-color-well";
import { swatchOklch, clamp01, clampChroma, MAX_CHROMA, type TugColorSpec } from "./tug-color-spec";
import "./tug-color-adjustment.css";

/** Additive deltas in OKLCH units (mirror of core's DuetAdjust). */
export interface TugColorDelta {
  lDelta: number;
  cDelta: number;
  aDelta: number;
}

/** The three per-axis sender ids a host binds for one adjustment. */
export function colorAdjustSenders(senderId: string): { l: string; c: string; a: string } {
  return { l: `${senderId}-l`, c: `${senderId}-c`, a: `${senderId}-a` };
}

/** Apply a delta to a base spec (clamped) — the resolved color the row previews. */
export function applyColorDelta(base: TugColorSpec, d: TugColorDelta): TugColorSpec {
  return {
    hue: base.hue,
    adjacent: base.adjacent,
    l: clamp01(base.l + d.lDelta),
    c: clampChroma(base.c + d.cDelta),
    a: clamp01(base.a + d.aDelta),
  };
}

export interface TugColorAdjustmentProps {
  /** The reference color the deltas are measured from. */
  base: TugColorSpec;
  /** Current deltas. */
  value: TugColorDelta;
  /** Stable id; the three axis sub-senders derive from it. */
  senderId?: string;
  label?: string;
  /** Hide the alpha delta stepper (axes with no alpha). */
  showAlpha?: boolean;
  /**
   * When set, the base swatch becomes an editable TugColorWell with this sender —
   * clicking it activates the shared picker to choose the base color (e.g. the
   * axis hue). When omitted, the base renders as a static swatch.
   */
  baseSenderId?: string;
  baseLabel?: string;
  disabled?: boolean;
  /**
   * Author the editable base well + delta steppers into a focus group ([P02]),
   * starting at {@link focusOrderBase}: base well = base, iΔ = base+1, tΔ = base+2,
   * aΔ = base+3. Only meaningful with `baseSenderId`.
   */
  focusGroup?: string;
  focusOrderBase?: number;
}

export function TugColorAdjustment({
  base,
  value,
  senderId,
  label,
  showAlpha = true,
  baseSenderId,
  baseLabel,
  disabled = false,
  focusGroup,
  focusOrderBase = 0,
}: TugColorAdjustmentProps): React.ReactElement {
  const autoId = useId();
  const ids = colorAdjustSenders(senderId ?? autoId);
  const result = applyColorDelta(base, value);

  // Input chip → delta steppers → output chip. When an editable base is wanted
  // (baseSenderId), both ends are full TugColorWells (an editable input, a
  // read-only output); otherwise they are compact swatches.
  return (
    <div data-slot="tug-color-adjustment" className={cn("tug-color-adjustment")}>
      {label && <span className="tug-color-adjustment-label">{label}</span>}
      {baseSenderId ? (
        <TugColorWell value={base} senderId={baseSenderId} label={baseLabel ?? label} size="sm" disabled={disabled} focusGroup={focusGroup} focusOrder={focusOrderBase} />
      ) : (
        <span className="tug-color-adjustment-swatch" style={{ "--tca-swatch": swatchOklch(base) } as React.CSSProperties} />
      )}
      <span className="tug-color-adjustment-deltas">
        <label className="tug-color-adjustment-delta">
          <span className="tug-color-adjustment-delta-tag">lΔ</span>
          <TugValueInput value={value.lDelta} senderId={ids.l} min={-1} max={1} step={0.01} size="sm" disabled={disabled} focusGroup={focusGroup} focusOrder={focusOrderBase + 1} />
        </label>
        <label className="tug-color-adjustment-delta">
          <span className="tug-color-adjustment-delta-tag">cΔ</span>
          <TugValueInput value={value.cDelta} senderId={ids.c} min={-MAX_CHROMA} max={MAX_CHROMA} step={0.005} size="sm" disabled={disabled} focusGroup={focusGroup} focusOrder={focusOrderBase + 2} />
        </label>
        {showAlpha && (
          <label className="tug-color-adjustment-delta">
            <span className="tug-color-adjustment-delta-tag">aΔ</span>
            <TugValueInput value={value.aDelta} senderId={ids.a} min={-1} max={1} step={0.01} size="sm" disabled={disabled} focusGroup={focusGroup} focusOrder={focusOrderBase + 3} />
          </label>
        )}
      </span>
      {baseSenderId ? (
        <TugColorWell value={result} size="sm" readOnly />
      ) : (
        <span className="tug-color-adjustment-swatch" style={{ "--tca-swatch": swatchOklch(result) } as React.CSSProperties} />
      )}
    </div>
  );
}
