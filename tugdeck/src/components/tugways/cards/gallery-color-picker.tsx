/**
 * Gallery demo for the TugColor primitives.
 *
 * GalleryColorWells — a host card holding several TugColorWells plus a
 * TugColorAdjustment. It owns the color values (React state) and registers a
 * responder that handles ACTIVATE_COLOR_WELL (record itself as the active color
 * target) and SET_COLOR (apply the picker's edit). The wells are controls; this
 * card is the responder, exactly the well-vs-panel split from AppKit.
 *
 * GalleryColorPicker — the standalone picker surface, registered as its own
 * card. Open both cards: clicking a well in the wells card lights it up and the
 * picker card edits it live, across cards, via the shared active-target store.
 */

import React, { useCallback, useId, useRef, useState } from "react";
import { useResponder } from "../use-responder";
import type { ActionEvent } from "../responder-chain";
import { TUG_ACTIONS } from "../action-vocabulary";
import { setActiveColorTarget } from "../active-color-target";
import { TugColorWell } from "../tug-color-well";
import { TugColorPicker } from "../tug-color-picker";
import { TugColorAdjustment, colorAdjustSenders, type TugColorDelta } from "../tug-color-adjustment";
import { fracFromAuthored } from "../palette-engine";
import type { TugColorSpec } from "../tug-color-spec";
import "./gallery-color-picker.css";

const WELLS: { id: string; label: string; spec: TugColorSpec }[] = [
  { id: "well-filled", label: "Filled", spec: { hue: "blue", l: 0.55, c: 0.18, a: 1 } },
  { id: "well-tinted", label: "Tinted", spec: { hue: "blue", l: 0.5, c: 0.16, a: 0.4 } },
  { id: "well-textsel", label: "Text selection", spec: { hue: "blue", l: 0.59, c: 0.14, a: 0.4 } },
  { id: "well-link", label: "Link", spec: { hue: "cobalt", l: 0.9, c: 0.07, a: 1 } },
];

const ADJ_BASE: TugColorSpec = { hue: "blue", l: 0.59, c: 0.14, a: 1 };
const ADJ_ID = "demo-adjust";

export function GalleryColorWells(): React.ReactElement {
  const responderId = useId();
  const [specs, setSpecs] = useState<Record<string, TugColorSpec>>(() =>
    Object.fromEntries(WELLS.map((w) => [w.id, w.spec])),
  );
  const [delta, setDelta] = useState<TugColorDelta>({ lDelta: 0, cDelta: 0, aDelta: 0 });

  // L07: handlers read live state through refs, not render closures.
  const specsRef = useRef(specs);
  specsRef.current = specs;

  const labelOf = (id: string): string => WELLS.find((w) => w.id === id)?.label ?? "Color";

  const handleActivate = useCallback(
    (event: ActionEvent) => {
      const sender = typeof event.sender === "string" ? event.sender : "";
      const spec = specsRef.current[sender];
      if (!spec) return;
      setActiveColorTarget({ targetId: responderId, senderId: sender, label: labelOf(sender), value: spec });
    },
    [responderId],
  );

  const handleSetColor = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : "";
    const next = event.value as TugColorSpec | undefined;
    if (!sender || !next) return;
    setSpecs((prev) => ({ ...prev, [sender]: next }));
  }, []);

  const handleSetValue = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : "";
    const v = typeof event.value === "number" ? event.value : NaN;
    if (Number.isNaN(v)) return;
    // Steppers emit authored ×1000 absolute deltas; stored as oklch fractions.
    const ids = colorAdjustSenders(ADJ_ID);
    if (sender === ids.l) setDelta((d) => ({ ...d, lDelta: fracFromAuthored(v) }));
    else if (sender === ids.c) setDelta((d) => ({ ...d, cDelta: fracFromAuthored(v) }));
    else if (sender === ids.a) setDelta((d) => ({ ...d, aDelta: fracFromAuthored(v) }));
  }, []);

  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.ACTIVATE_COLOR_WELL]: handleActivate,
      [TUG_ACTIONS.SET_COLOR]: handleSetColor,
      [TUG_ACTIONS.SET_VALUE]: handleSetValue,
    },
  });

  return (
    <ResponderScope>
      <div ref={responderRef as (el: HTMLDivElement | null) => void} className="gallery-color-wells">
        <p className="gallery-color-wells-hint">
          Click a well to activate it, then edit it in the <strong>Color Picker</strong> card.
        </p>
        <div className="gallery-color-wells-list">
          {WELLS.map((w) => (
            <TugColorWell key={w.id} senderId={w.id} label={w.label} value={specs[w.id]} />
          ))}
        </div>
        <div className="gallery-color-wells-adjust">
          <TugColorAdjustment base={ADJ_BASE} value={delta} senderId={ADJ_ID} label="Adjustment" />
        </div>
      </div>
    </ResponderScope>
  );
}

export function GalleryColorPicker(): React.ReactElement {
  return <TugColorPicker />;
}
