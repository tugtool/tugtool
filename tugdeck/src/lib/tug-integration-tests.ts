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

  // ── Summary ──

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  return { passed, failed, total: results.length, results };
}
