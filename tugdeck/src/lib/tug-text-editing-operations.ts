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
