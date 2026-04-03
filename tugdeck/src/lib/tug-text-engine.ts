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

  saveSelection(): number | null {
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
    this.root.querySelectorAll(".tug-atom-selected")
      .forEach(a => a.classList.remove("tug-atom-selected"));
  }

  private selectAtomAtIndex(idx: number): void {
    this.clearAtomSelection();
    const node = this.domNodes[idx];
    if (node instanceof HTMLSpanElement) {
      node.classList.add("tug-atom-selected");
      this.onLog?.(`select atom: ${(this.segments[idx] as AtomSegment).label}`);
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
        cursorOffset: this.saveSelection() ?? 0,
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
      cursorOffset: this.saveSelection() ?? 0,
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
      cursorOffset: this.saveSelection() ?? 0,
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

  insertText(text: string): void {
    const offset = this.saveSelection();
    if (offset === null) return;
    this.clearAtomSelection();
    this.pushUndo("insert");
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
    const offset = this.saveSelection();
    if (offset === null) return;
    this.clearAtomSelection();
    this.pushUndo("atom");
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
    const offset = this.saveSelection();
    if (offset === null) return;

    const selected = this.root.querySelector(".tug-atom-selected");
    if (selected instanceof HTMLSpanElement) {
      this.deleteAtomElement(selected);
      return;
    }

    if (offset === 0) return;

    const pos = this.segmentPosition(offset);

    // Cursor at start of text after atom → highlight atom (step 1 of two-step)
    if (pos.offset === 0 && pos.segmentIndex >= 2) {
      const prevSeg = this.segments[pos.segmentIndex - 1];
      if (prevSeg.kind === "atom") {
        this.selectAtomAtIndex(pos.segmentIndex - 1);
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
    const offset = this.saveSelection();
    if (offset === null) return;

    const selected = this.root.querySelector(".tug-atom-selected");
    if (selected instanceof HTMLSpanElement) {
      this.deleteAtomElement(selected);
      return;
    }

    if (offset >= this.flatLength()) return;

    const pos = this.segmentPosition(offset);
    const seg = this.segments[pos.segmentIndex];

    // Cursor at end of text before atom → highlight atom
    if (seg.kind === "text" && pos.offset === (seg as TextSegment).text.length &&
        pos.segmentIndex + 1 < this.segments.length &&
        this.segments[pos.segmentIndex + 1].kind === "atom") {
      this.selectAtomAtIndex(pos.segmentIndex + 1);
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

  private deleteAtomElement(atomEl: HTMLSpanElement): void {
    const atomIdx = this.domNodes.indexOf(atomEl);
    if (atomIdx === -1) return;
    const label = (this.segments[atomIdx] as AtomSegment).label;
    const atomFlat = this.flatOffset(atomIdx, 0);
    this.pushUndo("delete-atom");
    this.segments.splice(atomIdx, 1);
    this.segments = normalizeSegments(this.segments);
    this.reconcile();
    this.restoreSelection(atomFlat);
    this.onChange?.();
    this.onLog?.(`delete atom: ${label}`);
  }

  clear(): void {
    this.pushUndo("clear");
    this.segments = [{ kind: "text", text: "" }];
    this.reconcile();
    this.restoreSelection(0);
    this.onChange?.();
    this.onLog?.("cleared");
  }

  // -----------------------------------------------------------------
  // @-trigger typeahead
  // -----------------------------------------------------------------

  private activateTypeahead(): void {
    if (!this.completionProvider) return;
    const offset = this.saveSelection();
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
    const offset = this.saveSelection();
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

  private handleMutations = (records: MutationRecord[]): void => {
    if (this.reconciling) return;
    let changed = false;
    for (const rec of records) {
      if (rec.type === "characterData") {
        const textNode = rec.target as Text;
        const idx = this.domNodes.indexOf(textNode as unknown as Text);
        if (idx !== -1 && this.segments[idx].kind === "text") {
          const newText = textNode.textContent ?? "";
          const oldText = (this.segments[idx] as TextSegment).text;
          if (newText !== oldText) {
            if (this.composingIndex === null && !changed) this.pushUndo("type");
            (this.segments[idx] as TextSegment).text = newText;
            changed = true;
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
    this.segments = normalizeSegments(newSegs);
    this.domNodes = [];
    let segIdx = 0;
    for (let i = 0; i < this.root.childNodes.length && segIdx < this.segments.length; i++) {
      const child = this.root.childNodes[i];
      if (child instanceof Text || isAtomElement(child)) {
        this.domNodes[segIdx] = child as Text | HTMLSpanElement;
        segIdx++;
      }
    }
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
      e.stopPropagation();
    }
  };

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.isComposing || this.composingIndex !== null) {
      this.onLog?.(`keydown during composition: ${e.key} (isComposing=${e.isComposing})`);
      return;
    }

    if (e.key === "Enter" && Date.now() - this.compositionEndedAt < 100) {
      this.onLog?.("Enter swallowed (IME acceptance)");
      e.preventDefault();
      return;
    }

    // Typeahead navigation
    if (this.typeahead.active) {
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        this.acceptTypeahead();
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); this.typeaheadNavigate("down"); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); this.typeaheadNavigate("up"); return; }
      if (e.key === "Escape") { e.preventDefault(); this.cancelTypeahead(); return; }
    }

    // Clear atom highlight on any key except Backspace/Delete
    if (e.key !== "Backspace" && e.key !== "Delete") {
      this.clearAtomSelection();
    }

    // Cmd+Z / Cmd+Shift+Z
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
      return;
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
        this.onSubmit?.();
      } else {
        this.insertText("\n");
      }
      return;
    }

    // Backspace / Delete
    if (e.key === "Backspace") {
      e.preventDefault();
      this.deleteBackward();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      this.deleteForward();
      return;
    }
  };

  private onBeforeInput = (e: InputEvent): void => {
    if (this.composingIndex !== null) {
      this.onLog?.(`beforeinput during composition: ${e.inputType}`);
      return;
    }

    switch (e.inputType) {
      case "insertText":
        // Fast path: let browser mutate DOM, MutationObserver reads it back.
        if (e.data === "@" && !this.typeahead.active) {
          requestAnimationFrame(() => this.activateTypeahead());
        }
        break;
      case "insertLineBreak":
        e.preventDefault();
        this.insertText("\n");
        break;
      case "insertParagraph":
        e.preventDefault();
        break;
      case "deleteContentBackward":
      case "deleteContentForward":
      case "deleteSoftLineBackward":
      case "deleteSoftLineForward":
      case "deleteHardLineBackward":
      case "deleteHardLineForward":
      case "deleteWordBackward":
      case "deleteWordForward":
        e.preventDefault();
        break;
      case "historyUndo":
        e.preventDefault();
        this.undo();
        break;
      case "historyRedo":
        e.preventDefault();
        this.redo();
        break;
      case "insertFromPaste":
      case "insertFromDrop":
        e.preventDefault();
        break;
      default:
        e.preventDefault();
        break;
    }
  };

  private onCompositionStart = (): void => {
    const offset = this.saveSelection();
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
        this.selectAtomAtIndex(idx);
        return;
      }
    }
    this.clearAtomSelection();
  };

  private onFocus = (): void => {
    if (this.root.childNodes.length === 0) this.reconcile();
  };
}
