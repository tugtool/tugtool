/**
 * TugColorAdjustment — edits an offset off a base color expressed as additive
 * TugColor intensity / tone / alpha DELTAS (per the tug-color model), not a
 * chroma multiplier or oklch shift.
 *
 * Shows the base swatch → the adjusted-result swatch, with three delta steppers
 * (iΔ, tΔ, aΔ). Each stepper is a TugValueInput that dispatches SET_VALUE to the
 * host responder under its own sub-sender id; the host maps the three ids back
 * to the delta fields. Use `colorAdjustSenders(id)` to build those bindings.
 */

import React, { useId } from "react";
import { cn } from "@/lib/utils";
import { TugValueInput } from "./tug-value-input";
import { TugColorWell } from "./tug-color-well";
import { swatchOklch, clamp100, type TugColorSpec } from "./tug-color-spec";
import "./tug-color-adjustment.css";

/** Additive deltas in TugColor units (mirror of core's DuetAdjust). */
export interface TugColorDelta {
  iDelta: number;
  tDelta: number;
  aDelta: number;
}

/** The three per-axis sender ids a host binds for one adjustment. */
export function colorAdjustSenders(senderId: string): { i: string; t: string; a: string } {
  return { i: `${senderId}-i`, t: `${senderId}-t`, a: `${senderId}-a` };
}

/** Apply a delta to a base spec (clamped) — the resolved color the row previews. */
export function applyColorDelta(base: TugColorSpec, d: TugColorDelta): TugColorSpec {
  return {
    hue: base.hue,
    adjacent: base.adjacent,
    i: clamp100(base.i + d.iDelta),
    t: clamp100(base.t + d.tDelta),
    a: clamp100(base.a + d.aDelta),
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
}: TugColorAdjustmentProps): React.ReactElement {
  const autoId = useId();
  const ids = colorAdjustSenders(senderId ?? autoId);
  const result = applyColorDelta(base, value);

  return (
    <div data-slot="tug-color-adjustment" className={cn("tug-color-adjustment")}>
      {label && <span className="tug-color-adjustment-label">{label}</span>}
      <span className="tug-color-adjustment-preview">
        {baseSenderId ? (
          <TugColorWell value={base} senderId={baseSenderId} label={baseLabel ?? label} size="sm" showText={false} disabled={disabled} />
        ) : (
          <span className="tug-color-adjustment-swatch" style={{ "--tca-swatch": swatchOklch(base) } as React.CSSProperties} />
        )}
        <span className="tug-color-adjustment-arrow" aria-hidden>→</span>
        <span className="tug-color-adjustment-swatch" style={{ "--tca-swatch": swatchOklch(result) } as React.CSSProperties} />
      </span>
      <span className="tug-color-adjustment-deltas">
        <label className="tug-color-adjustment-delta">
          <span className="tug-color-adjustment-delta-tag">iΔ</span>
          <TugValueInput value={value.iDelta} senderId={ids.i} min={-100} max={100} step={1} size="sm" disabled={disabled} />
        </label>
        <label className="tug-color-adjustment-delta">
          <span className="tug-color-adjustment-delta-tag">tΔ</span>
          <TugValueInput value={value.tDelta} senderId={ids.t} min={-100} max={100} step={1} size="sm" disabled={disabled} />
        </label>
        {showAlpha && (
          <label className="tug-color-adjustment-delta">
            <span className="tug-color-adjustment-delta-tag">aΔ</span>
            <TugValueInput value={value.aDelta} senderId={ids.a} min={-100} max={100} step={1} size="sm" disabled={disabled} />
          </label>
        )}
      </span>
    </div>
  );
}
