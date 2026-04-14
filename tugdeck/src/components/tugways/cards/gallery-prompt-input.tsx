/**
 * gallery-prompt-input.tsx -- TugPromptInput gallery card.
 *
 * Testing surface for the tug-prompt-input component. Includes:
 * - Interactive editor with atom insertion, typeahead, drag-and-drop
 * - Key configuration for Return/Enter
 * - Session history via Cmd+Up/Down
 *
 * Tuglaws compliance:
 *   [L01] One root.render() at mount — component manages engine internally
 *   [L06] Appearance via CSS and DOM, never React state
 *   [L07] Providers are stable refs created once per scope
 */

import React, { useRef, useCallback, useEffect, useId, useMemo, useState, useLayoutEffect, useSyncExternalStore } from "react";
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/components/tugways/tug-prompt-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import type { AtomSegment, CompletionProvider, HistoryProvider, InputAction } from "@/lib/tug-text-engine";
import { EditorSettingsStore } from "@/lib/editor-settings-store";
import { FeedStore, type FeedStoreFilter } from "@/lib/feed-store";
import { presentWorkspaceKey } from "@/card-registry";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { getConnection } from "@/lib/connection-singleton";
import { FeedId } from "@/protocol";
import { useCardWorkspaceKey } from "@/components/tugways/hooks/use-card-workspace-key";
import "./gallery-prompt-input.css";
import { TUG_ACTIONS } from "../action-vocabulary";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

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

const EDITOR_FONT_OPTIONS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "plex-sans", label: "IBM Plex Sans" },
  { action: TUG_ACTIONS.SET_VALUE, value: "inter", label: "Inter" },
  { action: TUG_ACTIONS.SET_VALUE, value: "hack", label: "Hack (mono)" },
];

// Font size items dispatch numeric payloads — the parent binds via the
// setValueNumber slot in useResponderForm and reads event.value as number.
const FONT_SIZE_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: 11, label: "11 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 12, label: "12 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 13, label: "13 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 14, label: "14 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 15, label: "15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 16, label: "16 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 18, label: "18 px" },
];

// Letter spacing items also dispatch numeric payloads (fractional px).
const LETTER_SPACING_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: -0.25, label: "-0.25 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.15, label: "-0.15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.10, label: "-0.10 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.05, label: "-0.05 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0, label: "Normal" },
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
  // Gallery is a test harness (see gallery-split-pane.tsx header). No
  // tug_session_id filter: under multi-session this is last-writer-wins,
  // explicitly accepted per the multi-session-router plan #non-goals.
  // Real per-card filters land in T3.4 via CodeSessionStore.
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

// ===================================================================
// Gallery component
// ===================================================================

interface GalleryPromptInputProps {
  /** Card instance id — used to subscribe to per-card workspace binding. */
  cardId: string;
}

/** Stable empty completion provider for the unbound / no-connection window. */
const EMPTY_FILE_COMPLETION_PROVIDER = ((_q: string) => []) as CompletionProvider;

export function GalleryPromptInput({ cardId }: GalleryPromptInputProps) {
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

  // Per-instance FILETREE stack. Same pattern as Tugcard's `feedStoreRef`:
  // stateful stores live in a ref (not React state) to comply with [L02]
  // "External state enters React through useSyncExternalStore only — no
  // useState + manual sync, no useEffect copying external values into
  // React state." The stack is constructed once at mount and disposed on
  // unmount.
  //
  // The FeedStore filter is the only reactive piece: `useMemo` produces a
  // pure filter function identity from `workspaceKey`, and a `useEffect`
  // reinstalls it on the existing FeedStore via `setFilter` when the
  // identity changes — mirroring Tugcard's workspace-filter wiring
  // exactly. Before binding lands, the fallback `presentWorkspaceKey`
  // accepts any workspace-stamped frame (Risk R04, unbound window); once
  // bound, the filter tightens to an exact value match.
  const workspaceKey = useCardWorkspaceKey(cardId);

  const workspaceFilter: FeedStoreFilter = useMemo(
    () =>
      workspaceKey
        ? (_feedId, decoded) =>
            typeof decoded === "object" &&
            decoded !== null &&
            "workspace_key" in decoded &&
            (decoded as { workspace_key: unknown }).workspace_key === workspaceKey
        : presentWorkspaceKey,
    [workspaceKey],
  );

  const fileTreeStackRef = useRef<{
    feedStore: FeedStore;
    fileTreeStore: FileTreeStore;
    provider: CompletionProvider;
  } | null>(null);

  if (fileTreeStackRef.current === null) {
    const connection = getConnection();
    if (connection) {
      // Initial filter is the memoized value captured at first render —
      // subsequent changes are applied via setFilter in the useEffect below.
      const feedStore = new FeedStore(
        connection,
        [FeedId.FILETREE],
        undefined,
        workspaceFilter,
      );
      const fileTreeStore = new FileTreeStore(feedStore, FeedId.FILETREE);
      const provider = fileTreeStore.getFileCompletionProvider();
      fileTreeStackRef.current = { feedStore, fileTreeStore, provider };
    } else {
      console.warn("GalleryPromptInput: connection not available at render");
    }
  }

  useEffect(() => {
    fileTreeStackRef.current?.feedStore.setFilter(workspaceFilter);
  }, [workspaceFilter]);

  useEffect(() => {
    return () => {
      const stack = fileTreeStackRef.current;
      if (stack) {
        stack.fileTreeStore.dispose();
        stack.feedStore.dispose();
        fileTreeStackRef.current = null;
      }
    };
  }, []);

  // Stable — the provider identity is owned by the ref and never changes
  // for the card's lifetime, so the memo's [] deps are correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const completionProviders = useMemo(
    () => ({
      "@": fileTreeStackRef.current?.provider ?? EMPTY_FILE_COMPLETION_PROVIDER,
      "/": getCardServices().commandCompletionProvider,
    }),
    [],
  );

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

  // L11 migration via useResponderForm — this card handles:
  //  - selectValue from two key-config choice groups (return / enter action)
  //  - setValue (string) from the font picker popup
  //  - setValue (number) from the font-size and letter-spacing popups
  //
  // TugPromptInput has its own nested responder for cut/copy/paste; clicks
  // inside the editor promote that, clicks on a toolbar control promote
  // this outer card (innermost-first DOM walk). Gensym'd sender ids per
  // control.
  const keyReturnId = useId();
  const keyEnterId = useId();
  const fontPopupId = useId();
  const fontSizePopupId = useId();
  const letterSpacingPopupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [keyReturnId]: (v: string) => setReturnAction(v as InputAction),
      [keyEnterId]: (v: string) => setEnterAction(v as InputAction),
    },
    setValueString: {
      [fontPopupId]: (v: string) => editorStore.set({ fontId: v }),
    },
    setValueNumber: {
      [fontSizePopupId]: (v: number) => editorStore.set({ fontSize: v }),
      [letterSpacingPopupId]: (v: number) => editorStore.set({ letterSpacing: v }),
    },
  });

  const handleRouteChange = useCallback((route: string | null) => {
    if (routeRef.current) routeRef.current.textContent = route ?? "none";
  }, []);

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-prompt-input"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Interactive Editor ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Editor</TugLabel>
        <div style={maximized ? { display: "flex", flexDirection: "column" as const, height: "300px", gap: "8px" } : undefined}>
          <div className="prompt-input-toolbar">
            <TugPushButton size="sm" onClick={handleInsertAtom}>Insert Atom</TugPushButton>
            <TugPushButton size="sm" emphasis="outlined" onClick={handleClear}>Clear</TugPushButton>
            <TugPushButton size="sm" emphasis="ghost" onClick={() => setMaximized((m: boolean) => !m)}>
              {maximized ? "Minimize" : "Maximize"}
            </TugPushButton>
            <TugPopupButton
              label={EDITOR_FONT_OPTIONS.find(f => f.value === editorSettings.fontId)?.label ?? "Font"}
              items={EDITOR_FONT_OPTIONS}
              senderId={fontPopupId}
              size="sm"
            />
            <TugPopupButton
              label={`${editorSettings.fontSize}px`}
              items={FONT_SIZE_OPTIONS}
              senderId={fontSizePopupId}
              size="sm"
            />
            <TugPopupButton
              label={editorSettings.letterSpacing === 0 ? "Spacing: 0" : `Spacing: ${editorSettings.letterSpacing > 0 ? "+" : ""}${editorSettings.letterSpacing}`}
              items={LETTER_SPACING_OPTIONS}
              senderId={letterSpacingPopupId}
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

      <TugSeparator />

      {/* ---- Key Configuration ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Key Configuration</TugLabel>
        <div className="prompt-input-key-config">
          <div className="prompt-input-key-config-row">
            <span className="prompt-input-key-config-label">Return (main keyboard):</span>
            <TugChoiceGroup items={RETURN_CHOICES} value={returnAction} size="sm" senderId={keyReturnId} />
          </div>
          <div className="prompt-input-key-config-row">
            <span className="prompt-input-key-config-label">Enter (numpad):</span>
            <TugChoiceGroup items={ENTER_CHOICES} value={enterAction} size="sm" senderId={keyEnterId} />
          </div>
          <div className="prompt-input-desc">
            Shift always inverts. hasMarkedText=true → key goes to IME.
          </div>
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
