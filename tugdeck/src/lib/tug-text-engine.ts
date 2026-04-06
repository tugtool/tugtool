/**
 * TugTextEngine — editing engine for tug-prompt-input.
 *
 * Atoms are <img> elements with SVG data URIs. All mutations go
 * through execCommand for native undo.
 *
 * [L06] All text/atom rendering via direct DOM manipulation, no React state
 * [L07] Engine is a stable ref; handlers access current state via `this`
 */

import { atomImgHTML, createAtomImgElement, routeAtomImgHTML, TUG_ATOM_CHAR } from "./tug-atom-img";
import type { AtomSegment } from "./tug-atom-img";
import { getTokenValue } from "@/theme-tokens";

// ===================================================================
// Types
// ===================================================================

export type { AtomSegment };

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

/**
 * History provider: navigates through previously submitted entries.
 * The provider manages the stack, cursor, and draft state internally.
 */
export interface HistoryProvider {
  /** Navigate backward. Receives the current editor state (saved as draft on first call). */
  back(current: TugTextEditingState): TugTextEditingState | null;
  /** Navigate forward. Returns the next entry, or the draft when reaching the end. */
  forward(): TugTextEditingState | null;
}

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
  // --- Undo ---
  undo(): void;
  redo(): void;

  // --- Focus ---
  focus(): void;

  // --- Typeahead ---
  readonly isTypeaheadActive: boolean;
  acceptTypeahead(index?: number): void;
  cancelTypeahead(): void;
  typeaheadNavigate(direction: "up" | "down"): void;

  // --- State management ---
  captureState(): TugTextEditingState;
  restoreState(state: TugTextEditingState): void;

  // --- Testing ---
  getEditorElement(): HTMLDivElement | null;
}

// ===================================================================
// TugTextEditingState — serializable editing state snapshot
// ===================================================================

/**
 * TugTextEditingState — serializable snapshot of editing state.
 *
 * Used for persistence via tugbank (survives reload, app quit) [L23].
 * Plain object. No DOM, no methods. JSON round-trips cleanly.
 */
export interface TugTextEditingState {
  /** Plain text with TUG_ATOM_CHAR at atom positions. */
  text: string;
  /** Atom identity and position. Position is the index of TUG_ATOM_CHAR in text. */
  atoms: { position: number; type: string; label: string; value: string }[];
  /** Cursor/selection as flat offsets. Null if editor was not focused. */
  selection: { start: number; end: number } | null;
}


// ===================================================================
// DOM ↔ flat offset helpers
//
// The DOM contains text nodes, <img> atoms (1 char = TUG_ATOM_CHAR), and
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
 * Walk the children of a root element and build a text string.
 * Atom images become TUG_ATOM_CHAR, <br> becomes \n, text nodes pass through.
 * Unknown element wrappers (e.g., <span> from WebKit paste/undo) are
 * recursed into so their text content is not lost.
 */
function domToText(root: HTMLElement): string {
  let text = "";
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? "";
    } else if (isAtomImg(child)) {
      text += TUG_ATOM_CHAR;
    } else if (isBR(child)) {
      text += "\n";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      text += domToText(child as HTMLElement);
    }
  }
  return text;
}

/**
 * Convert a flat character offset to a DOM position (node, offset)
 * suitable for Range.setStart/setEnd.
 *
 * If the flat offset lands inside a text node, node is the text node
 * and offset is the character offset within it. If it lands on an
 * atom or BR, node is the parent and offset is the child index.
 * Unknown element wrappers (e.g., <span> from WebKit paste/undo) are
 * recursed into.
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
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      // Unknown wrapper element — recurse into it
      const textLen = (child.textContent ?? "").length;
      if (remaining <= textLen) {
        return flatToDom(child as HTMLElement, remaining);
      }
      remaining -= textLen;
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
  growDirection: "up" | "down" = "down";
  returnAction: InputAction = "submit";
  numpadEnterAction: InputAction = "submit";
  completionProviders: Record<string, CompletionProvider> = {};
  historyProvider: HistoryProvider | null = null;
  dropHandler: DropHandler | null = null;
  routePrefixes: string[] = [];
  onRouteChange: ((route: string | null) => void) | null = null;

  // Callbacks — wired by tug-prompt-input.tsx
  onSubmit: (() => void) | null = null;
  onChange: (() => void) | null = null;
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

  // Emptiness flag — tracked as state, updated on input events.
  private _empty = true;

  // Route atom flag — true when a route atom occupies position 0.
  private _hasRouteAtom = false;

  // Cached min-height for grow-up margin calculation (avoids getComputedStyle per input).
  private _cachedMinHeight = 0;

  // Drag state — drop caret indicator element [L06]
  private _dropCaret: HTMLDivElement | null = null;
  private _dragEnterCount = 0;

  // @-trigger typeahead state
  private _typeahead = {
    active: false,
    trigger: "",
    provider: null as CompletionProvider | null,
    query: "",
    anchorOffset: 0,
    anchorRect: null as DOMRect | null,
    filtered: [] as CompletionItem[],
    selectedIndex: 0,
    triggerConsumed: false,
  };

  constructor(root: HTMLDivElement) {
    this.root = root;
    this.setupEvents();
  }

  // =================================================================
  // Document content — read directly from DOM
  // =================================================================

  get hasMarkedText(): boolean { return this._composing; }

  isEmpty(): boolean {
    return this._empty;
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
    document.execCommand("delete");
  }

  deleteWordForward(): void {
    document.execCommand("forwardDelete");
  }

  deleteParagraphBackward(): void {
    document.execCommand("delete");
  }

  deleteParagraphForward(): void {
    document.execCommand("forwardDelete");
  }

  clear(): void {
    this.cancelTypeahead();
    this.root.innerHTML = "";
    this._empty = true;
    this._hasRouteAtom = false;
    this.updateEmpty();
    this.onChange?.();
  }

  // =================================================================
  // Undo/Redo — browser's native stack via execCommand
  // =================================================================

  undo(): void {
    document.execCommand("undo");
  }

  redo(): void {
    document.execCommand("redo");
  }

  // =================================================================
  // State — persistence via tugbank [L23]
  // =================================================================

  captureState(): TugTextEditingState {
    const text = this.getText();
    const domAtoms = this.getAtoms();
    const atoms: TugTextEditingState["atoms"] = [];
    let atomIdx = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === TUG_ATOM_CHAR && atomIdx < domAtoms.length) {
        const a = domAtoms[atomIdx];
        atoms.push({ position: i, type: a.type, label: a.label, value: a.value });
        atomIdx++;
      }
    }
    return { text, atoms, selection: this.getSelectedRange() };
  }

  restoreState(state: TugTextEditingState): void {
    this.cancelTypeahead();
    const parts: string[] = [];
    let atomIdx = 0;
    for (let i = 0; i < state.text.length; i++) {
      const ch = state.text[i];
      if (ch === TUG_ATOM_CHAR && atomIdx < state.atoms.length) {
        const a = state.atoms[atomIdx];
        parts.push(atomImgHTML(a.type, a.label, a.value));
        atomIdx++;
      } else if (ch === "\n") {
        parts.push("<br>");
      } else if (ch === "<") {
        parts.push("&lt;");
      } else if (ch === "&") {
        parts.push("&amp;");
      } else {
        parts.push(ch);
      }
    }
    this.root.innerHTML = parts.join("");
    this._empty = state.text.length === 0;
    this._hasRouteAtom = this.hasRouteAtomAtStart();
    this.updateEmpty();
    if (state.selection) {
      this.setSelectedRange(state.selection.start, state.selection.end);
    }
  }

  /** Regenerate all atom images with current theme colors [L23 minimal mutation]. */
  regenerateAtoms(): void {
    const imgs = this.root.querySelectorAll("img[data-atom-label]");
    for (const img of imgs) {
      const el = img as HTMLImageElement;
      const type = el.dataset.atomType ?? "file";
      const label = el.dataset.atomLabel ?? "";
      const value = el.dataset.atomValue ?? "";
      const fresh = createAtomImgElement(type, label, value);
      el.src = fresh.src;
    }
  }

  // =================================================================
  // Internal helpers
  // =================================================================

  /** Update the data-empty attribute for placeholder visibility. */
  private updateEmpty(): void {
    this.root.dataset.empty = this.isEmpty() ? "true" : "false";
  }

  /** Return true if a route atom occupies position 0 in the editor. */
  private hasRouteAtomAtStart(): boolean {
    const first = this.root.childNodes[0];
    return first !== undefined && isAtomImg(first) && (first as HTMLImageElement).dataset.atomType === "route";
  }

  /**
   * Adjust a caret range when the mouse is past an atom's midpoint.
   * caretRangeFromPoint lands before an atom at end-of-line/document
   * because there's no text after it. If the mouse X is past the atom's
   * midpoint, nudge the range to after the atom.
   */
  private adjustRangeForAtom(range: Range, mouseX: number): void {
    const container = range.startContainer;
    const offset = range.startOffset;
    if (container !== this.root) return;
    const child = container.childNodes[offset];
    if (child && isAtomImg(child)) {
      const rect = (child as HTMLElement).getBoundingClientRect();
      if (mouseX > rect.left + rect.width / 2) {
        range.setStart(container, offset + 1);
        range.collapse(true);
      }
    }
  }

  /** Remove the drop caret indicator element. */
  private removeDropCaret(): void {
    if (this._dropCaret) {
      this._dropCaret.remove();
      this._dropCaret = null;
    }
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
      // Let CSS min-height govern when content is short
      this.root.style.height = "";
      this.root.style.overflowY = "hidden";
    }
    // Grow direction: "up" uses negative margin-top to keep the bottom edge
    // fixed. Auto-flips based on available space in the scrollable ancestor,
    // using growDirection as a preference (same logic as popup auto-flip).
    if (this._cachedMinHeight === 0) {
      this._cachedMinHeight = parseFloat(getComputedStyle(this.root).minHeight) || 0;
    }
    const currentHeight = this.root.offsetHeight;
    const growth = currentHeight - this._cachedMinHeight;
    if (growth > 0) {
      let useUp = this.growDirection === "up";
      // Find scrollable ancestor and check available space
      let scrollParent: HTMLElement | null = this.root.parentElement;
      while (scrollParent) {
        const ov = getComputedStyle(scrollParent).overflowY;
        if (ov === "auto" || ov === "scroll" || ov === "hidden") break;
        scrollParent = scrollParent.parentElement;
      }
      if (scrollParent) {
        const clipRect = scrollParent.getBoundingClientRect();
        const rootRect = this.root.getBoundingClientRect();
        const spaceAbove = rootRect.top - clipRect.top;
        const spaceBelow = clipRect.bottom - rootRect.bottom;
        if (useUp && spaceAbove < growth && spaceBelow > spaceAbove) {
          useUp = false;
        } else if (!useUp && spaceBelow < growth && spaceAbove > spaceBelow) {
          useUp = true;
        }
      }
      this.root.style.marginTop = useUp ? `${-growth}px` : "";
    } else {
      this.root.style.marginTop = "";
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
  // Route prefix detection
  // =================================================================

  /** Detect and handle a route prefix as the first character of the document. */
  private detectRoutePrefix(): void {
    if (this._hasRouteAtom) return;
    const text = this.getText();
    if (text.length === 0) return;
    const firstChar = text[0];
    if (!this.routePrefixes.includes(firstChar)) return;

    // Replace the typed character with a route atom
    this.setSelectedRange(0, 1);
    document.execCommand("delete");
    this.setSelectedRange(0, 0);
    document.execCommand("insertHTML", false, routeAtomImgHTML(firstChar));
    this._hasRouteAtom = true;
    this.onRouteChange?.(firstChar);

    // If the prefix is also a completion trigger, activate typeahead manually
    const provider = this.completionProviders[firstChar];
    if (provider) {
      const sel = window.getSelection();
      const anchorRect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
      this._typeahead.active = true;
      this._typeahead.trigger = firstChar;
      this._typeahead.provider = provider;
      this._typeahead.anchorOffset = 1;
      this._typeahead.anchorRect = anchorRect;
      this._typeahead.query = "";
      this._typeahead.triggerConsumed = true;
      this._typeahead.filtered = provider("");
      this._typeahead.selectedIndex = 0;
      this.onTypeaheadChange?.(true, this._typeahead.filtered, 0);
    }
  }

  // =================================================================
  // Typeahead
  // =================================================================

  /** Check if the character just typed is a registered trigger and activate typeahead. */
  private detectTypeaheadTrigger(): void {
    const range = this.getSelectedRange();
    if (!range || range.start !== range.end) return;
    if (range.start === 0) return;

    const text = this.getText();
    const char = text[range.start - 1];
    const provider = this.completionProviders[char];
    if (!provider) return;

    // Capture caret rect for popup anchoring
    const sel = window.getSelection();
    const anchorRect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;

    this._typeahead.active = true;
    this._typeahead.trigger = char;
    this._typeahead.provider = provider;
    this._typeahead.anchorOffset = range.start - 1;
    this._typeahead.anchorRect = anchorRect;
    this._typeahead.query = "";
    this._typeahead.filtered = provider("");
    this._typeahead.selectedIndex = 0;
    this.onTypeaheadChange?.(true, this._typeahead.filtered, 0);
  }

  /** Update the typeahead query from the text between @ and the caret. */
  private updateTypeaheadQuery(): void {
    const range = this.getSelectedRange();
    if (!range || range.start !== range.end) {
      this.cancelTypeahead();
      return;
    }

    // Caret must be after the trigger (or at the anchor when trigger was consumed)
    const minPos = this._typeahead.triggerConsumed
      ? this._typeahead.anchorOffset
      : this._typeahead.anchorOffset + 1;
    if (range.start < minPos) {
      this.cancelTypeahead();
      return;
    }

    const text = this.getText();
    const queryStart = this._typeahead.anchorOffset + (this._typeahead.triggerConsumed ? 0 : 1);
    const query = text.slice(queryStart, range.start);

    // Cancel if query contains a newline (moved to another line)
    if (query.includes("\n")) {
      this.cancelTypeahead();
      return;
    }

    this._typeahead.query = query;
    this._typeahead.filtered = this._typeahead.provider!(query);
    this._typeahead.selectedIndex = Math.min(
      this._typeahead.selectedIndex,
      Math.max(0, this._typeahead.filtered.length - 1),
    );
    this.onTypeaheadChange?.(true, this._typeahead.filtered, this._typeahead.selectedIndex);
  }

  /** Accept a typeahead completion. If index is provided, accept that item; otherwise accept the selected item. */
  acceptTypeahead(index?: number): void {
    if (!this._typeahead.active || this._typeahead.filtered.length === 0) return;
    const idx = index ?? this._typeahead.selectedIndex;
    if (idx < 0 || idx >= this._typeahead.filtered.length) return;
    const item = this._typeahead.filtered[idx];

    // Delete @query and insert the atom
    const start = this._typeahead.anchorOffset;
    const triggerLen = this._typeahead.triggerConsumed ? 0 : 1;
    const end = start + triggerLen + this._typeahead.query.length;
    this.setSelectedRange(start, end);
    document.execCommand("delete");
    const html = atomImgHTML(item.atom.type, item.atom.label, item.atom.value);
    document.execCommand("insertHTML", false, html);

    this.cancelTypeahead();
  }

  /** Cancel the active typeahead session. */
  cancelTypeahead(): void {
    if (!this._typeahead.active) return;
    this._typeahead.active = false;
    this._typeahead.trigger = "";
    this._typeahead.provider = null;
    this._typeahead.query = "";
    this._typeahead.filtered = [];
    this._typeahead.selectedIndex = 0;
    this._typeahead.triggerConsumed = false;
    this.onTypeaheadChange?.(false, [], 0);
  }

  /** Navigate the typeahead selection up or down. */
  typeaheadNavigate(direction: "up" | "down"): void {
    if (!this._typeahead.active) return;
    if (direction === "down") {
      this._typeahead.selectedIndex = Math.min(this._typeahead.selectedIndex + 1, this._typeahead.filtered.length - 1);
    } else {
      this._typeahead.selectedIndex = Math.max(this._typeahead.selectedIndex - 1, 0);
    }
    this.onTypeaheadChange?.(true, this._typeahead.filtered, this._typeahead.selectedIndex);
  }

  /** Whether the typeahead popup is active. */
  get isTypeaheadActive(): boolean { return this._typeahead.active; }

  /** The caret rect captured at @ trigger time, for popup anchoring. */
  get typeaheadAnchorRect(): DOMRect | null { return this._typeahead.anchorRect; }

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

    // 0. Typeahead key interception — registered first so it captures before Enter handler
    this.listen(root, "keydown", (e: Event) => {
      if (!this._typeahead.active) return;
      const ke = e as KeyboardEvent;
      if (ke.isComposing) return;
      if (ke.key === "Tab" || ke.key === "Enter") {
        ke.preventDefault();
        ke.stopImmediatePropagation();
        this.acceptTypeahead();
        return;
      }
      if (ke.key === "ArrowDown") { ke.preventDefault(); ke.stopImmediatePropagation(); this.typeaheadNavigate("down"); return; }
      if (ke.key === "ArrowUp") { ke.preventDefault(); ke.stopImmediatePropagation(); this.typeaheadNavigate("up"); return; }
      if (ke.key === "Escape") { ke.preventDefault(); ke.stopImmediatePropagation(); this.cancelTypeahead(); return; }
    });

    // 1. Return/Enter — submit or newline (skipped when typeahead is active — handler 0 takes it)
    this.listen(root, "keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== "Enter") return;
      if (this._typeahead.active) return;
      if (ke.isComposing || this.hasMarkedText || this._compositionJustEnded) return;

      const isNumpad = ke.code === "NumpadEnter";
      const baseAction = isNumpad ? this.numpadEnterAction : this.returnAction;
      const action = ke.shiftKey
        ? (baseAction === "submit" ? "newline" : "submit")
        : baseAction;

      if (action === "submit") {
        ke.preventDefault();
        this.onSubmit?.();
      }
      // For newline: let the browser handle it natively — no preventDefault,
      // no execCommand. WebKit inserts a <br> or splits the block naturally.
    });

    // 1b. Ctrl+U — kill line backward (not handled natively by WebKit contentEditable)
    this.listen(root, "keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== "u" || !ke.ctrlKey || ke.metaKey || ke.altKey || ke.shiftKey) return;
      if (ke.isComposing || this._compositionJustEnded) return;

      ke.preventDefault();
      const range = this.getSelectedRange();
      if (!range) return;

      // Find beginning of current line: walk backward through text to find \n
      const text = this.getText();
      let lineStart = 0;
      for (let i = range.start - 1; i >= 0; i--) {
        if (text[i] === "\n") {
          lineStart = i + 1;
          break;
        }
      }
      if (lineStart === range.start) return; // already at line start
      this.setSelectedRange(lineStart, range.start);
      document.execCommand("delete");
    });

    // 1c. Ctrl+T — transpose (native handles text, we handle atoms)
    this.listen(root, "keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== "t" || !ke.ctrlKey || ke.metaKey || ke.altKey || ke.shiftKey) return;
      if (ke.isComposing || this._compositionJustEnded) return;

      const range = this.getSelectedRange();
      if (!range || range.start !== range.end) return;
      if (range.start === 0) return;

      const text = this.getText();
      const pos = range.start;

      // Check if either character flanking the cursor is an atom (TUG_ATOM_CHAR)
      const charBefore = pos > 0 ? text[pos - 1] : "";
      const charAfter = pos < text.length ? text[pos] : "";
      const atomInvolved = charBefore === TUG_ATOM_CHAR || charAfter === TUG_ATOM_CHAR;

      if (!atomInvolved) return; // let browser handle native text transpose

      ke.preventDefault();

      // Need at least two characters to transpose
      if (pos === 0 || pos >= text.length) return;

      // Get the atom/text data for positions (pos-1) and (pos)
      const atoms = this.getAtoms();
      let atomIdx = 0;
      for (let i = 0; i < pos - 1; i++) {
        if (text[i] === TUG_ATOM_CHAR) atomIdx++;
      }

      // Build HTML for the two items in swapped order
      const itemBefore = charBefore === TUG_ATOM_CHAR
        ? atomImgHTML(atoms[atomIdx].type, atoms[atomIdx].label, atoms[atomIdx].value)
        : (charBefore === "<" ? "&lt;" : charBefore === "&" ? "&amp;" : charBefore);
      const nextAtomIdx = charBefore === TUG_ATOM_CHAR ? atomIdx + 1 : atomIdx;
      const itemAfter = charAfter === TUG_ATOM_CHAR
        ? atomImgHTML(atoms[nextAtomIdx].type, atoms[nextAtomIdx].label, atoms[nextAtomIdx].value)
        : (charAfter === "<" ? "&lt;" : charAfter === "&" ? "&amp;" : charAfter);

      // Select both characters and replace with swapped content
      this.setSelectedRange(pos - 1, pos + 1);
      document.execCommand("delete");
      document.execCommand("insertHTML", false, itemAfter + itemBefore);
    });

    // 1d. Cmd+Up/Down — history navigation (at start or end of document)
    this.listen(root, "keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      const isUp = ke.key === "ArrowUp";
      const isDown = ke.key === "ArrowDown";
      if ((!isUp && !isDown) || !ke.metaKey || ke.ctrlKey || ke.altKey || ke.shiftKey) return;
      if (!this.historyProvider) return;
      const range = this.getSelectedRange();
      if (!range || range.start !== range.end) return;
      const text = this.getText();
      const atBoundary = range.start === 0 || range.start === text.length;
      if (!atBoundary) return;
      const state = isUp
        ? this.historyProvider.back(this.captureState())
        : this.historyProvider.forward();
      if (!state) return;
      ke.preventDefault();
      this.restoreState(state);
      this.autoResize();
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
      if (this._hasRouteAtom) {
        const range = this.getSelectedRange();
        if (range && range.start === 0 && range.end === 0) {
          this.setSelectedRange(1);
        }
      }
    });

    // 3. Option+Arrow — word boundary clamping at atoms
    this.listen(root, "keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if ((ke.key !== "ArrowLeft" && ke.key !== "ArrowRight") || !ke.altKey || ke.metaKey || ke.ctrlKey) return;
      if (ke.isComposing || this._compositionJustEnded) return;

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
    // Drop caret: a thin line positioned at the prospective insertion point [L06].
    // The browser selection is untouched during drag — preserved per L23.
    this.listen(root, "dragenter", (e: Event) => {
      e.preventDefault();
      this._dragEnterCount++;
      if (this._dragEnterCount === 1) {
        // Hide the blinking caret during drag if selection is collapsed.
        // Ranged selections stay visible (they use ::selection, not caret-color).
        const range = this.getSelectedRange();
        if (range && range.start === range.end) {
          root.style.caretColor = "transparent";
        }
      }
    });

    this.listen(root, "dragleave", () => {
      this._dragEnterCount--;
      if (this._dragEnterCount === 0) {
        this.removeDropCaret();
        root.style.caretColor = "";
      }
    });

    this.listen(root, "dragover", (e: Event) => {
      e.preventDefault();
      const de = e as DragEvent;
      de.dataTransfer!.dropEffect = "copy";
      // Position the drop caret indicator
      const range = document.caretRangeFromPoint(de.clientX, de.clientY);
      if (range) {
        this.adjustRangeForAtom(range, de.clientX);
        const rootRect = root.getBoundingClientRect();
        if (!this._dropCaret) {
          this._dropCaret = document.createElement("div");
          this._dropCaret.style.cssText = "position:absolute;width:2px;pointer-events:none;border-radius:1px";
          this._dropCaret.style.backgroundColor = getTokenValue("--tug7-element-highlight-fill-normal-drop-rest");
          root.appendChild(this._dropCaret);
        }
        const caretRect = range.getBoundingClientRect();
        const styles = getComputedStyle(root);
        const lh = parseFloat(styles.lineHeight) || 24;
        const caretH = Math.round(lh * 0.85);
        if (caretRect.height > 0) {
          this._dropCaret.style.left = `${caretRect.left - rootRect.left + root.scrollLeft}px`;
          const midY = caretRect.top + caretRect.height / 2;
          this._dropCaret.style.top = `${midY - caretH / 2 - rootRect.top + root.scrollTop}px`;
          this._dropCaret.style.height = `${caretH}px`;
        } else {
          // Degenerate rect — try to position relative to the previous sibling
          const container = range.startContainer;
          const offset = range.startOffset;
          let positioned = false;
          if (container === root && offset > 0) {
            const prev = container.childNodes[offset - 1];
            if (prev.nodeType === Node.ELEMENT_NODE) {
              const prevRect = (prev as HTMLElement).getBoundingClientRect();
              if (prevRect.height > 0) {
                const midY = prevRect.top + prevRect.height / 2;
                this._dropCaret.style.left = `${prevRect.right - rootRect.left + root.scrollLeft}px`;
                this._dropCaret.style.top = `${midY - caretH / 2 - rootRect.top + root.scrollTop}px`;
                this._dropCaret.style.height = `${caretH}px`;
                positioned = true;
              }
            } else if (prev.nodeType === Node.TEXT_NODE) {
              const probe = document.createRange();
              probe.setStart(prev, prev.textContent?.length ?? 0);
              probe.collapse(true);
              const probeRect = probe.getBoundingClientRect();
              if (probeRect.height > 0) {
                const midY = probeRect.top + probeRect.height / 2;
                this._dropCaret.style.left = `${probeRect.left - rootRect.left + root.scrollLeft}px`;
                this._dropCaret.style.top = `${midY - caretH / 2 - rootRect.top + root.scrollTop}px`;
                this._dropCaret.style.height = `${caretH}px`;
                positioned = true;
              }
            }
          }
          if (!positioned) {
            // True empty line — snap to line grid, centered in line.
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const relY = de.clientY - rootRect.top + root.scrollTop;
            const line = Math.floor((relY - paddingTop) / lh);
            this._dropCaret.style.left = `${paddingLeft}px`;
            this._dropCaret.style.top = `${paddingTop + line * lh + (lh - caretH) / 2}px`;
            this._dropCaret.style.height = `${caretH}px`;
          }
        }
      }
    });

    this.listen(root, "drop", (e: Event) => {
      e.preventDefault();
      this._dragEnterCount = 0;
      this.removeDropCaret();
      root.style.caretColor = "";
      const de = e as DragEvent;
      const files = de.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Position caret at drop point
      const range = document.caretRangeFromPoint(de.clientX, de.clientY);
      if (range) {
        this.adjustRangeForAtom(range, de.clientX);
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

    // 9 & 10. Change detection + auto-resize + typeahead — input event
    this.listen(root, "input", (e: Event) => {
      const ie = e as InputEvent;
      const inputType = ie.inputType ?? "";
      // Track emptiness as state. Insertions → not empty.
      // Deletions and undo/redo → re-check via getText().
      // A lone "\n" is WebKit's trailing caret-stub BR, not user content.
      if (inputType.startsWith("insert")) {
        this._empty = false;
      } else {
        if (this._hasRouteAtom && !this.hasRouteAtomAtStart()) {
          this._hasRouteAtom = false;
          this.onRouteChange?.(null);
        }
        const text = this.getText();
        this._empty = text.length === 0 || text === "\n";
      }
      this.updateEmpty();
      this.autoResize();
      this.onChange?.();

      if (this._typeahead.active) {
        this.updateTypeaheadQuery();
      } else if (Object.keys(this.completionProviders).length > 0) {
        this.detectTypeaheadTrigger();
      }

      // Prefix detection: first character triggers route change
      if (this.routePrefixes.length > 0 && inputType.startsWith("insert")) {
        this.detectRoutePrefix();
      }
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

    // 12. Cancel typeahead on blur
    this.listen(root, "blur", () => {
      this.cancelTypeahead();
    });
  }

  teardown(): void {
    for (const h of this._handlers) {
      h.target.removeEventListener(h.type, h.fn, h.capture);
    }
    this._handlers.length = 0;
  }
}
