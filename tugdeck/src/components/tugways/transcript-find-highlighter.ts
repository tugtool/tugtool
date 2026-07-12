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
 * **Searchability is opt-in and symmetric.** The painter walks ONLY subtrees
 * marked `data-tugx-findable` — the same containers the index projects, one
 * search unit per container, in DOM order. Within a marked container,
 * `.tugx-katex` (math renders the LaTeX source as hidden text) and
 * `.tug-atom-chip-host` (atom chips render their label inside an SVG)
 * subtrees are excluded; a marked container under a
 * `[data-block-collapsed="true"]` ancestor is skipped entirely (the block's
 * body is unmounted but its header — which may carry marked content — stays,
 * while the index projects nothing for a collapsed block). Unmarked text —
 * tool-block chrome, headers, badges, timing — can never paint, so a future
 * body kind is unsearchable until it is deliberately marked AND projected.
 * **Adding a searchable kind is a two-sided checklist:** stamp the marker on
 * the content container, project the same text (same order) in
 * `transcript-search-index.ts`, and extend the fidelity fixture.
 *
 * Per-unit it does NOT trust the index's character offsets: it re-runs the
 * matcher over each marked container's live DOM text, so the k-th DOM hit in
 * a row (counting across its containers in order) lines up with the k-th
 * index hit. The active match's ordinal within its row selects which DOM hit
 * is the active one. Searching per container also means a match can never
 * span two containers — mirroring `searchRowParts` on the index side.
 *
 * The landing flash is a one-shot **accent ring drawn over the active match's
 * rect only** (a fixed-position overlay element), never the whole row — a large
 * response must not wash the transcript. `paint` and `flashActive` are separate
 * so the host can settle its sticky-clear scroll before the ring is drawn.
 *
 * @module components/tugways/transcript-find-highlighter
 */

import {
  search,
  type FindOptions,
  type SegmentedFindMatch,
} from "@/lib/transcript-search";
import type { FindTargetRegistry } from "@/components/tugways/cards/blocks/find-target-registry";

/** The opt-in searchable-content marker attribute (present/absent, no value). */
export const FINDABLE_ATTR = "data-tugx-findable";

const MATCH_HIGHLIGHT = "transcript-find-match";
const ACTIVE_HIGHLIGHT = "transcript-find-active";
const FLASH_OVERLAY_CLASS = "tugx-find-flash-overlay";
/** Flash lifetime (mirrors the code-view find-flash window). */
const FLASH_MS = 640;

/** What the painter needs each paint — supplied by the transcript host. */
export interface FindPaintInput {
  matches: readonly SegmentedFindMatch[];
  activeIndex: number;
  query: string;
  options: FindOptions;
  /** Resolve a row's mounted DOM element, or `null` when windowed out. */
  getElementForIndex: (index: number) => HTMLElement | null;
  /**
   * The card's find-target registry — resolves `editor`-segment keys to
   * their embedded CodeMirror delegates (and fold openers). Optional so
   * hosts without embedded editors can omit it.
   */
  findTargets?: FindTargetRegistry | null;
}

/**
 * True when `node` sits inside an excluded subtree WITHIN a marked container:
 * `.tugx-katex` (math renders the LaTeX source — e.g. `\varepsilon`, which
 * contains "are" — as hidden, non-prose text) or `.tug-atom-chip-host` (atom
 * chips render their label inside an inline SVG; the index projects atoms as
 * no-text). Excluding both mirrors the index so count ↔ paint stay aligned.
 */
function isInExcludedSubtree(node: Node): boolean {
  let el: HTMLElement | null = node.parentElement;
  while (el !== null) {
    if (
      el.classList.contains("tugx-katex") ||
      el.classList.contains("tug-atom-chip-host")
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * The row's searchable containers — its OUTERMOST `data-tugx-findable`
 * elements, in DOM order, excluding any under a collapsed block
 * (`[data-block-collapsed="true"]`). Each is one search unit, mirroring one
 * projected part on the index side. Nested marked containers are folded into
 * their outermost ancestor so no text is walked twice.
 */
function collectFindableUnits(rowEl: HTMLElement): HTMLElement[] {
  const marked = rowEl.querySelectorAll<HTMLElement>(`[${FINDABLE_ATTR}]`);
  const units: HTMLElement[] = [];
  for (const el of marked) {
    const parent = el.parentElement;
    if (parent !== null && parent.closest(`[${FINDABLE_ATTR}]`) !== null) continue;
    if (el.closest('[data-block-collapsed="true"]') !== null) continue;
    units.push(el);
  }
  return units;
}

/** The searchable text nodes of one unit, in order, skipping excluded subtrees. */
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
  // Editor delegates driven by the LAST paint, so a later paint (or clear)
  // can retract the in-editor highlights of editors that dropped out.
  private touchedEditors = new Set<string>();
  private lastFindTargets: FindTargetRegistry | null = null;

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
    // The DOM-walk ordinal counts only the row's `dom`-segment matches —
    // `editor` matches live inside embedded CodeMirror editors, which paint
    // via their own search, not this walk. An active `editor` match has no
    // DOM-walk ordinal at all.
    const activeIsDom =
      activeMatch !== undefined && activeMatch.segmentKind === "dom";
    const activeOrdinal = activeIsDom
      ? matches
          .filter((m) => m.row === activeMatch!.row && m.segmentKind === "dom")
          .indexOf(activeMatch!)
      : -1;

    const rows = new Set<number>();
    for (const m of matches) {
      if (m.segmentKind === "dom") rows.add(m.row);
    }

    for (const row of rows) {
      const el = getElementForIndex(row);
      if (el === null) continue;
      // One search unit per marked container, in DOM order — the k-th hit
      // across the row's units is the k-th index hit for that row.
      let k = 0;
      for (const unit of collectFindableUnits(el)) {
        const nodes = collectSearchableTextNodes(unit);
        const text = nodes.map((n) => n.data).join("");
        const domHits = search([text], query, options);
        for (const hit of domHits) {
          const range = rangeFromNodes(nodes, hit.start, hit.end);
          const ordinal = k;
          k += 1;
          if (range === null) continue;
          // Each match lands in exactly ONE highlight — the active match in
          // the active highlight only, never both, so its colour doesn't
          // composite the match + active tints into a muddier blend.
          if (
            activeIsDom &&
            row === activeMatch!.row &&
            ordinal === activeOrdinal
          ) {
            activeHL.add(range);
            this.activeRange = range;
          } else {
            matchHL.add(range);
          }
        }
      }
    }

    // Editor segments: matches inside embedded CodeMirror editors are
    // painted by the editor's OWN search (CM6 virtualizes its DOM, so the
    // walk above cannot reach them). Drive each mounted editor's delegate
    // with the same query/options; the active editor match is selected so
    // it wears `.cm-searchMatch-selected` and reveals — the transcript-level
    // ring flash is not used inside editors.
    const findTargets = input.findTargets ?? null;
    this.lastFindTargets = findTargets;
    const nowTouched = new Set<string>();
    if (findTargets !== null) {
      const editorKeys = new Set<string>();
      for (const m of matches) {
        if (m.segmentKind === "editor" && m.segmentKey !== undefined) {
          editorKeys.add(m.segmentKey);
        }
      }
      for (const key of editorKeys) {
        const delegate = findTargets.resolve(key)?.codeView?.() ?? null;
        if (delegate === null) continue;
        delegate.setSearchQuery({
          search: query,
          caseSensitive: options.caseSensitive,
          regexp: options.grep,
          wholeWord: options.wholeWord,
        });
        nowTouched.add(key);
        if (
          activeMatch !== undefined &&
          activeMatch.segmentKind === "editor" &&
          activeMatch.segmentKey === key
        ) {
          const ordinal = matches
            .filter(
              (m) => m.segmentKind === "editor" && m.segmentKey === key,
            )
            .indexOf(activeMatch);
          delegate.selectMatch(ordinal);
        }
      }
      // Retract highlights from editors that no longer hold matches.
      for (const key of this.touchedEditors) {
        if (!nowTouched.has(key)) {
          findTargets.resolve(key)?.codeView?.()?.clearSearch();
        }
      }
    }
    this.touchedEditors = nowTouched;

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
    if (this.lastFindTargets !== null) {
      for (const key of this.touchedEditors) {
        this.lastFindTargets.resolve(key)?.codeView?.()?.clearSearch();
      }
    }
    this.touchedEditors = new Set();
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
