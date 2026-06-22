/**
 * TugColorPicker — the standalone picker surface (one shared instance, the
 * NSColorPanel analog). It edits whichever TugColorWell is active: it reads the
 * active target from active-color-target.ts (useSyncExternalStore) and dispatches
 * SET_COLOR back to that well's host via sendToTarget — the same remote-target
 * pattern the gallery property-inspector uses.
 *
 * Editing is in TugColor units only (per color-palette.md): a compact named-hue
 * swatch grid (one focus stop, arrow-navigable), a preset TugChoiceGroup with a
 * `custom` slot, and intensity / tone / alpha sliders. Every interactive part is
 * authored into one focus group so the keyboard loops through them ([P02]); the
 * active-target store is the single truth the well and the picker both read.
 */

import React, { useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TugSlider } from "./tug-slider";
import { TugBox } from "./tug-box";
import { TugChoiceGroup, type TugChoiceItem } from "./tug-choice-group";
import { useResponderForm } from "./use-responder-form";
import { useFocusable, useFocusManager } from "./use-focusable";
import { useSpatialOrder } from "./use-spatial-order";
import { rowGridOrder, type SpatialOrder } from "./spatial-order";
import { captureSet } from "./focus-act";
import { CardIdContext } from "@/lib/card-id-context";
import { useRequiredResponderChain } from "./responder-chain-provider";
import { TUG_ACTIONS } from "./action-vocabulary";
import { ADJACENCY_RING, HUE_FAMILIES, TUG_COLOR_PRESETS } from "./palette-engine";
import {
  getActiveColorTarget,
  updateActiveColorValue,
  useActiveColorTarget,
} from "./active-color-target";
import {
  chromaOf,
  formatTugColorText,
  intensityForChroma,
  lightnessOf,
  normalizeSpec,
  peakChromaFor,
  swatchOklch,
  toneForLightness,
  type TugColorSpec,
} from "./tug-color-spec";
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

const PRESET_NAMES = ["canonical", "light", "dark", "intense", "muted"] as const;
const CUSTOM = "custom";

/** Fixed value-box width so every slider's track (and value) lines up. */
const SLIDER_VALUE_WIDTH = "3.5rem";

/** The picker always shows a color; with no active well it edits this scratch. */
const SCRATCH_DEFAULT: TugColorSpec = { hue: "blue", i: 50, t: 50, a: 100 };

const PRESET_ITEMS: TugChoiceItem[] = [
  ...PRESET_NAMES.map((name) => ({ value: name, label: name })),
  { value: CUSTOM, label: CUSTOM },
];

/** Which preset (if any) a value's i/t matches — else "custom". */
function presetOf(spec: TugColorSpec): string {
  for (const name of PRESET_NAMES) {
    const p = TUG_COLOR_PRESETS[name];
    if (p.intensity === spec.i && p.tone === spec.t) return name;
  }
  return CUSTOM;
}

export function TugColorPicker(): React.ReactElement {
  const manager = useRequiredResponderChain();
  const active = useActiveColorTarget();
  // Always show a color (NSColorPanel model): edit the active well when one is
  // active, otherwise a local scratch color so the picker is never empty.
  const [scratch, setScratch] = useState<TugColorSpec>(SCRATCH_DEFAULT);
  const value = active?.value ?? scratch;
  const valueRef = useRef(value);
  valueRef.current = value;

  // The presets group is normally derived from the color (presetOf), but the user
  // can explicitly rest the selection on "custom" even while the color happens to
  // match a preset — so honor that choice until the color is next edited. Reset
  // when a different well is activated.
  const [customForced, setCustomForced] = useState(false);
  useLayoutEffect(() => { setCustomForced(false); }, [active?.senderId]);

  const focusGroup = useId();
  const iId = useId();
  const tId = useId();
  const aId = useId();
  const presetId = useId();
  const hueGridId = useId();
  const cId = useId();
  const lId = useId();

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
      focusManager.contextFor(cardId).armKeyboardRestore(focusKey);
    };
    arm();
    return focusManager.subscribe(arm);
  }, [focusManager, cardId, focusGroup]);

  // Compose the next spec from a partial edit. With an active well, push it to
  // the well's host (sendToTarget) plus the shared store so the well and these
  // controls repaint from one truth; with no active well, update the local
  // scratch so the picker stays live as a standalone color tool.
  const dispatchSpec = useCallback(
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

  // A color edit from the hue grid or sliders releases any forced "custom" so the
  // presets group resyncs to whatever preset (or custom) the new color matches.
  const editColor = useCallback(
    (partial: Partial<TugColorSpec>, phase: ActionPhase): void => {
      setCustomForced(false);
      dispatchSpec(partial, phase);
    },
    [dispatchSpec],
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
      [`${focusGroup}:4`], [`${focusGroup}:5`],
    ]),
    [focusGroup],
  );
  useSpatialOrder(sliderOrder);

  const { ResponderScope, responderRef } = useResponderForm({
    setValueNumber: {
      [iId]: (v: number, phase: ActionPhase) => editColor({ i: v }, phase),
      [tId]: (v: number, phase: ActionPhase) => editColor({ t: v }, phase),
      [aId]: (v: number, phase: ActionPhase) => editColor({ a: v }, phase),
      // Perceptual axes: edit absolute chroma / lightness, back-solving i / t for
      // the current hue (so the same C reads the same on any hue).
      [cId]: (v: number, phase: ActionPhase) =>
        editColor({ i: intensityForChroma(valueRef.current, v) }, phase),
      [lId]: (v: number, phase: ActionPhase) =>
        editColor({ t: toneForLightness(valueRef.current, v) }, phase),
    },
    selectValue: {
      [presetId]: (name: string) => {
        // "custom" is a real, restable selection — hold it (don't snap back to the
        // preset the color matches). A real preset applies its i/t and releases.
        if (name === CUSTOM) {
          setCustomForced(true);
          return;
        }
        setCustomForced(false);
        const p = TUG_COLOR_PRESETS[name];
        if (p) dispatchSpec({ i: p.intensity, t: p.tone }, "discrete");
      },
    },
  });

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
              style={{ "--tcp-cell": swatchOklch({ hue, i: 70, t: 50, a: 100 }) } as React.CSSProperties}
              onClick={() => editColor({ hue, adjacent: undefined }, "discrete")}
            />
          ))}
        </div>

        {/* TugColor axes — gamut-relative intensity / tone / alpha. */}
        <TugBox label="TugColor" variant="bordered" size="sm" className="tug-color-picker-box">
          <div className="tug-color-picker-sliders">
            <TugSlider label="Intensity" senderId={iId} value={value.i} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={focusGroup} focusOrder={1} />
            <TugSlider label="Tone" senderId={tId} value={value.t} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={focusGroup} focusOrder={2} />
            <TugSlider label="Alpha" senderId={aId} value={value.a} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={focusGroup} focusOrder={3} />
          </div>
        </TugBox>

        {/* OKLCH axes — absolute chroma / lightness. Editing these back-solves
            i / t for the hue, so the same C reads as the same saturation anywhere. */}
        <TugBox label="OKLCH" variant="bordered" size="sm" className="tug-color-picker-box">
          <div className="tug-color-picker-sliders">
            <TugSlider label="Chroma" senderId={cId} value={Math.round(chromaOf(value) * 1000) / 1000} min={0} max={Math.round(peakChromaFor(value) * 1000) / 1000} step={0.005} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={focusGroup} focusOrder={4} />
            <TugSlider label="Lightness" senderId={lId} value={Math.round(lightnessOf(value) * 1000) / 1000} min={0} max={1} step={0.005} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={focusGroup} focusOrder={5} />
          </div>
        </TugBox>

        <div className="tug-color-picker-presets">
          <TugChoiceGroup
            items={PRESET_ITEMS}
            value={customForced ? CUSTOM : presetOf(value)}
            senderId={presetId}
            size="xs"
            aria-label="Presets"
            commit="live"
            focusGroup={focusGroup}
            focusOrder={6}
          />
        </div>
      </div>
    </ResponderScope>
  );
}
