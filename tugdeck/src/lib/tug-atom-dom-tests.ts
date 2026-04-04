/**
 * Atom DOM Test Suite
 *
 * Browser-level tests that verify the atom DOM structure interacts correctly
 * with WebKit's caret movement, selection, and editing. These tests run in
 * the browser via /api/eval and verify the ground truth discovered during
 * the U+E100 atom architecture spike (2026-04-03).
 *
 * These are NOT engine tests (those are TEOEs). These test the raw browser
 * behavior with our chosen DOM structure, independent of the engine.
 *
 * Run via: window.__runAtomDOMTests()
 */

import { TUG_ATOM_CHAR } from "./tug-atom-char";
export { TUG_ATOM_CHAR };

export interface AtomDOMTestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

/**
 * Create a test editor with the atom DOM structure.
 * Returns the editor element and references to key nodes.
 *
 * Structure: "before " + <span[tug-atom]>{ U+E100, <span ce=false>label</span> }</span> + " after"
 */
function createTestEditor(label = "main.rs"): {
  editor: HTMLDivElement;
  t1: Text;
  atom: HTMLSpanElement;
  atomText: Text;
  atomLabel: HTMLSpanElement;
  t2: Text;
} {
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  editor.style.cssText = [
    "-webkit-user-modify: read-write-plaintext-only",
    "white-space: pre-wrap",
    "padding: 8px",
    "min-height: 20px",
    "font-family: monospace",
    "font-size: 14px",
    "position: fixed",
    "top: -500px",
    "left: 0",
    "width: 400px",
  ].join("; ");

  const t1 = document.createTextNode("before ");
  editor.appendChild(t1);

  const atom = document.createElement("span");
  atom.dataset.slot = "tug-atom";
  atom.dataset.atomType = "file";
  atom.dataset.atomLabel = label;
  atom.style.cssText = [
    "display: inline-flex",
    "align-items: center",
    "gap: 3px",
    "padding: 1px 6px",
    "background: #335",
    "border-radius: 3px",
    "color: #aac",
  ].join("; ");

  const atomText = document.createTextNode(TUG_ATOM_CHAR);
  atom.appendChild(atomText);

  const atomLabel = document.createElement("span");
  atomLabel.contentEditable = "false";
  atomLabel.style.cssText = "font-size: 12px; pointer-events: none; -webkit-user-select: none; user-select: none;";
  atomLabel.textContent = label;
  atom.appendChild(atomLabel);

  editor.appendChild(atom);

  const t2 = document.createTextNode(" after");
  editor.appendChild(t2);

  document.body.appendChild(editor);
  return { editor, t1, atom, atomText, atomLabel, t2 };
}

function nodeLabel(
  node: Node | null,
  refs: { t1: Text; atomText: Text; t2: Text },
): string {
  if (!node) return "null";
  if (node === refs.t1) return "t1";
  if (node === refs.atomText) return "atomText";
  if (node === refs.t2) return "t2";
  return node.nodeName;
}

/**
 * Run all atom DOM tests. Returns structured results.
 */
export function runAtomDOMTests(): {
  passed: number;
  failed: number;
  total: number;
  results: AtomDOMTestResult[];
} {
  const results: AtomDOMTestResult[] = [];
  const sel = window.getSelection()!;

  // ── Test: Programmatic span survives read-write-plaintext-only ──

  {
    const { editor, atom } = createTestEditor();
    const spanExists = !!editor.querySelector("[data-slot=tug-atom]");
    results.push({
      name: "Atom span survives -webkit-user-modify: read-write-plaintext-only",
      passed: spanExists,
      expected: "atom span exists in DOM",
      actual: spanExists ? "atom span exists" : "atom span stripped",
    });
    editor.remove();
  }

  // ── Test: Atom has proper layout width ──

  {
    const { editor, atom } = createTestEditor();
    // Move to visible position briefly to measure
    editor.style.top = "0px";
    const width = atom.getBoundingClientRect().width;
    editor.style.top = "-500px";
    results.push({
      name: "Atom span has non-trivial layout width",
      passed: width > 20,
      expected: "> 20px",
      actual: `${width.toFixed(1)}px`,
    });
    editor.remove();
  }

  // ── Test: Left arrow from after atom ──

  {
    const { editor, t1, atomText, t2 } = createTestEditor();
    const refs = { t1, atomText, t2 };
    editor.focus();
    sel.collapse(t2, 0);
    sel.modify("move", "left", "character");
    const node = nodeLabel(sel.anchorNode, refs);
    const offset = sel.anchorOffset;
    results.push({
      name: "Left arrow from after atom → atomText:1",
      passed: node === "atomText" && offset === 1,
      expected: "atomText:1",
      actual: `${node}:${offset}`,
    });
    editor.remove();
  }

  // ── Test: Left arrow twice from after atom ──

  {
    const { editor, t1, atomText, t2 } = createTestEditor();
    const refs = { t1, atomText, t2 };
    editor.focus();
    sel.collapse(t2, 0);
    sel.modify("move", "left", "character");
    sel.modify("move", "left", "character");
    const node = nodeLabel(sel.anchorNode, refs);
    const offset = sel.anchorOffset;
    results.push({
      name: "Left arrow twice from after atom → t1:end",
      passed: node === "t1" && offset === t1.textContent!.length,
      expected: `t1:${t1.textContent!.length}`,
      actual: `${node}:${offset}`,
    });
    editor.remove();
  }

  // ── Test: Right arrow from before atom ──

  {
    const { editor, t1, atomText, t2 } = createTestEditor();
    const refs = { t1, atomText, t2 };
    editor.focus();
    sel.collapse(t1, t1.textContent!.length);
    sel.modify("move", "right", "character");
    const node = nodeLabel(sel.anchorNode, refs);
    const offset = sel.anchorOffset;
    results.push({
      name: "Right arrow from before atom → atomText:1",
      passed: node === "atomText" && offset === 1,
      expected: "atomText:1",
      actual: `${node}:${offset}`,
    });
    editor.remove();
  }

  // ── Test: Right arrow twice from before atom → past atom ──

  {
    const { editor, t1, atomText, t2 } = createTestEditor();
    const refs = { t1, atomText, t2 };
    editor.focus();
    sel.collapse(t1, t1.textContent!.length);
    sel.modify("move", "right", "character");
    sel.modify("move", "right", "character");
    const node = nodeLabel(sel.anchorNode, refs);
    const offset = sel.anchorOffset;
    results.push({
      name: "Right arrow twice from before atom → t2:0",
      passed: node === "t2" && offset === 0,
      expected: "t2:0",
      actual: `${node}:${offset}`,
    });
    editor.remove();
  }

  // ── Test: Shift+right selects across atom ──

  {
    const { editor, t1, atomText, t2 } = createTestEditor();
    const refs = { t1, atomText, t2 };
    editor.focus();
    // Start before the space, extend twice: space + atom
    sel.collapse(t1, t1.textContent!.length - 1);
    sel.modify("extend", "right", "character");
    sel.modify("extend", "right", "character");
    const focusNode = nodeLabel(sel.focusNode, refs);
    const focusOffset = sel.focusOffset;
    const text = sel.toString();
    const hasAtomChar = text.includes(TUG_ATOM_CHAR);
    results.push({
      name: "Shift+right twice from before space selects space + atom",
      passed: hasAtomChar && text.length === 2,
      expected: `selected " ${TUG_ATOM_CHAR}" (length 2)`,
      actual: `selected ${JSON.stringify(text)} (length ${text.length}), focus=${focusNode}:${focusOffset}`,
    });
    editor.remove();
  }

  // ── Test: Shift+left selects atom backward ──

  {
    const { editor, t1, atomText, t2 } = createTestEditor();
    const refs = { t1, atomText, t2 };
    editor.focus();
    // Start after space following atom, extend left 3 times: space + atom + space
    sel.collapse(t2, 1);
    sel.modify("extend", "left", "character");
    sel.modify("extend", "left", "character");
    sel.modify("extend", "left", "character");
    const text = sel.toString();
    const hasAtomChar = text.includes(TUG_ATOM_CHAR);
    results.push({
      name: "Shift+left three times from after atom selects atom + surrounding",
      passed: hasAtomChar && text.length >= 2,
      expected: `contains ${JSON.stringify(TUG_ATOM_CHAR)}`,
      actual: `selected ${JSON.stringify(text)} (length ${text.length})`,
    });
    editor.remove();
  }

  // ── Test: execCommand inserts after atom correctly ──

  {
    const { editor, t1, atomText, t2 } = createTestEditor();
    editor.focus();
    sel.collapse(t2, 0);
    document.execCommand("insertText", false, "X");
    results.push({
      name: "execCommand insertText after atom goes into trailing text",
      passed: t2.textContent === "X after",
      expected: "t2 = \"X after\"",
      actual: `t2 = ${JSON.stringify(t2.textContent)}`,
    });
    editor.remove();
  }

  // ── Test: execCommand at atomText:1 (stray edit detection) ──

  {
    const { editor, t1, atomText, t2 } = createTestEditor();
    editor.focus();
    sel.collapse(atomText, 1);
    document.execCommand("insertText", false, "Z");
    // This WILL insert into atomText — engine must detect and redirect
    const atomHasStray = atomText.textContent !== TUG_ATOM_CHAR;
    results.push({
      name: "Typing at atomText:1 inserts into atom text node (stray edit)",
      passed: atomHasStray,
      expected: "atomText modified (engine must redirect)",
      actual: atomHasStray
        ? `atomText = ${JSON.stringify(atomText.textContent)} (stray detected)`
        : "atomText unchanged",
    });
    editor.remove();
  }

  // ── Test: atom label span is not editable ──

  {
    const { editor, atomLabel } = createTestEditor();
    editor.focus();
    try {
      sel.collapse(atomLabel.firstChild!, 0);
      document.execCommand("insertText", false, "Z");
    } catch {
      // Expected — can't edit ce=false
    }
    const labelUnchanged = atomLabel.textContent === "main.rs";
    results.push({
      name: "Atom label (contentEditable=false) is not editable",
      passed: labelUnchanged,
      expected: "label = \"main.rs\"",
      actual: `label = ${JSON.stringify(atomLabel.textContent)}`,
    });
    editor.remove();
  }

  // ── Test: DOM structure has correct child count ──

  {
    const { editor } = createTestEditor();
    // Should have 3 children: text, atom span, text
    results.push({
      name: "Editor has 3 child nodes: text + atom + text",
      passed: editor.childNodes.length === 3,
      expected: "3",
      actual: String(editor.childNodes.length),
    });
    editor.remove();
  }

  // ── Summary ──

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  return { passed, failed, total: results.length, results };
}
