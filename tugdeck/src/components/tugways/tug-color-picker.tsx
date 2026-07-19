/**
 * TugColorPicker — the standalone picker surface (one shared instance, the
 * NSColorPanel analog). It edits whichever TugColorWell is active: it reads the
 * active target from active-color-target.ts (useSyncExternalStore) and dispatches
 * SET_COLOR back to that well's host via sendToTarget — the same remote-target
 * pattern the gallery property-inspector uses.
 *
 * Editing is in OKLCH units (per color-palette.md): a compact named-hue swatch grid
 * (one focus stop, arrow-navigable) plus lightness / chroma / alpha sliders. Every
 * interactive part is authored into one focus group so the keyboard loops through
 * them ([P02]); the active-target store is the single truth the well and the picker
 * both read.
 */

import React, { useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TugSlider } from "./tug-slider";
import { TugBox } from "./tug-box";
import { useResponderForm } from "./use-responder-form";
import { useFocusable, useFocusManager } from "./use-focusable";
import { useSpatialOrder } from "./use-spatial-order";
import { rowGridOrder, type SpatialOrder } from "./spatial-order";
import { captureSet } from "./focus-act";
import { CardIdContext } from "@/lib/card-id-context";
import { useRequiredResponderChain } from "./responder-chain-provider";
import { TUG_ACTIONS } from "./action-vocabulary";
import {
  ADJACENCY_RING,
  HUE_FAMILIES,
  AUTHOR_MAX,
  fracFromAuthored,
  chromaFromAuthored,
  authoredFromFrac,
  authoredFromChroma,
  resolveHueAngle,
} from "./tugcolor";
import {
  getActiveColorTarget,
  updateActiveColorValue,
  useActiveColorTarget,
} from "./active-color-target";
import {
  formatTugColorText,
  normalizeSpec,
  swatchOklch,
  type TugColorSpec,
} from "./tugcolor";
import type { ActionPhase } from "./responder-chain";
import "./tug-color-picker.css";

/** The 48 named base hues, ascending angle — the swatch grid's cells. */
const HUE_CELLS = ADJACENCY_RING.filter((h) => HUE_FAMILIES[h] !== undefined);

/** Hue grid geometry — 16 columns × 3 rows (matches the CSS grid). */
const HUE_COLS = 16;
const HUE_ROWS = Math.ceil(HUE_CELLS.length / HUE_COLS);

type ArrowDir = "left" | "right" | "up" | "down";

/** Move within the hue grid by one cell in a direction, wrapping at every edge. */
function moveHueIndex(idx: number, dir: ArrowDir): number {
  const i = idx < 0 ? 0 : idx;
  const col = i % HUE_COLS;
  const row = Math.floor(i / HUE_COLS);
  let r = row;
  let c = col;
  if (dir === "left") c = (col + HUE_COLS - 1) % HUE_COLS;
  else if (dir === "right") c = (col + 1) % HUE_COLS;
  else if (dir === "up") r = (row + HUE_ROWS - 1) % HUE_ROWS;
  else r = (row + 1) % HUE_ROWS;
  // Rows are full (48 = 3×16); guard a short last row anyway by clamping in-range.
  const next = r * HUE_COLS + c;
  return next < HUE_CELLS.length ? next : HUE_CELLS.length - 1;
}

const ARROW_DIRS: Record<string, ArrowDir> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** Fixed value-box width so every slider's track (and value) lines up (holds a 4-digit 0–1000 value). */
const SLIDER_VALUE_WIDTH = "4rem";

/** The picker always shows a color; with no active well it edits this scratch. */
const SCRATCH_DEFAULT: TugColorSpec = { hue: "blue", l: 0.5, c: 0.12, a: 1 };

/** A representative l/c for painting a hue grid cell (mid lightness, vivid). */
const CELL_L = 0.6;
const CELL_C = 0.16;

export function TugColorPicker(): React.ReactElement {
  const manager = useRequiredResponderChain();
  const active = useActiveColorTarget();
  // Always show a color (NSColorPanel model): edit the active well when one is
  // active, otherwise a local scratch color so the picker is never empty.
  const [scratch, setScratch] = useState<TugColorSpec>(SCRATCH_DEFAULT);
  const value = active?.value ?? scratch;
  const valueRef = useRef(value);
  valueRef.current = value;

  const focusGroup = useId();
  const lId = useId();
  const cId = useId();
  const aId = useId();
  const hueGridId = useId();

  // Land keyboard focus on a control so the loop is reachable: arm the hue grid
  // (loop start) the first time a color is active and this card is the key card.
  // Armed ONCE per activation (a ref guard) so it seeds the loop without yanking
  // focus back from a slider the user Tabbed to; it re-seeds after the color
  // clears and a new well activates.
  const focusManager = useFocusManager();
  const cardId = useContext(CardIdContext);
  const seededRef = useRef(false);
  useLayoutEffect(() => {
    if (!focusManager) return;
    const focusKey = `${focusGroup}:0`;
    const arm = (): void => {
      if (seededRef.current) return;
      if (cardId !== null && focusManager.keyCard() !== cardId) return;
      seededRef.current = true;
      focusManager.place(cardId, { kind: "focus-key", focusKey }, { modality: "keyboard" });
    };
    arm();
    return focusManager.subscribe(arm);
  }, [focusManager, cardId, focusGroup]);

  // Compose the next spec from a partial edit. With an active well, push it to
  // the well's host (sendToTarget) plus the shared store so the well and these
  // controls repaint from one truth; with no active well, update the local
  // scratch so the picker stays live as a standalone color tool.
  const editColor = useCallback(
    (partial: Partial<TugColorSpec>, phase: ActionPhase): void => {
      const target = getActiveColorTarget();
      if (!target) {
        setScratch((prev) => normalizeSpec({ ...prev, ...partial }));
        return;
      }
      const next = normalizeSpec({ ...target.value, ...partial });
      updateActiveColorValue(target.senderId, next);
      manager.sendToTarget(target.targetId, {
        action: TUG_ACTIONS.SET_COLOR,
        sender: target.senderId,
        phase,
        value: next,
      });
    },
    [manager],
  );

  // Hue grid — one Tab stop that owns all four arrows for 2D navigation with
  // wraparound. It captures the arrows (so the spatial navigator yields, [P25])
  // and selects live on every move (the picker is a live-preview surface, so the
  // move IS the selection — no separate cursor or commit).
  const { focusableRef: hueGridRef } = useFocusable({
    id: hueGridId,
    group: focusGroup,
    order: 0,
    register: true,
    behavior: () => ({
      container: "none",
      captures: captureSet(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]),
    }),
  });
  const onHueGridKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      const dir = ARROW_DIRS[event.key];
      if (!dir || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      const cur = HUE_CELLS.indexOf(valueRef.current.hue);
      const hue = HUE_CELLS[moveHueIndex(cur, dir)];
      editColor({ hue, adjacent: undefined }, "discrete");
    },
    [editColor],
  );

  // Slider stack — Left/Right adjust value (the sliders capture them); declare a
  // vertical order so Up/Down move the ring between the three sliders (wrapping)
  // instead of dead-ending into a system beep ([P22]/[P23]).
  const sliderOrder = useMemo<SpatialOrder>(
    () => rowGridOrder([
      [`${focusGroup}:1`], [`${focusGroup}:2`], [`${focusGroup}:3`],
    ]),
    [focusGroup],
  );
  useSpatialOrder(sliderOrder);

  // Sliders edit in authored units (0–1000); the spec stays in oklch fractions.
  // Chroma is absolute (a fraction of MAX_CHROMA) but still gamut-clamped, so it
  // reads the CURRENT hue + lightness (from valueRef per L07 — registered once at mount).
  const { ResponderScope, responderRef } = useResponderForm({
    setValueNumber: {
      [lId]: (v: number, phase: ActionPhase) => editColor({ l: fracFromAuthored(v) }, phase),
      [cId]: (v: number, phase: ActionPhase) => {
        const cur = valueRef.current;
        const angle = resolveHueAngle(cur.hue, cur.adjacent);
        editColor({ c: angle === undefined ? cur.c : chromaFromAuthored(v, cur.l, angle) }, phase);
      },
      [aId]: (v: number, phase: ActionPhase) => editColor({ a: fracFromAuthored(v) }, phase),
    },
  });

  // The chroma slider shows the authored value (a fraction of MAX_CHROMA), gamut-clamped.
  const chromaAuthored = (s: TugColorSpec): number => {
    const angle = resolveHueAngle(s.hue, s.adjacent);
    return angle === undefined ? 0 : authoredFromChroma(s.c, s.l, angle);
  };

  return (
    <ResponderScope>
      <div
        ref={responderRef as (el: HTMLDivElement | null) => void}
        data-slot="tug-color-picker"
        className="tug-color-picker"
      >
        <header className="tug-color-picker-head">
          <span
            className="tug-color-picker-preview"
            style={{ "--tcp-swatch": swatchOklch(value) } as React.CSSProperties}
          />
          <span className="tug-color-picker-head-text">
            <span className="tug-color-picker-target">{active?.label ?? "Color"}</span>
            <span className="tug-color-picker-readout">{formatTugColorText(value)}</span>
          </span>
        </header>

        <div
          ref={hueGridRef as (el: HTMLDivElement | null) => void}
          onKeyDown={onHueGridKeyDown}
          tabIndex={0}
          role="group"
          aria-label="Hue"
          className="tug-color-picker-hue-grid"
        >
          <span className="tug-color-picker-hue-caret" aria-hidden />
          {HUE_CELLS.map((hue) => (
            <button
              key={hue}
              type="button"
              data-tug-focus="refuse"
              data-hue={hue}
              data-active={value.hue === hue && !value.adjacent ? "" : undefined}
              title={`${hue} (${HUE_FAMILIES[hue]}°)`}
              aria-label={`${hue} (${HUE_FAMILIES[hue]} degrees)`}
              className="tug-color-picker-hue-cell"
              style={{ "--tcp-cell": swatchOklch({ hue, l: CELL_L, c: CELL_C, a: 1 }) } as React.CSSProperties}
              onClick={() => editColor({ hue, adjacent: undefined }, "discrete")}
            />
          ))}
        </div>

        {/* OKLCH axes — lightness / chroma / alpha on one 0–1000 scale. */}
        <TugBox label="OKLCH" variant="bordered" size="sm" className="tug-color-picker-box">
          <div className="tug-color-picker-sliders">
            <TugSlider label="Lightness" senderId={lId} value={authoredFromFrac(value.l)} min={0} max={AUTHOR_MAX} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={focusGroup} focusOrder={1} />
            <TugSlider label="Chroma" senderId={cId} value={chromaAuthored(value)} min={0} max={AUTHOR_MAX} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={focusGroup} focusOrder={2} />
            <TugSlider label="Alpha" senderId={aId} value={authoredFromFrac(value.a)} min={0} max={AUTHOR_MAX} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={focusGroup} focusOrder={3} />
          </div>
        </TugBox>
      </div>
    </ResponderScope>
  );
}
