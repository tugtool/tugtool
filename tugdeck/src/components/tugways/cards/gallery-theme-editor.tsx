/**
 * gallery-theme-editor.tsx -- the Theme Editor: Key + Accent color workshop.
 *
 * A live tuning board for the per-theme Key (selection / primary action) +
 * Accent (affordance: caret, focus ring, drag-drop, activity) duet, expressed in
 * the TugColor model (color-palette.md). Each role has two Tug controls:
 *
 *   - Hue: a TugPopupButton over the 48 TugColor hues. Choosing one writes that
 *     hue's palette constants — var(--tugc-{hue}-h / -canonical-l / -peak-c) —
 *     into the board's indirection vars (--duet-key-h / -canon-l / -peak-c). The
 *     ramp rungs in gallery-theme-editor.css are the TugColor piecewise formula
 *     over those constants, so every rung re-evaluates through the real model.
 *   - Chroma scale: a TugSlider multiplying every rung's chroma
 *     (--duet-key-c-scale), for restraint (e.g. pale Key on bravura/aria).
 *
 * The board-scoped Table-T01 --tug7-* repoints route the real components below
 * through the ramps. All painting is style.setProperty on the board ([L06]);
 * useState holds only the controlled inputs and the copy-out readout ([L24]).
 *
 * The control column is authored into a single focus group ([P02]) so Tab walks
 * the hue pickers and sliders as one loop; the key view seeds onto the Key hue
 * ([useSeedKeyView]).
 *
 * Title-bar treatment is a LIGHT-theme-only axis (`--tugx-chrome-key-surface`
 * exists only in light themes); for dark themes the editor hides those knobs and
 * shows the theme's actual, fixed title-bar surface instead.
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
import { useFocusManager } from "@/components/tugways/use-focusable";
import { CardIdContext } from "@/lib/card-id-context";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { getThemeGetter } from "@/action-dispatch";
import { useOptionalThemeContext } from "@/contexts/theme-provider";
import { TUG_ACTIONS } from "../action-vocabulary";
import "./gallery.css";
import "./gallery-theme-editor.css";

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

/** Dark themes — they do NOT participate in the Key-hued title-bar treatment
 *  (the `--tugx-chrome-key-surface` token is a light-theme-only axis). */
const DARK_THEMES = new Set(["brio", "nocturne", "bravura"]);

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
  // Text selection wash (also drives the editing caret) — its own i / t / α.
  textselI: number;
  textselT: number;
  textselA: number;
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
  textselI: 50, textselT: 50, textselA: 0.4,
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

/** Uniform value-column width so every slider's value box aligns on its right edge. */
const SLIDER_VALUE_WIDTH = "3.5rem";

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
// GalleryThemeEditor
// ---------------------------------------------------------------------------

export function GalleryThemeEditor(): React.ReactElement {
  const boardRef = useRef<HTMLDivElement>(null);
  const titlebarRef = useRef<HTMLDivElement>(null);
  const focusManager = useFocusManager();
  const cardId = React.useContext(CardIdContext);

  // Per-theme persistence (this card's own tugbank domain). The seed map is
  // keyed by theme name; the active theme selects which seed the card edits.
  const seedMap = useTugbankValue<SeedMap>(SEED_DOMAIN, SEED_KEY, parseSeedMap, {});
  const activeTheme = useOptionalThemeContext()?.theme ?? getThemeGetter()?.() ?? "brio";
  const isDark = DARK_THEMES.has(activeTheme);

  // Local-data only: the controlled control values + readout. The paint is the
  // setProperty calls below, never a React-state-driven style ([L06]).
  const [seed, setSeed] = useState<Seed>(() => readSeedFor(seedMap, activeTheme));
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  // The active dark theme's real (fixed) title-bar colors, read off the live DOM.
  const [titlebarFixed, setTitlebarFixed] = useState<{ bg: string; fg: string } | null>(null);

  const setVar = (name: string, value: string): void => {
    boardRef.current?.style.setProperty(name, value);
  };
  const clearVar = (name: string): void => {
    boardRef.current?.style.removeProperty(name);
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
    setVar("--duet-textsel-i", String(next.textselI));
    setVar("--duet-textsel-t", String(next.textselT));
    setVar("--duet-textsel-a", String(next.textselA));
  };

  // Dark themes don't carry a Key-hued title-bar: pin the preview's title-bar var
  // to the theme's real (fixed) titlebar-active surface, so the editor shows what
  // the app actually paints rather than the unused Key formula. Light themes drop
  // the override and fall back to the computed `--duet-titlebar`.
  const applyTitlebarMode = (dark: boolean): void => {
    if (dark) {
      setVar("--duet-titlebar", "var(--tug7-surface-card-primary-normal-titlebar-active)");
    } else {
      clearVar("--duet-titlebar");
    }
  };

  const applySeed = (next: Seed): void => {
    applyHue("key", next.keyHue);
    applyHue("accent", next.accHue);
    setVar("--duet-key-c-scale", String(next.keyCScale));
    setVar("--duet-accent-c-scale", String(next.accCScale));
    setVar("--duet-key-l-shift", String(next.keyLShift));
    setVar("--duet-accent-l-shift", String(next.accLShift));
    applyTreatments(next);
    applyTitlebarMode(DARK_THEMES.has(activeTheme));
  };

  const onHue = (role: "key" | "accent", hue: string): void => {
    applyHue(role, hue);
    setSeed((prev) => (role === "key" ? { ...prev, keyHue: hue } : { ...prev, accHue: hue }));
  };

  const onCScale = (role: "key" | "accent", value: number): void => {
    setVar(`--duet-${role}-c-scale`, String(value));
    setSeed((prev) =>
      role === "key" ? { ...prev, keyCScale: value } : { ...prev, accCScale: value },
    );
  };

  const onLShift = (role: "key" | "accent", value: number): void => {
    setVar(`--duet-${role}-l-shift`, String(value));
    setSeed((prev) =>
      role === "key" ? { ...prev, keyLShift: value } : { ...prev, accLShift: value },
    );
  };

  const onTreatment = (
    field:
      | "titlebarI" | "titlebarT"
      | "filledI" | "filledT"
      | "tintedI" | "tintedT" | "tintedA"
      | "textselI" | "textselT" | "textselA",
    cssVar: string,
    value: number,
  ): void => {
    setVar(cssVar, String(value));
    setSeed((prev) => ({ ...prev, [field]: value }));
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

  // Read the dark theme's real title-bar colors off the live DOM for the
  // read-only "fixed" display. Re-run on theme switch (a different fixed value)
  // and after paint so the override above has landed.
  useEffect(() => {
    if (!isDark) {
      setTitlebarFixed(null);
      return;
    }
    const el = titlebarRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    setTitlebarFixed({ bg: cs.backgroundColor, fg: cs.color });
  }, [isDark, activeTheme]);

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
  const tsIId = useId();
  const tsTId = useId();
  const tsAId = useId();
  const radioId = useId();
  const choiceId = useId();
  const [radioValue, setRadioValue] = useState("on");
  const [choiceValue, setChoiceValue] = useState("grid");

  // One focus group for the whole control column; the key view seeds onto the
  // Key hue (order 0) so the editor opens with focus on it and Tab walks the
  // controls ([P02]). Title-bar slider orders (6,7) are simply absent for dark
  // themes — gaps in the order are fine.
  const controlsFocusGroup = useId();

  // Put keyboard focus on the Key hue when the editor opens, and keep it. The
  // engine only moves DOM focus + lights the ring while THIS card's context is
  // the active (key-card) one; a non-modal gallery card isn't guaranteed active
  // at mount, so we arm the keyboard restore the moment it becomes active and
  // re-check on focus-manager changes until it lands (once).
  const seededFocusRef = useRef(false);
  useLayoutEffect(() => {
    if (!focusManager) return;
    const focusKey = `${controlsFocusGroup}:0`;
    const arm = (): void => {
      if (seededFocusRef.current) return;
      const active = cardId === null || focusManager.keyCard() === cardId;
      if (!active) return;
      seededFocusRef.current = true;
      focusManager.contextFor(cardId).armKeyboardRestore(focusKey);
    };
    arm();
    return focusManager.subscribe(arm);
  }, [focusManager, cardId, controlsFocusGroup]);

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
      [tsIId]: (v) => onTreatment("textselI", "--duet-textsel-i", v),
      [tsTId]: (v) => onTreatment("textselT", "--duet-textsel-t", v),
      [tsAId]: (v) => onTreatment("textselA", "--duet-textsel-a", v),
    },
    selectValue: {
      [radioId]: setRadioValue,
      [choiceId]: setChoiceValue,
    },
  });

  const fmtShift = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
  const titlebarLine = isDark
    ? "Title bar: theme-fixed (dark)"
    : `Title bar: i${seed.titlebarI} t${seed.titlebarT}`;
  const readout = [
    `Key:    ${seed.keyHue} (${angle(seed.keyHue)})  chroma x${seed.keyCScale.toFixed(2)}  lightness ${fmtShift(seed.keyLShift)}`,
    `Accent: ${seed.accHue} (${angle(seed.accHue)})  chroma x${seed.accCScale.toFixed(2)}  lightness ${fmtShift(seed.accLShift)}`,
    `${titlebarLine}   Filled: i${seed.filledI} t${seed.filledT}   Tinted: i${seed.tintedI} t${seed.tintedT} a${seed.tintedA.toFixed(2)}`,
    `Text sel: i${seed.textselI} t${seed.textselT} a${seed.textselA.toFixed(2)}`,
  ].join("\n");

  // Apply writes the current duet into the ACTIVE theme's CSS via the dev-server
  // endpoint (which re-derives from the clean baseline, so re-applying never
  // compounds). The theme hot-reload then repaints the whole app. The titlebar
  // treatment is sent only for light themes (dark themes don't carry the token).
  const onApply = (): void => {
    const theme = getThemeGetter()?.();
    if (!theme) {
      setApplyMsg("No active theme");
      return;
    }
    setApplying(true);
    setApplyMsg(null);
    fetch("/__theme-editor/apply", {
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
        ...(DARK_THEMES.has(theme)
          ? {}
          : { titlebar: { i: seed.titlebarI, t: seed.titlebarT } }),
        filled: { i: seed.filledI, t: seed.filledT },
        tinted: { i: seed.tintedI, t: seed.tintedT, a: seed.tintedA },
        textsel: { i: seed.textselI, t: seed.textselT, a: seed.textselA },
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

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-theme-editor"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* ---- Controls ---- */}
        <div className="cg-section">
          <div className="gcd-controls">
            <div className="gcd-control-row">
              <span className="gcd-control-label">Key hue</span>
              <TugPopupButton
                label={`${seed.keyHue} (${angle(seed.keyHue)})`}
                senderId={keyHueId}
                size="sm"
                items={HUE_ITEMS}
                focusGroup={controlsFocusGroup}
                focusOrder={0}
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
              valueWidth={SLIDER_VALUE_WIDTH}
              focusGroup={controlsFocusGroup}
              focusOrder={1}
            />
            <TugSlider
              label="Key lightness ±"
              senderId={keyLId}
              value={seed.keyLShift}
              min={-30}
              max={30}
              step={1}
              size="sm"
              valueWidth={SLIDER_VALUE_WIDTH}
              focusGroup={controlsFocusGroup}
              focusOrder={2}
            />
            <div className="gcd-control-row">
              <span className="gcd-control-label">Accent hue</span>
              <TugPopupButton
                label={`${seed.accHue} (${angle(seed.accHue)})`}
                senderId={accHueId}
                size="sm"
                items={HUE_ITEMS}
                focusGroup={controlsFocusGroup}
                focusOrder={3}
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
              valueWidth={SLIDER_VALUE_WIDTH}
              focusGroup={controlsFocusGroup}
              focusOrder={4}
            />
            <TugSlider
              label="Accent lightness ±"
              senderId={accLId}
              value={seed.accLShift}
              min={-30}
              max={30}
              step={1}
              size="sm"
              valueWidth={SLIDER_VALUE_WIDTH}
              focusGroup={controlsFocusGroup}
              focusOrder={5}
            />

            <div className="gcd-group-label">Treatments (off the Key hue)</div>
            {isDark ? (
              <div className="gcd-titlebar-fixed-note">
                Title bar: dark themes use a fixed title-bar treatment (not the Key
                hue) — shown below, not tunable here.
                {titlebarFixed && (
                  <span className="gcd-titlebar-fixed-swatch">
                    <span
                      className="gcd-titlebar-fixed-chip"
                      style={{ background: titlebarFixed.bg, color: titlebarFixed.fg }}
                    >
                      Aa
                    </span>
                    <span className="gcd-titlebar-fixed-value">{titlebarFixed.bg}</span>
                  </span>
                )}
              </div>
            ) : (
              <>
                <TugSlider label="Title bar i" senderId={tbIId} value={seed.titlebarI} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={6} />
                <TugSlider label="Title bar t" senderId={tbTId} value={seed.titlebarT} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={7} />
              </>
            )}
            <TugSlider label="Filled i" senderId={fIId} value={seed.filledI} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={8} />
            <TugSlider label="Filled t" senderId={fTId} value={seed.filledT} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={9} />
            <TugSlider label="Tinted i" senderId={tiIId} value={seed.tintedI} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={10} />
            <TugSlider label="Tinted t" senderId={tiTId} value={seed.tintedT} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={11} />
            <TugSlider label="Tinted α" senderId={tiAId} value={seed.tintedA} min={0} max={1} step={0.02} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={12} />

            <div className="gcd-group-label">Text selection / caret (off the Key hue)</div>
            <TugSlider label="Text sel i" senderId={tsIId} value={seed.textselI} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={13} />
            <TugSlider label="Text sel t" senderId={tsTId} value={seed.textselT} min={0} max={100} step={1} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={14} />
            <TugSlider label="Text sel α" senderId={tsAId} value={seed.textselA} min={0} max={1} step={0.02} size="sm" valueWidth={SLIDER_VALUE_WIDTH} focusGroup={controlsFocusGroup} focusOrder={15} />
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
          <div className="gallery-theme-editor-board" ref={boardRef} data-testid="gcd-board">
            {/* Title bar / active tab — previews the titlebar treatment (light
                themes) or the theme's real fixed title bar (dark themes). */}
            <div className="gcd-composite">
              <div className="gcd-composite-title">
                {isDark
                  ? "Title bar / active tab (theme-fixed for dark themes)"
                  : "Title bar / active tab (titlebar treatment)"}
              </div>
              {/* The title bar sits against the CANVAS (the desktop behind cards),
                  not the card body — so its frame paints the host canvas color. */}
              <div className="gcd-titlebar-frame">
                <div className="gcd-titlebar" ref={titlebarRef}>Dev — focused title bar</div>
              </div>
            </div>

            {/* Selection fill + keyboard caret. The static row carries the real
                production selected-row fill (selected-rest) plus the caret rule
                (.tug-list-view-cell[data-key-cursor]::before) so the Accent bar
                is always visible over the Key fill; the live list below shows the
                genuine selection fill on click / Tab. */}
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
                  // Share the control column's focus group so the list is part of
                  // the same Tab loop, ordered AFTER the last slider (15) — last.
                  focusGroup={controlsFocusGroup}
                  focusOrder={16}
                  selectionRequired
                />
              </div>
            </div>

            {/* Z4B treatments — filled button + tinted badge — vs danger (real
                solid-red filled danger, matching the app's destructive buttons). */}
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
                <TugPushButton emphasis="filled" role="danger" onClick={() => {}}>
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

            {/* Text selection rides the Key plain fill (the text-selection knobs). */}
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
