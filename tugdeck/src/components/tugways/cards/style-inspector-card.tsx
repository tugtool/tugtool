/**
 * style-inspector-card.tsx -- StyleInspectorContent card component and registration.
 *
 * Renders the style inspector as a proper card in the developer card family.
 * Content includes:
 *   - Inspect button to activate ScanModeController for element selection
 *   - DOM path display
 *   - Token chain sections (bg, fg, border)
 *   - Formula provenance section
 *   - Scale/timing readout
 *
 * Design decisions:
 *   [D01] Inspector content is a React component.
 *   [D02] Scan overlay is an imperative DOM element (ScanModeController).
 *   [D03] Reverse map built once as module singleton.
 *   [D06] Appearance changes through CSS/DOM, never React state (L06).
 *
 * **Three-state button:**
 *   - Rest: "Inspect Element" -- no highlight, no overlay
 *   - Scanning: "Cancel Inspection" -- overlay active, highlight follows cursor
 *   - Inspecting: "Done Inspecting" -- overlay gone, highlight pinned on element
 *
 * State transitions (L06 compliant -- DOM attributes drive appearance, not React state):
 *   Rest → Scanning: click "Inspect Element"
 *   Scanning → Inspecting: click an element (ScanModeController calls onSelect)
 *   Scanning → Rest: click "Cancel Inspection"
 *   Inspecting → Rest: click "Done Inspecting" (clears data, removes pinned highlight)
 *   Inspecting → Scanning: NOT allowed; must go Inspecting → Rest first.
 *
 * **Persistent highlight (L06 compliant):**
 *   On element selection, ScanModeController.deactivate({ keepHighlight: true })
 *   leaves the highlightEl in the DOM. The card applies the --pinned CSS class and
 *   manages its position imperatively via ResizeObserver + scroll listener.
 *   On "Done Inspecting", the highlight is removed from the DOM and observers cleaned up.
 *
 * **Authoritative references:**
 *   Spec S01 (#s01-card-registration)
 *   Spec S04 (#s04-data-flow)
 *   (#component-data-flow, #new-files, #strategy)
 *
 * @module components/tugways/cards/style-inspector-card
 */

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { Crosshair } from "lucide-react";
import { TugButton } from "@/components/tugways/tug-button";
import { ScanModeController } from "@/components/tugways/scan-mode-controller";
import {
  resolveTokenChainForProperty,
  fetchFormulasData,
  collectElementTugProperties,
  buildAllStateFormulaRows,
  extractTugColorProvenance,
  buildDomPath,
  shortenNumbers,
  tryFormatTugColor,
  getReverseMap,
} from "@/components/tugways/style-inspector-core";
import { RESOLVED_HUE_SLOT_KEYS } from "@/components/tugways/formula-reverse-map";
import { getTugZoom, getTugTiming, isTugMotionEnabled } from "@/components/tugways/scale-timing";
import { registerCard } from "@/card-registry";
import type { TokenChainResult, FormulaRow, FormulasData } from "@/components/tugways/style-inspector-core";
import "./style-inspector-card.css";

// ---------------------------------------------------------------------------
// styleInspectorBus -- module-level pub/sub bus for external toggle-scan events
// ---------------------------------------------------------------------------

/**
 * Module-level pub/sub bus for the style inspector card.
 *
 * External callers (e.g., DeckCanvas) can call `styleInspectorBus.emit('toggle-scan')`
 * to trigger a scan mode toggle from outside the component tree. The
 * StyleInspectorContent component registers a listener via useLayoutEffect
 * (L03: use useLayoutEffect for registrations that events depend on).
 *
 * 'formulas-updated' is dispatched by HMR listeners (module level) after a
 * recipe or theme-engine file changes and the server sends 'tug:formulas-updated'.
 * [D04] HMR listener for re-fetch.
 *
 * Uses a plain callback registry rather than EventTarget to avoid
 * browser-vs-happy-dom EventTarget/Event compatibility issues in tests.
 */
type StyleInspectorBusEvent = "toggle-scan" | "formulas-updated";

interface StyleInspectorBus {
  on(event: StyleInspectorBusEvent, listener: () => void): void;
  off(event: StyleInspectorBusEvent, listener: () => void): void;
  emit(event: StyleInspectorBusEvent): void;
}

function createStyleInspectorBus(): StyleInspectorBus {
  const listeners = new Map<StyleInspectorBusEvent, Set<() => void>>();
  return {
    on(event, listener) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(listener);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    emit(event) {
      listeners.get(event)?.forEach((cb) => cb());
    },
  };
}

export const styleInspectorBus: StyleInspectorBus = createStyleInspectorBus();

// ---------------------------------------------------------------------------
// HMR listeners — module level (dev only)
// ---------------------------------------------------------------------------

/**
 * Module-level HMR listeners for formula re-fetch.
 *
 * Both listeners dispatch 'formulas-updated' on styleInspectorBus.
 * The React component subscribes via useLayoutEffect (L03) and re-fetches.
 *
 * 'tug:formulas-updated' is the authoritative signal sent by controlTokenHotReload
 * after reactivateActiveTheme() completes. [D04]
 *
 * 'vite:afterUpdate' is a fallback for non-recipe CSS changes where
 * tug:formulas-updated may not fire.
 *
 * No cleanup needed — module-level listeners persist for the module lifetime
 * (dev-only code, never runs in production builds).
 */
if (import.meta.hot) {
  import.meta.hot.on("tug:formulas-updated", () => {
    styleInspectorBus.emit("formulas-updated");
  });

  import.meta.hot.on("vite:afterUpdate", () => {
    styleInspectorBus.emit("formulas-updated");
  });
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface InspectionData {
  el: HTMLElement;
  domPath: string;
  bgColor: string;
  fgColor: string;
  borderColor: string;
  bgChain: TokenChainResult;
  fgChain: TokenChainResult;
  borderChain: TokenChainResult;
  zoom: number;
  timing: number;
  motionOn: boolean;
  formulasData: FormulasData | null;
  /** All-state formula rows grouped by interaction state (rest/hover/active/disabled). Null until formulasData loads. */
  allStateFormulas: Map<string, FormulaRow[]> | null;
}

/** Button mode enum for the three-state inspect button. */
type InspectMode = "rest" | "scanning" | "inspecting";

// ---------------------------------------------------------------------------
// SwatchChip -- small color swatch inline element
// ---------------------------------------------------------------------------

/**
 * SwatchChip renders a small inline color swatch span.
 * Ports `makeSwatchEl` from StyleInspectorOverlay.
 */
function SwatchChip({ color }: { color: string }) {
  return (
    <span
      className="tug-inspector-swatch"
      style={{ background: color }}
    />
  );
}

// ---------------------------------------------------------------------------
// TugColorLabel -- TugColor notation label
// ---------------------------------------------------------------------------

/**
 * TugColorLabel renders a --tug-color() notation for an oklch color.
 * Ports `makeTugColorEl` from StyleInspectorOverlay.
 * Delegates formatting to the extracted `tryFormatTugColor` function.
 * Returns null when the color cannot be expressed as a TugColor.
 */
function TugColorLabel({ color }: { color: string }) {
  const tugColorStr = tryFormatTugColor(color);
  if (!tugColorStr) return null;
  return <span className="tug-inspector-tug-color">{tugColorStr}</span>;
}

// ---------------------------------------------------------------------------
// TugColorProvenanceSection -- TugColor provenance sub-section
// ---------------------------------------------------------------------------

/**
 * Renders the TugColor provenance rows for a palette variable.
 */
function TugColorProvenanceSection({ paletteVar }: { paletteVar: string }) {
  const tugColor = extractTugColorProvenance(paletteVar);
  if (!tugColor) return null;

  const rows: Array<[string, string]> = [
    ["hue", tugColor.hue],
    ["preset", tugColor.preset],
    ["canonical-l", tugColor.canonicalL || "(n/a)"],
    ["peak-c", tugColor.peakC || "(n/a)"],
    ["hue-angle", tugColor.hueAngle || "(n/a)"],
  ];

  return (
    <div className="tug-inspector-section">
      <div className="tug-inspector-section__title">TugColor Provenance</div>
      {rows.map(([label, value]) => (
        <div className="tug-inspector-row" key={label}>
          <span className="tug-inspector-row__label">{label}</span>
          <span className="tug-inspector-row__value">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChainSection -- token chain display for one CSS property
// ---------------------------------------------------------------------------

/**
 * ChainSection renders the token chain for a single CSS property.
 * Ports `renderChainSection` from StyleInspectorOverlay.
 */
function ChainSection({
  title,
  computedValue,
  result,
  property,
}: {
  title: string;
  computedValue: string;
  result: TokenChainResult;
  property: string;
}) {
  const isColorProp =
    property === "background-color" ||
    property === "color" ||
    property === "border-color";

  return (
    <div className="tug-inspector-section">
      <div className="tug-inspector-section__title">{title}</div>

      {(!computedValue || computedValue === "none") ? (
        <div className="tug-inspector-row">
          <span className="tug-inspector-row__value tug-inspector-row__value--dim">(not set)</span>
        </div>
      ) : (
        <>
          {/* Computed value row */}
          <div className="tug-inspector-row">
            <span className="tug-inspector-row__label">computed</span>
            {isColorProp && <SwatchChip color={computedValue} />}
            <span className="tug-inspector-row__value">{shortenNumbers(computedValue)}</span>
            {isColorProp && <TugColorLabel color={computedValue} />}
          </div>

          {/* Token chain */}
          {result.chain.length > 0 && (
            <div className="tug-inspector-chain">
              {result.chain.map((hop, i) => {
                const isTerminal = i === result.chain.length - 1;
                return (
                  <div className="tug-inspector-chain__hop" key={i}>
                    <span className="tug-inspector-chain__prop">{hop.property}</span>
                    <div className="tug-inspector-chain__resolved">
                      {isTerminal ? (
                        <>
                          {isColorProp && hop.value && hop.value !== "none" && (
                            <SwatchChip color={hop.value} />
                          )}
                          <span className="tug-inspector-chain__terminal">
                            {shortenNumbers(hop.value)}
                          </span>
                          {isColorProp && <TugColorLabel color={hop.value} />}
                        </>
                      ) : (
                        <span className="tug-inspector-chain__value">
                          {shortenNumbers(hop.value)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TugColor provenance if chain ends at a palette variable */}
          {result.endsAtPalette && result.paletteVar && (
            <TugColorProvenanceSection paletteVar={result.paletteVar} />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FormulaSection -- formula provenance display
// ---------------------------------------------------------------------------

/**
 * FormulaRowItem renders a single formula row with inline editing support.
 */
function FormulaRowItem({ row, sources, defaults }: {
  row: FormulaRow;
  sources: Record<string, string>;
  defaults: Record<string, number | string | boolean>;
}) {
  return (
    <div className="tug-inspector-formula-field" key={row.field}>
      <span className="tug-inspector-formula-field__name">{row.field}</span>
      <span className="tug-inspector-row__value--dim"> = </span>
      <FormulaChipValue row={row} sources={sources} />
      <span className="tug-inspector-formula-field__type">{row.property}</span>
      {row.isStructural && (
        <span className="tug-inspector-formula__release-label">(applies on release)</span>
      )}
      <FormulaDefault row={row} defaults={defaults} />
    </div>
  );
}

/**
 * FormulaSection renders formula rows with inline editing support.
 *
 * - If empty (no states have rows): shows (constant)
 * - If one state has rows: renders those rows directly (no state header)
 * - If multiple states have rows: renders each state group with a sub-header label
 *
 * Uses FormulaChipValue for the value display (supports click-to-edit).
 */
function FormulaSection({ allStateFormulas, sources, defaults }: {
  allStateFormulas: Map<string, FormulaRow[]>;
  sources: Record<string, string>;
  defaults: Record<string, number | string | boolean>;
}) {
  // Collect non-empty states in display order
  const stateOrder = ["rest", "hover", "active", "disabled"];
  const activeStates = stateOrder.filter(
    (s) => (allStateFormulas.get(s)?.length ?? 0) > 0
  );
  // Also include any states not in the canonical order
  for (const [s, stateRows] of allStateFormulas) {
    if (!stateOrder.includes(s) && stateRows.length > 0) {
      activeStates.push(s);
    }
  }

  const isConstant = activeStates.length === 0;
  const multiState = activeStates.length > 1;

  return (
    <div className="tug-inspector-section">
      <div className="tug-inspector-section__title">Formula</div>
      {isConstant ? (
        <div className="tug-inspector-row">
          <span className="tug-inspector-row__value tug-inspector-row__value--dim">(constant)</span>
        </div>
      ) : (
        activeStates.map((state) => {
          const stateRows = allStateFormulas.get(state) ?? [];
          return (
            <div key={state} className="tug-inspector-formula-state">
              {multiState && (
                <div className="tug-inspector-formula-state__label">{state}</div>
              )}
              {stateRows.map((row) => (
                <FormulaRowItem
                  key={row.field}
                  row={row}
                  sources={sources}
                  defaults={defaults}
                />
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline editing helpers (L06: imperative DOM)
// ---------------------------------------------------------------------------

/**
 * Extract the last numeric literal from a source expression string.
 * Used to pre-fill the edit input with the current source literal (not computed value).
 *
 * Returns the literal as a string (e.g., "28" from "primaryTextTone - 28"),
 * or null if no numeric literal exists.
 *
 * Exported for unit testing. [D07] Source expressions, Spec S05 (#s05-editable-field-types)
 */
export function extractLastNumericLiteral(sourceExpr: string): string | null {
  // Match all numeric literals (integers and decimals, not preceded by a letter/underscore
  // to avoid matching part of identifiers like 'tone1').
  const matches = sourceExpr.match(/(?<![a-zA-Z_\d])(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

/**
 * Determine if a FormulaRow is editable via text input, a hue slot select, or read-only.
 *
 * Returns: 'numeric', 'hue', or 'readonly'
 * Exported for unit testing. [D06] Imperative editing, Spec S05 (#s05-editable-field-types)
 *
 * Rules (in priority order):
 *   - hueSlot property → 'hue'
 *   - boolean value → 'readonly'
 *   - number value → 'numeric'
 *   - string value → 'readonly'
 * Sources are NOT used to gatekeep editability — only for pre-filling the edit input.
 */
export function getEditableType(
  row: FormulaRow,
  _sources: Record<string, string>
): "numeric" | "hue" | "readonly" {
  if (row.property === "hueSlot") return "hue";
  if (typeof row.value === "boolean") return "readonly";
  if (typeof row.value === "number") return "numeric";
  return "readonly";
}

/**
 * POST a formula field edit to the dev server.
 *
 * [D05] Testable handler pattern, Spec S03 (#s03-post-endpoint)
 */
async function postFormulaEdit(field: string, value: number | string): Promise<void> {
  await fetch("/__themes/formula", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, value }),
  });
}

/**
 * Activate an inline numeric input over a value span.
 *
 * Creates an <input type="text"> imperatively (L06), positions it over the span,
 * pre-fills with the source literal, and handles Enter/Escape/blur.
 *
 * Exported for unit testing. [D06] Imperative editing, Spec S04 (#s04-hmr-refetch)
 */
export function activateNumericInput(
  valueSpan: HTMLElement,
  sourceLiteral: string,
  sourceExpr: string | null,
  field: string
): void {
  // Prevent duplicate inputs
  if (valueSpan.querySelector(".si-formula-edit-input")) return;

  // Save original content for restore on cancel
  const originalContent = valueSpan.textContent ?? "";

  // Split the source expression around the literal to get prefix/suffix
  let prefix = "";
  let suffix = "";
  if (sourceExpr && sourceLiteral !== originalContent) {
    const litIdx = sourceExpr.lastIndexOf(sourceLiteral);
    if (litIdx >= 0) {
      prefix = sourceExpr.slice(0, litIdx);
      suffix = sourceExpr.slice(litIdx + sourceLiteral.length);
    }
  }

  const input = document.createElement("input");
  input.type = "text";
  input.value = sourceLiteral;
  input.className = "si-formula-edit-input";
  input.setAttribute("data-testid", `formula-edit-input-${field}`);
  input.setAttribute("aria-label", `Edit ${field}`);
  // Size the input to fit the literal content
  input.style.cssText = [
    "border:none",
    "outline:none",
    "margin:0",
    "padding:0 2px",
    `width:${Math.max(sourceLiteral.length + 1, 3)}ch`,
  ].join(";");

  // Replace span content with: prefix text + input + suffix text
  valueSpan.textContent = "";
  if (prefix) valueSpan.appendChild(document.createTextNode(prefix));
  valueSpan.appendChild(input);
  if (suffix) valueSpan.appendChild(document.createTextNode(suffix));

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    const raw = input.value.trim();
    const num = parseFloat(raw);
    if (!isNaN(num)) {
      postFormulaEdit(field, num).catch(() => {});
    }
    cleanup();
  }

  function cancel() {
    if (committed) return;
    committed = true;
    cleanup();
  }

  function cleanup() {
    valueSpan.textContent = originalContent;
  }

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  });

  input.addEventListener("blur", () => {
    commit();
  });

  input.focus();
  input.select();
}

/**
 * Activate an inline hue slot <select> dropdown over a value span.
 *
 * Creates a <select> element imperatively (L06), populates from RESOLVED_HUE_SLOT_KEYS,
 * and POSTs on change.
 *
 * [D06] Imperative editing, [D08] RESOLVED_HUE_SLOT_KEYS, Spec S05 (#s05-editable-field-types)
 */
function activateHueSlotSelect(
  valueSpan: HTMLElement,
  currentValue: string,
  field: string
): void {
  // Prevent duplicate selects
  if (valueSpan.querySelector(".si-formula-edit-select")) return;

  const select = document.createElement("select");
  select.className = "si-formula-edit-select";
  select.setAttribute("data-testid", `formula-edit-select-${field}`);
  select.setAttribute("aria-label", `Select hue for ${field}`);
  select.style.cssText = [
    "position:absolute",
    "inset:0",
    "width:100%",
    "height:100%",
    "box-sizing:border-box",
    "padding:0 2px",
    "margin:0",
    "border:none",
    "outline:none",
  ].join(";");

  for (const key of RESOLVED_HUE_SLOT_KEYS) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    if (key === currentValue) opt.selected = true;
    select.appendChild(opt);
  }

  valueSpan.style.position = "relative";

  function cleanup() {
    if (select.parentNode) {
      select.parentNode.removeChild(select);
    }
    valueSpan.style.position = "";
  }

  select.addEventListener("change", () => {
    const newValue = select.value;
    postFormulaEdit(field, newValue).catch(() => {});
    cleanup();
  });

  select.addEventListener("blur", () => {
    cleanup();
  });

  select.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  });

  valueSpan.appendChild(select);
  select.focus();
}

/**
 * FormulaDefault shows the default value and a restore link when the current
 * value differs from the default. Clicking "restore" POSTs the default value.
 */
function FormulaDefault({
  row,
  defaults,
}: {
  row: FormulaRow;
  defaults: Record<string, number | string | boolean>;
}) {
  const defaultValue = defaults[row.field];
  if (defaultValue === undefined || defaultValue === row.value) return null;

  const handleRestore = useCallback(() => {
    if (typeof defaultValue === "number") {
      postFormulaEdit(row.field, defaultValue).catch(() => {});
    }
  }, [row.field, defaultValue]);

  return (
    <span className="tug-inspector-formula-field__default">
      (default: {String(defaultValue)}
      {typeof defaultValue === "number" && (
        <>
          {" "}&bull;{" "}
          <span
            className="tug-inspector-formula-field__restore"
            onClick={handleRestore}
            role="button"
            tabIndex={0}
          >
            restore
          </span>
        </>
      )}
      )
    </span>
  );
}

/**
 * FormulaChipValue renders the value portion of a formula chip.
 * For numeric and hue slot fields, clicking activates an inline editor (L06).
 * For read-only fields, just renders text.
 *
 * [D06] Imperative editing, Spec S05 (#s05-editable-field-types)
 */
function FormulaChipValue({
  row,
  sources,
}: {
  row: FormulaRow;
  sources: Record<string, string>;
}) {
  const editableType = getEditableType(row, sources);
  const computedValue = String(row.value);
  const sourceExpr = sources[row.field];
  const displayValue = sourceExpr ?? computedValue;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      const span = e.currentTarget as HTMLElement;
      if (editableType === "numeric") {
        const literal = (sourceExpr ? extractLastNumericLiteral(sourceExpr) : null) ?? computedValue;
        activateNumericInput(span, literal, sourceExpr ?? null, row.field);
      } else if (editableType === "hue") {
        activateHueSlotSelect(span, computedValue, row.field);
      }
    },
    [editableType, row.field, sourceExpr, computedValue]
  );

  if (editableType === "readonly") {
    return (
      <span
        className="tug-inspector-formula-field__value"
        data-testid={`formula-value-${row.field}`}
      >
        {displayValue}
      </span>
    );
  }

  return (
    <span
      className="tug-inspector-formula-field__value tug-inspector-formula-field__value--editable"
      data-testid={`formula-value-${row.field}`}
      data-editable-type={editableType}
      onClick={handleClick}
      title={`Click to edit ${row.field}`}
    >
      {displayValue}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StyleInspectorContent
// ---------------------------------------------------------------------------

/**
 * StyleInspectorContent -- main card content component.
 *
 * Renders the inspect button, DOM path, token chain sections, formula
 * provenance, and scale/timing readout for the selected element.
 *
 * Spec S04 (#s04-data-flow):
 *   - `inspectionDataRef` holds the latest inspection results
 *   - `renderKey` is bumped to trigger re-render after async data arrives
 *   - Scan mode is managed imperatively via `ScanModeController` (L06)
 *   - Button mode (rest/scanning/inspecting) drives label and CSS class via ref+renderKey
 *   - Pinned highlight positioning is managed via ResizeObserver + scroll listener (L06)
 */
export function StyleInspectorContent({ cardId }: { cardId: string }) {
  // Ref holding latest inspection data (avoid stale closures with async fetch).
  const inspectionDataRef = useRef<InspectionData | null>(null);

  // Counter bumped to trigger re-render when inspectionDataRef is updated.
  const [renderKey, setRenderKey] = useState(0);

  // Scan mode controller (created once per component instance).
  const scanCtrlRef = useRef<ScanModeController | null>(null);
  if (!scanCtrlRef.current) {
    scanCtrlRef.current = new ScanModeController();
  }

  // Three-state button mode (L06: drives label/class via ref + renderKey bump).
  const modeRef = useRef<InspectMode>("rest");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Refs for cleanup of pinned highlight observers.
  const pinnedResizeObserverRef = useRef<ResizeObserver | null>(null);
  const pinnedScrollHandlerRef = useRef<(() => void) | null>(null);
  const pinnedElementRef = useRef<HTMLElement | null>(null);

  /**
   * Update the position of the pinned highlight to match the element's bounding rect.
   * Called by ResizeObserver and scroll listener while in "inspecting" state.
   * L06: imperative DOM operation, no React state.
   */
  const updatePinnedHighlightPosition = useCallback(() => {
    const ctrl = scanCtrlRef.current;
    const el = pinnedElementRef.current;
    if (!ctrl || !el) return;

    const rect = el.getBoundingClientRect();
    ctrl.highlightEl.style.top = `${rect.top}px`;
    ctrl.highlightEl.style.left = `${rect.left}px`;
    ctrl.highlightEl.style.width = `${rect.width}px`;
    ctrl.highlightEl.style.height = `${rect.height}px`;
  }, []);

  /**
   * Remove pinned highlight from DOM and clean up observers.
   * L06: imperative DOM operation.
   */
  const removePinnedHighlight = useCallback(() => {
    const ctrl = scanCtrlRef.current;
    if (!ctrl) return;

    // Clean up ResizeObserver
    if (pinnedResizeObserverRef.current) {
      pinnedResizeObserverRef.current.disconnect();
      pinnedResizeObserverRef.current = null;
    }

    // Clean up scroll listener
    if (pinnedScrollHandlerRef.current) {
      window.removeEventListener("scroll", pinnedScrollHandlerRef.current, true);
      pinnedScrollHandlerRef.current = null;
    }

    pinnedElementRef.current = null;

    // Remove highlight from DOM and clear its classes
    if (ctrl.highlightEl.parentNode) {
      ctrl.highlightEl.parentNode.removeChild(ctrl.highlightEl);
    }
    ctrl.highlightEl.style.display = "none";
    ctrl.highlightEl.classList.remove("tug-inspector-highlight--pinned");
  }, []);

  /**
   * Pin the highlight rect on the selected element and set up position observers.
   * Called after Scanning → Inspecting transition.
   * L06: imperative DOM operation.
   */
  const pinHighlightOnElement = useCallback((el: HTMLElement) => {
    const ctrl = scanCtrlRef.current;
    if (!ctrl) return;

    pinnedElementRef.current = el;

    // Switch to pinned visual style
    ctrl.highlightEl.classList.add("tug-inspector-highlight--pinned");

    // Update position immediately
    const rect = el.getBoundingClientRect();
    ctrl.highlightEl.style.top = `${rect.top}px`;
    ctrl.highlightEl.style.left = `${rect.left}px`;
    ctrl.highlightEl.style.width = `${rect.width}px`;
    ctrl.highlightEl.style.height = `${rect.height}px`;
    ctrl.highlightEl.style.display = "";

    // Observe the element for size changes
    const resizeObs = new ResizeObserver(() => {
      updatePinnedHighlightPosition();
    });
    resizeObs.observe(el);
    pinnedResizeObserverRef.current = resizeObs;

    // Observe scroll events to reposition on scroll
    const scrollHandler = () => {
      updatePinnedHighlightPosition();
    };
    window.addEventListener("scroll", scrollHandler, true);
    pinnedScrollHandlerRef.current = scrollHandler;
  }, [updatePinnedHighlightPosition]);

  const handleElementSelected = useCallback((el: HTMLElement) => {
    // Transition: Scanning → Inspecting
    modeRef.current = "inspecting";
    if (containerRef.current) {
      containerRef.current.setAttribute("data-inspect-mode", "inspecting");
    }

    // Pin the highlight on the selected element (highlight is still in DOM
    // because ScanModeController.deactivate({ keepHighlight: true }) was called
    // from _handleClick before invoking this callback).
    pinHighlightOnElement(el);

    const computed = getComputedStyle(el);
    const bgColor = computed.getPropertyValue("background-color").trim();
    const fgColor = computed.getPropertyValue("color").trim();
    const borderColor = computed.getPropertyValue("border-color").trim();

    const domPath = buildDomPath(el);
    const bgChain = resolveTokenChainForProperty(el, "background-color", bgColor);
    const fgChain = resolveTokenChainForProperty(el, "color", fgColor);
    const borderChain = resolveTokenChainForProperty(el, "border-color", borderColor);

    const zoom = getTugZoom();
    const timing = getTugTiming();
    const motionOn = isTugMotionEnabled();

    // Initial render with current formulasData (may be null)
    inspectionDataRef.current = {
      el,
      domPath,
      bgColor,
      fgColor,
      borderColor,
      bgChain,
      fgChain,
      borderChain,
      zoom,
      timing,
      motionOn,
      formulasData: null,
      allStateFormulas: null,
    };
    setRenderKey((k) => k + 1);

    // Async fetch of formulas data; re-render if target hasn't changed
    const targetEl = el;
    fetchFormulasData().then((data) => {
      if (inspectionDataRef.current && inspectionDataRef.current.el === targetEl) {
        let allStateFormulas: Map<string, FormulaRow[]> | null = null;
        if (data) {
          const reverseMap = getReverseMap();
          const tugProps = collectElementTugProperties(targetEl);
          allStateFormulas = buildAllStateFormulaRows(tugProps, data, reverseMap);
        }
        inspectionDataRef.current = {
          ...inspectionDataRef.current,
          formulasData: data,
          allStateFormulas,
        };
        setRenderKey((k) => k + 1);
      }
    }).catch(() => {});
  }, [pinHighlightOnElement]);

  const handleInspectButtonClick = useCallback(() => {
    const ctrl = scanCtrlRef.current;
    if (!ctrl) return;

    const currentMode = modeRef.current;

    if (currentMode === "rest") {
      // Rest → Scanning
      modeRef.current = "scanning";
      if (containerRef.current) {
        containerRef.current.setAttribute("data-inspect-mode", "scanning");
      }
      ctrl.activate(handleElementSelected, {
        onCancel: () => {
          // Escape was pressed during scanning — return to rest state
          // (same cleanup as clicking "Cancel Inspection")
          modeRef.current = "rest";
          if (containerRef.current) {
            containerRef.current.removeAttribute("data-inspect-mode");
          }
          setRenderKey((k) => k + 1);
        },
      });
    } else if (currentMode === "scanning") {
      // Scanning → Rest (cancel)
      ctrl.deactivate(); // removes overlay AND highlight
      modeRef.current = "rest";
      if (containerRef.current) {
        containerRef.current.removeAttribute("data-inspect-mode");
      }
    } else if (currentMode === "inspecting") {
      // Inspecting → Rest (done)
      removePinnedHighlight();
      inspectionDataRef.current = null;
      modeRef.current = "rest";
      if (containerRef.current) {
        containerRef.current.removeAttribute("data-inspect-mode");
      }
    }

    setRenderKey((k) => k + 1);
  }, [handleElementSelected, removePinnedHighlight]);

  // Cleanup pinned highlight and observers when component unmounts.
  useEffect(() => {
    return () => {
      const ctrl = scanCtrlRef.current;
      if (ctrl && ctrl.isActive) {
        ctrl.deactivate();
      }
      removePinnedHighlight();
    };
  }, [removePinnedHighlight]);

  // Listen for 'toggle-scan' events on the styleInspectorBus (L03: useLayoutEffect
  // for registrations that events depend on).
  //
  // Behavior by current mode:
  //   rest      → start scanning (same as clicking Inspect Element)
  //   scanning  → cancel scanning (same as clicking Cancel Inspection / Escape)
  //   inspecting → go to rest first (clear inspection); user can press again to scan
  useLayoutEffect(() => {
    const handleToggleScan = () => {
      const ctrl = scanCtrlRef.current;
      if (!ctrl) return;

      const currentMode = modeRef.current;

      if (currentMode === "rest") {
        // Rest → Scanning
        modeRef.current = "scanning";
        if (containerRef.current) {
          containerRef.current.setAttribute("data-inspect-mode", "scanning");
        }
        ctrl.activate(handleElementSelected, {
          onCancel: () => {
            modeRef.current = "rest";
            if (containerRef.current) {
              containerRef.current.removeAttribute("data-inspect-mode");
            }
            setRenderKey((k) => k + 1);
          },
        });
      } else if (currentMode === "scanning") {
        // Scanning → Rest (cancel)
        ctrl.deactivate();
        modeRef.current = "rest";
        if (containerRef.current) {
          containerRef.current.removeAttribute("data-inspect-mode");
        }
      } else if (currentMode === "inspecting") {
        // Inspecting → Rest (clear inspection; user must press again to scan)
        removePinnedHighlight();
        inspectionDataRef.current = null;
        modeRef.current = "rest";
        if (containerRef.current) {
          containerRef.current.removeAttribute("data-inspect-mode");
        }
      }

      setRenderKey((k) => k + 1);
    };

    styleInspectorBus.on("toggle-scan", handleToggleScan);
    return () => {
      styleInspectorBus.off("toggle-scan", handleToggleScan);
    };
  }, [handleElementSelected, removePinnedHighlight]);

  // Listen for 'formulas-updated' events on the styleInspectorBus.
  //
  // Dispatched by module-level HMR listeners (tug:formulas-updated and vite:afterUpdate)
  // after a recipe or theme file changes. Re-fetches formulas and re-groups properties.
  //
  // L03: useLayoutEffect for registrations that events depend on.
  // [D04] HMR listener for re-fetch, Spec S04 (#s04-hmr-refetch)
  useLayoutEffect(() => {
    const handleFormulasUpdated = () => {
      const currentData = inspectionDataRef.current;
      if (!currentData) return;
      const targetEl = currentData.el;

      fetchFormulasData().then((data) => {
        if (
          !data ||
          !inspectionDataRef.current ||
          inspectionDataRef.current.el !== targetEl
        ) {
          return;
        }
        const reverseMap = getReverseMap();
        const tugProps = collectElementTugProperties(targetEl);
        const allStateFormulas = buildAllStateFormulaRows(tugProps, data, reverseMap);
        inspectionDataRef.current = {
          ...inspectionDataRef.current,
          formulasData: data,
          allStateFormulas,
        };
        setRenderKey((k) => k + 1);
      }).catch(() => {});
    };

    styleInspectorBus.on("formulas-updated", handleFormulasUpdated);
    return () => {
      styleInspectorBus.off("formulas-updated", handleFormulasUpdated);
    };
  }, []);

  const data = inspectionDataRef.current;
  const mode = modeRef.current;

  // Button label by mode
  const buttonLabel =
    mode === "scanning" ? "Cancel Inspection" :
    mode === "inspecting" ? "Done Inspecting" :
    "Inspect Element";

  // Button emphasis/role by mode -- subtle in rest/inspecting, outlined in scanning
  const buttonEmphasis = mode === "scanning" ? "outlined" : "ghost";
  const buttonRole = "action";

  // Hint text shown contextually by state
  const hintText =
    mode === "rest" ? "Option-Command-E to scan" :
    mode === "scanning" ? "Esc to cancel" :
    "";

  // aria-pressed reflects active scanning/inspecting state
  const ariaPressed = mode !== "rest";

  // Suppress unused variable warning for cardId (required by contentFactory signature)
  void cardId;

  return (
    <div
      ref={containerRef}
      className="si-card-content"
      data-testid="style-inspector-content"
    >
      {/* Toolbar with inspect button and hint text */}
      <div className="si-card-toolbar">
        <TugButton
          subtype="icon-text"
          emphasis={buttonEmphasis}
          role={buttonRole}
          size="sm"
          icon={<Crosshair size={13} aria-hidden="true" />}
          onClick={handleInspectButtonClick}
          title={
            mode === "scanning" ? "Cancel element inspection" :
            mode === "inspecting" ? "Done inspecting — clear selection" :
            "Inspect element (click to activate reticle mode)"
          }
          data-testid="style-inspector-reticle-button"
          aria-pressed={ariaPressed}
          aria-label={
            mode === "scanning" ? "Cancel element inspection" :
            mode === "inspecting" ? "Done inspecting" :
            "Inspect an element"
          }
        >
          {buttonLabel}
        </TugButton>
        {hintText && (
          <span className="si-card-hint" data-testid="style-inspector-hint">
            {hintText}
          </span>
        )}
      </div>

      {/* Content area */}
      <div className="si-card-body" data-render-key={renderKey}>
        {data === null ? (
          /* Empty state */
          <div className="si-card-empty-state" data-testid="style-inspector-empty-state">
            <p className="si-card-empty-state__message">
              Click &quot;Inspect Element&quot; or type Option-Command-E to inspect a UI element.
            </p>
          </div>
        ) : (
          <>
            {/* Element info */}
            <div className="tug-inspector-section">
              <div className="tug-inspector-section__title">Element</div>
              <div className="tug-inspector-row">
                <span className="tug-inspector-row__label">tag</span>
                <span className="tug-inspector-row__value">{data.el.tagName.toLowerCase()}</span>
              </div>
              {data.el.className && typeof data.el.className === "string" && (
                <div className="tug-inspector-row">
                  <span className="tug-inspector-row__label">classes</span>
                  <span className="tug-inspector-row__value">{data.el.className}</span>
                </div>
              )}
              <div className="tug-inspector-row">
                <span className="tug-inspector-row__label">path</span>
                <span className="tug-inspector-path">{data.domPath}</span>
              </div>
            </div>

            {/* Scale/timing readout */}
            <div className="tug-inspector-section">
              <div className="tug-inspector-section__title">Scale &amp; Timing</div>
              <div className="tug-inspector-readout">
                {([
                  ["zoom", data.zoom.toFixed(2)],
                  ["timing", data.timing.toFixed(2)],
                  ["motion", data.motionOn ? "on" : "off"],
                ] as Array<[string, string]>).map(([key, val]) => (
                  <div className="tug-inspector-readout__item" key={key}>
                    <span className="tug-inspector-readout__key">{key}:</span>
                    <span className="tug-inspector-readout__val">{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Token chain sections */}
            <ChainSection
              title="Background Color"
              computedValue={data.bgColor}
              result={data.bgChain}
              property="background-color"
            />
            <ChainSection
              title="Text Color"
              computedValue={data.fgColor}
              result={data.fgChain}
              property="color"
            />
            <ChainSection
              title="Border Color"
              computedValue={data.borderColor}
              result={data.borderChain}
              property="border-color"
            />

            {/* Formula provenance section — shows when allStateFormulas is populated */}
            {data.allStateFormulas !== null && (
              <FormulaSection
                allStateFormulas={data.allStateFormulas}
                sources={data.formulasData?.sources ?? {}}
                defaults={data.formulasData?.defaults ?? {}}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerStyleInspectorCard
// ---------------------------------------------------------------------------

/**
 * Register the Style Inspector card in the global card registry.
 *
 * Must be called before `DeckManager.addCard("style-inspector")` is invoked.
 * In `main.tsx`, call this during initialization alongside `registerHelloCard()`
 * and `registerGalleryCards()`.
 *
 * Spec S01 (#s01-card-registration)
 */
export function registerStyleInspectorCard(): void {
  registerCard({
    componentId: "style-inspector",
    contentFactory: (cardId) => <StyleInspectorContent cardId={cardId} />,
    defaultMeta: { title: "Style Inspector", icon: "Scan", closable: true },
    family: "developer",
    acceptsFamilies: ["developer"],
  });
}
