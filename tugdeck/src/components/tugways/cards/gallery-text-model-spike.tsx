/**
 * gallery-text-model-spike.tsx -- T3.0 Text Model Spike (Engine-based)
 *
 * A proper text input engine using contentEditable as input capture surface
 * with an owned document model. Inspired by Lexical's architecture and CM6's
 * "let the browser mutate, diff afterward" input strategy, with a
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
 *   [L01] One root.render() at mount — engine runs in DOM zone after that
 *   [L06] All text/atom rendering via direct DOM manipulation, no React state
 *   [L07] Engine is a stable ref; handlers access current state via `this`
 *   [L22] Engine is the store; DOM updates happen directly, no React cycle
 *   [L23] Selection preserved during reconcile via save/restore
 *
 * @module components/tugways/cards/gallery-text-model-spike
 */

import React, { useRef, useLayoutEffect, useCallback, useState } from "react";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import "./gallery-text-model-spike.css";

// ===================================================================
// Types
// ===================================================================

interface TextSegment { kind: "text"; text: string }
interface AtomSegment { kind: "atom"; type: string; label: string; value: string }
type Segment = TextSegment | AtomSegment;

interface UndoEntry {
  segments: Segment[];
  cursorOffset: number;
}

type InputAction = "submit" | "newline";

// ===================================================================
// Constants
// ===================================================================

const MAX_ROWS = 8;
const LINE_HEIGHT = 21;
const PADDING_Y = 14; // 6+6 padding + 2 border
const MAX_HEIGHT = LINE_HEIGHT * MAX_ROWS + PADDING_Y;
const UNDO_MERGE_MS = 300;
const UNDO_MAX = 100;

const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  characterData: true,
  characterDataOldValue: true,
  subtree: true,
};

const SAMPLE_ATOMS: AtomSegment[] = [
  { kind: "atom", type: "file", label: "src/main.ts", value: "/project/src/main.ts" },
  { kind: "atom", type: "file", label: "README.md", value: "/project/README.md" },
  { kind: "atom", type: "command", label: "/commit", value: "/commit" },
  { kind: "atom", type: "file", label: "src/lib/feed-store.ts", value: "/project/src/lib/feed-store.ts" },
];

const ENTER_CHOICES: TugChoiceItem[] = [
  { value: "enter-submits", label: "Enter submits" },
  { value: "enter-newline", label: "Enter = newline" },
];

// ===================================================================
// Helpers
// ===================================================================

function createAtomDOM(seg: AtomSegment): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "spike-atom";
  el.contentEditable = "false";
  el.dataset.atomType = seg.type;
  el.dataset.atomLabel = seg.label;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `${seg.type}: ${seg.label}`);

  const icon = document.createElement("span");
  icon.className = "spike-atom-icon";
  icon.textContent = seg.type === "file" ? "\u{1F4C4}" : "\u{2F}";
  el.appendChild(icon);

  const label = document.createElement("span");
  label.textContent = seg.label;
  el.appendChild(label);

  return el;
}

function cloneSegments(segs: Segment[]): Segment[] {
  return segs.map(s => ({ ...s }));
}

/**
 * Normalize segments to enforce the text-atom-text invariant:
 * - Always starts and ends with a TextSegment
 * - Atoms always have TextSegments on both sides
 * - Adjacent TextSegments are merged
 */
function normalizeSegments(segs: Segment[]): Segment[] {
  if (segs.length === 0) return [{ kind: "text", text: "" }];

  const result: Segment[] = [];

  // Ensure starts with text
  if (segs[0].kind !== "text") result.push({ kind: "text", text: "" });

  for (const seg of segs) {
    const last = result[result.length - 1];
    if (seg.kind === "text" && last?.kind === "text") {
      // Merge adjacent text
      (last as TextSegment).text += (seg as TextSegment).text;
    } else {
      result.push({ ...seg });
    }
  }

  // Ensure ends with text
  if (result[result.length - 1].kind !== "text") {
    result.push({ kind: "text", text: "" });
  }

  // Ensure text between every pair of atoms
  const final: Segment[] = [];
  for (let i = 0; i < result.length; i++) {
    final.push(result[i]);
    if (result[i].kind === "atom" && result[i + 1]?.kind === "atom") {
      final.push({ kind: "text", text: "" });
    }
  }

  return final;
}

// ===================================================================
// TugTextEngine
// ===================================================================

class TugTextEngine {
  readonly root: HTMLDivElement;
  segments: Segment[];
  domNodes: (Text | HTMLSpanElement)[] = [];
  private observer: MutationObserver;
  private reconciling = false;
  private composingIndex: number | null = null;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private lastEditTime = 0;
  private lastEditType = "";

  // --- Configuration ---
  /** "enter-submits" or "enter-newline" */
  enterMode = "enter-submits";

  // --- Callbacks ---
  onChange: (() => void) | null = null;
  onSubmit: (() => void) | null = null;
  onLog: ((msg: string) => void) | null = null;

  constructor(root: HTMLDivElement) {
    this.root = root;
    this.segments = [{ kind: "text", text: "" }];
    this.observer = new MutationObserver(this.handleMutations);

    // Initial DOM setup
    this.reconcile();
    this.setupEvents();
  }

  // -----------------------------------------------------------------
  // Model queries
  // -----------------------------------------------------------------

  isEmpty(): boolean {
    return this.segments.length === 1 &&
      this.segments[0].kind === "text" &&
      (this.segments[0] as TextSegment).text === "";
  }

  /** Total flat length (text chars + 1 per atom). */
  flatLength(): number {
    let n = 0;
    for (const s of this.segments) {
      n += s.kind === "text" ? (s as TextSegment).text.length : 1;
    }
    return n;
  }

  /** Flat offset → { segmentIndex, offset } in a TextSegment. */
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
        // Atom: counts as 1
        if (remaining === 0) {
          // "Before atom" = end of previous text segment (guaranteed by invariant)
          if (i > 0) {
            const prev = this.segments[i - 1] as TextSegment;
            return { segmentIndex: i - 1, offset: prev.text.length };
          }
        }
        remaining -= 1;
      }
    }
    // Past end
    const last = this.segments.length - 1;
    const seg = this.segments[last];
    return {
      segmentIndex: last,
      offset: seg.kind === "text" ? (seg as TextSegment).text.length : 1,
    };
  }

  /** Segment index + offset → flat offset. */
  flatOffset(segIndex: number, offset: number): number {
    let flat = 0;
    for (let i = 0; i < segIndex; i++) {
      flat += this.segments[i].kind === "text"
        ? (this.segments[i] as TextSegment).text.length : 1;
    }
    return flat + offset;
  }

  /** Plain text (atoms replaced with Object Replacement Character). */
  getText(): string {
    return this.segments.map(s =>
      s.kind === "text" ? (s as TextSegment).text : "\uFFFC"
    ).join("");
  }

  /** All atoms in order. */
  getAtoms(): AtomSegment[] {
    return this.segments.filter((s): s is AtomSegment => s.kind === "atom");
  }

  // -----------------------------------------------------------------
  // DOM ↔ Model position mapping
  // -----------------------------------------------------------------

  /** Read current DOM selection → flat offset. Returns null if not in editor. */
  saveSelection(): number | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
    if (!this.root.contains(sel.anchorNode)) return null;
    return this.flatFromDOM(sel.anchorNode, sel.anchorOffset);
  }

  /** Set DOM selection from flat offset. */
  restoreSelection(flat: number): void {
    const pos = this.domPosition(flat);
    if (!pos) return;
    const sel = window.getSelection();
    if (sel) {
      sel.collapse(pos.node, pos.offset);
    }
  }

  /** DOM node+offset → flat offset. */
  private flatFromDOM(node: Node, offset: number): number {
    // If node is the root element, offset is a child index
    if (node === this.root) {
      let flat = 0;
      for (let i = 0; i < offset && i < this.domNodes.length; i++) {
        flat += this.segments[i].kind === "text"
          ? (this.segments[i] as TextSegment).text.length : 1;
      }
      return flat;
    }

    // Find which domNode this node belongs to
    for (let i = 0; i < this.domNodes.length; i++) {
      const dn = this.domNodes[i];
      if (dn === node || dn.contains(node)) {
        let flat = 0;
        for (let j = 0; j < i; j++) {
          flat += this.segments[j].kind === "text"
            ? (this.segments[j] as TextSegment).text.length : 1;
        }
        if (this.segments[i].kind === "text") {
          return flat + offset;
        } else {
          // Atom: offset 0 = before, anything else = after
          return flat + (offset > 0 ? 1 : 0);
        }
      }
    }
    return 0;
  }

  /** Flat offset → DOM { node, offset }. */
  private domPosition(flat: number): { node: Node; offset: number } | null {
    let remaining = flat;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (seg.kind === "text") {
        const len = (seg as TextSegment).text.length;
        if (remaining <= len) {
          const dn = this.domNodes[i];
          if (dn) return { node: dn, offset: remaining };
        }
        remaining -= len;
      } else {
        if (remaining === 0) {
          // Before atom — position at end of previous text node
          if (i > 0 && this.domNodes[i - 1]) {
            const prevSeg = this.segments[i - 1] as TextSegment;
            return { node: this.domNodes[i - 1], offset: prevSeg.text.length };
          }
        }
        remaining -= 1;
      }
    }
    // Past end — end of last text node
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
    this.root.querySelectorAll(".spike-atom-selected")
      .forEach(a => a.classList.remove("spike-atom-selected"));
  }

  // -----------------------------------------------------------------
  // Undo / Redo
  // -----------------------------------------------------------------

  private pushUndo(editType: string): void {
    const now = Date.now();
    if (
      this.undoStack.length > 0 &&
      editType === this.lastEditType &&
      now - this.lastEditTime < UNDO_MERGE_MS
    ) {
      // Merge: don't push, the stack top already has the pre-group state
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
    if (this.undoStack.length === 0) return;
    // Push current state to redo
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
    if (this.redoStack.length === 0) return;
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
  // DOM Reconciler
  // -----------------------------------------------------------------

  /**
   * Render segments → DOM. During composition, the composing Text node
   * is never removed from the DOM (would abort IME). [L23]
   */
  private reconcile(): void {
    // During composition, skip reconciliation entirely —
    // the browser is mutating the composing node and we must not interfere.
    if (this.composingIndex !== null) {
      this.root.dataset.empty = this.isEmpty() ? "true" : "false";
      return;
    }

    this.reconciling = true;
    this.observer.disconnect();

    // Build target node list, reusing existing DOM nodes where possible
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
        if (
          old instanceof HTMLSpanElement &&
          old.classList.contains("spike-atom") &&
          old.dataset.atomLabel === (seg as AtomSegment).label
        ) {
          newNodes.push(old);
        } else {
          newNodes.push(createAtomDOM(seg as AtomSegment));
        }
      }
    }

    // Sync root children — minimal mutation for L23 (preserve scroll)
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
    // Remove excess children
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
    if (el.scrollHeight > MAX_HEIGHT) {
      el.style.height = `${MAX_HEIGHT}px`;
      el.style.overflowY = "auto";
    } else {
      el.style.overflowY = "hidden";
    }
  }

  // -----------------------------------------------------------------
  // UITextInput-inspired API: text mutation
  // -----------------------------------------------------------------

  /** Insert text at current selection. */
  insertText(text: string): void {
    const offset = this.saveSelection();
    if (offset === null) return;

    this.clearAtomSelection();
    this.pushUndo("insert");

    const pos = this.segmentPosition(offset);
    const seg = this.segments[pos.segmentIndex];
    if (seg.kind === "text") {
      (seg as TextSegment).text =
        (seg as TextSegment).text.slice(0, pos.offset) +
        text +
        (seg as TextSegment).text.slice(pos.offset);
    }

    this.reconcile();
    this.restoreSelection(offset + text.length);
    this.onChange?.();
  }

  /** Insert an atom at current selection. */
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

    // Replace the text segment with: [textBefore, atom, textAfter]
    const newSegs: Segment[] = [
      { kind: "text", text: textBefore },
      { ...atom },
      { kind: "text", text: textAfter },
    ];
    this.segments.splice(pos.segmentIndex, 1, ...newSegs);
    this.segments = normalizeSegments(this.segments);

    // Cursor goes after the atom: flat offset = original offset + 1 (atom width)
    const newOffset = offset + 1;

    this.reconcile();
    this.restoreSelection(newOffset);
    this.onChange?.();
    this.onLog?.(`atom: ${atom.label}`);
  }

  /** Delete backward (backspace). Two-step for atoms: first highlights, second deletes. */
  deleteBackward(): void {
    const offset = this.saveSelection();
    if (offset === null) return;

    // Step 2: if an atom is highlighted, delete it
    const selected = this.root.querySelector(".spike-atom-selected");
    if (selected instanceof HTMLSpanElement) {
      this.deleteHighlightedAtom(selected);
      return;
    }

    if (offset === 0) return; // Nothing to delete

    const pos = this.segmentPosition(offset);

    // Check: cursor at start of text segment that follows an atom → highlight atom
    if (pos.offset === 0 && pos.segmentIndex >= 2) {
      const prevSeg = this.segments[pos.segmentIndex - 1];
      if (prevSeg.kind === "atom") {
        const prevNode = this.domNodes[pos.segmentIndex - 1];
        if (prevNode instanceof HTMLSpanElement) {
          prevNode.classList.add("spike-atom-selected");
        }
        this.onLog?.(`select atom: ${(prevSeg as AtomSegment).label}`);
        return;
      }
    }

    // Normal: delete one character in the text segment
    if (pos.offset > 0 && this.segments[pos.segmentIndex].kind === "text") {
      this.pushUndo("delete");
      const seg = this.segments[pos.segmentIndex] as TextSegment;
      seg.text = seg.text.slice(0, pos.offset - 1) + seg.text.slice(pos.offset);
      this.reconcile();
      this.restoreSelection(offset - 1);
      this.onChange?.();
    }
  }

  /** Delete forward. Two-step for atoms. */
  deleteForward(): void {
    const offset = this.saveSelection();
    if (offset === null) return;

    const selected = this.root.querySelector(".spike-atom-selected");
    if (selected instanceof HTMLSpanElement) {
      this.deleteHighlightedAtom(selected);
      return;
    }

    if (offset >= this.flatLength()) return;

    const pos = this.segmentPosition(offset);
    const seg = this.segments[pos.segmentIndex] as TextSegment;

    // Check: cursor at end of text segment that precedes an atom → highlight atom
    if (seg.kind === "text" && pos.offset === seg.text.length &&
        pos.segmentIndex + 1 < this.segments.length) {
      const nextSeg = this.segments[pos.segmentIndex + 1];
      if (nextSeg.kind === "atom") {
        const nextNode = this.domNodes[pos.segmentIndex + 1];
        if (nextNode instanceof HTMLSpanElement) {
          nextNode.classList.add("spike-atom-selected");
        }
        this.onLog?.(`select atom: ${(nextSeg as AtomSegment).label}`);
        return;
      }
    }

    // Normal: delete one character forward
    if (seg.kind === "text" && pos.offset < seg.text.length) {
      this.pushUndo("delete");
      seg.text = seg.text.slice(0, pos.offset) + seg.text.slice(pos.offset + 1);
      this.reconcile();
      this.restoreSelection(offset);
      this.onChange?.();
    }
  }

  private deleteHighlightedAtom(atomEl: HTMLSpanElement): void {
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

  /** Clear all content. */
  clear(): void {
    this.pushUndo("clear");
    this.segments = [{ kind: "text", text: "" }];
    this.reconcile();
    this.restoreSelection(0);
    this.onChange?.();
    this.onLog?.("cleared");
  }

  // -----------------------------------------------------------------
  // MutationObserver handler
  // -----------------------------------------------------------------

  private handleMutations = (records: MutationRecord[]): void => {
    if (this.reconciling) return;

    let changed = false;

    for (const rec of records) {
      if (rec.type === "characterData") {
        // Text node changed — fast path for normal typing
        const textNode = rec.target as Text;
        const idx = this.domNodes.indexOf(textNode as unknown as Text);
        if (idx !== -1 && this.segments[idx].kind === "text") {
          const newText = textNode.textContent ?? "";
          const oldText = (this.segments[idx] as TextSegment).text;
          if (newText !== oldText) {
            // Push undo only if NOT composing
            if (this.composingIndex === null && !changed) {
              this.pushUndo("type");
            }
            (this.segments[idx] as TextSegment).text = newText;
            changed = true;
          }
        }
      } else if (rec.type === "childList") {
        // Structure changed (browser added <br>, split nodes, etc.)
        // Safety net: rebuild model from DOM
        if (this.composingIndex === null) {
          this.rebuildFromDOM();
          changed = true;
        }
      }
    }

    if (changed) {
      this.root.dataset.empty = this.isEmpty() ? "true" : "false";
      this.autoResize();
      this.onChange?.();
    }
  };

  /** Safety net: read DOM content back into model when structure changes unexpectedly. */
  private rebuildFromDOM(): void {
    const newSegs: Segment[] = [];
    for (let i = 0; i < this.root.childNodes.length; i++) {
      const child = this.root.childNodes[i];
      if (child instanceof Text) {
        // Normalize <br> to newline
        const text = child.textContent ?? "";
        newSegs.push({ kind: "text", text });
      } else if (child instanceof HTMLElement && child.classList.contains("spike-atom")) {
        newSegs.push({
          kind: "atom",
          type: child.dataset.atomType ?? "file",
          label: child.dataset.atomLabel ?? "?",
          value: child.dataset.atomLabel ?? "?",
        });
      } else if (child instanceof HTMLBRElement) {
        // <br> becomes newline in adjacent text
        const lastSeg = newSegs[newSegs.length - 1];
        if (lastSeg?.kind === "text") {
          (lastSeg as TextSegment).text += "\n";
        } else {
          newSegs.push({ kind: "text", text: "\n" });
        }
      }
      // Ignore other elements (divs from Enter, etc.)
    }
    this.segments = normalizeSegments(newSegs);
    // Rebuild domNodes mapping
    this.domNodes = [];
    let segIdx = 0;
    for (let i = 0; i < this.root.childNodes.length && segIdx < this.segments.length; i++) {
      const child = this.root.childNodes[i];
      if (child instanceof Text || (child instanceof HTMLElement && child.classList.contains("spike-atom"))) {
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

    el.addEventListener("keydown", this.onKeydown);
    el.addEventListener("beforeinput", this.onBeforeInput);
    el.addEventListener("compositionstart", this.onCompositionStart);
    el.addEventListener("compositionend", this.onCompositionEnd);
    el.addEventListener("paste", this.onPaste);
    el.addEventListener("focus", this.onFocus);
  }

  teardown(): void {
    const el = this.root;
    el.removeEventListener("keydown", this.onKeydown);
    el.removeEventListener("beforeinput", this.onBeforeInput);
    el.removeEventListener("compositionstart", this.onCompositionStart);
    el.removeEventListener("compositionend", this.onCompositionEnd);
    el.removeEventListener("paste", this.onPaste);
    el.removeEventListener("focus", this.onFocus);
    this.observer.disconnect();
  }

  // -----------------------------------------------------------------
  // Event handlers (arrow functions for stable `this`)
  // -----------------------------------------------------------------

  private onKeydown = (e: KeyboardEvent): void => {
    // Never intercept during IME composition
    if (e.isComposing || this.composingIndex !== null) return;

    // Any non-delete key clears atom highlight
    if (e.key !== "Backspace" && e.key !== "Delete") {
      this.clearAtomSelection();
    }

    // Cmd+A — select all within editor
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      e.stopImmediatePropagation(); // Stop SelectionGuard [L12]
      this.selectAll();
      return;
    }

    // Cmd+Z — undo
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.undo();
      return;
    }

    // Cmd+Shift+Z — redo
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
      e.preventDefault();
      this.redo();
      return;
    }

    // Return vs Enter — distinguished by e.code
    if (e.key === "Enter") {
      e.preventDefault();
      const isNumpadEnter = e.code === "NumpadEnter";
      const isReturn = e.code === "Enter";

      // Determine action
      let action: InputAction;
      if (this.enterMode === "enter-submits") {
        // Return: submit (unless Shift → newline). Enter: submit.
        action = (isReturn && e.shiftKey) ? "newline" : "submit";
      } else {
        // Return: newline. Enter: submit. Cmd+Return: submit.
        if (e.metaKey || e.ctrlKey || isNumpadEnter) {
          action = "submit";
        } else {
          action = "newline";
        }
      }

      if (action === "submit") {
        this.onSubmit?.();
      } else {
        this.insertText("\n");
      }
      return;
    }

    // Backspace
    if (e.key === "Backspace") {
      e.preventDefault();
      this.deleteBackward();
      return;
    }

    // Delete
    if (e.key === "Delete") {
      e.preventDefault();
      this.deleteForward();
      return;
    }
  };

  private onBeforeInput = (e: InputEvent): void => {
    // During composition, let composition events through
    if (this.composingIndex !== null) {
      const isCompositionType = e.inputType === "insertCompositionText" ||
        e.inputType === "deleteCompositionText";
      if (!isCompositionType) {
        e.preventDefault();
      }
      return;
    }

    switch (e.inputType) {
      case "insertText":
        // Let browser handle — MutationObserver reads it back
        break;
      case "insertLineBreak":
        e.preventDefault();
        this.insertText("\n");
        break;
      case "insertParagraph":
        e.preventDefault();
        // Handled by keydown Enter
        break;
      case "deleteContentBackward":
      case "deleteContentForward":
      case "deleteSoftLineBackward":
      case "deleteSoftLineForward":
      case "deleteHardLineBackward":
      case "deleteHardLineForward":
      case "deleteWordBackward":
      case "deleteWordForward":
        // Handled by keydown Backspace/Delete
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
        // Paste handled in onPaste
        break;
      default:
        // Unknown — prevent to keep model in sync
        e.preventDefault();
        break;
    }
  };

  private onCompositionStart = (): void => {
    // Find which text segment the cursor is in
    const offset = this.saveSelection();
    if (offset !== null) {
      const pos = this.segmentPosition(offset);
      this.composingIndex = pos.segmentIndex;
    }
    this.onLog?.("IME: composition start");
    this.onChange?.();
  };

  private onCompositionEnd = (): void => {
    // Read final composed text from the DOM
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

  private onFocus = (): void => {
    // Ensure there's always a place for the cursor
    if (this.root.childNodes.length === 0) {
      this.reconcile();
    }
  };
}

// ===================================================================
// SpikeEditor React component
// ===================================================================

function SpikeEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TugTextEngine | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextAtomIdx = useRef(0);
  const [enterMode, setEnterMode] = useState("enter-submits");

  // Log helper — direct DOM write [L06]
  const appendLog = useCallback((msg: string) => {
    const el = logRef.current;
    if (!el) return;
    const line = document.createElement("div");
    line.textContent = msg;
    el.appendChild(line);
    while (el.childNodes.length > 30) el.removeChild(el.firstChild!);
    el.scrollTop = el.scrollHeight;
  }, []);

  // Status update — direct DOM write [L06]
  const updateStatus = useCallback(() => {
    const engine = engineRef.current;
    const el = statusRef.current;
    if (!engine || !el) return;
    const text = engine.getText();
    const atoms = engine.getAtoms();
    const composing = engine.isEmpty() ? "" :
      (engine as unknown as { composingIndex: number | null }).composingIndex !== null
        ? " | IME: composing" : "";
    el.textContent =
      `chars: ${text.length} | atoms: ${atoms.length} | height: ${engine.root.offsetHeight}px${composing}`;
  }, []);

  // Mount engine once [L01]
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || engineRef.current) return;

    const engine = new TugTextEngine(el);
    engine.onChange = updateStatus;
    engine.onLog = appendLog;
    engine.onSubmit = () => {
      const text = engine.getText().trim();
      const atoms = engine.getAtoms().map(a => a.label);
      appendLog(`submit: "${text}" atoms=[${atoms.join(", ")}]`);
      engine.clear();
    };
    engineRef.current = engine;
    updateStatus();

    return () => {
      engine.teardown();
      engineRef.current = null;
    };
  }, [updateStatus, appendLog]);

  // Sync enter mode to engine via ref [L07]
  useLayoutEffect(() => {
    if (engineRef.current) {
      engineRef.current.enterMode = enterMode;
    }
  }, [enterMode]);

  // Insert atom — cycles through samples
  const handleInsertAtom = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const atom = SAMPLE_ATOMS[nextAtomIdx.current % SAMPLE_ATOMS.length];
    nextAtomIdx.current++;
    engine.root.focus();
    engine.insertAtom(atom);
  }, []);

  // Clear
  const handleClear = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.root.focus();
    engine.clear();
  }, []);

  // Enter mode toggle
  const handleEnterMode = useCallback((value: string) => {
    setEnterMode(value);
    appendLog(
      value === "enter-submits"
        ? "enter mode: Return submits, Shift+Return newline"
        : "enter mode: Return newline, Cmd+Return or numpad Enter submits"
    );
  }, [appendLog]);

  return (
    <div className="cg-content" data-testid="gallery-text-model-spike">

      <div className="cg-section">
        <div className="cg-section-title">
          T3.0 Text Model Spike — Engine-based
        </div>
        <div className="spike-approach-desc">
          Own document model (text + atom segments). contentEditable as input
          capture surface. MutationObserver reads typing back to model. DOM
          reconciled from model. Native browser caret. Own undo stack.
          Return vs Enter distinguished via e.code.
        </div>
      </div>

      <div className="cg-divider" />

      <div className="cg-section">
        <div className="cg-section-title">Editor</div>
        <div className="spike-toolbar">
          <TugPushButton size="sm" onClick={handleInsertAtom}>
            Insert Atom
          </TugPushButton>
          <TugPushButton size="sm" emphasis="outlined" onClick={handleClear}>
            Clear
          </TugPushButton>
          <span className="spike-status" ref={statusRef}>chars: 0 | atoms: 0</span>
        </div>
        <div
          ref={editorRef}
          className="spike-input spike-contenteditable"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="Text model spike editor"
          data-placeholder="Type here... Insert atoms, test backspace, undo, IME, Return vs Enter"
          data-empty="true"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          suppressContentEditableWarning
        />
        <div className="spike-toolbar">
          <TugChoiceGroup
            items={ENTER_CHOICES}
            value={enterMode}
            size="sm"
            onValueChange={handleEnterMode}
          />
        </div>
      </div>

      <div className="cg-divider" />

      <div className="cg-section">
        <div className="cg-section-title">Test Matrix</div>
        <div className="spike-approach-desc">
          <strong>1. Typing:</strong> Type, arrows, Shift+arrow select, click+drag select, Cmd+A (editor only).<br />
          <strong>2. Atoms:</strong> Insert Atom button. Cursor lands after the pill. Arrow past it.<br />
          <strong>3. Backspace:</strong> Adjacent to atom → first press highlights, second deletes.<br />
          <strong>4. Undo:</strong> Cmd+Z undoes typing, atom insertion, and clear. Cmd+Shift+Z redoes.<br />
          <strong>5. IME:</strong> Japanese/Chinese composition. Return during composition → IME acceptance.<br />
          <strong>6. Return vs Enter:</strong> Toggle mode below. Return = main keyboard. Enter = numpad.<br />
          <strong>7. Resize:</strong> Auto-grows to {MAX_ROWS} rows, then scrolls.<br />
          <strong>8. Paste:</strong> Rich text → plain text.<br />
          <strong>9. No marked text:</strong> US keyboard typing should NOT show composition underlines.
        </div>
      </div>

      <div className="cg-divider" />

      <div className="cg-section">
        <div className="cg-section-title">Event Log</div>
        <div ref={logRef} className="spike-log" />
      </div>

    </div>
  );
}

// ===================================================================
// Export
// ===================================================================

export function GalleryTextModelSpike() {
  return <SpikeEditor />;
}
