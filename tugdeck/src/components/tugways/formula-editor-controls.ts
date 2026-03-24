/**
 * formula-editor-controls.ts -- Interactive formula field controls for the style inspector.
 *
 * Provides DOM-based slider/input/dropdown/text controls for editing DerivationFormulas
 * fields directly from the style inspector panel. All controls are dev-only and gated
 * by process.env.NODE_ENV.
 *
 * Two-phase preview [D02]:
 *   - During drag: delta approximation applied directly to CSS custom properties on body
 *   - On release: POST final value to /__themes/formula, HMR delivers canonical values
 *
 * Control types per Table T01:
 *   - Tone: slider + number input (0-100, step 1)
 *   - Intensity: slider + number input (0-100, step 1)
 *   - Alpha: slider + number input (0-100, step 1)
 *   - HueSlot: dropdown with available slot names
 *   - HueExpression: text input for free-form strings
 *   - Boolean: read-only span (no interactive control)
 *
 * Spec S05 (#s05-drag-preview)
 * Table T01 (#t01-control-mapping)
 * [D02] Two-phase slider preview
 * [D04] Dev-only DOM
 *
 * @module components/tugways/formula-editor-controls
 */

import type { ReverseMap } from "./formula-reverse-map";
import type { FormulasData, FormulaRow } from "./style-inspector-overlay";

// ---------------------------------------------------------------------------
// HueSlot enum values — available options for HueSlot dropdowns
// ---------------------------------------------------------------------------

/**
 * All valid hue slot names that can be assigned to hue-slot-dispatch formula fields.
 * These match the keys of ResolvedHueSlots.
 * Table T01 (#t01-control-mapping)
 */
export const HUE_SLOT_OPTIONS: readonly string[] = [
  "text",
  "canvas",
  "frame",
  "card",
  "borderTint",
  "action",
  "accent",
  "control",
  "display",
  "informational",
  "decorative",
  "destructive",
  "success",
  "caution",
  "agent",
  "data",
  "canvasBase",
  "canvasScreen",
  "textMuted",
  "textSubtle",
  "textDisabled",
  "textInverse",
  "textPlaceholder",
  "selectionInactive",
  "borderBase",
  "borderStrong",
  // Sentinel hue slots
  "white",
  "highlight",
  "shadow",
  "highlightVerbose",
];

// ---------------------------------------------------------------------------
// OklchSnapshot -- delta approximation types
// ---------------------------------------------------------------------------

/**
 * A snapshot of an oklch color value's L, C, h, and optional alpha components.
 * Parsed from getComputedStyle values at drag-start time.
 * Spec S05 (#s05-drag-preview)
 */
interface OklchSnapshot {
  l: number;
  c: number;
  h: number;
  alpha: number | null;
}

/**
 * Drag context captured at pointerdown time. Holds everything needed to compute
 * delta approximations during pointermove and clean up on pointerup.
 * Spec S05 (#s05-drag-preview)
 */
interface DragContext {
  /** The field being dragged */
  field: string;
  /** The property type: "tone" | "intensity" | "alpha" */
  property: "tone" | "intensity" | "alpha";
  /** Slider value at drag-start */
  startValue: number;
  /** Snapshot of computed body oklch values, keyed by CSS property name (e.g. "--tug-*") */
  snapshots: Map<string, OklchSnapshot>;
  /** Tokens affected by this field (from fieldToTokens) */
  affectedTokens: string[];
  /** CSS property names that were successfully snapshotted */
  snappedProperties: string[];
}

// ---------------------------------------------------------------------------
// Oklch parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse an oklch() computed value string into its components.
 * Returns null if the value is not a recognizable oklch() form.
 *
 * Spec S05: getComputedStyle returns oklch values in the form:
 *   `oklch(L C h)` or `oklch(L C h / alpha)`
 * where L is 0-1, C is 0-0.4, h is 0-360, alpha is 0-1.
 */
function parseOklch(value: string): OklchSnapshot | null {
  const m = /oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)/.exec(value);
  if (!m) return null;
  return {
    l: parseFloat(m[1]),
    c: parseFloat(m[2]),
    h: parseFloat(m[3]),
    alpha: m[4] != null ? parseFloat(m[4]) : null,
  };
}

/**
 * Serialize an OklchSnapshot back to an oklch() CSS string.
 */
function serializeOklch(snap: OklchSnapshot): string {
  const alpha = snap.alpha != null ? ` / ${snap.alpha.toFixed(4)}` : "";
  return `oklch(${snap.l.toFixed(4)} ${snap.c.toFixed(4)} ${snap.h.toFixed(2)}${alpha})`;
}

// ---------------------------------------------------------------------------
// handleFormulaDrag -- Spec S05
// ---------------------------------------------------------------------------

let _activeDragContext: DragContext | null = null;

/**
 * Snapshot oklch values for all CSS tokens affected by the given formula field.
 * Returns a Map of token name -> OklchSnapshot for tokens that have valid oklch values.
 *
 * Tokens whose computed value is not an oklch form (StructuralRule non-color tokens)
 * are silently skipped — they will be updated on release only.
 *
 * Spec S05 step 1-2.
 */
function snapshotAffectedTokens(
  field: string,
  reverseMap: ReverseMap,
): { snapshots: Map<string, OklchSnapshot>; affectedTokens: string[]; snappedProperties: string[] } {
  const snapshots = new Map<string, OklchSnapshot>();
  const snappedProperties: string[] = [];

  const mappings = reverseMap.fieldToTokens.get(field) ?? [];
  const affectedTokens = mappings.map((m) => m.token);

  const bodyStyle = getComputedStyle(document.body);

  for (const token of affectedTokens) {
    // CSS custom property names use -- prefix
    const cssVar = `--tug-${token}`;
    const rawValue = bodyStyle.getPropertyValue(cssVar).trim();
    if (!rawValue) continue;

    const snap = parseOklch(rawValue);
    if (snap) {
      snapshots.set(cssVar, snap);
      snappedProperties.push(cssVar);
    }
  }

  return { snapshots, affectedTokens, snappedProperties };
}

/**
 * Handle drag-start for a formula slider.
 *
 * Called on pointerdown on a slider input element. Captures the drag context
 * (start value, affected token snapshots) and attaches pointermove/pointerup
 * handlers to the slider element.
 *
 * When dragCommitCallback is provided, it is called on pointerup with the final value.
 * This allows the caller to POST the value to the write-back endpoint.
 *
 * Spec S05 (#s05-drag-preview)
 * [D02] Two-phase slider preview
 *
 * @param slider - The range input element that was pressed
 * @param field - The DerivationFormulas field name
 * @param property - The property type ("tone" | "intensity" | "alpha")
 * @param reverseMap - The reverse map for looking up affected tokens
 * @param dragCommitCallback - Called on pointerup with the final value
 */
export function handleFormulaDrag(
  slider: HTMLInputElement,
  field: string,
  property: "tone" | "intensity" | "alpha",
  reverseMap: ReverseMap,
  dragCommitCallback: (field: string, value: number) => void,
): void {
  const startValue = parseFloat(slider.value);
  const { snapshots, affectedTokens, snappedProperties } = snapshotAffectedTokens(field, reverseMap);

  _activeDragContext = {
    field,
    property,
    startValue,
    snapshots,
    affectedTokens,
    snappedProperties,
  };

  function onPointerMove() {
    if (!_activeDragContext) return;
    const currentValue = parseFloat(slider.value);
    const delta = currentValue - _activeDragContext.startValue;

    for (const cssVar of _activeDragContext.snappedProperties) {
      const snap = _activeDragContext.snapshots.get(cssVar);
      if (!snap) continue;

      const updated = { ...snap };
      if (_activeDragContext.property === "tone") {
        // L channel: oklch L is 0-1, tone is 0-100; delta / 100 maps tone delta to L delta
        updated.l = Math.max(0, Math.min(1, snap.l + delta / 100));
      } else if (_activeDragContext.property === "intensity") {
        // C channel: oklch C is 0-0.4, intensity is 0-100; delta * 0.004 maps intensity delta to C delta
        updated.c = Math.max(0, Math.min(0.4, snap.c + delta * 0.004));
      } else if (_activeDragContext.property === "alpha") {
        // alpha: oklch alpha is 0-1, field is 0-100
        const newAlpha = snap.alpha != null
          ? Math.max(0, Math.min(1, snap.alpha + delta / 100))
          : Math.max(0, Math.min(1, delta / 100));
        updated.alpha = newAlpha;
      }

      document.body.style.setProperty(cssVar, serializeOklch(updated));
    }
  }

  function onPointerUp() {
    slider.removeEventListener("pointermove", onPointerMove);
    slider.removeEventListener("pointerup", onPointerUp);
    slider.releasePointerCapture && slider.releasePointerCapture(0);

    // Remove temporary style overrides
    if (_activeDragContext) {
      for (const cssVar of _activeDragContext.snappedProperties) {
        document.body.style.removeProperty(cssVar);
      }
    }

    _activeDragContext = null;

    // POST final value via commit callback
    const finalValue = parseFloat(slider.value);
    dragCommitCallback(field, finalValue);
  }

  slider.addEventListener("pointermove", onPointerMove);
  slider.addEventListener("pointerup", onPointerUp);
}

// ---------------------------------------------------------------------------
// handleFormulaCommit
// ---------------------------------------------------------------------------

/**
 * POST a formula field update to the write-back endpoint.
 *
 * Returns the response JSON on success (200), or null on network/server error.
 * The endpoint returns 400 with an error for invalid fields.
 *
 * Spec S04 (#s04-formula-write)
 * [D03] Literal replacement, not expression editing
 */
export async function handleFormulaCommit(
  field: string,
  value: number | string,
  onSuccess?: (response: FormulaCommitResponse) => void,
  onError?: (error: string) => void,
): Promise<void> {
  try {
    const response = await fetch("/__themes/formula", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });

    if (response.ok) {
      const data = (await response.json()) as FormulaCommitResponse;
      onSuccess?.(data);
    } else {
      const data = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { error: string };
      onError?.(data.error ?? `HTTP ${response.status}`);
    }
  } catch (err) {
    onError?.(`Network error: ${String(err)}`);
  }
}

/** Response shape from POST /__themes/formula (success). */
export interface FormulaCommitResponse {
  ok: true;
  file: string;
  field: string;
  oldValue: string;
  newValue: string;
  couplingWarning?: string;
}

// ---------------------------------------------------------------------------
// createFormulaControls -- Table T01
// ---------------------------------------------------------------------------

/**
 * Options for createFormulaControls.
 */
export interface FormulaControlsOptions {
  /** The reverse map for drag preview token lookup. */
  reverseMap: ReverseMap;
  /** Called after a successful commit (POST + GET refresh). Receives updated formulas. */
  onRefresh: (updatedFormulas: FormulasData) => void;
}

/**
 * Create interactive DOM controls for a formula field row.
 *
 * Returns a container element with the appropriate control per Table T01:
 *   - Tone/Intensity/Alpha: slider + number input
 *   - HueSlot: dropdown
 *   - HueExpression: text input
 *   - Boolean: read-only span
 *
 * All controls call handleFormulaCommit on change/release, then refresh the
 * formula display by fetching GET /__themes/formulas.
 *
 * Dev-only; must not be called in production.
 * Table T01 (#t01-control-mapping)
 * [D04] Dev-only DOM
 *
 * @param row - The formula row data (field name, current value, property type)
 * @param options - Reverse map and refresh callback
 */
export function createFormulaControls(
  row: FormulaRow,
  options: FormulaControlsOptions,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "tug-formula-control";

  // Field name label
  const fieldLabel = document.createElement("span");
  fieldLabel.className = "tug-formula-control__field";
  fieldLabel.textContent = row.field;
  container.appendChild(fieldLabel);

  // Dispatch on property type
  if (typeof row.value === "boolean") {
    // Boolean: read-only span (OF1, OQ1)
    const readonlySpan = document.createElement("span");
    readonlySpan.className = "tug-formula-control__readonly";
    readonlySpan.textContent = String(row.value);
    container.appendChild(readonlySpan);
    return container;
  }

  if (row.property === "hueSlot") {
    // HueSlot: dropdown
    const select = buildHueSlotDropdown(row, options);
    container.appendChild(select);
  } else if (
    row.property === "tone" ||
    row.property === "intensity" ||
    row.property === "alpha"
  ) {
    // Tone/Intensity/Alpha: slider + number input
    if (typeof row.value === "number") {
      const sliderGroup = buildSliderGroup(row as FormulaRow & { value: number; property: "tone" | "intensity" | "alpha" }, options);
      container.appendChild(sliderGroup);
    } else {
      // String value for a tone/intensity/alpha field (unusual): text input fallback
      const textInput = buildTextInput(row, options);
      container.appendChild(textInput);
    }
  } else {
    // HueExpression or other string field: text input (OF2)
    const textInput = buildTextInput(row, options);
    container.appendChild(textInput);
  }

  // Structural note
  if (row.isStructural) {
    const note = document.createElement("span");
    note.className = "tug-formula-control__structural-note";
    note.textContent = "(applies on release)";
    container.appendChild(note);
  }

  return container;
}

// ---------------------------------------------------------------------------
// Control builders (internal helpers)
// ---------------------------------------------------------------------------

/**
 * Build a slider + number input pair for tone/intensity/alpha fields.
 * Slider triggers drag preview; number input triggers commit on change.
 */
function buildSliderGroup(
  row: FormulaRow & { value: number; property: "tone" | "intensity" | "alpha" },
  options: FormulaControlsOptions,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "tug-formula-control__slider-group";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.value = String(Math.round(row.value));
  slider.className = "tug-formula-control__slider";

  const numInput = document.createElement("input");
  numInput.type = "number";
  numInput.min = "0";
  numInput.max = "100";
  numInput.step = "1";
  numInput.value = String(Math.round(row.value));
  numInput.className = "tug-formula-control__number";

  // Drag preview on slider
  slider.addEventListener("pointerdown", () => {
    handleFormulaDrag(
      slider,
      row.field,
      row.property,
      options.reverseMap,
      (field, value) => {
        // Update number input to show final value
        numInput.value = String(value);
        // POST and refresh
        void handleFormulaCommit(field, value, async () => {
          await refreshFormulasDisplay(options.onRefresh);
        });
      },
    );
  });

  // Number input: commit on Enter or blur
  function commitFromNumber() {
    const value = parseFloat(numInput.value);
    if (isNaN(value)) return;
    const clamped = Math.max(0, Math.min(100, value));
    numInput.value = String(clamped);
    slider.value = String(clamped);
    void handleFormulaCommit(row.field, clamped, async () => {
      await refreshFormulasDisplay(options.onRefresh);
    });
  }

  numInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") commitFromNumber();
  });
  numInput.addEventListener("blur", commitFromNumber);

  // Keep slider and number input in sync (no commit during slider input — handled by drag)
  slider.addEventListener("input", () => {
    numInput.value = slider.value;
  });

  group.appendChild(slider);
  group.appendChild(numInput);
  return group;
}

/**
 * Build a select dropdown for HueSlot fields.
 */
function buildHueSlotDropdown(
  row: FormulaRow,
  options: FormulaControlsOptions,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "tug-formula-control__select";

  const currentStr = String(row.value);

  // If current value is not in the standard list, add it first
  if (!HUE_SLOT_OPTIONS.includes(currentStr)) {
    const opt = document.createElement("option");
    opt.value = currentStr;
    opt.textContent = currentStr;
    select.appendChild(opt);
  }

  for (const slotName of HUE_SLOT_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = slotName;
    opt.textContent = slotName;
    select.appendChild(opt);
  }

  // Set selected value after all options are added
  select.value = currentStr;

  select.addEventListener("change", () => {
    const value = select.value;
    void handleFormulaCommit(row.field, value, async () => {
      await refreshFormulasDisplay(options.onRefresh);
    });
  });

  return select;
}

/**
 * Build a text input for HueExpression or other string fields (OF2).
 */
function buildTextInput(
  row: FormulaRow,
  options: FormulaControlsOptions,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = String(row.value);
  input.className = "tug-formula-control__text";

  function commitFromText() {
    const value = input.value.trim();
    if (!value) return;
    void handleFormulaCommit(row.field, value, async () => {
      await refreshFormulasDisplay(options.onRefresh);
    });
  }

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") commitFromText();
  });
  input.addEventListener("blur", commitFromText);

  return input;
}

// ---------------------------------------------------------------------------
// Post-commit refresh
// ---------------------------------------------------------------------------

/**
 * Fetch updated formulas from GET /__themes/formulas and call the refresh callback.
 * Handles cascading changes by re-fetching after each commit.
 *
 * Step 5 task: After successful POST, fetch updated formulas and refresh controls.
 */
async function refreshFormulasDisplay(
  onRefresh: (data: FormulasData) => void,
): Promise<void> {
  try {
    const response = await fetch("/__themes/formulas");
    if (response.ok) {
      const data = (await response.json()) as FormulasData;
      onRefresh(data);
    }
  } catch {
    // Refresh failed — controls keep their current values
  }
}
