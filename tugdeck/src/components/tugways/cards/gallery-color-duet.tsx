/**
 * gallery-color-duet.tsx -- Key + Accent color-duet workshop.
 *
 * A live tuning board for the per-theme Key (selection / primary action) +
 * Accent (affordances: caret, focus ring, drag-drop, activity) duet, expressed
 * in the TugColor model (color-palette.md). Each role is tuned by two knobs:
 *
 *   - Hue: a TugColor hue <select>. Choosing one writes that hue's palette
 *     constants — var(--tugc-{hue}-h / -canonical-l / -peak-c) — into the
 *     board's indirection vars (--duet-key-h / -canon-l / -peak-c). The ramp
 *     rungs in gallery-color-duet.css are the TugColor piecewise formula over
 *     those constants, so every rung re-evaluates through the real model (right
 *     canonical L, gamut-safe + P3-wider peak chroma).
 *   - Chroma scale: a multiplier on every rung's chroma (--duet-key-c-scale),
 *     for restraint (e.g. pale pink Key on bravura/aria).
 *
 * The board-scoped Table-T01 --tug7-* repoints route the real components below
 * through the ramps. All painting is style.setProperty on the board ([L06]);
 * useState holds only the controlled inputs and the copy-out readout ([L24]).
 *
 * Laws:
 *  - [L06] appearance via style.setProperty + CSS, never React-state-driven.
 *  - [L02] the list data source enters React via TugListView's
 *    useSyncExternalStore contract (a trivial constant store here).
 *  - [L19] gallery-card authoring; registered in gallery-registrations.tsx.
 */

import React, { useId, useRef, useState } from "react";

import { ADJACENCY_RING, HUE_FAMILIES } from "@/components/tugways/palette-engine";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import "./gallery.css";
import "./gallery-color-duet.css";

// ---------------------------------------------------------------------------
// Seed model
// ---------------------------------------------------------------------------

interface Seed {
  keyHue: string;
  keyCScale: number;
  accHue: string;
  accCScale: number;
}

/** Default = today's brio (blue Key / orange Accent), an exact baseline. */
const SEED_TODAY: Seed = { keyHue: "blue", keyCScale: 1, accHue: "orange", accCScale: 1 };

/**
 * Per-theme starting duets to tune ([Q01]). Restrained chroma; bravura/aria Key
 * lean pale rose-violet (low chroma scale), never saturated red. Starting
 * points — the workshop tunes them and the Copy button captures the result.
 */
const PRESETS: ReadonlyArray<{ name: string; seed: Seed }> = [
  { name: "today (brio)", seed: SEED_TODAY },
  { name: "brio", seed: { keyHue: "cobalt", keyCScale: 0.9, accHue: "orange", accCScale: 0.85 } },
  { name: "harmony", seed: { keyHue: "cobalt", keyCScale: 0.9, accHue: "orange", accCScale: 0.9 } },
  { name: "nocturne", seed: { keyHue: "sapphire", keyCScale: 0.85, accHue: "aqua", accCScale: 0.8 } },
  { name: "bravura", seed: { keyHue: "cerise", keyCScale: 0.55, accHue: "aqua", accCScale: 0.8 } },
  { name: "aria", seed: { keyHue: "cerise", keyCScale: 0.5, accHue: "azure", accCScale: 0.8 } },
  { name: "vivace", seed: { keyHue: "cerulean", keyCScale: 0.85, accHue: "tangerine", accCScale: 0.85 } },
];

// ---------------------------------------------------------------------------
// List data source (real TugListView — genuine selection fill + caret)
// ---------------------------------------------------------------------------

class DuetListDataSource implements TugListViewDataSource {
  constructor(private readonly labels: readonly string[]) {}
  numberOfItems(): number {
    return this.labels.length;
  }
  idForIndex(index: number): string {
    return `duet-row-${index}`;
  }
  kindForIndex(): string {
    return "row";
  }
  subscribe(): () => void {
    return () => {};
  }
  getVersion(): unknown {
    return this.labels;
  }
  labelAt(index: number): string {
    return this.labels[index] ?? "";
  }
}

const LIST_ROWS = ["Selection follows the cursor", "Bravo", "Charlie", "Delta"];

function DuetRowCell({
  index,
  dataSource,
}: TugListViewCellProps<DuetListDataSource>): React.ReactElement {
  return (
    <div style={{ padding: "8px 12px", fontSize: "0.875rem" }}>
      {dataSource.labelAt(index)}
    </div>
  );
}

const LIST_CELL_RENDERERS = { row: DuetRowCell };

// ---------------------------------------------------------------------------
// GalleryColorDuet
// ---------------------------------------------------------------------------

export function GalleryColorDuet(): React.ReactElement {
  const boardRef = useRef<HTMLDivElement>(null);

  // Local-data only: controlled inputs + copy-out readout. The paint is the
  // setProperty calls below, never a React-state-driven style ([L06]).
  const [seed, setSeed] = useState<Seed>(SEED_TODAY);
  const [copied, setCopied] = useState(false);

  const setVar = (name: string, value: string): void => {
    boardRef.current?.style.setProperty(name, value);
  };

  const applyHue = (role: "key" | "accent", hue: string): void => {
    setVar(`--duet-${role}-h`, `var(--tugc-${hue}-h)`);
    setVar(`--duet-${role}-canon-l`, `var(--tugc-${hue}-canonical-l)`);
    setVar(`--duet-${role}-peak-c`, `var(--tugc-${hue}-peak-c)`);
  };

  const applySeed = (next: Seed): void => {
    applyHue("key", next.keyHue);
    applyHue("accent", next.accHue);
    setVar("--duet-key-c-scale", String(next.keyCScale));
    setVar("--duet-accent-c-scale", String(next.accCScale));
  };

  const onHue = (role: "key" | "accent", hue: string): void => {
    applyHue(role, hue);
    setSeed((prev) => (role === "key" ? { ...prev, keyHue: hue } : { ...prev, accHue: hue }));
    setCopied(false);
  };

  const onCScale = (role: "key" | "accent", raw: string): void => {
    const value = Number(raw);
    setVar(`--duet-${role}-c-scale`, String(value));
    setSeed((prev) =>
      role === "key" ? { ...prev, keyCScale: value } : { ...prev, accCScale: value },
    );
    setCopied(false);
  };

  const onPreset = (next: Seed): void => {
    applySeed(next);
    setSeed(next);
    setCopied(false);
  };

  // Real selectable list (genuine selection fill + caret when focused).
  const listSource = React.useMemo(() => new DuetListDataSource(LIST_ROWS), []);

  // Real radio + choice groups, wired through the responder form.
  const radioId = useId();
  const choiceId = useId();
  const [radioValue, setRadioValue] = useState("on");
  const [choiceValue, setChoiceValue] = useState("grid");
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [radioId]: setRadioValue,
      [choiceId]: setChoiceValue,
    },
  });

  const angle = (hue: string): string => {
    const a = HUE_FAMILIES[hue];
    return a === undefined ? "" : `${a}°`;
  };

  const readout = [
    `Key:    ${seed.keyHue} (${angle(seed.keyHue)})  chroma x${seed.keyCScale.toFixed(2)}`,
    `Accent: ${seed.accHue} (${angle(seed.accHue)})  chroma x${seed.accCScale.toFixed(2)}`,
  ].join("\n");

  const onCopy = (): void => {
    navigator.clipboard
      ?.writeText(readout)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard unavailable — readout is visible to copy by hand */
      });
  };

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-color-duet"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* ---- Controls ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Seed</TugLabel>
          <div className="gcd-presets">
            {PRESETS.map((preset) => (
              <TugPushButton
                key={preset.name}
                emphasis="outlined"
                role="action"
                size="2xs"
                onClick={() => onPreset(preset.seed)}
              >
                {preset.name}
              </TugPushButton>
            ))}
          </div>
          <div className="gcd-controls" style={{ marginTop: "10px" }}>
            <label className="gcd-control-row">
              <span className="gcd-control-label">Key hue</span>
              <select
                value={seed.keyHue}
                onChange={(e) => onHue("key", e.target.value)}
                data-testid="gcd-key-hue"
                aria-label="Key hue"
              >
                {ADJACENCY_RING.map((hue) => (
                  <option key={hue} value={hue}>
                    {hue} ({angle(hue)})
                  </option>
                ))}
              </select>
              <span className="gcd-control-value">{angle(seed.keyHue)}</span>
            </label>
            <label className="gcd-control-row">
              <span className="gcd-control-label">Key chroma ×</span>
              <input
                type="range"
                min={0}
                max={1.3}
                step={0.02}
                value={seed.keyCScale}
                onChange={(e) => onCScale("key", e.target.value)}
                data-testid="gcd-key-cscale"
                aria-label="Key chroma scale"
              />
              <span className="gcd-control-value">{seed.keyCScale.toFixed(2)}</span>
            </label>
            <label className="gcd-control-row">
              <span className="gcd-control-label">Accent hue</span>
              <select
                value={seed.accHue}
                onChange={(e) => onHue("accent", e.target.value)}
                data-testid="gcd-accent-hue"
                aria-label="Accent hue"
              >
                {ADJACENCY_RING.map((hue) => (
                  <option key={hue} value={hue}>
                    {hue} ({angle(hue)})
                  </option>
                ))}
              </select>
              <span className="gcd-control-value">{angle(seed.accHue)}</span>
            </label>
            <label className="gcd-control-row">
              <span className="gcd-control-label">Accent chroma ×</span>
              <input
                type="range"
                min={0}
                max={1.3}
                step={0.02}
                value={seed.accCScale}
                onChange={(e) => onCScale("accent", e.target.value)}
                data-testid="gcd-accent-cscale"
                aria-label="Accent chroma scale"
              />
              <span className="gcd-control-value">{seed.accCScale.toFixed(2)}</span>
            </label>
          </div>
          <div className="gcd-presets" style={{ marginTop: "10px" }}>
            <TugPushButton emphasis="primary" role="action" size="xs" onClick={onCopy}>
              {copied ? "Copied" : "Copy seed"}
            </TugPushButton>
          </div>
          <div className="gcd-readout" data-testid="gcd-readout" style={{ marginTop: "10px" }}>
            {readout}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Board ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Composites</TugLabel>
          <div className="gallery-color-duet-board" ref={boardRef} data-testid="gcd-board">
            {/* Selection fill + keyboard caret. The static row carries the real
                production caret rule (.tug-list-view-cell[data-key-cursor]::before)
                so the Accent bar is always visible over the Key fill; the live
                list below shows the genuine selection fill on click / Tab. */}
            <div className="gcd-composite">
              <div className="gcd-composite-title">Selected row — Key fill + Accent caret bar</div>
              <div
                className="tug-list-view-cell gcd-caret-row"
                data-key-cursor=""
                data-selected="true"
              >
                Key selection fill, with the Accent keyboard caret on its leading edge
              </div>
              <div className="gcd-list-host">
                <TugListView<DuetListDataSource>
                  dataSource={listSource}
                  cellRenderers={LIST_CELL_RENDERERS}
                  inline
                  scrollKey="gcd-list"
                  focusGroup="gallery-color-duet-list"
                  focusOrder={0}
                  selectionRequired
                />
              </div>
            </div>

            {/* Primary CTA vs danger — red-safety comparison ([P05]). */}
            <div className="gcd-composite">
              <div className="gcd-composite-title">Primary action (Key) vs danger (unchanged red)</div>
              <div className="gcd-row">
                <TugPushButton emphasis="primary" role="action" onClick={() => {}}>
                  Submit
                </TugPushButton>
                <TugPushButton emphasis="primary" role="danger" onClick={() => {}}>
                  Delete
                </TugPushButton>
                <TugPushButton emphasis="outlined" role="accent" onClick={() => {}}>
                  Accent affordance
                </TugPushButton>
              </div>
            </div>

            {/* Selection controls — radio / checkbox / choice "on" follow Key. */}
            <div className="gcd-composite">
              <div className="gcd-composite-title">Selection controls — "on" follows Key</div>
              <div className="gcd-row">
                <TugRadioGroup value={radioValue} senderId={radioId} aria-label="Duet radio">
                  <TugRadioItem value="on">On</TugRadioItem>
                  <TugRadioItem value="off">Off</TugRadioItem>
                </TugRadioGroup>
                <TugCheckbox defaultChecked label="Enabled" />
                <TugChoiceGroup
                  value={choiceValue}
                  senderId={choiceId}
                  aria-label="Duet choice"
                  items={[
                    { value: "grid", label: "Grid" },
                    { value: "list", label: "List" },
                    { value: "table", label: "Table" },
                  ]}
                />
              </div>
            </div>

            {/* Text selection rides the Key plain fill. */}
            <div className="gcd-composite">
              <div className="gcd-composite-title">Text selection + link (Key)</div>
              <p className="gcd-text-sample">
                Select this sentence to see the Key text-selection wash, and note the{" "}
                <a className="gcd-link" href="#" onClick={(e) => e.preventDefault()}>
                  navigational link
                </a>{" "}
                which also follows Key.
              </p>
            </div>

            {/* Drag-drop target — Accent stroke, Key-tinted fill. */}
            <div className="gcd-composite">
              <div className="gcd-composite-title">Drag-drop target (Accent border)</div>
              <div className="gcd-drop-target">Drop files here</div>
            </div>
          </div>
        </div>
      </div>
    </ResponderScope>
  );
}
