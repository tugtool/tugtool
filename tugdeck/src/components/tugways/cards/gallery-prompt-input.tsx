/**
 * gallery-prompt-input.tsx -- TugPromptInput gallery card.
 *
 * Testing surface for the tug-prompt-input component. Includes:
 * - Interactive editor with diagnostics and event log
 * - TEOE test runner: incoming state → operation → verify outgoing state
 * - Scenario tests for mixed typing+API sequences
 * - Key configuration for Return/Enter
 *
 * Test approach:
 *   TEOE tests set up incoming state, execute operations, and compare
 *   the captured outgoing state against expected. Typing simulation uses
 *   document.execCommand("insertText") — the browser's actual editing
 *   pipeline. All other operations use the delegate API.
 *
 * Laws of Tug compliance:
 *   [L01] One root.render() at mount — component manages engine internally
 *   [L06] Diagnostics and log are direct DOM writes, no React state
 */

import React, { useRef, useLayoutEffect, useCallback, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/components/tugways/tug-prompt-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import type { AtomSegment, InputAction, CompletionItem } from "@/lib/tug-text-engine";
import { captureEditingState, editingStatesEqual, formatEditingState } from "@/lib/tug-text-engine";
import { allTEOEs } from "@/lib/tug-text-editing-operations";
import type { TEOE, Operation } from "@/lib/tug-text-editing-operations";
import { runAtomDOMTests } from "@/lib/tug-atom-dom-tests";
import { runIntegrationTests, runIMETests } from "@/lib/tug-integration-tests";
import "./gallery-prompt-input.css";

// ===================================================================
// Atom-as-image builder (spike)
// ===================================================================

/** Lucide-style icon paths (24x24 viewBox) for atom types */
const ATOM_ICON_PATHS: Record<string, string> = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  command: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  doc: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

/** Shared canvas for text measurement */
let _measureCanvas: HTMLCanvasElement | null = null;
function measureTextWidth(text: string, font: string): number {
  if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Create an atom <img> element with SVG data URI */
function createAtomImgElement(type: string, label: string, value: string): HTMLImageElement {
  const fontSize = 12;
  const fontFamily = "system-ui, sans-serif";
  const textWidth = measureTextWidth(label, `${fontSize}px ${fontFamily}`);
  const iconSize = 12;
  const padding = 6;
  const gap = 4;
  const w = padding + iconSize + gap + Math.ceil(textWidth) + padding;
  const h = 22;

  const iconPath = ATOM_ICON_PATHS[type] ?? ATOM_ICON_PATHS.file;
  const icon = `<g transform="translate(${padding},${(h - iconSize) / 2}) scale(${iconSize / 24})" fill="none" stroke="#8899aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="3" fill="#2a2f3a" stroke="#4a5568" stroke-width="1"/>`,
    icon,
    `<text x="${padding + iconSize + gap}" y="${h / 2 + fontSize * 0.36}" font-size="${fontSize}" font-family="${fontFamily}" fill="#c8d0dc">${label}</text>`,
    `</svg>`,
  ].join("");

  const img = document.createElement("img");
  img.src = "data:image/svg+xml;base64," + btoa(svg);
  img.height = h;
  img.style.verticalAlign = "-5px";
  img.dataset.atomType = type;
  img.dataset.atomLabel = label;
  img.dataset.atomValue = value;
  return img;
}

/** Create atom img as HTML string (for initial content / insertHTML) */
function atomImgHTML(type: string, label: string, value?: string): string {
  const el = createAtomImgElement(type, label, value ?? label);
  const wrapper = document.createElement("div");
  wrapper.appendChild(el);
  return wrapper.innerHTML;
}

// ===================================================================
// Test harness types
// ===================================================================

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

interface TestCase {
  name: string;
  description: string;
  run(d: TugTextInputDelegate): TestResult;
}

// ===================================================================
// Typing simulation
//
// Uses document.execCommand("insertText") to go through the browser's
// actual editing pipeline: beforeinput → DOM mutation → MutationObserver
// → engine. This is the same path as real keyboard input.
//
// For operations that don't go through the browser (deleteBackward,
// insertAtom, etc.), we call the delegate API directly — same as the
// keyboard handlers.
// ===================================================================

/**
 * Simulate typing via execCommand — goes through the browser's editing pipeline.
 * Flushes MutationObserver synchronously so the engine model is updated before return.
 */
function typeText(d: TugTextInputDelegate, text: string): void {
  const el = d.getEditorElement();
  if (!el) return;
  el.focus();
  document.execCommand("insertText", false, text);
  d.flushMutations();
}

/**
 * Execute a single TEOE operation against a delegate.
 * For "typing", uses execCommand (browser path).
 * For everything else, uses the delegate API (same as keyboard handlers).
 */
function executeOperation(d: TugTextInputDelegate, op: Operation): void {
  switch (op.type) {
    case "typing":
      typeText(d, op.text);
      break;
    case "insertText":
      d.insertText(op.text);
      break;
    case "paste":
      d.insertText(op.text); // paste routes to insertText in the engine
      break;
    case "insertAtom":
      d.insertAtom(op.atom);
      break;
    case "deleteBackward":
      d.deleteBackward();
      break;
    case "deleteForward":
      d.deleteForward();
      break;
    case "deleteWordBackward":
      d.deleteWordBackward();
      break;
    case "deleteWordForward":
      d.deleteWordForward();
      break;
    case "deleteSoftLineBackward":
    case "deleteParagraphBackward":
      d.deleteParagraphBackward();
      break;
    case "deleteSoftLineForward":
    case "deleteParagraphForward":
      d.deleteParagraphForward();
      break;
    case "selectAll":
      d.selectAll();
      break;
    case "setSelectedRange":
      d.setSelectedRange(op.start, op.end);
      break;
    case "clear":
      d.clear();
      break;
    case "undo":
      d.undo();
      break;
    case "redo":
      d.redo();
      break;
    case "killLine":
      d.killLine();
      break;
    case "yank":
      d.yank();
      break;
    case "transpose":
      d.transpose();
      break;
    case "openLine":
      d.openLine();
      break;
    case "typeaheadAccept":
    case "compositionStart":
    case "compositionUpdate":
    case "compositionEnd":
      // Not yet implemented in test runner
      break;
  }
}

/**
 * Run a single TEOE against a delegate. Returns a TestResult.
 *
 * 1. Restore incoming state
 * 2. Execute operation(s)
 * 3. Capture outgoing state
 * 4. Compare with expected
 */
function runTEOE(d: TugTextInputDelegate, teoe: TEOE): TestResult {
  const el = d.getEditorElement();
  if (!el) {
    return { name: teoe.name, passed: false, expected: "", actual: "No editor element" };
  }
  el.focus();

  // Set up incoming state via restoreState — clean slate with no undo history
  d.restoreState(teoe.incoming);
  el.focus();
  // Re-apply selection after focus — restoreState sets it but focus may reset it
  if (teoe.incoming.selection) {
    d.setSelectedRange(teoe.incoming.selection.start, teoe.incoming.selection.end);
  }

  // Execute operation(s)
  const ops = teoe.sequenceOps ?? (teoe.operation ? [teoe.operation] : []);
  for (const op of ops) {
    executeOperation(d, op);
  }

  // Capture outgoing state
  const actual = captureEditingState(d);

  // Compare
  const passed = editingStatesEqual(actual, teoe.expected);
  return {
    name: teoe.name,
    passed,
    expected: formatEditingState(teoe.expected),
    actual: formatEditingState(actual),
  };
}

// ===================================================================
// Sample data
// ===================================================================

const FILE_ATOM: AtomSegment = { kind: "atom", type: "file", label: "src/main.ts", value: "/project/src/main.ts" };
const FILE_ATOM_2: AtomSegment = { kind: "atom", type: "file", label: "README.md", value: "/project/README.md" };

const SAMPLE_ATOMS: AtomSegment[] = [
  FILE_ATOM, FILE_ATOM_2,
  { kind: "atom", type: "command", label: "/commit", value: "/commit" },
  { kind: "atom", type: "file", label: "src/lib/feed-store.ts", value: "/project/src/lib/feed-store.ts" },
];

const TYPEAHEAD_FILES = [
  "src/main.ts", "src/main.tsx", "src/protocol.ts", "src/connection.ts",
  "src/lib/feed-store.ts", "src/lib/connection-singleton.ts",
  "src/deck-manager.ts", "src/settings-api.ts", "src/action-dispatch.ts",
  "README.md", "package.json", "tsconfig.json",
];

function galleryCompletionProvider(query: string): CompletionItem[] {
  const q = query.toLowerCase();
  const files = q.length === 0
    ? TYPEAHEAD_FILES.slice(0, 8)
    : TYPEAHEAD_FILES.filter(f => f.toLowerCase().includes(q)).slice(0, 8);
  return files.map(f => ({
    label: f,
    atom: { kind: "atom" as const, type: "file", label: f, value: f },
  }));
}

function galleryDropHandler(files: FileList): AtomSegment[] {
  const atoms: AtomSegment[] = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i].name;
    atoms.push({ kind: "atom", type: "file", label: name, value: name });
  }
  return atoms;
}

const RETURN_CHOICES: TugChoiceItem[] = [
  { value: "submit", label: "Return submits" },
  { value: "newline", label: "Return = newline" },
];

const ENTER_CHOICES: TugChoiceItem[] = [
  { value: "submit", label: "Enter submits" },
  { value: "newline", label: "Enter = newline" },
];

const OBJ = "\uFFFC";

// ===================================================================
// Test cases
//
// Setup uses typeText() for realistic typing (DOM mutation path) and
// delegate.insertAtom() for atom insertion (programmatic, same as
// clicking the Insert Atom button). Actions use delegate API methods —
// the same methods keyboard handlers call.
// ===================================================================

const TEST_CASES: TestCase[] = [
  {
    name: "B01: deleteForward after typed text + atom",
    description: 'Type "hello ", insert atom, type " ". Cursor at end. deleteForward at offset 7 (after atom) should delete the space.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello ");
      d.insertAtom(FILE_ATOM);
      typeText(d, " world");
      // Cursor after atom: "hello " = 6, atom = 1
      d.setSelectedRange(7);
      d.deleteForward();
      const text = d.getText();
      const expected = `hello ${OBJ}world`;
      return {
        name: this.name,
        passed: text === expected,
        expected: `"hello [atom]world"`,
        actual: `"${text.replace(OBJ, "[atom]")}"`,
      };
    },
  },
  {
    name: "B01b: deleteBackward after typed text + atom",
    description: 'Type "hello", insert atom, type " world". Cursor at end. deleteBackward should remove "d".',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello");
      d.insertAtom(FILE_ATOM);
      typeText(d, " world");
      // Cursor at end
      d.deleteBackward();
      const text = d.getText();
      const expected = `hello${OBJ} worl`;
      return {
        name: this.name,
        passed: text === expected,
        expected: `"hello[atom] worl"`,
        actual: `"${text.replace(OBJ, "[atom]")}"`,
      };
    },
  },
  {
    name: "B02: insertText newline",
    description: 'Type "hello", insertText("\\n"), type "world". Content should have newline.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello");
      d.insertText("\n");
      typeText(d, "world");
      const text = d.getText();
      const expected = "hello\nworld";
      return {
        name: this.name,
        passed: text === expected,
        expected: `"hello\\nworld"`,
        actual: `"${text.replace(/\n/g, "\\n")}"`,
      };
    },
  },
  {
    name: "B03: selectAll covers full content with atoms",
    description: 'Type "hello ", insert two atoms. selectAll should span entire content.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello ");
      d.insertAtom(FILE_ATOM);
      typeText(d, " ");
      d.insertAtom(FILE_ATOM_2);
      d.selectAll();
      const range = d.getSelectedRange();
      const totalLen = d.getText().length;
      const passed = range !== null && range.start === 0 && range.end === totalLen;
      return {
        name: this.name,
        passed,
        expected: `selection: {0, ${totalLen}}`,
        actual: range ? `selection: {${range.start}, ${range.end}}` : "null",
      };
    },
  },
  {
    name: "B03b: deleteBackward after selectAll clears all",
    description: 'Type + atoms, selectAll, deleteBackward → empty.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello ");
      d.insertAtom(FILE_ATOM);
      typeText(d, " ");
      d.insertAtom(FILE_ATOM_2);
      d.selectAll();
      d.deleteBackward();
      return {
        name: this.name,
        passed: d.isEmpty(),
        expected: "empty",
        actual: d.isEmpty() ? "empty" : `"${d.getText().replace(/\uFFFC/g, "[atom]")}"`,
      };
    },
  },
  {
    name: "B04: cursor positioning at atom boundary",
    description: 'Type "hello", insert atom. setSelectedRange(5) should place cursor between text and atom.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello");
      d.insertAtom(FILE_ATOM);
      d.setSelectedRange(5);
      const range = d.getSelectedRange();
      return {
        name: this.name,
        passed: range !== null && range.start === 5 && range.end === 5,
        expected: "cursor at {5}",
        actual: range ? `cursor at {${range.start}}` : "null",
      };
    },
  },
  {
    name: "B05: setSelectedRange selects across atom",
    description: 'Type "hello", insert atom, type "world". setSelectedRange(5, 6) selects atom.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello");
      d.insertAtom(FILE_ATOM);
      typeText(d, "world");
      d.setSelectedRange(5, 6);
      const range = d.getSelectedRange();
      return {
        name: this.name,
        passed: range !== null && range.start === 5 && range.end === 6,
        expected: "selection: {5, 6}",
        actual: range ? `selection: {${range.start}, ${range.end}}` : "null",
      };
    },
  },
  {
    name: "B06: two-step backspace highlights atom",
    description: 'Type "hello", insert atom. Cursor after atom. First deleteBackward highlights, does not delete.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello");
      d.insertAtom(FILE_ATOM);
      d.setSelectedRange(6); // after atom
      d.deleteBackward();
      const atoms = d.getAtoms();
      const el = d.getEditorElement();
      const highlighted = el?.querySelector(".tug-atom-selected") !== null;
      return {
        name: this.name,
        passed: atoms.length === 1 && highlighted,
        expected: "1 atom, highlighted",
        actual: `${atoms.length} atom(s), ${highlighted ? "highlighted" : "not highlighted"}`,
      };
    },
  },
  {
    name: "B06b: second deleteBackward deletes atom",
    description: 'Type "hello", insert atom. Two deleteBackward calls → atom gone.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello");
      d.insertAtom(FILE_ATOM);
      d.setSelectedRange(6);
      d.deleteBackward();
      d.deleteBackward();
      return {
        name: this.name,
        passed: d.getAtoms().length === 0 && d.getText() === "hello",
        expected: `"hello", 0 atoms`,
        actual: `"${d.getText().replace(/\uFFFC/g, "[atom]")}", ${d.getAtoms().length} atoms`,
      };
    },
  },
  {
    name: "Typed text + atom + getText",
    description: 'Type "before ", insert atom, type " after". getText should match.',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "before ");
      d.insertAtom(FILE_ATOM);
      typeText(d, " after");
      const text = d.getText();
      const expected = `before ${OBJ} after`;
      return {
        name: this.name,
        passed: text === expected,
        expected: `"before [atom] after"`,
        actual: `"${text.replace(OBJ, "[atom]")}"`,
      };
    },
  },
  {
    name: "Undo after typed text",
    description: 'Type "hello", then type " world", undo → "hello".',
    run(d) {
      d.clear(); d.focus();
      typeText(d, "hello");
      typeText(d, " world");
      d.undo();
      const text = d.getText();
      return {
        name: this.name,
        passed: text === "hello",
        expected: `"hello"`,
        actual: `"${text}"`,
      };
    },
  },
];

// ===================================================================
// Gallery component
// ===================================================================

export function GalleryPromptInput() {
  const inputRef = useRef<TugTextInputDelegate>(null);
  const testInputRef = useRef<TugTextInputDelegate>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const diagRef = useRef<HTMLPreElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const nextAtomIdx = useRef(0);
  const [returnAction, setReturnAction] = useState<InputAction>("submit");
  const [enterAction, setEnterAction] = useState<InputAction>("submit");
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  // Log — direct DOM write [L06]
  const appendLog = useCallback((msg: string) => {
    const el = logRef.current;
    if (!el) return;
    const line = document.createElement("div");
    line.textContent = msg;
    el.appendChild(line);
    while (el.childNodes.length > 30) el.removeChild(el.firstChild!);
    el.scrollTop = el.scrollHeight;
  }, []);

  const clearLog = useCallback(() => {
    const el = logRef.current;
    if (el) el.textContent = "";
  }, []);

  const copyLog = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const text = Array.from(el.children).map(c => c.textContent).join("\n");
    navigator.clipboard.writeText(text);
  }, []);

  // Diagnostics — direct DOM write [L06]
  const updateDiagnostics = useCallback(() => {
    const delegate = inputRef.current;
    const el = diagRef.current;
    if (!delegate || !el) return;

    const range = delegate.getSelectedRange();
    const rangeStr = range
      ? (range.start === range.end
        ? `{${range.start}}` : `{${range.start}, ${range.end}}`)
      : "null";
    const collapsed = range ? range.start === range.end : false;
    const atoms = delegate.getAtoms();
    const text = delegate.getText();

    el.textContent = [
      `selectedRange: ${rangeStr}${collapsed ? " (collapsed)" : ""}`,
      `hasMarkedText: ${delegate.hasMarkedText}`,
      `canUndo: ${delegate.canUndo} | canRedo: ${delegate.canRedo}`,
      `length: ${text.length} | atoms: ${atoms.length} | empty: ${delegate.isEmpty()}`,
    ].join("\n");
  }, []);

  useLayoutEffect(() => {
    const onSelChange = () => {
      if (inputRef.current) updateDiagnostics();
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, [updateDiagnostics]);

  // Expose test runner for programmatic access via /api/eval
  useLayoutEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__runTEOETests = () => {
      const delegate = testInputRef.current;
      if (!delegate) return { error: "no test delegate" };
      delegate.focus();
      const teoes = allTEOEs();
      const results: Array<{ id: string; name: string; passed: boolean; expected: string; actual: string }> = [];
      for (const teoe of teoes) {
        delegate.clear();
        try {
          const r = runTEOE(delegate, teoe);
          results.push({ id: teoe.id, name: r.name, passed: r.passed, expected: r.expected, actual: r.actual });
        } catch (err) {
          results.push({ id: teoe.id, name: teoe.name, passed: false, expected: formatEditingState(teoe.expected), actual: `Error: ${err}` });
        }
      }
      delegate.clear();
      const passed = results.filter(r => r.passed).length;
      const failed = results.filter(r => !r.passed).length;
      return { passed, failed, total: results.length, failures: results.filter(r => !r.passed) };
    };
    w.__runAtomDOMTests = () => runAtomDOMTests();
    w.__runIntegrationTests = async () => {
      const delegate = inputRef.current;
      if (!delegate) return { error: "no delegate" };
      return await runIntegrationTests(delegate);
    };
    w.__runIMETests = () => {
      const delegate = inputRef.current;
      if (!delegate) return { error: "no delegate" };
      return runIMETests(delegate);
    };
    w.__getTestDelegate = () => inputRef.current;
    return () => { delete w.__runTEOETests; delete w.__runAtomDOMTests; delete w.__runIntegrationTests; delete w.__runIMETests; delete w.__getTestDelegate; };
  }, []);

  const handleSubmit = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    const text = delegate.getText().trim();
    const atoms = delegate.getAtoms().map(a => a.label);
    appendLog(`submit: "${text}" atoms=[${atoms.join(", ")}]`);
    delegate.clear();
  }, [appendLog]);

  const handleChange = useCallback(() => {
    updateDiagnostics();
  }, [updateDiagnostics]);

  const handleTypeaheadChange = useCallback((
    active: boolean, filtered: CompletionItem[], selectedIndex: number,
  ) => {
    const popup = popupRef.current;
    const container = containerRef.current;
    if (!popup) return;
    if (!active || filtered.length === 0) {
      popup.style.display = "none";
      return;
    }
    popup.style.display = "block";
    popup.innerHTML = "";
    filtered.forEach((item, i) => {
      const div = document.createElement("div");
      div.className = "prompt-input-typeahead-item" +
        (i === selectedIndex ? " prompt-input-typeahead-selected" : "");
      div.textContent = item.label;
      popup.appendChild(div);
    });
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && container) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      popup.style.left = `${rect.left - containerRect.left}px`;
      popup.style.bottom = `${containerRect.bottom - rect.top + 4}px`;
    }
  }, []);

  const handleInsertAtom = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    const atom = SAMPLE_ATOMS[nextAtomIdx.current % SAMPLE_ATOMS.length];
    nextAtomIdx.current++;
    delegate.focus();
    delegate.insertAtom(atom);
  }, []);

  const handleClear = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    delegate.clear();
    delegate.focus();
    clearLog();
  }, [clearLog]);

  const handleReturnAction = useCallback((value: string) => {
    setReturnAction(value as InputAction);
    appendLog(`return: ${value}, shift+return: ${value === "submit" ? "newline" : "submit"}`);
  }, [appendLog]);

  const handleEnterAction = useCallback((value: string) => {
    setEnterAction(value as InputAction);
    appendLog(`numpad enter: ${value}, shift+enter: ${value === "submit" ? "newline" : "submit"}`);
  }, [appendLog]);

  // --- Test harness ---

  const runAllTests = useCallback(() => {
    const delegate = testInputRef.current;
    if (!delegate) return;
    delegate.focus();
    const results: TestResult[] = [];

    // Run TEOE tests
    const teoes = allTEOEs();
    for (const teoe of teoes) {
      delegate.clear();
      try {
        results.push(runTEOE(delegate, teoe));
      } catch (err) {
        results.push({
          name: teoe.name,
          passed: false,
          expected: formatEditingState(teoe.expected),
          actual: `Error: ${err}`,
        });
      }
    }

    // Run scenario tests (mixed typing + API sequences)
    for (const tc of TEST_CASES) {
      delegate.clear();
      try {
        results.push(tc.run(delegate));
      } catch (err) {
        results.push({
          name: tc.name,
          passed: false,
          expected: "(no error)",
          actual: `Error: ${err}`,
        });
      }
    }

    delegate.clear();
    setTestResults(results);
  }, []);

  const runIME = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    const imeResults = runIMETests(delegate);
    const mapped: TestResult[] = imeResults.results.map(r => ({
      name: r.name,
      passed: r.passed,
      expected: "",
      actual: r.detail,
    }));
    setTestResults(mapped);
  }, []);

  const passCount = testResults.filter(r => r.passed).length;
  const failCount = testResults.filter(r => !r.passed).length;

  return (
    <div className="cg-content" data-testid="gallery-prompt-input">

      {/* ---- IMG Atom Spike ---- */}
      <style dangerouslySetInnerHTML={{ __html: `
        .spike-editor ::selection, .spike-editor::selection {
          background-color: Highlight;
          color: HighlightText;
        }
        .spike-editor::highlight(card-selection),
        .spike-editor ::highlight(card-selection) {
          background-color: transparent !important;
          color: inherit !important;
        }
        .spike-editor::highlight(inactive-selection),
        .spike-editor ::highlight(inactive-selection) {
          background-color: transparent !important;
          color: inherit !important;
        }
      `}} />
      <div className="cg-section">
        <div className="cg-section-title">IMG Atom Spike</div>
        <div className="prompt-input-toolbar">
          <TugPushButton size="sm" onClick={() => {
            const spikeEl = document.getElementById("spike-editor");
            if (!spikeEl) return;
            spikeEl.focus();
            const atoms = [
              { type: "file", label: "src/main.ts" },
              { type: "file", label: "README.md" },
              { type: "file", label: "feed-store.ts" },
              { type: "command", label: "/commit" },
              { type: "doc", label: "design-doc.md" },
              { type: "link", label: "https://example.com" },
            ];
            const atom = atoms[Math.floor(Math.random() * atoms.length)];
            const img = createAtomImgElement(atom.type, atom.label, atom.label);
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(img);
              range.setStartAfter(img);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }}>Insert Atom</TugPushButton>
        </div>
        <div
          id="spike-editor"
          ref={(el) => {
            if (!el || (el as any).__spikeSetup) return;
            (el as any).__spikeSetup = true;

            // Copy/Cut: write atom HTML + plain text to clipboard
            el.addEventListener("copy", (e) => {
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0) return;
              const range = sel.getRangeAt(0);
              const fragment = range.cloneContents();

              // Build HTML representation (preserves atom img tags with data attributes)
              const wrapper = document.createElement("div");
              wrapper.appendChild(fragment);
              const html = wrapper.innerHTML;

              // Build plain text: replace atom imgs with their label
              const plainWrapper = wrapper.cloneNode(true) as HTMLElement;
              plainWrapper.querySelectorAll("img[data-atom-label]").forEach((img) => {
                const text = document.createTextNode((img as HTMLImageElement).dataset.atomLabel || "");
                img.parentNode?.replaceChild(text, img);
              });
              const plain = plainWrapper.textContent || "";

              e.clipboardData?.setData("text/html", html);
              e.clipboardData?.setData("text/plain", plain);
              e.preventDefault();
            });

            el.addEventListener("cut", (e) => {
              // Write to clipboard (same as copy)
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0) return;
              const range = sel.getRangeAt(0);
              const fragment = range.cloneContents();
              const wrapper = document.createElement("div");
              wrapper.appendChild(fragment);
              const html = wrapper.innerHTML;
              const plainWrapper = wrapper.cloneNode(true) as HTMLElement;
              plainWrapper.querySelectorAll("img[data-atom-label]").forEach((img) => {
                const text = document.createTextNode((img as HTMLImageElement).dataset.atomLabel || "");
                img.parentNode?.replaceChild(text, img);
              });
              e.clipboardData?.setData("text/html", html);
              e.clipboardData?.setData("text/plain", plainWrapper.textContent || "");
              e.preventDefault();
              // Delete via execCommand so it's on the undo stack
              document.execCommand("delete");
            });

            // Paste: if clipboard has our atoms, insert them via insertHTML
            // (undoable). Otherwise let browser handle natively.
            el.addEventListener("paste", (e) => {
              console.log("SPIKE PASTE FIRED");
              console.log("  types:", Array.from(e.clipboardData?.types || []));
              const html = e.clipboardData?.getData("text/html") || "";
              const plain = e.clipboardData?.getData("text/plain") || "";
              console.log("  html length:", html.length, "has atom:", html.includes("data-atom-label"));
              console.log("  html:", html.slice(0, 300));
              console.log("  plain:", plain);
              if (!html.includes("data-atom-label")) {
                console.log("  → no atoms, letting browser handle");
                return;
              }
              e.preventDefault();
              const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
              const content = match ? match[1] : html;
              // Try inserting the atom HTML directly (no blob conversion)
              document.execCommand("insertHTML", false, content);
            }, true);
          }}
          contentEditable
          suppressContentEditableWarning
          className="spike-editor"
          style={{ padding: "12px", fontSize: "14px", lineHeight: "24px", outline: "none", background: "#252a34", color: "#c8d0dc", borderRadius: "6px", border: "1px solid #4a5568" }}
          dangerouslySetInnerHTML={{ __html:
            `hello ${atomImgHTML("file", "src/main.ts")} world<br>line two ${atomImgHTML("file", "feed-store.ts")}<br>line three ${atomImgHTML("command", "/commit")}`
          }}
        />
      </div>

      <div className="cg-divider" />

      {/* ---- Interactive Editor ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Editor</div>
        <div className="prompt-input-toolbar">
          <TugPushButton size="sm" onClick={handleInsertAtom}>Insert Atom</TugPushButton>
          <TugPushButton size="sm" emphasis="outlined" onClick={handleClear}>Clear</TugPushButton>
        </div>
        <div ref={containerRef} className="prompt-input-container">
          <TugPromptInput
            ref={inputRef}
            placeholder="Type here... @ for file completion, drag files, test IME, Return vs Enter"
            maxRows={8}
            returnAction={returnAction}
            numpadEnterAction={enterAction}
            onSubmit={handleSubmit}
            onChange={handleChange}
            onLog={appendLog}
            completionProvider={galleryCompletionProvider}
            onTypeaheadChange={handleTypeaheadChange}
            dropHandler={galleryDropHandler}
          />
          <div ref={popupRef} className="prompt-input-typeahead-popup" />
        </div>
        <pre ref={diagRef} className="prompt-input-diagnostics" />
      </div>

      <div className="cg-divider" />

      {/* ---- Key Configuration ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Key Configuration</div>
        <div className="prompt-input-key-config">
          <div className="prompt-input-key-config-row">
            <span className="prompt-input-key-config-label">Return (main keyboard):</span>
            <TugChoiceGroup items={RETURN_CHOICES} value={returnAction} size="sm" onValueChange={handleReturnAction} />
          </div>
          <div className="prompt-input-key-config-row">
            <span className="prompt-input-key-config-label">Enter (numpad):</span>
            <TugChoiceGroup items={ENTER_CHOICES} value={enterAction} size="sm" onValueChange={handleEnterAction} />
          </div>
          <div className="prompt-input-desc">
            Shift always inverts. hasMarkedText=true → key goes to IME.
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Event Log ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Event Log</div>
        <div className="prompt-input-toolbar" style={{ marginBottom: "4px" }}>
          <TugPushButton size="sm" emphasis="ghost" onClick={clearLog}>Clear Log</TugPushButton>
          <TugPushButton size="sm" emphasis="ghost" onClick={copyLog}>Copy Log</TugPushButton>
        </div>
        <div ref={logRef} className="prompt-input-log" />
      </div>

      <div className="cg-divider" />

      {/* ---- Automated Test Harness ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Test Harness</div>
        <div className="prompt-input-desc" style={{ marginBottom: "8px" }}>
          TEOE tests: incoming state → operation → compare outgoing state.
          Typing uses execCommand (browser editing pipeline).
          All other operations use delegate API.
        </div>
        <div className="prompt-input-toolbar" style={{ marginBottom: "8px" }}>
          <TugPushButton size="sm" onClick={runAllTests}>Run All Tests</TugPushButton>
          <TugPushButton size="sm" emphasis="outlined" onClick={runIME}>Run IME Tests</TugPushButton>
          {testResults.length > 0 && (
            <>
              <TugBadge role="success" emphasis="tinted" icon={<CircleCheck size={12} />}>{passCount} passed</TugBadge>
              {failCount > 0 && (
                <TugBadge role="danger" emphasis="tinted" icon={<CircleX size={12} />}>{failCount} failed</TugBadge>
              )}
            </>
          )}
        </div>

        {/* Test editor — visually hidden but with real layout so execCommand works */}
        <div style={{ position: "fixed", top: "-200px", left: 0, width: "400px", height: "100px" }}>
          <TugPromptInput ref={testInputRef} placeholder="" maxRows={2} persistState={false} />
        </div>

        {testResults.length > 0 && (
          <TugAccordion type="multiple" variant="outline">
            {testResults.map((r, i) => (
              <TugAccordionItem
                key={i}
                value={`test-${i}`}
                trigger={
                  <span className="prompt-input-test-trigger">
                    {r.passed
                      ? <CircleCheck size={14} style={{ color: "var(--tug7-element-global-text-normal-success-rest)" }} />
                      : <CircleX size={14} style={{ color: "var(--tug7-element-global-text-normal-danger-rest)" }} />
                    }
                    {r.name}
                  </span>
                }
              >
                <div className="prompt-input-test-detail">
                  <div><strong>Expected:</strong> {r.expected}</div>
                  <div><strong>Actual:</strong> {r.actual}</div>
                </div>
              </TugAccordionItem>
            ))}
          </TugAccordion>
        )}
      </div>

    </div>
  );
}
