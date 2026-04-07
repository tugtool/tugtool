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
 *   [L07] Providers are stable refs created once per scope
 */

import React, { useRef, useCallback, useMemo, useState } from "react";
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/components/tugways/tug-prompt-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import type { AtomSegment, CompletionProvider, InputAction } from "@/lib/tug-text-engine";
import { FeedStore } from "@/lib/feed-store";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { getConnection } from "@/lib/connection-singleton";
import { FeedId } from "@/protocol";
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

/** Fallback slash commands seeded when no live connection is available. */
const MOCK_SLASH_COMMANDS = [
  "/commit", "/review", "/help", "/clear", "/plan",
  "/implement", "/dash", "/compact", "/memory",
];

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

// Fixed session ID for gallery use (no live session).
const GALLERY_SESSION_ID = "gallery-mock-session";

// ===================================================================
// Store construction (module-level, constructed once)
// ===================================================================

/**
 * Build store instances for the gallery card.
 *
 * If a live connection is available, wires SessionMetadataStore to the real
 * FeedStore so it picks up system_metadata events. Otherwise, seeds the store
 * with mock slash commands via a synthetic FeedStore-like mock. [D05]
 *
 * PromptHistoryStore always works — in-memory only when tugbank is unavailable.
 */
function buildGalleryStores(): {
  metadataStore: SessionMetadataStore | null;
  historyStore: PromptHistoryStore;
} {
  const historyStore = new PromptHistoryStore();
  const connection = getConnection();

  if (connection !== null) {
    const feedStore = new FeedStore(connection, [FeedId.CODE_OUTPUT]);
    const metadataStore = new SessionMetadataStore(feedStore, FeedId.CODE_OUTPUT);
    return { metadataStore, historyStore };
  }

  return { metadataStore: null, historyStore };
}

const { metadataStore: _metadataStore, historyStore: _historyStore } = buildGalleryStores();

/**
 * Completion provider for the / trigger.
 *
 * Uses the live SessionMetadataStore when available. Falls back to mock
 * slash command list when no connection exists. [D05]
 */
const galleryCommandCompletionProvider = _metadataStore !== null
  ? _metadataStore.getCommandCompletionProvider()
  : (query: string) => {
      const q = query.toLowerCase();
      const cmds = q.length === 0
        ? MOCK_SLASH_COMMANDS.slice(0, 8)
        : MOCK_SLASH_COMMANDS.filter(c => c.toLowerCase().includes(q)).slice(0, 8);
      return cmds.map(c => ({
        label: c,
        atom: { kind: "atom" as const, type: "command", label: c, value: c },
      }));
    };

/** History provider scoped to the gallery mock session. */
const galleryHistoryProvider = _historyStore.createProvider(GALLERY_SESSION_ID);

/**
 * Create a FileTreeStore lazily — the connection is guaranteed to exist at
 * component mount time but NOT at module-scope import time.
 */
let _fileTreeStore: FileTreeStore | null = null;
let _fileCompletionProvider: CompletionProvider | null = null;

function getFileCompletionProvider(): CompletionProvider {
  if (_fileCompletionProvider) return _fileCompletionProvider;
  const connection = getConnection();
  if (connection) {
    const feedStore = new FeedStore(connection, [FeedId.FILETREE]);
    _fileTreeStore = new FileTreeStore(feedStore, FeedId.FILETREE);
    _fileCompletionProvider = _fileTreeStore.getFileCompletionProvider();
    return _fileCompletionProvider;
  }
  // Defensive fallback — connection should always exist at render time.
  console.warn("FileTreeStore: connection not available at render time");
  return ((_q: string) => []) as CompletionProvider;
}

// ===================================================================
// Gallery component
// ===================================================================

export function GalleryPromptInput() {
  const inputRef = useRef<TugTextInputDelegate>(null);
  const nextAtomIdx = useRef(0);
  const routeRef = useRef<HTMLSpanElement>(null);
  const [returnAction, setReturnAction] = useState<InputAction>("newline");
  const [enterAction, setEnterAction] = useState<InputAction>("submit");
  const [maximized, setMaximized] = useState(false);

  // Stable reference — provider functions are cached, no deps change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const completionProviders = useMemo(() => ({
    "@": getFileCompletionProvider(),
    "/": galleryCommandCompletionProvider,
  }), []);

  const handleSubmit = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    if (!delegate.isEmpty()) {
      const state = delegate.captureState();
      _historyStore.push({
        id: `${GALLERY_SESSION_ID}-${Date.now()}`,
        sessionId: GALLERY_SESSION_ID,
        projectPath: "",
        route: "",
        text: state.text,
        atoms: state.atoms.map(a => ({
          position: a.position,
          type: a.type,
          label: a.label,
          value: a.value,
        })),
        timestamp: Date.now(),
      });
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

  const handleRouteChange = useCallback((route: string | null) => {
    if (routeRef.current) routeRef.current.textContent = route ?? "none";
  }, []);

  return (
    <div className="cg-content" data-testid="gallery-prompt-input">

      {/* ---- Interactive Editor ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Editor</div>
        <div style={maximized ? { display: "flex", flexDirection: "column" as const, height: "300px", gap: "8px" } : undefined}>
          <div className="prompt-input-toolbar">
            <TugPushButton size="sm" onClick={handleInsertAtom}>Insert Atom</TugPushButton>
            <TugPushButton size="sm" emphasis="outlined" onClick={handleClear}>Clear</TugPushButton>
            <TugPushButton size="sm" emphasis="ghost" onClick={() => setMaximized((m: boolean) => !m)}>
              {maximized ? "Minimize" : "Maximize"}
            </TugPushButton>
            <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--tug7-element-global-text-normal-muted-rest)" }}>
              Route: <span ref={routeRef} style={{ fontFamily: "var(--tug-font-mono)" }}>&gt;</span>
            </span>
          </div>
          <TugPromptInput
            ref={inputRef}
            placeholder="Type here... @ for file, / for command, drag files, test IME, Return vs Enter"
            maxRows={8}
            maximized={maximized}
            returnAction={returnAction}
            numpadEnterAction={enterAction}
            onSubmit={handleSubmit}
            completionProviders={completionProviders}
            historyProvider={galleryHistoryProvider}
            dropHandler={galleryDropHandler}
            routePrefixes={[">", "$", ":", "/"]}
            onRouteChange={handleRouteChange}
          />
        </div>
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
