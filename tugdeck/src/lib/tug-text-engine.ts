/**
 * TugTextEngine — stripped shell for tug-prompt-input.
 *
 * The old parallel document model (segments, reconciler, MutationObserver)
 * has been removed. This file retains the types, delegate interface,
 * persistence state, and a minimal class shell so tug-prompt-input.tsx
 * compiles. The class methods are no-op stubs.
 *
 * Step 3 of t3-prompt-input-plan rebuilds the engine as a thin event-
 * handling layer on top of native contentEditable with <img> atoms.
 *
 * Laws of Tug compliance:
 *   [L06] All text/atom rendering via direct DOM manipulation, no React state
 *   [L07] Engine is a stable ref; handlers access current state via `this`
 */

import type { AtomSegment } from "@/components/tugways/tug-atom";
import { createAtomImgElement, atomImgHTML } from "./tug-atom-img";

// ===================================================================
// Types
// ===================================================================

export interface TextSegment { kind: "text"; text: string }
export type { AtomSegment };
export type Segment = TextSegment | AtomSegment;

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
 */
export interface TugTextInputDelegate {
  // --- Document content ---
  getText(): string;
  getAtoms(): AtomSegment[];
  isEmpty(): boolean;

  // --- Selection ---
  getSelectedRange(): { start: number; end: number } | null;
  setSelectedRange(start: number, end?: number): void;
  readonly hasMarkedText: boolean;
  getHighlightedAtomIndices(): readonly number[];
  setHighlightedAtomIndices(indices: number[]): void;

  // --- Mutation ---
  insertText(text: string): void;
  insertAtom(atom: AtomSegment): void;
  deleteRange(start: number, end: number): number;
  deleteBackward(): void;
  deleteForward(): void;
  deleteWordBackward(): void;
  deleteWordForward(): void;
  deleteParagraphBackward(): void;
  deleteParagraphForward(): void;
  selectAll(): void;
  clear(): void;
  killLine(): void;
  yank(): void;
  transpose(): void;
  openLine(): void;

  // --- Undo ---
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): void;
  redo(): void;

  // --- Focus ---
  focus(): void;

  // --- State management ---
  restoreState(state: TugTextEditingState): void;

  // --- Testing ---
  flushMutations(): void;
  getEditorElement(): HTMLDivElement | null;
}

// ===================================================================
// TugTextEditingState — serializable editing state snapshot
// ===================================================================

/**
 * TugTextEditingState — complete serializable snapshot of editing state.
 *
 * Used for persistence via tugbank (survives reload, app quit) [L23].
 * Plain object. No DOM, no methods. JSON round-trips cleanly.
 */
export interface TugTextEditingState {
  segments: Segment[];
  selection: { start: number; end: number } | null;
  markedText: { start: number; end: number } | null;
  highlightedAtomIndices: number[];
}

// ===================================================================
// State helpers (used by persistence)
// ===================================================================

/** Normalize a segment array: merge adjacent text, ensure text-atom-text sandwich. */
function normalizeSegments(segs: Segment[]): Segment[] {
  if (segs.length === 0) return [{ kind: "text", text: "" }];
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.kind === "text" && out.length > 0 && out[out.length - 1].kind === "text") {
      (out[out.length - 1] as TextSegment).text += s.text;
    } else {
      out.push({ ...s });
    }
  }
  // Ensure text bookends
  if (out[0].kind !== "text") out.unshift({ kind: "text", text: "" });
  if (out[out.length - 1].kind !== "text") out.push({ kind: "text", text: "" });
  // Ensure text between adjacent atoms
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i].kind === "atom" && out[i - 1].kind === "atom") {
      out.splice(i, 0, { kind: "text", text: "" });
    }
  }
  return out;
}

/** Capture the current editing state from a delegate. */
export function captureEditingState(d: TugTextInputDelegate): TugTextEditingState {
  const text = d.getText();
  const atoms = d.getAtoms();
  const segments: Segment[] = [];
  let atomIdx = 0;
  let textStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\uFFFC") {
      segments.push({ kind: "text", text: text.slice(textStart, i) });
      if (atomIdx < atoms.length) {
        segments.push({ ...atoms[atomIdx] });
        atomIdx++;
      }
      textStart = i + 1;
    }
  }
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

/** Format a TugTextEditingState for display. */
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
// DOM ↔ flat offset helpers
//
// The DOM contains text nodes, <img> atoms (1 char = U+FFFC), and
// <br> elements (1 char = \n). These helpers convert between flat
// character offsets and DOM (node, offset) positions.
// ===================================================================

/** Return true if a node is an atom image. */
function isAtomImg(node: Node): node is HTMLImageElement {
  return node.nodeType === Node.ELEMENT_NODE
    && (node as HTMLElement).tagName === "IMG"
    && (node as HTMLElement).dataset.atomLabel !== undefined;
}

/** Return true if a node is a <br>. */
function isBR(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR";
}

/**
 * Walk the direct children of a root element and build a text string.
 * Atom images become U+FFFC, <br> becomes \n, text nodes pass through.
 */
function domToText(root: HTMLElement): string {
  let text = "";
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? "";
    } else if (isAtomImg(child)) {
      text += "\uFFFC";
    } else if (isBR(child)) {
      text += "\n";
    }
  }
  return text;
}

/**
 * Convert a flat character offset to a DOM position (node, offset)
 * within root's direct children.
 *
 * Returns { node, offset } suitable for Range.setStart/setEnd.
 * If the flat offset lands inside a text node, node is the text node
 * and offset is the character offset within it. If it lands on an
 * atom or BR, node is root and offset is the child index.
 */
function flatToDom(root: HTMLElement, flat: number): { node: Node; offset: number } {
  let remaining = flat;
  for (let i = 0; i < root.childNodes.length; i++) {
    const child = root.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE) {
      const len = (child.textContent ?? "").length;
      if (remaining <= len) {
        return { node: child, offset: remaining };
      }
      remaining -= len;
    } else if (isAtomImg(child) || isBR(child)) {
      if (remaining === 0) {
        return { node: root, offset: i };
      }
      remaining -= 1;
    }
  }
  // Past the end — return position after last child
  return { node: root, offset: root.childNodes.length };
}

/**
 * Convert a DOM position (node, offset) to a flat character offset
 * relative to root's content.
 */
function domToFlat(root: HTMLElement, node: Node, offset: number): number {
  let flat = 0;

  // If node is root, offset is a child index
  if (node === root) {
    for (let i = 0; i < offset && i < root.childNodes.length; i++) {
      const child = root.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        flat += (child.textContent ?? "").length;
      } else if (isAtomImg(child) || isBR(child)) {
        flat += 1;
      }
    }
    return flat;
  }

  // If node is a text node child of root, count preceding siblings + offset
  for (const child of root.childNodes) {
    if (child === node) {
      return flat + offset;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      flat += (child.textContent ?? "").length;
    } else if (isAtomImg(child) || isBR(child)) {
      flat += 1;
    }
  }

  // Node is nested deeper (shouldn't happen in our flat structure)
  return flat;
}

// ===================================================================
// TugTextEngine — DOM-based implementation
// ===================================================================

export class TugTextEngine {
  readonly root: HTMLDivElement;

  // Config — set by tug-prompt-input.tsx
  maxHeight = 0;
  returnAction: InputAction = "submit";
  numpadEnterAction: InputAction = "submit";
  completionProvider: CompletionProvider | null = null;
  dropHandler: DropHandler | null = null;

  // Callbacks — wired by tug-prompt-input.tsx
  onSubmit: (() => void) | null = null;
  onChange: (() => void) | null = null;
  onLog: ((msg: string) => void) | null = null;
  onTypeaheadChange: ((active: boolean, filtered: CompletionItem[], selectedIndex: number) => void) | null = null;

  // Event handler references for teardown
  private _handlers: Array<{ target: EventTarget; type: string; fn: EventListener; capture?: boolean }> = [];

  constructor(root: HTMLDivElement) {
    this.root = root;
    this.setupEvents();
  }

  // =================================================================
  // Document content — read directly from DOM
  // =================================================================

  get hasMarkedText(): boolean { return false; }

  isEmpty(): boolean {
    return this.root.childNodes.length === 0
      || (this.root.textContent === "" && this.root.querySelector("img[data-atom-label]") === null);
  }

  getText(): string {
    return domToText(this.root);
  }

  getAtoms(): AtomSegment[] {
    const imgs = this.root.querySelectorAll("img[data-atom-label]");
    const atoms: AtomSegment[] = [];
    for (const img of imgs) {
      const el = img as HTMLImageElement;
      atoms.push({
        kind: "atom",
        type: el.dataset.atomType ?? "file",
        label: el.dataset.atomLabel ?? "",
        value: el.dataset.atomValue ?? "",
      });
    }
    return atoms;
  }

  // =================================================================
  // Selection — flat offset ↔ DOM position
  // =================================================================

  getSelectedRange(): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    if (!this.root.contains(sel.anchorNode)) return null;

    const range = sel.getRangeAt(0);
    const start = domToFlat(this.root, range.startContainer, range.startOffset);
    const end = domToFlat(this.root, range.endContainer, range.endOffset);
    return { start, end };
  }

  setSelectedRange(start: number, end?: number): void {
    const sel = window.getSelection();
    if (!sel) return;
    const s = flatToDom(this.root, start);
    const e = end !== undefined ? flatToDom(this.root, end) : s;
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  selectAll(): void {
    this.root.focus();
    document.execCommand("selectAll");
  }

  getHighlightedAtomIndices(): readonly number[] { return []; }
  setHighlightedAtomIndices(_indices: number[]): void {}

  // =================================================================
  // Mutation — all via execCommand for native undo
  // =================================================================

  insertText(text: string): void {
    this.root.focus();
    document.execCommand("insertText", false, text);
  }

  insertAtom(atom: AtomSegment): void {
    this.root.focus();
    const html = atomImgHTML(atom.type, atom.label, atom.value);
    document.execCommand("insertHTML", false, html);
  }

  deleteRange(start: number, end: number): number {
    if (start === end) return start;
    this.setSelectedRange(start, end);
    document.execCommand("delete");
    return start;
  }

  deleteBackward(): void {
    document.execCommand("delete");
  }

  deleteForward(): void {
    document.execCommand("forwardDelete");
  }

  deleteWordBackward(): void {
    // Stub — full implementation in Step 8
    document.execCommand("delete");
  }

  deleteWordForward(): void {
    // Stub — full implementation in Step 8
    document.execCommand("forwardDelete");
  }

  deleteParagraphBackward(): void {
    // Stub — full implementation in Step 8
    document.execCommand("delete");
  }

  deleteParagraphForward(): void {
    // Stub — full implementation in Step 8
    document.execCommand("forwardDelete");
  }

  clear(): void {
    this.root.innerHTML = "";
    this.updateEmpty();
    this.onChange?.();
  }

  // Emacs bindings — stubs for now (Step 8)
  killLine(): void {}
  yank(): void {}
  transpose(): void {}
  openLine(): void {}

  // =================================================================
  // Undo/Redo — browser's native stack via execCommand
  // =================================================================

  get canUndo(): boolean { return true; }
  get canRedo(): boolean { return true; }

  undo(): void {
    document.execCommand("undo");
  }

  redo(): void {
    document.execCommand("redo");
  }

  // =================================================================
  // State — stubs until Step 5 migrates persistence
  // =================================================================

  captureState(): TugTextEditingState {
    return { segments: [{ kind: "text", text: "" }], selection: null, markedText: null, highlightedAtomIndices: [] };
  }

  restoreState(_state: TugTextEditingState): void {}

  // =================================================================
  // Testing compatibility
  // =================================================================

  flushMutations(): void {}

  // =================================================================
  // Internal helpers
  // =================================================================

  /** Update the data-empty attribute for placeholder visibility. */
  private updateEmpty(): void {
    this.root.dataset.empty = this.isEmpty() ? "true" : "false";
  }

  /** Auto-resize the editor to fit content, up to maxHeight. */
  private autoResize(): void {
    if (this.maxHeight <= 0) return;
    this.root.style.height = "auto";
    const scrollH = this.root.scrollHeight;
    if (scrollH > this.maxHeight) {
      this.root.style.height = `${this.maxHeight}px`;
      this.root.style.overflowY = "auto";
    } else {
      this.root.style.height = `${scrollH}px`;
      this.root.style.overflowY = "hidden";
    }
  }

  // =================================================================
  // Event handling — setup and teardown
  // =================================================================

  /** Register an event listener and track it for teardown. */
  private listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    capture?: boolean,
  ): void {
    const listener = fn as EventListener;
    target.addEventListener(type, listener, capture);
    this._handlers.push({ target, type, fn: listener, capture });
  }

  private setupEvents(): void {
    // Event handlers wired in sub-step 3.3
  }

  teardown(): void {
    for (const h of this._handlers) {
      h.target.removeEventListener(h.type, h.fn, h.capture);
    }
    this._handlers.length = 0;
  }
}
