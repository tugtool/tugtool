/**
 * gallery-color-duet.tsx -- Key + Accent color-duet workshop.
 *
 * A live tuning board for the per-theme Key (selection / primary action) +
 * Accent (affordance: caret, focus ring, drag-drop, activity) duet, expressed in
 * the TugColor model (color-palette.md). Each role has two Tug controls:
 *
 *   - Hue: a TugPopupButton over the 48 TugColor hues. Choosing one writes that
 *     hue's palette constants — var(--tugc-{hue}-h / -canonical-l / -peak-c) —
 *     into the board's indirection vars (--duet-key-h / -canon-l / -peak-c). The
 *     ramp rungs in gallery-color-duet.css are the TugColor piecewise formula
 *     over those constants, so every rung re-evaluates through the real model.
 *   - Chroma scale: a TugSlider multiplying every rung's chroma
 *     (--duet-key-c-scale), for restraint (e.g. pale Key on bravura/aria).
 *
 * The board-scoped Table-T01 --tug7-* repoints route the real components below
 * through the ramps. All painting is style.setProperty on the board ([L06]);
 * useState holds only the controlled inputs and the copy-out readout ([L24]).
 *
 * Laws:
 *  - [L06] appearance via style.setProperty + CSS, never React-state-driven.
 *  - [L02] the list data source enters React via TugListView's
 *    useSyncExternalStore contract (a trivial constant store here).
 *  - [L11] controls emit actions; the card handles them via useResponderForm.
 *  - [L19] gallery-card authoring; registered in gallery-registrations.tsx.
 */

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ADJACENCY_RING, HUE_FAMILIES } from "@/components/tugways/palette-engine";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import type { TaggedValue } from "@/lib/tugbank-client";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugPopupButton, type TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { TugSlider } from "@/components/tugways/tug-slider";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { getThemeGetter } from "@/action-dispatch";
import { useOptionalThemeContext } from "@/contexts/theme-provider";
import { TUG_ACTIONS } from "../action-vocabulary";
import "./gallery.css";
import "./gallery-color-duet.css";

// ---------------------------------------------------------------------------
// Seed model
// ---------------------------------------------------------------------------

interface Seed {
  keyHue: string;
  keyCScale: number;
  keyLShift: number;
  accHue: string;
  accCScale: number;
  accLShift: number;
  // Chrome treatments — each a TugColor of the Key hue with its own i / t (/ a).
  titlebarI: number;
  titlebarT: number;
  filledI: number;
  filledT: number;
  tintedI: number;
  tintedT: number;
  tintedA: number;
}

/** Compact preset constructor — lightness shift + treatments default to a
 *  brio-like baseline; the treatment knobs are tuned separately. */
const mk = (
  keyHue: string,
  keyCScale: number,
  accHue: string,
  accCScale: number,
): Seed => ({
  keyHue, keyCScale, keyLShift: 0, accHue, accCScale, accLShift: 0,
  titlebarI: 30, titlebarT: 88,
  filledI: 84, filledT: 44,
  tintedI: 75, tintedT: 38, tintedA: 0.4,
});

/** Default seed — today's brio (blue Key / orange Accent), an exact baseline.
 *  Used only as the fallback when a theme has no saved seed yet. */
const SEED_TODAY: Seed = mk("blue", 1, "orange", 1);

// Persistence — scoped to THIS gallery card only (its own tugbank domain, never
// the app-settings keys). Stores a PER-THEME map of working seeds, so each theme
// remembers its own in-progress tuning across revisits and theme switches.
const SEED_DOMAIN = "dev.tugtool.gallery.colorduet";
const SEED_KEY = "seeds";

type SeedMap = Record<string, Partial<Seed>>;

function parseSeedMap(entry: TaggedValue | undefined): SeedMap {
  if (entry && entry.kind === "json" && entry.value && typeof entry.value === "object") {
    return entry.value as SeedMap;
  }
  return {};
}

/** The seed for one theme, with SEED_TODAY filling any missing fields. */
function readSeedFor(map: SeedMap, theme: string): Seed {
  return { ...SEED_TODAY, ...(map[theme] ?? {}) };
}

function putSeedMap(map: SeedMap): void {
  fetch(`/api/defaults/${SEED_DOMAIN}/${SEED_KEY}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: map }),
  }).catch(() => {
    /* fire-and-forget — tuning is dev-only convenience state */
  });
}

const angle = (hue: string): string => {
  const a = HUE_FAMILIES[hue];
  return a === undefined ? "" : `${a}°`;
};

/** Hue menu items (TugColor hues in ascending-angle order), shared by both pickers. */
const HUE_ITEMS: TugPopupButtonItem<string>[] = ADJACENCY_RING.map((hue) => ({
  action: TUG_ACTIONS.SET_VALUE,
  value: hue,
  label: `${hue} (${angle(hue)})`,
}));

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

  // Per-theme persistence (this card's own tugbank domain). The seed map is
  // keyed by theme name; the active theme selects which seed the card edits.
  const seedMap = useTugbankValue<SeedMap>(SEED_DOMAIN, SEED_KEY, parseSeedMap, {});
  const activeTheme = useOptionalThemeContext()?.theme ?? getThemeGetter()?.() ?? "brio";

  // Local-data only: the controlled control values + copy-out readout. The paint
  // is the setProperty calls below, never a React-state-driven style ([L06]).
  const [seed, setSeed] = useState<Seed>(() => readSeedFor(seedMap, activeTheme));
  const [copied, setCopied] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const setVar = (name: string, value: string): void => {
    boardRef.current?.style.setProperty(name, value);
  };

  const applyHue = (role: "key" | "accent", hue: string): void => {
    setVar(`--duet-${role}-h`, `var(--tugc-${hue}-h)`);
    setVar(`--duet-${role}-canon-l`, `var(--tugc-${hue}-canonical-l)`);
    setVar(`--duet-${role}-peak-c`, `var(--tugc-${hue}-peak-c)`);
  };

  const applyTreatments = (next: Seed): void => {
    setVar("--duet-titlebar-i", String(next.titlebarI));
    setVar("--duet-titlebar-t", String(next.titlebarT));
    setVar("--duet-filled-i", String(next.filledI));
    setVar("--duet-filled-t", String(next.filledT));
    setVar("--duet-tinted-i", String(next.tintedI));
    setVar("--duet-tinted-t", String(next.tintedT));
    setVar("--duet-tinted-a", String(next.tintedA));
  };

  const applySeed = (next: Seed): void => {
    applyHue("key", next.keyHue);
    applyHue("accent", next.accHue);
    setVar("--duet-key-c-scale", String(next.keyCScale));
    setVar("--duet-accent-c-scale", String(next.accCScale));
    setVar("--duet-key-l-shift", String(next.keyLShift));
    setVar("--duet-accent-l-shift", String(next.accLShift));
    applyTreatments(next);
  };

  const onHue = (role: "key" | "accent", hue: string): void => {
    applyHue(role, hue);
    setSeed((prev) => (role === "key" ? { ...prev, keyHue: hue } : { ...prev, accHue: hue }));
    setCopied(false);
  };

  const onCScale = (role: "key" | "accent", value: number): void => {
    setVar(`--duet-${role}-c-scale`, String(value));
    setSeed((prev) =>
      role === "key" ? { ...prev, keyCScale: value } : { ...prev, accCScale: value },
    );
    setCopied(false);
  };

  const onLShift = (role: "key" | "accent", value: number): void => {
    setVar(`--duet-${role}-l-shift`, String(value));
    setSeed((prev) =>
      role === "key" ? { ...prev, keyLShift: value } : { ...prev, accLShift: value },
    );
    setCopied(false);
  };

  const onTreatment = (
    field:
      | "titlebarI" | "titlebarT"
      | "filledI" | "filledT"
      | "tintedI" | "tintedT" | "tintedA",
    cssVar: string,
    value: number,
  ): void => {
    setVar(cssVar, String(value));
    setSeed((prev) => ({ ...prev, [field]: value }));
    setCopied(false);
  };

  // Real selectable list (genuine selection fill + caret when focused).
  const listSource = useMemo(() => new DuetListDataSource(LIST_ROWS), []);

  // Paint the board from the restored seed once at mount; later paints flow
  // through the handlers ([L06]).
  useLayoutEffect(() => {
    applySeed(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On a theme switch, load that theme's saved seed and repaint. Guarded so the
  // card's own writes (which also update seedMap) don't clobber in-flight edits.
  const loadedThemeRef = useRef(activeTheme);
  useEffect(() => {
    if (loadedThemeRef.current === activeTheme) return;
    loadedThemeRef.current = activeTheme;
    const next = readSeedFor(seedMap, activeTheme);
    setSeed(next);
    applySeed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTheme, seedMap]);

  // Persist edits under the ACTIVE theme (skip when unchanged — covers the
  // initial restore and the theme-switch load, avoiding redundant writes/loops).
  useEffect(() => {
    if (JSON.stringify(readSeedFor(seedMap, activeTheme)) === JSON.stringify(seed)) return;
    putSeedMap({ ...seedMap, [activeTheme]: seed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, seedMap, activeTheme]);

  // Control sender ids — Tug controls dispatch actions the card handles ([L11]).
  const keyHueId = useId();
  const keyCId = useId();
  const keyLId = useId();
  const accHueId = useId();
  const accCId = useId();
  const accLId = useId();
  const tbIId = useId();
  const tbTId = useId();
  const fIId = useId();
  const fTId = useId();
  const tiIId = useId();
  const tiTId = useId();
  const tiAId = useId();
  const radioId = useId();
  const choiceId = useId();
  const [radioValue, setRadioValue] = useState("on");
  const [choiceValue, setChoiceValue] = useState("grid");

  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [keyHueId]: (v) => onHue("key", v),
      [accHueId]: (v) => onHue("accent", v),
    },
    setValueNumber: {
      [keyCId]: (v) => onCScale("key", v),
      [accCId]: (v) => onCScale("accent", v),
      [keyLId]: (v) => onLShift("key", v),
      [accLId]: (v) => onLShift("accent", v),
      [tbIId]: (v) => onTreatment("titlebarI", "--duet-titlebar-i", v),
      [tbTId]: (v) => onTreatment("titlebarT", "--duet-titlebar-t", v),
      [fIId]: (v) => onTreatment("filledI", "--duet-filled-i", v),
      [fTId]: (v) => onTreatment("filledT", "--duet-filled-t", v),
      [tiIId]: (v) => onTreatment("tintedI", "--duet-tinted-i", v),
      [tiTId]: (v) => onTreatment("tintedT", "--duet-tinted-t", v),
      [tiAId]: (v) => onTreatment("tintedA", "--duet-tinted-a", v),
    },
    selectValue: {
      [radioId]: setRadioValue,
      [choiceId]: setChoiceValue,
    },
  });

  const fmtShift = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
  const readout = [
    `Key:    ${seed.keyHue} (${angle(seed.keyHue)})  chroma x${seed.keyCScale.toFixed(2)}  lightness ${fmtShift(seed.keyLShift)}`,
    `Accent: ${seed.accHue} (${angle(seed.accHue)})  chroma x${seed.accCScale.toFixed(2)}  lightness ${fmtShift(seed.accLShift)}`,
    `Title bar: i${seed.titlebarI} t${seed.titlebarT}   Filled: i${seed.filledI} t${seed.filledT}   Tinted: i${seed.tintedI} t${seed.tintedT} a${seed.tintedA.toFixed(2)}`,
  ].join("\n");

  // Apply writes the current duet into the ACTIVE theme's CSS via the dev-server
  // endpoint (which re-derives from the clean baseline, so re-applying never
  // compounds). The theme hot-reload then repaints the whole app.
  const onApply = (): void => {
    const theme = getThemeGetter()?.();
    if (!theme) {
      setApplyMsg("No active theme");
      return;
    }
    setApplying(true);
    setApplyMsg(null);
    fetch("/__duet/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme,
        keyHue: seed.keyHue,
        keyScale: seed.keyCScale,
        keyToneShift: seed.keyLShift,
        accentHue: seed.accHue,
        accentScale: seed.accCScale,
        accentToneShift: seed.accLShift,
        titlebar: { i: seed.titlebarI, t: seed.titlebarT },
        filled: { i: seed.filledI, t: seed.filledT },
        tinted: { i: seed.tintedI, t: seed.tintedT, a: seed.tintedA },
      }),
    })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        setApplyMsg(`Applied to ${theme}`);
      })
      .catch((err: unknown) => {
        setApplyMsg(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setApplying(false));
  };

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

          <div className="gcd-controls">
            <div className="gcd-control-row">
              <span className="gcd-control-label">Key hue</span>
              <TugPopupButton
                label={`${seed.keyHue} (${angle(seed.keyHue)})`}
                senderId={keyHueId}
                size="sm"
                items={HUE_ITEMS}
              />
            </div>
            <TugSlider
              label="Key chroma ×"
              senderId={keyCId}
              value={seed.keyCScale}
              min={0}
              max={1.3}
              step={0.02}
              size="sm"
              valueWidth="3.25rem"
            />
            <TugSlider
              label="Key lightness ±"
              senderId={keyLId}
              value={seed.keyLShift}
              min={-30}
              max={30}
              step={1}
              size="sm"
            />
            <div className="gcd-control-row">
              <span className="gcd-control-label">Accent hue</span>
              <TugPopupButton
                label={`${seed.accHue} (${angle(seed.accHue)})`}
                senderId={accHueId}
                size="sm"
                items={HUE_ITEMS}
              />
            </div>
            <TugSlider
              label="Accent chroma ×"
              senderId={accCId}
              value={seed.accCScale}
              min={0}
              max={1.3}
              step={0.02}
              size="sm"
              valueWidth="3.25rem"
            />
            <TugSlider
              label="Accent lightness ±"
              senderId={accLId}
              value={seed.accLShift}
              min={-30}
              max={30}
              step={1}
              size="sm"
            />

            <div className="gcd-control-label" style={{ marginTop: "6px" }}>
              Treatments (off the Key hue)
            </div>
            <TugSlider label="Title bar i" senderId={tbIId} value={seed.titlebarI} min={0} max={100} step={1} size="sm" />
            <TugSlider label="Title bar t" senderId={tbTId} value={seed.titlebarT} min={0} max={100} step={1} size="sm" />
            <TugSlider label="Filled i" senderId={fIId} value={seed.filledI} min={0} max={100} step={1} size="sm" />
            <TugSlider label="Filled t" senderId={fTId} value={seed.filledT} min={0} max={100} step={1} size="sm" />
            <TugSlider label="Tinted i" senderId={tiIId} value={seed.tintedI} min={0} max={100} step={1} size="sm" />
            <TugSlider label="Tinted t" senderId={tiTId} value={seed.tintedT} min={0} max={100} step={1} size="sm" />
            <TugSlider label="Tinted α" senderId={tiAId} value={seed.tintedA} min={0} max={1} step={0.02} size="sm" valueWidth="3.25rem" />
          </div>

          <div className="gcd-actions" style={{ marginTop: "10px" }}>
            <TugPushButton
              emphasis="primary"
              role="action"
              size="xs"
              disabled={applying}
              onClick={onApply}
            >
              {applying ? "Applying…" : "Apply to active theme"}
            </TugPushButton>
            <TugPushButton emphasis="outlined" role="action" size="xs" onClick={onCopy}>
              {copied ? "Copied" : "Copy seed"}
            </TugPushButton>
            {applyMsg && (
              <TugLabel size="2xs" emphasis="calm">{applyMsg}</TugLabel>
            )}
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
            {/* Title bar / active tab — previews the titlebar treatment. */}
            <div className="gcd-composite">
              <div className="gcd-composite-title">Title bar / active tab (titlebar treatment)</div>
              <div className="gcd-titlebar">Dev — focused title bar</div>
            </div>

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

            {/* Z4B treatments — filled button + tinted badge — vs danger (red). */}
            <div className="gcd-composite">
              <div className="gcd-composite-title">Filled button · tinted button + tinted badge (should match) · danger</div>
              <div className="gcd-row">
                <TugPushButton emphasis="filled" role="action" onClick={() => {}}>
                  Submit
                </TugPushButton>
                <TugPushButton emphasis="tinted" role="action" onClick={() => {}}>
                  Mode
                </TugPushButton>
                <TugBadge emphasis="tinted" role="action" size="lg" layout="label-top" label="Model">
                  Opus 4.8
                </TugBadge>
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
