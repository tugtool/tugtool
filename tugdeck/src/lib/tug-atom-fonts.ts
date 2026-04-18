/**
 * tug-atom-fonts.ts — Discover and encode @font-face fonts for inline
 * embedding inside atom data-URI SVGs.
 *
 * A data-URI SVG cannot reach the parent document's @font-face fonts, so
 * atom labels fall back to generic families (Courier for monospace) and
 * don't match the editor. The fix: inline the actual @font-face rule —
 * with the font file base64-encoded as a data URL — inside the SVG's own
 * <style> block. The SVG then resolves the custom family locally.
 *
 * Discovery is dynamic: we scan document.styleSheets for CSSFontFaceRule
 * entries at startup. Any font declared via @font-face is automatically
 * embeddable — no hardcoded list of families.
 *
 * Load order:
 *   1. App boot triggers ensureAtomFontsLoaded().
 *   2. We await document.fonts.ready so the browser has parsed the rules.
 *   3. Each unique (family, weight, style) is fetched and base64-encoded.
 *   4. Subscribers registered via onAtomFontsReady() are fired.
 *   5. The engine calls regenerateAtoms() to repaint existing atoms with
 *      embedded fonts.
 */

export interface LoadedFontFace {
  family: string;
  /** font-weight declaration verbatim (single weight or range e.g. "100 900"). */
  weight: string;
  /** font-style declaration verbatim ("normal" | "italic" | "oblique"). */
  style: string;
  /** data: URL (base64) for embedding inside SVG <style>. */
  dataUrl: string;
  /** SVG-compatible @font-face CSS text, ready to inline. */
  css: string;
}

const _database: LoadedFontFace[] = [];
const _listeners: Array<() => void> = [];
let _loading = false;
let _ready = false;

/** True once ensureAtomFontsLoaded() has finished discovery + fetching. */
export function atomFontsReady(): boolean {
  return _ready;
}

/** Register a callback to run when atom fonts finish loading. Fires
 *  immediately if already loaded. Returns an unsubscribe function. */
export function onAtomFontsReady(cb: () => void): () => void {
  if (_ready) {
    cb();
    return () => {};
  }
  _listeners.push(cb);
  return () => {
    const i = _listeners.indexOf(cb);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

/** Kick off (idempotent) discovery + fetch. Returns a promise that
 *  resolves once all @font-face fonts have been encoded. */
export function ensureAtomFontsLoaded(): Promise<void> {
  if (_ready) return Promise.resolve();
  if (_loading) {
    return new Promise<void>((resolve) => onAtomFontsReady(resolve));
  }
  _loading = true;
  return discoverAndLoad().then(() => {
    _ready = true;
    const pending = _listeners.splice(0);
    for (const cb of pending) cb();
  });
}

/**
 * Look up the first face whose family appears in the given CSS
 * font-family stack and whose weight/style match the requested atom
 * rendering. Returns null if no loaded face matches.
 */
export function findEmbeddableFace(
  familyStack: string,
  weight: number,
  style: "normal" | "italic" = "normal",
): LoadedFontFace | null {
  const names = parseFamilyStack(familyStack);
  for (const name of names) {
    for (const face of _database) {
      if (normalizeFamily(face.family) !== normalizeFamily(name)) continue;
      if (face.style !== style) continue;
      if (weightMatches(face.weight, weight)) return face;
    }
  }
  return null;
}

// ---- Internal ----

async function discoverAndLoad(): Promise<void> {
  // Wait for the browser to finish parsing @font-face rules so the
  // CSSOM is populated.
  try {
    await document.fonts.ready;
  } catch {
    // Ignore — proceed with whatever is in the CSSOM.
  }

  const rules = collectFontFaceRules();
  // Fetch in parallel.
  await Promise.all(rules.map(loadAndCache));
}

function collectFontFaceRules(): CSSFontFaceRule[] {
  const out: CSSFontFaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheet — skip silently.
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) out.push(rule);
    }
  }
  return out;
}

async function loadAndCache(rule: CSSFontFaceRule): Promise<void> {
  const family = rule.style.getPropertyValue("font-family").trim();
  const weight = (rule.style.getPropertyValue("font-weight") || "400").trim();
  const style = (rule.style.getPropertyValue("font-style") || "normal").trim() as "normal" | "italic";
  const src = rule.style.getPropertyValue("src");

  const parsed = parseSrc(src);
  if (!parsed) return;

  // Already cached?
  const key = `${normalizeFamily(family)}|${weight}|${style}`;
  if (_database.some((f) => `${normalizeFamily(f.family)}|${f.weight}|${f.style}` === key)) return;

  try {
    const response = await fetch(parsed.url);
    if (!response.ok) return;
    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const mime = formatToMime(parsed.format);
    const dataUrl = `data:${mime};base64,${base64}`;
    const cleanFamily = family.replace(/^["']|["']$/g, "");
    const css =
      `@font-face{` +
      `font-family:"${cleanFamily}";` +
      `font-weight:${weight};` +
      `font-style:${style};` +
      `src:url(${dataUrl}) format("${parsed.format}");` +
      `}`;
    _database.push({ family: cleanFamily, weight, style, dataUrl, css });
  } catch (err) {
    console.warn("[tug-atom-fonts] failed to load", parsed.url, err);
  }
}

function parseSrc(src: string): { url: string; format: string } | null {
  const urlMatch = src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
  if (!urlMatch) return null;
  const formatMatch = src.match(/format\(\s*["']?([^"')]+)["']?\s*\)/);
  const format = formatMatch ? formatMatch[1].toLowerCase() : "woff2";
  return { url: urlMatch[1], format };
}

function formatToMime(format: string): string {
  switch (format) {
    case "woff2": return "font/woff2";
    case "woff": return "font/woff";
    case "truetype":
    case "ttf": return "font/ttf";
    case "opentype":
    case "otf": return "font/otf";
    default: return "font/woff2";
  }
}

function parseFamilyStack(stack: string): string[] {
  return stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
}

function normalizeFamily(name: string): string {
  return name.toLowerCase().replace(/^["']|["']$/g, "");
}

/** Does the declared weight (single or range) include the requested weight? */
function weightMatches(declared: string, requested: number): boolean {
  const parts = declared.split(/\s+/).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
  if (parts.length === 0) return true; // "normal"/"bold" keywords — accept
  if (parts.length === 1) return parts[0] === requested;
  return requested >= parts[0] && requested <= parts[1];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // btoa only accepts latin1; chunk to avoid call-stack limits on large fonts.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}
