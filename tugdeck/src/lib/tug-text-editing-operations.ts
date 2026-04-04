/**
 * TEOI — Text Editing Operation Inventory
 *
 * Formal catalog of every editing operation as a state machine transition:
 *
 *   TugTextEditingState::incoming × Operation → TugTextEditingState::outgoing
 *
 * This file defines the operation taxonomy, the canonical incoming states,
 * and the framework for specifying expected outcomes. The data here is pure —
 * no DOM, no engine dependency. It imports only the type definitions.
 *
 * Companion to: t3-prompt-input-plan.md §3d
 *
 * The inventory covers:
 *   - All TugTextInputDelegate mutation operations
 *   - MutationObserver typing path (via execCommand simulation)
 *   - Deletion by granularity (character, word, soft line, paragraph)
 *   - IME composition sequences (compositionstart → update → end)
 *   - Two-step atom deletion (highlight then delete)
 *   - Typeahead accept/cancel
 *   - Transpose, kill/yank, open line
 *   - Paste
 */

import type { Segment, TugTextEditingState } from "./tug-text-engine";
import type { AtomSegment } from "@/components/tugways/tug-atom";

// ===================================================================
// Operation taxonomy
// ===================================================================

/**
 * Every operation the editing engine can perform.
 *
 * Operations fall into categories:
 *   - Text entry: typing (MutationObserver path), insertText (API path)
 *   - Atom manipulation: insertAtom, typeahead accept
 *   - Deletion: character (deleteBackward/Forward), word, soft line, paragraph, clear
 *   - Selection: selectAll, setSelectedRange
 *   - Undo: undo, redo
 *   - IME: compositionStart, compositionUpdate, compositionEnd
 *   - Text transforms: transpose
 *   - Kill ring: kill (Ctrl+K), yank (Ctrl+Y)
 *   - Clipboard: paste
 *   - Structure: openLine (Ctrl+O)
 *
 * The `type` discriminant identifies the operation. Parameters carry
 * operation-specific data (e.g., the text to insert, the atom to add).
 */
export type Operation =
  // --- Text entry ---
  | { type: "typing"; text: string }           // Browser typing → MutationObserver path (execCommand)
  | { type: "insertText"; text: string }        // Delegate API path (programmatic)
  | { type: "paste"; text: string }             // Clipboard paste (→ insertText internally)

  // --- Atom manipulation ---
  | { type: "insertAtom"; atom: AtomSegment }   // Insert atom at cursor/selection
  | { type: "typeaheadAccept" }                 // Accept current typeahead selection

  // --- Deletion: character granularity ---
  | { type: "deleteBackward" }                  // Delete/Backspace — deleteContentBackward
  | { type: "deleteForward" }                   // Fn+Delete — deleteContentForward
  | { type: "clear" }                           // Clear all content

  // --- Deletion: word granularity ---
  | { type: "deleteWordBackward" }              // Option+Delete — deleteWordBackward
  | { type: "deleteWordForward" }               // Option+Fn+Delete — deleteWordForward

  // --- Deletion: line granularity (soft/visual line — where text wraps) ---
  | { type: "deleteSoftLineBackward" }          // Cmd+Delete — deleteSoftLineBackward
  | { type: "deleteSoftLineForward" }           // Cmd+Fn+Delete — deleteSoftLineForward

  // --- Deletion: paragraph granularity (hard line — to \n or document edge) ---
  | { type: "deleteParagraphBackward" }         // No standard key; available via visible units
  | { type: "deleteParagraphForward" }          // No standard key; available via visible units

  // --- Selection ---
  | { type: "selectAll" }                       // Cmd+A — select entire document
  | { type: "setSelectedRange"; start: number; end?: number }  // Programmatic cursor/selection

  // --- Undo ---
  | { type: "undo" }
  | { type: "redo" }

  // --- IME composition ---
  | { type: "compositionStart" }                // Begin IME composition
  | { type: "compositionUpdate"; text: string } // Update composition text (in-progress)
  | { type: "compositionEnd"; text: string }    // Finalize composition (committed text)

  // --- Text transforms ---
  | { type: "transpose" }                       // Ctrl+T — swap characters around cursor

  // --- Kill ring ---
  | { type: "killLine" }                        // Ctrl+K — deleteParagraphForward + save to kill ring
  | { type: "yank" }                            // Ctrl+Y — insertFromYank: paste from kill ring

  // --- Structure ---
  | { type: "openLine" }                        // Ctrl+O — insert newline after cursor, cursor stays
  ;

// ===================================================================
// Canonical incoming states
// ===================================================================

/**
 * A named incoming state — a starting condition for operations.
 *
 * Each incoming state has a human-readable name and a factory function
 * that returns a fresh TugTextEditingState. Factory functions (not
 * constants) so every test gets an independent copy.
 */
export interface IncomingState {
  name: string;
  description: string;
  create: () => TugTextEditingState;
}

/** Reusable test atom for TEOI examples. */
export const TEST_ATOM: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "main.rs",
  value: "main.rs",
};

/** Second test atom for multi-atom scenarios. */
export const TEST_ATOM_2: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "lib.rs",
  value: "lib.rs",
};

/**
 * Canonical incoming states.
 *
 * These cover the interesting boundary conditions for editing operations.
 * Every state satisfies the text-atom-text invariant (segments always
 * start and end with text; atoms separated by text).
 */
export const INCOMING_STATES: readonly IncomingState[] = [

  // --- Empty ---
  {
    name: "empty",
    description: "Empty document, cursor at position 0",
    create: () => ({
      segments: [{ kind: "text", text: "" }],
      selection: { start: 0, end: 0 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },

  // --- Text only ---
  {
    name: "text-cursor-start",
    description: "Text 'hello', cursor at start (0)",
    create: () => ({
      segments: [{ kind: "text", text: "hello" }],
      selection: { start: 0, end: 0 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "text-cursor-middle",
    description: "Text 'hello', cursor at middle (3)",
    create: () => ({
      segments: [{ kind: "text", text: "hello" }],
      selection: { start: 3, end: 3 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "text-cursor-end",
    description: "Text 'hello', cursor at end (5)",
    create: () => ({
      segments: [{ kind: "text", text: "hello" }],
      selection: { start: 5, end: 5 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "text-selection-partial",
    description: "Text 'hello', selection 1..4 ('ell')",
    create: () => ({
      segments: [{ kind: "text", text: "hello" }],
      selection: { start: 1, end: 4 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "text-selection-all",
    description: "Text 'hello', entire text selected (0..5)",
    create: () => ({
      segments: [{ kind: "text", text: "hello" }],
      selection: { start: 0, end: 5 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },

  // --- Text + atom ---
  {
    name: "text-atom-cursor-before-atom",
    description: "'hello' + [main.rs] + '', cursor just before atom (5)",
    create: () => ({
      segments: [
        { kind: "text", text: "hello" },
        { ...TEST_ATOM },
        { kind: "text", text: "" },
      ],
      selection: { start: 5, end: 5 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "text-atom-cursor-after-atom",
    description: "'hello' + [main.rs] + '', cursor just after atom (6)",
    create: () => ({
      segments: [
        { kind: "text", text: "hello" },
        { ...TEST_ATOM },
        { kind: "text", text: "" },
      ],
      selection: { start: 6, end: 6 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "text-atom-text-cursor-in-trailing",
    description: "'hello' + [main.rs] + ' world', cursor in trailing text (8)",
    create: () => ({
      segments: [
        { kind: "text", text: "hello" },
        { ...TEST_ATOM },
        { kind: "text", text: " world" },
      ],
      selection: { start: 8, end: 8 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "text-atom-selection-spanning-atom",
    description: "'hello' + [main.rs] + ' world', selection spanning atom (3..8)",
    create: () => ({
      segments: [
        { kind: "text", text: "hello" },
        { ...TEST_ATOM },
        { kind: "text", text: " world" },
      ],
      selection: { start: 3, end: 8 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },

  // --- Multiple atoms ---
  {
    name: "two-atoms-cursor-between",
    description: "'a' + [main.rs] + '' + [lib.rs] + 'z', cursor between atoms (2)",
    create: () => ({
      segments: [
        { kind: "text", text: "a" },
        { ...TEST_ATOM },
        { kind: "text", text: "" },
        { ...TEST_ATOM_2 },
        { kind: "text", text: "z" },
      ],
      selection: { start: 2, end: 2 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "two-atoms-selection-spanning-both",
    description: "'a' + [main.rs] + '' + [lib.rs] + 'z', select all (0..5)",
    create: () => ({
      segments: [
        { kind: "text", text: "a" },
        { ...TEST_ATOM },
        { kind: "text", text: "" },
        { ...TEST_ATOM_2 },
        { kind: "text", text: "z" },
      ],
      selection: { start: 0, end: 5 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },

  // --- Multi-word text (for word-level deletion) ---
  {
    name: "multiword-cursor-mid-word",
    description: "'hello world', cursor in middle of second word (8, after 'wo')",
    create: () => ({
      segments: [{ kind: "text", text: "hello world" }],
      selection: { start: 8, end: 8 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "multiword-cursor-at-space",
    description: "'hello world', cursor at space between words (5)",
    create: () => ({
      segments: [{ kind: "text", text: "hello world" }],
      selection: { start: 5, end: 5 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },

  // --- Atom highlighted (two-step delete pending) ---
  {
    name: "atom-highlighted-single",
    description: "'hello' + [main.rs highlighted] + '', atom at index 1 highlighted",
    create: () => ({
      segments: [
        { kind: "text", text: "hello" },
        { ...TEST_ATOM },
        { kind: "text", text: "" },
      ],
      selection: { start: 5, end: 5 },
      markedText: null,
      highlightedAtomIndices: [1],
    }),
  },

  // --- Newline ---
  {
    name: "multiline-cursor-after-newline",
    description: "'hello\\nworld', cursor at start of second line (6)",
    create: () => ({
      segments: [{ kind: "text", text: "hello\nworld" }],
      selection: { start: 6, end: 6 },
      markedText: null,
      highlightedAtomIndices: [],
    }),
  },

  // --- IME (marked text active) ---
  {
    name: "ime-composing-empty",
    description: "Empty document, IME composition in progress",
    create: () => ({
      segments: [{ kind: "text", text: "" }],
      selection: { start: 0, end: 0 },
      markedText: { start: 0, end: 0 },
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "ime-composing-mid-text",
    description: "'hel' + composing + 'lo', marked text at offset 3",
    create: () => ({
      segments: [{ kind: "text", text: "hello" }],
      selection: { start: 3, end: 3 },
      markedText: { start: 3, end: 3 },
      highlightedAtomIndices: [],
    }),
  },
  {
    name: "ime-composing-after-atom",
    description: "'hello' + [main.rs] + composing, marked text after atom",
    create: () => ({
      segments: [
        { kind: "text", text: "hello" },
        { ...TEST_ATOM },
        { kind: "text", text: "" },
      ],
      selection: { start: 6, end: 6 },
      markedText: { start: 6, end: 6 },
      highlightedAtomIndices: [],
    }),
  },
];

// ===================================================================
// TEOE — Text Editing Operation Example
// ===================================================================

/**
 * A concrete test example: incoming state × operation → expected outgoing state.
 *
 * Each TEOE is a named, documented triple. The test harness:
 *   1. Sets up the incoming state (restoreState + focus)
 *   2. Executes the operation (delegate API or execCommand)
 *   3. Captures the outgoing state
 *   4. Compares with the expected state
 *
 * The `sequenceOps` field supports multi-step operations (e.g., two-step
 * atom delete: deleteBackward → deleteBackward). When present, all
 * operations execute in order and only the final state is compared.
 */
export interface TEOE {
  /** Unique identifier for this example (e.g., "deleteBackward-at-atom-boundary-step1"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** What this example tests and why. */
  description: string;
  /** The starting state (use an IncomingState name or inline state). */
  incoming: TugTextEditingState;
  /** Single operation — mutually exclusive with sequenceOps. */
  operation?: Operation;
  /** Multi-step operation sequence — mutually exclusive with operation. */
  sequenceOps?: Operation[];
  /** The expected state after the operation(s). */
  expected: TugTextEditingState;
  /**
   * Tags for filtering/grouping.
   * Examples: "bug:B01", "ime", "two-step", "undo", "boundary"
   */
  tags?: string[];
}

// ===================================================================
// Operation × State matrix
// ===================================================================

/**
 * Operation–State matrix: which incoming states are interesting for
 * each operation type. This is the TEOI proper — the inventory that
 * tells us which combinations to test.
 *
 * Not every combination is meaningful. The matrix identifies the
 * interesting ones; the TEOE array provides the concrete expected values.
 *
 * Legend:
 *   ● = interesting combination, TEOE required
 *   ○ = degenerate or redundant, can skip
 *   — = not applicable
 *
 * ── Text Entry ─────────────────────────────────────────────────────
 *
 * ┌───────────────────────┬────────┬──────────┬────────┐
 * │ Incoming State        │ typing │insertText│  paste │
 * ├───────────────────────┼────────┼──────────┼────────┤
 * │ empty                 │   ●    │    ●     │   ●    │
 * │ text-cursor-start     │   ●    │    ●     │   ○    │
 * │ text-cursor-middle    │   ●    │    ●     │   ●    │
 * │ text-cursor-end       │   ●    │    ●     │   ○    │
 * │ text-selection-partial│   ●    │    ●     │   ●    │
 * │ text-selection-all    │   ●    │    ●     │   ●    │
 * │ text-atom-before      │   ○    │    ●     │   ○    │
 * │ text-atom-after       │   ●    │    ●     │   ○    │
 * │ text-atom-span-sel    │   ●    │    ●     │   ●    │
 * │ two-atoms-between     │   ●    │    ●     │   ○    │
 * │ multiline             │   ●    │    ○     │   ○    │
 * └───────────────────────┴────────┴──────────┴────────┘
 *
 * ── Atom Manipulation ──────────────────────────────────────────────
 *
 * ┌───────────────────────┬──────────┬────────────────┐
 * │ Incoming State        │insertAtom│typeaheadAccept  │
 * ├───────────────────────┼──────────┼────────────────-┤
 * │ empty                 │    ●     │       ●        │
 * │ text-cursor-start     │    ●     │       ○        │
 * │ text-cursor-middle    │    ●     │       ●        │
 * │ text-cursor-end       │    ●     │       ○        │
 * │ text-selection-partial│    ●     │       ○        │
 * │ text-selection-all    │    ●     │       ○        │
 * │ text-atom-before      │    ●     │       ○        │
 * │ text-atom-after       │    ●     │       ○        │
 * │ two-atoms-between     │    ●     │       ○        │
 * └───────────────────────┴──────────┴────────────────┘
 *
 * ── Deletion: Character ────────────────────────────────────────────
 *
 * ┌───────────────────────┬─────────┬────────┐
 * │ Incoming State        │ delBack │ delFwd │
 * ├───────────────────────┼─────────┼────────┤
 * │ empty                 │    ●    │   ●    │
 * │ text-cursor-start     │    ●    │   ●    │
 * │ text-cursor-middle    │    ●    │   ●    │
 * │ text-cursor-end       │    ●    │   ●    │
 * │ text-selection-partial│    ●    │   ●    │
 * │ text-selection-all    │    ●    │   ●    │
 * │ text-atom-before      │    ●    │   ●    │  ← two-step highlight
 * │ text-atom-after       │    ●    │   ●    │  ← two-step highlight
 * │ text-atom-text-trail  │    ●    │   ●    │
 * │ text-atom-span-sel    │    ●    │   ●    │
 * │ two-atoms-between     │    ●    │   ●    │
 * │ two-atoms-span-all    │    ●    │   ●    │
 * │ multiline             │    ●    │   ●    │
 * └───────────────────────┴─────────┴────────┘
 *
 * ── Deletion: Word ─────────────────────────────────────────────────
 *
 * ┌───────────────────────┬─────────────┬────────────┐
 * │ Incoming State        │ delWordBack │ delWordFwd │
 * ├───────────────────────┼─────────────┼────────────┤
 * │ empty                 │      ●      │     ●      │
 * │ text-cursor-start     │      ●      │     ●      │
 * │ text-cursor-middle    │      ●      │     ●      │
 * │ text-cursor-end       │      ●      │     ●      │
 * │ text-selection-partial│      ●      │     ●      │
 * │ multiword-mid-word    │      ●      │     ●      │  ← key case: word boundary scan
 * │ multiword-at-space    │      ●      │     ●      │  ← key case: at boundary
 * │ text-atom-before      │      ●      │     ●      │  ← atom as word boundary
 * │ text-atom-after       │      ●      │     ●      │  ← atom as word boundary
 * │ two-atoms-between     │      ●      │     ●      │
 * │ multiline             │      ●      │     ●      │
 * └───────────────────────┴─────────────┴────────────┘
 *
 * ── Deletion: Soft Line (visual wrap boundary) ─────────────────────
 *
 * ┌───────────────────────┬──────────────┬─────────────┐
 * │ Incoming State        │ delSoftLnBck │ delSoftLnFwd│
 * ├───────────────────────┼──────────────┼─────────────┤
 * │ empty                 │      ●       │      ●      │
 * │ text-cursor-start     │      ●       │      ●      │
 * │ text-cursor-middle    │      ●       │      ●      │
 * │ text-cursor-end       │      ●       │      ●      │
 * │ text-atom-before      │      ●       │      ●      │
 * │ text-atom-after       │      ●       │      ●      │
 * │ two-atoms-between     │      ●       │      ●      │
 * │ multiline             │      ●       │      ●      │
 * └───────────────────────┴──────────────┴─────────────┘
 *   Note: soft line requires layout info (where did text wrap?).
 *   In non-wrapping contexts, soft line ≡ paragraph.
 *
 * ── Deletion: Paragraph (hard line — to \n or document edge) ──────
 *
 * ┌───────────────────────┬──────────────┬─────────────┬──────────┐
 * │ Incoming State        │ delParaBack  │ delParaFwd  │ killLine │
 * ├───────────────────────┼──────────────┼─────────────┼──────────┤
 * │ empty                 │      ●       │      ●      │    ●     │
 * │ text-cursor-start     │      ●       │      ●      │    ●     │
 * │ text-cursor-middle    │      ●       │      ●      │    ●     │
 * │ text-cursor-end       │      ●       │      ●      │    ●     │
 * │ text-atom-before      │      ●       │      ●      │    ●     │
 * │ text-atom-after       │      ●       │      ●      │    ●     │
 * │ two-atoms-between     │      ●       │      ●      │    ●     │
 * │ multiline             │      ●       │      ●      │    ●     │  ← key case: \n boundary
 * └───────────────────────┴──────────────┴─────────────┴──────────┘
 *   Note: killLine = deleteParagraphForward + save to kill ring.
 *   In multiline, soft line and paragraph diverge at wrap boundaries.
 *
 * ── Selection, Undo, Clear ─────────────────────────────────────────
 *
 * ┌───────────────────────┬───────────┬────────┬──────────┬──────┬──────┐
 * │ Incoming State        │ selectAll │  clear │setSelRng │ undo │ redo │
 * ├───────────────────────┼───────────┼────────┼──────────┼──────┼──────┤
 * │ empty                 │     ●     │   ●    │    ○     │  ●   │  ●   │
 * │ text-cursor-start     │     ●     │   ●    │    ○     │  ○   │  ○   │
 * │ text-cursor-middle    │     ○     │   ○    │    ●     │  ○   │  ○   │
 * │ text-atom-before      │     ●     │   ●    │    ●     │  ○   │  ○   │
 * │ text-selection-partial│     ○     │   ●    │    ○     │  ○   │  ○   │
 * │ two-atoms-span-all    │     ○     │   ●    │    ○     │  ○   │  ○   │
 * │ multiline             │     ●     │   ○    │    ○     │  ○   │  ○   │
 * └───────────────────────┴───────────┴────────┴──────────┴──────┴──────┘
 *   Note: undo/redo use operation sequences (do X, then undo, check state).
 *
 * ── Text Transforms & Kill Ring ────────────────────────────────────
 *
 * ┌───────────────────────┬───────────┬──────┬──────────┐
 * │ Incoming State        │ transpose │ yank │ openLine │
 * ├───────────────────────┼───────────┼──────┼──────────┤
 * │ empty                 │     ●     │  ●   │    ●     │
 * │ text-cursor-start     │     ●     │  ○   │    ●     │
 * │ text-cursor-middle    │     ●     │  ●   │    ●     │
 * │ text-cursor-end       │     ●     │  ○   │    ●     │
 * │ text-atom-before      │     ●     │  ●   │    ●     │  ← transpose with atom boundary
 * │ text-atom-after       │     ●     │  ○   │    ●     │
 * │ multiline             │     ●     │  ○   │    ●     │
 * └───────────────────────┴───────────┴──────┴──────────┘
 *   Note: yank requires a preceding killLine to populate the kill ring.
 *   Tested as killLine → yank sequences.
 *
 * ── IME Composition ────────────────────────────────────────────────
 *
 * ┌───────────────────────┬────────────────────────────────────────┐
 * │ Incoming State        │ compositionStart → update → end       │
 * ├───────────────────────┼────────────────────────────────────────┤
 * │ empty                 │  ● full sequence                      │
 * │ text-cursor-start     │  ● compose at start                   │
 * │ text-cursor-middle    │  ● compose mid-word                   │
 * │ text-cursor-end       │  ● compose at end                     │
 * │ text-atom-after       │  ● compose immediately after atom     │
 * │ ime-composing-empty   │  ● update + cancel (abandon)          │
 * │ ime-composing-mid-text│  ● update + commit                    │
 * │ ime-composing-aft-atom│  ● update + commit after atom         │
 * └───────────────────────┴────────────────────────────────────────┘
 *
 * Total ● cells: ~160 interesting combinations.
 * Each ● becomes one or more TEOEs (two-step delete, undo sequences,
 * IME sequences, killLine→yank pairs).
 */

// ===================================================================
// Helpers for building TEOEs
// ===================================================================

/** Shorthand: create a text segment. */
export function text(t: string): Segment {
  return { kind: "text", text: t };
}

/** Shorthand: create the TEST_ATOM segment (main.rs). */
export function atom1(): Segment {
  return { ...TEST_ATOM };
}

/** Shorthand: create the TEST_ATOM_2 segment (lib.rs). */
export function atom2(): Segment {
  return { ...TEST_ATOM_2 };
}

/** Shorthand: create a TugTextEditingState. */
export function state(
  segments: Segment[],
  selection: { start: number; end: number } | null = null,
  markedText: { start: number; end: number } | null = null,
  highlightedAtomIndices: number[] = [],
): TugTextEditingState {
  return { segments, selection, markedText, highlightedAtomIndices };
}

/** Shorthand: collapsed cursor at offset. */
export function cursor(offset: number): { start: number; end: number } {
  return { start: offset, end: offset };
}

/** Shorthand: selection range. */
export function sel(start: number, end: number): { start: number; end: number } {
  return { start, end };
}

// ===================================================================
// Hand-written TEOEs — interesting boundary cases
//
// These are the promoted cases that need explicit attention.
// Each one documents a specific behavior decision.
// ===================================================================

export const HAND_WRITTEN_TEOES: readonly TEOE[] = [

  // ── Text Entry ───────────────────────────────────────────────────

  {
    id: "typing-into-empty",
    name: "Type 'a' into empty document",
    description: "Simplest case: one character into empty document via browser typing path",
    incoming: state([text("")], cursor(0)),
    operation: { type: "typing", text: "a" },
    expected: state([text("a")], cursor(1)),
    tags: ["text-entry"],
  },
  {
    id: "insertText-into-empty",
    name: "insertText 'a' into empty document",
    description: "Same as typing-into-empty but via delegate API — must produce identical result",
    incoming: state([text("")], cursor(0)),
    operation: { type: "insertText", text: "a" },
    expected: state([text("a")], cursor(1)),
    tags: ["text-entry", "api"],
  },
  {
    id: "typing-at-middle",
    name: "Type 'x' at middle of 'hello'",
    description: "Insert character mid-text, cursor advances past insertion",
    incoming: state([text("hello")], cursor(3)),
    operation: { type: "typing", text: "x" },
    expected: state([text("helxlo")], cursor(4)),
    tags: ["text-entry"],
  },
  {
    id: "insertText-replaces-selection",
    name: "insertText 'x' with partial selection",
    description: "Ranged selection replaced by inserted text — was a bug before deleteRange fix",
    incoming: state([text("hello")], sel(1, 4)),
    operation: { type: "insertText", text: "x" },
    expected: state([text("hxo")], cursor(2)),
    tags: ["text-entry", "selection", "bug-fix"],
  },
  {
    id: "insertText-replaces-all",
    name: "insertText 'x' with full selection",
    description: "Entire document selected, replaced by single character",
    incoming: state([text("hello")], sel(0, 5)),
    operation: { type: "insertText", text: "x" },
    expected: state([text("x")], cursor(1)),
    tags: ["text-entry", "selection"],
  },
  {
    id: "typing-after-atom",
    name: "Type 'x' after atom",
    description: "Cursor after atom, character goes into trailing text segment",
    incoming: state([text("hello"), atom1(), text("")], cursor(6)),
    operation: { type: "typing", text: "x" },
    expected: state([text("hello"), atom1(), text("x")], cursor(7)),
    tags: ["text-entry", "atom-boundary"],
  },
  {
    id: "insertText-spanning-atom-selection",
    name: "insertText 'x' with selection spanning atom",
    description: "Selection spans text + atom + text — all replaced by 'x'",
    incoming: state([text("hello"), atom1(), text(" world")], sel(3, 8)),
    operation: { type: "insertText", text: "x" },
    expected: state([text("helxorld")], cursor(4)),
    tags: ["text-entry", "atom-boundary", "selection"],
  },

  // ── Atom Insertion ───────────────────────────────────────────────

  {
    id: "insertAtom-into-empty",
    name: "Insert atom into empty document",
    description: "Atom at start, cursor after atom, text-atom-text invariant holds",
    incoming: state([text("")], cursor(0)),
    operation: { type: "insertAtom", atom: TEST_ATOM },
    expected: state([text(""), atom1(), text("")], cursor(1)),
    tags: ["atom"],
  },
  {
    id: "insertAtom-mid-text",
    name: "Insert atom at middle of text",
    description: "Text splits around atom, cursor after atom",
    incoming: state([text("hello")], cursor(3)),
    operation: { type: "insertAtom", atom: TEST_ATOM },
    expected: state([text("hel"), atom1(), text("lo")], cursor(4)),
    tags: ["atom"],
  },
  {
    id: "insertAtom-replaces-selection",
    name: "Insert atom with ranged selection",
    description: "Selection deleted first, then atom inserted at collapsed cursor",
    incoming: state([text("hello")], sel(1, 4)),
    operation: { type: "insertAtom", atom: TEST_ATOM },
    expected: state([text("h"), atom1(), text("o")], cursor(2)),
    tags: ["atom", "selection"],
  },

  // ── Character Deletion ───────────────────────────────────────────

  {
    id: "deleteBackward-empty",
    name: "deleteBackward in empty document",
    description: "No-op: nothing to delete",
    incoming: state([text("")], cursor(0)),
    operation: { type: "deleteBackward" },
    expected: state([text("")], cursor(0)),
    tags: ["delete", "boundary"],
  },
  {
    id: "deleteBackward-at-start",
    name: "deleteBackward at start of text",
    description: "No-op: cursor at position 0",
    incoming: state([text("hello")], cursor(0)),
    operation: { type: "deleteBackward" },
    expected: state([text("hello")], cursor(0)),
    tags: ["delete", "boundary"],
  },
  {
    id: "deleteBackward-mid-text",
    name: "deleteBackward in middle of text",
    description: "Delete character before cursor, cursor moves back",
    incoming: state([text("hello")], cursor(3)),
    operation: { type: "deleteBackward" },
    expected: state([text("helo")], cursor(2)),
    tags: ["delete"],
  },
  {
    id: "deleteBackward-with-selection",
    name: "deleteBackward with ranged selection",
    description: "Selection deleted, cursor collapses to start — granularity ignored",
    incoming: state([text("hello")], sel(1, 4)),
    operation: { type: "deleteBackward" },
    expected: state([text("ho")], cursor(1)),
    tags: ["delete", "selection"],
  },
  {
    id: "deleteForward-at-end",
    name: "deleteForward at end of text",
    description: "No-op: nothing after cursor",
    incoming: state([text("hello")], cursor(5)),
    operation: { type: "deleteForward" },
    expected: state([text("hello")], cursor(5)),
    tags: ["delete", "boundary"],
  },
  {
    id: "deleteForward-mid-text",
    name: "deleteForward in middle of text",
    description: "Delete character after cursor, cursor stays",
    incoming: state([text("hello")], cursor(3)),
    operation: { type: "deleteForward" },
    expected: state([text("helo")], cursor(3)),
    tags: ["delete"],
  },

  // ── Two-Step Atom Deletion ───────────────────────────────────────

  {
    id: "deleteBackward-at-atom-step1",
    name: "deleteBackward at atom boundary — highlights atom",
    description: "Step 1 of two-step: cursor after atom, first backspace highlights it",
    incoming: state([text("hello"), atom1(), text("")], cursor(6)),
    operation: { type: "deleteBackward" },
    expected: state([text("hello"), atom1(), text("")], cursor(6), null, [1]),
    tags: ["two-step", "atom-boundary"],
  },
  {
    id: "deleteBackward-at-atom-step2",
    name: "deleteBackward with highlighted atom — deletes it",
    description: "Step 2 of two-step: atom highlighted, second backspace deletes it",
    incoming: state([text("hello"), atom1(), text("")], cursor(5), null, [1]),
    operation: { type: "deleteBackward" },
    expected: state([text("hello")], cursor(5)),
    tags: ["two-step", "atom-boundary"],
  },
  {
    id: "deleteForward-at-atom-step1",
    name: "deleteForward at atom boundary — highlights atom",
    description: "Step 1: cursor before atom, forward delete highlights it",
    incoming: state([text("hello"), atom1(), text("")], cursor(5)),
    operation: { type: "deleteForward" },
    expected: state([text("hello"), atom1(), text("")], cursor(5), null, [1]),
    tags: ["two-step", "atom-boundary"],
  },
  {
    id: "deleteForward-at-atom-step2",
    name: "deleteForward with highlighted atom — deletes it",
    description: "Step 2: atom highlighted, forward delete removes it",
    incoming: state([text("hello"), atom1(), text("")], cursor(5), null, [1]),
    operation: { type: "deleteForward" },
    expected: state([text("hello")], cursor(5)),
    tags: ["two-step", "atom-boundary"],
  },
  {
    id: "two-step-delete-full-sequence",
    name: "Two deleteBackwards at atom boundary",
    description: "End-to-end: first highlights, second deletes",
    incoming: state([text("hello"), atom1(), text("")], cursor(6)),
    sequenceOps: [{ type: "deleteBackward" }, { type: "deleteBackward" }],
    expected: state([text("hello")], cursor(5)),
    tags: ["two-step", "sequence"],
  },

  // ── Deletion with Selection Spanning Atoms ───────────────────────

  {
    id: "deleteBackward-selection-spanning-atom",
    name: "deleteBackward with selection spanning atom",
    description: "Selection includes text+atom+text — all deleted, cursor at start",
    incoming: state([text("hello"), atom1(), text(" world")], sel(3, 8)),
    operation: { type: "deleteBackward" },
    expected: state([text("helorld")], cursor(3)),
    tags: ["delete", "selection", "atom-boundary"],
  },

  // ── Selection ────────────────────────────────────────────────────

  {
    id: "selectAll-text-only",
    name: "selectAll on text-only document",
    description: "Full text selected",
    incoming: state([text("hello")], cursor(0)),
    operation: { type: "selectAll" },
    expected: state([text("hello")], sel(0, 5)),
    tags: ["selection"],
  },
  {
    id: "selectAll-with-atoms",
    name: "selectAll on document with atoms",
    description: "Selection spans entire document including atoms",
    incoming: state([text("hello"), atom1(), text("")], cursor(0)),
    operation: { type: "selectAll" },
    expected: state([text("hello"), atom1(), text("")], sel(0, 6)),
    tags: ["selection", "atom-boundary"],
  },

  // ── Clear ────────────────────────────────────────────────────────

  {
    id: "clear-text-only",
    name: "Clear text-only document",
    description: "Document reset to empty, cursor at 0",
    incoming: state([text("hello")], cursor(3)),
    operation: { type: "clear" },
    expected: state([text("")], cursor(0)),
    tags: ["clear"],
  },
  {
    id: "clear-with-atoms",
    name: "Clear document with atoms",
    description: "Everything removed including atoms",
    incoming: state([text("hello"), atom1(), text(" world")], cursor(8)),
    operation: { type: "clear" },
    expected: state([text("")], cursor(0)),
    tags: ["clear"],
  },
  {
    id: "clear-with-highlighted-atom",
    name: "Clear with highlighted atom",
    description: "Atom highlight cleared along with content",
    incoming: state([text("hello"), atom1(), text("")], cursor(5), null, [1]),
    operation: { type: "clear" },
    expected: state([text("")], cursor(0)),
    tags: ["clear", "two-step"],
  },

  // ── Undo / Redo Sequences ────────────────────────────────────────

  {
    id: "undo-after-insertText",
    name: "Undo after insertText",
    description: "Type text then undo — restores original",
    incoming: state([text("hello")], cursor(5)),
    sequenceOps: [{ type: "insertText", text: " world" }, { type: "undo" }],
    expected: state([text("hello")], cursor(5)),
    tags: ["undo", "sequence"],
  },
  {
    id: "undo-redo-roundtrip",
    name: "Undo then redo restores change",
    description: "undo + redo is identity for the last operation",
    incoming: state([text("hello")], cursor(5)),
    sequenceOps: [
      { type: "insertText", text: " world" },
      { type: "undo" },
      { type: "redo" },
    ],
    expected: state([text("hello world")], cursor(11)),
    tags: ["undo", "redo", "sequence"],
  },
  {
    id: "undo-after-atom-delete",
    name: "Undo after two-step atom deletion",
    description: "Delete atom via two-step, undo restores it",
    incoming: state([text("hello"), atom1(), text("")], cursor(6)),
    sequenceOps: [
      { type: "deleteBackward" },   // highlight
      { type: "deleteBackward" },   // delete
      { type: "undo" },             // restore
    ],
    expected: state([text("hello"), atom1(), text("")], cursor(5)),
    tags: ["undo", "two-step", "sequence"],
  },

  // ── Multiline ────────────────────────────────────────────────────

  {
    id: "deleteBackward-at-newline",
    name: "deleteBackward at start of second line",
    description: "Joins lines by deleting the newline character",
    incoming: state([text("hello\nworld")], cursor(6)),
    operation: { type: "deleteBackward" },
    expected: state([text("helloworld")], cursor(5)),
    tags: ["delete", "multiline"],
  },
  {
    id: "deleteForward-at-newline",
    name: "deleteForward at end of first line",
    description: "Joins lines by deleting the newline character forward",
    incoming: state([text("hello\nworld")], cursor(5)),
    operation: { type: "deleteForward" },
    expected: state([text("helloworld")], cursor(5)),
    tags: ["delete", "multiline"],
  },

  // ── Multiple Atoms ───────────────────────────────────────────────

  {
    id: "deleteBackward-between-atoms",
    name: "deleteBackward between two atoms",
    description: "Cursor in empty text between atoms — highlights second atom (backward)",
    incoming: state([text("a"), atom1(), text(""), atom2(), text("z")], cursor(2)),
    operation: { type: "deleteBackward" },
    expected: state([text("a"), atom1(), text(""), atom2(), text("z")], cursor(2), null, [1]),
    tags: ["two-step", "atom-boundary", "multi-atom"],
  },

  // ── setSelectedRange ─────────────────────────────────────────────

  {
    id: "setSelectedRange-collapse",
    name: "setSelectedRange to collapsed cursor",
    description: "Programmatic cursor positioning",
    incoming: state([text("hello")], cursor(0)),
    operation: { type: "setSelectedRange", start: 3 },
    expected: state([text("hello")], cursor(3)),
    tags: ["selection", "api"],
  },
  {
    id: "setSelectedRange-range",
    name: "setSelectedRange to range",
    description: "Programmatic range selection",
    incoming: state([text("hello")], cursor(0)),
    operation: { type: "setSelectedRange", start: 1, end: 4 },
    expected: state([text("hello")], sel(1, 4)),
    tags: ["selection", "api"],
  },
];

// ===================================================================
// Generated TEOEs — mechanical cases
//
// These cover the repetitive patterns that don't need hand-written
// attention: no-ops on empty, selection-overrides-granularity, etc.
// Any generated TEOE can be "promoted" to HAND_WRITTEN_TEOES by
// copying it there with modifications.
// ===================================================================

/**
 * Generate no-op TEOEs: operations that should do nothing in certain states.
 */
function generateNoOps(): TEOE[] {
  const empty = INCOMING_STATES.find(s => s.name === "empty")!;
  const textStart = INCOMING_STATES.find(s => s.name === "text-cursor-start")!;
  const textEnd = INCOMING_STATES.find(s => s.name === "text-cursor-end")!;

  return [
    // deleteBackward at start/empty
    ...[empty, textStart].map(s => ({
      id: `gen-deleteBackward-noop-${s.name}`,
      name: `deleteBackward on ${s.name} is no-op`,
      description: `Nothing to delete backward`,
      incoming: s.create(),
      operation: { type: "deleteBackward" as const },
      expected: s.create(),
      tags: ["generated", "noop", "delete"],
    })),
    // deleteForward at end/empty
    ...[empty, textEnd].map(s => ({
      id: `gen-deleteForward-noop-${s.name}`,
      name: `deleteForward on ${s.name} is no-op`,
      description: `Nothing to delete forward`,
      incoming: s.create(),
      operation: { type: "deleteForward" as const },
      expected: s.create(),
      tags: ["generated", "noop", "delete"],
    })),
    // undo/redo with no history
    {
      id: "gen-undo-noop-empty",
      name: "undo on empty (no history) is no-op",
      description: "Nothing to undo",
      incoming: empty.create(),
      operation: { type: "undo" as const },
      expected: empty.create(),
      tags: ["generated", "noop", "undo"],
    },
    {
      id: "gen-redo-noop-empty",
      name: "redo on empty (no history) is no-op",
      description: "Nothing to redo",
      incoming: empty.create(),
      operation: { type: "redo" as const },
      expected: empty.create(),
      tags: ["generated", "noop", "redo"],
    },
  ];
}

/**
 * Generate selection-overrides-granularity TEOEs:
 * When there's a ranged selection, all delete operations just delete the selection.
 */
function generateSelectionOverrides(): TEOE[] {
  const partial = INCOMING_STATES.find(s => s.name === "text-selection-partial")!;
  // "hello" with selection 1..4 ("ell") — deleting gives "ho" cursor at 1
  const deleteOps: { type: string; label: string }[] = [
    { type: "deleteBackward", label: "deleteBackward" },
    { type: "deleteForward", label: "deleteForward" },
    { type: "deleteWordBackward", label: "deleteWordBackward" },
    { type: "deleteWordForward", label: "deleteWordForward" },
    { type: "deleteSoftLineBackward", label: "deleteSoftLineBackward" },
    { type: "deleteSoftLineForward", label: "deleteSoftLineForward" },
    { type: "deleteParagraphBackward", label: "deleteParagraphBackward" },
    { type: "deleteParagraphForward", label: "deleteParagraphForward" },
  ];

  return deleteOps.map(op => ({
    id: `gen-selection-overrides-${op.type}`,
    name: `${op.label} with ranged selection deletes selection`,
    description: `Selection overrides ${op.label} granularity — just deletes the selected range`,
    incoming: partial.create(),
    operation: { type: op.type } as Operation,
    expected: state([text("ho")], cursor(1)),
    tags: ["generated", "selection-overrides", "delete"],
  }));
}

/**
 * Generate clear TEOEs: clear always produces empty document regardless of content.
 */
function generateClears(): TEOE[] {
  const interesting = [
    "text-cursor-start",
    "text-selection-partial",
    "text-atom-cursor-before-atom",
    "two-atoms-selection-spanning-both",
  ];

  return interesting.map(name => {
    const s = INCOMING_STATES.find(is => is.name === name)!;
    return {
      id: `gen-clear-${name}`,
      name: `clear on ${name} produces empty`,
      description: `Clear always resets to empty document`,
      incoming: s.create(),
      operation: { type: "clear" as const },
      expected: state([text("")], cursor(0)),
      tags: ["generated", "clear"],
    };
  });
}

/**
 * Generate selectAll TEOEs: selectAll always selects 0..flatLength.
 */
function generateSelectAlls(): TEOE[] {
  const cases: { name: string; flatLen: number }[] = [
    { name: "empty", flatLen: 0 },
    { name: "text-cursor-middle", flatLen: 5 },
    { name: "text-atom-cursor-before-atom", flatLen: 6 },
    { name: "multiline-cursor-after-newline", flatLen: 11 },
    { name: "two-atoms-cursor-between", flatLen: 5 },
  ];

  return cases.map(({ name, flatLen }) => {
    const s = INCOMING_STATES.find(is => is.name === name)!;
    const incoming = s.create();
    return {
      id: `gen-selectAll-${name}`,
      name: `selectAll on ${name}`,
      description: `Selection covers entire document (0..${flatLen})`,
      incoming,
      operation: { type: "selectAll" as const },
      expected: { ...incoming, selection: flatLen > 0 ? sel(0, flatLen) : sel(0, 0) },
      tags: ["generated", "selection"],
    };
  });
}

/** All generated TEOEs. */
export function generatedTEOEs(): TEOE[] {
  return [
    ...generateNoOps(),
    ...generateSelectionOverrides(),
    ...generateClears(),
    ...generateSelectAlls(),
  ];
}

/** Complete TEOE collection: hand-written + generated. */
export function allTEOEs(): TEOE[] {
  return [...HAND_WRITTEN_TEOES, ...generatedTEOEs()];
}
