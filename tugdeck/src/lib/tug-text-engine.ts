/**
 * TugTextEngine — document model and input engine for rich text + atom editing.
 *
 * Ported from the T3.0 spike (gallery-text-model-spike.tsx) with tug-atom
 * integration. contentEditable as input capture surface with an owned
 * document model. Inspired by Lexical/CM6 architecture with a
 * UITextInput-inspired API layer.
 *
 * Architecture:
 *   - Document model: flat array of TextSegment | AtomSegment (source of truth)
 *   - Input capture: contentEditable div (browser handles typing, IME)
 *   - MutationObserver: reads browser DOM changes, diffs against model
 *   - DOM reconciler: renders model → DOM, preserves composition node
 *   - Selection: native browser caret (we don't render our own)
 *   - Undo: own stack with immutable snapshots
 *
 * Laws of Tug compliance:
 *   [L06] All text/atom rendering via direct DOM manipulation, no React state
 *   [L07] Engine is a stable ref; handlers access current state via `this`
 *   [L22] Engine is the store; DOM updates happen directly, no React cycle
 *   [L23] Selection preserved during reconcile via save/restore
 *
 * Reference implementations studied: CodeMirror 6 (MIT), Lexical (MIT), ProseMirror (MIT)
 */

import { createAtomDOM } from "@/components/tugways/tug-atom";
import type { AtomSegment } from "@/components/tugways/tug-atom";
import { startOfWord, endOfWord, startOfParagraph, endOfParagraph } from "./tug-text-visible-units";

// ===================================================================
// Types
// ===================================================================

export interface TextSegment { kind: "text"; text: string }
export type { AtomSegment };
export type Segment = TextSegment | AtomSegment;

interface UndoEntry {
  segments: Segment[];
  cursorOffset: number;
}

export type InputAction = "submit" | "newline";

/** Item returned by a completion provider. */
export interface CompletionItem {
  label: string;
  atom: AtomSegment;
}

/** Completion provider: given a query string, return matching items. */
export type CompletionProvider = (query: string) => CompletionItem[];

/** Drop handler: given a FileList from a drag-and-drop, return atoms to insert. */
export type DropHandler = (files: FileList) => AtomSegment[];

// ===================================================================
// TugTextInputDelegate — UITextInput-inspired API
// ===================================================================

/**
 * TugTextInputDelegate — UITextInput-inspired imperative API.
 *
 * Modeled on Apple's UITextInput protocol. This is the contract between
 * the prompt input component and its consumers (e.g., tug-prompt-entry).
 * The interface is proven — UITextInput has been the foundation of text
 * input on iOS/macOS since its inception.
 */
export interface TugTextInputDelegate {
  // --- Document content ---
  /** Full text content with U+FFFC for atoms. */
  getText(): string;
  /** All atom segments in document order. */
  getAtoms(): AtomSegment[];
  /** Whether the document is empty (no text, no atoms). */
  isEmpty(): boolean;

  // --- Selection ---
  /** Current selection as flat offsets. Null if editor is not focused. */
  getSelectedRange(): { start: number; end: number } | null;
  /** Set the selection. If end is omitted, collapses to a cursor at start. */
  setSelectedRange(start: number, end?: number): void;
  /** Whether an IME composition is in progress. */
  readonly hasMarkedText: boolean;
  /** Segment indices of atoms currently highlighted (two-step delete pending). */
  getHighlightedAtomIndices(): readonly number[];
  /** Set which atoms are highlighted. Pass [] to clear. */
  setHighlightedAtomIndices(indices: number[]): void;

  // --- Mutation ---
  /** Insert plain text at the current selection (replaces selection if ranged). */
  insertText(text: string): void;
  /** Insert an atom at the current selection (replaces selection if ranged). */
  insertAtom(atom: AtomSegment): void;
  /** Delete content in flat offset range [start, end). Returns cursor position after deletion. */
  deleteRange(start: number, end: number): number;
  /** Delete backward from the current selection (backspace). Deletes range if selection is ranged. */
  deleteBackward(): void;
  /** Delete forward from the current selection (forward delete). Deletes range if selection is ranged. */
  deleteForward(): void;
  /** Delete word backward (Option+Delete). */
  deleteWordBackward(): void;
  /** Delete word forward (Option+Fn+Delete). */
  deleteWordForward(): void;
  /** Delete to paragraph start. */
  deleteParagraphBackward(): void;
  /** Delete to paragraph end. */
  deleteParagraphForward(): void;
  /** Select all content. */
  selectAll(): void;
  /** Clear all content. */
  clear(): void;
  /** Kill line: delete to paragraph end, save to kill ring (Ctrl+K). */
  killLine(): void;
  /** Yank: paste from kill ring (Ctrl+Y). */
  yank(): void;
  /** Transpose characters around cursor (Ctrl+T). */
  transpose(): void;
  /** Open line: insert newline, cursor stays (Ctrl+O). */
  openLine(): void;

  // --- Undo ---
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): void;
  redo(): void;

  // --- Focus ---
  focus(): void;

  // --- State management ---
  /** Restore editing state from a snapshot. Resets undo history. */
  restoreState(state: TugTextEditingState): void;

  // --- Testing ---
  /** Flush pending MutationObserver records synchronously. Call after execCommand. */
  flushMutations(): void;
  /** The contentEditable DOM element. For test harness event dispatch. */
  getEditorElement(): HTMLDivElement | null;
}

// ===================================================================
// TugTextEditingState — serializable editing state snapshot
// ===================================================================

/**
 * TugTextEditingState — complete serializable snapshot of editing state.
 *
 * Used for:
 * - Persistence via tugbank (survives reload, app quit) [L23]
 * - Test harness: incoming/outgoing state for TEOI triples
 * - State comparison: simulation ≡ interactive verification
 *
 * Plain object. No DOM, no methods. JSON round-trips cleanly.
 */
export interface TugTextEditingState {
  /** The document content as a segment array. */
  segments: Segment[];
  /** Current selection as flat offsets, or null if no selection. */
  selection: { start: number; end: number } | null;
  /** Active IME composition range, or null if not composing. */
  markedText: { start: number; end: number } | null;
  /** Segment indices of highlighted atoms (e.g., two-step delete pending). Empty if none. */
  highlightedAtomIndices: number[];
}

/** Capture the current editing state from a delegate (reconstructs segments from getText/getAtoms). */
export function captureEditingState(d: TugTextInputDelegate): TugTextEditingState {
  const text = d.getText();
  const atoms = d.getAtoms();
  const segments: Segment[] = [];
  let atomIdx = 0;
  let textStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\uFFFC") {
      // Always push the text before the atom (even if empty)
      segments.push({ kind: "text", text: text.slice(textStart, i) });
      if (atomIdx < atoms.length) {
        segments.push({ ...atoms[atomIdx] });
        atomIdx++;
      }
      textStart = i + 1;
    }
  }
  // Trailing text (always push, even if empty, to maintain text-atom-text invariant)
  segments.push({ kind: "text", text: text.slice(textStart) });

  return {
    segments: normalizeSegments(segments),
    selection: d.getSelectedRange(),
    markedText: d.hasMarkedText ? d.getSelectedRange() : null,
    highlightedAtomIndices: [...d.getHighlightedAtomIndices()],
  };
}

/** Compare two editing states for equality. */
export function editingStatesEqual(a: TugTextEditingState, b: TugTextEditingState): boolean {
  if (a.segments.length !== b.segments.length) return false;
  for (let i = 0; i < a.segments.length; i++) {
    const sa = a.segments[i];
    const sb = b.segments[i];
    if (sa.kind !== sb.kind) return false;
    if (sa.kind === "text" && sb.kind === "text") {
      if (sa.text !== sb.text) return false;
    } else if (sa.kind === "atom" && sb.kind === "atom") {
      if (sa.type !== sb.type || sa.label !== sb.label || sa.value !== sb.value) return false;
    }
  }
  if (a.selection === null && b.selection !== null) return false;
  if (a.selection !== null && b.selection === null) return false;
  if (a.selection && b.selection) {
    if (a.selection.start !== b.selection.start || a.selection.end !== b.selection.end) return false;
  }
  if (a.markedText === null && b.markedText !== null) return false;
  if (a.markedText !== null && b.markedText === null) return false;
  if (a.markedText && b.markedText) {
    if (a.markedText.start !== b.markedText.start || a.markedText.end !== b.markedText.end) return false;
  }
  const aHighlight = a.highlightedAtomIndices ?? [];
  const bHighlight = b.highlightedAtomIndices ?? [];
  if (aHighlight.length !== bHighlight.length) return false;
  for (let i = 0; i < aHighlight.length; i++) {
    if (aHighlight[i] !== bHighlight[i]) return false;
  }
  return true;
}

/** Format a TugTextEditingState for display in test output. */
export function formatEditingState(s: TugTextEditingState): string {
  const content = s.segments.map(seg =>
    seg.kind === "text" ? JSON.stringify(seg.text) : `[${seg.type}:${seg.label}]`
  ).join(" ");
  const sel = s.selection
    ? `sel:{${s.selection.start},${s.selection.end}}`
    : "sel:null";
  const marked = s.markedText
    ? ` marked:{${s.markedText.start},${s.markedText.end}}`
    : "";
  const highlight = (s.highlightedAtomIndices ?? []).length > 0
    ? ` highlight:[${s.highlightedAtomIndices!.join(",")}]`
    : "";
  return `${content} ${sel}${marked}${highlight}`;
}

// ===================================================================
// Constants
// ===================================================================

const UNDO_MERGE_MS = 300;
const UNDO_MAX = 100;

const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  characterData: true,
  characterDataOldValue: true,
  subtree: true,
};

// ===================================================================
// Helpers
// ===================================================================

export function cloneSegments(segs: Segment[]): Segment[] {
  return segs.map(s => ({ ...s }));
}

export function normalizeSegments(segs: Segment[]): Segment[] {
  if (segs.length === 0) return [{ kind: "text", text: "" }];
  const result: Segment[] = [];
  if (segs[0].kind !== "text") result.push({ kind: "text", text: "" });
  for (const seg of segs) {
    const last = result[result.length - 1];
    if (seg.kind === "text" && last?.kind === "text") {
      (last as TextSegment).text += (seg as TextSegment).text;
    } else {
      result.push({ ...seg });
    }
  }
  if (result[result.length - 1].kind !== "text") {
    result.push({ kind: "text", text: "" });
  }
  const final: Segment[] = [];
  for (let i = 0; i < result.length; i++) {
    final.push(result[i]);
    if (result[i].kind === "atom" && result[i + 1]?.kind === "atom") {
      final.push({ kind: "text", text: "" });
    }
  }
  return final;
}

/** Check if a DOM node is a tug-atom element. */
function isAtomElement(node: Node): node is HTMLSpanElement {
  return node instanceof HTMLSpanElement && node.dataset.slot === "tug-atom";
}

// ===================================================================
// TugTextEngine
// ===================================================================

export class TugTextEngine {
  readonly root: HTMLDivElement;
  segments: Segment[];
  domNodes: (Text | HTMLSpanElement)[] = [];
  private observer: MutationObserver;
  private reconciling = false;
  private composingIndex: number | null = null;
  /** Segment indices of highlighted atoms (two-step delete pending). */
  private _highlightedAtomIndices: number[] = [];
  /** Timestamp of last compositionend — used to detect Enter that accepted IME. */
  private compositionEndedAt = 0;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private lastEditTime = 0;
  private lastEditType = "";

  // --- Configuration ---
  maxHeight = Infinity;

  // --- Key configuration (UITextInput-inspired) ---
  returnAction: InputAction = "submit";
  numpadEnterAction: InputAction = "submit";

  // --- Typeahead state ---
  private typeahead: {
    active: boolean;
    query: string;
    anchorSegment: number;
    anchorOffset: number;
    selectedIndex: number;
    filtered: CompletionItem[];
  } = { active: false, query: "", anchorSegment: 0, anchorOffset: 0, selectedIndex: 0, filtered: [] };

  // --- Callbacks ---
  onChange: (() => void) | null = null;
  onSubmit: (() => void) | null = null;
  onLog: ((msg: string) => void) | null = null;
  onTypeaheadChange: ((active: boolean, filtered: CompletionItem[], selectedIndex: number) => void) | null = null;

  // --- Pluggable providers ---
  completionProvider: CompletionProvider | null = null;
  dropHandler: DropHandler | null = null;

  constructor(root: HTMLDivElement) {
    this.root = root;
    this.segments = [{ kind: "text", text: "" }];
    this.observer = new MutationObserver(this.handleMutations);
    this.reconcile();
    this.setupEvents();
  }

  // -----------------------------------------------------------------
  // UITextInput delegate properties
  // -----------------------------------------------------------------

  get hasMarkedText(): boolean { return this.composingIndex !== null; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  isEmpty(): boolean {
    return this.segments.length === 1 &&
      this.segments[0].kind === "text" &&
      (this.segments[0] as TextSegment).text === "";
  }

  flatLength(): number {
    let n = 0;
    for (const s of this.segments) {
      n += s.kind === "text" ? (s as TextSegment).text.length : 1;
    }
    return n;
  }

  segmentPosition(flat: number): { segmentIndex: number; offset: number } {
    let remaining = flat;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (seg.kind === "text") {
        if (remaining <= (seg as TextSegment).text.length) {
          return { segmentIndex: i, offset: remaining };
        }
        remaining -= (seg as TextSegment).text.length;
      } else {
        if (remaining === 0 && i > 0) {
          const prev = this.segments[i - 1] as TextSegment;
          return { segmentIndex: i - 1, offset: prev.text.length };
        }
        remaining -= 1;
      }
    }
    const last = this.segments.length - 1;
    const seg = this.segments[last];
    return {
      segmentIndex: last,
      offset: seg.kind === "text" ? (seg as TextSegment).text.length : 1,
    };
  }

  flatOffset(segIndex: number, offset: number): number {
    let flat = 0;
    for (let i = 0; i < segIndex; i++) {
      flat += this.segments[i].kind === "text"
        ? (this.segments[i] as TextSegment).text.length : 1;
    }
    return flat + offset;
  }

  getText(): string {
    return this.segments.map(s =>
      s.kind === "text" ? (s as TextSegment).text : "\uFFFC"
    ).join("");
  }

  getAtoms(): AtomSegment[] {
    return this.segments.filter((s): s is AtomSegment => s.kind === "atom");
  }

  getSelectedRange(): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
    if (!this.root.contains(sel.anchorNode)) return null;
    const anchor = this.flatFromDOM(sel.anchorNode, sel.anchorOffset);
    if (sel.isCollapsed) return { start: anchor, end: anchor };
    if (!sel.focusNode) return { start: anchor, end: anchor };
    const focus = this.flatFromDOM(sel.focusNode, sel.focusOffset);
    return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
  }

  // -----------------------------------------------------------------
  // DOM ↔ Model position mapping
  //
  // The domNodes array maps 1:1 with segments: Text nodes for text
  // segments, HTMLSpanElement (tug-atom) for atom segments. tug-atom
  // elements contain child spans (icon, label) but the position
  // mapping only cares about the top-level atom element —
  // dn.contains(node) catches any node inside the atom.
  // -----------------------------------------------------------------

  saveCursorOffset(): number | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
    if (!this.root.contains(sel.anchorNode)) return null;
    return this.flatFromDOM(sel.anchorNode, sel.anchorOffset);
  }

  restoreSelection(flat: number): void {
    const pos = this.domPosition(flat);
    if (!pos) return;
    const sel = window.getSelection();
    if (sel) sel.collapse(pos.node, pos.offset);
  }

  /** Set selection range. If end equals start (or is omitted), collapses to cursor. */
  setSelectedRange(start: number, end?: number): void {
    if (end === undefined || end === start) {
      this.restoreSelection(start);
    } else {
      const startPos = this.domPosition(start);
      const endPos = this.domPosition(end);
      if (!startPos || !endPos) return;
      const sel = window.getSelection();
      if (!sel) return;
      sel.setBaseAndExtent(startPos.node, startPos.offset, endPos.node, endPos.offset);
    }
  }

  private flatFromDOM(node: Node, offset: number): number {
    // If the node is the root, offset is a child index
    if (node === this.root) {
      let flat = 0;
      for (let i = 0; i < offset && i < this.domNodes.length; i++) {
        flat += this.segments[i].kind === "text"
          ? (this.segments[i] as TextSegment).text.length : 1;
      }
      return flat;
    }
    // Find which domNode contains this node
    for (let i = 0; i < this.domNodes.length; i++) {
      const dn = this.domNodes[i];
      if (dn === node || dn.contains(node)) {
        let flat = 0;
        for (let j = 0; j < i; j++) {
          flat += this.segments[j].kind === "text"
            ? (this.segments[j] as TextSegment).text.length : 1;
        }
        if (this.segments[i].kind === "text") return flat + offset;
        // For atoms: before atom = flat, after atom = flat + 1
        return flat + (offset > 0 ? 1 : 0);
      }
    }
    return 0;
  }

  private domPosition(flat: number): { node: Node; offset: number } | null {
    let remaining = flat;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (seg.kind === "text") {
        const len = (seg as TextSegment).text.length;
        if (remaining <= len && this.domNodes[i]) {
          return { node: this.domNodes[i], offset: remaining };
        }
        remaining -= len;
      } else {
        if (remaining === 0 && i > 0 && this.domNodes[i - 1]) {
          const prevSeg = this.segments[i - 1] as TextSegment;
          return { node: this.domNodes[i - 1], offset: prevSeg.text.length };
        }
        remaining -= 1;
      }
    }
    const last = this.segments.length - 1;
    if (last >= 0 && this.domNodes[last]) {
      const seg = this.segments[last];
      const len = seg.kind === "text" ? (seg as TextSegment).text.length : 1;
      return { node: this.domNodes[last], offset: len };
    }
    return { node: this.root, offset: 0 };
  }

  // -----------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------

  selectAll(): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(this.root);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private clearAtomSelection(): void {
    for (const idx of this._highlightedAtomIndices) {
      const node = this.domNodes[idx];
      if (node instanceof HTMLSpanElement) {
        node.classList.remove("tug-atom-selected");
      }
    }
    this._highlightedAtomIndices = [];
  }

  getHighlightedAtomIndices(): readonly number[] {
    return this._highlightedAtomIndices;
  }

  setHighlightedAtomIndices(indices: number[]): void {
    this.clearAtomSelection();
    for (const idx of indices) {
      if (idx < this.segments.length && this.segments[idx].kind === "atom") {
        this._highlightedAtomIndices.push(idx);
        const node = this.domNodes[idx];
        if (node instanceof HTMLSpanElement) {
          node.classList.add("tug-atom-selected");
        }
      }
    }
  }

  // -----------------------------------------------------------------
  // Undo / Redo
  // -----------------------------------------------------------------

  private pushUndo(editType: string): void {
    const now = Date.now();
    if (this.undoStack.length > 0 && editType === this.lastEditType &&
        now - this.lastEditTime < UNDO_MERGE_MS) {
      // Merge
    } else {
      this.undoStack.push({
        segments: cloneSegments(this.segments),
        cursorOffset: this.saveCursorOffset() ?? 0,
      });
      if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastEditTime = now;
    this.lastEditType = editType;
  }

  undo(): void {
    if (!this.canUndo) return;
    this.redoStack.push({
      segments: cloneSegments(this.segments),
      cursorOffset: this.saveCursorOffset() ?? 0,
    });
    const entry = this.undoStack.pop()!;
    this.segments = entry.segments;
    this.reconcile();
    this.restoreSelection(entry.cursorOffset);
    this.onChange?.();
    this.onLog?.("undo");
  }

  redo(): void {
    if (!this.canRedo) return;
    this.undoStack.push({
      segments: cloneSegments(this.segments),
      cursorOffset: this.saveCursorOffset() ?? 0,
    });
    const entry = this.redoStack.pop()!;
    this.segments = entry.segments;
    this.reconcile();
    this.restoreSelection(entry.cursorOffset);
    this.onChange?.();
    this.onLog?.("redo");
  }

  // -----------------------------------------------------------------
  // DOM Reconciler [L23]
  // -----------------------------------------------------------------

  private reconcile(): void {
    if (this.composingIndex !== null) {
      this.root.dataset.empty = this.isEmpty() ? "true" : "false";
      return;
    }

    this.reconciling = true;
    this.observer.disconnect();

    const newNodes: (Text | HTMLSpanElement)[] = [];
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const old = this.domNodes[i];

      if (seg.kind === "text") {
        if (old instanceof Text) {
          if (old.textContent !== (seg as TextSegment).text) {
            old.textContent = (seg as TextSegment).text;
          }
          newNodes.push(old);
        } else {
          newNodes.push(document.createTextNode((seg as TextSegment).text));
        }
      } else {
        // Reuse existing atom if label matches
        if (isAtomElement(old) &&
            old.dataset.atomLabel === (seg as AtomSegment).label) {
          newNodes.push(old);
        } else {
          newNodes.push(createAtomDOM(seg as AtomSegment));
        }
      }
    }

    // Sync children minimally
    for (let i = 0; i < newNodes.length; i++) {
      const target = newNodes[i];
      const current = this.root.childNodes[i] as ChildNode | undefined;
      if (current === target) continue;
      if (current) {
        this.root.insertBefore(target, current);
      } else {
        this.root.appendChild(target);
      }
    }
    while (this.root.childNodes.length > newNodes.length) {
      this.root.removeChild(this.root.lastChild!);
    }

    this.domNodes = newNodes;

    // Trailing newline fix: a \n at the end of content is invisible in
    // contentEditable (browser collapses trailing whitespace). Append a
    // <br> so the browser renders the line break and gives the cursor
    // a line to land on. This is a DOM rendering concern only — the
    // model stays clean.
    const existingBr = this.root.querySelector("br.tug-trailing-br");
    const lastSeg = this.segments[this.segments.length - 1];
    const needsBr = lastSeg?.kind === "text" &&
      (lastSeg as TextSegment).text.endsWith("\n");
    if (needsBr && !existingBr) {
      const br = document.createElement("br");
      br.className = "tug-trailing-br";
      this.root.appendChild(br);
    } else if (!needsBr && existingBr) {
      existingBr.remove();
    }

    this.root.dataset.empty = this.isEmpty() ? "true" : "false";
    this.autoResize();

    this.observer.observe(this.root, OBSERVER_OPTIONS);
    this.reconciling = false;
  }

  private autoResize(): void {
    const el = this.root;
    el.style.height = "auto";
    if (this.maxHeight !== Infinity && el.scrollHeight > this.maxHeight) {
      el.style.height = `${this.maxHeight}px`;
      el.style.overflowY = "auto";
    } else {
      el.style.overflowY = "hidden";
    }
  }

  // -----------------------------------------------------------------
  // Text mutation API (UITextInput-inspired)
  // -----------------------------------------------------------------

  /**
   * Delete content in the flat offset range [start, end).
   * Returns the cursor position after deletion (= start).
   * This is the primitive that all deletion operations build on.
   */
  deleteRange(start: number, end: number): number {
    if (start === end) return start;
    if (start > end) { const t = start; start = end; end = t; }

    const startPos = this.segmentPosition(start);
    const endPos = this.segmentPosition(end);

    if (startPos.segmentIndex === endPos.segmentIndex) {
      // Range is within a single text segment
      const seg = this.segments[startPos.segmentIndex];
      if (seg.kind === "text") {
        (seg as TextSegment).text =
          (seg as TextSegment).text.slice(0, startPos.offset) +
          (seg as TextSegment).text.slice(endPos.offset);
      }
    } else {
      // Range spans multiple segments: trim start, trim end, remove middle
      const startSeg = this.segments[startPos.segmentIndex];
      if (startSeg.kind === "text") {
        (startSeg as TextSegment).text = (startSeg as TextSegment).text.slice(0, startPos.offset);
      }
      const endSeg = this.segments[endPos.segmentIndex];
      if (endSeg.kind === "text") {
        (endSeg as TextSegment).text = (endSeg as TextSegment).text.slice(endPos.offset);
      }
      // Remove segments strictly between start and end
      const removeFrom = startPos.segmentIndex + 1;
      const removeTo = endPos.segmentIndex;
      if (removeTo > removeFrom) {
        this.segments.splice(removeFrom, removeTo - removeFrom);
      }
    }

    this.segments = normalizeSegments(this.segments);
    return start;
  }

  insertText(text: string): void {
    const range = this.getSelectedRange();
    if (!range) return;
    this.clearAtomSelection();
    this.pushUndo("insert");
    let offset = range.start;
    if (range.start !== range.end) {
      offset = this.deleteRange(range.start, range.end);
    }
    const pos = this.segmentPosition(offset);
    const seg = this.segments[pos.segmentIndex];
    if (seg.kind === "text") {
      (seg as TextSegment).text =
        (seg as TextSegment).text.slice(0, pos.offset) + text +
        (seg as TextSegment).text.slice(pos.offset);
    }
    this.reconcile();
    this.restoreSelection(offset + text.length);
    this.onChange?.();
  }

  insertAtom(atom: AtomSegment): void {
    const range = this.getSelectedRange();
    if (!range) return;
    this.clearAtomSelection();
    this.pushUndo("atom");
    let offset = range.start;
    if (range.start !== range.end) {
      offset = this.deleteRange(range.start, range.end);
    }
    const pos = this.segmentPosition(offset);
    const seg = this.segments[pos.segmentIndex];
    if (seg.kind !== "text") return;
    const textBefore = (seg as TextSegment).text.slice(0, pos.offset);
    const textAfter = (seg as TextSegment).text.slice(pos.offset);
    this.segments.splice(pos.segmentIndex, 1,
      { kind: "text", text: textBefore },
      { ...atom },
      { kind: "text", text: textAfter },
    );
    this.segments = normalizeSegments(this.segments);
    this.reconcile();
    this.restoreSelection(offset + 1);
    this.onChange?.();
    this.onLog?.(`atom: ${atom.label}`);
  }

  deleteBackward(): void {
    const range = this.getSelectedRange();
    if (!range) return;

    // Ranged selection: delete the range
    if (range.start !== range.end) {
      this.pushUndo("delete");
      const offset = this.deleteRange(range.start, range.end);
      this.clearAtomSelection();
      this.reconcile();
      this.restoreSelection(offset);
      this.onChange?.();
      return;
    }

    const offset = range.start;

    // Two-step delete: highlighted atom(s) → delete them
    if (this._highlightedAtomIndices.length > 0) {
      this.pushUndo("delete-atom");
      // Delete in reverse index order so splicing doesn't shift later indices
      const sorted = [...this._highlightedAtomIndices].sort((a, b) => b - a);
      const firstFlat = this.flatOffset(sorted[sorted.length - 1], 0);
      for (const idx of sorted) {
        this.segments.splice(idx, 1);
      }
      this._highlightedAtomIndices = [];
      this.segments = normalizeSegments(this.segments);
      this.reconcile();
      this.restoreSelection(firstFlat);
      this.onChange?.();
      return;
    }

    if (offset === 0) return;

    const pos = this.segmentPosition(offset);

    // Cursor at start of text after atom → highlight atom (step 1 of two-step)
    if (pos.offset === 0 && pos.segmentIndex >= 2) {
      const prevSeg = this.segments[pos.segmentIndex - 1];
      if (prevSeg.kind === "atom") {
        this.setHighlightedAtomIndices([pos.segmentIndex - 1]);
        return;
      }
    }

    // Normal backspace
    if (pos.offset > 0 && this.segments[pos.segmentIndex].kind === "text") {
      this.pushUndo("delete");
      const seg = this.segments[pos.segmentIndex] as TextSegment;
      seg.text = seg.text.slice(0, pos.offset - 1) + seg.text.slice(pos.offset);
      this.reconcile();
      this.restoreSelection(offset - 1);
      this.onChange?.();
    }
  }

  deleteForward(): void {
    const range = this.getSelectedRange();
    if (!range) return;

    // Ranged selection: delete the range
    if (range.start !== range.end) {
      this.pushUndo("delete");
      const offset = this.deleteRange(range.start, range.end);
      this.clearAtomSelection();
      this.reconcile();
      this.restoreSelection(offset);
      this.onChange?.();
      return;
    }

    const offset = range.start;

    // Two-step delete: highlighted atom(s) → delete them
    if (this._highlightedAtomIndices.length > 0) {
      this.pushUndo("delete-atom");
      const sorted = [...this._highlightedAtomIndices].sort((a, b) => b - a);
      const firstFlat = this.flatOffset(sorted[sorted.length - 1], 0);
      for (const idx of sorted) {
        this.segments.splice(idx, 1);
      }
      this._highlightedAtomIndices = [];
      this.segments = normalizeSegments(this.segments);
      this.reconcile();
      this.restoreSelection(firstFlat);
      this.onChange?.();
      return;
    }

    if (offset >= this.flatLength()) return;

    const pos = this.segmentPosition(offset);
    const seg = this.segments[pos.segmentIndex];

    // Cursor at end of text before atom → highlight atom
    if (seg.kind === "text" && pos.offset === (seg as TextSegment).text.length &&
        pos.segmentIndex + 1 < this.segments.length &&
        this.segments[pos.segmentIndex + 1].kind === "atom") {
      this.setHighlightedAtomIndices([pos.segmentIndex + 1]);
      return;
    }

    // Normal forward delete
    if (seg.kind === "text" && pos.offset < (seg as TextSegment).text.length) {
      this.pushUndo("delete");
      (seg as TextSegment).text =
        (seg as TextSegment).text.slice(0, pos.offset) +
        (seg as TextSegment).text.slice(pos.offset + 1);
      this.reconcile();
      this.restoreSelection(offset);
      this.onChange?.();
    }
  }

  // -----------------------------------------------------------------
  // Deletion by granularity (visible units)
  // -----------------------------------------------------------------

  deleteWordBackward(): void {
    const range = this.getSelectedRange();
    if (!range) return;
    if (range.start !== range.end) {
      this.pushUndo("delete");
      const offset = this.deleteRange(range.start, range.end);
      this.clearAtomSelection();
      this.reconcile();
      this.restoreSelection(offset);
      this.onChange?.();
      return;
    }
    const boundary = startOfWord(this.segments, range.start);
    if (boundary === range.start) return;
    this.clearAtomSelection();
    this.pushUndo("delete-word");
    this.deleteRange(boundary, range.start);
    this.reconcile();
    this.restoreSelection(boundary);
    this.onChange?.();
  }

  deleteWordForward(): void {
    const range = this.getSelectedRange();
    if (!range) return;
    if (range.start !== range.end) {
      this.pushUndo("delete");
      const offset = this.deleteRange(range.start, range.end);
      this.clearAtomSelection();
      this.reconcile();
      this.restoreSelection(offset);
      this.onChange?.();
      return;
    }
    const boundary = endOfWord(this.segments, range.start);
    if (boundary === range.start) return;
    this.clearAtomSelection();
    this.pushUndo("delete-word");
    this.deleteRange(range.start, boundary);
    this.reconcile();
    this.restoreSelection(range.start);
    this.onChange?.();
  }

  deleteParagraphBackward(): void {
    const range = this.getSelectedRange();
    if (!range) return;
    if (range.start !== range.end) {
      this.pushUndo("delete");
      const offset = this.deleteRange(range.start, range.end);
      this.clearAtomSelection();
      this.reconcile();
      this.restoreSelection(offset);
      this.onChange?.();
      return;
    }
    const boundary = startOfParagraph(this.segments, range.start);
    if (boundary === range.start) return;
    this.clearAtomSelection();
    this.pushUndo("delete-paragraph");
    this.deleteRange(boundary, range.start);
    this.reconcile();
    this.restoreSelection(boundary);
    this.onChange?.();
  }

  deleteParagraphForward(): void {
    const range = this.getSelectedRange();
    if (!range) return;
    if (range.start !== range.end) {
      this.pushUndo("delete");
      const offset = this.deleteRange(range.start, range.end);
      this.clearAtomSelection();
      this.reconcile();
      this.restoreSelection(offset);
      this.onChange?.();
      return;
    }
    const boundary = endOfParagraph(this.segments, range.start);
    if (boundary === range.start) return;
    this.clearAtomSelection();
    this.pushUndo("delete-paragraph");
    this.deleteRange(range.start, boundary);
    this.reconcile();
    this.restoreSelection(range.start);
    this.onChange?.();
  }

  // -----------------------------------------------------------------
  // Kill ring
  // -----------------------------------------------------------------

  private killRing = "";

  killLine(): void {
    const range = this.getSelectedRange();
    if (!range) return;
    if (range.start !== range.end) {
      // With selection: kill the selection
      this.killRing = this.getText().slice(range.start, range.end);
      this.pushUndo("kill");
      this.deleteRange(range.start, range.end);
      this.clearAtomSelection();
      this.reconcile();
      this.restoreSelection(range.start);
      this.onChange?.();
      return;
    }
    const boundary = endOfParagraph(this.segments, range.start);
    if (boundary === range.start) return;
    this.killRing = this.getText().slice(range.start, boundary);
    this.clearAtomSelection();
    this.pushUndo("kill");
    this.deleteRange(range.start, boundary);
    this.reconcile();
    this.restoreSelection(range.start);
    this.onChange?.();
    this.onLog?.(`kill: "${this.killRing.slice(0, 20)}${this.killRing.length > 20 ? "..." : ""}"`);
  }

  yank(): void {
    if (!this.killRing) return;
    this.insertText(this.killRing);
    this.onLog?.(`yank: "${this.killRing.slice(0, 20)}${this.killRing.length > 20 ? "..." : ""}"`);
  }

  // -----------------------------------------------------------------
  // Text transforms
  // -----------------------------------------------------------------

  transpose(): void {
    const range = this.getSelectedRange();
    if (!range || range.start !== range.end) return;
    const offset = range.start;
    const flat = this.getText();
    if (offset < 1 || offset > flat.length) return;
    // If at end of document, transpose the two characters before cursor
    const swapPos = offset >= flat.length ? offset - 2 : offset - 1;
    if (swapPos < 0) return;
    const a = flat[swapPos];
    const b = flat[swapPos + 1];
    if (a === "\uFFFC" || b === "\uFFFC") return; // Don't transpose atoms
    // Both characters must be in the same text segment
    const posA = this.segmentPosition(swapPos);
    const posB = this.segmentPosition(swapPos + 1);
    if (posA.segmentIndex !== posB.segmentIndex) return;
    const seg = this.segments[posA.segmentIndex];
    if (seg.kind !== "text") return;
    this.pushUndo("transpose");
    const text = (seg as TextSegment).text;
    (seg as TextSegment).text =
      text.slice(0, posA.offset) + b + a + text.slice(posB.offset + 1);
    this.reconcile();
    this.restoreSelection(swapPos + 2);
    this.onChange?.();
    this.onLog?.(`transpose: '${a}' ↔ '${b}'`);
  }

  openLine(): void {
    const range = this.getSelectedRange();
    if (!range) return;
    const offset = range.start;
    if (range.start !== range.end) {
      // With selection: delete it first
      this.pushUndo("insert");
      this.deleteRange(range.start, range.end);
    } else {
      this.pushUndo("insert");
    }
    // Insert newline at cursor position
    const pos = this.segmentPosition(offset);
    const seg = this.segments[pos.segmentIndex];
    if (seg.kind === "text") {
      (seg as TextSegment).text =
        (seg as TextSegment).text.slice(0, pos.offset) + "\n" +
        (seg as TextSegment).text.slice(pos.offset);
    }
    this.reconcile();
    // Cursor stays at original position (before the newline)
    this.restoreSelection(offset);
    this.onChange?.();
    this.onLog?.("openLine");
  }

  clear(): void {
    this.clearAtomSelection();
    this.pushUndo("clear");
    this.segments = [{ kind: "text", text: "" }];
    this.reconcile();
    this.restoreSelection(0);
    this.onChange?.();
    this.onLog?.("cleared");
  }

  /** Capture the current editing state as a serializable snapshot. */
  captureState(): TugTextEditingState {
    return {
      segments: cloneSegments(this.segments),
      selection: this.getSelectedRange(),
      markedText: this.hasMarkedText ? this.getSelectedRange() : null,
      highlightedAtomIndices: [...this._highlightedAtomIndices],
    };
  }

  /** Restore editing state from a snapshot. Used for persistence [L23]. */
  restoreState(state: TugTextEditingState): void {
    this.clearAtomSelection();
    this.undoStack = [];
    this.redoStack = [];
    this.lastEditTime = 0;
    this.lastEditType = "";
    this.segments = normalizeSegments(cloneSegments(state.segments));
    this.reconcile();
    if (state.selection) {
      this.setSelectedRange(state.selection.start, state.selection.end);
    }
    // Restore atom highlights
    if (state.highlightedAtomIndices && state.highlightedAtomIndices.length > 0) {
      for (const idx of state.highlightedAtomIndices) {
        if (idx < this.segments.length && this.segments[idx].kind === "atom") {
          this._highlightedAtomIndices.push(idx);
          const node = this.domNodes[idx];
          if (node instanceof HTMLSpanElement) {
            node.classList.add("tug-atom-selected");
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------
  // @-trigger typeahead
  // -----------------------------------------------------------------

  private activateTypeahead(): void {
    if (!this.completionProvider) return;
    const offset = this.saveCursorOffset();
    if (offset === null) return;
    const pos = this.segmentPosition(offset);
    const filtered = this.completionProvider("");
    this.typeahead = {
      active: true,
      query: "",
      anchorSegment: pos.segmentIndex,
      anchorOffset: pos.offset - 1,
      selectedIndex: 0,
      filtered,
    };
    this.onTypeaheadChange?.(true, filtered, 0);
    this.onLog?.("typeahead: @-trigger");
  }

  private updateTypeaheadQuery(): void {
    if (!this.typeahead.active || !this.completionProvider) return;
    const seg = this.segments[this.typeahead.anchorSegment];
    if (seg.kind !== "text") { this.cancelTypeahead(); return; }
    const text = (seg as TextSegment).text;
    const offset = this.saveCursorOffset();
    if (offset === null) { this.cancelTypeahead(); return; }
    const pos = this.segmentPosition(offset);
    if (pos.segmentIndex !== this.typeahead.anchorSegment) {
      this.cancelTypeahead(); return;
    }
    const query = text.slice(this.typeahead.anchorOffset + 1, pos.offset);
    this.typeahead.query = query;
    this.typeahead.filtered = this.completionProvider(query);
    this.typeahead.selectedIndex = Math.min(
      this.typeahead.selectedIndex,
      Math.max(0, this.typeahead.filtered.length - 1),
    );
    this.onTypeaheadChange?.(true, this.typeahead.filtered, this.typeahead.selectedIndex);
  }

  acceptTypeahead(): void {
    if (!this.typeahead.active || this.typeahead.filtered.length === 0) return;
    const item = this.typeahead.filtered[this.typeahead.selectedIndex];
    const seg = this.segments[this.typeahead.anchorSegment];
    if (seg.kind !== "text") { this.cancelTypeahead(); return; }

    const atOffset = this.typeahead.anchorOffset;
    const queryEnd = atOffset + 1 + this.typeahead.query.length;
    this.pushUndo("atom");
    const text = (seg as TextSegment).text;
    const before = text.slice(0, atOffset);
    const after = text.slice(queryEnd);
    this.segments.splice(this.typeahead.anchorSegment, 1,
      { kind: "text", text: before },
      { ...item.atom },
      { kind: "text", text: after },
    );
    this.segments = normalizeSegments(this.segments);
    const newOffset = this.flatOffset(this.typeahead.anchorSegment, atOffset) + 1;
    this.cancelTypeahead();
    this.reconcile();
    this.restoreSelection(newOffset);
    this.onChange?.();
    this.onLog?.(`atom: @${item.label}`);
  }

  cancelTypeahead(): void {
    this.typeahead.active = false;
    this.onTypeaheadChange?.(false, [], 0);
  }

  typeaheadNavigate(direction: "up" | "down"): void {
    if (!this.typeahead.active) return;
    if (direction === "down") {
      this.typeahead.selectedIndex = Math.min(this.typeahead.selectedIndex + 1, this.typeahead.filtered.length - 1);
    } else {
      this.typeahead.selectedIndex = Math.max(this.typeahead.selectedIndex - 1, 0);
    }
    this.onTypeaheadChange?.(true, this.typeahead.filtered, this.typeahead.selectedIndex);
  }

  get isTypeaheadActive(): boolean { return this.typeahead.active; }

  // -----------------------------------------------------------------
  // MutationObserver
  // -----------------------------------------------------------------

  flushMutations(): void {
    const records = this.observer.takeRecords();
    if (records.length > 0) {
      this.handleMutations(records);
    }
  }

  private handleMutations = (records: MutationRecord[]): void => {
    if (this.reconciling) return;
    this.onLog?.(`mutation: ${records.length} record(s) [${records.map(r => r.type).join(", ")}]`);
    let changed = false;
    for (const rec of records) {
      if (rec.type === "characterData") {
        const textNode = rec.target as Text;
        const idx = this.domNodes.indexOf(textNode as unknown as Text);
        if (idx !== -1 && this.segments[idx].kind === "text") {
          // Normal text segment mutation
          const newText = textNode.textContent ?? "";
          const oldText = (this.segments[idx] as TextSegment).text;
          if (newText !== oldText) {
            if (this.composingIndex === null && !changed) this.pushUndo("type");
            (this.segments[idx] as TextSegment).text = newText;
            changed = true;
          }
        } else if (idx === -1) {
          // Text node not in domNodes — check if it's inside an atom span (stray edit).
          // The browser may insert text into the atom's U+FFFC text node when
          // the cursor is at atomText:1. Redirect to the trailing text segment.
          const parent = textNode.parentElement;
          if (parent && isAtomElement(parent)) {
            const atomIdx = this.domNodes.indexOf(parent as HTMLSpanElement);
            if (atomIdx !== -1) {
              const content = textNode.textContent ?? "";
              const strayText = content.replace("\uFFFC", "");
              if (strayText) {
                textNode.textContent = "\uFFFC";
                const nextIdx = atomIdx + 1;
                if (nextIdx < this.segments.length && this.segments[nextIdx].kind === "text") {
                  if (!changed) this.pushUndo("type");
                  (this.segments[nextIdx] as TextSegment).text =
                    strayText + (this.segments[nextIdx] as TextSegment).text;
                  const cursorFlat = this.flatOffset(nextIdx, 0) + strayText.length;
                  this.reconcile();
                  this.restoreSelection(cursorFlat);
                  changed = true;
                }
              }
            }
          }
        }
      } else if (rec.type === "childList" && this.composingIndex === null) {
        this.rebuildFromDOM();
        changed = true;
      }
    }
    if (changed) {
      this.root.dataset.empty = this.isEmpty() ? "true" : "false";
      this.autoResize();
      if (this.typeahead.active) this.updateTypeaheadQuery();
      this.onChange?.();
    }
  };

  private rebuildFromDOM(): void {
    const newSegs: Segment[] = [];
    for (let i = 0; i < this.root.childNodes.length; i++) {
      const child = this.root.childNodes[i];
      if (child instanceof Text) {
        newSegs.push({ kind: "text", text: child.textContent ?? "" });
      } else if (isAtomElement(child)) {
        newSegs.push({
          kind: "atom",
          type: child.dataset.atomType ?? "file",
          label: child.dataset.atomLabel ?? "?",
          value: child.title ?? child.dataset.atomLabel ?? "?",
        });
      } else if (child instanceof HTMLBRElement) {
        const lastSeg = newSegs[newSegs.length - 1];
        if (lastSeg?.kind === "text") {
          (lastSeg as TextSegment).text += "\n";
        } else {
          newSegs.push({ kind: "text", text: "\n" });
        }
      }
    }
    // Compute flat cursor offset from the raw DOM before normalization changes anything.
    // We can't use saveCursorOffset() here because domNodes is stale.
    // Instead, walk root.childNodes directly to compute the flat offset.
    let flatCursor: number | null = null;
    const sel = window.getSelection();
    if (sel && sel.anchorNode && this.root.contains(sel.anchorNode)) {
      let flat = 0;
      for (let i = 0; i < this.root.childNodes.length; i++) {
        const child = this.root.childNodes[i];
        if (child === sel.anchorNode || child.contains(sel.anchorNode)) {
          if (child instanceof Text) {
            flatCursor = flat + sel.anchorOffset;
          } else if (isAtomElement(child)) {
            flatCursor = flat + (sel.anchorOffset > 0 ? 1 : 0);
          }
          break;
        }
        if (child instanceof Text) {
          flat += (child.textContent ?? "").length;
        } else if (isAtomElement(child)) {
          flat += 1;
        }
      }
    }

    this.segments = normalizeSegments(newSegs);
    // Reconcile DOM to match normalized model — the browser may have left
    // the DOM in a state that doesn't match (e.g., adjacent text nodes that
    // normalizeSegments merged, or missing empty text nodes between atoms).
    this.reconcile();
    if (flatCursor !== null) this.restoreSelection(flatCursor);
  }

  // -----------------------------------------------------------------
  // Event setup
  // -----------------------------------------------------------------

  private setupEvents(): void {
    const el = this.root;
    el.addEventListener("keydown", this.onKeydownCapture, true);
    el.addEventListener("keydown", this.onKeydown);
    el.addEventListener("beforeinput", this.onBeforeInput);
    el.addEventListener("compositionstart", this.onCompositionStart);
    el.addEventListener("compositionend", this.onCompositionEnd);
    el.addEventListener("paste", this.onPaste);
    el.addEventListener("dragover", this.onDragOver);
    el.addEventListener("drop", this.onDrop);
    el.addEventListener("click", this.onClick);
    el.addEventListener("focus", this.onFocus);
  }

  teardown(): void {
    const el = this.root;
    el.removeEventListener("keydown", this.onKeydownCapture, true);
    el.removeEventListener("keydown", this.onKeydown);
    el.removeEventListener("beforeinput", this.onBeforeInput);
    el.removeEventListener("compositionstart", this.onCompositionStart);
    el.removeEventListener("compositionend", this.onCompositionEnd);
    el.removeEventListener("paste", this.onPaste);
    el.removeEventListener("dragover", this.onDragOver);
    el.removeEventListener("drop", this.onDrop);
    el.removeEventListener("click", this.onClick);
    el.removeEventListener("focus", this.onFocus);
    this.observer.disconnect();
  }

  // -----------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------

  private onKeydownCapture = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      this.onLog?.("keydown(capture): Cmd+A → stopPropagation");
      e.stopPropagation();
    }
  };

  private onKeydown = (e: KeyboardEvent): void => {
    const mods = [
      e.metaKey && "Cmd", e.ctrlKey && "Ctrl",
      e.shiftKey && "Shift", e.altKey && "Alt",
    ].filter(Boolean).join("+");
    const keyDesc = mods ? `${mods}+${e.key}` : e.key;
    this.onLog?.(`keydown: ${keyDesc} (code=${e.code})`);

    if (e.isComposing || this.composingIndex !== null) {
      this.onLog?.(`  → composing, ignored`);
      return;
    }

    if (e.key === "Enter" && Date.now() - this.compositionEndedAt < 100) {
      this.onLog?.("  → Enter swallowed (IME acceptance)");
      e.preventDefault();
      return;
    }

    // Typeahead navigation
    if (this.typeahead.active) {
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        this.onLog?.("  → typeahead accept");
        this.acceptTypeahead();
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); this.onLog?.("  → typeahead down"); this.typeaheadNavigate("down"); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); this.onLog?.("  → typeahead up"); this.typeaheadNavigate("up"); return; }
      if (e.key === "Escape") { e.preventDefault(); this.onLog?.("  → typeahead cancel"); this.cancelTypeahead(); return; }
    }

    // Clear atom highlight on any key except Backspace/Delete
    if (e.key !== "Backspace" && e.key !== "Delete") {
      this.clearAtomSelection();
    }

    // Cmd+Z / Cmd+Shift+Z
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) { this.onLog?.("  → redo"); this.redo(); }
      else { this.onLog?.("  → undo"); this.undo(); }
      return;
    }

    // Ctrl+key Emacs bindings
    if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      if (e.key === "k") {
        e.preventDefault();
        this.onLog?.("  → killLine (Ctrl+K)");
        this.killLine();
        return;
      }
      if (e.key === "y") {
        e.preventDefault();
        this.onLog?.("  → yank (Ctrl+Y)");
        this.yank();
        return;
      }
      if (e.key === "t") {
        e.preventDefault();
        this.onLog?.("  → transpose (Ctrl+T)");
        this.transpose();
        return;
      }
      if (e.key === "o") {
        e.preventDefault();
        this.onLog?.("  → openLine (Ctrl+O)");
        this.openLine();
        return;
      }
    }

    // Return (main keyboard) vs Enter (numpad)
    if (e.key === "Enter") {
      e.preventDefault();
      const isNumpad = e.code === "NumpadEnter";
      const baseAction = isNumpad ? this.numpadEnterAction : this.returnAction;
      const action: InputAction = e.shiftKey
        ? (baseAction === "submit" ? "newline" : "submit")
        : baseAction;

      if (action === "submit") {
        this.onLog?.(`  → submit (${isNumpad ? "numpad" : "return"})`);
        this.onSubmit?.();
      } else {
        this.onLog?.(`  → newline (${isNumpad ? "numpad" : "return"})`);
        this.insertText("\n");
      }
      return;
    }

    // Backspace / Delete
    if (e.key === "Backspace") {
      e.preventDefault();
      this.onLog?.("  → deleteBackward");
      this.deleteBackward();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      this.onLog?.("  → deleteForward");
      this.deleteForward();
      return;
    }

    // Arrow keys, other keys — not handled, pass to browser
    this.onLog?.("  → not handled (browser default)");
  };

  private onBeforeInput = (e: InputEvent): void => {
    this.onLog?.(`beforeinput: ${e.inputType}${e.data ? ` data="${e.data}"` : ""}`);

    if (this.composingIndex !== null) {
      this.onLog?.("  → composing, passthrough");
      return;
    }

    switch (e.inputType) {
      case "insertText":
        // Fast path: let browser mutate DOM, MutationObserver reads it back.
        this.onLog?.("  → passthrough (MutationObserver fast path)");
        if (e.data === "@" && !this.typeahead.active) {
          requestAnimationFrame(() => this.activateTypeahead());
        }
        break;
      case "insertLineBreak":
        e.preventDefault();
        this.onLog?.("  → insertText('\\n')");
        this.insertText("\n");
        break;
      case "insertParagraph":
        e.preventDefault();
        this.onLog?.("  → prevented (insertParagraph)");
        break;
      case "deleteContentBackward":
        e.preventDefault();
        this.onLog?.("  → deleteBackward");
        this.deleteBackward();
        break;
      case "deleteContentForward":
        e.preventDefault();
        this.onLog?.("  → deleteForward");
        this.deleteForward();
        break;
      case "deleteWordBackward":
        e.preventDefault();
        this.onLog?.("  → deleteWordBackward");
        this.deleteWordBackward();
        break;
      case "deleteWordForward":
        e.preventDefault();
        this.onLog?.("  → deleteWordForward");
        this.deleteWordForward();
        break;
      case "deleteSoftLineBackward":
        e.preventDefault();
        this.onLog?.("  → deleteParagraphBackward (soft ≡ paragraph)");
        this.deleteParagraphBackward();
        break;
      case "deleteSoftLineForward":
        e.preventDefault();
        this.onLog?.("  → deleteParagraphForward (soft ≡ paragraph)");
        this.deleteParagraphForward();
        break;
      case "deleteHardLineBackward":
        e.preventDefault();
        this.onLog?.("  → deleteParagraphBackward");
        this.deleteParagraphBackward();
        break;
      case "deleteHardLineForward":
        e.preventDefault();
        this.onLog?.("  → killLine");
        this.killLine();
        break;
      case "historyUndo":
        e.preventDefault();
        this.onLog?.("  → undo");
        this.undo();
        break;
      case "historyRedo":
        e.preventDefault();
        this.onLog?.("  → redo");
        this.redo();
        break;
      case "insertFromPaste":
      case "insertFromDrop":
        e.preventDefault();
        this.onLog?.(`  → prevented (${e.inputType})`);
        break;
      default:
        e.preventDefault();
        this.onLog?.(`  → prevented (${e.inputType})`);
        break;
    }
  };

  private onCompositionStart = (): void => {
    const offset = this.saveCursorOffset();
    if (offset !== null) {
      const pos = this.segmentPosition(offset);
      this.composingIndex = pos.segmentIndex;
    }
    this.root.dataset.empty = "false";
    this.onLog?.("IME: composition start");
    this.onChange?.();
  };

  private onCompositionEnd = (): void => {
    if (this.composingIndex !== null) {
      const dn = this.domNodes[this.composingIndex];
      if (dn instanceof Text && this.segments[this.composingIndex].kind === "text") {
        const oldText = (this.segments[this.composingIndex] as TextSegment).text;
        const newText = dn.textContent ?? "";
        if (oldText !== newText) {
          this.pushUndo("compose");
          (this.segments[this.composingIndex] as TextSegment).text = newText;
        }
      }
    }
    this.composingIndex = null;
    this.compositionEndedAt = Date.now();
    this.root.dataset.empty = this.isEmpty() ? "true" : "false";
    this.autoResize();
    this.onLog?.("IME: composition end");
    this.onChange?.();
  };

  private onPaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    this.onLog?.(`paste: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`);
    if (text) this.insertText(text);
  };

  private onDragOver = (e: DragEvent): void => {
    e.preventDefault();
  };

  private onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    this.root.focus();
    if (this.dropHandler) {
      const atoms = this.dropHandler(files);
      for (const atom of atoms) {
        this.insertAtom(atom);
        this.onLog?.(`drop: ${atom.label}`);
      }
    } else {
      // Default: create file atoms from dropped files
      for (let i = 0; i < files.length; i++) {
        const name = files[i].name;
        this.insertAtom({ kind: "atom", type: "file", label: name, value: name });
        this.onLog?.(`drop: ${name}`);
      }
    }
  };

  private onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const atom = target.closest?.("[data-slot='tug-atom']");
    if (atom instanceof HTMLSpanElement && this.root.contains(atom)) {
      const idx = this.domNodes.indexOf(atom);
      if (idx !== -1 && this.segments[idx].kind === "atom") {
        this.onLog?.(`click: atom[${idx}] "${(this.segments[idx] as AtomSegment).label}"`);
        this.setHighlightedAtomIndices([idx]);
        return;
      }
    }
    this.onLog?.("click: clear atom selection");
    this.clearAtomSelection();
  };

  private onFocus = (): void => {
    this.onLog?.("focus");
    if (this.root.childNodes.length === 0) this.reconcile();
  };
}
