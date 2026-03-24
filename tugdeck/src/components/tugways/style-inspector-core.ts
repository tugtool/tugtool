/**
 * style-inspector-core.ts -- Style inspector utility functions and types.
 *
 * Provides the token chain resolution algorithm, TugColor provenance extraction,
 * formula row building, and related utilities used by the Style Inspector card.
 *
 * The old floating overlay (StyleInspectorOverlay class, initStyleInspector) has
 * been removed. The inspector is now a proper card (style-inspector) in the
 * developer card family, opened via Developer menu (Opt+Cmd+I).
 *
 * Activation: Use Opt+Cmd+I to open the Style Inspector card, then click the
 * reticle button to enter scan mode and hover over elements to inspect them.
 *
 * Design decisions:
 *   [D01] Inspector content is a React component (StyleInspectorContent in
 *         style-inspector-card.tsx). No class-level DOM manipulation.
 *   [D02] Scan overlay is an imperative DOM element managed by ScanModeController
 *         (scan-mode-controller.ts), consistent with L06.
 *   [D03] Reverse map built once as module singleton (getReverseMap), reused
 *         across card open/close cycles.
 *
 * **Authoritative references:**
 *   Spec S02 (#s02-token-chain-algorithm)
 *   Spec S03 (#s03-inspected-properties)
 *   Spec S04 (#s04-tug-color-provenance)
 *   Spec S05 (#s05-scale-timing-readout)
 *
 * @module components/tugways/style-inspector-core
 */

import "./style-inspector-overlay.css";
import { oklchToTugColor } from "./palette-engine";
import { buildReverseMap, type ReverseMap } from "./formula-reverse-map";
import { RULES } from "./theme-rules";

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

// ---------------------------------------------------------------------------
// Formula provenance types
// ---------------------------------------------------------------------------

/** Formulas data fetched from GET /__themes/formulas. */
export interface FormulasData {
  formulas: Record<string, number | string | boolean>;
  /** Default formula values from initial theme activation, before any recipe edits. */
  defaults: Record<string, number | string | boolean>;
  /** Maps each formula field name to its source expression text from the recipe file. [D07] */
  sources: Record<string, string>;
  mode: string;
  themeName: string;
}

/** One formula row displayed in the inspector panel. */
export interface FormulaRow {
  field: string;
  value: number | string | boolean;
  property: "tone" | "intensity" | "alpha" | "hueSlot";
  isStructural: boolean;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** Round floating-point numbers in a CSS value string to 3 significant digits. */
export function shortenNumbers(s: string): string {
  return s.replace(/\d+\.\d+/g, (m) => {
    const n = parseFloat(m);
    return n.toPrecision(3).replace(/\.?0+$/, "");
  });
}

// ---------------------------------------------------------------------------
// Formula provenance helpers
// ---------------------------------------------------------------------------

/**
 * Fetch formulas data from the dev server.
 * Returns null on any failure (server not available, no active theme, etc.).
 */
export async function fetchFormulasData(): Promise<FormulasData | null> {
  try {
    const response = await fetch("/__themes/formulas");
    if (!response.ok) return null;
    return (await response.json()) as FormulasData;
  } catch {
    return null;
  }
}

/**
 * Render formula rows as a read-only display section.
 * Returns an HTMLElement containing formula field display, or a "(constant)" indicator.
 *
 * Note: `createFormulaSection` is dead production code retained until the formula
 * tests are migrated from `createFormulaSection` to `buildFormulaRows`. See
 * roadmap item in tugplan-inspector-card.md (#roadmap).
 *
 * @param rows - The formula rows to display
 * @param isConstant - Whether the token has no formula-driven fields
 */
export function createFormulaSection(rows: FormulaRow[], isConstant: boolean): HTMLElement {
  const section = document.createElement("div");
  section.className = "tug-inspector-section";

  const title = document.createElement("div");
  title.className = "tug-inspector-section__title";
  title.textContent = "Formula";
  section.appendChild(title);

  if (isConstant || rows.length === 0) {
    const constantEl = document.createElement("div");
    constantEl.className = "tug-inspector-row";
    const constantVal = document.createElement("span");
    constantVal.className = "tug-inspector-row__value tug-inspector-row__value--dim";
    constantVal.textContent = "(constant)";
    constantEl.appendChild(constantVal);
    section.appendChild(constantEl);
    return section;
  }

  for (const row of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "tug-inspector-formula-field";

    // Field name
    const nameEl = document.createElement("span");
    nameEl.className = "tug-inspector-formula-field__name";
    nameEl.textContent = row.field;
    rowEl.appendChild(nameEl);

    // Separator
    const sep = document.createElement("span");
    sep.className = "tug-inspector-row__value--dim";
    sep.textContent = " = ";
    rowEl.appendChild(sep);

    // Value
    const valueEl = document.createElement("span");
    valueEl.className = "tug-inspector-formula-field__value";
    valueEl.textContent = String(row.value);
    rowEl.appendChild(valueEl);

    // Property type label
    const typeEl = document.createElement("span");
    typeEl.className = "tug-inspector-formula-field__type";
    typeEl.textContent = row.property;
    rowEl.appendChild(typeEl);

    // Structural label
    if (row.isStructural) {
      const releaseLabel = document.createElement("span");
      releaseLabel.className = "tug-inspector-formula__release-label";
      releaseLabel.textContent = "(applies on release)";
      rowEl.appendChild(releaseLabel);
    }

    section.appendChild(rowEl);
  }

  return section;
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
// Module-level reverse map singleton
// ---------------------------------------------------------------------------

/** Lazily-built module-level reverse map singleton. [D03] Singleton reverse map */
let cachedReverseMap: ReverseMap | null = null;

/**
 * Return the module-level reverse map singleton, building it on first call.
 * [D03] Singleton reverse map — built once per session from RULES, reused across
 * card open/close cycles.
 */
export function getReverseMap(): ReverseMap {
  if (!cachedReverseMap) {
    cachedReverseMap = buildReverseMap(RULES);
  }
  return cachedReverseMap;
}

// ---------------------------------------------------------------------------
// CSS rule inspection helpers (module-level, used by extracted functions)
// ---------------------------------------------------------------------------

/**
 * Property-to-shorthand lookup for CSS rule inspection.
 * When looking for a longhand property like 'background-color', also
 * check shorthands like 'background' that may contain the var() reference.
 */
const SHORTHAND_MAP: Record<string, string[]> = {
  "background-color": ["background-color", "background"],
  color: ["color"],
  "border-color": ["border-color", "border"],
};

/**
 * Recursively walk a CSSRuleList, calling `onMatch` for every rule that
 * matches `el` and sets one of `propsToCheck` to a var() value.
 *
 * Each rule access is individually try/caught so a single bad rule
 * (unusual @-rule, cross-origin nested sheet, etc.) never aborts the
 * traversal of the rest of the list.
 */
function walkRulesForToken(
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
        walkRulesForToken(nested, el, propsToCheck, varPattern, onMatch);
      }
    }
  }
}

/**
 * Recursively walk CSS rules looking for any rule that defines a given
 * custom property. Calls onFound with the declared value.
 */
function walkRulesForPropertyDef(
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
        walkRulesForPropertyDef(nested, property, onFound);
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
function findPropertyValueInRules(property: string): string {
  let lastValue = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walkRulesForPropertyDef(sheet.cssRules, property, (val) => {
        lastValue = val;
      });
    } catch {
      continue;
    }
  }
  return lastValue;
}

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
function findTokenFromCSSRules(
  el: HTMLElement,
  property: string
): string | null {
  const propsToCheck = SHORTHAND_MAP[property] ?? [property];
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

      walkRulesForToken(topRules, current, propsToCheck, varPattern, (token) => {
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
 * Detect the component token family for an element.
 * Checks the element's classList and walks up to 5 ancestors.
 *
 * Spec S03 step 1-2 (#s03-inspected-properties)
 */
function detectCompFamily(el: HTMLElement): string | null {
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
function valuesMatch(tokenVal: string, computedVal: string, _property: string): boolean {
  return tokenVal.trim() === computedVal.trim();
}

// ---------------------------------------------------------------------------
// Exported standalone functions
// ---------------------------------------------------------------------------

/**
 * Try to convert an oklch() color string to --tug-color() notation.
 * Returns null if the string isn't a simple oklch(L C h) value
 * (e.g., contains calc() expressions).
 */
export function tryFormatTugColor(colorStr: string): string | null {
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
export function resolveTokenChain(startProperty: string): TokenChainHop[] {
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
      rawValue = findPropertyValueInRules(currentProp);
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
 * Resolve the full token chain for a CSS property on an element.
 * Identifies the originating comp or base token and walks var() references.
 *
 * Spec S02 (#s02-token-chain-algorithm), Spec S03 (#s03-inspected-properties)
 *
 * @param el - The inspected element
 * @param property - The CSS property name (e.g. "background-color")
 * @param computedValue - The element's computed value for the property
 */
export function resolveTokenChainForProperty(
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
  const cssToken = findTokenFromCSSRules(el, property);
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
    const compFamily = detectCompFamily(el);
    if (compFamily) {
      const tokens = COMP_FAMILY_TOKENS[compFamily] ?? [];
      for (const token of tokens) {
        const tokenVal = getComputedStyle(document.body).getPropertyValue(token).trim();
        if (tokenVal && valuesMatch(tokenVal, computedValue, property)) {
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
      if (tokenVal && valuesMatch(tokenVal, computedValue, property)) {
        result.originToken = token;
        result.originLayer = "base";
        break;
      }
    }
  }

  // Step 5: Walk the chain from the origin token
  if (result.originToken) {
    const chain = resolveTokenChain(result.originToken);
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
 * Extract TugColor provenance from a palette variable name.
 * Reads canonical-l, peak-c, and h constants from document.body.
 *
 * Spec S04 (#s04-tug-color-provenance)
 */
export function extractTugColorProvenance(tokenName: string): TugColorProvenance | null {
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

/**
 * Build a short DOM path string for the inspected element.
 * Shows up to 3 ancestors in the form: div.parent > span.child > button.el
 */
export function buildDomPath(el: HTMLElement): string {
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
 * Build formula rows data from token chains and formulas data.
 *
 * Looks up the terminal token for each chain (bg, fg, border) in the reverse map,
 * collects formula rows, deduplicates by field name, and returns structured data.
 *
 * @param bgChain - Token chain result for background-color
 * @param fgChain - Token chain result for color
 * @param borderChain - Token chain result for border-color
 * @param formulasData - Formulas data fetched from the dev server
 * @param reverseMap - The reverse map to look up token-to-field mappings
 */
export function buildFormulaRows(
  bgChain: TokenChainResult,
  fgChain: TokenChainResult,
  borderChain: TokenChainResult,
  formulasData: FormulasData,
  reverseMap: ReverseMap
): FormulaRow[] {
  const allRows: FormulaRow[] = [];
  const seenFields = new Set<string>();

  const chains = [bgChain, fgChain, borderChain];
  for (const chainResult of chains) {
    if (!chainResult.originToken) continue;

    // Get terminal token: last hop's property if chain is non-empty, otherwise originToken.
    let terminalToken: string;
    if (chainResult.chain.length > 0) {
      terminalToken = chainResult.chain[chainResult.chain.length - 1].property;
    } else {
      terminalToken = chainResult.originToken;
    }

    const mappings = reverseMap.tokenToFields.get(terminalToken);
    if (!mappings) continue;

    // Determine if this is a structural token:
    // structural = terminal value doesn't start with 'oklch(' AND token doesn't match palette
    // AND chain doesn't end at palette.
    const terminalValue = chainResult.terminalValue ?? "";
    const isStructural =
      !terminalValue.startsWith("oklch(") &&
      !PALETTE_VAR_REGEX.test(terminalToken) &&
      !chainResult.endsAtPalette;

    for (const mapping of mappings) {
      if (seenFields.has(mapping.field)) continue;
      seenFields.add(mapping.field);

      const rawValue = formulasData.formulas[mapping.field];
      if (rawValue === undefined) continue;

      allRows.push({
        field: mapping.field,
        value: rawValue,
        property: mapping.property,
        isStructural,
      });
    }
  }

  return allRows;
}

