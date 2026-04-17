/**
 * gallery-prompt-entry.tsx — TugPromptEntry showcase card.
 *
 * Mounts `TugPromptEntry` inside a horizontal `TugSplitPane` (top 70% —
 * placeholder; bottom 30% — entry, clamped at 85%). The card wires:
 *
 *   • A `MockTugConnection`-backed `CodeSessionStore` (the entry's turn
 *     state surface — no real Claude backend is required in the gallery).
 *   • Real backend-backed file (`@`) and command (`/`) completion via
 *     `FileTreeStore` + `SessionMetadataStore`, mirroring the pattern in
 *     `gallery-prompt-input`. When no live connection is available
 *     (tests, first paint before `getConnection()` resolves), the
 *     respective provider is simply omitted from `completionProviders`
 *     and the trigger produces no suggestions — no throws, no warnings.
 *   • A local `PromptHistoryStore` for arrow-up/down recall.
 *   • A per-card `EditorSettingsStore` whose CSS variables cascade from
 *     the entry-pane TugBox down to the input editor. The tools panel
 *     (toggled via the button on the status row) exposes font-family
 *     and font-size popup buttons that write back to the store.
 *
 * The entry is mounted inside a `TugBox` with `inset={false}` so the
 * pane fills edge-to-edge. The split pane's grip pill is suppressed via
 * `showHandle={false}` — the sash line remains draggable.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

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
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { FeedStore, type FeedStoreFilter } from "@/lib/feed-store";
import { EditorSettingsStore } from "@/lib/editor-settings-store";
import { getConnection } from "@/lib/connection-singleton";
import { presentWorkspaceKey } from "@/card-registry";
import { FeedId } from "@/protocol";
import type { CompletionProvider } from "@/lib/tug-text-engine";
import { useCardWorkspaceKey } from "@/components/tugways/hooks/use-card-workspace-key";

import "./gallery-prompt-entry.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stable identifier for the gallery's mock `CodeSessionStore`. Not tied
 * to any real Claude session — the gallery runs the turn-state surface
 * entirely against the `MockTugConnection`.
 */
export const GALLERY_TUG_SESSION_ID = "gallery-prompt-entry-session";

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

/** Stable empty completion provider for the unbound / no-connection window. */
const EMPTY_FILE_COMPLETION_PROVIDER = ((_q: string) => []) as CompletionProvider;

// ---------------------------------------------------------------------------
// SessionMetadataStore shim
// ---------------------------------------------------------------------------

/**
 * Inert `FeedStore` stand-in for `SessionMetadataStore` when no live
 * connection is available. `SessionMetadataStore`'s constructor subscribes
 * once; the shim parks the listener and returns an empty snapshot. The
 * entry does not render metadata in T3.4.b — the prop is purely structural
 * until T3.4.c wires a real metadata feed.
 */
class InertFeedStore {
  subscribe(_listener: () => void): () => void {
    return () => {};
  }
  getSnapshot(): Map<number, unknown> {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GalleryPromptEntryProps {
  /**
   * Card instance id. Forwarded from the card registry's `contentFactory`
   * callback and used for per-card workspace binding (via
   * `useCardWorkspaceKey`) plus the responder scope id of the embedded
   * `TugPromptEntry`.
   */
  cardId: string;
}

// ---------------------------------------------------------------------------
// GalleryPromptEntry
// ---------------------------------------------------------------------------

export function GalleryPromptEntry({ cardId }: GalleryPromptEntryProps) {
  // --- Mock-backed CodeSessionStore (turn-state surface). ---
  const mockSessionRef = useRef<{
    connection: MockTugConnection;
    codeSessionStore: CodeSessionStore;
  } | null>(null);
  if (mockSessionRef.current === null) {
    const connection = new MockTugConnection();
    const codeSessionStore = new CodeSessionStore({
      conn: connection as unknown as TugConnection,
      tugSessionId: GALLERY_TUG_SESSION_ID,
    });
    mockSessionRef.current = { connection, codeSessionStore };
  }
  useEffect(() => {
    return () => {
      mockSessionRef.current?.codeSessionStore.dispose();
      mockSessionRef.current = null;
    };
  }, []);

  // --- SessionMetadataStore for command completions. ---
  const metadataStackRef = useRef<{
    feedStore: FeedStore | null;
    store: SessionMetadataStore;
  } | null>(null);
  if (metadataStackRef.current === null) {
    const connection = getConnection();
    let built: { feedStore: FeedStore | null; store: SessionMetadataStore } | null = null;
    if (connection) {
      try {
        const feedStore = new FeedStore(connection, [FeedId.SESSION_METADATA]);
        const store = new SessionMetadataStore(feedStore, FeedId.SESSION_METADATA);
        built = { feedStore, store };
      } catch {
        // Partial / invalid connection (tests). Fall through to inert shim.
      }
    }
    if (!built) {
      const inert = new InertFeedStore() as never;
      const store = new SessionMetadataStore(inert, FeedId.SESSION_METADATA as never);
      built = { feedStore: null, store };
    }
    metadataStackRef.current = built;
  }
  useEffect(() => {
    return () => {
      metadataStackRef.current?.feedStore?.dispose();
      metadataStackRef.current = null;
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
      console.warn("GalleryPromptEntry: connection not available at render");
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

  // --- Compose completion providers. ---
  // Stable — both provider identities are owned by refs and never change
  // for the card's lifetime, so the memo's [] deps are correct. Mirrors
  // gallery-prompt-input's pattern: `@` always present (falling back to
  // an empty provider if `getConnection()` was null at first render) so
  // the engine's typeahead trigger stays wired regardless of timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const completionProviders = useMemo(() => {
    const out: Record<string, CompletionProvider> = {
      "@": fileTreeStackRef.current?.provider ?? EMPTY_FILE_COMPLETION_PROVIDER,
    };
    const commandProvider = metadataStackRef.current?.store.getCommandCompletionProvider();
    if (commandProvider) out["/"] = commandProvider;
    return out;
  }, []);

  // --- EditorSettingsStore for the tools-panel controls. ---
  // Constructed once per card; binds via the paneRef below so the
  // `--tug-font-family-editor` / `--tug-font-size-editor` / `--tug-letter-spacing-editor`
  // custom properties cascade from the pane down to the embedded input.
  const editorStoreRef = useRef<EditorSettingsStore | null>(null);
  if (editorStoreRef.current === null) {
    editorStoreRef.current = new EditorSettingsStore();
  }
  const editorStore = editorStoreRef.current;
  const editorSettings = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
  );

  const paneRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    // `regenerateAtoms` argument is fine as a no-op for this card — the
    // entry doesn't yet re-render atom glyphs on font changes. If the
    // gallery grows to need it, route through a TugPromptEntryDelegate.
    editorStore.bind(el, () => {});
    return () => editorStore.unbind();
  }, [editorStore]);

  // --- Content-driven panel growth for the entry pane. ---
  // The bottom TugSplitPanel grows toward `maxSize` as the editor
  // overflows and snaps back to the user's library-resolved size on
  // the editor's `data-empty="true"` signal. The source element is
  // derived from the entry delegate at call time via a stable
  // useMemo'd shim — identity-stable so the hook's effect doesn't
  // re-install observers on every render.
  const entryPanelRef = useRef<TugSplitPanelHandle | null>(null);
  const entryDelegateRef = useRef<TugPromptEntryDelegate | null>(null);
  const editorSourceRef = useMemo(
    () => ({
      get current(): HTMLElement | null {
        return entryDelegateRef.current?.getEditorElement() ?? null;
      },
    }),
    [],
  );
  useContentDrivenPanelSize({ panelRef: entryPanelRef, sourceRef: editorSourceRef });

  // Animate the snap-back-to-userSize ONLY on explicit user submit —
  // not on any other data-empty transition (manual delete, undo, etc.).
  // Fires before `input.clear()` so the animated restore commits to
  // the library store first; the content-driven hook's subsequent
  // instant-restore is a no-op because the library store already
  // matches the user size.
  const handleBeforeSubmit = useCallback(() => {
    entryPanelRef.current?.restoreUserSize({ animated: true });
  }, []);

  // --- Responder scope for tools-panel popup buttons. ---
  const fontPopupId = useId();
  const fontSizePopupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [fontPopupId]: (v: string) => editorStore.set({ fontId: v }),
    },
    setValueNumber: {
      [fontSizePopupId]: (v: number) => editorStore.set({ fontSize: v }),
    },
  });

  // --- Status row + tools panel content. ---
  const statusContent = (
    <TugBadge size="sm" emphasis="tinted" role="data">
      Project path /gallery/demo
    </TugBadge>
  );

  const toolsContent = (
    <>
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
    </>
  );

  return (
    <div className="gallery-prompt-entry-card" data-testid="gallery-prompt-entry">
      <TugSplitPane
        orientation="horizontal"
        showHandle={false}
        storageKey="gallery.prompt-entry"
      >
        <TugSplitPanel id="gallery-prompt-entry-top" defaultSize="70%" minSize="10%">
          <div className="gallery-prompt-entry-placeholder" aria-hidden="true" />
        </TugSplitPanel>
        <TugSplitPanel
          ref={entryPanelRef}
          id="gallery-prompt-entry-bottom"
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
              className="gallery-prompt-entry-entry-pane"
            >
              <TugPromptEntry
                ref={entryDelegateRef}
                id={`${cardId}-entry`}
                codeSessionStore={mockSessionRef.current!.codeSessionStore}
                sessionMetadataStore={metadataStackRef.current!.store}
                historyStore={historyStoreRef.current}
                completionProviders={completionProviders}
                onBeforeSubmit={handleBeforeSubmit}
                statusContent={statusContent}
                toolsContent={toolsContent}
              />
            </TugBox>
          </ResponderScope>
        </TugSplitPanel>
      </TugSplitPane>
    </div>
  );
}
