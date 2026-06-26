/**
 * gallery-inline-code-studies.tsx — interactive inline-code tuner.
 *
 * Earlier rounds settled the shape (no wash; a per-theme "spot" hue, the
 * theme's own third leg, dimmed onto the prose neutral) and the open
 * questions: which spot hue per theme, how much of it, and whether a
 * small monospace size reduction helps. This card makes those three
 * dials live, per theme, so they can be tuned by eye on real prose.
 *
 *  - SPOT color — a `TugColorWell` + embedded `TugColorPicker` (the same
 *    pair the Theme Deriver uses); each theme keeps its own value.
 *  - LEVEL — a `TugSlider` for how much spot rides on the neutral (color
 *    reads stronger on dark, so dark themes want less, light themes more).
 *  - SIZE — a `TugSlider` for the monospace size factor (e.g. 0.98×).
 *
 * The active theme comes from `useThemeContext`; switch themes and the
 * controls + preview track that theme's dialed-in values. Appearance is
 * applied by writing CSS variables onto the preview node via the DOM
 * ([L06]); a readout prints every theme's current values so a winner can
 * be copied straight into `styles/themes/*.css`.
 *
 * Laws: [L06] appearance via CSS/DOM; [L11] controls emit actions, the
 * card handles them via `useResponder`; [L19] gallery-card authoring.
 *
 * @module components/tugways/cards/gallery-inline-code-studies
 */

import React, { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugColorWell } from "@/components/tugways/tug-color-well";
import { TugColorPicker } from "@/components/tugways/tug-color-picker";
import { TugSlider } from "@/components/tugways/tug-slider";
import { useResponder } from "@/components/tugways/use-responder";
import { setActiveColorTarget } from "@/components/tugways/active-color-target";
import { HUE_FAMILIES, authoredFromFrac, authoredFromChroma, resolveHueAngle } from "@/components/tugways/palette-engine";
import {
  hueText,
  swatchOklch,
  type TugColorSpec,
} from "@/components/tugways/tug-color-spec";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { useThemeContext } from "@/contexts/theme-provider";
import { TUG_ACTIONS } from "../action-vocabulary";

import "./gallery-inline-code-studies.css";

/** Per-theme dial state: the spot color, how much of it, and the mono size. */
interface Tuning {
  readonly spot: TugColorSpec;
  /** Spot level in percent (how much spot blends onto the prose neutral). */
  readonly level: number;
  /** Monospace size in percent of 1em (98 = 0.98em). */
  readonly size: number;
}

/** Seed each theme from the spot tokens authored in `styles/themes/*.css`.
 *  Dark themes start lighter (color reads stronger on dark); light heavier. */
const SEED: Record<string, Tuning> = {
  brio: { spot: { hue: "grass", l: 0.93, c: 0.06, a: 1 }, level: 25, size: 95 },
  nocturne: { spot: { hue: "peony", l: 0.93, c: 0.06, a: 1 }, level: 25, size: 95 },
  bravura: { spot: { hue: "lime", l: 0.94, c: 0.06, a: 1 }, level: 25, size: 95 },
  harmony: { spot: { hue: "peony", l: 0.4, c: 0.12, a: 1 }, level: 40, size: 95 },
  aria: { spot: { hue: "green", l: 0.42, c: 0.12, a: 1 }, level: 40, size: 95 },
  vivace: { spot: { hue: "plum", l: 0.4, c: 0.12, a: 1 }, level: 40, size: 95 },
};

const FALLBACK: Tuning = { spot: { hue: "grass", l: 0.93, c: 0.06, a: 1 }, level: 25, size: 95 };

const THEME_ORDER = ["brio", "nocturne", "bravura", "harmony", "aria", "vivace"];

/** Real, code-dense prose — the reading-flow case under test. */
const SAMPLE = `Replace the physical file with a Vite **virtual module**, exactly mirroring the \`capabilitiesVirtualModulePlugin\` that already lives in this same \`vite.config.ts\` (precedent in-tree, [D6.c]).

- The plugin already holds \`activeThemeName\` **in memory, per dev-server process**. Make that the *only* source of the active stylesheet:
  - \`resolveId("virtual:tug-active-theme.css")\` → resolved id (\`.css\` suffix so PostCSS expands \`--tug-color()\`).
  - \`load()\` → read \`styles/themes/<activeThemeName>.css\` from disk and return its contents.
  - On \`/__themes/activate\`, edit, derive, apply, or startup sync → update \`activeThemeName\`, \`invalidateModule()\`, and push the HMR update for that module (plus the existing \`tug:theme-changed\` custom event, same ordering).
- \`tug.css\` swaps \`@import './tug-active-theme.css'\` for a side-effect import of the virtual module from the JS entry (\`main.tsx\`), since \`@import\` of a virtual id is unreliable.

**Touch points:** \`vite.config.ts\` (the plugins + the four handlers that call \`copyActiveThemeToFile\`/\`writeIfChanged\` → invalidate instead), \`styles/tug.css\` + \`main.tsx\` (import swap), and \`theme-activate-endpoint.test.ts\` (\`activateTheme\` no longer writes a file — it validates the theme and returns \`{theme, hostCanvasColor}\`).`;

const angleOf = (hue: string): string => {
  const a = HUE_FAMILIES[hue];
  return a === undefined ? "" : `${a}°`;
};

/** The theme-file form a dialed-in spot would be authored as (0–1000 units). */
function spotToken(s: TugColorSpec): string {
  const angle = resolveHueAngle(s.hue, s.adjacent);
  const c = angle === undefined ? 0 : authoredFromChroma(s.c, s.l, angle);
  const head = `--tug-color(${hueText(s)}, l: ${authoredFromFrac(s.l)}, c: ${c}`;
  return s.a >= 1 ? `${head})` : `${head}, a: ${authoredFromFrac(s.a)})`;
}

/**
 * GalleryInlineCodeStudies — live, per-theme inline-code tuner.
 */
export function GalleryInlineCodeStudies(): React.ReactElement {
  const { theme } = useThemeContext();
  const [tunings, setTunings] = useState<Record<string, Tuning>>(() => ({ ...SEED }));

  const current = tunings[theme] ?? SEED[theme] ?? FALLBACK;

  // L07: action handlers read live theme + state through refs, not closures.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const responderId = useId();
  const spotWellId = useId();
  const levelSliderId = useId();
  const sizeSliderId = useId();
  const FG = useId();

  const previewRef = useRef<HTMLDivElement>(null);

  // Appearance applied via DOM, never React state ([L06]).
  const spotCss = swatchOklch(current.spot);
  useLayoutEffect(() => {
    const el = previewRef.current;
    if (el === null) return;
    el.style.setProperty("--ics-spot", spotCss);
    el.style.setProperty("--ics-level", `${current.level}%`);
    el.style.setProperty("--ics-size", `${current.size / 100}em`);
  }, [spotCss, current.level, current.size]);

  const patch = useCallback((next: Partial<Tuning>) => {
    setTunings((prev) => {
      const t = themeRef.current;
      const base = prev[t] ?? SEED[t] ?? FALLBACK;
      return { ...prev, [t]: { ...base, ...next } };
    });
  }, []);

  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.ACTIVATE_COLOR_WELL]: (e: ActionEvent) => {
        const sender = typeof e.sender === "string" ? e.sender : "";
        const payload = e.value as { value: TugColorSpec; label: string } | undefined;
        if (!sender || !payload) return;
        setActiveColorTarget({
          targetId: responderId,
          senderId: sender,
          label: payload.label,
          value: payload.value,
        });
      },
      [TUG_ACTIONS.SET_COLOR]: (e: ActionEvent) => {
        const next = e.value as TugColorSpec | undefined;
        if (e.sender !== spotWellId || !next) return;
        patch({ spot: next });
      },
      [TUG_ACTIONS.SET_VALUE]: (e: ActionEvent) => {
        const v = typeof e.value === "number" ? e.value : NaN;
        if (Number.isNaN(v)) return;
        if (e.sender === levelSliderId) patch({ level: v });
        else if (e.sender === sizeSliderId) patch({ size: v });
      },
    },
  });

  const readout = useMemo(
    () =>
      THEME_ORDER.map((name) => {
        const t = tunings[name] ?? SEED[name] ?? FALLBACK;
        return {
          name,
          line: `${name.padEnd(9)} spot ${spotToken(t.spot).padEnd(38)} level ${String(t.level).padStart(3)}%   size ${(t.size / 100).toFixed(2)}em`,
        };
      }),
    [tunings],
  );

  return (
    <ResponderScope>
      <div
        className="cg-content cg-inline-code-studies"
        data-testid="gallery-inline-code-studies"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <div className="cg-ics-controls">
          <div className="cg-ics-row">
            <span className="cg-ics-row-label">Theme</span>
            <span className="cg-ics-note">{theme}</span>
          </div>
          <div className="cg-ics-row">
            <span className="cg-ics-row-label">Spot color</span>
            <TugColorWell
              senderId={spotWellId}
              label="Spot color"
              value={current.spot}
              focusGroup={FG}
              focusOrder={0}
            />
            <span className="cg-ics-note">
              {hueText(current.spot)} ({angleOf(current.spot.hue)}) · l{Math.round(current.spot.l * 1000)} c{Math.round(current.spot.c * 1000)}
            </span>
          </div>
          <div className="cg-ics-row">
            <span className="cg-ics-row-label">Tint level</span>
            <TugSlider
              label="Tint level"
              senderId={levelSliderId}
              value={current.level}
              min={0}
              max={100}
              step={1}
              size="sm"
              valueWidth="3.5rem"
              focusGroup={FG}
              focusOrder={1}
            />
          </div>
          <div className="cg-ics-row">
            <span className="cg-ics-row-label">Mono size</span>
            <TugSlider
              label="Mono size"
              senderId={sizeSliderId}
              value={current.size}
              min={90}
              max={100}
              step={0.5}
              size="sm"
              valueWidth="3.5rem"
              focusGroup={FG}
              focusOrder={2}
            />
          </div>
        </div>

        <div className="cg-ics-picker">
          <TugColorPicker />
        </div>

        <pre className="cg-ics-readout">
          {readout.map((r) => (
            <div key={r.name} className={r.name === theme ? "cg-ics-active" : undefined}>
              {r.line}
            </div>
          ))}
        </pre>

        {/* Live preview — CSS vars written via the ref drive the code color. */}
        <div className="cg-ics-preview" ref={previewRef}>
          <div className="cg-ics-measure">
            <TugMarkdownBlock
              className="dev-card-transcript-code-body"
              initialText={SAMPLE}
            />
          </div>
        </div>
      </div>
    </ResponderScope>
  );
}
