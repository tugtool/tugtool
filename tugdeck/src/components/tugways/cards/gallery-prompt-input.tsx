/**
 * gallery-prompt-input.tsx -- TugPromptInput gallery card.
 *
 * Testing surface for the tug-prompt-input component. Exercises the
 * component with diagnostics, key configuration, typeahead popup,
 * and event logging.
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
import type { AtomSegment, InputAction, CompletionItem } from "@/lib/tug-text-engine";
import "./gallery-prompt-input.css";

// ===================================================================
// Constants
// ===================================================================

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

// ===================================================================
// Gallery component
// ===================================================================

export function GalleryPromptInput() {
  const inputRef = useRef<TugTextInputDelegate>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const diagRef = useRef<HTMLPreElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const nextAtomIdx = useRef(0);
  const [returnAction, setReturnAction] = useState<InputAction>("submit");
  const [enterAction, setEnterAction] = useState<InputAction>("submit");

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

  // Listen for selection changes to update diagnostics
  useLayoutEffect(() => {
    const onSelChange = () => {
      // Update diagnostics whenever selection changes and we have a delegate
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
    // Position near cursor, relative to the container
    const sel = window.getSelection();
    const container = containerRef.current;
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
  }, []);

  const handleReturnAction = useCallback((value: string) => {
    setReturnAction(value as InputAction);
    appendLog(`return: ${value}, shift+return: ${value === "submit" ? "newline" : "submit"}`);
  }, [appendLog]);

  const handleEnterAction = useCallback((value: string) => {
    setEnterAction(value as InputAction);
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
