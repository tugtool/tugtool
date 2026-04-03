/**
 * gallery-prompt-input.tsx -- TugPromptInput gallery card.
 *
 * Testing surface for the tug-prompt-input component. Includes:
 * - Interactive editor with diagnostics and event log
 * - Automated test harness with faithful typing simulation
 * - Key configuration for Return/Enter
 *
 * Test approach:
 *   Typing simulation mutates DOM text nodes directly — the same path
 *   the browser uses. MutationObserver fires, engine updates model.
 *   This exercises the real code path, not a shortcut.
 *
 *   Atom insertion, deletion, undo, and selection use delegate API —
 *   the same methods that keyboard handlers call.
 *
 * Laws of Tug compliance:
 *   [L01] One root.render() at mount — component manages engine internally
 *   [L06] Diagnostics and log are direct DOM writes, no React state
 */

import React, { useRef, useLayoutEffect, useCallback, useState } from "react";
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/components/tugways/tug-prompt-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import type { AtomSegment, InputAction, CompletionItem } from "@/lib/tug-text-engine";
import "./gallery-prompt-input.css";

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
// Simulates real typing by mutating DOM text nodes directly, then
// letting MutationObserver pick up the change — the same path the
// browser uses for real keystrokes. This is NOT a shortcut through
// the delegate API; it exercises the actual MutationObserver → engine
// update path.
// ===================================================================

/**
 * Type a string into the editor by mutating the DOM text node at the
 * current caret position. MutationObserver picks up the change.
 */
function simulateTyping(el: HTMLElement, text: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const { anchorNode, anchorOffset } = sel;
  if (!anchorNode || !el.contains(anchorNode)) return;

  if (anchorNode instanceof Text) {
    // Splice text into the existing text node
    const before = anchorNode.textContent?.slice(0, anchorOffset) ?? "";
    const after = anchorNode.textContent?.slice(anchorOffset) ?? "";
    anchorNode.textContent = before + text + after;
    // Move caret to after the inserted text
    sel.collapse(anchorNode, anchorOffset + text.length);
  } else if (anchorNode === el) {
    // Caret is at the root level (between child nodes).
    // Insert a new text node or append to adjacent text node.
    const childAtOffset = el.childNodes[anchorOffset];
    if (childAtOffset instanceof Text) {
      childAtOffset.textContent = text + (childAtOffset.textContent ?? "");
      sel.collapse(childAtOffset, text.length);
    } else {
      const textNode = document.createTextNode(text);
      if (childAtOffset) {
        el.insertBefore(textNode, childAtOffset);
      } else {
        el.appendChild(textNode);
      }
      sel.collapse(textNode, text.length);
    }
  }
  // MutationObserver will fire asynchronously and update the engine model.
  // For synchronous test assertions, we need to flush the observer.
}

/**
 * Flush pending MutationObserver callbacks synchronously.
 * The observer batches mutations and delivers them asynchronously.
 * This forces immediate delivery so tests can assert synchronously.
 */
function flushMutations(el: HTMLElement): void {
  // Reading offsetHeight forces a synchronous layout, which triggers
  // pending mutation records to be delivered.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.offsetHeight;
}

/**
 * Type text into the editor and flush mutations synchronously.
 */
function typeText(d: TugTextInputDelegate, text: string): void {
  const el = d.getEditorElement();
  if (!el) return;
  simulateTyping(el, text);
  flushMutations(el);
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

  const passCount = testResults.filter(r => r.passed).length;
  const failCount = testResults.filter(r => !r.passed).length;

  return (
    <div className="cg-content" data-testid="gallery-prompt-input">

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
          Typing simulation mutates DOM text nodes directly — the same path
          the browser uses. MutationObserver fires, engine updates model.
          Atom insertion and actions use delegate API.
        </div>
        <div className="prompt-input-toolbar" style={{ marginBottom: "8px" }}>
          <TugPushButton size="sm" onClick={runAllTests}>Run All Tests</TugPushButton>
          {testResults.length > 0 && (
            <span className="prompt-input-test-summary">
              {passCount} passed, {failCount} failed
            </span>
          )}
        </div>

        {/* Test editor — visible so it can focus, dimmed to indicate non-interactive */}
        <div className="prompt-input-test-editor">
          <TugPromptInput ref={testInputRef} placeholder="" maxRows={2} />
        </div>

        {testResults.length > 0 && (
          <TugAccordion type="multiple" variant="outline">
            {testResults.map((r, i) => (
              <TugAccordionItem
                key={i}
                value={`test-${i}`}
                trigger={
                  <span className={r.passed ? "prompt-input-test-pass" : "prompt-input-test-fail"}>
                    {r.passed ? "PASS" : "FAIL"} — {r.name}
                  </span>
                }
              >
                <div className="prompt-input-test-detail">
                  <div className="prompt-input-test-desc">
                    {TEST_CASES[i].description}
                  </div>
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
