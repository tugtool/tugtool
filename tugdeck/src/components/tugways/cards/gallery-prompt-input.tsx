/**
 * gallery-prompt-input.tsx -- TugPromptInput gallery card.
 *
 * Testing surface for the tug-prompt-input component. Includes:
 * - Interactive editor with atom insertion, typeahead, drag-and-drop
 * - Key configuration for Return/Enter
 * - Session history via Cmd+Up/Down
 *
 * Laws of Tug compliance:
 *   [L01] One root.render() at mount — component manages engine internally
 *   [L06] Appearance via CSS and DOM, never React state
 */

import React, { useRef, useCallback, useState } from "react";
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/components/tugways/tug-prompt-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import type { AtomSegment, InputAction, CompletionItem, HistoryProvider, TugTextEditingState } from "@/lib/tug-text-engine";
import "./gallery-prompt-input.css";

// ===================================================================
// Sample data
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

function galleryFileCompletionProvider(query: string): CompletionItem[] {
  const q = query.toLowerCase();
  const files = q.length === 0
    ? TYPEAHEAD_FILES.slice(0, 8)
    : TYPEAHEAD_FILES.filter(f => f.toLowerCase().includes(q)).slice(0, 8);
  return files.map(f => ({
    label: f,
    atom: { kind: "atom" as const, type: "file", label: f, value: f },
  }));
}

const TYPEAHEAD_COMMANDS = [
  "/commit", "/review", "/help", "/clear", "/plan",
  "/implement", "/dash", "/compact", "/memory",
];

function galleryCommandCompletionProvider(query: string): CompletionItem[] {
  const q = query.toLowerCase();
  const cmds = q.length === 0
    ? TYPEAHEAD_COMMANDS.slice(0, 8)
    : TYPEAHEAD_COMMANDS.filter(c => c.toLowerCase().includes(q)).slice(0, 8);
  return cmds.map(c => ({
    label: c,
    atom: { kind: "atom" as const, type: "command", label: c, value: c },
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
  { value: "submit", label: "Submits" },
  { value: "newline", label: "Newline" },
];

const ENTER_CHOICES: TugChoiceItem[] = [
  { value: "submit", label: "Submits" },
  { value: "newline", label: "Newline" },
];

// ===================================================================
// Mock history provider — session-scoped, plain object [L06]
// ===================================================================

class GalleryHistoryProvider implements HistoryProvider {
  private entries: TugTextEditingState[] = [];
  private cursor = -1; // -1 = at draft (current typing)
  private draft: TugTextEditingState = { text: "", atoms: [], selection: null };

  push(state: TugTextEditingState): void {
    this.entries.push(state);
    this.cursor = -1;
  }

  back(current: TugTextEditingState): TugTextEditingState | null {
    if (this.entries.length === 0) return null;
    if (this.cursor === -1) {
      this.draft = current;
      this.cursor = this.entries.length - 1;
    } else if (this.cursor > 0) {
      this.cursor--;
    } else {
      return null;
    }
    return this.entries[this.cursor];
  }

  forward(): TugTextEditingState | null {
    if (this.cursor === -1) return null;
    if (this.cursor < this.entries.length - 1) {
      this.cursor++;
      return this.entries[this.cursor];
    }
    this.cursor = -1;
    return this.draft;
  }
}

// ===================================================================
// Gallery component
// ===================================================================

export function GalleryPromptInput() {
  const inputRef = useRef<TugTextInputDelegate>(null);
  const nextAtomIdx = useRef(0);
  const historyRef = useRef(new GalleryHistoryProvider());
  const [returnAction, setReturnAction] = useState<InputAction>("newline");
  const [enterAction, setEnterAction] = useState<InputAction>("submit");

  const handleSubmit = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    if (!delegate.isEmpty()) {
      historyRef.current.push(delegate.captureState());
    }
    delegate.clear();
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
  }, []);

  const handleEnterAction = useCallback((value: string) => {
    setEnterAction(value as InputAction);
  }, []);

  return (
    <div className="cg-content" data-testid="gallery-prompt-input">

      {/* ---- Interactive Editor ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Editor</div>
        <div className="prompt-input-toolbar">
          <TugPushButton size="sm" onClick={handleInsertAtom}>Insert Atom</TugPushButton>
          <TugPushButton size="sm" emphasis="outlined" onClick={handleClear}>Clear</TugPushButton>
        </div>
        <TugPromptInput
          ref={inputRef}
          placeholder="Type here... @ for file, / for command, drag files, test IME, Return vs Enter"
          maxRows={8}
          returnAction={returnAction}
          numpadEnterAction={enterAction}
          onSubmit={handleSubmit}
          completionProviders={{
            "@": galleryFileCompletionProvider,
            "/": galleryCommandCompletionProvider,
          }}
          historyProvider={historyRef.current}
          dropHandler={galleryDropHandler}
        />
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

    </div>
  );
}
