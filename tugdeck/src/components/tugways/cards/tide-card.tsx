/**
 * tide-card.tsx — Tide card (Unified Command Surface).
 *
 * Mounts `TugPromptEntry` inside a horizontal `TugSplitPane` (top 70% —
 * placeholder; bottom 30% — entry, clamped at 90%). The card wires:
 *
 *   • A `MockTugConnection`-backed `CodeSessionStore` (the entry's turn
 *     state surface).
 *   • Live `@` file completion via `FileTreeStore` against the real
 *     connection-singleton. When no live connection is available (tests,
 *     first paint before `getConnection()` resolves), the `@` provider
 *     falls back to an empty stable closure so the engine's typeahead
 *     trigger stays wired regardless of timing.
 *   • Offline `/` slash-command completion sourced from the captured
 *     `capabilities/<LATEST>/system-metadata.jsonl` via the Vite virtual
 *     module. Wrapped in a position-0 gate so `/` mid-text produces an
 *     empty popup.
 *   • A local `PromptHistoryStore` for arrow-up/down recall.
 *   • A per-card `EditorSettingsStore` whose CSS variables cascade from
 *     the entry-pane TugBox down to the input editor. The tools panel
 *     (toggled via the button on the status row) exposes font-family,
 *     font-size, tracking, and leading popup buttons that write back to
 *     the store.
 *
 * The entry is mounted inside a `TugBox` with `inset={false}` so the
 * pane fills edge-to-edge. The split pane's grip pill is suppressed via
 * `showHandle={false}` — the sash line remains draggable.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";

import { TugPromptEntry, type TugPromptEntryDelegate } from "../tug-prompt-entry";
import { TugSplitPane, TugSplitPanel, type TugSplitPanelHandle } from "../tug-split-pane";
import { useContentDrivenPanelSize } from "../use-content-driven-panel-size";
import { TugBox } from "../tug-box";
import { TugBadge } from "../tug-badge";
import { TugPopupButton } from "../tug-popup-button";
import type { TugPopupButtonItem } from "../tug-popup-button";
import { useResponderForm } from "../use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { MockTugConnection } from "@/lib/code-session-store/testing/mock-feed-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { FeedStore, type FeedStoreFilter } from "@/lib/feed-store";
import { EditorSettingsStore } from "@/lib/editor-settings-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { getConnection } from "@/lib/connection-singleton";
import { presentWorkspaceKey, registerCard } from "@/card-registry";
import { FeedId } from "@/protocol";
import type { CompletionProvider } from "@/lib/tug-text-engine";
import { useCardWorkspaceKey } from "@/components/tugways/hooks/use-card-workspace-key";
import {
  getFixtureSessionMetadataStore,
  wrapPositionZero,
} from "./completion-fixtures/system-metadata-fixture";

import "./tide-card.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable identifier for the Tide card's mock `CodeSessionStore`. */
export const TIDE_TUG_SESSION_ID = "tide-card-session";

const EDITOR_FONT_OPTIONS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "plex-sans", label: "IBM Plex Sans" },
  { action: TUG_ACTIONS.SET_VALUE, value: "inter", label: "Inter" },
  { action: TUG_ACTIONS.SET_VALUE, value: "hack", label: "Hack (mono)" },
];

const FONT_SIZE_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: 11, label: "11 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 12, label: "12 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 13, label: "13 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 14, label: "14 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 15, label: "15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 16, label: "16 px" },
];

const LETTER_SPACING_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: -0.35, label: "-0.35 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.25, label: "-0.25 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.15, label: "-0.15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.10, label: "-0.10 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.05, label: "-0.05 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0, label: "Normal" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0.05, label: "+0.05 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0.10, label: "+0.10 px" },
];

/** Percentage the entry panel pegs to when the user clicks Maximize.
 *  Mirrors the panel's `maxSize="90%"` upper bound — keep them in sync. */
const ENTRY_PANEL_MAX_PCT = 90;

const LINE_HEIGHT_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: 1.0, label: "1.0" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.1, label: "1.1" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.2, label: "1.2" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.3, label: "1.3" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.4, label: "1.4" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.5, label: "1.5" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.6, label: "1.6" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.7, label: "1.7" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.8, label: "1.8" },
];

/** Stable empty completion provider for the unbound / no-connection window. */
const EMPTY_FILE_COMPLETION_PROVIDER = ((_q: string) => []) as CompletionProvider;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TideCardContentProps {
  /**
   * Card instance id. Forwarded from the card registry's `contentFactory`
   * callback and used for per-card workspace binding (via
   * `useCardWorkspaceKey`) plus the responder scope id of the embedded
   * `TugPromptEntry`.
   */
  cardId: string;
}

// ---------------------------------------------------------------------------
// useTideCardServices
// ---------------------------------------------------------------------------

/**
 * Per-card services consumed by `TideCardContent`. Constructed and
 * disposed with the card instance; stable identity across renders.
 *
 * Lifecycle hygiene note: the internals of this hook carry the
 * render-body `if (ref.current === null)` pattern copied from
 * `gallery-prompt-entry.tsx`. It is flagged for cleanup in the Step 4
 * work under [tugplan-tide-card.md](../../../../../roadmap/tugplan-tide-card.md#step-4).
 */
export interface TideCardServices {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  historyStore: PromptHistoryStore;
  completionProviders: Record<string, CompletionProvider>;
  editorStore: EditorSettingsStore;
  /**
   * Delegate handle for the embedded `TugPromptEntry`. Owned by the
   * hook because the `/` completion provider's position-0 gate reads
   * `entryDelegateRef.current`; the component passes this same ref to
   * `<TugPromptEntry ref={...}>` and to the atom-regenerate callback.
   */
  entryDelegateRef: RefObject<TugPromptEntryDelegate | null>;
}

export function useTideCardServices(cardId: string): TideCardServices {
  // --- Mock-backed CodeSessionStore (turn-state surface). ---
  const mockSessionRef = useRef<{
    connection: MockTugConnection;
    codeSessionStore: CodeSessionStore;
  } | null>(null);
  if (mockSessionRef.current === null) {
    const connection = new MockTugConnection();
    const codeSessionStore = new CodeSessionStore({
      conn: connection as unknown as TugConnection,
      tugSessionId: TIDE_TUG_SESSION_ID,
    });
    mockSessionRef.current = { connection, codeSessionStore };
  }
  useEffect(() => {
    return () => {
      mockSessionRef.current?.codeSessionStore.dispose();
      mockSessionRef.current = null;
    };
  }, []);

  // --- File tree stack with workspace filter. ---
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
      console.warn("useTideCardServices: connection not available at render");
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

  // --- Local PromptHistoryStore (no backend wiring). ---
  const historyStoreRef = useRef<PromptHistoryStore | null>(null);
  if (historyStoreRef.current === null) {
    historyStoreRef.current = new PromptHistoryStore();
  }

  // --- Entry delegate ref (owned here so the `/` position-0 gate can
  // read it). The component uses the same ref for `<TugPromptEntry ref>`
  // and the atom-regenerate callback. ---
  const entryDelegateRef = useRef<TugPromptEntryDelegate | null>(null);

  // --- Session metadata store (fixture; swapped in Step 4). ---
  const sessionMetadataStore = getFixtureSessionMetadataStore();

  // --- Compose completion providers. ---
  //
  //   `@`: live `FileTreeStore` against the real connection. Falls back
  //        to EMPTY_FILE_COMPLETION_PROVIDER if `getConnection()` was
  //        null at first render so the trigger stays wired regardless
  //        of timing.
  //
  //   `/`: fixture `SessionMetadataStore` sourced from the captured
  //        `capabilities/<LATEST>/system-metadata.jsonl`, wrapped with the
  //        position-0 gate so `/` mid-text yields an empty popup.
  //
  // Provider identities are owned by refs and don't change for the
  // card's lifetime, so the memo's [] deps are correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const completionProviders = useMemo(() => {
    const innerSlash = sessionMetadataStore.getCommandCompletionProvider();
    return {
      "@": fileTreeStackRef.current?.provider ?? EMPTY_FILE_COMPLETION_PROVIDER,
      "/": wrapPositionZero(entryDelegateRef, innerSlash),
    };
  }, []);

  // --- EditorSettingsStore for the tools-panel controls. ---
  const editorStoreRef = useRef<EditorSettingsStore | null>(null);
  if (editorStoreRef.current === null) {
    editorStoreRef.current = new EditorSettingsStore();
  }
  const editorStore = editorStoreRef.current;

  // Wrap in useMemo so the returned object identity is stable across
  // renders; callers can safely put `services` in effect deps.
  return useMemo<TideCardServices>(
    () => ({
      codeSessionStore: mockSessionRef.current!.codeSessionStore,
      sessionMetadataStore,
      historyStore: historyStoreRef.current!,
      completionProviders,
      editorStore,
      entryDelegateRef,
    }),
    [sessionMetadataStore, completionProviders, editorStore],
  );
}

// ---------------------------------------------------------------------------
// TideCardContent
// ---------------------------------------------------------------------------

export function TideCardContent({ cardId }: TideCardContentProps) {
  const services = useTideCardServices(cardId);
  const { codeSessionStore, sessionMetadataStore, historyStore, completionProviders, editorStore, entryDelegateRef } = services;

  const entryPanelRef = useRef<TugSplitPanelHandle | null>(null);

  const editorSettings = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
  );

  // Bind the pane element for CSS variable cascade
  // (`--tug-font-family-editor` / `--tug-font-size-editor` /
  // `--tug-letter-spacing-editor` / `--tug-line-height-editor`). The
  // `regenerateAtoms` callback re-renders SVG atom glyphs when the
  // editor font changes, so atoms track the editor's chosen font.
  const paneRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    // `regenerateAtoms` re-renders the SVG atom glyphs when the editor
    // font changes via the tools popover — atoms must track the editor
    // font so a chosen monospace actually reaches the atom chip labels.
    editorStore.bind(el, () => entryDelegateRef.current?.regenerateAtoms());
    return () => editorStore.unbind();
  }, [editorStore]);

  // --- Content-driven panel growth for the entry pane. ---
  // The bottom TugSplitPanel grows toward `maxSize` as the editor
  // overflows and snaps back to the user's library-resolved size on
  // the editor's `data-empty="true"` signal. The source element is
  // derived from the entry delegate at call time via a stable
  // useMemo'd shim — identity-stable so the hook's effect doesn't
  // re-install observers on every render. (`entryPanelRef` and
  // `entryDelegateRef` are declared earlier so `completionProviders`
  // can read them for the position-0 gate.)
  const editorSourceRef = useMemo(
    () => ({
      get current(): HTMLElement | null {
        return entryDelegateRef.current?.getEditorElement() ?? null;
      },
    }),
    [],
  );
  // --- Maximize toggle. ---
  // When true, the entry panel is pegged to its declared max and the
  // split-pane handle is disabled. The content-driven sizer and the
  // submit-time restore both stand down so nothing fights the peg.
  // When false, the pane behaves exactly as if the toggle never
  // existed: saved size persists, transient size accommodates content.
  const [maximized, setMaximized] = React.useState(false);
  useLayoutEffect(() => {
    const panel = entryPanelRef.current;
    if (!panel) return;
    if (maximized) panel.setTransientSize(ENTRY_PANEL_MAX_PCT, { animated: true });
    else panel.restoreUserSize({ animated: true });
  }, [maximized]);

  useContentDrivenPanelSize({ panelRef: entryPanelRef, sourceRef: editorSourceRef, enabled: !maximized });

  // Animate the snap-back-to-userSize ONLY on explicit user submit —
  // not on any other data-empty transition (manual delete, undo, etc.).
  // Fires before `input.clear()` so the animated restore commits to
  // the library store first; the content-driven hook's subsequent
  // instant-restore is a no-op because the library store already
  // matches the user size. Skip while maximized — the maximize peg
  // owns the size.
  const handleBeforeSubmit = useCallback(() => {
    if (maximized) return;
    entryPanelRef.current?.restoreUserSize({ animated: true });
  }, [maximized]);

  // --- Responder scope for tools-panel popup buttons. ---
  const fontPopupId = useId();
  const fontSizePopupId = useId();
  const letterSpacingPopupId = useId();
  const lineHeightPopupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [fontPopupId]: (v: string) => editorStore.set({ fontId: v }),
    },
    setValueNumber: {
      [fontSizePopupId]: (v: number) => editorStore.set({ fontSize: v }),
      [letterSpacingPopupId]: (v: number) => editorStore.set({ letterSpacing: v }),
      [lineHeightPopupId]: (v: number) => editorStore.set({ lineHeight: v }),
    },
  });

  // --- Status row + tools panel content. ---
  const statusContent = (
    <TugBadge size="sm" emphasis="tinted" role="data">
      Project path /gallery/demo
    </TugBadge>
  );

  const letterSpacingLabel =
    editorSettings.letterSpacing === 0
      ? "Normal"
      : `${editorSettings.letterSpacing > 0 ? "+" : ""}${editorSettings.letterSpacing.toFixed(2)} px`;

  const toolsContent = (
    <>
      <TugPopupButton
        topLabel="Font"
        label={EDITOR_FONT_OPTIONS.find(f => f.value === editorSettings.fontId)?.label ?? "Font"}
        items={EDITOR_FONT_OPTIONS}
        senderId={fontPopupId}
        size="sm"
      />
      <TugPopupButton
        topLabel="Size"
        label={`${editorSettings.fontSize}px`}
        items={FONT_SIZE_OPTIONS}
        senderId={fontSizePopupId}
        size="sm"
      />
      <TugPopupButton
        topLabel="Tracking"
        label={letterSpacingLabel}
        items={LETTER_SPACING_OPTIONS}
        senderId={letterSpacingPopupId}
        size="sm"
      />
      <TugPopupButton
        topLabel="Leading"
        label={editorSettings.lineHeight.toFixed(1)}
        items={LINE_HEIGHT_OPTIONS}
        senderId={lineHeightPopupId}
        size="sm"
      />
    </>
  );

  return (
    <div className="tide-card" data-testid="tide-card">
      <TugSplitPane
        orientation="horizontal"
        showHandle={false}
        disabled={maximized}
        storageKey="tide.prompt-entry"
      >
        <TugSplitPanel id="tide-card-top" defaultSize="70%" minSize="10%">
          <div className="tide-card-placeholder" aria-hidden="true" />
        </TugSplitPanel>
        <TugSplitPanel
          ref={entryPanelRef}
          id="tide-card-bottom"
          defaultSize="30%"
          minSize="180px"
          maxSize="90%"
        >
          <ResponderScope>
            <TugBox
              ref={(el) => {
                paneRef.current = el as HTMLDivElement | null;
                (responderRef as (node: Element | null) => void)(el as Element | null);
              }}
              variant="plain"
              inset={false}
              className="tide-card-entry-pane"
            >
              <TugPromptEntry
                ref={entryDelegateRef}
                id={`${cardId}-entry`}
                codeSessionStore={codeSessionStore}
                sessionMetadataStore={sessionMetadataStore}
                historyStore={historyStore}
                completionProviders={completionProviders}
                onBeforeSubmit={handleBeforeSubmit}
                statusContent={statusContent}
                toolsContent={toolsContent}
                maximized={maximized}
                onMaximizeChange={setMaximized}
              />
            </TugBox>
          </ResponderScope>
        </TugSplitPanel>
      </TugSplitPane>
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerTideCard
// ---------------------------------------------------------------------------

/**
 * Register the Tide card in the global card registry.
 *
 * Must be called before `DeckManager.addCard("tide")` is invoked.
 * Call from `main.tsx` alongside `registerGitCard()`.
 */
export function registerTideCard(): void {
  registerCard({
    componentId: "tide",
    contentFactory: (cardId) => <TideCardContent cardId={cardId} />,
    defaultMeta: { title: "Tide", icon: "MessageSquareText", closable: true },
    defaultFeedIds: [
      FeedId.CODE_INPUT,
      FeedId.CODE_OUTPUT,
      FeedId.SESSION_METADATA,
      FeedId.FILETREE,
    ],
    sizePolicy: {
      min: { width: 320, height: 240 },
      preferred: { width: 720, height: 540 },
    },
  });
}
