/**
 * tug-atom-img.ts — Atom rendering as <img> elements with SVG data URIs.
 *
 * Atoms are replaced elements — WebKit treats them as atomic inline units.
 * Caret navigation, selection, undo, and clipboard all work natively.
 * No contentEditable="false", no ZWSP, no caret fixup.
 *
 * Each atom is an <img> with data attributes:
 *   data-atom-type, data-atom-label, data-atom-value
 *
 * Colors are hardcoded for now. Step 6 reads from CSS custom properties.
 */

/** Lucide-style icon paths (24x24 viewBox) for atom types */
const ATOM_ICON_PATHS: Record<string, string> = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  command: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  doc: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

/** Shared canvas for text measurement */
let _measureCanvas: HTMLCanvasElement | null = null;

/** Measure text width using Canvas 2D API. */
export function measureTextWidth(text: string, font: string): number {
  if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Create an atom <img> element with SVG data URI. */
export function createAtomImgElement(type: string, label: string, value: string): HTMLImageElement {
  const fontSize = 12;
  const fontFamily = "system-ui, sans-serif";
  const textWidth = measureTextWidth(label, `${fontSize}px ${fontFamily}`);
  const iconSize = 12;
  const padding = 6;
  const gap = 4;
  const w = padding + iconSize + gap + Math.ceil(textWidth) + padding;
  const h = 22;

  const iconPath = ATOM_ICON_PATHS[type] ?? ATOM_ICON_PATHS.file;
  const icon = `<g transform="translate(${padding},${(h - iconSize) / 2}) scale(${iconSize / 24})" fill="none" stroke="#8899aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="3" fill="#2a2f3a" stroke="#4a5568" stroke-width="1"/>`,
    icon,
    `<text x="${padding + iconSize + gap}" y="${h / 2 + fontSize * 0.36}" font-size="${fontSize}" font-family="${fontFamily}" fill="#c8d0dc">${label}</text>`,
    `</svg>`,
  ].join("");

  const img = document.createElement("img");
  img.src = "data:image/svg+xml," + encodeURIComponent(svg);
  img.height = h;
  img.style.verticalAlign = "-5px";
  img.dataset.atomType = type;
  img.dataset.atomLabel = label;
  img.dataset.atomValue = value;
  return img;
}

/** Create atom img as HTML string (for execCommand insertHTML). */
export function atomImgHTML(type: string, label: string, value?: string): string {
  const el = createAtomImgElement(type, label, value ?? label);
  const wrapper = document.createElement("div");
  wrapper.appendChild(el);
  return wrapper.innerHTML;
}
