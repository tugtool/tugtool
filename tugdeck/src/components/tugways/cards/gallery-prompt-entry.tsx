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
 *
 * The entry is mounted inside a `TugBox` with `inset={false}` so the
 * pane fills edge-to-edge. The split pane's grip pill is suppressed via
 * `showHandle={false}` — the sash line remains draggable.
 */

import React, { useEffect, useMemo, useRef } from "react";

import { TugPromptEntry } from "../tug-prompt-entry";
import { TugSplitPane, TugSplitPanel } from "../tug-split-pane";
import { TugBox } from "../tug-box";
import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { MockTugConnection } from "@/lib/code-session-store/testing/mock-feed-store";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { FeedStore, type FeedStoreFilter } from "@/lib/feed-store";
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
  // Constructed once per card; disposed on unmount.
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
  // Real backend when a connection is available; shim otherwise.
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
        // Partial / invalid connection (happens in tests with a leaked
        // stub). Fall through to the inert shim below.
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
  // Mirrors gallery-prompt-input: a per-card FeedStore + FileTreeStore, with
  // workspace filtering via useCardWorkspaceKey. Constructed once per card
  // on first render when a connection is available; disposed on unmount.
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
      try {
        const feedStore = new FeedStore(
          connection,
          [FeedId.FILETREE],
          undefined,
          workspaceFilter,
        );
        const fileTreeStore = new FileTreeStore(feedStore, FeedId.FILETREE);
        const provider = fileTreeStore.getFileCompletionProvider();
        fileTreeStackRef.current = { feedStore, fileTreeStore, provider };
      } catch {
        // Partial / invalid connection — skip file completion. `@`-trigger
        // will return no results but the card still renders.
      }
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
  // Stable — providers live in refs for the card's lifetime, so the memo's
  // empty deps are correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const completionProviders = useMemo(() => {
    const out: Record<string, CompletionProvider> = {};
    const fileProvider = fileTreeStackRef.current?.provider;
    if (fileProvider) out["@"] = fileProvider;
    const commandProvider = metadataStackRef.current?.store.getCommandCompletionProvider();
    if (commandProvider) out["/"] = commandProvider;
    return out;
  }, []);

  return (
    <div className="gallery-prompt-entry-card" data-testid="gallery-prompt-entry">
      <TugSplitPane orientation="horizontal" showHandle={false}>
        <TugSplitPanel defaultSize="70%" minSize="20%">
          <div className="gallery-prompt-entry-placeholder" aria-hidden="true" />
        </TugSplitPanel>
        <TugSplitPanel defaultSize="30%" minSize="15%" maxSize="85%">
          <TugBox
            variant="plain"
            inset={false}
            className="gallery-prompt-entry-entry-pane"
          >
            <TugPromptEntry
              id={`${cardId}-entry`}
              codeSessionStore={mockSessionRef.current!.codeSessionStore}
              sessionMetadataStore={metadataStackRef.current!.store}
              historyStore={historyStoreRef.current}
              completionProviders={completionProviders}
            />
          </TugBox>
        </TugSplitPanel>
      </TugSplitPane>
    </div>
  );
}
