/**
 * style-inspector-overlay.ts -- StyleInspectorOverlay singleton.
 *
 * A dev-only Shift+Option+hover cascade inspector overlay that shows the full
 * token resolution chain (component tokens, base tokens, palette variables,
 * TugColor provenance) and scale/timing readout for any inspected element.
 *
 * Design decisions:
 *   [D01] Pure TypeScript singleton -- no React involvement. DOM manipulation only,
 *         no root.render() calls. Follows the MutationTransactionManager pattern.
 *   [D02] Dev-only gating via NODE_ENV. All inspector initialization is wrapped in
 *         process.env.NODE_ENV !== 'production'. The initStyleInspector() export
 *         is a no-op in production builds, enabling dead-code elimination by Vite.
 *   [D03] Direct element inspection via elementFromPoint with no walk-up to
 *         component root for the actual inspection target.
 *   [D05] Pin/unpin: clicking pins the overlay; Escape always closes.
 *
 * **Authoritative references:**
 *   Spec S01 (#s01-inspector-singleton)
 *   Spec S02 (#s02-token-chain-algorithm)
 *   Spec S03 (#s03-inspected-properties)
 *   Spec S04 (#s04-tug-color-provenance)
 *   Spec S05 (#s05-scale-timing-readout)
 *
 * @module components/tugways/style-inspector-overlay
 */

import "./style-inspector-overlay.css";
import { getTugZoom, getTugTiming, isTugMotionEnabled } from "./scale-timing";
import { oklchToTugColor } from "./palette-engine";
import { buildReverseMap, type ReverseMap } from "./formula-reverse-map";
import { RULES } from "./theme-rules";
import { createFormulaControls, type FormulaControlsOptions } from "./formula-editor-controls";

// ---------------------------------------------------------------------------
// PALETTE_VAR_REGEX -- matches only known hue palette variables
// ---------------------------------------------------------------------------

/**
 * Regex that matches palette variable names for the 24 known hue families,
 * with optional preset suffix (intense, muted, light, dark).
 *
 * Deliberately anchored to the full token name (^...$) to avoid false-matching
 * global constants like `--tug-l-dark` or per-hue internals like
 * `--tug-orange-canonical-l`.
 *
 * Spec S02 (#s02-token-chain-algorithm)
 */
export const PALETTE_VAR_REGEX =
  /^--tug-(cherry|red|tomato|flame|orange|amber|gold|yellow|lime|green|mint|teal|cyan|sky|blue|cobalt|violet|purple|plum|pink|rose|magenta|berry|coral)(-(intense|muted|light|dark))?$/;

// ---------------------------------------------------------------------------
// Token chain types
// ---------------------------------------------------------------------------

/** A single hop in a resolved token chain. */
export interface TokenChainHop {
  property: string;
  value: string;
}

/** The full result of resolving a token chain for one CSS property. */
export interface TokenChainResult {
  /** The starting token name, if one was identified. */
  originToken: string | null;
  /** Whether origin was found via a comp token, base token, or not found. */
  originLayer: "comp" | "base" | "none";
  /** The sequence of chain hops, from origin to terminal. */
  chain: TokenChainHop[];
  /** Whether the chain terminated at a palette variable. */
  endsAtPalette: boolean;
  /** The palette variable name if endsAtPalette is true. */
  paletteVar: string | null;
  /** The raw terminal value (last chain hop value). */
  terminalValue: string | null;
  /** Whether heuristic fallback was used (R01 mitigation). */
  usedHeuristic: boolean;
}

/** TugColor provenance data for a palette variable. */
export interface TugColorProvenance {
  hue: string;
  preset: string;
  canonicalL: string;
  peakC: string;
  hueAngle: string;
}

/**
 * Formula data fetched from GET /__themes/formulas.
 * Used by the formula provenance section in the inspector panel.
 *
 * Step 3 — formula provenance display [D04]
 */
export interface FormulasData {
  /** Current formula field values keyed by field name. */
  formulas: Record<string, number | string | boolean>;
  /** Theme mode: "dark" | "light" */
  mode: string;
  /** Theme name */
  themeName: string;
}

/**
 * A formula row entry for display in the panel.
 * Each entry represents one formula field that affects the terminal token.
 */
export interface FormulaRow {
  /** Formula field name, e.g. "surfaceAppTone" */
  field: string;
  /** Current value of the field */
  value: number | string | boolean;
  /** Which property this field controls */
  property: "intensity" | "tone" | "alpha" | "hueSlot";
  /** Whether this field is a StructuralRule field (no drag preview) */
  isStructural: boolean;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** Round floating-point numbers in a CSS value string to 3 significant digits. */
function shortenNumbers(s: string): string {
  return s.replace(/\d+\.\d+/g, (m) => {
    const n = parseFloat(m);
    return n.toPrecision(3).replace(/\.?0+$/, "");
  });
}

// ---------------------------------------------------------------------------
// Component token families (Spec S03)
// ---------------------------------------------------------------------------

/**
 * Maps CSS class names to their component token family prefix.
 * Used by the token discovery strategy (Spec S03 step 1-2).
 */
const CLASS_TO_COMP_FAMILY: Record<string, string> = {
  "tug-tab-bar": "--tug-tab",
  "tug-tab": "--tug-tab",
  tugcard: "--tug-card",
  "tugcard-title-bar": "--tug-card",
  "tug-dropdown": "--tug-dropdown",
};

/**
 * Known component tokens for each family.
 * Derived from component CSS files for class-to-token mapping.
 * Spec S03 step 3.
 */
const COMP_FAMILY_TOKENS: Record<string, string[]> = {
  "--tug-tab": [
    "--tug-tab-bar-bg",
    "--tug-tab-bg-active",
    "--tug-tab-fg-active",
    "--tug-tab-underline-active",
    "--tug-tab-bg-rest",
    "--tug-tab-fg-rest",
    "--tug-tab-bg-hover",
  ],
  "--tug-card": [
    "--tug-card-bg",
    "--tug-card-border",
    "--tug-card-title-bar-bg-active",
    "--tug-card-title-bar-fg",
    "--tug-card-title-bar-divider",
    "--tug-card-shadow-active",
  ],
  "--tug-dropdown": [
    "--tug-dropdown-bg",
    "--tug-dropdown-border",
    "--tug-dropdown-item-fg",
    "--tug-dropdown-item-bg-hover",
    "--tug-dropdown-item-hover-fg",
    "--tug-dropdown-shadow",
  ],
};

/**
 * Well-known base tokens by CSS property category.
 * Used as fallback when no comp token match is found (Spec S03 step 4).
 */
const BASE_TOKEN_FALLBACKS: Record<string, string[]> = {
  "background-color": [
    "--tug-surface-global-primary-normal-default-rest",
    "--tug-surface-global-primary-normal-raised-rest",
    "--tug-surface-global-primary-normal-overlay-rest",
    "--tug-element-global-fill-normal-accent-rest",
    "--tug-element-global-fill-normal-accentCool-rest",
    "--tug-surface-control-primary-filled-accent-rest",
    "--tug-surface-control-primary-outlined-action-rest",
    "--tug-tab-bar-bg",
    "--tug-card-bg",
    "--tug-tab-active-bg",
    "--tug-tab-rest-bg",
  ],
  color: [
    "--tug-element-global-text-normal-default-rest",
    "--tug-element-global-text-normal-muted-rest",
    "--tug-element-global-text-normal-subtle-rest",
    "--tug-element-global-fill-normal-accent-rest",
    "--tug-element-control-text-filled-accent-rest",
    "--tug-element-control-text-outlined-action-rest",
    "--tug-tab-active-fg",
    "--tug-tab-rest-fg",
    "--tug-card-title-bar-fg",
  ],
  "border-color": [
    "--tug-element-global-border-normal-default-rest",
    "--tug-element-global-border-normal-muted-rest",
    "--tug-element-global-fill-normal-accent-rest",
    "--tug-tab-active-border",
    "--tug-tab-bar-border",
    "--tug-card-border",
  ],
};

// ---------------------------------------------------------------------------
// Formula section DOM builder — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Fetch current formula values from the dev server's formulas cache endpoint.
 * Returns null if the server returns a non-200 or the fetch fails.
 *
 * Step 3 — formula provenance display [D04]
 */
async function fetchFormulasData(): Promise<FormulasData | null> {
  try {
    const response = await fetch("/__themes/formulas");
    if (!response.ok) return null;
    return (await response.json()) as FormulasData;
  } catch {
    return null;
  }
}

/**
 * Format a formula field value for display.
 * Numbers are rounded to 3 significant figures; strings and booleans are shown as-is.
 */
function formatFieldValue(value: number | string | boolean): string {
  if (typeof value === "number") {
    return value.toPrecision(3).replace(/\.?0+$/, "");
  }
  return String(value);
}

/**
 * Build the "Formula Provenance" section DOM element for the inspector panel.
 *
 * Shows the formula fields that contribute to the terminal token's color/value.
 * For constant tokens (no formula fields), shows a "(constant)" indicator.
 * For StructuralRule fields, appends "(applies on release)" label.
 *
 * Exported for unit testing.
 *
 * Step 3 — formula provenance display [D04]
 *
 * @param rows - FormulaRow array derived from tokenToFields + formulas data
 * @param isConstant - True when the token has no formula fields (white/invariant rules)
 */
export function createFormulaSection(
  rows: FormulaRow[],
  isConstant: boolean,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "tug-inspector-section";

  const titleEl = document.createElement("div");
  titleEl.className = "tug-inspector-section__title";
  titleEl.textContent = "Formula";
  section.appendChild(titleEl);

  if (isConstant || rows.length === 0) {
    const row = document.createElement("div");
    row.className = "tug-inspector-row";
    const val = document.createElement("span");
    val.className = "tug-inspector-row__value tug-inspector-row__value--dim";
    val.textContent = "(constant)";
    row.appendChild(val);
    section.appendChild(row);
    return section;
  }

  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "tug-inspector-row";

    const fieldEl = document.createElement("span");
    fieldEl.className = "tug-inspector-formula__field";
    fieldEl.textContent = r.field;
    row.appendChild(fieldEl);

    const eqEl = document.createElement("span");
    eqEl.className = "tug-inspector-formula__eq";
    eqEl.textContent = "=";
    row.appendChild(eqEl);

    const valEl = document.createElement("span");
    valEl.className = "tug-inspector-formula__value";
    valEl.textContent = formatFieldValue(r.value);
    row.appendChild(valEl);

    const propEl = document.createElement("span");
    propEl.className = "tug-inspector-formula__prop";
    propEl.textContent = r.property;
    row.appendChild(propEl);

    if (r.isStructural) {
      const relEl = document.createElement("span");
      relEl.className = "tug-inspector-formula__release-label";
      relEl.textContent = "(applies on release)";
      row.appendChild(relEl);
    }

    section.appendChild(row);
  }

  return section;
}

// ---------------------------------------------------------------------------
// StyleInspectorOverlay class
// ---------------------------------------------------------------------------

/**
 * StyleInspectorOverlay -- singleton managing the full inspector lifecycle.
 *
 * Activated by holding Shift+Option (Mac). Tracks the element under the cursor
 * via elementFromPoint. Shows token chain resolution, TugColor provenance, and
 * scale/timing readout in a fixed-position panel.
 *
 * [D01] Pure TS singleton
 * Spec S01 (#s01-inspector-singleton)
 */
export class StyleInspectorOverlay {
  // ----- State -----

  /** Whether Shift+Option is currently held. */
  private active = false;

  /** Whether the overlay is pinned (clicked to lock). */
  private pinned = false;

  /** The element currently being inspected. */
  private currentTarget: Element | null = null;

  /** Cleanup function returned from init(). */
  private cleanupFn: (() => void) | null = null;

  /**
   * Reverse map cached for the session. Built once on first activation.
   * Step 3 — formula provenance [D01]
   */
  private reverseMap: ReverseMap | null = null;

  /**
   * Latest formula data fetched from /__themes/formulas.
   * Refreshed on each inspectElement call.
   * Step 3 — formula provenance [D04]
   */
  private formulasData: FormulasData | null = null;

  // ----- DOM Elements -----

  /** Absolutely-positioned highlight ring around the inspected element. */
  readonly highlightEl: HTMLDivElement;

  /** Fixed-position inspector panel. */
  readonly panelEl: HTMLDivElement;

  // ----- Getters for testability -----

  /** Whether the inspector is currently active (Shift+Option held). */
  get isActive(): boolean {
    return this.active;
  }

  /** Whether the inspector is currently pinned. */
  get isPinned(): boolean {
    return this.pinned;
  }

  // ----- Constructor -----

  constructor() {
    this.highlightEl = document.createElement("div");
    this.highlightEl.className = "tug-inspector-highlight";
    this.highlightEl.style.display = "none";

    this.panelEl = document.createElement("div");
    this.panelEl.className = "tug-inspector-panel";
    this.panelEl.style.display = "none";

    // Bind event handlers so we can remove them later
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onClick = this.onClick.bind(this);
  }

  // ----- Lifecycle -----

  /**
   * Initialize the inspector: create DOM elements, append to body, attach
   * event listeners on document.
   *
   * Spec S01 (#s01-inspector-singleton)
   */
  init(): () => void {
    document.body.appendChild(this.highlightEl);
    document.body.appendChild(this.panelEl);

    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("keyup", this.onKeyUp, true);
    document.addEventListener("pointermove", this.onPointerMove, true);
    document.addEventListener("click", this.onClick, true);

    this.cleanupFn = () => this.destroy();
    return this.cleanupFn;
  }

  /**
   * Remove event listeners and DOM elements. Resets all state.
   *
   * Spec S01 (#s01-inspector-singleton)
   */
  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("keyup", this.onKeyUp, true);
    document.removeEventListener("pointermove", this.onPointerMove, true);
    document.removeEventListener("click", this.onClick, true);

    if (this.highlightEl.parentNode) {
      this.highlightEl.parentNode.removeChild(this.highlightEl);
    }
    if (this.panelEl.parentNode) {
      this.panelEl.parentNode.removeChild(this.panelEl);
    }

    this.active = false;
    this.pinned = false;
    this.currentTarget = null;
    this.cleanupFn = null;
  }

  // ----- Activation / Deactivation -----

  /**
   * Show the overlay and begin tracking.
   * Lazily builds the reverse map on first activation (cached for the session).
   * Step 3 — formula provenance [D01]
   */
  activate(): void {
    this.active = true;
    this.highlightEl.style.display = "";
    this.panelEl.style.display = "";

    // Build reverse map once per session
    if (!this.reverseMap) {
      this.reverseMap = buildReverseMap(RULES);
    }

    // Fetch fresh formula data on activation so the first inspected element
    // can show formula provenance immediately.  [D06] step-3 task.
    fetchFormulasData().then((data) => {
      this.formulasData = data;
    }).catch(() => {
      // Fetch failed — formula section will be omitted until a successful fetch
    });
  }

  /**
   * Hide the overlay and stop tracking (unless pinned).
   */
  deactivate(): void {
    if (this.pinned) return;
    this.active = false;
    this.highlightEl.style.display = "none";
    this.panelEl.style.display = "none";
    this.currentTarget = null;
  }

  // ----- Event Handlers -----

  /**
   * Handle keydown: activate when Shift+Alt (Option) are both pressed.
   * Escape always closes and unpins the overlay.
   *
   * Spec S01 (#s01-inspector-singleton)
   */
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.pinned = false;
      this.active = false;
      this.highlightEl.style.display = "none";
      this.panelEl.style.display = "none";
      this.currentTarget = null;
      this.highlightEl.classList.remove("tug-inspector-highlight--pinned");
      return;
    }

    if (event.shiftKey && event.altKey && !this.active) {
      this.activate();
    }
  }

  /**
   * Handle keyup: deactivate when either Shift or Alt (Option) is released.
   *
   * Spec S01 (#s01-inspector-singleton)
   */
  onKeyUp(event: KeyboardEvent): void {
    if (event.key === "Shift" || event.key === "Alt") {
      if (!event.shiftKey || !event.altKey) {
        this.deactivate();
      }
    }
  }

  /**
   * Handle pointer move: identify element under cursor and inspect it.
   * No-op if inspector is not active or is pinned.
   *
   * Spec S01 (#s01-inspector-singleton), [D03] elementFromPoint
   */
  onPointerMove(event: PointerEvent): void {
    if (!this.active || this.pinned) return;

    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === this.highlightEl || el === this.panelEl || this.panelEl.contains(el)) {
      return;
    }

    if (el !== this.currentTarget) {
      this.currentTarget = el;
      this.inspectElement(el as HTMLElement, event.clientX, event.clientY);
    } else {
      // Same element, just reposition panel in case cursor moved significantly
      this.positionPanel(event.clientX, event.clientY);
    }
  }

  /**
   * Handle click: pin on first click while active (unpinned).
   * When already pinned, clicking a different element re-inspects that element.
   * Escape and the close button are the only ways to dismiss.
   *
   * [D06] Pin behavior change — click re-inspects, Escape/close dismisses
   * Step 3 — formula provenance display
   */
  onClick(event: MouseEvent): void {
    if (!this.active) return;

    // Don't act if clicking within the inspector panel itself
    if (this.panelEl.contains(event.target as Node)) return;

    if (!this.pinned) {
      // First click: pin the overlay
      this.pinned = true;
      this.highlightEl.classList.add("tug-inspector-highlight--pinned");
      this.renderPinBadge(true);
      this.renderHintText();
    } else {
      // Already pinned: re-inspect the clicked element
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (el && el !== this.highlightEl && el !== this.panelEl && !this.panelEl.contains(el)) {
        this.currentTarget = el;
        this.inspectElement(el as HTMLElement, event.clientX, event.clientY);
      }
    }
  }

  // ----- Inspection -----

  /**
   * Inspect an element: position the highlight overlay, read its token chains,
   * and populate the panel with all inspector data.
   *
   * Fetches formula data asynchronously and updates the panel once received.
   * The panel is rendered immediately with available data, then updated with
   * formula provenance once the fetch resolves.
   *
   * Step 3 — formula provenance display [D04]
   * Spec S01, S03 (#s03-inspected-properties)
   */
  inspectElement(el: HTMLElement, cursorX: number, cursorY: number): void {
    this.positionHighlight(el);
    this.positionPanel(cursorX, cursorY);

    const computed = getComputedStyle(el);
    const bgColor = computed.getPropertyValue("background-color").trim();
    const fgColor = computed.getPropertyValue("color").trim();
    const borderColor = computed.getPropertyValue("border-color").trim();

    // Build DOM path for display
    const domPath = this.buildDomPath(el);

    // Resolve token chains for key properties
    const bgChain = this.resolveTokenChainForProperty(el, "background-color", bgColor);
    const fgChain = this.resolveTokenChainForProperty(el, "color", fgColor);
    const borderChain = this.resolveTokenChainForProperty(el, "border-color", borderColor);

    // Read scale/timing
    const zoom = getTugZoom();
    const timing = getTugTiming();
    const motionOn = isTugMotionEnabled();

    // Capture the formula target element to avoid closure stale-reference issues
    const targetEl = el;

    // Render the panel immediately with existing formulas data (may be null on first load)
    this.renderPanel({
      el: targetEl,
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
      formulasData: this.formulasData,
    });

    // Fetch fresh formulas data and update the panel
    fetchFormulasData().then((data) => {
      this.formulasData = data;
      // Only re-render if the element is still the current target
      if (this.currentTarget === targetEl) {
        this.renderPanel({
          el: targetEl,
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
          formulasData: this.formulasData,
        });
      }
    }).catch(() => {
      // Fetch failed — panel already shown without formula section
    });
  }

  // ----- Token Chain Resolution -----

  /**
   * Resolve the full token chain for a CSS property on an element.
   * Identifies the originating comp or base token and walks var() references.
   *
   * Spec S02 (#s02-token-chain-algorithm), Spec S03 (#s03-inspected-properties)
   *
   * @param el - The inspected element
   * @param property - The CSS property name (e.g. "background-color")
   * @param computedValue - The element's computed value for the property
   */
  resolveTokenChainForProperty(
    el: HTMLElement,
    property: string,
    computedValue: string
  ): TokenChainResult {
    const result: TokenChainResult = {
      originToken: null,
      originLayer: "none",
      chain: [],
      endsAtPalette: false,
      paletteVar: null,
      terminalValue: null,
      usedHeuristic: false,
    };

    if (!computedValue || computedValue === "none") {
      return result;
    }

    // Primary: find the var(--*) token directly from CSS rules
    const cssToken = this.findTokenFromCSSRules(el, property);
    if (cssToken) {
      result.originToken = cssToken;
      // Check if it's a component-level token (--tug-<component>-* but not --tug-*)
      const isComponentToken =
        cssToken.startsWith("--tug-") &&
        !cssToken.startsWith("--tug-") &&
        !PALETTE_VAR_REGEX.test(cssToken);
      if (isComponentToken) {
        result.originLayer = "comp";
      } else if (
        cssToken.startsWith("--tug-") ||
        PALETTE_VAR_REGEX.test(cssToken)
      ) {
        result.originLayer = "base";
      } else {
        // Non-tug variable (e.g. external library variable).
        // Show it as an external token -- we can read its value but won't
        // walk into the tug chain.
        result.originLayer = "base";
      }
    }

    // Fallback: class-based comp family detection + base token value matching
    if (!result.originToken) {
      const compFamily = this.detectCompFamily(el);
      if (compFamily) {
        const tokens = COMP_FAMILY_TOKENS[compFamily] ?? [];
        for (const token of tokens) {
          const tokenVal = getComputedStyle(document.body).getPropertyValue(token).trim();
          if (tokenVal && this.valuesMatch(tokenVal, computedValue, property)) {
            result.originToken = token;
            result.originLayer = "comp";
            break;
          }
        }
      }
    }

    if (!result.originToken) {
      const fallbacks = BASE_TOKEN_FALLBACKS[property] ?? [];
      for (const token of fallbacks) {
        const tokenVal = getComputedStyle(document.body).getPropertyValue(token).trim();
        if (tokenVal && this.valuesMatch(tokenVal, computedValue, property)) {
          result.originToken = token;
          result.originLayer = "base";
          break;
        }
      }
    }

    // Step 5: Walk the chain from the origin token
    if (result.originToken) {
      const chain = this.resolveTokenChain(result.originToken);
      result.chain = chain;

      const last = chain[chain.length - 1];
      if (last) {
        result.terminalValue = last.value;
        if (PALETTE_VAR_REGEX.test(last.property)) {
          result.endsAtPalette = true;
          result.paletteVar = last.property;
        } else if (!last.value.includes("var(")) {
          // Risk R01 mitigation: if the terminal value contains no var() reference
          // but we only have one chain hop, the browser may have resolved through
          // the var() chain directly. Mark as heuristic for display.
          // A single-hop chain where the value is already a terminal (no var()) is
          // consistent with the browser having resolved the property all the way
          // to a concrete value before we could read the intermediate step.
          if (chain.length === 1 && !last.value.startsWith("oklch(")) {
            result.usedHeuristic = true;
          }
        }
      }
    } else {
      // No token found -- show raw value
      result.terminalValue = computedValue;
    }

    return result;
  }

  /**
   * Walk var() references to build the full token resolution chain.
   * Reads from document.body (where all tug token CSS is scoped).
   *
   * Chain termination rules:
   *   1. Property matches PALETTE_VAR_REGEX -- stop (TugColor provenance handles inner constants)
   *   2. Value starts with "oklch(" -- formula terminal
   *   3. Value does not contain a var() reference -- literal terminal
   *   4. Cycle detected (seen this property before) -- stop
   *
   * Spec S02 (#s02-token-chain-algorithm)
   */
  resolveTokenChain(startProperty: string): TokenChainHop[] {
    const chain: TokenChainHop[] = [];
    const seen = new Set<string>();
    let currentProp = startProperty;

    while (true) {
      if (seen.has(currentProp)) break; // cycle guard
      seen.add(currentProp);

      // Try body first (where tug tokens live), then documentElement (:root),
      // then search CSS rules directly (for Tailwind @theme variables that
      // aren't readable via getComputedStyle).
      let rawValue = getComputedStyle(document.body).getPropertyValue(currentProp).trim();
      if (!rawValue) {
        rawValue = getComputedStyle(document.documentElement).getPropertyValue(currentProp).trim();
      }
      if (!rawValue) {
        rawValue = this.findPropertyValueInRules(currentProp);
      }
      if (!rawValue) break;

      chain.push({ property: currentProp, value: rawValue });

      // Termination rule 1: palette variable reached
      if (PALETTE_VAR_REGEX.test(currentProp)) {
        break;
      }

      // Termination rule 2: oklch formula terminal
      if (rawValue.startsWith("oklch(")) {
        break;
      }

      // Termination rule 3: no var() reference -- literal terminal
      const match = rawValue.match(/var\((--[a-zA-Z0-9_-]+)/);
      if (!match) {
        break;
      }

      currentProp = match[1];
    }

    return chain;
  }

  /**
   * Extract TugColor provenance from a palette variable name.
   * Reads canonical-l, peak-c, and h constants from document.body.
   *
   * Spec S04 (#s04-tug-color-provenance)
   */
  extractTugColorProvenance(tokenName: string): TugColorProvenance | null {
    const m = PALETTE_VAR_REGEX.exec(tokenName);
    if (!m) return null;

    const hue = m[1];
    const preset = m[3] ?? "canonical";

    const canonicalL = getComputedStyle(document.body)
      .getPropertyValue(`--tug-${hue}-canonical-l`)
      .trim();
    const peakC = getComputedStyle(document.body)
      .getPropertyValue(`--tug-${hue}-peak-c`)
      .trim();
    const hueAngle = getComputedStyle(document.body)
      .getPropertyValue(`--tug-${hue}-h`)
      .trim();

    return { hue, preset, canonicalL, peakC, hueAngle };
  }

  // ----- DOM Helpers -----

  /**
   * Detect the component token family for an element.
   * Checks the element's classList and walks up to 5 ancestors.
   *
   * Spec S03 step 1-2 (#s03-inspected-properties)
   */
  private detectCompFamily(el: HTMLElement): string | null {
    let current: Element | null = el;
    let depth = 0;
    while (current && depth <= 5) {
      for (const cls of Array.from(current.classList)) {
        if (CLASS_TO_COMP_FAMILY[cls]) {
          return CLASS_TO_COMP_FAMILY[cls];
        }
      }
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  /**
   * Compare a token's body-resolved value to an element's computed value.
   * Both may be in different color spaces after browser normalization, so we
   * do a normalized string comparison after trimming whitespace.
   */
  private valuesMatch(tokenVal: string, computedVal: string, _property: string): boolean {
    return tokenVal.trim() === computedVal.trim();
  }

  // ----- CSS Rule Inspection -----

  /**
   * Property-to-shorthand lookup for CSS rule inspection.
   * When looking for a longhand property like 'background-color', also
   * check shorthands like 'background' that may contain the var() reference.
   */
  private static readonly SHORTHAND_MAP: Record<string, string[]> = {
    "background-color": ["background-color", "background"],
    color: ["color"],
    "border-color": ["border-color", "border"],
  };

  /**
   * Find the CSS custom property (var()) used for a CSS property on an element
   * by inspecting the element's inline styles and matched CSS rules.
   *
   * This is the primary token discovery mechanism — it finds the actual
   * var() reference in the stylesheet rather than guessing via value matching.
   *
   * Matches any var(--*) reference, not just --tug-* tokens, so that
   * Tailwind/shadcn variables (e.g. --color-secondary-foreground) are also found.
   *
   * Returns the custom property name (e.g. '--tug-element-global-fill-normal-accentCool-rest'
   * or '--color-secondary-foreground') or null.
   */
  private findTokenFromCSSRules(
    el: HTMLElement,
    property: string
  ): string | null {
    const propsToCheck =
      StyleInspectorOverlay.SHORTHAND_MAP[property] ?? [property];
    const varPattern = /var\((--[a-zA-Z0-9_-]+)/;

    // 1. Check inline styles first (highest specificity)
    for (const prop of propsToCheck) {
      const inlineVal = el.style.getPropertyValue(prop);
      if (inlineVal) {
        const m = inlineVal.match(varPattern);
        if (m) return m[1];
      }
    }

    // 2. Walk matched CSS rules, checking the element and then its ancestors.
    //    CSS inheritance means the token may be on a parent (e.g. a <button>
    //    with .text-secondary-foreground) while elementFromPoint returns a
    //    child <span>. Walk up to 6 ancestors to find the rule.
    let current: HTMLElement | null = el;
    let depth = 0;

    while (current && depth <= 6) {
      let lastMatch: string | null = null;

      for (const sheet of Array.from(document.styleSheets)) {
        let topRules: CSSRuleList;
        try {
          topRules = sheet.cssRules;
        } catch {
          continue;
        }

        this.walkRulesForToken(topRules, current, propsToCheck, varPattern, (token) => {
          lastMatch = token;
        });
      }

      if (lastMatch) return lastMatch;

      current = current.parentElement as HTMLElement | null;
      depth++;
    }

    return null;
  }

  /**
   * Recursively walk a CSSRuleList, calling `onMatch` for every rule that
   * matches `el` and sets one of `propsToCheck` to a var() value.
   *
   * Each rule access is individually try/caught so a single bad rule
   * (unusual @-rule, cross-origin nested sheet, etc.) never aborts the
   * traversal of the rest of the list.
   */
  private walkRulesForToken(
    rules: CSSRuleList,
    el: HTMLElement,
    propsToCheck: string[],
    varPattern: RegExp,
    onMatch: (token: string) => void
  ): void {
    for (let i = 0; i < rules.length; i++) {
      let rule: CSSRule;
      try {
        rule = rules[i];
      } catch {
        continue;
      }

      if (rule instanceof CSSStyleRule) {
        try {
          if (!el.matches(rule.selectorText)) continue;
        } catch {
          continue; // invalid selector
        }
        for (const prop of propsToCheck) {
          const val = rule.style.getPropertyValue(prop);
          if (val) {
            const m = val.match(varPattern);
            if (m) {
              onMatch(m[1]);
              break;
            }
          }
        }
      } else {
        // Recurse into grouping rules (@media, @supports, @layer, etc.)
        let nested: CSSRuleList | undefined;
        try {
          if ("cssRules" in rule) {
            nested = (rule as CSSGroupingRule).cssRules;
          }
        } catch {
          continue; // inaccessible nested rules
        }
        if (nested) {
          this.walkRulesForToken(nested, el, propsToCheck, varPattern, onMatch);
        }
      }
    }
  }

  /**
   * Search all CSS rules for a custom property definition and return its value.
   *
   * This handles Tailwind v4 @theme variables (e.g. --color-secondary-foreground)
   * that are compiled into CSS rules but aren't readable via getComputedStyle.
   * Searches any rule that sets the property (e.g. :root { --color-foo: ... }).
   */
  private findPropertyValueInRules(property: string): string {
    let lastValue = "";
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        this.walkRulesForPropertyDef(sheet.cssRules, property, (val) => {
          lastValue = val;
        });
      } catch {
        continue;
      }
    }
    return lastValue;
  }

  /**
   * Recursively walk CSS rules looking for any rule that defines a given
   * custom property. Calls onFound with the declared value.
   */
  private walkRulesForPropertyDef(
    rules: CSSRuleList,
    property: string,
    onFound: (value: string) => void
  ): void {
    for (let i = 0; i < rules.length; i++) {
      let rule: CSSRule;
      try {
        rule = rules[i];
      } catch {
        continue;
      }

      if (rule instanceof CSSStyleRule) {
        const val = rule.style.getPropertyValue(property).trim();
        if (val) onFound(val);
      } else {
        let nested: CSSRuleList | undefined;
        try {
          if ("cssRules" in rule) {
            nested = (rule as CSSGroupingRule).cssRules;
          }
        } catch {
          continue;
        }
        if (nested) {
          this.walkRulesForPropertyDef(nested, property, onFound);
        }
      }
    }
  }

  /**
   * Build a short DOM path string for the inspected element.
   * Shows up to 3 ancestors in the form: div.parent > span.child > button.el
   */
  private buildDomPath(el: HTMLElement): string {
    const parts: string[] = [];
    let current: Element | null = el;
    let depth = 0;
    while (current && depth < 4) {
      const tag = current.tagName.toLowerCase();
      const classes = Array.from(current.classList)
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("");
      const id = current.id ? `#${current.id}` : "";
      parts.unshift(`${tag}${id}${classes}`);
      current = current.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  /**
   * Position the highlight ring over the inspected element's bounding rect.
   */
  positionHighlight(el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    this.highlightEl.style.top = `${rect.top}px`;
    this.highlightEl.style.left = `${rect.left}px`;
    this.highlightEl.style.width = `${rect.width}px`;
    this.highlightEl.style.height = `${rect.height}px`;
  }

  /**
   * Position the inspector panel near the cursor, clamped to viewport edges.
   *
   * Spec S01 (#s01-inspector-singleton)
   */
  positionPanel(x: number, y: number): void {
    const OFFSET = 16;
    const panelW = this.panelEl.offsetWidth || 320;
    const panelH = this.panelEl.offsetHeight || 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + OFFSET;
    let top = y + OFFSET;

    // Clamp to viewport right edge
    if (left + panelW > vw - 8) {
      left = x - panelW - OFFSET;
    }
    // Clamp to viewport left edge
    if (left < 8) {
      left = 8;
    }
    // Clamp to viewport bottom edge
    if (top + panelH > vh - 8) {
      top = y - panelH - OFFSET;
    }
    // Clamp to viewport top edge
    if (top < 8) {
      top = 8;
    }

    this.panelEl.style.left = `${left}px`;
    this.panelEl.style.top = `${top}px`;
  }

  // ----- Panel Rendering -----

  /** Update the pin badge in the panel header. */
  private renderPinBadge(pinned: boolean): void {
    const badge = this.panelEl.querySelector(".tug-inspector-panel__pin-badge");
    if (badge) {
      badge.textContent = pinned ? "PINNED" : "";
    }
  }

  /**
   * Update the hint text at the bottom of the panel.
   * When pinned: "Escape to close"
   * When unpinned: "Click to pin • Escape to close"
   * Step 3 — pin behavior change [D06]
   */
  private renderHintText(): void {
    const hint = this.panelEl.querySelector(".tug-inspector-hint");
    if (hint) {
      hint.textContent = this.pinned
        ? "Escape to close"
        : "Click to pin \u2022 Escape to close";
    }
  }

  /**
   * Render a color swatch element for a given color value.
   */
  private makeSwatchEl(color: string): HTMLSpanElement {
    const swatch = document.createElement("span");
    swatch.className = "tug-inspector-swatch";
    swatch.style.background = color;
    return swatch;
  }

  /**
   * Try to convert an oklch() color string to --tug-color() notation.
   * Returns null if the string isn't a simple oklch(L C h) value
   * (e.g., contains calc() expressions).
   */
  private tryFormatTugColor(colorStr: string): string | null {
    if (!colorStr || !colorStr.startsWith("oklch(")) return null;
    // Skip values with calc() or var() — can't reverse-map those
    if (colorStr.includes("calc(") || colorStr.includes("var(")) return null;
    try {
      const { hue, intensity, tone } = oklchToTugColor(colorStr);
      return `--tug-color(${hue}, i: ${intensity}, t: ${tone})`;
    } catch {
      return null;
    }
  }

  /**
   * Create a styled span showing TugColor notation for a color value.
   * Returns null if the color can't be converted to TugColor.
   */
  private makeTugColorEl(colorStr: string): HTMLSpanElement | null {
    const tugColorStr = this.tryFormatTugColor(colorStr);
    if (!tugColorStr) return null;
    const el = document.createElement("span");
    el.className = "tug-inspector-tug-color";
    el.textContent = tugColorStr;
    return el;
  }

  /**
   * Render the token chain section for one CSS property.
   */
  private renderChainSection(
    title: string,
    computedValue: string,
    result: TokenChainResult,
    property: string
  ): HTMLElement {
    const section = document.createElement("div");
    section.className = "tug-inspector-section";

    const sectionTitle = document.createElement("div");
    sectionTitle.className = "tug-inspector-section__title";
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);

    if (!computedValue || computedValue === "none") {
      const row = document.createElement("div");
      row.className = "tug-inspector-row";
      const val = document.createElement("span");
      val.className = "tug-inspector-row__value tug-inspector-row__value--dim";
      val.textContent = "(not set)";
      row.appendChild(val);
      section.appendChild(row);
      return section;
    }

    // Show computed value with swatch
    const computedRow = document.createElement("div");
    computedRow.className = "tug-inspector-row";

    const computedLabel = document.createElement("span");
    computedLabel.className = "tug-inspector-row__label";
    computedLabel.textContent = "computed";
    computedRow.appendChild(computedLabel);

    const isColorProp =
      property === "background-color" ||
      property === "color" ||
      property === "border-color";
    if (isColorProp && computedValue && computedValue !== "none") {
      computedRow.appendChild(this.makeSwatchEl(computedValue));
    }

    const computedVal = document.createElement("span");
    computedVal.className = "tug-inspector-row__value";
    computedVal.textContent = shortenNumbers(computedValue);
    computedRow.appendChild(computedVal);

    if (isColorProp) {
      const tugColorEl = this.makeTugColorEl(computedValue);
      if (tugColorEl)computedRow.appendChild(tugColorEl);
    }

    section.appendChild(computedRow);

    // Show token chain
    if (result.chain.length > 0) {
      const chainEl = document.createElement("div");
      chainEl.className = "tug-inspector-chain";

      for (let i = 0; i < result.chain.length; i++) {
        const hop = result.chain[i];
        const hopEl = document.createElement("div");
        hopEl.className = "tug-inspector-chain__hop";

        // Token name on its own line
        const propEl = document.createElement("span");
        propEl.className = "tug-inspector-chain__prop";
        propEl.textContent = hop.property;
        hopEl.appendChild(propEl);

        // Resolved value indented below
        const resolvedEl = document.createElement("div");
        resolvedEl.className = "tug-inspector-chain__resolved";

        if (i < result.chain.length - 1) {
          const valEl = document.createElement("span");
          valEl.className = "tug-inspector-chain__value";
          valEl.textContent = shortenNumbers(hop.value);
          resolvedEl.appendChild(valEl);
        } else {
          // Terminal hop
          if (isColorProp && hop.value && hop.value !== "none") {
            resolvedEl.appendChild(this.makeSwatchEl(hop.value));
          }

          const valEl = document.createElement("span");
          valEl.className = "tug-inspector-chain__terminal";
          valEl.textContent = shortenNumbers(hop.value);
          resolvedEl.appendChild(valEl);

          if (isColorProp) {
            const tugColorEl = this.makeTugColorEl(hop.value);
            if (tugColorEl) resolvedEl.appendChild(tugColorEl);
          }
        }

        hopEl.appendChild(resolvedEl);
        chainEl.appendChild(hopEl);
      }

      section.appendChild(chainEl);

      // TugColor provenance if chain ends at a palette variable
      if (result.endsAtPalette && result.paletteVar) {
        const tugColor = this.extractTugColorProvenance(result.paletteVar);
        if (tugColor) {
          const tugColorSection = this.renderTugColorSection(tugColor);
          section.appendChild(tugColorSection);
        }
      }
    }

    return section;
  }

  /**
   * Render the TugColor provenance sub-section.
   *
   * Spec S04 (#s04-tug-color-provenance)
   */
  private renderTugColorSection(tugColor: TugColorProvenance): HTMLElement {
    const container = document.createElement("div");
    container.className = "tug-inspector-section";

    const title = document.createElement("div");
    title.className = "tug-inspector-section__title";
    title.textContent = "TugColor Provenance";
    container.appendChild(title);

    const rows: Array<[string, string]> = [
      ["hue", tugColor.hue],
      ["preset", tugColor.preset],
      ["canonical-l", tugColor.canonicalL || "(n/a)"],
      ["peak-c", tugColor.peakC || "(n/a)"],
      ["hue-angle", tugColor.hueAngle || "(n/a)"],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "tug-inspector-row";

      const labelEl = document.createElement("span");
      labelEl.className = "tug-inspector-row__label";
      labelEl.textContent = label;
      row.appendChild(labelEl);

      const valEl = document.createElement("span");
      valEl.className = "tug-inspector-row__value";
      valEl.textContent = value;
      row.appendChild(valEl);

      container.appendChild(row);
    }

    return container;
  }

  /**
   * Full panel render: clears and repopulates the panel element.
   * Includes formula provenance section when formulasData is available.
   * Step 3 — formula provenance display [D04]
   */
  private renderPanel(data: {
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
    formulasData?: FormulasData | null;
  }): void {
    this.panelEl.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "tug-inspector-panel__header";

    const titleEl = document.createElement("div");
    titleEl.className = "tug-inspector-panel__title";
    titleEl.textContent = "Cascade Inspector";
    header.appendChild(titleEl);

    const pinBadge = document.createElement("div");
    pinBadge.className = "tug-inspector-panel__pin-badge";
    pinBadge.textContent = this.pinned ? "PINNED" : "";
    header.appendChild(pinBadge);

    const closeBtn = document.createElement("button");
    closeBtn.className = "tug-inspector-panel__close-btn";
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close inspector";
    closeBtn.addEventListener("click", () => {
      this.pinned = false;
      this.active = false;
      this.highlightEl.style.display = "none";
      this.panelEl.style.display = "none";
      this.currentTarget = null;
      this.highlightEl.classList.remove("tug-inspector-highlight--pinned");
    });
    header.appendChild(closeBtn);

    this.panelEl.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "tug-inspector-panel__body";

    // Element info section
    const elSection = document.createElement("div");
    elSection.className = "tug-inspector-section";

    const elTitle = document.createElement("div");
    elTitle.className = "tug-inspector-section__title";
    elTitle.textContent = "Element";
    elSection.appendChild(elTitle);

    const tagRow = document.createElement("div");
    tagRow.className = "tug-inspector-row";
    const tagLabel = document.createElement("span");
    tagLabel.className = "tug-inspector-row__label";
    tagLabel.textContent = "tag";
    tagRow.appendChild(tagLabel);
    const tagVal = document.createElement("span");
    tagVal.className = "tug-inspector-row__value";
    tagVal.textContent = data.el.tagName.toLowerCase();
    tagRow.appendChild(tagVal);
    elSection.appendChild(tagRow);

    if (data.el.className) {
      const classRow = document.createElement("div");
      classRow.className = "tug-inspector-row";
      const classLabel = document.createElement("span");
      classLabel.className = "tug-inspector-row__label";
      classLabel.textContent = "classes";
      classRow.appendChild(classLabel);
      const classVal = document.createElement("span");
      classVal.className = "tug-inspector-row__value";
      classVal.textContent =
        typeof data.el.className === "string" ? data.el.className : "";
      classRow.appendChild(classVal);
      elSection.appendChild(classRow);
    }

    const pathRow = document.createElement("div");
    pathRow.className = "tug-inspector-row";
    const pathLabel = document.createElement("span");
    pathLabel.className = "tug-inspector-row__label";
    pathLabel.textContent = "path";
    pathRow.appendChild(pathLabel);
    const pathVal = document.createElement("span");
    pathVal.className = "tug-inspector-path";
    pathVal.textContent = data.domPath;
    pathRow.appendChild(pathVal);
    elSection.appendChild(pathRow);

    body.appendChild(elSection);

    // Scale/timing readout
    const stSection = document.createElement("div");
    stSection.className = "tug-inspector-section";

    const stTitle = document.createElement("div");
    stTitle.className = "tug-inspector-section__title";
    stTitle.textContent = "Scale & Timing";
    stSection.appendChild(stTitle);

    const readout = document.createElement("div");
    readout.className = "tug-inspector-readout";

    const readoutItems: Array<[string, string]> = [
      ["zoom", data.zoom.toFixed(2)],
      ["timing", data.timing.toFixed(2)],
      ["motion", data.motionOn ? "on" : "off"],
    ];

    for (const [key, val] of readoutItems) {
      const item = document.createElement("div");
      item.className = "tug-inspector-readout__item";

      const keyEl = document.createElement("span");
      keyEl.className = "tug-inspector-readout__key";
      keyEl.textContent = `${key}:`;
      item.appendChild(keyEl);

      const valEl = document.createElement("span");
      valEl.className = "tug-inspector-readout__val";
      valEl.textContent = val;
      item.appendChild(valEl);

      readout.appendChild(item);
    }

    stSection.appendChild(readout);
    body.appendChild(stSection);

    // Token chain sections
    body.appendChild(
      this.renderChainSection(
        "Background Color",
        data.bgColor,
        data.bgChain,
        "background-color"
      )
    );
    body.appendChild(
      this.renderChainSection("Text Color", data.fgColor, data.fgChain, "color")
    );
    body.appendChild(
      this.renderChainSection(
        "Border Color",
        data.borderColor,
        data.borderChain,
        "border-color"
      )
    );

    // Formula provenance section (Step 3)
    if (data.formulasData) {
      const formulaSection = this.buildFormulaSectionForInspection(
        data.bgChain,
        data.fgChain,
        data.borderChain,
        data.formulasData,
      );
      if (formulaSection) {
        body.appendChild(formulaSection);
      }
    }

    // Hint
    const hint = document.createElement("div");
    hint.className = "tug-inspector-hint";
    hint.textContent = this.pinned
      ? "Escape to close"
      : "Click to pin \u2022 Escape to close";
    body.appendChild(hint);

    this.panelEl.appendChild(body);
  }

  /**
   * Build the formula provenance section for the currently inspected element.
   *
   * Finds the terminal token from the first chain that ends at a token (bgChain,
   * fgChain, or borderChain), looks up formula fields via tokenToFields, and
   * creates the formula section DOM node with interactive controls.
   *
   * Returns null if the reverse map is not available or no formula fields found.
   *
   * Step 5 — interactive formula controls [D02] [D04]
   */
  private buildFormulaSectionForInspection(
    bgChain: TokenChainResult,
    fgChain: TokenChainResult,
    borderChain: TokenChainResult,
    formulasData: FormulasData,
  ): HTMLElement | null {
    if (!this.reverseMap) return null;

    // Collect formula rows for all chains that have a terminal token
    const allRows: FormulaRow[] = [];
    const seenFields = new Set<string>();

    for (const chain of [bgChain, fgChain, borderChain]) {
      if (!chain.originToken) continue;

      // Use terminal token (last in chain) for formula lookup
      const terminalToken = chain.chain.length > 0
        ? chain.chain[chain.chain.length - 1].property
        : chain.originToken;

      const mappings = this.reverseMap.tokenToFields.get(terminalToken);
      if (!mappings) continue;

      for (const mapping of mappings) {
        if (seenFields.has(mapping.field)) continue;
        seenFields.add(mapping.field);

        const rawValue = formulasData.formulas[mapping.field];
        if (rawValue === undefined) continue;

        // Determine if this is a structural field (cannot do drag preview)
        // A simpler heuristic: if the terminal value from the chain is not an
        // oklch() value and not a palette variable, it's likely structural.
        const terminalValue = chain.terminalValue ?? "";
        const isStructural =
          !terminalValue.startsWith("oklch(") &&
          !PALETTE_VAR_REGEX.test(terminalToken) &&
          !chain.endsAtPalette;

        allRows.push({
          field: mapping.field,
          value: rawValue,
          property: mapping.property,
          isStructural,
        });
      }
    }

    // Build the section container
    const section = document.createElement("div");
    section.className = "tug-inspector-section";

    const titleEl = document.createElement("div");
    titleEl.className = "tug-inspector-section__title";
    titleEl.textContent = "Formula";
    section.appendChild(titleEl);

    if (allRows.length === 0) {
      // Constant token — show static indicator (no controls)
      return createFormulaSection(allRows, true);
    }

    // Interactive controls per Table T01
    const reverseMap = this.reverseMap;

    const controlsOptions: FormulaControlsOptions = {
      reverseMap,
      onRefresh: (updatedFormulas) => {
        // Re-render the formula section with updated values
        this.formulasData = updatedFormulas;
        // Re-render the full panel with updated formula data if still showing same element
        if (this.currentTarget && this.pinned) {
          this.inspectElement(
            this.currentTarget as HTMLElement,
            // Use current panel position since we don't have cursor coords
            parseInt(this.panelEl.style.left ?? "0", 10),
            parseInt(this.panelEl.style.top ?? "0", 10),
          );
        }
      },
    };

    for (const row of allRows) {
      const controlEl = createFormulaControls(row, controlsOptions);
      section.appendChild(controlEl);
    }

    return section;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton instance
// ---------------------------------------------------------------------------

let _instance: StyleInspectorOverlay | null = null;

// ---------------------------------------------------------------------------
// initStyleInspector
// ---------------------------------------------------------------------------

/**
 * Create and initialize the StyleInspectorOverlay singleton.
 *
 * This function is gated behind `process.env.NODE_ENV !== 'production'` so
 * that all inspector code is tree-shaken from production builds by Vite.
 *
 * In production, this function is a no-op that returns an empty cleanup stub.
 *
 * Call once during app boot after `initMotionObserver()` and
 * `registerGalleryCards()` but before `new DeckManager(...)`.
 *
 * [D02] Dev-only gating via NODE_ENV
 * Spec S01 (#s01-inspector-singleton)
 */
export function initStyleInspector(): () => void {
  if (process.env.NODE_ENV === "production") {
    return () => {};
  }

  if (_instance) {
    return () => {};
  }

  _instance = new StyleInspectorOverlay();
  return _instance.init();
}

/**
 * Reset the module-level singleton. For testing only.
 * Not gated by NODE_ENV so tests can call it freely.
 */
export function _resetStyleInspectorForTest(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}
