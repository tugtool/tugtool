/**
 * settings-general-body.tsx — the Dev Card settings panel.
 *
 * The editor/response preferences that previously lived behind the Dev
 * card's title-bar `…` sheet, now hosted by the Settings card's
 * "Dev Card" tab. Three stacked sections:
 *
 *   1. **Response** — Magnification (CSS `zoom` on the transcript
 *      root, per card) and the inter-entry vertical gap. The macOS
 *      app's View menu (`WKWebView.pageZoom`) scales the whole window
 *      and composes with the per-card magnification.
 *   2. **Prompt Editor** — typography, view toggles, and submit-key
 *      policy for the prompt editor.
 *   3. **Assistant** — the deck-wide default Model / Permission Mode /
 *      Effort new cards adopt on first open, edited through the *same*
 *      chips + sheets as the Dev card's Z4B row, bound to the deck
 *      defaults via `DefaultsMetadataAdapter` — one editor, rich labels,
 *      no parallel dropdown UI.
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
import { useTugSheet } from "../tug-sheet";
import { ModelChip } from "./model-chip";
import { EffortChip } from "./effort-chip";
import { useModelPicker } from "./model-picker-sheet";
import { useEffortPicker } from "./effort-picker-sheet";
import { PermissionModeChip, usePermissionSheet } from "./permission-mode-chip";
import { EditorSettingsStore } from "@/lib/editor-settings-store";
import { ResponseSettingsStore } from "@/lib/response-settings-store";
import { DefaultsMetadataAdapter } from "@/lib/defaults-metadata-adapter";
import { createNumberFormatter } from "@/lib/tug-format";
import "./settings-general-body.css";

// ---------------------------------------------------------------------------
// Option constants
// ---------------------------------------------------------------------------

const EDITOR_FONT_OPTIONS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "plex-mono", label: "IBM Plex Mono" },
  { action: TUG_ACTIONS.SET_VALUE, value: "plex-sans", label: "IBM Plex Sans" },
];

const FONT_SIZE_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: 11, label: "11 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 12, label: "12 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 13, label: "13 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 14, label: "14 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 15, label: "15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 16, label: "16 px" },
];

/**
 * Two-decimal formatter for the magnification slider's value input.
 * `0.5` → `"0.50"`, `1` → `"1.00"`, `1.5` → `"1.50"`. Module-scope so
 * the formatter identity stays stable across renders.
 */
const MAGNIFICATION_FORMATTER = createNumberFormatter({ decimals: 2 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  // Defaults-shaped metadata store: lets the Z4B chips + picker sheets render
  // the deck defaults unmodified, with rich labels from the persisted catalog.
  // It owns the three deck-default stores the pickers write to.
  const [defaultsAdapter] = useState(() => new DefaultsMetadataAdapter());
  useEffect(
    () => () => {
      editorStore.dispose();
      responseStore.dispose();
      defaultsAdapter.dispose();
    },
    [editorStore, responseStore, defaultsAdapter],
  );

  // One sheet host for the Assistant pickers — the same single-host pattern
  // the Dev card uses, so opening one picker replaces any other open sheet.
  const assistantSheet = useTugSheet();
  const { openModelPicker } = useModelPicker({
    onSelectModel: (selector) => defaultsAdapter.modelStore.set(selector),
    sessionMetadataStore: defaultsAdapter,
    showSheet: assistantSheet.showSheet,
  });
  const { openEffortPicker } = useEffortPicker({
    sessionMetadataStore: defaultsAdapter,
    onSelectEffort: (effort) => defaultsAdapter.effortStore.set(effort),
    showSheet: assistantSheet.showSheet,
  });
  // No cardId: the defaults context — the sheet seeds from the adapter's
  // mode (the deck default), never a per-card persisted value.
  const { openPermissionSheet } = usePermissionSheet({
    sessionMetadataStore: defaultsAdapter,
    onSelectMode: (mode) => defaultsAdapter.permissionModeStore.set(mode),
    showSheet: assistantSheet.showSheet,
  });

  const editorSettings = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
  );
  const responseSettings = useSyncExternalStore(
    responseStore.subscribe,
    responseStore.getSnapshot,
  );

  // Stable senders for the controls; the chain dispatches land on the
  // responder scope registered below.
  const fontPopupId = useId();
  const fontSizePopupId = useId();
  const lineWrapId = useId();
  const lineNumbersId = useId();
  const activeLineGutterId = useId();
  const returnKeyId = useId();
  const enterKeyId = useId();
  const responseEntryMarginSliderId = useId();
  const responseMagnificationSliderId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [fontPopupId]: (v: string) => editorStore.set({ fontId: v }),
    },
    setValueNumber: {
      [fontSizePopupId]: (v: number) => editorStore.set({ fontSize: v }),
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
          label="Prompt Editor"
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
          {/* Defaults new cards adopt on first open. A card that already
              carries its own remembered value keeps it — changing these only
              affects freshly-spawned cards. All three controls are the same
              chips + sheets as the Z4B row, bound to the deck defaults
              through the adapter — one editor, identical labels. */}
          <div className="settings-general-row settings-general-assistant-row">
            <PermissionModeChip
              sessionMetadataStore={defaultsAdapter}
              onOpenSheet={openPermissionSheet}
            />
            <ModelChip
              sessionMetadataStore={defaultsAdapter}
              onOpenPicker={openModelPicker}
            />
            <EffortChip
              sessionMetadataStore={defaultsAdapter}
              onOpenPicker={openEffortPicker}
            />
          </div>
        </TugBox>
        {assistantSheet.renderSheet()}
      </div>
    </ResponderScope>
  );
}
