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

// ===================================================================
// Trusted key event simulation via WKWebView bridge
//
// Sends real NSEvent key events through the macOS event system.
// The browser processes these as trusted events with full default actions.
// Dev-mode only — the Swift handler rejects calls when dev mode is off.
// ===================================================================

/** macOS virtual key codes for common keys. */
export const KeyCode = {
  Return: 36,
  Tab: 48,
  Space: 49,
  Delete: 51,          // Backspace
  Escape: 53,
  ForwardDelete: 117,
  LeftArrow: 123,
  RightArrow: 124,
  DownArrow: 125,
  UpArrow: 126,
  // Letters (for Ctrl+key combinations)
  A: 0, B: 11, D: 2, E: 14, F: 3, H: 4, K: 40, N: 45, O: 31, P: 35, T: 17, Y: 16, Z: 6,
} as const;

type ModifierKey = "shift" | "control" | "option" | "command";

interface SimulateKeyOptions {
  keyCode: number;
  characters?: string;
  unmodified?: string;
  modifiers?: ModifierKey[];
}

/**
 * Send a trusted key event through the WKWebView bridge.
 * Returns a Promise that resolves after a frame, giving the browser time to process.
 * Requires dev mode — returns false if the bridge is unavailable.
 */
export function simulateKey(opts: SimulateKeyOptions): Promise<boolean> {
  const handler = (window as unknown as Record<string, unknown>).webkit as
    { messageHandlers?: { simulateKey?: { postMessage: (msg: unknown) => void } } } | undefined;

  if (!handler?.messageHandlers?.simulateKey) {
    return Promise.resolve(false);
  }

  handler.messageHandlers.simulateKey.postMessage({
    keyCode: opts.keyCode,
    characters: opts.characters ?? "",
    unmodified: opts.unmodified ?? opts.characters ?? "",
    modifiers: opts.modifiers ?? [],
  });

  // Wait one frame for the event to be processed
  return new Promise(resolve => requestAnimationFrame(() => resolve(true)));
}

/** Convenience: simulate pressing a key and wait for processing. */
export async function pressKey(keyCode: number, modifiers?: ModifierKey[], characters?: string): Promise<boolean> {
  return simulateKey({ keyCode, characters, modifiers });
}

/** Convenience: simulate pressing Return. */
export async function pressReturn(modifiers?: ModifierKey[]): Promise<boolean> {
  return pressKey(KeyCode.Return, modifiers, "\r");
}

/** Convenience: simulate pressing Delete (Backspace). */
export async function pressDelete(modifiers?: ModifierKey[]): Promise<boolean> {
  return pressKey(KeyCode.Delete, modifiers, "\u{7F}");
}

/** Convenience: simulate pressing Forward Delete. */
export async function pressForwardDelete(modifiers?: ModifierKey[]): Promise<boolean> {
  return pressKey(KeyCode.ForwardDelete, modifiers, "\uF728");
}

/** Convenience: simulate pressing an arrow key. */
export async function pressArrow(direction: "left" | "right" | "up" | "down", modifiers?: ModifierKey[]): Promise<boolean> {
  const codes = { left: KeyCode.LeftArrow, right: KeyCode.RightArrow, up: KeyCode.UpArrow, down: KeyCode.DownArrow };
  // Arrow keys use NSEvent function key Unicode values, passed via characters
  // These are the standard NSEvent characters for arrow keys
  const chars = { left: "\uF702", right: "\uF703", up: "\uF700", down: "\uF701" };
  return pressKey(codes[direction], modifiers, chars[direction]);
}

/** Convenience: simulate typing a single character via trusted key event. */
export async function pressChar(char: string): Promise<boolean> {
  // For regular characters, we need the virtual key code.
  // This is approximate — for test purposes, the character matters more than the keyCode.
  // WebKit uses the characters field, not keyCode, for text insertion.
  return pressKey(0, undefined, char);
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
  let textNode: Text = null!;
  let baseOffset: number = 0;
  if (sel.anchorNode instanceof Text) {
    textNode = sel.anchorNode;
    baseOffset = sel.anchorOffset;
  } else {
    // Cursor is at root level (e.g., root-relative position from domPosition).
    // Find the nearest composable text node at or before the anchor offset.
    // Skip U+FFFC text nodes (atom navigable characters — not valid for composition).
    let found = false;
    const offset = sel.anchorOffset;
    for (let ci = Math.min(offset, el.childNodes.length - 1); ci >= 0; ci--) {
      const child = el.childNodes[ci];
      if (child instanceof Text && child.textContent !== "\uFFFC") {
        textNode = child;
        baseOffset = ci < offset ? (textNode.textContent?.length ?? 0) : 0;
        found = true;
        break;
      }
    }
    if (!found) return; // Can't compose at this position
  }

  // Strip ZWSP cursor anchors before composing — they're DOM-only rendering aids.
  if (textNode.textContent?.includes("\u200B")) {
    textNode.textContent = textNode.textContent.replace(/\u200B/g, "");
    baseOffset = Math.min(baseOffset, textNode.textContent.length);
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

/** Small delay for trusted key event processing. */
const KEY_DELAY = 5;

/** Move cursor via trusted arrow key events — real keyboard behavior. */
async function arrowLeft(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await pressArrow("left");
    await new Promise(r => setTimeout(r, KEY_DELAY));
  }
}

async function arrowRight(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await pressArrow("right");
    await new Promise(r => setTimeout(r, KEY_DELAY));
  }
}

async function shiftRight(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await pressArrow("right", ["shift"]);
    await new Promise(r => setTimeout(r, KEY_DELAY));
  }
}

async function shiftLeft(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await pressArrow("left", ["shift"]);
    await new Promise(r => setTimeout(r, KEY_DELAY));
  }
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
export async function runIntegrationTests(d: TugTextInputDelegate): Promise<{
  passed: number;
  failed: number;
  total: number;
  results: IntegrationTestResult[];
}> {
  const results: IntegrationTestResult[] = [];
  const el = d.getEditorElement();
  if (!el) {
    return { passed: 0, failed: 0, total: 0, results: [{ name: "setup", passed: false, detail: "No editor element" }] };
  }

  const emptyState = { segments: [{ kind: "text" as const, text: "" }], selection: { start: 0, end: 0 }, markedText: null, highlightedAtomIndices: [] as number[] };

  async function test(name: string, fn: () => Promise<{ passed: boolean; detail: string }> | { passed: boolean; detail: string }) {
    d.restoreState(emptyState);
    el!.focus();
    try {
      const r = await fn();
      results.push({ name, ...r });
    } catch (err) {
      results.push({ name, passed: false, detail: `Error: ${err}` });
    }
  }

  // ===================================================================
  // TEXT ENTRY — from TEOI Text Entry matrix
  // ===================================================================

  // ── Typing into various states ──────────────────────────────────

  await test("typing: into empty", () => {
    type(d, "a");
    return { passed: d.getText() === "a" && cursorAt(d) === 1, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  await test("typing: at start of text", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    type(d, "x");
    return { passed: d.getText() === "xhello" && cursorAt(d) === 1, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  await test("typing: at middle of text", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    type(d, "x");
    return { passed: d.getText() === "helxlo" && cursorAt(d) === 4, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  await test("typing: at end of text", () => {
    type(d, "hello");
    type(d, "x");
    return { passed: d.getText() === "hellox" && cursorAt(d) === 6, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  await test("typing: replaces partial selection", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    type(d, "x");
    return { passed: d.getText() === "hxo", detail: `text="${d.getText()}"` };
  });

  await test("typing: replaces full selection", () => {
    type(d, "hello");
    d.selectAll();
    type(d, "x");
    return { passed: d.getText() === "x", detail: `text="${d.getText()}"` };
  });

  await test("typing: after atom", () => {
    buildTextAtomText(d, "hello ", "");
    type(d, "x");
    const t = d.getText();
    return { passed: t.length === 8 && cursorAt(d) === 8, detail: `text len=${t.length}, cursor=${selStr(d)}` };
  });

  await test("typing: between two atoms", () => {
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);
    d.setSelectedRange(1);
    type(d, "x");
    return { passed: d.getText().length === 3 && d.getAtoms().length === 2, detail: `len=${d.getText().length}, atoms=${d.getAtoms().length}` };
  });

  await test("typing: multiline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    return { passed: d.getText() === "hello\nworld", detail: `text="${d.getText().replace(/\n/g, "\\n")}"` };
  });

  // ── insertText API ────────────────────────────────────────────

  await test("insertText: into empty", () => {
    d.insertText("hello");
    return { passed: d.getText() === "hello" && cursorAt(d) === 5, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  await test("insertText: replaces partial selection", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    d.insertText("x");
    return { passed: d.getText() === "hxo", detail: `text="${d.getText()}"` };
  });

  await test("insertText: at atom boundary (before)", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(5);
    d.insertText("x");
    return { passed: d.getText().length === 7, detail: `len=${d.getText().length}` };
  });

  await test("insertText: replaces selection spanning atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(4, 9);
    d.insertText("x");
    const t = d.getText();
    return { passed: t === "hellxorld" && d.getAtoms().length === 0, detail: `text="${t}", atoms=${d.getAtoms().length}` };
  });

  // ===================================================================
  // ATOM INSERTION — from TEOI Atom Manipulation matrix
  // ===================================================================

  await test("insertAtom: into empty", () => {
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && cursorAt(d) === 1, detail: `atoms=${d.getAtoms().length}, cursor=${selStr(d)}` };
  });

  await test("insertAtom: at start of text", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 6, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  await test("insertAtom: at middle of text", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 6, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  await test("insertAtom: at end of text", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 6, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  await test("insertAtom: replaces partial selection", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 3, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  await test("insertAtom: replaces full selection", () => {
    type(d, "hello");
    d.selectAll();
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 1, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  await test("insertAtom: at atom boundary (before existing)", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(5);
    d.insertAtom(TEST_ATOM_2);
    return { passed: d.getAtoms().length === 2, detail: `atoms=${d.getAtoms().length}` };
  });

  await test("insertAtom: after existing atom", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);
    return { passed: d.getAtoms().length === 2, detail: `atoms=${d.getAtoms().length}` };
  });

  await test("insertAtom: cursor not inside atom after insert", () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    return { passed: !cursorIsInsideAtom(d) && cursorAt(d) === 7, detail: `inside=${cursorIsInsideAtom(d)}, cursor=${selStr(d)}` };
  });

  // ===================================================================
  // DELETION: CHARACTER — from TEOI Deletion Character matrix
  // ===================================================================

  await test("deleteBackward: empty (no-op)", () => {
    d.deleteBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteBackward: at start of text (no-op)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteBackward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("deleteBackward: mid text", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    d.deleteBackward();
    return { passed: d.getText() === "helo" && cursorAt(d) === 2, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  await test("deleteBackward: at end of text", () => {
    type(d, "hello");
    d.deleteBackward();
    return { passed: d.getText() === "hell", detail: `text="${d.getText()}"` };
  });

  await test("deleteBackward: with partial selection", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    d.deleteBackward();
    return { passed: d.getText() === "ho" && cursorAt(d) === 1, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  await test("deleteBackward: with full selection", () => {
    type(d, "hello");
    d.selectAll();
    d.deleteBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteBackward: at atom boundary — two-step highlight", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(6);
    d.deleteBackward();
    return { passed: d.getAtoms().length === 1 && atomIsHighlighted(d), detail: `atoms=${d.getAtoms().length}, highlighted=${atomIsHighlighted(d)}` };
  });

  await test("deleteBackward: two-step completes — atom deleted", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(6);
    d.deleteBackward();
    d.deleteBackward();
    return { passed: d.getAtoms().length === 0 && d.getText() === "hello", detail: `atoms=${d.getAtoms().length}, text="${d.getText()}"` };
  });

  await test("deleteBackward: in trailing text after atom", () => {
    buildTextAtomText(d, "hello", " world");
    d.setSelectedRange(9);
    d.deleteBackward();
    return { passed: d.getText().length === 11, detail: `len=${d.getText().length}` };
  });

  await test("deleteBackward: with selection spanning atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(4, 9);
    d.deleteBackward();
    return { passed: d.getAtoms().length === 0 && d.getText() === "hellorld", detail: `text="${d.getText()}", atoms=${d.getAtoms().length}` };
  });

  await test("deleteBackward: between two atoms (two-step)", () => {
    buildTwoAtoms(d, "a", "", "z");
    d.setSelectedRange(2);
    d.deleteBackward();
    return { passed: atomIsHighlighted(d) && d.getAtoms().length === 2, detail: `highlighted=${atomIsHighlighted(d)}, atoms=${d.getAtoms().length}` };
  });

  await test("deleteBackward: with selection spanning both atoms", () => {
    buildTwoAtoms(d, "a", "b", "z");
    d.selectAll();
    d.deleteBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteBackward: at newline boundary", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(6);
    d.deleteBackward();
    return { passed: d.getText() === "helloworld", detail: `text="${d.getText()}"` };
  });

  await test("deleteForward: empty (no-op)", () => {
    d.deleteForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteForward: at start of text", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteForward();
    return { passed: d.getText() === "ello", detail: `text="${d.getText()}"` };
  });

  await test("deleteForward: at end of text (no-op)", () => {
    type(d, "hello");
    d.deleteForward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("deleteForward: at atom boundary — two-step highlight", () => {
    buildTextAtomText(d, "hello", " world");
    d.setSelectedRange(5);
    d.deleteForward();
    return { passed: atomIsHighlighted(d) && d.getAtoms().length === 1, detail: `highlighted=${atomIsHighlighted(d)}` };
  });

  await test("deleteForward: two-step completes — atom deleted", () => {
    buildTextAtomText(d, "hello", " world");
    d.setSelectedRange(5);
    d.deleteForward();
    d.deleteForward();
    return { passed: d.getAtoms().length === 0 && d.getText() === "hello world", detail: `text="${d.getText()}"` };
  });

  // ===================================================================
  // NAVIGATION — arrow keys via Selection.modify
  // ===================================================================

  await test("arrow right: past single atom", async () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    await arrowRight(1);
    const p = cursorAt(d);
    return { passed: p !== null && p >= 7, detail: `cursor=${p} (expect >=7)` };
  });

  await test("arrow right: through text-atom-text-atom-text (monotonic)", async () => {
    buildTwoAtoms(d, "a", "b", "c");
    d.setSelectedRange(0);
    const positions: number[] = [0];
    for (let i = 0; i < 6; i++) {
      await arrowRight(1);
      const r = cursorAt(d);
      if (r !== null) positions.push(r);
    }
    // Monotonic non-decreasing, strictly increasing until reaching the end
    const monotonic = positions.every((p, i) => i === 0 || p >= positions[i - 1]);
    const reachesEnd = positions[positions.length - 1] >= 5;
    const strictlyIncreasingUntilEnd = positions.slice(0, -1).every((p, i) => i === 0 || p > positions[i - 1]);
    return { passed: monotonic && reachesEnd && strictlyIncreasingUntilEnd, detail: `positions=[${positions.join(",")}]` };
  });

  await test("arrow left: before single atom", async () => {
    buildTextAtomText(d, "hello ", "");
    // cursor at 7 (after atom)
    await arrowLeft(1);
    const p1 = cursorAt(d);
    await arrowLeft(1);
    const p2 = cursorAt(d);
    return { passed: p2 !== null && p2 < 7, detail: `left1=${p1}, left2=${p2}` };
  });

  await test("arrow left: through text-atom-text-atom-text (monotonic decreasing)", async () => {
    buildTwoAtoms(d, "a", "b", "c");
    d.setSelectedRange(5);
    const positions: number[] = [5];
    for (let i = 0; i < 6; i++) {
      await arrowLeft(1);
      const r = cursorAt(d);
      if (r !== null) positions.push(r);
    }
    // Monotonic non-increasing, strictly decreasing until reaching start
    const monotonic = positions.every((p, i) => i === 0 || p <= positions[i - 1]);
    const reachesStart = positions[positions.length - 1] === 0;
    const strictlyDecreasingUntilStart = positions.slice(0, -1).every((p, i) => i === 0 || p < positions[i - 1]);
    return { passed: monotonic && reachesStart && strictlyDecreasingUntilStart, detail: `positions=[${positions.join(",")}]` };
  });

  await test("arrow right: between two adjacent atoms", async () => {
    d.insertAtom(TEST_ATOM);
    d.insertAtom(TEST_ATOM_2);
    type(d, "z");
    d.setSelectedRange(1);
    await arrowRight(1);
    const p = cursorAt(d);
    return { passed: p !== null && p >= 2, detail: `cursor=${p} (expect >=2)` };
  });

  await test("arrow: atom at start of document", async () => {
    d.insertAtom(TEST_ATOM);
    type(d, " hello");
    d.setSelectedRange(0);
    await arrowRight(1);
    const p = cursorAt(d);
    return { passed: p !== null && p >= 1, detail: `cursor=${p} (expect >=1)` };
  });

  await test("arrow: atom at end of document", async () => {
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(7);
    await arrowLeft(1);
    const p = cursorAt(d);
    return { passed: p !== null && p <= 6, detail: `cursor=${p} (expect <=6)` };
  });

  // ===================================================================
  // SELECTION — shift+arrow via Selection.modify
  // ===================================================================

  await test("shift+right: selects across single atom", async () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(5);
    await shiftRight(2);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 5 && r.end >= 7, detail: `sel=${r?.start}..${r?.end}` };
  });

  await test("shift+left: selects atom backward", async () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(8);
    await shiftLeft(2);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start <= 7 && r.end === 8, detail: `sel=${r?.start}..${r?.end}` };
  });

  await test("shift+right: selects across two atoms", async () => {
    buildTwoAtoms(d, "a", "", "z");
    d.setSelectedRange(0);
    await shiftRight(4);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0 && r.end >= 4, detail: `sel=${r?.start}..${r?.end}` };
  });

  await test("shift+left: selects across two atoms backward", async () => {
    buildTwoAtoms(d, "a", "", "z");
    d.setSelectedRange(4);
    await shiftLeft(4);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0, detail: `sel=${r?.start}..${r?.end}` };
  });

  // ===================================================================
  // DELETION: WORD — from TEOI Deletion Word matrix
  // ===================================================================

  await test("deleteWordBackward: empty (no-op)", () => {
    d.deleteWordBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteWordBackward: at start (no-op)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteWordBackward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("deleteWordBackward: mid word", () => {
    type(d, "hello world");
    d.setSelectedRange(8);
    d.deleteWordBackward();
    const t = d.getText();
    return { passed: t.length < 11, detail: `text="${t}"` };
  });

  await test("deleteWordBackward: at space between words", () => {
    type(d, "hello world");
    d.setSelectedRange(5);
    d.deleteWordBackward();
    const t = d.getText();
    return { passed: t.length < 11, detail: `text="${t}"` };
  });

  await test("deleteWordBackward: at atom boundary (after atom)", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(8);
    d.deleteWordBackward();
    return { passed: d.getText().length < 13, detail: `len=${d.getText().length}` };
  });

  await test("deleteWordForward: empty (no-op)", () => {
    d.deleteWordForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteWordForward: at end (no-op)", () => {
    type(d, "hello");
    d.deleteWordForward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("deleteWordForward: mid word", () => {
    type(d, "hello world");
    d.setSelectedRange(2);
    d.deleteWordForward();
    return { passed: d.getText().length < 11, detail: `text="${d.getText()}"` };
  });

  await test("deleteWordForward: at atom boundary (before atom)", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    d.deleteWordForward();
    return { passed: d.getText().length < 13, detail: `len=${d.getText().length}` };
  });

  // ── Word deletion: additional atom × state combinations ────────

  await test("deleteWordBackward: after atom (atom is word boundary)", () => {
    buildTextAtomText(d, "hello", "");
    // cursor at 6 (after atom, in empty trailing text)
    d.deleteWordBackward();
    // Should delete the atom (it's its own word)
    return { passed: d.getText().length < 6, detail: `len=${d.getText().length}, text="${d.getText().slice(0, 20)}"` };
  });

  await test("deleteWordBackward: between two atoms", () => {
    buildTwoAtoms(d, "a", "", "z");
    // cursor at 2 (between atoms, in empty text)
    d.setSelectedRange(2);
    d.deleteWordBackward();
    return { passed: d.getText().length < 4, detail: `len=${d.getText().length}, atoms=${d.getAtoms().length}` };
  });

  await test("deleteWordForward: before atom (atom is word boundary)", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    type(d, " world");
    // cursor at 5 (just before atom)
    d.setSelectedRange(5);
    d.deleteWordForward();
    return { passed: d.getText().length < 12, detail: `len=${d.getText().length}, text="${d.getText().slice(0, 20)}"` };
  });

  await test("deleteWordForward: between two atoms", () => {
    buildTwoAtoms(d, "a", "", "z");
    d.setSelectedRange(2);
    d.deleteWordForward();
    return { passed: d.getText().length < 4, detail: `len=${d.getText().length}, atoms=${d.getAtoms().length}` };
  });

  await test("deleteWordBackward: at end of text (whole word)", () => {
    type(d, "hello world");
    d.deleteWordBackward();
    return { passed: d.getText() === "hello ", detail: `text="${d.getText()}"` };
  });

  await test("deleteWordForward: at start of text (whole word)", () => {
    type(d, "hello world");
    d.setSelectedRange(0);
    d.deleteWordForward();
    return { passed: d.getText() === "world", detail: `text="${d.getText()}"` };
  });

  await test("deleteWordBackward: multiline across newline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(6);
    d.deleteWordBackward();
    const t = d.getText();
    return { passed: t.length < 11, detail: `text="${t.replace(/\n/g, "\\n")}"` };
  });

  await test("deleteWordForward: multiline across newline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(5);
    d.deleteWordForward();
    const t = d.getText();
    return { passed: t.length < 11, detail: `text="${t.replace(/\n/g, "\\n")}"` };
  });

  await test("deleteWordBackward: with partial selection (selection overrides)", () => {
    type(d, "hello world");
    d.setSelectedRange(2, 8);
    d.deleteWordBackward();
    return { passed: d.getText() === "herld", detail: `text="${d.getText()}"` };
  });

  await test("deleteWordForward: with partial selection (selection overrides)", () => {
    type(d, "hello world");
    d.setSelectedRange(2, 8);
    d.deleteWordForward();
    return { passed: d.getText() === "herld", detail: `text="${d.getText()}"` };
  });

  // ===================================================================
  // DELETION: PARAGRAPH — from TEOI Deletion Paragraph matrix
  // ===================================================================

  await test("deleteParagraphBackward: mid text", () => {
    type(d, "hello world");
    d.setSelectedRange(7);
    d.deleteParagraphBackward();
    return { passed: d.getText() === "orld", detail: `text="${d.getText()}"` };
  });

  await test("deleteParagraphForward: mid text", () => {
    type(d, "hello world");
    d.setSelectedRange(5);
    d.deleteParagraphForward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("deleteParagraphBackward: at atom boundary", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(8);
    d.deleteParagraphBackward();
    return { passed: d.getText().length < 13, detail: `len=${d.getText().length}` };
  });

  await test("deleteParagraphForward: multiline at newline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(6);
    d.deleteParagraphForward();
    return { passed: d.getText() === "hello\n", detail: `text="${d.getText().replace(/\n/g, "\\n")}"` };
  });

  // ── Paragraph deletion: additional atom × state combinations ────

  await test("deleteParagraphBackward: empty (no-op)", () => {
    d.deleteParagraphBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteParagraphForward: empty (no-op)", () => {
    d.deleteParagraphForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteParagraphBackward: at start (no-op)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteParagraphBackward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("deleteParagraphForward: at end (no-op)", () => {
    type(d, "hello");
    d.deleteParagraphForward();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("deleteParagraphBackward: from end (deletes all)", () => {
    type(d, "hello");
    d.deleteParagraphBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}, text="${d.getText()}"` };
  });

  await test("deleteParagraphForward: from start (deletes all)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.deleteParagraphForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}, text="${d.getText()}"` };
  });

  await test("deleteParagraphForward: at atom boundary (before atom)", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    d.deleteParagraphForward();
    // Should delete atom + " world"
    return { passed: d.getText() === "hello " && d.getAtoms().length === 0, detail: `text="${d.getText()}", atoms=${d.getAtoms().length}` };
  });

  await test("deleteParagraphBackward: after atom", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(8);
    d.deleteParagraphBackward();
    // Should delete "hello " + atom + " " — everything before cursor
    return { passed: d.getText() === "world", detail: `text="${d.getText()}"` };
  });

  await test("deleteParagraphBackward: between two atoms", () => {
    buildTwoAtoms(d, "a", "b", "z");
    d.setSelectedRange(3);
    d.deleteParagraphBackward();
    return { passed: d.getText().length < 5, detail: `text="${d.getText().slice(0, 20)}", len=${d.getText().length}` };
  });

  await test("deleteParagraphForward: between two atoms", () => {
    buildTwoAtoms(d, "a", "b", "z");
    d.setSelectedRange(2);
    d.deleteParagraphForward();
    return { passed: d.getText().length < 5, detail: `text="${d.getText().slice(0, 20)}", len=${d.getText().length}` };
  });

  await test("deleteParagraphBackward: multiline, second paragraph with atom", () => {
    type(d, "first");
    d.insertText("\n");
    type(d, "hello ");
    d.insertAtom(TEST_ATOM);
    type(d, " world");
    // cursor at end of second paragraph
    d.deleteParagraphBackward();
    return { passed: d.getText().startsWith("first\n"), detail: `text="${d.getText().replace(/\n/g, "\\n").slice(0, 30)}"` };
  });

  await test("deleteParagraphForward: multiline, first paragraph with atom", () => {
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

  await test("killLine: kills to end of paragraph", () => {
    type(d, "hello world");
    d.setSelectedRange(5);
    d.killLine();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("killLine then yank: restores killed text", () => {
    type(d, "hello world");
    d.setSelectedRange(5);
    d.killLine();
    d.yank();
    return { passed: d.getText() === "hello world", detail: `text="${d.getText()}"` };
  });

  await test("killLine: at atom boundary", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(6);
    d.killLine();
    return { passed: d.getText().length <= 6, detail: `len=${d.getText().length}` };
  });

  // ===================================================================
  // TRANSPOSE — from TEOI Text Transforms matrix
  // ===================================================================

  await test("transpose: mid text", () => {
    type(d, "abcde");
    d.setSelectedRange(3);
    d.transpose();
    // Transposes chars at positions 2 and 3: 'c' ↔ 'd' → "abdce"
    return { passed: d.getText() === "abdce" && cursorAt(d) === 4, detail: `text="${d.getText()}", cursor=${selStr(d)}` };
  });

  await test("transpose: at end of text", () => {
    type(d, "abcde");
    d.transpose();
    // At end, transposes the last two chars: 'd' ↔ 'e' → "abced"
    return { passed: d.getText() === "abced", detail: `text="${d.getText()}"` };
  });

  // ===================================================================
  // OPEN LINE — from TEOI Structure matrix
  // ===================================================================

  await test("openLine: mid text (cursor stays)", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    d.openLine();
    const t = d.getText();
    return { passed: t === "hel\nlo" && cursorAt(d) === 3, detail: `text="${t.replace(/\n/g, "\\n")}", cursor=${selStr(d)}` };
  });

  // ===================================================================
  // UNDO/REDO — from TEOI Selection/Undo matrix
  // ===================================================================

  await test("undo: after typing", () => {
    type(d, "hello");
    type(d, " world");
    d.undo();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("undo then redo: roundtrip", () => {
    type(d, "hello");
    type(d, " world");
    d.undo();
    d.redo();
    return { passed: d.getText() === "hello world", detail: `text="${d.getText()}"` };
  });

  await test("undo: after insertAtom", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.undo();
    return { passed: d.getAtoms().length === 0 && d.getText() === "hello", detail: `atoms=${d.getAtoms().length}, text="${d.getText()}"` };
  });

  await test("undo: after two-step atom delete", () => {
    type(d, "hello");
    d.insertAtom(TEST_ATOM);
    d.setSelectedRange(6);
    d.deleteBackward();
    d.deleteBackward();
    d.undo();
    return { passed: d.getAtoms().length === 1, detail: `atoms=${d.getAtoms().length}` };
  });

  await test("undo: on empty (no-op)", () => {
    d.undo();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("redo: on empty (no-op)", () => {
    d.redo();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  // ===================================================================
  // SELECT ALL / CLEAR / SET SELECTED RANGE
  // ===================================================================

  await test("selectAll: text only", () => {
    type(d, "hello");
    d.selectAll();
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0 && r.end === 5, detail: `sel=${r?.start}..${r?.end}` };
  });

  await test("selectAll: with atoms", () => {
    buildTextAtomText(d, "hello ", " world");
    d.selectAll();
    const r = d.getSelectedRange();
    const len = d.getText().length;
    return { passed: r !== null && r.start === 0 && r.end === len, detail: `sel=${r?.start}..${r?.end}, len=${len}` };
  });

  await test("selectAll: multiline", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.selectAll();
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0 && r.end === 11, detail: `sel=${r?.start}..${r?.end}` };
  });

  await test("clear: text only", () => {
    type(d, "hello");
    d.clear();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("clear: with atoms", () => {
    buildTextAtomText(d, "hello ", " world");
    d.clear();
    return { passed: d.isEmpty() && d.getAtoms().length === 0, detail: `empty=${d.isEmpty()}, atoms=${d.getAtoms().length}` };
  });

  await test("setSelectedRange: collapse to position", () => {
    type(d, "hello");
    d.setSelectedRange(3);
    return { passed: cursorAt(d) === 3, detail: `cursor=${selStr(d)}` };
  });

  await test("setSelectedRange: range", () => {
    type(d, "hello");
    d.setSelectedRange(1, 4);
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 1 && r.end === 4, detail: `sel=${r?.start}..${r?.end}` };
  });

  await test("setSelectedRange: at atom boundary", () => {
    buildTextAtomText(d, "hello ", "");
    d.setSelectedRange(6);
    return { passed: cursorAt(d) === 6 && !cursorIsInsideAtom(d), detail: `cursor=${selStr(d)}, inside=${cursorIsInsideAtom(d)}` };
  });

  // ===================================================================
  // RENDERING — atom visual integrity
  // ===================================================================

  await test("atom: renders with label via data attribute", () => {
    buildTextAtomText(d, "hello ", "");
    const atom = el!.querySelector("[data-slot=tug-atom]") as HTMLSpanElement | null;
    if (!atom) return { passed: false, detail: "No atom span" };
    // Label renders via CSS ::after from data-atom-label attribute
    const label = atom.dataset.atomLabel;
    // Badge should have NO text children (prevents caret asymmetry)
    const hasNoTextChildren = atom.childNodes.length === 0;
    return { passed: label === TEST_ATOM.label && hasNoTextChildren, detail: `label="${label}", childNodes=${atom.childNodes.length} (expect 0)` };
  });

  await test("atom: badge has no text children", () => {
    buildTextAtomText(d, "hello ", " world");
    const atom = el!.querySelector("[data-slot=tug-atom]") as HTMLSpanElement | null;
    if (!atom) return { passed: false, detail: "No atom span" };
    // Badge must have zero child nodes — icon and label render via CSS pseudo-elements.
    // Text children create extra caret stops during keyboard navigation.
    return { passed: atom.childNodes.length === 0, detail: `childNodes=${atom.childNodes.length} (expect 0)` };
  });

  // ===================================================================
  // FULL SELECTION × OPERATIONS — text-selection-all state
  // ===================================================================

  await test("insertAtom: replaces full selection with atom", () => {
    type(d, "hello world");
    d.selectAll();
    d.insertAtom(TEST_ATOM);
    return { passed: d.getAtoms().length === 1 && d.getText().length === 1, detail: `atoms=${d.getAtoms().length}, len=${d.getText().length}` };
  });

  await test("deleteForward: with full selection clears all", () => {
    type(d, "hello");
    d.selectAll();
    d.deleteForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteWordBackward: with full selection clears all", () => {
    type(d, "hello world");
    d.selectAll();
    d.deleteWordBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteWordForward: with full selection clears all", () => {
    type(d, "hello world");
    d.selectAll();
    d.deleteWordForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteParagraphBackward: with full selection clears all", () => {
    type(d, "hello world");
    d.selectAll();
    d.deleteParagraphBackward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("deleteParagraphForward: with full selection clears all", () => {
    type(d, "hello world");
    d.selectAll();
    d.deleteParagraphForward();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("typing: replaces selection spanning atom", () => {
    // "hello " + atom + " world" = 13 chars. Selection 4..9 = "o \uFFFC w".
    // Replacing with "x" → "hell" + "x" + "orld" = 9 chars, 0 atoms.
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(4, 9);
    type(d, "x");
    return { passed: d.getAtoms().length === 0 && d.getText() === "hellxorld", detail: `text="${d.getText()}", atoms=${d.getAtoms().length}` };
  });

  await test("selectAll: with two atoms", () => {
    buildTwoAtoms(d, "a", "b", "c");
    d.selectAll();
    const r = d.getSelectedRange();
    return { passed: r !== null && r.start === 0 && r.end === 5, detail: `sel=${r?.start}..${r?.end}` };
  });

  await test("deleteBackward: full selection with atoms clears all", () => {
    buildTwoAtoms(d, "hello ", " ", " world");
    d.selectAll();
    d.deleteBackward();
    return { passed: d.isEmpty() && d.getAtoms().length === 0, detail: `empty=${d.isEmpty()}, atoms=${d.getAtoms().length}` };
  });

  // ===================================================================
  // MULTIWORD × WORD DELETION — comprehensive word boundary tests
  // ===================================================================

  await test("deleteWordBackward: three words, cursor at space after second", () => {
    type(d, "one two three");
    d.setSelectedRange(7); // at space between "two" and "three"
    d.deleteWordBackward();
    const t = d.getText();
    // macOS behavior: Option+Delete deletes " two" (space + word), leaving "one three"
    return { passed: t === "one three", detail: `text="${t}"` };
  });

  await test("deleteWordForward: three words, cursor at start of second", () => {
    type(d, "one two three");
    d.setSelectedRange(4);
    d.deleteWordForward();
    const t = d.getText();
    return { passed: t === "one three", detail: `text="${t}"` };
  });

  await test("deleteWordBackward: word + atom + word, cursor in trailing word", () => {
    buildTextAtomText(d, "hello ", " world");
    d.setSelectedRange(13);
    d.deleteWordBackward();
    // Should delete "world" (the trailing word)
    const t = d.getText();
    return { passed: t.length < 13, detail: `text="${t.slice(0, 20)}", len=${t.length}` };
  });

  await test("deleteWordForward: word + atom + word, cursor in leading word", () => {
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

  await test("killLine: empty (no-op)", () => {
    d.killLine();
    return { passed: d.isEmpty(), detail: `empty=${d.isEmpty()}` };
  });

  await test("killLine: at end (no-op)", () => {
    type(d, "hello");
    d.killLine();
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("killLine: at start (kills entire line)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.killLine();
    return { passed: d.isEmpty(), detail: `text="${d.getText()}"` };
  });

  await test("killLine: multiline, kills to newline only", () => {
    type(d, "hello");
    d.insertText("\n");
    type(d, "world");
    d.setSelectedRange(0);
    d.killLine();
    return { passed: d.getText() === "\nworld", detail: `text="${d.getText().replace(/\n/g, "\\n")}"` };
  });

  await test("killLine then yank: at atom boundary", () => {
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

  await test("transpose: at start (no-op or limited)", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.transpose();
    // At position 0, there's nothing before to transpose
    return { passed: d.getText() === "hello", detail: `text="${d.getText()}"` };
  });

  await test("transpose: at position 1", () => {
    type(d, "hello");
    d.setSelectedRange(1);
    d.transpose();
    return { passed: d.getText() === "ehllo", detail: `text="${d.getText()}"` };
  });

  await test("transpose: near atom boundary (should not transpose atom)", () => {
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

  await test("openLine: at start of text", () => {
    type(d, "hello");
    d.setSelectedRange(0);
    d.openLine();
    return { passed: d.getText() === "\nhello" && cursorAt(d) === 0, detail: `text="${d.getText().replace(/\n/g, "\\n")}", cursor=${selStr(d)}` };
  });

  await test("openLine: at end of text", () => {
    type(d, "hello");
    d.openLine();
    return { passed: d.getText() === "hello\n" && cursorAt(d) === 5, detail: `text="${d.getText().replace(/\n/g, "\\n")}", cursor=${selStr(d)}` };
  });

  await test("openLine: with atom", () => {
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

  await test("B01: delete key after typing space after atom", () => {
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

  await test("B04: left arrow after insert atom overshoots", async () => {
    // Type "hello", insert atom, left arrow
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    // Cursor should be at 6 (after atom). "hello"=5 + atom=1 = 6
    const before = cursorAt(d);

    // Left arrow — should go to 5 (between "hello" and atom), not to 4 (before 'o')
    await arrowLeft(1);
    const after = cursorAt(d);

    // The cursor should be at 5 (just before the atom, at end of "hello")
    const passed = before === 6 && after === 5;
    return { passed, detail: `before=${before} (expect 6), after=${after} (expect 5)` };
  });

  await test("B05: shift+right from before atom should select atom, not text", async () => {
    // Type "hello", insert atom
    type(d, "hello");
    d.insertAtom(TEST_ATOM);

    // Place cursor between "hello" and atom (offset 5)
    d.setSelectedRange(5);

    // Shift+right should select the atom (extend to 6), not select "hello"
    await shiftRight(1);
    const range = d.getSelectedRange();

    // Selection should be 5..6 (just the atom), NOT 0..5 or anything backward
    const passed = range !== null && range.start === 5 && range.end === 6;
    return { passed, detail: `sel=${range?.start}..${range?.end} (expect 5..6)` };
  });

  await test("B02: first return key swallowed, second works", () => {
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

  await test("B06: click atom should highlight it and hide caret", () => {
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

  // ===================================================================
  // BA01: Atom navigation asymmetry
  // Left and right arrow through atoms must take the same number of steps.
  // ===================================================================

  await test("BA01: left/right arrow count symmetric through atom", async () => {
    // Type "x ", insert atom → "x " + atom + "" = flat length 4
    type(d, "x ");
    d.insertAtom(TEST_ATOM);

    const totalLen = d.getText().length; // should be 3: "x "(2) + atom(1)

    // Count right arrows from start to end
    d.setSelectedRange(0);
    let rightSteps = 0;
    const rightPositions = [0];
    for (let i = 0; i < 10; i++) {
      const before = cursorAt(d);
      await arrowRight(1);
      const after = cursorAt(d);
      rightPositions.push(after!);
      if (after === before) break; // stuck at end
      rightSteps++;
    }

    // Count left arrows from end to start
    d.setSelectedRange(totalLen);
    let leftSteps = 0;
    const leftPositions = [totalLen];
    for (let i = 0; i < 10; i++) {
      const before = cursorAt(d);
      await arrowLeft(1);
      const after = cursorAt(d);
      leftPositions.push(after!);
      if (after === before) break; // stuck at start
      leftSteps++;
    }

    const passed = rightSteps === leftSteps && rightSteps === totalLen;
    return {
      passed,
      detail: `right=${rightSteps} steps ${JSON.stringify(rightPositions)}, left=${leftSteps} steps ${JSON.stringify(leftPositions)}, totalLen=${totalLen} (expect ${totalLen} steps each)`,
    };
  });

  // ===================================================================
  // ATOM AT END OF LINE — caret placement, navigation, editing
  // ===================================================================

  // Helper: build "x<atom>\ny<atom>" — two lines, each ending with an atom
  function buildTwoLineAtoms(d: TugTextInputDelegate): void {
    type(d, "x");
    d.insertAtom(TEST_ATOM);
    d.insertText("\n");
    type(d, "y");
    d.insertAtom(TEST_ATOM_2);
  }

  // Helper: build "x<atom>\ny" — first line ends with atom, second line has text
  function buildAtomEndOfLine(d: TugTextInputDelegate): void {
    type(d, "x");
    d.insertAtom(TEST_ATOM);
    d.insertText("\n");
    type(d, "y");
  }

  await test("endOfLine: arrow left from end visits every position", async () => {
    // "x" + atom + "\ny" + atom = flat length 5
    // Expected positions: 5, 4, 3, 2, 1, 0
    buildTwoLineAtoms(d);
    const totalLen = d.getText().length;
    d.setSelectedRange(totalLen);
    const positions: number[] = [totalLen];
    for (let i = 0; i < totalLen + 2; i++) {
      const before = cursorAt(d);
      await arrowLeft(1);
      const after = cursorAt(d);
      positions.push(after!);
      if (after === before) break;
    }
    const reachesStart = positions[positions.length - 1] === 0;
    const monotonic = positions.every((p, i) => i === 0 || p <= positions[i - 1]);
    const steps = positions.length - 1;
    return {
      passed: reachesStart && monotonic && steps <= totalLen + 1,
      detail: `positions=${JSON.stringify(positions)}, totalLen=${totalLen}`,
    };
  });

  await test("endOfLine: arrow right from start visits every position", async () => {
    buildTwoLineAtoms(d);
    const totalLen = d.getText().length;
    d.setSelectedRange(0);
    const positions: number[] = [0];
    for (let i = 0; i < totalLen + 2; i++) {
      const before = cursorAt(d);
      await arrowRight(1);
      const after = cursorAt(d);
      positions.push(after!);
      if (after === before) break;
    }
    const reachesEnd = positions[positions.length - 1] === totalLen;
    const monotonic = positions.every((p, i) => i === 0 || p >= positions[i - 1]);
    return {
      passed: reachesEnd && monotonic,
      detail: `positions=${JSON.stringify(positions)}, totalLen=${totalLen}`,
    };
  });

  await test("endOfLine: cursor at end of first line (after atom, before newline)", async () => {
    buildAtomEndOfLine(d);
    // "x"(1) + atom(1) + "\ny"(2) = 4. Position 2 = after atom, before \n.
    d.setSelectedRange(2);
    const pos = cursorAt(d);
    return { passed: pos === 2, detail: `cursor=${pos} (expect 2)` };
  });

  await test("endOfLine: type at end of first line inserts before newline", () => {
    buildAtomEndOfLine(d);
    d.setSelectedRange(2); // after atom, before \n
    d.insertText("z");
    const text = d.getText();
    // "x" + atom + "z\ny" = "x\uFFFCz\ny"
    const passed = text === "x\uFFFCz\ny";
    return { passed, detail: `text="${text.replace(/\n/g, "\\n")}"` };
  });

  await test("endOfLine: return at end of first line (after atom)", () => {
    type(d, "x");
    d.insertAtom(TEST_ATOM);
    d.insertText("\n");
    const text = d.getText();
    // "x" + atom + "\n" = length 3, ends with newline
    const passed = text === "x\uFFFC\n" && text.length === 3;
    return { passed, detail: `text="${text.replace(/\n/g, "\\n")}", len=${text.length}` };
  });

  await test("endOfLine: deleteBackward at start of second line", () => {
    buildAtomEndOfLine(d);
    d.setSelectedRange(3); // start of "y" on line 2 (after \n)
    d.deleteBackward();
    const text = d.getText();
    // Delete \n: "x" + atom + "y" = "x\uFFFCy"
    const passed = text === "x\uFFFCy";
    return { passed, detail: `text="${text.replace(/\n/g, "\\n")}"` };
  });

  await test("endOfLine: deleteForward at end of first line (after atom)", () => {
    buildAtomEndOfLine(d);
    d.setSelectedRange(2); // after atom, before \n
    d.deleteForward();
    const text = d.getText();
    // Delete \n: "x" + atom + "y" = "x\uFFFCy"
    const passed = text === "x\uFFFCy";
    return { passed, detail: `text="${text.replace(/\n/g, "\\n")}"` };
  });

  await test("endOfLine: selectAll with multiline atoms", () => {
    buildTwoLineAtoms(d);
    d.selectAll();
    const range = d.getSelectedRange();
    const totalLen = d.getText().length;
    const passed = range !== null && range.start === 0 && range.end === totalLen;
    return { passed, detail: `sel=${range?.start}..${range?.end} (expect 0..${totalLen})` };
  });

  await test("endOfLine: shift+right selects across line boundary with atom", async () => {
    buildAtomEndOfLine(d);
    d.setSelectedRange(1); // after "x", before atom
    await shiftRight(3); // should select atom + \n + y = 3 chars
    const range = d.getSelectedRange();
    const passed = range !== null && range.start === 1 && range.end === 4;
    return { passed, detail: `sel=${range?.start}..${range?.end} (expect 1..4)` };
  });

  await test("endOfLine: deleteWordBackward from second line", () => {
    buildAtomEndOfLine(d);
    const len = d.getText().length;
    d.setSelectedRange(len); // end of "y"
    d.deleteWordBackward();
    const text = d.getText();
    // Delete "y" (word backward from end = delete "y")
    const passed = text === "x\uFFFC\n";
    return { passed, detail: `text="${text.replace(/\n/g, "\\n")}"` };
  });

  await test("endOfLine: two atoms on separate lines, symmetric navigation", async () => {
    buildTwoLineAtoms(d);
    const totalLen = d.getText().length;

    // Count right arrows from start to end
    d.setSelectedRange(0);
    let rightSteps = 0;
    for (let i = 0; i < 10; i++) {
      const before = cursorAt(d);
      await arrowRight(1);
      const after = cursorAt(d);
      if (after === before) break;
      rightSteps++;
    }

    // Count left arrows from end to start
    d.setSelectedRange(totalLen);
    let leftSteps = 0;
    for (let i = 0; i < 10; i++) {
      const before = cursorAt(d);
      await arrowLeft(1);
      const after = cursorAt(d);
      if (after === before) break;
      leftSteps++;
    }

    const passed = rightSteps === leftSteps && rightSteps === totalLen;
    return {
      passed,
      detail: `right=${rightSteps}, left=${leftSteps}, totalLen=${totalLen} (expect ${totalLen} each)`,
    };
  });

  // ── Summary ──

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  return { passed, failed, total: results.length, results };
}
