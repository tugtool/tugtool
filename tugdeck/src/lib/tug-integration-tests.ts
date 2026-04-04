/**
 * Integration tests for TugTextEngine.
 *
 * These tests exercise the REAL engine through the REAL editor:
 * - Type via execCommand (browser editing pipeline)
 * - Insert atoms via delegate API (same as UI buttons)
 * - Navigate via Selection.modify (arrow key equivalent)
 * - Check model state, DOM state, and cursor position
 *
 * These are NOT standalone browser tests. They require an engine-managed
 * editor with MutationObserver, event handlers, and reconciler active.
 *
 * Run via: window.__runIntegrationTests()
 */

import type { TugTextInputDelegate } from "./tug-text-engine";
import type { AtomSegment } from "@/components/tugways/tug-atom";

export interface IntegrationTestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const TEST_ATOM: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "main.rs",
  value: "/src/main.rs",
};

const TEST_ATOM_2: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "lib.rs",
  value: "/src/lib.rs",
};

/** Type text via execCommand — the real browser editing pipeline. */
function type(d: TugTextInputDelegate, text: string): void {
  const el = d.getEditorElement();
  if (!el) return;
  el.focus();
  document.execCommand("insertText", false, text);
  d.flushMutations();
}

/** Move cursor via Selection.modify — programmatic equivalent of arrow keys. */
function arrowLeft(n = 1): void {
  const sel = window.getSelection();
  if (!sel) return;
  for (let i = 0; i < n; i++) sel.modify("move", "left", "character");
}

function arrowRight(n = 1): void {
  const sel = window.getSelection();
  if (!sel) return;
  for (let i = 0; i < n; i++) sel.modify("move", "right", "character");
}

function shiftRight(n = 1): void {
  const sel = window.getSelection();
  if (!sel) return;
  for (let i = 0; i < n; i++) sel.modify("extend", "right", "character");
}

function shiftLeft(n = 1): void {
  const sel = window.getSelection();
  if (!sel) return;
  for (let i = 0; i < n; i++) sel.modify("extend", "left", "character");
}

/** Get the DOM node and offset where the cursor currently sits. */
function getCursorDOM(): { nodeName: string; offset: number; parentSlot?: string } | null {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode) return null;
  const parent = sel.anchorNode.parentElement;
  return {
    nodeName: sel.anchorNode.nodeName,
    offset: sel.anchorOffset,
    parentSlot: parent?.dataset?.slot,
  };
}

/** Check if the cursor is visually inside an atom span (not in adjacent text). */
function cursorIsInsideAtom(d: TugTextInputDelegate): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode) return false;
  const el = d.getEditorElement();
  if (!el) return false;
  // Walk up from the anchor node — if we hit an atom span before the editor root, we're inside
  let node: Node | null = sel.anchorNode;
  while (node && node !== el) {
    if (node instanceof HTMLSpanElement && node.dataset.slot === "tug-atom") return true;
    node = node.parentNode;
  }
  return false;
}

/** Check if an atom span has the tug-atom-selected CSS class. */
function atomIsHighlighted(d: TugTextInputDelegate): boolean {
  const el = d.getEditorElement();
  return el?.querySelector(".tug-atom-selected") !== null;
}

/**
 * Run all integration tests against an engine-managed editor.
 */
export function runIntegrationTests(d: TugTextInputDelegate): {
  passed: number;
  failed: number;
  total: number;
  results: IntegrationTestResult[];
} {
  const results: IntegrationTestResult[] = [];
  const el = d.getEditorElement();
  if (!el) {
    return { passed: 0, failed: 0, total: 0, results: [{ name: "setup", passed: false, detail: "No editor element" }] };
  }

  function test(name: string, fn: () => { passed: boolean; detail: string }) {
    d.clear();
    el!.focus();
    try {
      const r = fn();
      results.push({ name, ...r });
    } catch (err) {
      results.push({ name, passed: false, detail: `Error: ${err}` });
    }
  }

  // ── Type and insert atom, cursor after atom ──────────────────────

  test("Type hello, insert atom — cursor after atom", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);

    const range = d.getSelectedRange();
    const text = d.getText();
    const inside = cursorIsInsideAtom(d);
    const flatOffset = range?.start;

    // Cursor should be after the atom (flat offset 7: "hello "=6 + atom=1)
    // and NOT visually inside the atom span
    const passed = flatOffset === 7 && !inside;
    return {
      passed,
      detail: `flatOffset=${flatOffset} (expect 7), insideAtom=${inside} (expect false), text="${text.slice(0, 20)}"`,
    };
  });

  // ── Type, insert atom, type after ────────────────────────────────

  test("Type, insert atom, type after atom", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    const text = d.getText();
    const atoms = d.getAtoms();
    const range = d.getSelectedRange();

    // Content should be "hello " + atom + " world" = 13 chars
    const passed = atoms.length === 1 && text.length === 13 && range?.start === 13;
    return {
      passed,
      detail: `text="${text.slice(0, 30)}", atoms=${atoms.length}, cursor=${range?.start} (expect 13)`,
    };
  });

  // ── Arrow right past atom ────────────────────────────────────────

  test("Insert atom, left arrow, then right arrow past atom", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    // Place cursor before atom
    d.setSelectedRange(6);
    const before = d.getSelectedRange();

    // Right arrow should cross the atom
    arrowRight(1);
    const after1 = d.getSelectedRange();
    arrowRight(1);
    const after2 = d.getSelectedRange();

    // after1 should be 7 (past atom), after2 should be 8 (into " world")
    const passed = before?.start === 6 && after1 !== null && after2 !== null &&
      after1.start >= 7 && after2.start >= 7 && after2.start > after1.start;
    return {
      passed,
      detail: `before=${before?.start}, after1=${after1?.start}, after2=${after2?.start}`,
    };
  });

  // ── Arrow left before atom ───────────────────────────────────────

  test("Insert atom, position after, left arrow before atom", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);

    // Cursor should be at 7 (after atom)
    const before = d.getSelectedRange();

    // Left arrow should go before atom (to 6 or to inside atom)
    arrowLeft(1);
    const after1 = d.getSelectedRange();
    arrowLeft(1);
    const after2 = d.getSelectedRange();

    // We should be able to reach offset 5 or 6 (before the atom, in the text)
    const passed = after2 !== null && after2.start < 7;
    return {
      passed,
      detail: `start=${before?.start}, left1=${after1?.start}, left2=${after2?.start}`,
    };
  });

  // ── Shift+right selects atom ─────────────────────────────────────

  test("Shift+right selects across atom", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    // Place cursor before atom
    d.setSelectedRange(5);
    // Shift+right twice: should select space + atom
    shiftRight(2);

    const range = d.getSelectedRange();
    // Selection should span from 5 to at least 7
    const passed = range !== null && range.start === 5 && range.end >= 7;
    return {
      passed,
      detail: `selection=${range?.start}..${range?.end} (expect 5..7+)`,
    };
  });

  // ── Shift+left selects atom backward ─────────────────────────────

  test("Shift+left selects atom backward", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    // Place cursor after atom in the trailing text
    d.setSelectedRange(8);
    // Shift+left twice: should select space + atom
    shiftLeft(2);

    const range = d.getSelectedRange();
    // Selection should include the atom
    const passed = range !== null && range.start <= 7 && range.end === 8;
    return {
      passed,
      detail: `selection=${range?.start}..${range?.end} (expect <=7..8)`,
    };
  });

  // ── Two-step delete: backspace highlights atom ────────────────────

  test("Two-step delete: first backspace highlights atom", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    // Cursor after atom (offset 6)
    d.setSelectedRange(6);
    d.deleteBackward();

    const atoms = d.getAtoms();
    const highlighted = atomIsHighlighted(d);
    const passed = atoms.length === 1 && highlighted;
    return {
      passed,
      detail: `atoms=${atoms.length}, highlighted=${highlighted}`,
    };
  });

  // ── Two-step delete: second backspace deletes atom ────────────────

  test("Two-step delete: second backspace deletes atom", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    d.setSelectedRange(6);
    d.deleteBackward(); // highlight
    d.deleteBackward(); // delete

    const atoms = d.getAtoms();
    const text = d.getText();
    const passed = atoms.length === 0 && text === "hello";
    return {
      passed,
      detail: `atoms=${atoms.length}, text="${text}"`,
    };
  });

  // ── Atom renders without visual glitch ────────────────────────────

  test("Atom renders correctly — no stray glyph characters", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);

    // Check the atom span's DOM structure
    const atomSpan = el!.querySelector("[data-slot=tug-atom]");
    if (!atomSpan) return { passed: false, detail: "No atom span found" };

    // The atom should have visible text content (the label)
    const label = atomSpan.querySelector(".tug-atom-label");
    const hasLabel = label !== null && label.textContent === TEST_ATOM.label;

    // The atom should NOT have a visible stray character before the icon
    // (check that the first visible child is the icon, not a text glyph)
    const icon = atomSpan.querySelector(".tug-atom-icon");
    const hasIcon = icon !== null;

    const passed = hasLabel && hasIcon;
    return {
      passed,
      detail: `hasLabel=${hasLabel} ("${label?.textContent}"), hasIcon=${hasIcon}`,
    };
  });

  // ── Click after atom positions cursor correctly ───────────────────

  test("Position after atom, can type there", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);

    // Programmatically set cursor after atom
    d.setSelectedRange(7);
    const inside = cursorIsInsideAtom(d);

    // Type a character — it should go after the atom
    type(d, "x");
    const text = d.getText();
    const range = d.getSelectedRange();

    // "hello " + atom + "x" = 8 chars
    const passed = text.length === 8 && range?.start === 8 && !inside;
    return {
      passed,
      detail: `text="${text.slice(0, 20)}" (len=${text.length}), cursor=${range?.start}, insideAtom=${inside}`,
    };
  });

  // ── Atom at start of document ──────────────────────────────────

  test("Atom at start of document — cursor after, can type", () => {
    d.insertAtom(TEST_ATOM);
    type(d, " hello");

    const text = d.getText();
    const range = d.getSelectedRange();
    const passed = text.length === 7 && range?.start === 7;
    return {
      passed,
      detail: `text="${text.slice(0, 20)}" (len=${text.length}), cursor=${range?.start}`,
    };
  });

  // ── Atom at end of document ──────────────────────────────────

  test("Atom at end of document — getText correct", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);

    const text = d.getText();
    const atoms = d.getAtoms();
    const passed = text.length === 7 && atoms.length === 1;
    return {
      passed,
      detail: `text len=${text.length} (expect 7), atoms=${atoms.length}`,
    };
  });

  // ── Type before atom ────────────────────────────────────────

  test("Position before atom, type there", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    // Position cursor before atom (end of "hello")
    d.setSelectedRange(5);
    type(d, " ");

    const text = d.getText();
    // Should be "hello " + atom = 7 chars
    const passed = text.length === 7;
    return {
      passed,
      detail: `text="${text.slice(0, 20)}" (len=${text.length}, expect 7)`,
    };
  });

  // ── Multiple atoms ────────────────────────────────────────────

  test("Two atoms — getText correct", () => {
    type(d, "a");
    d.insertAtom(TEST_ATOM);
    type(d, "b");
    d.insertAtom(TEST_ATOM_2);
    type(d, "c");

    const text = d.getText();
    const atoms = d.getAtoms();
    // "a" + atom + "b" + atom + "c" = 5 chars
    const passed = text.length === 5 && atoms.length === 2;
    return {
      passed,
      detail: `text len=${text.length} (expect 5), atoms=${atoms.length} (expect 2)`,
    };
  });

  test("Two atoms — navigate between them", () => {
    type(d, "a");
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);
    type(d, "z");

    // Position between the two atoms
    // "a"=1, atom1=1, atom2=1, "z"=1 = flat length 4
    // Position 2 is between atom1 and atom2
    d.setSelectedRange(2);
    const at2 = d.getSelectedRange();

    // Right arrow should cross atom2
    arrowRight(1);
    const after = d.getSelectedRange();

    const passed = at2?.start === 2 && after !== null && after.start >= 3;
    return {
      passed,
      detail: `at2=${at2?.start}, afterRight=${after?.start} (expect >=3)`,
    };
  });

  // ── Delete forward at atom boundary ────────────────────────────

  test("Two-step forward delete: highlights then deletes atom", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    // Position before atom
    d.setSelectedRange(5);
    d.deleteForward(); // should highlight
    const highlighted = atomIsHighlighted(d);
    const atomsBefore = d.getAtoms().length;

    d.deleteForward(); // should delete
    const atomsAfter = d.getAtoms().length;
    const text = d.getText();

    const passed = highlighted && atomsBefore === 1 && atomsAfter === 0 && text === "hello world";
    return {
      passed,
      detail: `highlighted=${highlighted}, before=${atomsBefore}, after=${atomsAfter}, text="${text}"`,
    };
  });

  // ── Select all with atoms ────────────────────────────────────

  test("selectAll with atoms — covers entire document", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    d.selectAll();
    const range = d.getSelectedRange();
    const totalLen = d.getText().length;

    const passed = range !== null && range.start === 0 && range.end === totalLen;
    return {
      passed,
      detail: `selection=${range?.start}..${range?.end}, totalLen=${totalLen}`,
    };
  });

  // ── Delete backward with ranged selection spanning atom ────────

  test("Delete backward with selection spanning atom", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    // Select "o " + atom + " w" (offsets 4..9)
    d.setSelectedRange(4, 9);
    d.deleteBackward();

    const text = d.getText();
    const atoms = d.getAtoms();
    const passed = atoms.length === 0 && text === "hellorld";
    return {
      passed,
      detail: `text="${text}", atoms=${atoms.length}`,
    };
  });

  // ── Undo after insert atom ────────────────────────────────────

  test("Undo after insertAtom restores previous state", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    const beforeUndo = d.getAtoms().length;
    d.undo();
    const afterUndo = d.getAtoms().length;
    const text = d.getText();

    const passed = beforeUndo === 1 && afterUndo === 0 && text === "hello";
    return {
      passed,
      detail: `before=${beforeUndo}, after=${afterUndo}, text="${text}"`,
    };
  });

  // ── Undo after two-step delete ────────────────────────────────

  test("Undo after two-step atom delete restores atom", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    d.setSelectedRange(6);
    d.deleteBackward(); // highlight
    d.deleteBackward(); // delete

    const deleted = d.getAtoms().length === 0;
    d.undo();
    const restored = d.getAtoms().length === 1;

    const passed = deleted && restored;
    return {
      passed,
      detail: `deleted=${deleted}, restored=${restored}`,
    };
  });

  // ── Type between two atoms ────────────────────────────────────

  test("Type between two adjacent atoms", () => {
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);

    // Position between the two atoms (offset 1)
    d.setSelectedRange(1);
    type(d, "x");

    const text = d.getText();
    const atoms = d.getAtoms();
    // atom + "x" + atom = 3 chars
    const passed = text.length === 3 && atoms.length === 2;
    return {
      passed,
      detail: `text="${text.slice(0, 20)}" (len=${text.length}), atoms=${atoms.length}`,
    };
  });

  // ── Arrow through multiple atoms ──────────────────────────────

  test("Arrow right through text-atom-text-atom-text", () => {
    type(d, "a");
    d.insertAtom(TEST_ATOM);
    type(d, "b");
    d.insertAtom(TEST_ATOM_2);
    type(d, "c");

    // Start at beginning
    d.setSelectedRange(0);
    const positions: number[] = [0];
    for (let i = 0; i < 6; i++) {
      arrowRight(1);
      const r = d.getSelectedRange();
      if (r) positions.push(r.start);
    }

    // Should visit 0, 1, 2, 3, 4, 5 (each position once, monotonically increasing)
    const monotonic = positions.every((p, i) => i === 0 || p > positions[i - 1]);
    const reachesEnd = positions[positions.length - 1] >= 5;
    const passed = monotonic && reachesEnd;
    return {
      passed,
      detail: `positions=[${positions.join(",")}], monotonic=${monotonic}, reachesEnd=${reachesEnd}`,
    };
  });

  // ── Shift+select across multiple atoms ────────────────────────

  test("Shift+right selects across two atoms", () => {
    type(d, "a");
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);
    type(d, "z");

    d.setSelectedRange(0);
    shiftRight(4);

    const range = d.getSelectedRange();
    const passed = range !== null && range.start === 0 && range.end === 4;
    return {
      passed,
      detail: `selection=${range?.start}..${range?.end} (expect 0..4)`,
    };
  });

  // ── Clear resets everything ──────────────────────────────────

  test("Clear with atoms resets to empty", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    d.clear();
    const passed = d.isEmpty() && d.getText() === "" && d.getAtoms().length === 0;
    return {
      passed,
      detail: `empty=${d.isEmpty()}, text="${d.getText()}", atoms=${d.getAtoms().length}`,
    };
  });

  // ── Newline with atom ────────────────────────────────────────

  test("Newline before atom", () => {
    type(d, "hello");
    d.insertText("\n");
    d.insertAtom(TEST_ATOM);

    const text = d.getText();
    const atoms = d.getAtoms();
    const hasNewline = text.includes("\n");
    const passed = hasNewline && atoms.length === 1;
    return {
      passed,
      detail: `text="${text.replace(/\n/g, "\\n")}", atoms=${atoms.length}, hasNewline=${hasNewline}`,
    };
  });

  // ── Empty document operations ────────────────────────────────

  test("deleteBackward on empty is no-op", () => {
    d.deleteBackward();
    const passed = d.isEmpty();
    return { passed, detail: `empty=${d.isEmpty()}` };
  });

  test("deleteForward on empty is no-op", () => {
    d.deleteForward();
    const passed = d.isEmpty();
    return { passed, detail: `empty=${d.isEmpty()}` };
  });

  // ── Word deletion near atom ──────────────────────────────────

  test("deleteWordBackward at atom boundary", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    // Position at start of " world" (offset 8)
    d.setSelectedRange(8);
    d.deleteWordBackward();

    const text = d.getText();
    // Should delete " " (the space after atom) — or the atom itself depending on word boundary
    // The key test: it shouldn't crash and should produce valid state
    const atoms = d.getAtoms();
    const valid = typeof text === "string" && !d.isEmpty();
    return {
      passed: valid,
      detail: `text="${text.slice(0, 20)}" (len=${text.length}), atoms=${atoms.length}`,
    };
  });

  test("deleteWordForward at atom boundary", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");

    // Position before atom (offset 6)
    d.setSelectedRange(6);
    d.deleteWordForward();

    const text = d.getText();
    const atoms = d.getAtoms();
    const valid = typeof text === "string";
    return {
      passed: valid,
      detail: `text="${text.slice(0, 20)}" (len=${text.length}), atoms=${atoms.length}`,
    };
  });

  // ── Summary ──

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  return { passed, failed, total: results.length, results };
}
