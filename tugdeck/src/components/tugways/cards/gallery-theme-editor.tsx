/**
 * gallery-theme-editor.tsx — the Theme Deriver.
 *
 * Per-theme color tuning is obsolete: a theme family is one hand-tuned BASE
 * (brio dark / harmony light) plus a hue rotation that holds each token's
 * PERCEIVED chroma + lightness (theme-editor-core's deriveTheme). So this card no
 * longer tunes — it derives. Pick the family member, choose its Key + Accent
 * target hues, audition the derived colors, and Generate (writes the theme via
 * the dev-server /__theme-editor/derive endpoint).
 *
 * The base CSS is imported raw (?raw, never expanded) so deriveTheme can run
 * in-browser for the live audition — no server round-trip until Generate.
 *
 * Laws:
 *  - [L11] controls emit actions; the card handles them via useResponder.
 *  - [L19] gallery-card authoring; registered in gallery-registrations.tsx.
 *  - [P02] the controls are authored into one focus group.
 */

import React, { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { TugColorWell } from "@/components/tugways/tug-color-well";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugBox } from "@/components/tugways/tug-box";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { useFocusManager } from "@/components/tugways/use-focusable";
import { useSpatialOrder } from "@/components/tugways/use-spatial-order";
import { rowGridOrder, type SpatialOrder } from "@/components/tugways/spatial-order";
import { CardIdContext } from "@/lib/card-id-context";
import { setActiveColorTarget } from "@/components/tugways/active-color-target";
import type { TugColorSpec } from "@/components/tugways/tug-color-spec";
import { HUE_FAMILIES } from "@/components/tugways/palette-engine";
import { deriveTheme } from "../../../../theme-editor-core";
import { TUG_ACTIONS } from "../action-vocabulary";
import brioRaw from "../../../../styles/themes/brio.css?raw";
import harmonyRaw from "../../../../styles/themes/harmony.css?raw";
import "./gallery.css";
import "./gallery-theme-editor.css";

// ---------------------------------------------------------------------------
// Family map — each derivable theme, its base, and default target hues.
// ---------------------------------------------------------------------------

interface FamilyEntry { base: "brio" | "harmony"; mode: "dark" | "light"; key: string; accent: string; }

const FAMILY: Record<string, FamilyEntry> = {
  nocturne: { base: "brio", mode: "dark", key: "seafoam", accent: "orange" },
  bravura: { base: "brio", mode: "dark", key: "purple", accent: "orange" },
  aria: { base: "harmony", mode: "light", key: "iris", accent: "amber" },
  vivace: { base: "harmony", mode: "light", key: "rose", accent: "gold" },
};

const OUTPUT_ITEMS = Object.keys(FAMILY).map((name) => ({
  value: name,
  label: name[0].toUpperCase() + name.slice(1),
}));

const BASE_CSS: Record<string, string> = { brio: brioRaw, harmony: harmonyRaw };

/** Representative derived tokens shown as an audition of the derived theme. */
const PREVIEW: ReadonlyArray<readonly [string, string]> = [
  ["Filled", "--tug7-surface-control-primary-filled-action-rest"],
  ["Tinted", "--tug7-surface-control-primary-tinted-action-rest"],
  ["Selection", "--tug7-surface-selection-primary-normal-selected-rest"],
  ["Link", "--tug7-element-global-text-normal-link-rest"],
  ["Accent", "--tug7-element-global-fill-normal-accent-rest"],
  ["Surface", "--tug7-surface-global-primary-normal-content-rest"],
];

const angle = (hue: string): string => {
  const a = HUE_FAMILIES[hue];
  return a === undefined ? "" : `${a}°`;
};

/** Parse a derived token's `--tug-color(...)` into a spec (derived tokens are
 *  single-hue, so a light parse suffices). */
function tokenSpec(css: string, name: string): TugColorSpec | null {
  const m = new RegExp(`${name}\\s*:\\s*--tug-color\\(([^)]*)\\)`).exec(css);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => s.trim());
  const hue = parts[0].split("-")[0];
  let i = 50, t = 50, a = 100;
  for (const p of parts.slice(1)) {
    const mm = p.match(/^([ita])\s*:\s*([\d.]+)$/);
    if (!mm) continue;
    if (mm[1] === "i") i = parseFloat(mm[2]);
    else if (mm[1] === "t") t = parseFloat(mm[2]);
    else a = parseFloat(mm[2]);
  }
  return { hue, i, t, a };
}

// ---------------------------------------------------------------------------
// GalleryThemeEditor — the Theme Deriver
// ---------------------------------------------------------------------------

export function GalleryThemeEditor(): React.ReactElement {
  const [output, setOutput] = useState<string>("nocturne");
  const fam = FAMILY[output];
  // The wells hold full color specs so the shared picker edits them normally;
  // derivation only reads each spec's hue.
  const [keySpec, setKeySpec] = useState<TugColorSpec>({ hue: fam.key, i: 50, t: 50, a: 100 });
  const [accSpec, setAccSpec] = useState<TugColorSpec>({ hue: fam.accent, i: 50, t: 50, a: 100 });
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const keyHue = keySpec.hue;
  const accHue = accSpec.hue;

  // On family switch, reset the hues to that member's defaults.
  useEffect(() => {
    setKeySpec({ hue: FAMILY[output].key, i: 50, t: 50, a: 100 });
    setAccSpec({ hue: FAMILY[output].accent, i: 50, t: 50, a: 100 });
  }, [output]);

  const baseCss = BASE_CSS[fam.base] ?? "";
  const derived = useMemo(() => deriveTheme(baseCss, keyHue, accHue), [baseCss, keyHue, accHue]);
  const previewSpecs = useMemo(
    () => PREVIEW.map(([label, name]) => [label, tokenSpec(derived.css, name)] as const),
    [derived],
  );

  const responderId = useId();
  const outputId = useId();
  const keyWellId = useId();
  const accWellId = useId();

  // ---- Focus language ([P02]) — one group for the controls. ----
  const FG = useId();
  const focusManager = useFocusManager();
  const cardId = useContext(CardIdContext);
  // A flat vertical order over the leaf stops so arrows never dead-end into a
  // beep (the choice group owns its own Left/Right; wells + button seam).
  const spatialOrder = useMemo<SpatialOrder>(
    () => rowGridOrder([[`${FG}:0`], [`${FG}:1`], [`${FG}:2`], [`${FG}:3`]]),
    [FG],
  );
  useSpatialOrder(spatialOrder);
  const seededRef = useRef(false);
  useLayoutEffect(() => {
    if (!focusManager) return;
    const arm = (): void => {
      if (seededRef.current) return;
      if (cardId !== null && focusManager.keyCard() !== cardId) return;
      seededRef.current = true;
      focusManager.contextFor(cardId).armKeyboardRestore(`${FG}:0`);
    };
    arm();
    return focusManager.subscribe(arm);
  }, [focusManager, cardId, FG]);

  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.ACTIVATE_COLOR_WELL]: (e: ActionEvent) => {
        const sender = typeof e.sender === "string" ? e.sender : "";
        const payload = e.value as { value: TugColorSpec; label: string } | undefined;
        if (!sender || !payload) return;
        setActiveColorTarget({ targetId: responderId, senderId: sender, label: payload.label, value: payload.value });
      },
      // The wells hold the edited color; derivation uses only its hue.
      [TUG_ACTIONS.SET_COLOR]: (e: ActionEvent) => {
        const sender = typeof e.sender === "string" ? e.sender : "";
        const next = e.value as TugColorSpec | undefined;
        if (!sender || !next) return;
        if (sender === keyWellId) setKeySpec(next);
        else if (sender === accWellId) setAccSpec(next);
      },
      [TUG_ACTIONS.SELECT_VALUE]: (e: ActionEvent) => {
        if (e.sender === outputId && typeof e.value === "string") setOutput(e.value);
      },
    },
  });

  const onGenerate = (): void => {
    setGenerating(true);
    setMsg(null);
    fetch("/__theme-editor/derive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base: fam.base, out: output, keyHue, accentHue: accHue }),
    })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { error?: string; count?: number };
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        setMsg(`Generated ${output} from ${fam.base} — ${data.count ?? 0} tokens`);
      })
      .catch((err: unknown) => setMsg(`Failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setGenerating(false));
  };

  return (
    <ResponderScope>
      <div className="cg-content" data-testid="gallery-theme-editor" ref={responderRef as (el: HTMLDivElement | null) => void}>
        <div className="cg-section">
          <TugLabel size="2xs" emphasis="calm">
            Derive a family member from a hand-tuned base. Hues rotate; perceived chroma + lightness are held.
          </TugLabel>

          <div className="gcd-controls">
            <div className="gcd-control-row">
              <span className="gcd-control-label">Theme</span>
              <TugChoiceGroup
                items={OUTPUT_ITEMS}
                value={output}
                senderId={outputId}
                size="xs"
                aria-label="Family member"
                commit="live"
                focusGroup={FG}
                focusOrder={0}
              />
            </div>
            <div className="gcd-control-row">
              <span className="gcd-control-label">Base</span>
              <span className="gcd-control-note">{fam.base} ({fam.mode})</span>
            </div>
            <div className="gcd-control-row">
              <span className="gcd-control-label">Key hue</span>
              <TugColorWell senderId={keyWellId} label="Key hue" value={keySpec} focusGroup={FG} focusOrder={1} />
              <span className="gcd-control-note">{keyHue} ({angle(keyHue)})</span>
            </div>
            <div className="gcd-control-row">
              <span className="gcd-control-label">Accent hue</span>
              <TugColorWell senderId={accWellId} label="Accent hue" value={accSpec} focusGroup={FG} focusOrder={2} />
              <span className="gcd-control-note">{accHue} ({angle(accHue)})</span>
            </div>
          </div>

          <div className="gcd-actions" style={{ marginTop: "10px" }}>
            <TugPushButton emphasis="primary" role="action" size="xs" disabled={generating} onClick={onGenerate} focusGroup={FG} focusOrder={3}>
              {generating ? "Generating…" : `Generate ${output}`}
            </TugPushButton>
            {msg && <TugLabel size="2xs" emphasis="calm">{msg}</TugLabel>}
          </div>
        </div>

        <TugSeparator />

        <div className="cg-section">
          <TugLabel className="cg-section-title">Derived colors (audition)</TugLabel>
          <TugBox variant="bordered" size="sm" className="gcd-preview-box">
            <div className="gcd-preview-grid">
              {previewSpecs.map(([label, spec]) => (
                <div key={label} className="gcd-preview-cell">
                  <span className="gcd-preview-label">{label}</span>
                  {spec ? <TugColorWell readOnly value={spec} size="sm" label={label} /> : <span className="gcd-control-note">—</span>}
                </div>
              ))}
            </div>
          </TugBox>
        </div>
      </div>
    </ResponderScope>
  );
}
