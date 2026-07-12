/**
 * transcript-find-highlighter — the imperative Custom-Highlight painter for the
 * Dev card's Find route.
 *
 * The authoritative match set lives in `DevFindSession` (computed over the
 * whole-transcript index). This painter is the *appearance* half ([L06]): it
 * resolves DOM Ranges for the handful of currently-mounted rows and paints them
 * via the CSS Custom Highlight API — the same mechanism `selection-guard` uses
 * for inactive selection — which is the only way to tint ranges uniformly
 * across the transcript's markdown DOM (a virtualized custom list, not one
 * editor). No React state drives any of this.
 *
 * Two registered highlights: `transcript-find-match` (every mounted match) and
 * `transcript-find-active` (the active one, painted with the stronger
 * find-active surface). Because `CSS.highlights` is a document-global registry,
 * the painter (re)claims the names on every paint, so the most recently-painting
 * card owns them — acceptable while one card searches at a time.
 *
 * Per-row it does NOT trust the index's character offsets: it re-runs the
 * matcher over the row's live DOM `textContent`, so the k-th DOM hit lines up
 * with the k-th index hit ([Q01] guarantees that order agreement). The active
 * match's ordinal within its row selects which DOM hit is the active one.
 *
 * The landing flash is a one-shot **accent ring drawn over the active match's
 * rect only** (a fixed-position overlay element), never the whole row — a large
 * response must not wash the transcript. `paint` and `flashActive` are separate
 * so the host can settle its sticky-clear scroll before the ring is drawn.
 *
 * @module components/tugways/transcript-find-highlighter
 */

import { search, type FindMatch, type FindOptions } from "@/lib/transcript-search";

const MATCH_HIGHLIGHT = "transcript-find-match";
const ACTIVE_HIGHLIGHT = "transcript-find-active";
const FLASH_OVERLAY_CLASS = "tugx-find-flash-overlay";
/** Flash lifetime (mirrors the code-view find-flash window). */
const FLASH_MS = 640;

/** What the painter needs each paint — supplied by the transcript host. */
export interface FindPaintInput {
  matches: readonly FindMatch[];
  activeIndex: number;
  query: string;
  options: FindOptions;
  /** Resolve a row's mounted DOM element, or `null` when windowed out. */
  getElementForIndex: (index: number) => HTMLElement | null;
}

/**
 * True when `node` sits inside a math (`.tugx-katex`) subtree. Math is excluded
 * from search: the placeholder / rendered KaTeX carries the LaTeX source (e.g.
 * `\varepsilon`, which contains "are") as hidden, non-prose text. Excluding it
 * here mirrors the index's exclusion so count ↔ paint stay aligned.
 */
function isInExcludedSubtree(node: Node): boolean {
  let el: HTMLElement | null = node.parentElement;
  while (el !== null) {
    if (el.classList.contains("tugx-katex")) return true;
    el = el.parentElement;
  }
  return false;
}

/** The searchable text nodes of `el`, in order, skipping excluded subtrees. */
function collectSearchableTextNodes(el: HTMLElement): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      isInExcludedSubtree(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  let node = walker.nextNode() as Text | null;
  while (node !== null) {
    nodes.push(node);
    node = walker.nextNode() as Text | null;
  }
  return nodes;
}

/**
 * Build a DOM `Range` spanning `[start, end)` over the concatenation of
 * `nodes` — the same node list (and therefore the same text) the search ran
 * over, so offsets map back exactly.
 */
function rangeFromNodes(nodes: readonly Text[], start: number, end: number): Range | null {
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (const node of nodes) {
    const len = node.data.length;
    if (startNode === null && start < offset + len) {
      startNode = node;
      startOffset = start - offset;
    }
    if (end <= offset + len) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset += len;
  }
  if (startNode === null || endNode === null) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

export class TranscriptFindHighlighter {
  private readonly matchHighlight: Highlight | null;
  private readonly activeHighlight: Highlight | null;
  private activeRange: Range | null = null;
  private flashOverlay: HTMLDivElement | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      this.matchHighlight = new Highlight();
      this.activeHighlight = new Highlight();
    } else {
      this.matchHighlight = null;
      this.activeHighlight = null;
    }
  }

  /** Repaint every mounted match and mark the active one. Does not flash. */
  paint(input: FindPaintInput): void {
    const matchHL = this.matchHighlight;
    const activeHL = this.activeHighlight;
    if (matchHL === null || activeHL === null) return;

    matchHL.clear();
    activeHL.clear();
    this.activeRange = null;

    const { matches, activeIndex, query, options, getElementForIndex } = input;
    if (matches.length === 0 || query === "") {
      CSS.highlights.delete(MATCH_HIGHLIGHT);
      CSS.highlights.delete(ACTIVE_HIGHLIGHT);
      return;
    }

    const activeMatch = activeIndex >= 0 ? matches[activeIndex] : undefined;
    const firstIndexForActiveRow =
      activeMatch !== undefined
        ? matches.findIndex((m) => m.row === activeMatch.row)
        : -1;
    const activeOrdinal =
      activeMatch !== undefined ? activeIndex - firstIndexForActiveRow : -1;

    const rows = new Set<number>();
    for (const m of matches) rows.add(m.row);

    for (const row of rows) {
      const el = getElementForIndex(row);
      if (el === null) continue;
      const nodes = collectSearchableTextNodes(el);
      const text = nodes.map((n) => n.data).join("");
      const domHits = search([text], query, options);
      for (let k = 0; k < domHits.length; k++) {
        const hit = domHits[k];
        const range = rangeFromNodes(nodes, hit.start, hit.end);
        if (range === null) continue;
        // Each match lands in exactly ONE highlight — the active match in the
        // active highlight only, never both, so its colour doesn't composite
        // the match + active tints into a muddier blend.
        if (activeMatch !== undefined && row === activeMatch.row && k === activeOrdinal) {
          activeHL.add(range);
          this.activeRange = range;
        } else {
          matchHL.add(range);
        }
      }
    }

    // (Re)claim the global registry names for this card's highlights.
    CSS.highlights.set(MATCH_HIGHLIGHT, matchHL);
    CSS.highlights.set(ACTIVE_HIGHLIGHT, activeHL);
  }

  /**
   * Viewport rect of the active match's range, or `null` when there is none /
   * it is not currently mounted. Used by the host to reveal the active match
   * clear of sticky chrome before flashing.
   */
  activeRangeRect(): DOMRect | null {
    if (this.activeRange === null) return null;
    const rect = this.activeRange.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  /**
   * One-shot accent-ring flash over the active match's rect only — a
   * fixed-position overlay, so it emphasizes the match without touching the
   * row. Call after the host has settled any reveal scroll.
   */
  flashActive(): void {
    if (typeof document === "undefined") return;
    const rect = this.activeRangeRect();
    if (rect === null) return;
    this.removeFlashOverlay();
    const overlay = document.createElement("div");
    overlay.className = FLASH_OVERLAY_CLASS;
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    document.body.appendChild(overlay);
    this.flashOverlay = overlay;
    this.flashTimer = setTimeout(() => this.removeFlashOverlay(), FLASH_MS);
  }

  private removeFlashOverlay(): void {
    if (this.flashTimer !== null) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    if (this.flashOverlay !== null) {
      this.flashOverlay.remove();
      this.flashOverlay = null;
    }
  }

  /** Drop all paint (empty query / leaving Find). */
  clear(): void {
    this.matchHighlight?.clear();
    this.activeHighlight?.clear();
    this.activeRange = null;
    if (typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      CSS.highlights.delete(MATCH_HIGHLIGHT);
      CSS.highlights.delete(ACTIVE_HIGHLIGHT);
    }
    this.removeFlashOverlay();
  }

  dispose(): void {
    this.clear();
  }
}
