/**
 * style-inspector-card.tsx -- StyleInspectorContent card component and registration.
 *
 * Renders the style inspector as a proper card in the developer card family.
 * Content includes:
 *   - Reticle button to activate ScanModeController for element selection
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
 * **Authoritative references:**
 *   Spec S01 (#s01-card-registration)
 *   Spec S04 (#s04-data-flow)
 *   (#component-data-flow, #new-files, #strategy)
 *
 * @module components/tugways/cards/style-inspector-card
 */

import React, { useRef, useState, useCallback } from "react";
import { ScanModeController } from "@/components/tugways/scan-mode-controller";
import {
  resolveTokenChainForProperty,
  fetchFormulasData,
  buildFormulaRows,
  extractTugColorProvenance,
  buildDomPath,
  shortenNumbers,
  tryFormatTugColor,
  getReverseMap,
} from "@/components/tugways/style-inspector-overlay";
import { getTugZoom, getTugTiming, isTugMotionEnabled } from "@/components/tugways/scale-timing";
import { registerCard } from "@/card-registry";
import type { TokenChainResult, FormulaRow, FormulasData } from "@/components/tugways/style-inspector-overlay";
import "./style-inspector-card.css";

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
}

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
 * FormulaSection renders formula rows.
 * Ports the DOM structure from `createFormulaSection`.
 */
function FormulaSection({ rows }: { rows: FormulaRow[] }) {
  const isConstant = rows.length === 0;

  return (
    <div className="tug-inspector-section">
      <div className="tug-inspector-section__title">Formula</div>
      {isConstant ? (
        <div className="tug-inspector-row">
          <span className="tug-inspector-row__value tug-inspector-row__value--dim">(constant)</span>
        </div>
      ) : (
        rows.map((row) => (
          <div className="tug-inspector-formula-field" key={row.field}>
            <span className="tug-inspector-formula-field__name">{row.field}</span>
            <span className="tug-inspector-row__value--dim"> = </span>
            <span className="tug-inspector-formula-field__value">{String(row.value)}</span>
            <span className="tug-inspector-formula-field__type">{row.property}</span>
            {row.isStructural && (
              <span className="tug-inspector-formula__release-label">(applies on release)</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StyleInspectorContent
// ---------------------------------------------------------------------------

/**
 * StyleInspectorContent -- main card content component.
 *
 * Renders the reticle button, DOM path, token chain sections, formula
 * provenance, and scale/timing readout for the selected element.
 *
 * Spec S04 (#s04-data-flow):
 *   - `inspectionDataRef` holds the latest inspection results
 *   - `renderKey` is bumped to trigger re-render after async data arrives
 *   - Scan mode is managed imperatively via `ScanModeController` (L06)
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

  // Whether scan mode is currently active (for button visual state, L06: CSS-only toggle via data attr).
  const scanActiveRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleElementSelected = useCallback((el: HTMLElement) => {
    scanActiveRef.current = false;
    if (containerRef.current) {
      containerRef.current.removeAttribute("data-scan-active");
    }

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
    };
    setRenderKey((k) => k + 1);

    // Async fetch of formulas data; re-render if target hasn't changed
    const targetEl = el;
    fetchFormulasData().then((data) => {
      if (inspectionDataRef.current && inspectionDataRef.current.el === targetEl) {
        inspectionDataRef.current = {
          ...inspectionDataRef.current,
          formulasData: data,
        };
        setRenderKey((k) => k + 1);
      }
    }).catch(() => {});
  }, []);

  const handleReticleClick = useCallback(() => {
    const ctrl = scanCtrlRef.current;
    if (!ctrl) return;

    if (ctrl.isActive) {
      ctrl.deactivate();
      scanActiveRef.current = false;
      if (containerRef.current) {
        containerRef.current.removeAttribute("data-scan-active");
      }
    } else {
      ctrl.activate(handleElementSelected);
      scanActiveRef.current = true;
      if (containerRef.current) {
        containerRef.current.setAttribute("data-scan-active", "true");
      }
    }
    // Bump render key to update button appearance
    setRenderKey((k) => k + 1);
  }, [handleElementSelected]);

  const data = inspectionDataRef.current;

  // Build formula rows if formulasData is available
  let formulaRows: FormulaRow[] | null = null;
  if (data && data.formulasData) {
    const reverseMap = getReverseMap();
    formulaRows = buildFormulaRows(
      data.bgChain,
      data.fgChain,
      data.borderChain,
      data.formulasData,
      reverseMap
    );
  }

  const isScanActive = scanCtrlRef.current?.isActive ?? false;

  // Suppress unused variable warning for cardId (required by contentFactory signature)
  void cardId;

  return (
    <div
      ref={containerRef}
      className="si-card-content"
      data-testid="style-inspector-content"
    >
      {/* Toolbar with reticle button */}
      <div className="si-card-toolbar">
        <button
          className={`si-card-reticle-button${isScanActive ? " si-card-reticle-button--active" : ""}`}
          onClick={handleReticleClick}
          title="Scan element (click to activate reticle mode)"
          data-testid="style-inspector-reticle-button"
          aria-pressed={isScanActive}
          aria-label="Toggle element scan mode"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="7" cy="7" r="2" fill="currentColor" />
            <line x1="7" y1="0" x2="7" y2="3" stroke="currentColor" strokeWidth="1.2" />
            <line x1="7" y1="11" x2="7" y2="14" stroke="currentColor" strokeWidth="1.2" />
            <line x1="0" y1="7" x2="3" y2="7" stroke="currentColor" strokeWidth="1.2" />
            <line x1="11" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span>{isScanActive ? "Cancel Scan" : "Scan Element"}</span>
        </button>
      </div>

      {/* Content area */}
      <div className="si-card-body" data-render-key={renderKey}>
        {data === null ? (
          /* Empty state */
          <div className="si-card-empty-state" data-testid="style-inspector-empty-state">
            <p className="si-card-empty-state__message">
              Click "Scan Element" to inspect a UI element.
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

            {/* Formula provenance section */}
            {formulaRows !== null && (
              <FormulaSection rows={formulaRows} />
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
