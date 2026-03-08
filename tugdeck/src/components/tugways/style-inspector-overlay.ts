/**
 * style-inspector-overlay.ts -- StyleInspectorOverlay singleton.
 *
 * A dev-only Shift+Option+hover cascade inspector overlay that shows the full
 * token resolution chain (component tokens, base tokens, palette variables,
 * HVV provenance) and scale/timing readout for any inspected element.
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
 *   Spec S04 (#s04-hvv-provenance)
 *   Spec S05 (#s05-scale-timing-readout)
 *
 * @module components/tugways/style-inspector-overlay
 */

import "./style-inspector-overlay.css";
import { getTugZoom, getTugTiming, isTugMotionEnabled } from "./scale-timing";

// ---------------------------------------------------------------------------
// PALETTE_VAR_REGEX -- matches only known hue palette variables
// ---------------------------------------------------------------------------

/**
 * Regex that matches palette variable names for the 24 known hue families,
 * with optional preset suffix (accent, muted, light, subtle, dark, deep).
 *
 * Deliberately anchored to the full token name (^...$) to avoid false-matching
 * global constants like `--tug-l-dark` or per-hue internals like
 * `--tug-orange-canonical-l`.
 *
 * Spec S02 (#s02-token-chain-algorithm)
 */
export const PALETTE_VAR_REGEX =
  /^--tug-(cherry|red|tomato|flame|orange|amber|gold|yellow|lime|green|mint|teal|cyan|sky|blue|cobalt|violet|purple|plum|pink|rose|magenta|berry|coral)(-(accent|muted|light|subtle|dark|deep))?$/;

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

/** HVV provenance data for a palette variable. */
export interface HvvProvenance {
  hue: string;
  preset: string;
  canonicalL: string;
  peakC: string;
  hueAngle: string;
}

// ---------------------------------------------------------------------------
// Component token families (Spec S03)
// ---------------------------------------------------------------------------

/**
 * Maps CSS class names to their component token family prefix.
 * Used by the token discovery strategy (Spec S03 step 1-2).
 */
const CLASS_TO_COMP_FAMILY: Record<string, string> = {
  "tug-tab-bar": "--tug-comp-tab",
  "tug-tab": "--tug-comp-tab",
  tugcard: "--tug-comp-card",
  "tugcard-header": "--tug-comp-card",
  "tug-dropdown": "--tug-comp-dropdown",
};

/**
 * Known component tokens for each family.
 * Derived from tug-comp-tokens.css for class-to-token mapping.
 * Spec S03 step 3.
 */
const COMP_FAMILY_TOKENS: Record<string, string[]> = {
  "--tug-comp-tab": [
    "--tug-comp-tab-bar-bg",
    "--tug-comp-tab-bar-border",
    "--tug-comp-tab-active-bg",
    "--tug-comp-tab-active-fg",
    "--tug-comp-tab-active-border",
    "--tug-comp-tab-rest-bg",
    "--tug-comp-tab-rest-fg",
    "--tug-comp-tab-hover-bg",
    "--tug-comp-tab-hover-fg",
  ],
  "--tug-comp-card": [
    "--tug-comp-card-bg",
    "--tug-comp-card-border",
    "--tug-comp-card-header-bg",
    "--tug-comp-card-header-fg",
    "--tug-comp-card-header-border",
    "--tug-comp-card-shadow",
  ],
  "--tug-comp-dropdown": [
    "--tug-comp-dropdown-bg",
    "--tug-comp-dropdown-border",
    "--tug-comp-dropdown-item-fg",
    "--tug-comp-dropdown-item-hover-bg",
    "--tug-comp-dropdown-item-hover-fg",
    "--tug-comp-dropdown-shadow",
  ],
};

/**
 * Well-known base tokens by CSS property category.
 * Used as fallback when no comp token match is found (Spec S03 step 4).
 */
const BASE_TOKEN_FALLBACKS: Record<string, string[]> = {
  "background-color": [
    "--tug-base-surface-default",
    "--tug-base-surface-raised",
    "--tug-base-surface-overlay",
    "--tug-base-accent-default",
    "--tug-base-accent-cool-default",
    "--tug-base-action-primary-bg-rest",
    "--tug-base-action-secondary-bg-rest",
    "--tug-base-tab-bar-bg",
    "--tug-base-card-bg",
    "--tug-base-tab-active-bg",
    "--tug-base-tab-rest-bg",
  ],
  color: [
    "--tug-base-fg-default",
    "--tug-base-fg-muted",
    "--tug-base-fg-subtle",
    "--tug-base-accent-default",
    "--tug-base-action-primary-fg-rest",
    "--tug-base-action-secondary-fg-rest",
    "--tug-base-tab-active-fg",
    "--tug-base-tab-rest-fg",
    "--tug-base-card-header-fg",
  ],
  "border-color": [
    "--tug-base-border-default",
    "--tug-base-border-muted",
    "--tug-base-accent-default",
    "--tug-base-tab-active-border",
    "--tug-base-tab-bar-border",
    "--tug-base-card-border",
  ],
};

// ---------------------------------------------------------------------------
// StyleInspectorOverlay class
// ---------------------------------------------------------------------------

/**
 * StyleInspectorOverlay -- singleton managing the full inspector lifecycle.
 *
 * Activated by holding Shift+Option (Mac). Tracks the element under the cursor
 * via elementFromPoint. Shows token chain resolution, HVV provenance, and
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
   */
  activate(): void {
    this.active = true;
    this.highlightEl.style.display = "";
    this.panelEl.style.display = "";
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
   * Handle click: toggle pin state.
   * When pinned, click unpins. When active (unpinned), click pins.
   *
   * [D05] Pin/unpin interaction model
   */
  onClick(event: MouseEvent): void {
    if (!this.active) return;

    // Don't pin if clicking within the inspector panel itself
    if (this.panelEl.contains(event.target as Node)) return;

    this.pinned = !this.pinned;

    if (this.pinned) {
      this.highlightEl.classList.add("tug-inspector-highlight--pinned");
      this.renderPinBadge(true);
    } else {
      this.highlightEl.classList.remove("tug-inspector-highlight--pinned");
      this.renderPinBadge(false);
    }
  }

  // ----- Inspection -----

  /**
   * Inspect an element: position the highlight overlay, read its token chains,
   * and populate the panel with all inspector data.
   *
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

    // Render the panel
    this.renderPanel({
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
      if (cssToken.startsWith("--tug-comp-")) {
        result.originLayer = "comp";
      } else if (
        cssToken.startsWith("--tug-base-") ||
        PALETTE_VAR_REGEX.test(cssToken)
      ) {
        result.originLayer = "base";
      } else {
        // Non-tug variable (e.g. Tailwind/shadcn --secondary-foreground).
        // Show it as an external token — we can read its value but won't
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
   *   1. Property matches PALETTE_VAR_REGEX -- stop (HVV provenance handles inner constants)
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

      const rawValue = getComputedStyle(document.body).getPropertyValue(currentProp).trim();
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
   * Extract HVV provenance from a palette variable name.
   * Reads canonical-l, peak-c, and h constants from document.body.
   *
   * Spec S04 (#s04-hvv-provenance)
   */
  extractHvvProvenance(tokenName: string): HvvProvenance | null {
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
   * Collect all CSSStyleRule instances from a CSSRuleList, recursing into
   * @media and @supports blocks.
   */
  private collectStyleRules(
    ruleList: CSSRuleList,
    out: CSSStyleRule[]
  ): void {
    for (const rule of Array.from(ruleList)) {
      if (rule instanceof CSSStyleRule) {
        out.push(rule);
      } else if (
        rule instanceof CSSMediaRule ||
        rule instanceof CSSSupportsRule
      ) {
        this.collectStyleRules(rule.cssRules, out);
      }
    }
  }

  /**
   * Find the CSS custom property (var()) used for a CSS property on an element
   * by inspecting the element's inline styles and matched CSS rules.
   *
   * This is the primary token discovery mechanism — it finds the actual
   * var() reference in the stylesheet rather than guessing via value matching.
   *
   * Matches any var(--*) reference, not just --tug-* tokens, so that
   * Tailwind/shadcn variables (e.g. --secondary-foreground) are also found.
   *
   * Returns the custom property name (e.g. '--tug-base-accent-cool-default'
   * or '--secondary-foreground') or null.
   */
  private findTokenFromCSSRules(
    el: HTMLElement,
    property: string
  ): string | null {
    const propsToCheck =
      StyleInspectorOverlay.SHORTHAND_MAP[property] ?? [property];

    // 1. Check inline styles first (highest specificity)
    for (const prop of propsToCheck) {
      const inlineVal = el.style.getPropertyValue(prop);
      if (inlineVal) {
        const m = inlineVal.match(/var\((--[a-zA-Z0-9_-]+)/);
        if (m) return m[1];
      }
    }

    // 2. Walk matched CSS rules. Later rules and higher specificity win,
    //    so we take the last match across all sheets.
    let lastMatch: string | null = null;

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSStyleRule[];
      try {
        rules = [];
        this.collectStyleRules(sheet.cssRules, rules);
      } catch {
        continue; // cross-origin stylesheet
      }

      for (const rule of rules) {
        try {
          if (!el.matches(rule.selectorText)) continue;
        } catch {
          continue; // invalid or unsupported selector
        }

        for (const prop of propsToCheck) {
          const val = rule.style.getPropertyValue(prop);
          if (val) {
            const m = val.match(/var\((--[a-zA-Z0-9_-]+)/);
            if (m) {
              lastMatch = m[1];
              break; // found for this rule, skip shorthands
            }
          }
        }
      }
    }

    return lastMatch;
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
   * Render a color swatch element for a given color value.
   */
  private makeSwatchEl(color: string): HTMLSpanElement {
    const swatch = document.createElement("span");
    swatch.className = "tug-inspector-swatch";
    swatch.style.background = color;
    return swatch;
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
    computedVal.textContent = computedValue;
    computedRow.appendChild(computedVal);
    section.appendChild(computedRow);

    // Show token chain
    if (result.chain.length > 0) {
      const chainEl = document.createElement("div");
      chainEl.className = "tug-inspector-chain";

      // Show origin layer indicator for no-comp-token case
      if (result.originLayer === "base") {
        const indicator = document.createElement("div");
        indicator.className = "tug-inspector-chain__indicator";
        indicator.textContent = "(no comp token -- base token layer)";
        chainEl.appendChild(indicator);
      } else if (result.originLayer === "none") {
        const indicator = document.createElement("div");
        indicator.className = "tug-inspector-chain__indicator";
        indicator.textContent = "(no token -- inspector could not determine originating design token)";
        chainEl.appendChild(indicator);
      }

      for (let i = 0; i < result.chain.length; i++) {
        const hop = result.chain[i];
        const hopEl = document.createElement("div");
        hopEl.className = "tug-inspector-chain__hop";

        const propEl = document.createElement("span");
        propEl.className = "tug-inspector-chain__prop";
        propEl.textContent = hop.property;
        hopEl.appendChild(propEl);

        if (i < result.chain.length - 1) {
          const arrowEl = document.createElement("span");
          arrowEl.className = "tug-inspector-chain__arrow";
          arrowEl.textContent = "\u2192";
          hopEl.appendChild(arrowEl);

          const valEl = document.createElement("span");
          valEl.className = "tug-inspector-chain__value";
          valEl.textContent = hop.value;
          hopEl.appendChild(valEl);
        } else {
          // Terminal hop
          const arrowEl = document.createElement("span");
          arrowEl.className = "tug-inspector-chain__arrow";
          arrowEl.textContent = "\u2192";
          hopEl.appendChild(arrowEl);

          if (isColorProp && hop.value && hop.value !== "none") {
            hopEl.appendChild(this.makeSwatchEl(hop.value));
          }

          const valEl = document.createElement("span");
          valEl.className = "tug-inspector-chain__terminal";
          valEl.textContent = hop.value;
          hopEl.appendChild(valEl);
        }

        chainEl.appendChild(hopEl);
      }

      section.appendChild(chainEl);

      // HVV provenance if chain ends at a palette variable
      if (result.endsAtPalette && result.paletteVar) {
        const hvv = this.extractHvvProvenance(result.paletteVar);
        if (hvv) {
          const hvvSection = this.renderHvvSection(hvv);
          section.appendChild(hvvSection);
        }
      }
    } else if (result.originLayer === "none") {
      const indicator = document.createElement("div");
      indicator.className = "tug-inspector-chain__indicator";
      indicator.textContent = "(no token -- inspector could not determine originating design token)";
      section.appendChild(indicator);
    }

    if (result.usedHeuristic) {
      const hint = document.createElement("div");
      hint.className = "tug-inspector-chain__indicator";
      hint.textContent = "(heuristic)";
      section.appendChild(hint);
    }

    return section;
  }

  /**
   * Render the HVV provenance sub-section.
   *
   * Spec S04 (#s04-hvv-provenance)
   */
  private renderHvvSection(hvv: HvvProvenance): HTMLElement {
    const container = document.createElement("div");
    container.className = "tug-inspector-section";

    const title = document.createElement("div");
    title.className = "tug-inspector-section__title";
    title.textContent = "HVV Provenance";
    container.appendChild(title);

    const rows: Array<[string, string]> = [
      ["hue", hvv.hue],
      ["preset", hvv.preset],
      ["canonical-l", hvv.canonicalL || "(n/a)"],
      ["peak-c", hvv.peakC || "(n/a)"],
      ["hue-angle", hvv.hueAngle || "(n/a)"],
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

    // Hint
    const hint = document.createElement("div");
    hint.className = "tug-inspector-hint";
    hint.textContent = this.pinned
      ? "Click or Escape to unpin"
      : "Click to pin \u2022 Escape to close";
    body.appendChild(hint);

    this.panelEl.appendChild(body);
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
