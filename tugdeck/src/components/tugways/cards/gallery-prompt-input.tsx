/**
 * gallery-prompt-input.tsx -- TugTextEngine + tug-atom gallery card.
 *
 * Testing surface for the ported TugTextEngine with tug-atom integration.
 * Mirrors the spike's testing UI (editor, diagnostics, key config, event
 * log, insert atom, clear) but uses the real engine from lib/tug-text-engine
 * and tug-atom's createAtomDOM for atom rendering.
 *
 * Laws of Tug compliance:
 *   [L01] One root.render() at mount — engine runs in DOM zone after that
 *   [L06] All text/atom rendering via direct DOM manipulation, no React state
 *   [L07] Engine is a stable ref; handlers access current state via `this`
 *   [L22] Engine is the store; DOM updates happen directly, no React cycle
 */

import React, { useRef, useLayoutEffect, useCallback, useState } from "react";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { TugTextEngine } from "@/lib/tug-text-engine";
import type { TextSegment, AtomSegment, InputAction, CompletionItem } from "@/lib/tug-text-engine";
import "./gallery-prompt-input.css";

// ===================================================================
// Constants
// ===================================================================

const MAX_ROWS = 8;
const LINE_HEIGHT = 21;
const PADDING_Y = 14;
const MAX_HEIGHT = LINE_HEIGHT * MAX_ROWS + PADDING_Y;

const SAMPLE_ATOMS: AtomSegment[] = [
  { kind: "atom", type: "file", label: "src/main.ts", value: "/project/src/main.ts" },
  { kind: "atom", type: "file", label: "README.md", value: "/project/README.md" },
  { kind: "atom", type: "command", label: "/commit", value: "/commit" },
  { kind: "atom", type: "file", label: "src/lib/feed-store.ts", value: "/project/src/lib/feed-store.ts" },
];

const TYPEAHEAD_FILES = [
  "src/main.ts", "src/main.tsx", "src/protocol.ts", "src/connection.ts",
  "src/lib/feed-store.ts", "src/lib/connection-singleton.ts",
  "src/deck-manager.ts", "src/settings-api.ts", "src/action-dispatch.ts",
  "README.md", "package.json", "tsconfig.json",
];

/** Fake completion provider for gallery testing. */
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

/** Fake drop handler for gallery testing. */
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

// ===================================================================
// PromptInputEditor — React wrapper [L01]
// ===================================================================

function PromptInputEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TugTextEngine | null>(null);
  const diagRef = useRef<HTMLPreElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const nextAtomIdx = useRef(0);
  const [returnAction, setReturnAction] = useState<string>("submit");
  const [enterAction, setEnterAction] = useState<string>("submit");

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

  // Diagnostics — direct DOM write [L06]
  const updateDiagnostics = useCallback(() => {
    const engine = engineRef.current;
    const el = diagRef.current;
    if (!engine || !el) return;

    const range = engine.getSelectedRange();
    const rangeStr = range
      ? (range.start === range.end
        ? `{${range.start}}` : `{${range.start}, ${range.end}}`)
      : "null";
    const collapsed = range ? range.start === range.end : false;
    const atoms = engine.getAtoms();
    const segDesc = engine.segments.map(s =>
      s.kind === "text"
        ? `text(${JSON.stringify((s as TextSegment).text).slice(0, 20)})`
        : `atom(${(s as AtomSegment).label})`
    ).join(" ");

    el.textContent = [
      `selectedRange: ${rangeStr}${collapsed ? " (collapsed)" : ""}`,
      `hasMarkedText: ${engine.hasMarkedText}`,
      `canUndo: ${engine.canUndo}`,
      `canRedo: ${engine.canRedo}`,
      `flatLength: ${engine.flatLength()} | atoms: ${atoms.length} | height: ${engine.root.offsetHeight}px`,
      `segments: ${segDesc}`,
    ].join("\n");
  }, []);

  // Mount engine once [L01]
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || engineRef.current) return;

    const engine = new TugTextEngine(el);
    engine.maxHeight = MAX_HEIGHT;
    engine.completionProvider = galleryCompletionProvider;
    engine.dropHandler = galleryDropHandler;
    engine.onChange = updateDiagnostics;
    engine.onLog = appendLog;
    engine.onTypeaheadChange = (active, filtered, selectedIndex) => {
      const popup = popupRef.current;
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
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const editorRect = el.getBoundingClientRect();
        popup.style.left = `${rect.left - editorRect.left}px`;
        popup.style.bottom = `${editorRect.bottom - rect.top + 4}px`;
      }
    };
    engine.onSubmit = () => {
      const text = engine.getText().trim();
      const atoms = engine.getAtoms().map(a => a.label);
      appendLog(`submit: "${text}" atoms=[${atoms.join(", ")}]`);
      engine.clear();
    };
    engineRef.current = engine;

    const onSelChange = () => {
      if (el.contains(document.activeElement)) updateDiagnostics();
    };
    document.addEventListener("selectionchange", onSelChange);

    updateDiagnostics();
    return () => {
      document.removeEventListener("selectionchange", onSelChange);
      engine.teardown();
      engineRef.current = null;
    };
  }, [updateDiagnostics, appendLog]);

  // Sync key config to engine [L07]
  useLayoutEffect(() => {
    if (engineRef.current) {
      engineRef.current.returnAction = returnAction as InputAction;
    }
  }, [returnAction]);

  useLayoutEffect(() => {
    if (engineRef.current) {
      engineRef.current.numpadEnterAction = enterAction as InputAction;
    }
  }, [enterAction]);

  const handleInsertAtom = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const atom = SAMPLE_ATOMS[nextAtomIdx.current % SAMPLE_ATOMS.length];
    nextAtomIdx.current++;
    engine.root.focus();
    engine.insertAtom(atom);
  }, []);

  const handleClear = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.root.focus();
    engine.clear();
  }, []);

  const handleReturnAction = useCallback((value: string) => {
    setReturnAction(value);
    appendLog(`return: ${value}, shift+return: ${value === "submit" ? "newline" : "submit"}`);
  }, [appendLog]);

  const handleEnterAction = useCallback((value: string) => {
    setEnterAction(value);
    appendLog(`numpad enter: ${value}, shift+enter: ${value === "submit" ? "newline" : "submit"}`);
  }, [appendLog]);

  return (
    <div className="cg-content" data-testid="gallery-prompt-input">

      <div className="cg-section">
        <div className="cg-section-title">Editor</div>
        <div className="prompt-input-toolbar">
          <TugPushButton size="sm" onClick={handleInsertAtom}>Insert Atom</TugPushButton>
          <TugPushButton size="sm" emphasis="outlined" onClick={handleClear}>Clear</TugPushButton>
        </div>
        <div className="prompt-input-container">
          <div
            ref={editorRef}
            className="prompt-input-editor"
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Prompt input editor"
            data-placeholder="Type here... @ for file completion, drag files, test IME, Return vs Enter"
            data-empty="true"
            data-td-select="custom"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            suppressContentEditableWarning
          />
          <div ref={popupRef} className="prompt-input-typeahead-popup" />
        </div>
        <pre ref={diagRef} className="prompt-input-diagnostics" />
      </div>

      <div className="cg-divider" />

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

      <div className="cg-section">
        <div className="cg-section-title">Event Log</div>
        <div ref={logRef} className="prompt-input-log" />
      </div>

    </div>
  );
}

// ===================================================================
// Export
// ===================================================================

export function GalleryPromptInput() {
  return <PromptInputEditor />;
}
