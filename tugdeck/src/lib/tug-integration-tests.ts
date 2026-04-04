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

/**
 * Simulate IME composition on the engine-managed editor.
 *
 * Follows the real browser IME event sequence:
 *   1. compositionstart — engine sets composingIndex, reconciler pauses
 *   2. DOM mutation with intermediate text — MutationObserver updates model
 *   3. compositionupdate events for each intermediate step
 *   4. DOM mutation with final committed text
 *   5. compositionend — engine finalizes, pushes undo, clears composingIndex
 *
 * @param d - The delegate for the engine-managed editor
 * @param intermediates - Intermediate composition strings (e.g., ["n","ni","にh","にほ","にほん"])
 * @param committed - Final committed text (e.g., "日本")
 */
function simulateComposition(d: TugTextInputDelegate, intermediates: string[], committed: string): void {
  const el = d.getEditorElement();
  if (!el) return;
  el.focus();

  const sel = window.getSelection();
  if (!sel || !sel.anchorNode) return;

  // Find the text node and offset where composition starts
  let textNode: Text;
  let baseOffset: number;
  if (sel.anchorNode instanceof Text) {
    textNode = sel.anchorNode;
    baseOffset = sel.anchorOffset;
  } else {
    // Cursor is at root level — find or create a text node
    const child = el.childNodes[sel.anchorOffset];
    if (child instanceof Text) {
      textNode = child;
      baseOffset = 0;
    } else {
      return; // Can't compose at this position
    }
  }

  const textBefore = textNode.textContent?.slice(0, baseOffset) ?? "";
  const textAfter = textNode.textContent?.slice(baseOffset) ?? "";

  // 1. compositionstart
  el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  d.flushMutations();

  // 2-3. Intermediate steps: mutate DOM + compositionupdate
  let prevLen = 0;
  for (const step of intermediates) {
    textNode.textContent = textBefore + step + textAfter;
    sel.collapse(textNode, baseOffset + step.length);
    el.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: step }));
    d.flushMutations();
    prevLen = step.length;
  }

  // 4. Final committed text
  if (committed !== intermediates[intermediates.length - 1]) {
    textNode.textContent = textBefore + committed + textAfter;
    sel.collapse(textNode, baseOffset + committed.length);
    d.flushMutations();
  }

  // 5. compositionend
  el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: committed }));
  d.flushMutations();
}

/**
 * IME test scenario: a named composition sequence for a specific language.
 */
export interface IMEScenario {
  /** Language/input method name */
  name: string;
  /** Text to type before composition (setup) */
  prefix: string;
  /** Intermediate composition steps */
  intermediates: string[];
  /** Final committed text */
  committed: string;
  /** Expected full text content after composition */
  expectedText: string;
}

/**
 * Standard IME test scenarios covering CJK and other input methods.
 */
export const IME_SCENARIOS: IMEScenario[] = [
  // ── Japanese (Hiragana → Kanji) ────────────────────────────────
  {
    name: "Japanese: にほん → 日本",
    prefix: "hello ",
    intermediates: ["n", "ni", "にh", "にほ", "にほn", "にほん"],
    committed: "日本",
    expectedText: "hello 日本",
  },
  {
    name: "Japanese: とうきょう → 東京",
    prefix: "",
    intermediates: ["t", "to", "とu", "とう", "とうk", "とうky", "とうきょ", "とうきょu", "とうきょう"],
    committed: "東京",
    expectedText: "東京",
  },
  {
    name: "Japanese: Katakana コーヒー",
    prefix: "I like ",
    intermediates: ["k", "ko", "こー", "こーh", "こーひ", "こーひー"],
    committed: "コーヒー",
    expectedText: "I like コーヒー",
  },

  // ── Chinese Simplified (Pinyin) ─────────────────────────────────
  {
    name: "Chinese Simplified: nihao → 你好",
    prefix: "",
    intermediates: ["n", "ni", "nih", "niha", "nihao"],
    committed: "你好",
    expectedText: "你好",
  },
  {
    name: "Chinese Simplified: zhongguo → 中国",
    prefix: "I love ",
    intermediates: ["z", "zh", "zho", "zhon", "zhong", "zhongg", "zhonggu", "zhongguo"],
    committed: "中国",
    expectedText: "I love 中国",
  },

  // ── Chinese Traditional (Zhuyin/Bopomofo) ──────────────────────
  {
    name: "Chinese Traditional: ㄋㄧˇ ㄏㄠˇ → 你好",
    prefix: "",
    intermediates: ["ㄋ", "ㄋㄧ", "ㄋㄧˇ"],
    committed: "你好",
    expectedText: "你好",
  },

  // ── Korean (Hangul) ────────────────────────────────────────────
  {
    name: "Korean: ㅎㅏㄴㄱㅜㄱ → 한국",
    prefix: "",
    intermediates: ["ㅎ", "하", "한", "한ㄱ", "한구", "한국"],
    committed: "한국",
    expectedText: "한국",
  },
  {
    name: "Korean: ㅅㅓㅇㅜㄹ → 서울",
    prefix: "Visit ",
    intermediates: ["ㅅ", "서", "서ㅇ", "서우", "서울"],
    committed: "서울",
    expectedText: "Visit 서울",
  },

  // ── Vietnamese (Telex) ─────────────────────────────────────────
  {
    name: "Vietnamese: Việt Nam",
    prefix: "",
    intermediates: ["V", "Vi", "Vie", "Việ", "Việt"],
    committed: "Việt",
    expectedText: "Việt",
  },

  // ── Hindi (Devanagari) ─────────────────────────────────────────
  {
    name: "Hindi: namaste → नमस्ते",
    prefix: "",
    intermediates: ["न", "नम", "नमस", "नमस्", "नमस्ते"],
    committed: "नमस्ते",
    expectedText: "नमस्ते",
  },

  // ── Emoji (macOS Emoji picker acts as composition) ──────────────
  {
    name: "Emoji composition: 👋",
    prefix: "hello ",
    intermediates: [],
    committed: "👋",
    expectedText: "hello 👋",
  },
];

/**
 * Run IME composition tests against an engine-managed editor.
 * Returns structured results suitable for display.
 */
export function runIMETests(d: TugTextInputDelegate): {
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

  const emptyState = { segments: [{ kind: "text" as const, text: "" }], selection: { start: 0, end: 0 }, markedText: null, highlightedAtomIndices: [] as number[] };

  for (const scenario of IME_SCENARIOS) {
    d.restoreState(emptyState);
    el.focus();

    try {
      // Type prefix
      if (scenario.prefix) {
        type(d, scenario.prefix);
      }

      // Run composition
      simulateComposition(d, scenario.intermediates, scenario.committed);

      const text = d.getText();
      const cursor = d.getSelectedRange();
      const passed = text === scenario.expectedText;

      results.push({
        name: scenario.name,
        passed,
        detail: `text="${text}" (expect "${scenario.expectedText}"), cursor=${cursor?.start}`,
      });
    } catch (err) {
      results.push({
        name: scenario.name,
        passed: false,
        detail: `Error: ${err}`,
      });
    }
  }

  // ── IME + atom interaction tests ──────────────────────────────

  // Compose after atom
  {
    d.restoreState(emptyState);
    el.focus();
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    try {
      simulateComposition(d, ["n", "ni", "にh", "にほ", "にほん"], "日本");
      const text = d.getText();
      const atoms = d.getAtoms();
      results.push({
        name: "IME after atom: compose 日本",
        passed: atoms.length === 1 && text.includes("日本"),
        detail: `text="${text.slice(0, 30)}", atoms=${atoms.length}`,
      });
    } catch (err) {
      results.push({ name: "IME after atom: compose 日本", passed: false, detail: `Error: ${err}` });
    }
  }

  // Compose before atom
  {
    d.restoreState(emptyState);
    el.focus();
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(0);
    try {
      simulateComposition(d, ["ㅎ", "하", "한", "한ㄱ", "한구", "한국"], "한국");
      const text = d.getText();
      const atoms = d.getAtoms();
      results.push({
        name: "IME before atom: compose 한국",
        passed: atoms.length === 1 && text.includes("한국"),
        detail: `text="${text.slice(0, 30)}", atoms=${atoms.length}`,
      });
    } catch (err) {
      results.push({ name: "IME before atom: compose 한국", passed: false, detail: `Error: ${err}` });
    }
  }

  // Undo after IME composition
  {
    d.restoreState(emptyState);
    el.focus();
    type(d, "hello ");
    try {
      simulateComposition(d, ["n", "ni", "にh", "にほん"], "日本");
      const before = d.getText();
      d.undo();
      const after = d.getText();
      results.push({
        name: "Undo after IME composition",
        passed: before.includes("日本") && after === "hello ",
        detail: `before="${before}", after="${after}"`,
      });
    } catch (err) {
      results.push({ name: "Undo after IME composition", passed: false, detail: `Error: ${err}` });
    }
  }

  // Cancelled composition (compositionstart + compositionend with empty)
  {
    d.restoreState(emptyState);
    el.focus();
    type(d, "hello ");
    try {
      simulateComposition(d, ["ni"], "");
      const text = d.getText();
      results.push({
        name: "Cancelled IME composition",
        passed: text === "hello ",
        detail: `text="${text}" (expect "hello ")`,
      });
    } catch (err) {
      results.push({ name: "Cancelled IME composition", passed: false, detail: `Error: ${err}` });
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  return { passed, failed, total: results.length, results };
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

/** Word-level movement. */
function wordRight(n = 1): void {
  const sel = window.getSelection();
  if (!sel) return;
  for (let i = 0; i < n; i++) sel.modify("move", "right", "word");
}

function wordLeft(n = 1): void {
  const sel = window.getSelection();
  if (!sel) return;
  for (let i = 0; i < n; i++) sel.modify("move", "left", "word");
}

/** Get flat offset, null-safe. */
function cursorAt(d: TugTextInputDelegate): number | null {
  return d.getSelectedRange()?.start ?? null;
}

/** Get selection as string "start..end" or "start" if collapsed. */
function selStr(d: TugTextInputDelegate): string {
  const r = d.getSelectedRange();
  if (!r) return "null";
  return r.start === r.end ? `${r.start}` : `${r.start}..${r.end}`;
}

/** Build state: type text, insert atoms. Shorthand for common patterns. */
function buildTextAtomText(d: TugTextInputDelegate, before: string, after: string): void {
  if (before) type(d, before);
  d.insertAtom(TEST_ATOM);
  if (after) type(d, after);
}

function buildTwoAtoms(d: TugTextInputDelegate, a: string, b: string, c: string): void {
  if (a) type(d, a);
  d.insertAtom(TEST_ATOM);
  if (b) type(d, b);
  d.insertAtom(TEST_ATOM_2);
  if (c) type(d, c);
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

  // ===================================================================
  // TEXT ENTRY — from TEOI Text Entry matrix
  // ===================================================================

  // ── Typing into various states ──────────────────────────────────

  test("typing: into empty", () => {
    type(d, "a");
    return { passed: d.getText() === "a" && cursorAt(d) === 1, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  test("typing: at start of text", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    type(d, "x");
    return { passed: d.getText() === "xhello" && cursorAt(d) === 1, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  test("typing: at middle of text", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    type(d, "x");
    return { passed: d.getText() === "helxlo" && cursorAt(d) === 4, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  test("typing: at end of text", () => {
    type(d, "hello");
    type(d, "x");
    return { passed: d.getText() === "hellox" && cursorAt(d) === 6, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  test("typing: replaces partial selection", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    type(d, "x");
    return { passed: d.getText() === "hxo", detail: `text="${d.getText()}"` };
  });

  test("typing: replaces full selection", () => {
    type(d, "hello");
    d.selectAll();
    type(d, "x");
    return { passed: d.getText() === "x", detail: `text="${d.getText()}"` };
  });

  test("typing: after atom", () => {
    buildTextAtomText(d, "hello ", "");
    type(d, "x");
    const t = d.getText();
    return { passed: t.length === 8 && cursorAt(d) === 8, detail: `text len=${t.length}, cursor=${selStr(d)}` };
  });

  test("typing: between two atoms", () => {
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);
    d.setSelectedRange(1);
    type(d, "x");
    return { passed: d.getText().length === 3 && d.getAtoms().length === 2, detail: `len=${d.getText().length}, atoms=${d.getAtoms().length}` };
  });

  test("typing: multiline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    return { passed: d.getText() === "hello\nworld", detail: `text="${d.getText().replace(/\n/g, "\\n")}"` };
  });

  // ── insertText API ────────────────────────────────────────────

  test("insertText: into empty", () => {
    d.insertText("hello");
    return { passed: d.getText() === "hello" && cursorAt(d) === 5, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  test("insertText: replaces partial selection", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    d.insertText("x");
    return { passed: d.getText() === "hxo", detail: `text="${d.getText()}"` };
  });

  test("insertText: at atom boundary (before)", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(5);
    d.insertText("x");
    return { passed: d.getText().length === 7, detail: `len=${d.getText().length}` };
  });

  test("insertText: replaces selection spanning atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(4, 9);
    d.insertText("x");
    const t = d.getText();
    return { passed: t === "hellxorld" && d.getAtoms().length === 0, detail: `text="${t}", atoms=${d.getAtoms().length}` };
  });

  // ===================================================================
  // ATOM INSERTION — from TEOI Atom Manipulation matrix
  // ===================================================================

  test("insertAtom: into empty", () => {
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && cursorAt(d) === 1, detail: `atoms=${d.getAtoms().length}, cursor=${selStr(d)}` };
  });

  test("insertAtom: at start of text", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 6, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  test("insertAtom: at middle of text", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 6, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  test("insertAtom: at end of text", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 6, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  test("insertAtom: replaces partial selection", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 3, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  test("insertAtom: replaces full selection", () => {
    type(d, "hello");
    d.selectAll();
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 1, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  test("insertAtom: at atom boundary (before existing)", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(5);
    d.insertAtom(TEST_ATOM_2);
    return { passed: d.getAtoms().length === 2, detail: `atoms=${d.getAtoms().length}` };
  });

  test("insertAtom: after existing atom", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);
    return { passed: d.getAtoms().length === 2, detail: `atoms=${d.getAtoms().length}` };
  });

  test("insertAtom: cursor not inside atom after insert", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    return { passed: !cursorIsInsideAtom(d) && cursorAt(d) === 7, detail: `inside=${cursorIsInsideAtom(d)}, cursor=${selStr(d)}` };
  });

  // ===================================================================
  // DELETION: CHARACTER — from TEOI Deletion Character matrix
  // ===================================================================

  test("deleteBackward: empty (no-op)", () => {
    d.deleteBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteBackward: at start of text (no-op)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteBackward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("deleteBackward: mid text", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    d.deleteBackward();
    return { passed: d.getText() === "helo" && cursorAt(d) === 2, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  test("deleteBackward: at end of text", () => {
    type(d, "hello");
    d.deleteBackward();
    return { passed: d.getText() === "hell", detail: `text="${d.getText()}"` };
  });

  test("deleteBackward: with partial selection", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    d.deleteBackward();
    return { passed: d.getText() === "ho" && cursorAt(d) === 1, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  test("deleteBackward: with full selection", () => {
    type(d, "hello");
    d.selectAll();
    d.deleteBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteBackward: at atom boundary — two-step highlight", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(6);
    d.deleteBackward();
    return { passed: d.getAtoms().length === 1 && atomIsHighlighted(d), detail: `atoms=${d.getAtoms().length}, highlighted=${atomIsHighlighted(d)}` };
  });

  test("deleteBackward: two-step completes — atom deleted", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(6);
    d.deleteBackward();
    d.deleteBackward();
    return { passed: d.getAtoms().length === 0 && d.getText() === "hello", detail: `atoms=${d.getAtoms().length}, text="${d.getText()}"` };
  });

  test("deleteBackward: in trailing text after atom", () => {
    buildTextAtomText(d, "hello", " world");
    d.setSelectedRange(9);
    d.deleteBackward();
    return { passed: d.getText().length === 11, detail: `len=${d.getText().length}` };
  });

  test("deleteBackward: with selection spanning atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(4, 9);
    d.deleteBackward();
    return { passed: d.getAtoms().length === 0 && d.getText() === "hellorld", detail: `text="${d.getText()}", atoms=${d.getAtoms().length}` };
  });

  test("deleteBackward: between two atoms (two-step)", () => {
    buildTwoAtoms(d, "a", "", "z");
    d.setSelectedRange(2);
    d.deleteBackward();
    return { passed: atomIsHighlighted(d) && d.getAtoms().length === 2, detail: `highlighted=${atomIsHighlighted(d)}, atoms=${d.getAtoms().length}` };
  });

  test("deleteBackward: with selection spanning both atoms", () => {
    buildTwoAtoms(d, "a", "b", "z");
    d.selectAll();
    d.deleteBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteBackward: at newline boundary", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(6);
    d.deleteBackward();
    return { passed: d.getText() === "helloworld", detail: `text="${d.getText()}"` };
  });

  test("deleteForward: empty (no-op)", () => {
    d.deleteForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteForward: at start of text", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteForward();
    return { passed: d.getText() === "ello", detail: `text="${d.getText()}"` };
  });

  test("deleteForward: at end of text (no-op)", () => {
    type(d, "hello");
    d.deleteForward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("deleteForward: at atom boundary — two-step highlight", () => {
    buildTextAtomText(d, "hello", " world");
    d.setSelectedRange(5);
    d.deleteForward();
    return { passed: atomIsHighlighted(d) && d.getAtoms().length === 1, detail: `highlighted=${atomIsHighlighted(d)}` };
  });

  test("deleteForward: two-step completes — atom deleted", () => {
    buildTextAtomText(d, "hello", " world");
    d.setSelectedRange(5);
    d.deleteForward();
    d.deleteForward();
    return { passed: d.getAtoms().length === 0 && d.getText() === "hello world", detail: `text="${d.getText()}"` };
  });

  // ===================================================================
  // NAVIGATION — arrow keys via Selection.modify
  // ===================================================================

  test("arrow right: past single atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    arrowRight(1);
    const p = cursorAt(d);
    return { passed: p !== null && p >= 7, detail: `cursor=${p} (expect >=7)` };
  });

  test("arrow right: through text-atom-text-atom-text (monotonic)", () => {
    buildTwoAtoms(d, "a", "b", "c");
    d.setSelectedRange(0);
    const positions: number[] = [0];
    for (let i = 0; i < 6; i++) {
      arrowRight(1);
      const r = cursorAt(d);
      if (r !== null) positions.push(r);
    }
    const monotonic = positions.every((p, i) => i === 0 || p > positions[i - 1]);
    const reachesEnd = positions[positions.length - 1] >= 5;
    return { passed: monotonic && reachesEnd, detail: `positions=[${positions.join(",")}]` };
  });

  test("arrow left: before single atom", () => {
    buildTextAtomText(d, "hello ", "");
    // cursor at 7 (after atom)
    arrowLeft(1);
    const p1 = cursorAt(d);
    arrowLeft(1);
    const p2 = cursorAt(d);
    return { passed: p2 !== null && p2 < 7, detail: `left1=${p1}, left2=${p2}` };
  });

  test("arrow left: through text-atom-text-atom-text (monotonic decreasing)", () => {
    buildTwoAtoms(d, "a", "b", "c");
    d.setSelectedRange(5);
    const positions: number[] = [5];
    for (let i = 0; i < 6; i++) {
      arrowLeft(1);
      const r = cursorAt(d);
      if (r !== null) positions.push(r);
    }
    const monotonic = positions.every((p, i) => i === 0 || p < positions[i - 1]);
    const reachesStart = positions[positions.length - 1] === 0;
    return { passed: monotonic && reachesStart, detail: `positions=[${positions.join(",")}]` };
  });

  test("arrow right: between two adjacent atoms", () => {
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);
    type(d, "z");
    d.setSelectedRange(1);
    arrowRight(1);
    const p = cursorAt(d);
    return { passed: p !== null && p >= 2, detail: `cursor=${p} (expect >=2)` };
  });

  test("arrow: atom at start of document", () => {
    d.insertAtom(TEST_ATOM);
    type(d, " hello");
    d.setSelectedRange(0);
    arrowRight(1);
    const p = cursorAt(d);
    return { passed: p !== null && p >= 1, detail: `cursor=${p} (expect >=1)` };
  });

  test("arrow: atom at end of document", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(7);
    arrowLeft(1);
    const p = cursorAt(d);
    return { passed: p !== null && p <= 6, detail: `cursor=${p} (expect <=6)` };
  });

  // ===================================================================
  // SELECTION — shift+arrow via Selection.modify
  // ===================================================================

  test("shift+right: selects across single atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(5);
    shiftRight(2);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 5 && r.end >= 7, detail: `sel=${r?.start}..${r?.end}` };
  });

  test("shift+left: selects atom backward", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(8);
    shiftLeft(2);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start <= 7 && r.end === 8, detail: `sel=${r?.start}..${r?.end}` };
  });

  test("shift+right: selects across two atoms", () => {
    buildTwoAtoms(d, "a", "", "z");
    d.setSelectedRange(0);
    shiftRight(4);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0 && r.end >= 4, detail: `sel=${r?.start}..${r?.end}` };
  });

  test("shift+left: selects across two atoms backward", () => {
    buildTwoAtoms(d, "a", "", "z");
    d.setSelectedRange(4);
    shiftLeft(4);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0, detail: `sel=${r?.start}..${r?.end}` };
  });

  // ===================================================================
  // DELETION: WORD — from TEOI Deletion Word matrix
  // ===================================================================

  test("deleteWordBackward: empty (no-op)", () => {
    d.deleteWordBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteWordBackward: at start (no-op)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteWordBackward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("deleteWordBackward: mid word", () => {
    type(d, "hello world");
    d.setSelectedRange(8);
    d.deleteWordBackward();
    const t = d.getText();
    return { passed: t.length < 11, detail: `text="${t}"` };
  });

  test("deleteWordBackward: at space between words", () => {
    type(d, "hello world");
    d.setSelectedRange(5);
    d.deleteWordBackward();
    const t = d.getText();
    return { passed: t.length < 11, detail: `text="${t}"` };
  });

  test("deleteWordBackward: at atom boundary (after atom)", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(8);
    d.deleteWordBackward();
    return { passed: d.getText().length < 13, detail: `len=${d.getText().length}` };
  });

  test("deleteWordForward: empty (no-op)", () => {
    d.deleteWordForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteWordForward: at end (no-op)", () => {
    type(d, "hello");
    d.deleteWordForward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("deleteWordForward: mid word", () => {
    type(d, "hello world");
    d.setSelectedRange(2);
    d.deleteWordForward();
    return { passed: d.getText().length < 11, detail: `text="${d.getText()}"` };
  });

  test("deleteWordForward: at atom boundary (before atom)", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    d.deleteWordForward();
    return { passed: d.getText().length < 13, detail: `len=${d.getText().length}` };
  });

  // ── Word deletion: additional atom × state combinations ────────

  test("deleteWordBackward: after atom (atom is word boundary)", () => {
    buildTextAtomText(d, "hello", "");
    // cursor at 6 (after atom, in empty trailing text)
    d.deleteWordBackward();
    // Should delete the atom (it's its own word)
    return { passed: d.getText().length < 6, detail: `len=${d.getText().length}, text="${d.getText().slice(0, 20)}"` };
  });

  test("deleteWordBackward: between two atoms", () => {
    buildTwoAtoms(d, "a", "", "z");
    // cursor at 2 (between atoms, in empty text)
    d.setSelectedRange(2);
    d.deleteWordBackward();
    return { passed: d.getText().length < 4, detail: `len=${d.getText().length}, atoms=${d.getAtoms().length}` };
  });

  test("deleteWordForward: before atom (atom is word boundary)", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    type(d, " world");
    // cursor at 5 (just before atom)
    d.setSelectedRange(5);
    d.deleteWordForward();
    return { passed: d.getText().length < 12, detail: `len=${d.getText().length}, text="${d.getText().slice(0, 20)}"` };
  });

  test("deleteWordForward: between two atoms", () => {
    buildTwoAtoms(d, "a", "", "z");
    d.setSelectedRange(2);
    d.deleteWordForward();
    return { passed: d.getText().length < 4, detail: `len=${d.getText().length}, atoms=${d.getAtoms().length}` };
  });

  test("deleteWordBackward: at end of text (whole word)", () => {
    type(d, "hello world");
    d.deleteWordBackward();
    return { passed: d.getText() === "hello ", detail: `text="${d.getText()}"` };
  });

  test("deleteWordForward: at start of text (whole word)", () => {
    type(d, "hello world");
    d.setSelectedRange(0);
    d.deleteWordForward();
    return { passed: d.getText() === "world", detail: `text="${d.getText()}"` };
  });

  test("deleteWordBackward: multiline across newline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(6);
    d.deleteWordBackward();
    const t = d.getText();
    return { passed: t.length < 11, detail: `text="${t.replace(/\n/g, "\\n")}"` };
  });

  test("deleteWordForward: multiline across newline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(5);
    d.deleteWordForward();
    const t = d.getText();
    return { passed: t.length < 11, detail: `text="${t.replace(/\n/g, "\\n")}"` };
  });

  test("deleteWordBackward: with partial selection (selection overrides)", () => {
    type(d, "hello world");
    d.setSelectedRange(2, 8);
    d.deleteWordBackward();
    return { passed: d.getText() === "herld", detail: `text="${d.getText()}"` };
  });

  test("deleteWordForward: with partial selection (selection overrides)", () => {
    type(d, "hello world");
    d.setSelectedRange(2, 8);
    d.deleteWordForward();
    return { passed: d.getText() === "herld", detail: `text="${d.getText()}"` };
  });

  // ===================================================================
  // DELETION: PARAGRAPH — from TEOI Deletion Paragraph matrix
  // ===================================================================

  test("deleteParagraphBackward: mid text", () => {
    type(d, "hello world");
    d.setSelectedRange(7);
    d.deleteParagraphBackward();
    return { passed: d.getText() === "orld", detail: `text="${d.getText()}"` };
  });

  test("deleteParagraphForward: mid text", () => {
    type(d, "hello world");
    d.setSelectedRange(5);
    d.deleteParagraphForward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("deleteParagraphBackward: at atom boundary", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(8);
    d.deleteParagraphBackward();
    return { passed: d.getText().length < 13, detail: `len=${d.getText().length}` };
  });

  test("deleteParagraphForward: multiline at newline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(6);
    d.deleteParagraphForward();
    return { passed: d.getText() === "hello\n", detail: `text="${d.getText().replace(/\n/g, "\\n")}"` };
  });

  // ── Paragraph deletion: additional atom × state combinations ────

  test("deleteParagraphBackward: empty (no-op)", () => {
    d.deleteParagraphBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteParagraphForward: empty (no-op)", () => {
    d.deleteParagraphForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteParagraphBackward: at start (no-op)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteParagraphBackward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("deleteParagraphForward: at end (no-op)", () => {
    type(d, "hello");
    d.deleteParagraphForward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("deleteParagraphBackward: from end (deletes all)", () => {
    type(d, "hello");
    d.deleteParagraphBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}, text="${d.getText()}"` };
  });

  test("deleteParagraphForward: from start (deletes all)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteParagraphForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}, text="${d.getText()}"` };
  });

  test("deleteParagraphForward: at atom boundary (before atom)", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    d.deleteParagraphForward();
    // Should delete atom + " world"
    return { passed: d.getText() === "hello " && d.getAtoms().length === 0, detail: `text="${d.getText()}", atoms=${d.getAtoms().length}` };
  });

  test("deleteParagraphBackward: after atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(8);
    d.deleteParagraphBackward();
    // Should delete "hello " + atom + " " — everything before cursor
    return { passed: d.getText() === "world", detail: `text="${d.getText()}"` };
  });

  test("deleteParagraphBackward: between two atoms", () => {
    buildTwoAtoms(d, "a", "b", "z");
    d.setSelectedRange(3);
    d.deleteParagraphBackward();
    return { passed: d.getText().length < 5, detail: `text="${d.getText().slice(0, 20)}", len=${d.getText().length}` };
  });

  test("deleteParagraphForward: between two atoms", () => {
    buildTwoAtoms(d, "a", "b", "z");
    d.setSelectedRange(2);
    d.deleteParagraphForward();
    return { passed: d.getText().length < 5, detail: `text="${d.getText().slice(0, 20)}", len=${d.getText().length}` };
  });

  test("deleteParagraphBackward: multiline, second paragraph with atom", () => {
    type(d, "first");
    d.insertText("\n");
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");
    // cursor at end of second paragraph
    d.deleteParagraphBackward();
    return { passed: d.getText().startsWith("first\n"), detail: `text="${d.getText().replace(/\n/g, "\\n").slice(0, 30)}"` };
  });

  test("deleteParagraphForward: multiline, first paragraph with atom", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    d.insertText("\n");
    type(d, "second");
    d.setSelectedRange(0);
    d.deleteParagraphForward();
    // Should delete "hello " + atom — everything in first paragraph up to \n
    const t = d.getText();
    return { passed: t.startsWith("\n") || t === "second", detail: `text="${t.replace(/\n/g, "\\n").slice(0, 30)}"` };
  });

  // ===================================================================
  // KILL/YANK — from TEOI Kill Ring matrix
  // ===================================================================

  test("killLine: kills to end of paragraph", () => {
    type(d, "hello world");
    d.setSelectedRange(5);
    d.killLine();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("killLine then yank: restores killed text", () => {
    type(d, "hello world");
    d.setSelectedRange(5);
    d.killLine();
    d.yank();
    return { passed: d.getText() === "hello world", detail: `text="${d.getText()}"` };
  });

  test("killLine: at atom boundary", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    d.killLine();
    return { passed: d.getText().length <= 6, detail: `len=${d.getText().length}` };
  });

  // ===================================================================
  // TRANSPOSE — from TEOI Text Transforms matrix
  // ===================================================================

  test("transpose: mid text", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    d.transpose();
    return { passed: d.getText() === "helol" && cursorAt(d) === 4, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  test("transpose: at end of text", () => {
    type(d, "hello");
    d.transpose();
    return { passed: d.getText() === "helol", detail: `text="${d.getText()}"` };
  });

  // ===================================================================
  // OPEN LINE — from TEOI Structure matrix
  // ===================================================================

  test("openLine: mid text (cursor stays)", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    d.openLine();
    const t = d.getText();
    return { passed: t === "hel\nlo" && cursorAt(d) === 3, detail: `text="${t.replace(/\n/g, "\\n")}", cursor=${selStr(d)}` };
  });

  // ===================================================================
  // UNDO/REDO — from TEOI Selection/Undo matrix
  // ===================================================================

  test("undo: after typing", () => {
    type(d, "hello");
    type(d, " world");
    d.undo();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("undo then redo: roundtrip", () => {
    type(d, "hello");
    type(d, " world");
    d.undo();
    d.redo();
    return { passed: d.getText() === "hello world", detail: `text="${d.getText()}"` };
  });

  test("undo: after insertAtom", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.undo();
    return { passed: d.getAtoms().length === 0 && d.getText() === "hello", detail: `atoms=${d.getAtoms().length}, text="${d.getText()}"` };
  });

  test("undo: after two-step atom delete", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(6);
    d.deleteBackward();
    d.deleteBackward();
    d.undo();
    return { passed: d.getAtoms().length === 1, detail: `atoms=${d.getAtoms().length}` };
  });

  test("undo: on empty (no-op)", () => {
    d.undo();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("redo: on empty (no-op)", () => {
    d.redo();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  // ===================================================================
  // SELECT ALL / CLEAR / SET SELECTED RANGE
  // ===================================================================

  test("selectAll: text only", () => {
    type(d, "hello");
    d.selectAll();
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0 && r.end === 5, detail: `sel=${r?.start}..${r?.end}` };
  });

  test("selectAll: with atoms", () => {
    buildTextAtomText(d, "hello ", " world");
    d.selectAll();
    const r = d.getSelectedRange();
    const len = d.getText().length;
    return { passed: r !== null && r.start === 0 && r.end === len, detail: `sel=${r?.start}..${r?.end}, len=${len}` };
  });

  test("selectAll: multiline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.selectAll();
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0 && r.end === 11, detail: `sel=${r?.start}..${r?.end}` };
  });

  test("clear: text only", () => {
    type(d, "hello");
    d.clear();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("clear: with atoms", () => {
    buildTextAtomText(d, "hello ", " world");
    d.clear();
    return { passed: d.isEmpty() && d.getAtoms().length === 0, detail: `empty=${d.isEmpty()}, atoms=${d.getAtoms().length}` };
  });

  test("setSelectedRange: collapse to position", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    return { passed: cursorAt(d) === 3, detail: `cursor=${selStr(d)}` };
  });

  test("setSelectedRange: range", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 1 && r.end === 4, detail: `sel=${r?.start}..${r?.end}` };
  });

  test("setSelectedRange: at atom boundary", () => {
    buildTextAtomText(d, "hello ", "");
    d.setSelectedRange(6);
    return { passed: cursorAt(d) === 6 && !cursorIsInsideAtom(d), detail: `cursor=${selStr(d)}, inside=${cursorIsInsideAtom(d)}` };
  });

  // ===================================================================
  // RENDERING — atom visual integrity
  // ===================================================================

  test("atom: renders with icon and label", () => {
    buildTextAtomText(d, "hello ", "");
    const atom = el!.querySelector("[data-slot=tug-atom]");
    if (!atom) return { passed: false, detail: "No atom span" };
    const icon = atom.querySelector(".tug-atom-icon");
    const label = atom.querySelector(".tug-atom-label");
    return { passed: !!icon && label?.textContent === TEST_ATOM.label, detail: `icon=${!!icon}, label="${label?.textContent}"` };
  });

  test("atom: no stray visible characters in DOM", () => {
    buildTextAtomText(d, "hello ", " world");
    const atom = el!.querySelector("[data-slot=tug-atom]");
    if (!atom) return { passed: false, detail: "No atom span" };
    // Check that the atom's first child is NOT a visible text node with a glyph
    const firstChild = atom.firstChild;
    const isTextNode = firstChild instanceof Text;
    // If it's a text node, it should only contain characters that are invisible (not rendered as a glyph box)
    // This is architecture-dependent — current ce=false atoms have no leading text node
    const hasNoStrayText = !isTextNode || (firstChild as Text).textContent === "";
    return { passed: hasNoStrayText, detail: `firstChild=${firstChild?.nodeName}, text=${isTextNode ? JSON.stringify((firstChild as Text).textContent) : "n/a"}` };
  });

  // ===================================================================
  // FULL SELECTION × OPERATIONS — text-selection-all state
  // ===================================================================

  test("insertAtom: replaces full selection with atom", () => {
    type(d, "hello world");
    d.selectAll();
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 1, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  test("deleteForward: with full selection clears all", () => {
    type(d, "hello");
    d.selectAll();
    d.deleteForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteWordBackward: with full selection clears all", () => {
    type(d, "hello world");
    d.selectAll();
    d.deleteWordBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteWordForward: with full selection clears all", () => {
    type(d, "hello world");
    d.selectAll();
    d.deleteWordForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteParagraphBackward: with full selection clears all", () => {
    type(d, "hello world");
    d.selectAll();
    d.deleteParagraphBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("deleteParagraphForward: with full selection clears all", () => {
    type(d, "hello world");
    d.selectAll();
    d.deleteParagraphForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("typing: replaces selection spanning atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(4, 9);
    type(d, "x");
    return { passed: d.getAtoms().length === 0 && d.getText().length === 6, detail: `text="${d.getText()}", atoms=${d.getAtoms().length}` };
  });

  test("selectAll: with two atoms", () => {
    buildTwoAtoms(d, "a", "b", "c");
    d.selectAll();
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0 && r.end === 5, detail: `sel=${r?.start}..${r?.end}` };
  });

  test("deleteBackward: full selection with atoms clears all", () => {
    buildTwoAtoms(d, "hello ", " ", " world");
    d.selectAll();
    d.deleteBackward();
    return { passed: d.isEmpty() && d.getAtoms().length === 0, detail: `empty=${d.isEmpty()}, atoms=${d.getAtoms().length}` };
  });

  // ===================================================================
  // MULTIWORD × WORD DELETION — comprehensive word boundary tests
  // ===================================================================

  test("deleteWordBackward: three words, cursor at end of second", () => {
    type(d, "one two three");
    d.setSelectedRange(7);
    d.deleteWordBackward();
    const t = d.getText();
    return { passed: t === "one three", detail: `text="${t}"` };
  });

  test("deleteWordForward: three words, cursor at start of second", () => {
    type(d, "one two three");
    d.setSelectedRange(4);
    d.deleteWordForward();
    const t = d.getText();
    return { passed: t === "one three", detail: `text="${t}"` };
  });

  test("deleteWordBackward: word + atom + word, cursor in trailing word", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(13);
    d.deleteWordBackward();
    // Should delete "world" (the trailing word)
    const t = d.getText();
    return { passed: t.length < 13, detail: `text="${t.slice(0, 20)}", len=${t.length}` };
  });

  test("deleteWordForward: word + atom + word, cursor in leading word", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(0);
    d.deleteWordForward();
    // Should delete "hello " or "hello" (the leading word + trailing space)
    const t = d.getText();
    return { passed: t.length < 13, detail: `text="${t.slice(0, 20)}", len=${t.length}` };
  });

  // ===================================================================
  // KILL/YANK × ATOM STATES — additional combinations
  // ===================================================================

  test("killLine: empty (no-op)", () => {
    d.killLine();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  test("killLine: at end (no-op)", () => {
    type(d, "hello");
    d.killLine();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("killLine: at start (kills entire line)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.killLine();
    return { passed: d.isEmpty(), detail: `text="${d.getText()}"` };
  });

  test("killLine: multiline, kills to newline only", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(0);
    d.killLine();
    return { passed: d.getText() === "\nworld", detail: `text="${d.getText().replace(/\n/g, "\\n")}"` };
  });

  test("killLine then yank: at atom boundary", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    d.killLine();
    // Killed " world" including atom
    const afterKill = d.getText();
    d.yank();
    const afterYank = d.getText();
    return { passed: afterKill.length < 13 && afterYank.length > afterKill.length, detail: `afterKill="${afterKill.slice(0, 20)}", afterYank="${afterYank.slice(0, 20)}"` };
  });

  // ===================================================================
  // TRANSPOSE × ATOM STATES — additional combinations
  // ===================================================================

  test("transpose: at start (no-op or limited)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.transpose();
    // At position 0, there's nothing before to transpose
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  test("transpose: at position 1", () => {
    type(d, "hello");
    d.setSelectedRange(1);
    d.transpose();
    return { passed: d.getText() === "ehllo", detail: `text="${d.getText()}"` };
  });

  test("transpose: near atom boundary (should not transpose atom)", () => {
    buildTextAtomText(d, "hello", " world");
    d.setSelectedRange(5);
    d.transpose();
    // Transpose at atom boundary — engine skips atoms
    const atoms = d.getAtoms();
    return { passed: atoms.length === 1, detail: `text="${d.getText().slice(0, 20)}", atoms=${atoms.length}` };
  });

  // ===================================================================
  // OPEN LINE × STATES
  // ===================================================================

  test("openLine: at start of text", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.openLine();
    return { passed: d.getText() === "\nhello" && cursorAt(d) === 0, detail: `text="${d.getText().replace(/\n/g, "\\n")}", cursor=${selStr(d)}` };
  });

  test("openLine: at end of text", () => {
    type(d, "hello");
    d.openLine();
    return { passed: d.getText() === "hello\n" && cursorAt(d) === 5, detail: `text="${d.getText().replace(/\n/g, "\\n")}", cursor=${selStr(d)}` };
  });

  test("openLine: with atom", () => {
    buildTextAtomText(d, "hello", " world");
    d.setSelectedRange(5);
    d.openLine();
    const t = d.getText();
    return { passed: t.includes("\n") && d.getAtoms().length === 1, detail: `text="${t.replace(/\n/g, "\\n").slice(0, 30)}", atoms=${d.getAtoms().length}` };
  });

  // ===================================================================
  // ORIGINAL BUG REPORTS — B01, B04, B05, B06
  // Exact reproduction steps from user testing.
  // ===================================================================

  test("B01: delete key after typing space after atom", () => {
    // Type "hello", space, insert atom, space
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " ");

    // Cursor is now at offset 8 (after the trailing space)
    // Move cursor back one (to offset 7, between atom and trailing space)
    d.setSelectedRange(7);

    // Delete forward should delete the space after the atom
    d.deleteForward();
    const text = d.getText();
    // "hello " + atom = 7 chars (trailing space deleted)
    const passed = text.length === 7;
    return { passed, detail: `text len=${text.length} (expect 7), text="${text.slice(0, 20)}"` };
  });

  test("B04: left arrow after insert atom overshoots", () => {
    // Type "hello", insert atom, left arrow
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    // Cursor should be at 6 (after atom). "hello"=5 + atom=1 = 6
    const before = cursorAt(d);

    // Left arrow — should go to 5 (between "hello" and atom), not to 4 (before 'o')
    arrowLeft(1);
    const after = cursorAt(d);

    // The cursor should be at 5 (just before the atom, at end of "hello")
    const passed = before === 6 && after === 5;
    return { passed, detail: `before=${before} (expect 6), after=${after} (expect 5)` };
  });

  test("B05: shift+right from before atom should select atom, not text", () => {
    // Type "hello", insert atom
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    // Place cursor between "hello" and atom (offset 5)
    d.setSelectedRange(5);

    // Shift+right should select the atom (extend to 6), not select "hello"
    shiftRight(1);
    const range = d.getSelectedRange();

    // Selection should be 5..6 (just the atom), NOT 0..5 or anything backward
    const passed = range !== null && range.start === 5 && range.end === 6;
    return { passed, detail: `sel=${range?.start}..${range?.end} (expect 5..6)` };
  });

  test("B02: first return key swallowed, second works", () => {
    // Select "Return = newline" mode, type "hello", press Return twice
    // The first Return should insert a newline. If it doesn't, that's the bug.
    type(d, "hello");

    // Simulate Return key — the engine handles Enter via keydown → insertText("\n")
    // We call insertText directly since we can't dispatch trusted keydown events
    d.insertText("\n");
    const afterFirst = d.getText();

    d.insertText("\n");
    const afterSecond = d.getText();

    // Both should have inserted newlines
    const firstWorked = afterFirst === "hello\n";
    const secondWorked = afterSecond === "hello\n\n";
    const passed = firstWorked && secondWorked;
    return {
      passed,
      detail: `afterFirst="${afterFirst.replace(/\n/g, "\\n")}" (expect "hello\\n"), afterSecond="${afterSecond.replace(/\n/g, "\\n")}" (expect "hello\\n\\n")`,
    };
  });

  test("B06: click atom should highlight it and hide caret", () => {
    // Type "hello", insert atom
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    // Simulate clicking the atom
    const atomSpan = el!.querySelector("[data-slot=tug-atom]");
    if (!atomSpan) return { passed: false, detail: "No atom span found" };

    // Dispatch a click event on the atom span — the engine's onClick handler will catch it
    atomSpan.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const highlighted = atomIsHighlighted(d);

    // The cursor should NOT be blinking inside/adjacent to the atom.
    // After clicking an atom, the selection should either:
    // (a) be collapsed to a position outside the atom, or
    // (b) the atom should be the "selection" (highlighted state) with no visible caret
    // Check: is the cursor inside the atom span?
    const caretInAtom = cursorIsInsideAtom(d);

    // The atom should be highlighted AND the caret should not be visually inside the atom
    const passed = highlighted && !caretInAtom;
    return {
      passed,
      detail: `highlighted=${highlighted}, caretInAtom=${caretInAtom} (expect false)`,
    };
  });

  // ── Summary ──

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  return { passed, failed, total: results.length, results };
}
