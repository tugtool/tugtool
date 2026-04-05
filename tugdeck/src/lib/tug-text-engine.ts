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
// TugTextEngine — stripped shell (no-op stubs)
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

  constructor(root: HTMLDivElement) {
    this.root = root;
  }

  // --- Document content ---
  get hasMarkedText(): boolean { return false; }
  isEmpty(): boolean { return true; }
  getText(): string { return ""; }
  getAtoms(): AtomSegment[] { return []; }

  // --- Selection ---
  getSelectedRange(): { start: number; end: number } | null { return null; }
  setSelectedRange(_start: number, _end?: number): void {}
  selectAll(): void {}
  getHighlightedAtomIndices(): readonly number[] { return []; }
  setHighlightedAtomIndices(_indices: number[]): void {}

  // --- Mutation ---
  insertText(_text: string): void {}
  insertAtom(_atom: AtomSegment): void {}
  deleteRange(_start: number, _end: number): number { return _start; }
  deleteBackward(): void {}
  deleteForward(): void {}
  deleteWordBackward(): void {}
  deleteWordForward(): void {}
  deleteParagraphBackward(): void {}
  deleteParagraphForward(): void {}
  clear(): void {}
  killLine(): void {}
  yank(): void {}
  transpose(): void {}
  openLine(): void {}

  // --- Undo ---
  get canUndo(): boolean { return false; }
  get canRedo(): boolean { return false; }
  undo(): void {}
  redo(): void {}

  // --- State ---
  captureState(): TugTextEditingState {
    return { segments: [{ kind: "text", text: "" }], selection: null, markedText: null, highlightedAtomIndices: [] };
  }
  restoreState(_state: TugTextEditingState): void {}

  // --- Testing ---
  flushMutations(): void {}

  // --- Lifecycle ---
  teardown(): void {}
}
