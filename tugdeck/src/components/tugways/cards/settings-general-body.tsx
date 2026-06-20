/**
 * settings-general-body.tsx — the Dev Card settings panel.
 *
 * The editor/response preferences that previously lived behind the Dev
 * card's title-bar `…` sheet, now hosted by the Settings card's
 * "Dev Card" tab. Two stacked sections:
 *
 *   1. **Response** — Magnification (CSS `zoom` on the transcript
 *      root, per card) and the inter-entry vertical gap. The macOS
 *      app's View menu (`WKWebView.pageZoom`) scales the whole window
 *      and composes with the per-card magnification.
 *   2. **Editor** — typography, view toggles, and submit-key policy
 *      for the prompt editor.
 *
 * Self-contained: the panel constructs its own `EditorSettingsStore` /
 * `ResponseSettingsStore` instances at mount and disposes them on
 * unmount. Both stores read/write **global** tugbank domains and
 * observe `onDomainChanged`, so edits made here propagate live to
 * every open Dev card (whose own instances watch the same domains) —
 * no shared store instance is required. Neither instance is ever
 * `bind()`-ed to a DOM element, so this panel never writes editor CSS
 * variables itself; it only persists.
 *
 * Laws: store snapshots enter via `useSyncExternalStore` [L02]; the
 * controls dispatch through the chain to this panel's
 * `useResponderForm` responder ([L11]); layout lives in
 * settings-general-body.css [L06].
 *
 * @module components/tugways/cards/settings-general-body
 */

import React, { useEffect, useId, useState, useSyncExternalStore } from "react";
import { TugBox } from "../tug-box";
import { TugChoiceGroup } from "../tug-choice-group";
import { TugLabel } from "../tug-label";
import { TugPopupButton } from "../tug-popup-button";
import type { TugPopupButtonItem } from "../tug-popup-button";
import { TugSlider } from "../tug-slider";
import { TugSwitch } from "../tug-switch";
import { TUG_ACTIONS } from "../action-vocabulary";
import { useResponderForm } from "../use-responder-form";
import { EditorSettingsStore } from "@/lib/editor-settings-store";
import { ResponseSettingsStore } from "@/lib/response-settings-store";
import { DefaultPermissionModeStore } from "@/lib/default-permission-mode-store";
import { PERMISSION_MODE_LABELS, PERMISSION_MODE_MENU } from "@/lib/permission-mode";
import { createNumberFormatter } from "@/lib/tug-format";
import "./settings-general-body.css";

// ---------------------------------------------------------------------------
// Option constants
// ---------------------------------------------------------------------------

const EDITOR_FONT_OPTIONS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "plex-sans", label: "IBM Plex Sans" },
  { action: TUG_ACTIONS.SET_VALUE, value: "inter", label: "Inter" },
  { action: TUG_ACTIONS.SET_VALUE, value: "plex-mono", label: "IBM Plex Mono" },
  { action: TUG_ACTIONS.SET_VALUE, value: "hack", label: "Hack (mono)" },
];

const FONT_SIZE_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: 11, label: "11 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 12, label: "12 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 13, label: "13 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 14, label: "14 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 15, label: "15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 16, label: "16 px" },
];

const LETTER_SPACING_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: -0.35, label: "-0.35 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.25, label: "-0.25 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.15, label: "-0.15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.10, label: "-0.10 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.05, label: "-0.05 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0, label: "Normal" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0.05, label: "+0.05 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0.10, label: "+0.10 px" },
];

const LINE_HEIGHT_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: 1.0, label: "1.0" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.1, label: "1.1" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.2, label: "1.2" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.3, label: "1.3" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.4, label: "1.4" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.5, label: "1.5" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.6, label: "1.6" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.7, label: "1.7" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.8, label: "1.8" },
];

/**
 * Default permission-mode choices, derived from the chip's behavior-sheet
 * menu so the two surfaces never drift. Each carries the same human-readable
 * label the chip shows (Default, Accept Edits, Plan, Auto, Bypass).
 */
const DEFAULT_PERMISSION_MODE_OPTIONS: TugPopupButtonItem<string>[] =
  PERMISSION_MODE_MENU.map((mode) => ({
    action: TUG_ACTIONS.SET_VALUE,
    value: mode,
    label: PERMISSION_MODE_LABELS[mode] ?? mode,
  }));

/**
 * Two-decimal formatter for the magnification slider's value input.
 * `0.5` → `"0.50"`, `1` → `"1.00"`, `1.5` → `"1.50"`. Module-scope so
 * the formatter identity stays stable across renders.
 */
const MAGNIFICATION_FORMATTER = createNumberFormatter({ decimals: 2 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function letterSpacingLabel(value: number): string {
  if (value === 0) return "Normal";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} px`;
}

/**
 * Plain-language legend for the submit-key option groups — one line per
 * combination (Return, Shift+Return, Enter, Shift+Enter) describing
 * exactly what it does under the current `returnKeyAction` /
 * `numpadEnterAction`. Shift always inverts the unshifted action, so a
 * single boolean per key drives both of its lines. Recomputed on every
 * render so the legend tracks the choice groups live.
 */
function submitKeyLegend(
  returnKeyAction: "submit" | "newline",
  numpadEnterAction: "submit" | "newline",
): { key: string; effect: string }[] {
  const SUBMIT = "submits";
  const NEWLINE = "inserts a newline";
  const returnSubmits = returnKeyAction === "submit";
  const enterSubmits = numpadEnterAction === "submit";
  return [
    { key: "Return", effect: returnSubmits ? SUBMIT : NEWLINE },
    { key: "Shift+Return", effect: returnSubmits ? NEWLINE : SUBMIT },
    { key: "Enter", effect: enterSubmits ? SUBMIT : NEWLINE },
    { key: "Shift+Enter", effect: enterSubmits ? NEWLINE : SUBMIT },
  ];
}

// ---------------------------------------------------------------------------
// SettingsGeneralBody
// ---------------------------------------------------------------------------

export function SettingsGeneralBody() {
  const [editorStore] = useState(() => new EditorSettingsStore());
  const [responseStore] = useState(() => new ResponseSettingsStore());
  const [defaultModeStore] = useState(() => new DefaultPermissionModeStore());
  useEffect(
    () => () => {
      editorStore.dispose();
      responseStore.dispose();
      defaultModeStore.dispose();
    },
    [editorStore, responseStore, defaultModeStore],
  );

  const editorSettings = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
  );
  const responseSettings = useSyncExternalStore(
    responseStore.subscribe,
    responseStore.getSnapshot,
  );
  const defaultMode = useSyncExternalStore(
    defaultModeStore.subscribe,
    defaultModeStore.getSnapshot,
  );

  // Stable senders for the controls; the chain dispatches land on the
  // responder scope registered below.
  const fontPopupId = useId();
  const fontSizePopupId = useId();
  const letterSpacingPopupId = useId();
  const lineHeightPopupId = useId();
  const lineWrapId = useId();
  const lineNumbersId = useId();
  const activeLineGutterId = useId();
  const returnKeyId = useId();
  const enterKeyId = useId();
  const responseEntryMarginSliderId = useId();
  const responseMagnificationSliderId = useId();
  const defaultModePopupId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [fontPopupId]: (v: string) => editorStore.set({ fontId: v }),
      [defaultModePopupId]: (v: string) => defaultModeStore.set(v),
    },
    setValueNumber: {
      [fontSizePopupId]: (v: number) => editorStore.set({ fontSize: v }),
      [letterSpacingPopupId]: (v: number) => editorStore.set({ letterSpacing: v }),
      [lineHeightPopupId]: (v: number) => editorStore.set({ lineHeight: v }),
      [responseEntryMarginSliderId]: (v: number) =>
        responseStore.set({ entryMargin: v }),
      [responseMagnificationSliderId]: (v: number) =>
        responseStore.set({ magnification: v }),
    },
    toggle: {
      [lineWrapId]: (v: boolean) => editorStore.set({ lineWrap: v }),
      [lineNumbersId]: (v: boolean) => editorStore.set({ lineNumbers: v }),
      [activeLineGutterId]: (v: boolean) =>
        editorStore.set({ highlightActiveLineGutter: v }),
    },
    selectValue: {
      [returnKeyId]: (v: string) =>
        editorStore.set({ returnKeyAction: v as "submit" | "newline" }),
      [enterKeyId]: (v: string) =>
        editorStore.set({ numpadEnterAction: v as "submit" | "newline" }),
    },
  });

  return (
    <ResponderScope>
      <div
        className="settings-general"
        data-testid="settings-general"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <TugBox
          label="Response"
          labelPosition="legend"
          variant="bordered"
          className="settings-general-group"
        >
          {/* 2-column grid (label / slider) so both rows share a single
              label column auto-sized to the longest entry, keeping labels
              close to their slider track. Both sliders share `valueWidth`
              so their value columns also align. Magnification scales the
              whole transcript subtree (CSS `zoom` on `.dev-card-transcript`)
              per card; the macOS app's View menu (`WKWebView.pageZoom`)
              still scales the entire window and composes with this. */}
          <div className="settings-general-slider-grid">
            <span className="settings-general-slider-label">Magnification</span>
            <TugSlider
              className="settings-general-slider"
              value={responseSettings.magnification}
              min={0.5}
              max={1.5}
              step={0.05}
              senderId={responseMagnificationSliderId}
              size="md"
              valueWidth="3.5rem"
              formatter={MAGNIFICATION_FORMATTER}
            />
            <span className="settings-general-slider-label">Entry Gap</span>
            <TugSlider
              className="settings-general-slider"
              value={responseSettings.entryMargin}
              min={0}
              max={48}
              step={1}
              senderId={responseEntryMarginSliderId}
              size="md"
              valueWidth="3.5rem"
            />
          </div>
        </TugBox>

        <TugBox
          label="Editor"
          labelPosition="legend"
          variant="bordered"
          className="settings-general-group"
        >
          <div className="settings-general-row">
            <TugPopupButton
              className="settings-general-popup settings-general-popup-font"
              topLabel="Font"
              label={EDITOR_FONT_OPTIONS.find(f => f.value === editorSettings.fontId)?.label ?? "Font"}
              items={EDITOR_FONT_OPTIONS}
              senderId={fontPopupId}
              size="sm"
            />
            <TugPopupButton
              className="settings-general-popup settings-general-popup-size"
              topLabel="Size"
              label={`${editorSettings.fontSize}px`}
              items={FONT_SIZE_OPTIONS}
              senderId={fontSizePopupId}
              size="sm"
            />
            <TugPopupButton
              className="settings-general-popup settings-general-popup-line"
              topLabel="Line"
              label={editorSettings.lineHeight.toFixed(1)}
              items={LINE_HEIGHT_OPTIONS}
              senderId={lineHeightPopupId}
              size="sm"
            />
            <TugPopupButton
              className="settings-general-popup settings-general-popup-spacing"
              topLabel="Spacing"
              label={letterSpacingLabel(editorSettings.letterSpacing)}
              items={LETTER_SPACING_OPTIONS}
              senderId={letterSpacingPopupId}
              size="sm"
            />
          </div>

          <div className="settings-general-switches">
            <TugSwitch
              label="Line wrap"
              checked={editorSettings.lineWrap}
              senderId={lineWrapId}
              size="md"
            />
            <TugSwitch
              label="Line numbers"
              checked={editorSettings.lineNumbers}
              senderId={lineNumbersId}
              size="md"
            />
            <TugSwitch
              label="Active line"
              checked={editorSettings.highlightActiveLineGutter}
              senderId={activeLineGutterId}
              size="md"
            />
          </div>

          {/* Submit-key policy. One option group per physical key; the
              default (today's behavior) is the first option in each.
              `returnKeyAction` / `numpadEnterAction` are the editor's
              `InputAction`s straight through — shift inverts each. */}
          <div className="settings-general-keys">
            {/* Label + choice-group pairs in a 2-column grid. The control
                column is `max-content` (sized to the widest group), and each
                group fills it (`width:auto` + grid stretch) — so both groups
                are equal width and every segment is just as wide as the
                longest of the four choices, never the whole row. */}
            <div className="settings-general-key-grid">
              <span className="settings-general-key-label">Return key</span>
              <TugChoiceGroup
                className="settings-general-key-choice"
                size="sm"
                senderId={returnKeyId}
                value={editorSettings.returnKeyAction}
                aria-label="Return key submit behavior"
                items={[
                  { value: "newline", label: "Shift+Return submits" },
                  { value: "submit", label: "Return submits" },
                ]}
              />
              <span className="settings-general-key-label">Enter key</span>
              <TugChoiceGroup
                className="settings-general-key-choice"
                size="sm"
                senderId={enterKeyId}
                value={editorSettings.numpadEnterAction}
                aria-label="Enter key submit behavior"
                items={[
                  { value: "submit", label: "Enter submits" },
                  { value: "newline", label: "Shift+Enter submits" },
                ]}
              />
            </div>

            {/* Live legend: exactly what each key combination does under the
                current choices. Updates as the groups change (driven off the
                same `editorSettings` snapshot). */}
            <div className="settings-general-key-legend">
              {submitKeyLegend(
                editorSettings.returnKeyAction,
                editorSettings.numpadEnterAction,
              ).map(({ key, effect }) => (
                <TugLabel key={key} size="sm" emphasis="calm">
                  {`• ${key} ${effect}`}
                </TugLabel>
              ))}
            </div>
          </div>
        </TugBox>

        <TugBox
          label="Assistant"
          labelPosition="legend"
          variant="bordered"
          className="settings-general-group"
        >
          {/* Default mode new cards adopt on first open. A card that already
              carries its own remembered mode keeps it — changing this only
              affects freshly-spawned cards. Mirrors the Mode chip's sheet. */}
          <div className="settings-general-row">
            <TugPopupButton
              className="settings-general-popup settings-general-popup-mode"
              topLabel="Permission Mode"
              label={PERMISSION_MODE_LABELS[defaultMode] ?? defaultMode}
              items={DEFAULT_PERMISSION_MODE_OPTIONS}
              senderId={defaultModePopupId}
              size="sm"
            />
          </div>
        </TugBox>
      </div>
    </ResponderScope>
  );
}
