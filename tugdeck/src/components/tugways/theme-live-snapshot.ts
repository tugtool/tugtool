export interface LiveResolvedColor {
  L: number;
  C: number;
  h: number;
  alpha: number;
}

export interface LiveTokenEntry {
  name: string;
  rawValue: string;
  resolvedColor: LiveResolvedColor | null;
}

function parseRgbColor(value: string): { r: number; g: number; b: number; alpha: number } | null {
  const match = value.trim().toLowerCase().match(/^rgba?\((.+)\)$/);
  if (!match) return null;
  const body = match[1].trim();
  const [rgbPart, alphaPart] = body.split("/");
  const commaParts = rgbPart.split(",").map((s) => s.trim()).filter(Boolean);
  const components =
    commaParts.length >= 3 ? commaParts : rgbPart.trim().split(/\s+/).filter(Boolean);
  if (components.length < 3) return null;
  const r = Number(components[0]);
  const g = Number(components[1]);
  const b = Number(components[2]);
  const alpha =
    alphaPart !== undefined
      ? Number(alphaPart.trim())
      : components.length >= 4
        ? Number(components[3])
        : 1;
  if ([r, g, b, alpha].some((n) => !Number.isFinite(n))) return null;
  if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return null;
  return { r, g, b, alpha: Math.max(0, Math.min(1, alpha)) };
}

function parseSrgbColorFunction(
  value: string,
): { r: number; g: number; b: number; alpha: number } | null {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^color\(\s*srgb\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*\/\s*([+-]?(?:\d+\.?\d*|\.\d+)))?\s*\)$/);
  if (!match) return null;
  const r01 = Number(match[1]);
  const g01 = Number(match[2]);
  const b01 = Number(match[3]);
  const alpha = match[4] !== undefined ? Number(match[4]) : 1;
  if ([r01, g01, b01, alpha].some((n) => !Number.isFinite(n))) return null;
  if (r01 < 0 || r01 > 1 || g01 < 0 || g01 > 1 || b01 < 0 || b01 > 1) return null;
  return {
    r: Math.round(r01 * 255),
    g: Math.round(g01 * 255),
    b: Math.round(b01 * 255),
    alpha: Math.max(0, Math.min(1, alpha)),
  };
}

function parseHexColor(value: string): { r: number; g: number; b: number; alpha: number } | null {
  const hex = value.trim().toLowerCase();
  const short = hex.match(/^#([0-9a-f]{3})$/);
  if (short) {
    const [r, g, b] = short[1].split("").map((ch) => Number.parseInt(ch + ch, 16));
    return { r, g, b, alpha: 1 };
  }
  const full = hex.match(/^#([0-9a-f]{6})$/);
  if (full) {
    const v = full[1];
    const r = Number.parseInt(v.slice(0, 2), 16);
    const g = Number.parseInt(v.slice(2, 4), 16);
    const b = Number.parseInt(v.slice(4, 6), 16);
    return { r, g, b, alpha: 1 };
  }
  return null;
}

function parseOklchColor(value: string): LiveResolvedColor | null {
  const match = value.trim().toLowerCase().match(/^oklch\((.+)\)$/);
  if (!match) return null;
  const body = match[1].trim();
  const [main, alphaPart] = body.split("/");
  const fields = main.trim().split(/\s+/).filter(Boolean);
  if (fields.length < 3) return null;
  const L = Number(fields[0]);
  const C = Number(fields[1]);
  const h = Number(fields[2]);
  const alpha = alphaPart !== undefined ? Number(alphaPart.trim()) : 1;
  if ([L, C, h, alpha].some((n) => !Number.isFinite(n))) return null;
  return { L, C, h, alpha: Math.max(0, Math.min(1, alpha)) };
}

function resolveColorValueString(value: string): LiveResolvedColor | null {
  const parsedOklch = parseOklchColor(value);
  if (parsedOklch) return parsedOklch;
  const parsedRgb =
    parseRgbColor(value) ?? parseSrgbColorFunction(value) ?? parseHexColor(value);
  if (!parsedRgb) return null;
  return rgbToOklch(parsedRgb.r, parsedRgb.g, parsedRgb.b, parsedRgb.alpha);
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToOklch(r: number, g: number, b: number, alpha: number): LiveResolvedColor {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b2 = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(a * a + b2 * b2);
  let h = (Math.atan2(b2, a) * 180) / Math.PI;
  if (h < 0) h += 360;

  return { L, C, h, alpha };
}

function isPotentialColorLike(rawValue: string): boolean {
  const raw = rawValue.trim().toLowerCase();
  if (!raw) return false;
  return (
    raw.startsWith("--tug-color(") ||
    raw.startsWith("var(") ||
    raw.startsWith("#") ||
    raw.startsWith("rgb(") ||
    raw.startsWith("rgba(") ||
    raw.startsWith("hsl(") ||
    raw.startsWith("hsla(") ||
    raw.startsWith("oklch(") ||
    raw.startsWith("oklab(") ||
    raw.startsWith("color(") ||
    raw === "transparent"
  );
}

function resolveTokenToColor(
  probe: HTMLElement,
  tokenName: string,
): LiveResolvedColor | null {
  probe.style.backgroundColor = `var(${tokenName})`;
  return resolveColorValueString(getComputedStyle(probe).backgroundColor);
}

export function snapshotLiveThemeTokens(
  tokenNames: readonly string[],
  requiredColorTokens: ReadonlySet<string>,
): { entries: LiveTokenEntry[]; resolvedMap: Record<string, LiveResolvedColor> } {
  const entries: LiveTokenEntry[] = [];
  const resolvedMap: Record<string, LiveResolvedColor> = {};
  const style = getComputedStyle(document.body);

  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.left = "-9999px";
  probe.style.top = "-9999px";
  probe.style.width = "1px";
  probe.style.height = "1px";
  probe.style.pointerEvents = "none";
  probe.style.opacity = "0";
  document.body.appendChild(probe);

  try {
    for (const name of tokenNames) {
      const rawValue = style.getPropertyValue(name).trim();
      const shouldResolve = requiredColorTokens.has(name) || isPotentialColorLike(rawValue);
      const resolvedColor = shouldResolve
        ? resolveColorValueString(rawValue) ?? resolveTokenToColor(probe, name)
        : null;
      if (resolvedColor) {
        resolvedMap[name] = resolvedColor;
      }
      entries.push({ name, rawValue, resolvedColor });
    }
  } finally {
    probe.remove();
  }

  return { entries, resolvedMap };
}
