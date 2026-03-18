#!/usr/bin/env bun
/**
 * token-audit.ts — Mechanical token audit tooling for the tugways design system.
 *
 * Subcommands:
 *   tokens     Extract all --tug-base-* tokens from tug-base-generated.css and
 *              classify each as element / surface / chromatic / non-color.
 *   pairings   Parse all component CSS files and extract every
 *              foreground-on-background pairing (color/fill on background-color).
 *   rename     Bulk-rename tokens across all files (dry-run by default).
 *   inject     Generate and insert @tug-pairings comment blocks into CSS files.
 *   verify     Cross-check @tug-pairings blocks against element-surface-pairing-map.ts.
 *
 * Usage:
 *   bun run scripts/token-audit.ts tokens
 *   bun run scripts/token-audit.ts pairings
 *   bun run scripts/token-audit.ts rename [--apply]
 *   bun run scripts/token-audit.ts inject [--apply]
 *   bun run scripts/token-audit.ts verify
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const TUGDECK = path.resolve(import.meta.dir, "..");
const GENERATED_CSS = path.join(TUGDECK, "styles/tug-base-generated.css");
const TUGWAYS = path.join(TUGDECK, "src/components/tugways");
const PAIRING_MAP_PATH = path.join(TUGWAYS, "element-surface-pairing-map.ts");

/** All 23 component CSS files in scope for audit. */
const COMPONENT_CSS_FILES = [
  "tug-button.css",
  "tug-card.css",
  "tug-tab.css",
  "tug-menu.css",
  "tug-dialog.css",
  "tug-badge.css",
  "tug-switch.css",
  "tug-checkbox.css",
  "tug-input.css",
  "tug-label.css",
  "tug-marquee.css",
  "tug-data.css",
  "tug-code.css",
  "tug-dock.css",
  "tug-hue-strip.css",
  "tug-skeleton.css",
  "tug-inspector.css",
  "style-inspector-overlay.css",
  "cards/gallery-card.css",
  "cards/gallery-badge-mockup.css",
  "cards/gallery-popup-button.css",
  "cards/gallery-palette-content.css",
  "cards/gallery-theme-generator-content.css",
].map((f) => path.join(TUGWAYS, f));

// ---------------------------------------------------------------------------
// Token classification (Spec S01 from the plan)
// ---------------------------------------------------------------------------

type TokenClass = "element" | "surface" | "chromatic" | "non-color";

/** Explicit chromatic (dual-use) token short names (after --tug-base- prefix). */
const CHROMATIC_TOKENS = new Set([
  "accent-default",
  "accent-cool-default",
  "accent-subtle",
  // Bare tone-* (7 families)
  "tone-accent",
  "tone-active",
  "tone-agent",
  "tone-data",
  "tone-success",
  "tone-caution",
  "tone-danger",
  // Highlight
  "highlight-hover",
  "highlight-dropTarget",
  "highlight-preview",
  "highlight-inspectorTarget",
  "highlight-snapGuide",
  "highlight-flash",
  // Overlay
  "overlay-dim",
  "overlay-scrim",
  "overlay-highlight",
  // Toggle track
  "toggle-track-off",
  "toggle-track-off-hover",
  "toggle-track-on",
  "toggle-track-on-hover",
  "toggle-track-disabled",
  "toggle-track-mixed",
  "toggle-track-mixed-hover",
  // Toggle thumb
  "toggle-thumb",
  "toggle-thumb-disabled",
  // Radio
  "radio-dot",
  // Field tone
  "field-tone-danger",
  "field-tone-caution",
  "field-tone-success",
]);

/** Non-color pattern segments — tokens containing these are excluded from color classification. */
const NON_COLOR_PATTERNS = [
  "size-",
  "radius-",
  "space-",
  "font-",
  "motion-",
  "chrome-height",
  "opacity",
  "easing",
  "duration",
  "line-height",
];

function classifyToken(shortName: string): TokenClass {
  // Phase 1: exclude non-color tokens
  for (const pattern of NON_COLOR_PATTERNS) {
    if (shortName.includes(pattern)) return "non-color";
  }

  // Phase 2: classify color tokens

  // Check chromatic first (explicit list takes priority)
  if (CHROMATIC_TOKENS.has(shortName)) return "chromatic";

  // Surface: contains -bg- or starts/ends with bg, or contains surface-
  if (
    shortName.includes("-bg-") ||
    shortName.endsWith("-bg") ||
    shortName.startsWith("bg-") ||
    shortName.includes("surface-")
  ) {
    return "surface";
  }

  // Element: contains or starts/ends with fg, border, divider, shadow
  if (
    shortName.includes("-fg-") ||
    shortName.endsWith("-fg") ||
    shortName.startsWith("fg-") ||
    shortName.includes("-border-") ||
    shortName.endsWith("-border") ||
    shortName.startsWith("border-") ||
    shortName.includes("-divider-") ||
    shortName.endsWith("-divider") ||
    shortName.startsWith("divider-") ||
    shortName.includes("-shadow-") ||
    shortName.endsWith("-shadow") ||
    shortName.startsWith("shadow-")
  ) {
    return "element";
  }

  // Element: icon-* color tokens (but not icon-size-*, already excluded)
  if (
    shortName.startsWith("icon-") ||
    shortName.includes("-icon-") ||
    shortName.endsWith("-icon")
  ) {
    return "element";
  }

  // Element: checkmark, checkmark-mixed
  if (shortName.startsWith("checkmark")) return "element";

  // Element: separator
  if (shortName === "separator") return "element";

  return "unclassified" as TokenClass;
}

// ---------------------------------------------------------------------------
// Subcommand: tokens
// ---------------------------------------------------------------------------

interface TokenEntry {
  /** Full CSS custom property name, e.g., --tug-base-fg-default */
  fullName: string;
  /** Short name after --tug-base- prefix, e.g., fg-default */
  shortName: string;
  /** The raw CSS value */
  value: string;
  /** Classification */
  classification: TokenClass;
}

function extractTokens(): TokenEntry[] {
  const css = fs.readFileSync(GENERATED_CSS, "utf-8");
  const tokens: TokenEntry[] = [];
  const re = /^\s*(--tug-base-[\w-]+)\s*:\s*(.+?)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const fullName = m[1];
    const shortName = fullName.replace("--tug-base-", "");
    tokens.push({
      fullName,
      shortName,
      value: m[2],
      classification: classifyToken(shortName),
    });
  }
  return tokens;
}

function cmdTokens(): void {
  const tokens = extractTokens();
  const byClass = new Map<string, TokenEntry[]>();
  for (const t of tokens) {
    const list = byClass.get(t.classification) ?? [];
    list.push(t);
    byClass.set(t.classification, list);
  }

  console.log(`\n=== Token Inventory ===`);
  console.log(`Total tokens: ${tokens.length}\n`);

  for (const cls of ["surface", "element", "chromatic", "non-color", "unclassified"]) {
    const list = byClass.get(cls) ?? [];
    if (list.length === 0) continue;
    console.log(`--- ${cls.toUpperCase()} (${list.length}) ---`);
    for (const t of list) {
      console.log(`  ${t.shortName}`);
    }
    console.log();
  }

  const unclassified = byClass.get("unclassified" as string) ?? [];
  if (unclassified.length > 0) {
    console.log(`\n⚠ ${unclassified.length} UNCLASSIFIED color tokens:`);
    for (const t of unclassified) {
      console.log(`  ${t.fullName}: ${t.value}`);
    }
  } else {
    console.log(`✓ All color tokens classified (zero unclassified)`);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: pairings
// ---------------------------------------------------------------------------

interface AliasMap {
  /** Maps component alias (e.g., --tug-card-bg) → resolved --tug-base-* name */
  [alias: string]: string;
}

interface CssPairing {
  /** Source CSS file (basename) */
  file: string;
  /** CSS selector where this pairing occurs */
  selector: string;
  /** The element (foreground) token as used in the CSS */
  elementRaw: string;
  /** The surface (background) token as used in the CSS */
  surfaceRaw: string;
  /** Resolved element --tug-base-* token (or raw if not resolvable) */
  elementResolved: string;
  /** Resolved surface --tug-base-* token (or raw if not resolvable) */
  surfaceResolved: string;
  /** CSS property for the element (color, fill, border-color) */
  elementProperty: string;
}

/**
 * Parse body {} blocks in a CSS file to extract component alias → token mappings.
 * Handles both direct base refs and alias-to-alias chains:
 *   --tug-card-bg: var(--tug-base-surface-overlay);       (direct)
 *   --tug-tab-bar-bg: var(--tug-card-title-bar-bg-inactive);  (alias chain)
 */
function extractAliases(css: string): AliasMap {
  const aliases: AliasMap = {};
  const bodyBlocks = extractBodyBlocks(css);
  for (const block of bodyBlocks) {
    // Match any var() reference, not just --tug-base-*
    const re = /^\s*(--tug-[\w-]+)\s*:\s*var\((--tug-[\w-]+)\)\s*;/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      aliases[m[1]] = m[2];
    }
  }
  return aliases;
}

/** Extract the content of all body {} blocks from CSS text. */
function extractBodyBlocks(css: string): string[] {
  const blocks: string[] = [];
  // Simple brace-matching for body blocks
  const bodyRe = /\bbody\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(css)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    blocks.push(css.slice(start, i - 1));
  }
  return blocks;
}

/** Resolve a token reference through the alias map, following multi-hop chains. */
function resolveToken(token: string, aliases: AliasMap): string {
  const visited = new Set<string>();
  let current = token;
  while (!current.startsWith("--tug-base-") && !visited.has(current)) {
    visited.add(current);
    const next = aliases[current];
    if (!next) break;
    current = next;
  }
  return current;
}

/**
 * Extract var(--tug-*) references from a CSS value string.
 * Returns the first --tug-* token found.
 */
function extractVarRef(value: string): string | null {
  const m = value.match(/var\((--tug-[\w-]+)/);
  return m ? m[1] : null;
}

/** Properties that carry foreground (element) color. */
const ELEMENT_PROPERTIES = new Set([
  "color",
  "fill",
  "border-color",
  "-webkit-text-fill-color",
]);

/** Properties that carry background (surface) color. */
const SURFACE_PROPERTIES = new Set(["background-color", "background"]);

interface CssRule {
  selector: string;
  properties: Map<string, string>; // property → raw value
}

/**
 * Lightweight CSS rule parser.
 * Extracts selector + properties for every rule block (excluding body {} alias blocks
 * and @keyframes). Does NOT handle nested selectors or @media — these component files
 * are flat.
 */
function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];

  // Remove comments
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove body {} blocks (alias declarations)
  const noBody = stripped.replace(/\bbody\s*\{[^}]*\}/g, "");

  // Remove @keyframes blocks
  const noKeyframes = noBody.replace(/@keyframes\s+[\w-]+\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, "");

  // Parse remaining rules
  const ruleRe = /([^{}]+?)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(noKeyframes)) !== null) {
    const selector = m[1].trim();
    // Skip @-rules
    if (selector.startsWith("@")) continue;

    const propBlock = m[2];
    const properties = new Map<string, string>();
    const propRe = /([\w-]+)\s*:\s*([^;]+);/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(propBlock)) !== null) {
      properties.set(pm[1], pm[2].trim());
    }
    rules.push({ selector, properties });
  }
  return rules;
}

/** Extract the leaf class/element from a CSS selector (the last simple selector). */
function extractLeafClass(selector: string): string | null {
  const parts = selector.split(/\s+/);
  const leaf = parts[parts.length - 1];
  // Strip pseudo-classes/elements/attribute selectors to get the base class
  const base = leaf.replace(/::?[\w-]+(\([^)]*\))*/g, "").replace(/\[[^\]]*\]/g, "");
  return base || null;
}

/** Extract all class names (.foo) from a selector string. */
function extractClassNames(selector: string): string[] {
  const matches = selector.match(/\.([\w-]+)/g) ?? [];
  return matches.map((m) => m.slice(1)); // remove leading dot
}

/** Build an index of rules that set background-color, keyed by the classes in their selectors. */
function buildSurfaceIndex(rules: CssRule[]): Map<string, { token: string; selector: string; specificity: number }[]> {
  const index = new Map<string, { token: string; selector: string; specificity: number }[]>();
  for (const rule of rules) {
    for (const prop of SURFACE_PROPERTIES) {
      const val = rule.properties.get(prop);
      if (!val) continue;
      const token = extractVarRef(val);
      if (!token) continue;
      const classes = extractClassNames(rule.selector);
      const specificity = classes.length; // rough proxy
      for (const cls of classes) {
        const list = index.get(cls) ?? [];
        list.push({ token, selector: rule.selector, specificity });
        index.set(cls, list);
      }
      // Also index by full selector
      const list = index.get(rule.selector) ?? [];
      list.push({ token, selector: rule.selector, specificity });
      index.set(rule.selector, list);
    }
  }
  return index;
}

/**
 * Determine the "rendering context" surface for a given selector.
 * This is the heuristic core: for a rule that sets `color`, what `background-color`
 * is it rendered on?
 *
 * Strategy:
 * 1. If the same rule also sets background-color, use that.
 * 2. Check if a rule with a more specific compound selector (same element + ancestor context)
 *    sets background-color (e.g., `.card-frame[data-focused="true"] .tugcard-title-bar`
 *    provides the bg for `.tugcard-title` which is a child of `.tugcard-title-bar`).
 * 3. Use naming conventions: if element class is `.foo-bar-baz`, check `.foo-bar` as a
 *    likely parent container that might set background-color.
 * 4. Check all ancestor selector prefixes.
 * 5. Fall back to null.
 */
function findSurfaceForSelector(
  selector: string,
  rules: CssRule[],
  surfaceIndex?: Map<string, { token: string; selector: string; specificity: number }[]>,
): { surfaceToken: string; surfaceSelector: string } | null {
  // Strategy 1: Same rule sets background-color
  for (const rule of rules) {
    if (rule.selector === selector) {
      for (const prop of SURFACE_PROPERTIES) {
        const val = rule.properties.get(prop);
        if (val) {
          const token = extractVarRef(val);
          if (token) return { surfaceToken: token, surfaceSelector: selector };
        }
      }
    }
  }

  const idx = surfaceIndex ?? buildSurfaceIndex(rules);

  // Strategy 2: Compound ancestor selector containing the same leaf class
  // E.g., element selector ".tug-button:hover svg" → look for rules targeting
  // ".tug-button:hover" that set background-color
  const selectorParts = selector.split(/\s+/).filter((s) => s !== ">" && s !== "+" && s !== "~");
  // Walk from innermost ancestor outward
  for (let i = selectorParts.length - 2; i >= 0; i--) {
    const ancestorPart = selectorParts[i];
    const ancestorClasses = extractClassNames(ancestorPart);
    for (const cls of ancestorClasses) {
      const entries = idx.get(cls);
      if (!entries) continue;
      // Prefer the most specific match (longest selector containing our ancestor context)
      const contextPrefix = selectorParts.slice(0, i + 1).join(" ");
      // First try: exact prefix match
      for (const e of entries) {
        if (e.selector === contextPrefix || e.selector.endsWith(ancestorPart)) {
          return { surfaceToken: e.token, surfaceSelector: e.selector };
        }
      }
      // Second try: any rule that targets this class
      if (entries.length > 0) {
        // Sort by specificity descending, prefer rules with more context
        const sorted = [...entries].sort((a, b) => b.specificity - a.specificity);
        return { surfaceToken: sorted[0].token, surfaceSelector: sorted[0].selector };
      }
    }
  }

  // Strategy 3: Naming convention — look for parent classes that EXTEND the leaf
  // class name. E.g., ".tugcard-title" → parent could be ".tugcard-title-bar"
  // which sets background-color. This is more specific than truncation, so try first.
  const leafClass = extractLeafClass(selector);
  if (leafClass) {
    const leafClasses = extractClassNames(leafClass);
    for (const cls of leafClasses) {
      for (const [indexCls, entries] of idx) {
        if (indexCls.startsWith(cls + "-") && indexCls !== cls) {
          // Found a parent container (e.g., "tugcard-title-bar" for "tugcard-title")
          const contextParts = selectorParts.slice(0, -1);
          if (contextParts.length > 0) {
            const contextStr = contextParts.join(" ");
            for (const e of entries) {
              if (e.selector.includes(contextStr)) {
                return { surfaceToken: e.token, surfaceSelector: e.selector };
              }
            }
          }
          const sorted = [...entries].sort((a, b) => b.specificity - a.specificity);
          return { surfaceToken: sorted[0].token, surfaceSelector: sorted[0].selector };
        }
      }
    }
  }

  // Strategy 4: Naming convention — truncate the leaf class to find ancestor containers.
  // E.g., ".tugcard-title" → try ".tugcard" which sets background-color.
  if (leafClass) {
    const leafClasses = extractClassNames(leafClass);
    for (const cls of leafClasses) {
      const segments = cls.split("-");
      for (let len = segments.length - 1; len >= 2; len--) {
        const parentCls = segments.slice(0, len).join("-");
        const entries = idx.get(parentCls);
        if (!entries) continue;
        const contextParts = selectorParts.slice(0, -1);
        if (contextParts.length > 0) {
          const contextStr = contextParts.join(" ");
          for (const e of entries) {
            if (e.selector.includes(contextStr)) {
              return { surfaceToken: e.token, surfaceSelector: e.selector };
            }
          }
        }
        const sorted = [...entries].sort((a, b) => b.specificity - a.specificity);
        return { surfaceToken: sorted[0].token, surfaceSelector: sorted[0].selector };
      }
    }
  }

  return null;
}

/** Build a global alias map from all component CSS files. */
function buildGlobalAliases(): AliasMap {
  const aliases: AliasMap = {};
  for (const file of COMPONENT_CSS_FILES) {
    if (!fs.existsSync(file)) continue;
    const css = fs.readFileSync(file, "utf-8");
    Object.assign(aliases, extractAliases(css));
  }
  return aliases;
}

function cmdPairings(): void {
  const allPairings: CssPairing[] = [];
  // Build a global alias map from ALL files first (handles cross-file alias chains)
  const globalAliases = buildGlobalAliases();

  for (const file of COMPONENT_CSS_FILES) {
    if (!fs.existsSync(file)) {
      console.warn(`⚠ File not found: ${file}`);
      continue;
    }
    const css = fs.readFileSync(file, "utf-8");
    const basename = path.relative(TUGWAYS, file);

    // Parse rules
    const rules = parseRules(css);
    const surfaceIdx = buildSurfaceIndex(rules);

    // For each rule, find element properties and pair with surface
    for (const rule of rules) {
      for (const [prop, val] of rule.properties) {
        if (!ELEMENT_PROPERTIES.has(prop)) continue;
        const elementToken = extractVarRef(val);
        if (!elementToken) continue;

        // Find the surface this element renders on
        const surface = findSurfaceForSelector(rule.selector, rules, surfaceIdx);
        if (!surface) {
          allPairings.push({
            file: basename,
            selector: rule.selector,
            elementRaw: elementToken,
            surfaceRaw: "(inherited — needs manual check)",
            elementResolved: resolveToken(elementToken, globalAliases),
            surfaceResolved: "(unknown)",
            elementProperty: prop,
          });
          continue;
        }

        allPairings.push({
          file: basename,
          selector: rule.selector,
          elementRaw: elementToken,
          surfaceRaw: surface.surfaceToken,
          elementResolved: resolveToken(elementToken, globalAliases),
          surfaceResolved: resolveToken(surface.surfaceToken, globalAliases),
          elementProperty: prop,
        });
      }

      // Also check for border shorthand (border: 1px solid var(--tug-*))
      const borderVal = rule.properties.get("border");
      if (borderVal) {
        const token = extractVarRef(borderVal);
        if (token) {
          const surface = findSurfaceForSelector(rule.selector, rules, surfaceIdx);
          allPairings.push({
            file: basename,
            selector: rule.selector,
            elementRaw: token,
            surfaceRaw: surface?.surfaceToken ?? "(inherited)",
            elementResolved: resolveToken(token, globalAliases),
            surfaceResolved: surface
              ? resolveToken(surface.surfaceToken, globalAliases)
              : "(unknown)",
            elementProperty: "border",
          });
        }
      }
    }
  }

  // Deduplicate by resolved element + surface pair
  const seen = new Set<string>();
  const deduped: CssPairing[] = [];
  for (const p of allPairings) {
    const key = `${p.elementResolved}||${p.surfaceResolved}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }

  // Output
  console.log(`\n=== Pairing Audit ===`);
  console.log(`Total raw pairings found: ${allPairings.length}`);
  console.log(`Unique resolved pairings: ${deduped.length}\n`);

  // Group by file
  const byFile = new Map<string, CssPairing[]>();
  for (const p of allPairings) {
    const list = byFile.get(p.file) ?? [];
    list.push(p);
    byFile.set(p.file, list);
  }

  for (const [file, pairings] of byFile) {
    console.log(`--- ${file} (${pairings.length} pairings) ---`);
    for (const p of pairings) {
      const resolvedEl = p.elementResolved.replace("--tug-base-", "");
      const resolvedSf = p.surfaceResolved.replace("--tug-base-", "");
      console.log(
        `  ${p.elementProperty.padEnd(16)} ${resolvedEl.padEnd(45)} on  ${resolvedSf}`,
      );
      if (p.selector) {
        console.log(`    ${"".padEnd(16)} selector: ${p.selector}`);
      }
    }
    console.log();
  }

  // Compare against existing pairing map
  const mapPairings = loadPairingMap();
  if (mapPairings) {
    const mapKeys = new Set(
      mapPairings.map((p) => `${p.element}||${p.surface}`),
    );
    const cssKeys = new Set(
      deduped
        .filter((p) => !p.surfaceResolved.startsWith("("))
        .map((p) => `${p.elementResolved}||${p.surfaceResolved}`),
    );

    const gaps: CssPairing[] = [];
    for (const p of deduped) {
      if (p.surfaceResolved.startsWith("(")) continue;
      const key = `${p.elementResolved}||${p.surfaceResolved}`;
      if (!mapKeys.has(key)) gaps.push(p);
    }

    const orphans: { element: string; surface: string }[] = [];
    for (const mp of mapPairings) {
      const key = `${mp.element}||${mp.surface}`;
      if (!cssKeys.has(key)) orphans.push(mp);
    }

    console.log(`\n=== Gap Analysis ===`);
    console.log(`Pairings in CSS but NOT in pairing map (gaps): ${gaps.length}`);
    for (const g of gaps) {
      console.log(
        `  ${g.elementResolved.replace("--tug-base-", "").padEnd(45)} on  ${g.surfaceResolved.replace("--tug-base-", "")}  [${g.file}]`,
      );
    }

    console.log(
      `\nPairings in map but NOT found in CSS (orphans): ${orphans.length}`,
    );
    if (orphans.length > 0 && orphans.length <= 20) {
      for (const o of orphans) {
        console.log(
          `  ${o.element.replace("--tug-base-", "").padEnd(45)} on  ${o.surface.replace("--tug-base-", "")}`,
        );
      }
    } else if (orphans.length > 20) {
      console.log(`  (showing first 20)`);
      for (const o of orphans.slice(0, 20)) {
        console.log(
          `  ${o.element.replace("--tug-base-", "").padEnd(45)} on  ${o.surface.replace("--tug-base-", "")}`,
        );
      }
    }

    // Flag the known critical gap
    const criticalGap = gaps.find(
      (g) =>
        g.elementResolved === "--tug-base-fg-default" &&
        g.surfaceResolved === "--tug-base-tab-bg-active",
    );
    if (criticalGap) {
      console.log(
        `\n⚠ CRITICAL GAP CONFIRMED: fg-default on tab-bg-active (card title bar)`,
      );
    }
  }

  // Report unresolved pairings
  const unresolved = allPairings.filter((p) =>
    p.surfaceResolved.startsWith("("),
  );
  if (unresolved.length > 0) {
    console.log(`\n=== Unresolved Pairings (need manual check) ===`);
    console.log(`Count: ${unresolved.length}`);
    for (const p of unresolved) {
      console.log(
        `  ${p.file}: ${p.elementRaw} (${p.elementProperty}) — no background-color found in context`,
      );
      console.log(`    selector: ${p.selector}`);
    }
  }
}

/** Load the existing pairing map entries from element-surface-pairing-map.ts. */
function loadPairingMap(): { element: string; surface: string }[] | null {
  if (!fs.existsSync(PAIRING_MAP_PATH)) return null;
  const src = fs.readFileSync(PAIRING_MAP_PATH, "utf-8");
  const entries: { element: string; surface: string }[] = [];
  const re = /element:\s*"(--tug-base-[\w-]+)"[\s\S]*?surface:\s*"(--tug-base-[\w-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    entries.push({ element: m[1], surface: m[2] });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Subcommand: rename
// ---------------------------------------------------------------------------

/**
 * The rename map: old short name → new short name.
 * Based on Table T01 from the plan.
 */
const RENAME_MAP: Record<string, string> = {
  "field-fg": "field-fg-default",
  "field-placeholder": "field-fg-placeholder",
  "field-label": "field-fg-label",
  "field-required": "field-fg-required",
  checkmark: "checkmark-fg",
  "checkmark-mixed": "checkmark-fg-mixed",
  separator: "divider-separator",
};

/** Files to search for token references during rename. */
function getRenameTargetFiles(): string[] {
  const files: string[] = [];

  // Component CSS files
  files.push(...COMPONENT_CSS_FILES);

  // Generated CSS
  files.push(GENERATED_CSS);

  // Theme CSS files
  const themesDir = path.join(TUGDECK, "styles/themes");
  if (fs.existsSync(themesDir)) {
    for (const f of fs.readdirSync(themesDir)) {
      if (f.endsWith(".css")) files.push(path.join(themesDir, f));
    }
  }

  // TypeScript source files
  const tsGlobs = [
    "src/components/tugways/derivation-rules.ts",
    "src/components/tugways/theme-derivation-engine.ts",
    "src/components/tugways/element-surface-pairing-map.ts",
    "src/__tests__/theme-derivation-engine.test.ts",
    "src/__tests__/contrast-dashboard.test.tsx",
    "src/__tests__/gallery-theme-generator-content.test.tsx",
  ];
  for (const g of tsGlobs) {
    const full = path.join(TUGDECK, g);
    if (fs.existsSync(full)) files.push(full);
  }

  // cards/*.tsx files
  const cardsDir = path.join(TUGWAYS, "cards");
  if (fs.existsSync(cardsDir)) {
    for (const f of fs.readdirSync(cardsDir)) {
      if (f.endsWith(".tsx") || f.endsWith(".ts")) {
        files.push(path.join(cardsDir, f));
      }
    }
  }

  // Token generation script
  files.push(path.join(TUGDECK, "scripts/generate-tug-tokens.ts"));

  return [...new Set(files)]; // dedupe
}

function cmdRename(apply: boolean): void {
  console.log(`\n=== Token Rename ${apply ? "(APPLYING)" : "(DRY RUN)"} ===\n`);

  const files = getRenameTargetFiles();
  const changes: { file: string; count: number; replacements: string[] }[] = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, "utf-8");
    let modified = false;
    const replacements: string[] = [];
    let count = 0;

    for (const [oldShort, newShort] of Object.entries(RENAME_MAP)) {
      // Replace in CSS custom property names: --tug-base-{old}
      const oldFull = `--tug-base-${oldShort}`;
      const newFull = `--tug-base-${newShort}`;

      // Use word-boundary-aware replacement to avoid partial matches.
      // In CSS/TS, token names are delimited by: `, ;, ), :, whitespace, or end-of-string
      // We need to be careful: "checkmark" should not match "checkmark-mixed"
      // So we match the full token name followed by a non-alphanumeric-non-hyphen char.
      const escapedOld = oldFull.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`${escapedOld}(?=[^\\w-]|$)`, "g");
      const newContent = content.replace(regex, newFull);
      const matchCount = (content.match(regex) || []).length;

      if (matchCount > 0) {
        replacements.push(`  ${oldFull} → ${newFull} (${matchCount} occurrences)`);
        count += matchCount;
        content = newContent;
        modified = true;
      }

      // Also replace in TS map keys where the token name appears as a bare string
      // e.g., in derivation-rules.ts: "field-fg": { ... }
      // or in the pairing map: element: "--tug-base-field-fg"
      const escapedOldShort = oldShort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const bareRegex = new RegExp(
        `"${escapedOldShort}"(?=\\s*:)`,
        "g",
      );
      const bareContent = content.replace(bareRegex, `"${newShort}"`);
      const bareCount = (content.match(bareRegex) || []).length;
      if (bareCount > 0) {
        replacements.push(`  "${oldShort}" → "${newShort}" as map key (${bareCount} occurrences)`);
        count += bareCount;
        content = bareContent;
        modified = true;
      }
    }

    if (modified) {
      changes.push({
        file: path.relative(TUGDECK, filePath),
        count,
        replacements,
      });
      if (apply) {
        fs.writeFileSync(filePath, content, "utf-8");
      }
    }
  }

  if (changes.length === 0) {
    console.log("No renames needed — all tokens already use the new names.");
    return;
  }

  for (const ch of changes) {
    console.log(`${ch.file} (${ch.count} replacements):`);
    for (const r of ch.replacements) console.log(r);
    console.log();
  }

  const totalReplacements = changes.reduce((sum, ch) => sum + ch.count, 0);
  console.log(
    `Total: ${totalReplacements} replacements across ${changes.length} files`,
  );

  if (!apply) {
    console.log(`\nThis was a DRY RUN. Use --apply to write changes.`);
  } else {
    console.log(`\n✓ All changes written.`);
    console.log(`Next: run 'bun run generate:tokens' to regenerate CSS.`);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: inject
// ---------------------------------------------------------------------------

function cmdInject(apply: boolean): void {
  console.log(
    `\n=== Inject @tug-pairings Blocks ${apply ? "(APPLYING)" : "(DRY RUN)"} ===\n`,
  );

  // First, run the pairing extraction to get data
  const globalAliases = buildGlobalAliases();
  const fileData: Map<string, CssPairing[]> = new Map();

  for (const file of COMPONENT_CSS_FILES) {
    if (!fs.existsSync(file)) continue;
    const css = fs.readFileSync(file, "utf-8");
    const basename = path.relative(TUGWAYS, file);
    const rules = parseRules(css);
    const surfaceIdx = buildSurfaceIndex(rules);
    const pairings: CssPairing[] = [];

    for (const rule of rules) {
      for (const [prop, val] of rule.properties) {
        if (!ELEMENT_PROPERTIES.has(prop)) continue;
        const elementToken = extractVarRef(val);
        if (!elementToken) continue;

        const surface = findSurfaceForSelector(rule.selector, rules, surfaceIdx);
        if (!surface) continue; // skip unresolvable

        pairings.push({
          file: basename,
          selector: rule.selector,
          elementRaw: elementToken,
          surfaceRaw: surface.surfaceToken,
          elementResolved: resolveToken(elementToken, globalAliases),
          surfaceResolved: resolveToken(surface.surfaceToken, globalAliases),
          elementProperty: prop,
        });
      }

      // Border shorthand
      const borderVal = rule.properties.get("border");
      if (borderVal) {
        const token = extractVarRef(borderVal);
        if (token) {
          const surface = findSurfaceForSelector(rule.selector, rules, surfaceIdx);
          if (surface) {
            pairings.push({
              file: basename,
              selector: rule.selector,
              elementRaw: token,
              surfaceRaw: surface.surfaceToken,
              elementResolved: resolveToken(token, globalAliases),
              surfaceResolved: resolveToken(surface.surfaceToken, globalAliases),
              elementProperty: "border",
            });
          }
        }
      }
    }

    // Deduplicate within file
    const seen = new Set<string>();
    const deduped: CssPairing[] = [];
    for (const p of pairings) {
      const key = `${p.elementResolved}||${p.surfaceResolved}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(p);
      }
    }

    fileData.set(file, deduped);
  }

  // Generate and inject comment blocks
  let injectedCount = 0;
  for (const [file, pairings] of fileData) {
    if (pairings.length === 0) {
      console.log(`${path.relative(TUGWAYS, file)}: no pairings found, skipping`);
      continue;
    }

    // Build the @tug-pairings comment block
    const lines: string[] = [];
    lines.push("/**");
    lines.push(" * @tug-pairings");
    lines.push(
      " * | Element                                          | Surface                                          | Role         | Context                              |",
    );
    lines.push(
      " * |--------------------------------------------------|--------------------------------------------------|--------------|--------------------------------------|",
    );
    for (const p of pairings) {
      const elAlias = p.elementRaw;
      const elBase = p.elementResolved.replace("--tug-base-", "");
      const sfAlias = p.surfaceRaw;
      const sfBase = p.surfaceResolved.replace("--tug-base-", "");
      const role = guessRole(elBase, p.elementProperty);
      const context = `${p.selector} (${p.elementProperty})`;

      const elCol = `${elAlias} (${elBase})`.padEnd(48);
      const sfCol = `${sfAlias} (${sfBase})`.padEnd(48);
      const roleCol = role.padEnd(12);
      lines.push(` * | ${elCol} | ${sfCol} | ${roleCol} | ${context.padEnd(36)} |`);
    }
    lines.push(" */");
    const block = lines.join("\n");

    if (!apply) {
      console.log(`${path.relative(TUGWAYS, file)}: would inject ${pairings.length} pairings`);
    } else {
      let css = fs.readFileSync(file, "utf-8");

      // Remove existing @tug-pairings block if present
      css = css.replace(/\/\*\*[\s\S]*?@tug-pairings[\s\S]*?\*\/\n?/, "");

      // Insert after the file-level docblock comment (first */ found)
      const docblockEnd = css.indexOf("*/");
      if (docblockEnd !== -1) {
        const insertPos = docblockEnd + 2;
        css =
          css.slice(0, insertPos) +
          "\n\n" +
          block +
          "\n" +
          css.slice(insertPos);
      } else {
        // No docblock — insert at top
        css = block + "\n\n" + css;
      }

      fs.writeFileSync(file, css, "utf-8");
      console.log(
        `✓ ${path.relative(TUGWAYS, file)}: injected ${pairings.length} pairings`,
      );
    }
    injectedCount++;
  }

  console.log(`\n${injectedCount} files processed.`);
  if (!apply) {
    console.log(`This was a DRY RUN. Use --apply to write changes.`);
  }
}

/** Heuristic role assignment based on token name and property. */
function guessRole(
  elementShortName: string,
  property: string,
): string {
  if (property === "border" || property === "border-color") return "ui-component";
  if (
    elementShortName.includes("icon-") ||
    elementShortName.startsWith("icon-") ||
    elementShortName.includes("-icon-")
  )
    return "ui-component";
  if (
    elementShortName.includes("divider-") ||
    elementShortName.includes("shadow-") ||
    elementShortName === "separator" ||
    elementShortName === "divider-separator"
  )
    return "decorative";
  if (
    elementShortName.includes("muted") ||
    elementShortName.includes("subtle") ||
    elementShortName.includes("placeholder") ||
    elementShortName.includes("disabled") ||
    elementShortName.includes("readOnly")
  )
    return "subdued-text";
  if (elementShortName.includes("fg-")) return "body-text";
  return "body-text";
}

// ---------------------------------------------------------------------------
// Subcommand: verify
// ---------------------------------------------------------------------------

function cmdVerify(): void {
  console.log(`\n=== Verify Pairings Cross-Check ===\n`);

  // Load pairing map
  const mapPairings = loadPairingMap();
  if (!mapPairings) {
    console.error("ERROR: Could not load element-surface-pairing-map.ts");
    process.exit(1);
  }

  // Parse @tug-pairings blocks from all CSS files
  const cssPairings: { element: string; surface: string; file: string }[] = [];

  for (const file of COMPONENT_CSS_FILES) {
    if (!fs.existsSync(file)) continue;
    const css = fs.readFileSync(file, "utf-8");
    const basename = path.relative(TUGWAYS, file);

    // Find @tug-pairings block
    const blockMatch = css.match(/\/\*\*[\s\S]*?@tug-pairings([\s\S]*?)\*\//);
    if (!blockMatch) {
      console.warn(`⚠ No @tug-pairings block in ${basename}`);
      continue;
    }

    // Parse table rows
    const tableContent = blockMatch[1];
    const rowRe =
      /\|\s*[\w-]+[^|]*\(([\w-]+)\)\s*\|\s*[\w-]+[^|]*\(([\w-]+)\)\s*\|/g;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(tableContent)) !== null) {
      cssPairings.push({
        element: `--tug-base-${m[1]}`,
        surface: `--tug-base-${m[2]}`,
        file: basename,
      });
    }
  }

  console.log(`Pairing map entries: ${mapPairings.length}`);
  console.log(`CSS @tug-pairings entries: ${cssPairings.length}`);

  // Cross-check
  const mapKeys = new Set(mapPairings.map((p) => `${p.element}||${p.surface}`));
  const cssKeys = new Set(cssPairings.map((p) => `${p.element}||${p.surface}`));

  const gaps = cssPairings.filter(
    (p) => !mapKeys.has(`${p.element}||${p.surface}`),
  );
  const orphans = mapPairings.filter(
    (p) => !cssKeys.has(`${p.element}||${p.surface}`),
  );

  if (gaps.length > 0) {
    console.log(`\n⚠ GAPS: ${gaps.length} pairings in CSS but NOT in pairing map:`);
    for (const g of gaps) {
      console.log(
        `  ${g.element.replace("--tug-base-", "").padEnd(45)} on  ${g.surface.replace("--tug-base-", "")}  [${g.file}]`,
      );
    }
  }

  if (orphans.length > 0) {
    console.log(
      `\nℹ ORPHANS: ${orphans.length} pairings in map but NOT in any @tug-pairings block`,
    );
    // This is informational — map entries may include computed/inherited pairings
    // that don't appear in static CSS
  }

  if (gaps.length === 0) {
    console.log(`\n✓ All CSS @tug-pairings entries have corresponding map entries.`);
  }

  // Check all files have blocks
  let filesWithBlock = 0;
  let filesWithout = 0;
  for (const file of COMPONENT_CSS_FILES) {
    if (!fs.existsSync(file)) continue;
    const css = fs.readFileSync(file, "utf-8");
    if (css.includes("@tug-pairings")) {
      filesWithBlock++;
    } else {
      filesWithout++;
      console.log(`  Missing @tug-pairings: ${path.relative(TUGWAYS, file)}`);
    }
  }
  console.log(`\nFiles with @tug-pairings: ${filesWithBlock}/${COMPONENT_CSS_FILES.length}`);

  // Exit code
  if (gaps.length > 0 || filesWithout > 0) {
    process.exit(1);
  }
  console.log(`\n✓ Verification passed.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.slice(1));

switch (command) {
  case "tokens":
    cmdTokens();
    break;
  case "pairings":
    cmdPairings();
    break;
  case "rename":
    cmdRename(flags.has("--apply"));
    break;
  case "inject":
    cmdInject(flags.has("--apply"));
    break;
  case "verify":
    cmdVerify();
    break;
  default:
    console.log(`Usage: bun run scripts/token-audit.ts <command> [flags]

Commands:
  tokens              Extract and classify all --tug-base-* tokens
  pairings            Audit component CSS files for foreground-on-background pairings
  rename [--apply]    Bulk-rename tokens (dry run by default)
  inject [--apply]    Generate @tug-pairings comment blocks (dry run by default)
  verify              Cross-check @tug-pairings blocks against pairing map
`);
    break;
}
