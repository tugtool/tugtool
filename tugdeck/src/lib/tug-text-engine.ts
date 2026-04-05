/**
 * TugTextEngine — editing engine for tug-prompt-input.
 *
 * Atoms are <img> elements with SVG data URIs. All mutations go
 * through execCommand for native undo.
 *
 * [L06] All text/atom rendering via direct DOM manipulation, no React state
 * [L07] Engine is a stable ref; handlers access current state via `this`
 */

import type { AtomSegment } from "@/components/tugways/tug-atom";
import { atomImgHTML } from "./tug-atom-img";

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
 * Find the direct child of root that contains (or is) the given node.
 * Returns null if node is not inside root.
 */
function rootChild(root: HTMLElement, node: Node): Node | null {
  let cur: Node | null = node;
  while (cur && cur.parentNode !== root) {
    cur = cur.parentNode;
  }
  return cur;
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

  // Resolve node to a direct child of root (handles nested selections)
  const directChild = rootChild(root, node);
  if (!directChild) return flat;

  // If node is deeper than directChild (e.g., inside a <span>),
  // compute offset within directChild's text content
  const nestedOffset = (node === directChild) ? offset : offsetWithin(directChild, node, offset);

  for (const child of root.childNodes) {
    if (child === directChild) {
      if (child.nodeType === Node.TEXT_NODE) {
        return flat + nestedOffset;
      }
      // For element children (atom/BR or wrapper spans), treat as atom boundary
      if (isAtomImg(child) || isBR(child)) {
        return flat + nestedOffset;
      }
      // Unknown element wrapper — count text within it up to the offset
      return flat + nestedOffset;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      flat += (child.textContent ?? "").length;
    } else if (isAtomImg(child) || isBR(child)) {
      flat += 1;
    }
  }

  return flat;
}

/**
 * Compute a text offset within a container element, given a nested
 * (node, offset) position. Walks the container's text content up to
 * the target position.
 */
function offsetWithin(container: Node, node: Node, offset: number): number {
  let count = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    if (textNode === node) {
      return count + offset;
    }
    count += textNode.length;
  }
  // node wasn't a text node — fall back to counting all text before it
  return count;
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

  // IME composition state.
  // _composing is true between compositionstart and compositionend.
  // _compositionJustEnded is set on compositionend and cleared on keyup.
  // In WebKit, the Enter that commits a Japanese IME composition arrives
  // as a keydown after compositionend — this flag catches it.
  private _composing = false;
  private _compositionJustEnded = false;

  constructor(root: HTMLDivElement) {
    this.root = root;
    this.setupEvents();
  }

  // =================================================================
  // Document content — read directly from DOM
  // =================================================================

  get hasMarkedText(): boolean { return this._composing; }

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

  /** Write the current selection to the clipboard as HTML + plain text. */
  private writeSelectionToClipboard(clipboardData: DataTransfer | null): boolean {
    if (!clipboardData) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const fragment = sel.getRangeAt(0).cloneContents();

    const wrapper = document.createElement("div");
    wrapper.appendChild(fragment);

    const plainWrapper = wrapper.cloneNode(true) as HTMLElement;
    plainWrapper.querySelectorAll("img[data-atom-label]").forEach((img) => {
      const text = document.createTextNode((img as HTMLImageElement).dataset.atomLabel || "");
      img.parentNode?.replaceChild(text, img);
    });

    clipboardData.setData("text/html", wrapper.innerHTML);
    clipboardData.setData("text/plain", plainWrapper.textContent || "");
    return true;
  }

  // =================================================================
  // Event handling — setup and teardown
  // =================================================================

  /** Register an event listener and track it for teardown. */
  private listen(
    target: EventTarget,
    type: string,
    fn: EventListener,
    capture?: boolean,
  ): void {
    target.addEventListener(type, fn, capture);
    this._handlers.push({ target, type, fn, capture });
  }

  private setupEvents(): void {
    const root = this.root;

    // 1. Return/Enter — submit or newline
    this.listen(root, "keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== "Enter") return;
      if (ke.isComposing || this.hasMarkedText || this._compositionJustEnded) return;

      ke.preventDefault();
      const isNumpad = ke.code === "NumpadEnter";
      const baseAction = isNumpad ? this.numpadEnterAction : this.returnAction;
      const action = ke.shiftKey
        ? (baseAction === "submit" ? "newline" : "submit")
        : baseAction;

      if (action === "submit") {
        this.onSubmit?.();
      } else {
        document.execCommand("insertLineBreak");
      }
    });

    // 2. Click on atom — select entire image
    this.listen(root, "click", (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG" && target.dataset.atomLabel) {
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.selectNode(target);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });

    // 3. Option+Arrow — word boundary clamping at atoms
    this.listen(root, "keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if ((ke.key !== "ArrowLeft" && ke.key !== "ArrowRight") || !ke.altKey || ke.metaKey || ke.ctrlKey) return;
      if (ke.isComposing) return;

      ke.preventDefault();
      const sel = window.getSelection();
      if (!sel || !sel.focusNode) return;

      const forward = ke.key === "ArrowRight";
      const method = ke.shiftKey ? "extend" : "move";
      const dir = forward ? "forward" : "backward";

      // Range marking caret BEFORE the move
      const beforeRange = document.createRange();
      beforeRange.setStart(sel.focusNode, sel.focusOffset);
      beforeRange.collapse(true);

      // Let browser do the word move
      sel.modify(method, dir, "word");

      // Range marking caret AFTER the move
      const afterRange = document.createRange();
      afterRange.setStart(sel.focusNode, sel.focusOffset);
      afterRange.collapse(true);

      // Check each atom: is it between before and after?
      const atoms = root.querySelectorAll("img[data-atom-label]");
      let clampAtom: HTMLImageElement | null = null;
      for (let i = 0; i < atoms.length; i++) {
        const atomRange = document.createRange();
        if (forward) {
          atomRange.setStartBefore(atoms[i]);
          atomRange.collapse(true);
          const afterBefore = beforeRange.compareBoundaryPoints(Range.START_TO_START, atomRange) <= 0;
          const beforeAfter = afterRange.compareBoundaryPoints(Range.START_TO_START, atomRange) >= 0;
          if (afterBefore && beforeAfter) {
            if (!clampAtom) clampAtom = atoms[i] as HTMLImageElement;
          }
        } else {
          atomRange.setStartAfter(atoms[i]);
          atomRange.collapse(true);
          const afterAfter = afterRange.compareBoundaryPoints(Range.START_TO_START, atomRange) <= 0;
          const beforeBefore = beforeRange.compareBoundaryPoints(Range.START_TO_START, atomRange) >= 0;
          if (afterAfter && beforeBefore) {
            clampAtom = atoms[i] as HTMLImageElement;
          }
        }
      }

      if (clampAtom) {
        const parent = clampAtom.parentNode!;
        const idx = Array.from(parent.childNodes).indexOf(clampAtom);
        if (forward) {
          sel.collapse(parent, idx + 1);
        } else {
          sel.collapse(parent, idx);
        }
      }
    });

    // 4. Copy — write atom HTML + plain text to clipboard
    this.listen(root, "copy", (e: Event) => {
      if (this.writeSelectionToClipboard((e as ClipboardEvent).clipboardData)) {
        e.preventDefault();
      }
    });

    // 5. Cut — copy then delete via execCommand
    this.listen(root, "cut", (e: Event) => {
      if (this.writeSelectionToClipboard((e as ClipboardEvent).clipboardData)) {
        e.preventDefault();
        document.execCommand("delete");
      }
    });

    // 6. Paste — preserve atoms from our clipboard, strip external rich text
    this.listen(root, "paste", (e: Event) => {
      const ce = e as ClipboardEvent;
      const html = ce.clipboardData?.getData("text/html") || "";
      const plain = ce.clipboardData?.getData("text/plain") || "";

      if (html.includes("data-atom-label")) {
        // Our atoms — extract body content and insert via insertHTML
        ce.preventDefault();
        const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const content = match ? match[1] : html;
        document.execCommand("insertHTML", false, content);
      } else if (html && plain) {
        // External rich text — strip markup, insert as plain text
        ce.preventDefault();
        document.execCommand("insertText", false, plain);
      }
      // If only plain text, let browser handle natively
    }, true); // capture phase

    // 7. Drag & drop — files become atom images
    this.listen(root, "dragover", (e: Event) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = "copy";
    });

    this.listen(root, "drop", (e: Event) => {
      e.preventDefault();
      const de = e as DragEvent;
      const files = de.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Position caret at drop point
      const range = document.caretRangeFromPoint(de.clientX, de.clientY);
      if (range) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }

      // Convert dropped files to atoms
      const atoms = this.dropHandler
        ? this.dropHandler(files)
        : Array.from(files).map(f => {
            const ext = f.name.split(".").pop()?.toLowerCase() || "";
            const imgExts = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
            const type = imgExts.includes(ext) ? "image" : "file";
            return { kind: "atom" as const, type, label: f.name, value: f.name };
          });

      if (atoms.length === 0) return;
      let html = "";
      for (const atom of atoms) {
        html += atomImgHTML(atom.type, atom.label, atom.value);
      }
      document.execCommand("insertHTML", false, html);
    });

    // 8. Rich text blocking — reject formatting inputTypes
    this.listen(root, "beforeinput", (e: Event) => {
      const ie = e as InputEvent;
      const type = ie.inputType;
      if (type.startsWith("format")) {
        ie.preventDefault();
      }
    });

    // 9 & 10. Change detection + auto-resize — input event
    this.listen(root, "input", () => {
      this.updateEmpty();
      this.autoResize();
      this.onChange?.();
    });

    // 11. IME composition tracking
    this.listen(root, "compositionstart", () => { this._composing = true; });
    this.listen(root, "compositionend", () => {
      this._composing = false;
      this._compositionJustEnded = true;
    });
    // Clear the compositionJustEnded flag on the next keyup.
    // The Enter that committed the composition produces keydown then keyup —
    // by keyup the flag has served its purpose.
    this.listen(root, "keyup", () => {
      if (this._compositionJustEnded) this._compositionJustEnded = false;
    });
  }

  teardown(): void {
    for (const h of this._handlers) {
      h.target.removeEventListener(h.type, h.fn, h.capture);
    }
    this._handlers.length = 0;
  }
}
