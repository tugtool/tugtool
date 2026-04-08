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

import React, { useRef, useCallback, useMemo, useState, useLayoutEffect, useSyncExternalStore } from "react";
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/components/tugways/tug-prompt-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupMenuItem } from "@/components/tugways/tug-popup-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import type { AtomSegment, CompletionProvider, HistoryProvider, InputAction } from "@/lib/tug-text-engine";
import { EditorSettingsStore } from "@/lib/editor-settings-store";
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

function galleryDropHandler(files: FileList): AtomSegment[] {
  const atoms: AtomSegment[] = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i].name;
    atoms.push({ kind: "atom", type: "file", label: name, value: name });
  }
  return atoms;
}

// ===================================================================
// Editor font options
// ===================================================================

const EDITOR_FONT_OPTIONS: TugPopupMenuItem[] = [
  { id: "plex-sans", label: "IBM Plex Sans" },
  { id: "inter", label: "Inter" },
  { id: "hack", label: "Hack (mono)" },
];

const FONT_SIZE_OPTIONS: TugPopupMenuItem[] = [
  { id: "11", label: "11 px" },
  { id: "12", label: "12 px" },
  { id: "13", label: "13 px" },
  { id: "14", label: "14 px" },
  { id: "15", label: "15 px" },
  { id: "16", label: "16 px" },
  { id: "18", label: "18 px" },
];

const LETTER_SPACING_OPTIONS: TugPopupMenuItem[] = [
  { id: "-0.25", label: "-0.25 px" },
  { id: "-0.15", label: "-0.15 px" },
  { id: "-0.10", label: "-0.10 px" },
  { id: "-0.05", label: "-0.05 px" },
  { id: "0", label: "Normal" },
];

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
 * Build store instances for this card's prompt input.
 *
 * Each card owns its stores. Today there is one global connection;
 * in the future the connection (or project root) will be card-level.
 */
function buildCardStores(): {
  metadataStore: SessionMetadataStore;
  historyStore: PromptHistoryStore;
} {
  const historyStore = new PromptHistoryStore();
  const connection = getConnection()!;
  const metaFeedStore = new FeedStore(connection, [FeedId.SESSION_METADATA]);
  const metadataStore = new SessionMetadataStore(metaFeedStore, FeedId.SESSION_METADATA);
  return { metadataStore, historyStore };
}

interface CardPromptServices {
  commandCompletionProvider: CompletionProvider;
  historyStore: PromptHistoryStore;
  historyProvider: HistoryProvider;
}

let _cardServices: CardPromptServices | null = null;

function getCardServices(): CardPromptServices {
  if (!_cardServices) {
    const { metadataStore, historyStore } = buildCardStores();
    _cardServices = {
      commandCompletionProvider: metadataStore.getCommandCompletionProvider(),
      historyStore,
      historyProvider: historyStore.createProvider(GALLERY_SESSION_ID),
    };
  }
  return _cardServices;
}

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
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const [returnAction, setReturnAction] = useState<InputAction>("newline");
  const [enterAction, setEnterAction] = useState<InputAction>("submit");
  const [maximized, setMaximized] = useState(false);

  // Editor settings store — constructed lazily, once per card. [L02, L06, L22]
  const editorStoreRef = useRef<EditorSettingsStore | null>(null);
  if (!editorStoreRef.current) editorStoreRef.current = new EditorSettingsStore();
  const editorStore = editorStoreRef.current;

  // Popup button labels observe the store via useSyncExternalStore. [L02]
  const editorSettings = useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot);

  // Bind the store to the editor wrapper DOM element so CSS properties
  // are applied directly, and atoms regenerate on change. [L06, L22, L23]
  useLayoutEffect(() => {
    const el = editorWrapRef.current;
    if (!el) return;
    editorStore.bind(el, () => inputRef.current?.regenerateAtoms());
    return () => editorStore.unbind();
  }, [editorStore]);

  // Stable reference — provider functions are cached, no deps change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const completionProviders = useMemo(() => ({
    "@": getFileCompletionProvider(),
    "/": getCardServices().commandCompletionProvider,
  }), []);

  const handleSubmit = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    if (!delegate.isEmpty()) {
      const state = delegate.captureState();
      getCardServices().historyStore.push({
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

  const handleFontChange = useCallback((id: string) => {
    editorStore.set({ fontId: id });
  }, [editorStore]);

  const handleFontSizeChange = useCallback((id: string) => {
    editorStore.set({ fontSize: parseInt(id, 10) });
  }, [editorStore]);

  const handleLetterSpacingChange = useCallback((id: string) => {
    editorStore.set({ letterSpacing: parseFloat(id) });
  }, [editorStore]);

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
            <TugPopupButton
              label={EDITOR_FONT_OPTIONS.find(f => f.id === editorSettings.fontId)?.label ?? "Font"}
              items={EDITOR_FONT_OPTIONS}
              onSelect={handleFontChange}
              size="sm"
            />
            <TugPopupButton
              label={`${editorSettings.fontSize}px`}
              items={FONT_SIZE_OPTIONS}
              onSelect={handleFontSizeChange}
              size="sm"
            />
            <TugPopupButton
              label={editorSettings.letterSpacing === 0 ? "Spacing: 0" : `Spacing: ${editorSettings.letterSpacing > 0 ? "+" : ""}${editorSettings.letterSpacing}`}
              items={LETTER_SPACING_OPTIONS}
              onSelect={handleLetterSpacingChange}
              size="sm"
            />
            <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--tug7-element-global-text-normal-muted-rest)" }}>
              Route: <span ref={routeRef} style={{ fontFamily: "var(--tug-font-family-mono)" }}>&gt;</span>
            </span>
          </div>
          <div ref={editorWrapRef}>
          <TugPromptInput
            ref={inputRef}
            placeholder="Type here... @ for file, / for command, drag files, test IME, Return vs Enter"
            maxRows={8}
            maximized={maximized}
            returnAction={returnAction}
            numpadEnterAction={enterAction}
            onSubmit={handleSubmit}
            completionProviders={completionProviders}
            historyProvider={getCardServices().historyProvider}
            dropHandler={galleryDropHandler}
            routePrefixes={[">", "$", ":", "/"]}
            onRouteChange={handleRouteChange}
          />
          </div>
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
