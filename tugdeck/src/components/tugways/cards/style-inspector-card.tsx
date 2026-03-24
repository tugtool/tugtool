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

import React, { useRef, useState, useCallback, useEffect } from "react";
import { Crosshair } from "lucide-react";
import { TugButton } from "@/components/tugways/tug-button";
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
    ctrl.highlightEl.classList.remove("tug-inspector-highlight--scan-suppressed");
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
    ctrl.highlightEl.classList.remove("tug-inspector-highlight--scan-suppressed");
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

  const data = inspectionDataRef.current;
  const mode = modeRef.current;

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

  // Button label by mode
  const buttonLabel =
    mode === "scanning" ? "Cancel Inspection" :
    mode === "inspecting" ? "Done Inspecting" :
    "Inspect Element";

  // Button emphasis/role by mode -- subtle in rest/inspecting, outlined in scanning
  const buttonEmphasis = mode === "scanning" ? "outlined" : "ghost";
  const buttonRole = "action";

  // Hint text shown only during scanning state
  const hintText =
    mode === "scanning"
      ? "click to inspect \u00B7 Cmd-click normal \u00B7 Opt no hover"
      : "";

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
              Click &quot;Inspect Element&quot; to inspect a UI element.
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
