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

import React, { useRef, useCallback, useMemo, useState, useEffect } from "react";
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/components/tugways/tug-prompt-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupMenuItem } from "@/components/tugways/tug-popup-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import type { AtomSegment, CompletionProvider, InputAction } from "@/lib/tug-text-engine";
import { setAtomFont } from "@/lib/tug-atom-img";
import { FeedStore } from "@/lib/feed-store";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { getConnection } from "@/lib/connection-singleton";
import { FeedId } from "@/protocol";
import { getEditorSettings, putEditorSettings } from "@/settings-api";
import type { EditorSettings } from "@/settings-api";
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

// ===================================================================
// Editor font options
// ===================================================================

const EDITOR_FONT_OPTIONS: TugPopupMenuItem[] = [
  { id: "plex-sans", label: "IBM Plex Sans" },
  { id: "inter", label: "Inter" },
  { id: "hack", label: "Hack (mono)" },
];

const EDITOR_FONT_STACKS: Record<string, string> = {
  "plex-sans": '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  "inter": '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  "hack": '"Hack", "JetBrains Mono", "SFMono-Regular", "Menlo", monospace',
};

/** Default font size per font (mono reads larger than proportional). */
const EDITOR_FONT_DEFAULT_SIZE: Record<string, number> = {
  "plex-sans": 14, "inter": 14, "hack": 13,
};

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

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontId: "hack",
  fontSize: 13,
  letterSpacing: 0,
};

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
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const [returnAction, setReturnAction] = useState<InputAction>("newline");
  const [enterAction, setEnterAction] = useState<InputAction>("submit");
  const [maximized, setMaximized] = useState(false);
  const [editorFont, setEditorFont] = useState(DEFAULT_EDITOR_SETTINGS.fontId);
  const [fontSize, setFontSize] = useState(DEFAULT_EDITOR_SETTINGS.fontSize);
  const [letterSpacing, setLetterSpacing] = useState(DEFAULT_EDITOR_SETTINGS.letterSpacing);

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

  /** Apply all three editor style properties to the wrapper div and update atom font. */
  const applyEditorStyles = useCallback((fontId: string, size: number, spacing: number) => {
    const el = editorWrapRef.current;
    if (!el) return;
    const stack = EDITOR_FONT_STACKS[fontId];
    if (stack) {
      el.style.setProperty("--tug-font-family-editor", stack);
      setAtomFont(stack, size);
    }
    el.style.setProperty("--tug-font-size-editor", `${size}px`);
    el.style.setProperty("--tug-letter-spacing-editor", spacing === 0 ? "normal" : `${spacing}px`);
    inputRef.current?.regenerateAtoms();
  }, []);

  /** Persist current settings to tugbank (fire-and-forget). */
  const persistRef = useRef<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const persist = useCallback(() => {
    putEditorSettings(persistRef.current);
  }, []);

  const handleFontChange = useCallback((id: string) => {
    const size = EDITOR_FONT_DEFAULT_SIZE[id] ?? 13;
    setEditorFont(id);
    setFontSize(size);
    applyEditorStyles(id, size, persistRef.current.letterSpacing);
    persistRef.current = { ...persistRef.current, fontId: id, fontSize: size };
    persist();
  }, [applyEditorStyles, persist]);

  const handleFontSizeChange = useCallback((id: string) => {
    const size = parseInt(id, 10);
    setFontSize(size);
    applyEditorStyles(persistRef.current.fontId, size, persistRef.current.letterSpacing);
    persistRef.current = { ...persistRef.current, fontSize: size };
    persist();
  }, [applyEditorStyles, persist]);

  const handleLetterSpacingChange = useCallback((id: string) => {
    const spacing = parseFloat(id);
    setLetterSpacing(spacing);
    applyEditorStyles(persistRef.current.fontId, persistRef.current.fontSize, spacing);
    persistRef.current = { ...persistRef.current, letterSpacing: spacing };
    persist();
  }, [applyEditorStyles, persist]);

  // Load persisted settings on mount.
  useEffect(() => {
    getEditorSettings().then((saved) => {
      if (!saved) return;
      const fontId = EDITOR_FONT_STACKS[saved.fontId] ? saved.fontId : DEFAULT_EDITOR_SETTINGS.fontId;
      const size = saved.fontSize ?? EDITOR_FONT_DEFAULT_SIZE[fontId] ?? 13;
      const spacing = saved.letterSpacing ?? 0;
      setEditorFont(fontId);
      setFontSize(size);
      setLetterSpacing(spacing);
      persistRef.current = { fontId, fontSize: size, letterSpacing: spacing };
      applyEditorStyles(fontId, size, spacing);
    });
  }, [applyEditorStyles]);

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
              label={EDITOR_FONT_OPTIONS.find(f => f.id === editorFont)?.label ?? "Font"}
              items={EDITOR_FONT_OPTIONS}
              onSelect={handleFontChange}
              size="sm"
            />
            <TugPopupButton
              label={`${fontSize}px`}
              items={FONT_SIZE_OPTIONS}
              onSelect={handleFontSizeChange}
              size="sm"
            />
            <TugPopupButton
              label={letterSpacing === 0 ? "Spacing: 0" : `Spacing: ${letterSpacing > 0 ? "+" : ""}${letterSpacing}`}
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
            historyProvider={galleryHistoryProvider}
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
