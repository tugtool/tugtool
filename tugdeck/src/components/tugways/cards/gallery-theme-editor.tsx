/**
 * gallery-theme-editor.tsx -- the Theme Editor: Key + Accent color workshop.
 *
 * A live tuning board for the per-theme Key (selection / primary action) +
 * Accent (affordance: caret, focus ring, drag-drop, activity) duet, expressed in
 * the TugColor model (color-palette.md). The control surface is color-native:
 *
 *   - Each AXIS (Key, Accent) is a TugColorAdjustment: its base TugColorWell picks
 *     the hue (writing var(--tugc-{hue}-h / -canonical-l / -peak-c) into the board
 *     indirection vars --duet-key-h / -canon-l / -peak-c), and its i/t delta
 *     steppers add to every rung (--duet-key-i-delta intensity, --duet-key-l-shift
 *     tone). The ramp rungs in gallery-theme-editor.css are the TugColor piecewise
 *     formula over those vars, so every rung re-evaluates through the real model.
 *   - Each TREATMENT (title bar, filled, tinted, text selection) is a
 *     TugColorWell — a TugColor of the Key hue with its own i/t/a. The shared
 *     standalone TugColorPicker edits whichever well is active (active-color-
 *     target.ts); the well's hue is locked to the Key hue.
 *
 * The board-scoped Table-T01 --tug7-* repoints route the real components below
 * through the ramps. All painting is style.setProperty on the board ([L06]);
 * useState holds only the controlled values and the copy-out readout ([L24]).
 *
 * Apply posts the additive-delta seed (keyHue + key{iDelta,tDelta,aDelta}, …) to
 * the dev-server endpoint, which folds in hand edits and re-derives the theme CSS.
 *
 * Title-bar treatment is a LIGHT-theme-only axis (`--tugx-chrome-key-surface`
 * exists only in light themes); for dark themes the editor hides that well and
 * shows the theme's actual, fixed title-bar surface instead.
 *
 * Laws:
 *  - [L06] appearance via style.setProperty + CSS, never React-state-driven.
 *  - [L02] the list data source enters React via TugListView's
 *    useSyncExternalStore contract (a trivial constant store here).
 *  - [L11] controls emit actions; the card handles them via useResponder.
 *  - [L19] gallery-card authoring; registered in gallery-registrations.tsx.
 */

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { HUE_FAMILIES } from "@/components/tugways/palette-engine";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import type { TaggedValue } from "@/lib/tugbank-client";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { TugColorWell } from "@/components/tugways/tug-color-well";
import { TugColorAdjustment, colorAdjustSenders } from "@/components/tugways/tug-color-adjustment";
import { setActiveColorTarget, updateActiveColorValue } from "@/components/tugways/active-color-target";
import type { TugColorSpec } from "@/components/tugways/tug-color-spec";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
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

/** Additive i/t/a deltas applied to every rung of an axis (tug-color units). */
interface Adjust {
  iDelta: number;
  tDelta: number;
  aDelta: number;
}

/** A treatment / anchor color expressed as TugColor intensity / tone / alpha
 *  (alpha 0–100; the hue is always the Key hue). */
interface Treat {
  i: number;
  t: number;
  a: number;
}

interface Seed {
  keyHue: string;
  /** Preview anchor the Key adjustment is shown against (not sent on Apply). */
  keyBase: Treat;
  key: Adjust;
  accHue: string;
  accBase: Treat;
  accent: Adjust;
  // Chrome treatments — each a TugColor of the Key hue with its own i / t / a.
  titlebar: Treat;
  filled: Treat;
  tinted: Treat;
  textsel: Treat;
}

const ZERO: Adjust = { iDelta: 0, tDelta: 0, aDelta: 0 };
const ANCHOR: Treat = { i: 50, t: 50, a: 100 };

/** Default seed — today's brio (blue Key / orange Accent), an exact baseline.
 *  Used only as the fallback when a theme has no saved seed yet. */
const SEED_TODAY: Seed = {
  keyHue: "blue", keyBase: { ...ANCHOR }, key: { ...ZERO },
  accHue: "orange", accBase: { ...ANCHOR }, accent: { ...ZERO },
  titlebar: { i: 30, t: 88, a: 100 },
  filled: { i: 84, t: 44, a: 100 },
  tinted: { i: 75, t: 38, a: 40 },
  textsel: { i: 50, t: 50, a: 40 },
};

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

/** The seed for one theme, deep-merged onto SEED_TODAY (old flat seeds fall back
 *  cleanly to the baseline since their fields no longer match). */
function readSeedFor(map: SeedMap, theme: string): Seed {
  const s = map[theme] ?? {};
  return {
    keyHue: s.keyHue ?? SEED_TODAY.keyHue,
    keyBase: { ...SEED_TODAY.keyBase, ...(s.keyBase ?? {}) },
    key: { ...SEED_TODAY.key, ...(s.key ?? {}) },
    accHue: s.accHue ?? SEED_TODAY.accHue,
    accBase: { ...SEED_TODAY.accBase, ...(s.accBase ?? {}) },
    accent: { ...SEED_TODAY.accent, ...(s.accent ?? {}) },
    titlebar: { ...SEED_TODAY.titlebar, ...(s.titlebar ?? {}) },
    filled: { ...SEED_TODAY.filled, ...(s.filled ?? {}) },
    tinted: { ...SEED_TODAY.tinted, ...(s.tinted ?? {}) },
    textsel: { ...SEED_TODAY.textsel, ...(s.textsel ?? {}) },
  };
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
  const responderId = useId();

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

  // Treatment preview vars: i / t are 0–100; the alpha vars want the oklch 0–1
  // convention, so scale the spec's 0–100 alpha down.
  const applyTreatments = (next: Seed): void => {
    setVar("--duet-titlebar-i", String(next.titlebar.i));
    setVar("--duet-titlebar-t", String(next.titlebar.t));
    setVar("--duet-filled-i", String(next.filled.i));
    setVar("--duet-filled-t", String(next.filled.t));
    setVar("--duet-tinted-i", String(next.tinted.i));
    setVar("--duet-tinted-t", String(next.tinted.t));
    setVar("--duet-tinted-a", String(next.tinted.a / 100));
    setVar("--duet-textsel-i", String(next.textsel.i));
    setVar("--duet-textsel-t", String(next.textsel.t));
    setVar("--duet-textsel-a", String(next.textsel.a / 100));
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

  // Push an axis's i/t deltas into the ramp formula: --duet-{role}-i-delta adds to
  // every rung's intensity; --duet-{role}-l-shift adds to every rung's tone. (The
  // axis alpha delta has no ramp var — the Key/Accent rungs are opaque in preview.)
  const applyAdjust = (role: "key" | "accent", adj: Adjust): void => {
    setVar(`--duet-${role}-i-delta`, String(adj.iDelta));
    setVar(`--duet-${role}-l-shift`, String(adj.tDelta));
  };

  const applySeed = (next: Seed): void => {
    applyHue("key", next.keyHue);
    applyHue("accent", next.accHue);
    applyAdjust("key", next.key);
    applyAdjust("accent", next.accent);
    applyTreatments(next);
    applyTitlebarMode(DARK_THEMES.has(activeTheme));
  };

  // ---- Color-well / adjustment handlers ----

  const onHue = (role: "key" | "accent", hue: string): void => {
    applyHue(role, hue);
    setSeed((prev) => (role === "key" ? { ...prev, keyHue: hue } : { ...prev, accHue: hue }));
  };

  // The Key/Accent base well picks the hue AND the preview anchor (i/t/a) the
  // adjustment is shown against; only the hue is sent on Apply.
  const onAxisBase = (role: "key" | "accent", spec: TugColorSpec): void => {
    applyHue(role, spec.hue);
    const base: Treat = { i: spec.i, t: spec.t, a: spec.a };
    setSeed((prev) =>
      role === "key"
        ? { ...prev, keyHue: spec.hue, keyBase: base }
        : { ...prev, accHue: spec.hue, accBase: base },
    );
  };

  const onAxisDelta = (role: "key" | "accent", axis: "i" | "t" | "a", v: number): void => {
    if (axis === "i") setVar(`--duet-${role}-i-delta`, String(v));
    else if (axis === "t") setVar(`--duet-${role}-l-shift`, String(v));
    setSeed((prev) => {
      const cur = role === "key" ? prev.key : prev.accent;
      const adj: Adjust = {
        iDelta: axis === "i" ? v : cur.iDelta,
        tDelta: axis === "t" ? v : cur.tDelta,
        aDelta: axis === "a" ? v : cur.aDelta,
      };
      return role === "key" ? { ...prev, key: adj } : { ...prev, accent: adj };
    });
  };

  // A treatment well is a TugColor of the KEY hue with its own i/t/a — so a hue
  // change in the picker is ignored (re-pinned to the Key hue). Filled and title
  // bar carry no alpha.
  const onTreatment = (
    field: "titlebar" | "filled" | "tinted" | "textsel",
    spec: TugColorSpec,
    hasAlpha: boolean,
  ): void => {
    const treat: Treat = { i: spec.i, t: spec.t, a: hasAlpha ? spec.a : 100 };
    setVar(`--duet-${field}-i`, String(treat.i));
    setVar(`--duet-${field}-t`, String(treat.t));
    if (hasAlpha) setVar(`--duet-${field}-a`, String(treat.a / 100));
    setSeed((prev) => ({ ...prev, [field]: treat }));
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

  // The dark theme's real (fixed) title-bar color shown as text in the note. The
  // swatch chip itself paints the token live in CSS (no JS, no lag); this read is
  // only for the oklch readout. In dev the theme context updates BEFORE HMR swaps
  // the active-theme stylesheet, so a one-shot read on `activeTheme` would capture
  // the PREVIOUS theme — re-read whenever the document's stylesheets change so the
  // value reflects the applied theme.
  useEffect(() => {
    if (!isDark) {
      setTitlebarFixed(null);
      return;
    }
    const probe = (): void => {
      const cs = getComputedStyle(document.body);
      const bg = cs.getPropertyValue("--tug7-surface-card-primary-normal-titlebar-active").trim();
      const fg = cs.getPropertyValue("--tug7-element-card-text-normal-title-active").trim();
      if (bg) setTitlebarFixed({ bg, fg });
    };
    probe();
    const obs = new MutationObserver(probe);
    obs.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    return () => obs.disconnect();
  }, [isDark, activeTheme]);

  // Persist edits under the ACTIVE theme (skip when unchanged — covers the
  // initial restore and the theme-switch load, avoiding redundant writes/loops).
  useEffect(() => {
    if (JSON.stringify(readSeedFor(seedMap, activeTheme)) === JSON.stringify(seed)) return;
    putSeedMap({ ...seedMap, [activeTheme]: seed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, seedMap, activeTheme]);

  // Control sender ids — the wells / adjustments dispatch actions the card
  // handles ([L11]). Each axis: one base well (hue + anchor) + one adjustment
  // (whose three delta steppers derive their senders via colorAdjustSenders).
  const keyWellId = useId();
  const keyAdjId = useId();
  const accWellId = useId();
  const accAdjId = useId();
  const titlebarWellId = useId();
  const filledWellId = useId();
  const tintedWellId = useId();
  const textselWellId = useId();
  const radioId = useId();
  const choiceId = useId();
  const [radioValue, setRadioValue] = useState("on");
  const [choiceValue, setChoiceValue] = useState("grid");

  const keyDelta = colorAdjustSenders(keyAdjId);
  const accDelta = colorAdjustSenders(accAdjId);

  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: {
      // A well announces itself as the picker's subject.
      [TUG_ACTIONS.ACTIVATE_COLOR_WELL]: (e: ActionEvent) => {
        const sender = typeof e.sender === "string" ? e.sender : "";
        const payload = e.value as { value: TugColorSpec; label: string } | undefined;
        if (!sender || !payload) return;
        setActiveColorTarget({ targetId: responderId, senderId: sender, label: payload.label, value: payload.value });
      },
      // The picker pushes an edited color back to the well that owns it.
      [TUG_ACTIONS.SET_COLOR]: (e: ActionEvent) => {
        const sender = typeof e.sender === "string" ? e.sender : "";
        const next = e.value as TugColorSpec | undefined;
        if (!sender || !next) return;
        if (sender === keyWellId) onAxisBase("key", next);
        else if (sender === accWellId) onAxisBase("accent", next);
        else if (sender === titlebarWellId || sender === filledWellId || sender === tintedWellId || sender === textselWellId) {
          const field = sender === titlebarWellId ? "titlebar" : sender === filledWellId ? "filled" : sender === tintedWellId ? "tinted" : "textsel";
          const hasAlpha = field === "tinted" || field === "textsel";
          onTreatment(field, next, hasAlpha);
          // Treatments are locked to the Key hue: re-pin the picker's hue so a
          // hue change there snaps back rather than diverging from the well.
          updateActiveColorValue(sender, { hue: seed.keyHue, i: next.i, t: next.t, a: hasAlpha ? next.a : 100 });
        }
      },
      // Adjustment delta steppers (one sender per axis).
      [TUG_ACTIONS.SET_VALUE]: (e: ActionEvent) => {
        const sender = typeof e.sender === "string" ? e.sender : "";
        const v = typeof e.value === "number" ? e.value : NaN;
        if (!sender || Number.isNaN(v)) return;
        if (sender === keyDelta.i) onAxisDelta("key", "i", v);
        else if (sender === keyDelta.t) onAxisDelta("key", "t", v);
        else if (sender === keyDelta.a) onAxisDelta("key", "a", v);
        else if (sender === accDelta.i) onAxisDelta("accent", "i", v);
        else if (sender === accDelta.t) onAxisDelta("accent", "t", v);
        else if (sender === accDelta.a) onAxisDelta("accent", "a", v);
      },
      [TUG_ACTIONS.SELECT_VALUE]: (e: ActionEvent) => {
        const sender = typeof e.sender === "string" ? e.sender : "";
        const v = typeof e.value === "string" ? e.value : "";
        if (sender === radioId) setRadioValue(v);
        else if (sender === choiceId) setChoiceValue(v);
      },
    },
  });

  const fmtD = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
  const titlebarLine = isDark
    ? "Title bar: theme-fixed (dark)"
    : `Title bar: i${seed.titlebar.i} t${seed.titlebar.t}`;
  const readout = [
    `Key:    ${seed.keyHue} (${angle(seed.keyHue)})  Δi ${fmtD(seed.key.iDelta)}  Δt ${fmtD(seed.key.tDelta)}`,
    `Accent: ${seed.accHue} (${angle(seed.accHue)})  Δi ${fmtD(seed.accent.iDelta)}  Δt ${fmtD(seed.accent.tDelta)}`,
    `${titlebarLine}   Filled: i${seed.filled.i} t${seed.filled.t}   Tinted: i${seed.tinted.i} t${seed.tinted.t} a${seed.tinted.a}`,
    `Text sel: i${seed.textsel.i} t${seed.textsel.t} a${seed.textsel.a}`,
  ].join("\n");

  // Apply writes the current duet into the ACTIVE theme's CSS via the dev-server
  // endpoint (which re-derives from the clean baseline, so re-applying never
  // compounds). The theme hot-reload then repaints the whole app. The titlebar
  // treatment is sent only for light themes (dark themes don't carry the token).
  // Treatment alpha is sent in the 0–1 oklch convention the endpoint expects.
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
        key: seed.key,
        accentHue: seed.accHue,
        accent: seed.accent,
        ...(DARK_THEMES.has(theme)
          ? {}
          : { titlebar: { i: seed.titlebar.i, t: seed.titlebar.t } }),
        filled: { i: seed.filled.i, t: seed.filled.t },
        tinted: { i: seed.tinted.i, t: seed.tinted.t, a: seed.tinted.a / 100 },
        textsel: { i: seed.textsel.i, t: seed.textsel.t, a: seed.textsel.a / 100 },
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
            <div className="gcd-group-label">Axes (hue + i/t deltas)</div>
            <div className="gcd-control-row">
              <span className="gcd-control-label">Key</span>
              <TugColorAdjustment
                base={{ hue: seed.keyHue, i: seed.keyBase.i, t: seed.keyBase.t, a: seed.keyBase.a }}
                value={seed.key}
                senderId={keyAdjId}
                baseSenderId={keyWellId}
                baseLabel="Key hue"
                showAlpha={false}
              />
            </div>
            <div className="gcd-control-row">
              <span className="gcd-control-label">Accent</span>
              <TugColorAdjustment
                base={{ hue: seed.accHue, i: seed.accBase.i, t: seed.accBase.t, a: seed.accBase.a }}
                value={seed.accent}
                senderId={accAdjId}
                baseSenderId={accWellId}
                baseLabel="Accent hue"
                showAlpha={false}
              />
            </div>

            <div className="gcd-group-label">Treatments (off the Key hue)</div>
            {isDark ? (
              <div className="gcd-titlebar-fixed-note">
                Title bar: dark themes use a fixed title-bar treatment (not the Key
                hue) — shown below, not tunable here.
                <span className="gcd-titlebar-fixed-swatch">
                  {/* Chip paints the title-bar tokens live in CSS, so it tracks
                      the theme with zero lag. The text value is read separately. */}
                  <span className="gcd-titlebar-fixed-chip">Aa</span>
                  {titlebarFixed && (
                    <span className="gcd-titlebar-fixed-value">{titlebarFixed.bg}</span>
                  )}
                </span>
              </div>
            ) : (
              <div className="gcd-control-row">
                <span className="gcd-control-label">Title bar</span>
                <TugColorWell senderId={titlebarWellId} label="Title bar" value={{ hue: seed.keyHue, i: seed.titlebar.i, t: seed.titlebar.t, a: 100 }} />
              </div>
            )}
            <div className="gcd-control-row">
              <span className="gcd-control-label">Filled</span>
              <TugColorWell senderId={filledWellId} label="Filled" value={{ hue: seed.keyHue, i: seed.filled.i, t: seed.filled.t, a: 100 }} />
            </div>
            <div className="gcd-control-row">
              <span className="gcd-control-label">Tinted</span>
              <TugColorWell senderId={tintedWellId} label="Tinted" value={{ hue: seed.keyHue, i: seed.tinted.i, t: seed.tinted.t, a: seed.tinted.a }} />
            </div>
            <div className="gcd-control-row">
              <span className="gcd-control-label">Text selection</span>
              <TugColorWell senderId={textselWellId} label="Text selection" value={{ hue: seed.keyHue, i: seed.textsel.i, t: seed.textsel.t, a: seed.textsel.a }} />
            </div>
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
