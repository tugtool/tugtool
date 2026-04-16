/**
 * gallery-prompt-entry.tsx — TugPromptEntry showcase card.
 *
 * Mounts `TugPromptEntry` in the bottom panel of a horizontal split pane
 * (70 top / 30 bottom), against a module-singleton `MockTugConnection`-
 * backed `CodeSessionStore` in the `idle` phase. The top panel is
 * intentionally empty for now — a placeholder for the transcript /
 * preview surface that T3.4.c will wire in.
 *
 * Exports `buildMockServices()` + `GALLERY_TUG_SESSION_ID` so tests and
 * future gallery variants can build their own mock fixture.
 *
 * The card uses a minimal `InertFeedStore` for the session-metadata
 * store: T3.4.b doesn't exercise metadata, but `SessionMetadataStore`'s
 * constructor calls `feedStore.subscribe(listener)` once at
 * construction, so the shim only needs to stash the listener and
 * implement a no-op `getSnapshot`. A no-op completion provider closes
 * out the file-completion prop that the input forwards to `TugPromptInput`.
 */

import React from "react";

import { TugPromptEntry } from "../tug-prompt-entry";
import { TugSplitPane, TugSplitPanel } from "../tug-split-pane";
import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { MockTugConnection } from "@/lib/code-session-store/testing/mock-feed-store";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import type { CompletionProvider } from "@/lib/tug-text-engine";
import { FeedId } from "@/protocol";

import "./gallery-prompt-entry.css";

// ---------------------------------------------------------------------------
// Mock-service wiring
// ---------------------------------------------------------------------------

/**
 * Stable identifier for the gallery's mock session. Not tied to any real
 * Claude session — the gallery runs entirely against the mock connection.
 */
export const GALLERY_TUG_SESSION_ID = "gallery-prompt-entry-session";

/**
 * Inert `FeedStore` stand-in. `SessionMetadataStore`'s constructor calls
 * `subscribe(listener)` once; the gallery never emits metadata, so the
 * shim just parks the listener and returns an empty snapshot.
 */
class InertFeedStore {
  subscribe(_listener: () => void): () => void {
    return () => {};
  }
  getSnapshot(): Map<number, unknown> {
    return new Map();
  }
}

export interface MockServices {
  /** Test double for the WebSocket connection; drives frames via dispatchDecoded. */
  connection: MockTugConnection;
  /** Real `CodeSessionStore` wired to the mock connection. */
  codeSessionStore: CodeSessionStore;
  /** Unused by T3.4.b; required by `TugPromptEntry`'s props contract. */
  sessionMetadataStore: SessionMetadataStore;
  /** Real `PromptHistoryStore`; no external wiring needed to construct. */
  historyStore: PromptHistoryStore;
  /** No-op file completion — `@` triggers return an empty list. */
  fileCompletionProvider: CompletionProvider;
}

/**
 * Construct a fresh set of mock services for a `TugPromptEntry` gallery
 * instance. Each call returns a distinct tuple. The gallery card
 * memoizes a single instance at module scope.
 */
export function buildMockServices(): MockServices {
  const connection = new MockTugConnection();
  const codeSessionStore = new CodeSessionStore({
    conn: connection as unknown as TugConnection,
    tugSessionId: GALLERY_TUG_SESSION_ID,
  });
  const inertFeed = new InertFeedStore() as never;
  const sessionMetadataStore = new SessionMetadataStore(
    inertFeed,
    FeedId.SESSION_METADATA as never,
  );
  const historyStore = new PromptHistoryStore();
  const fileCompletionProvider: CompletionProvider = () => [];
  return {
    connection,
    codeSessionStore,
    sessionMetadataStore,
    historyStore,
    fileCompletionProvider,
  };
}

// ---------------------------------------------------------------------------
// Pristine card
// ---------------------------------------------------------------------------

let _pristineServices: MockServices | null = null;

function getPristineServices(): MockServices {
  if (_pristineServices === null) {
    _pristineServices = buildMockServices();
  }
  return _pristineServices;
}

/**
 * Showcase of `TugPromptEntry` inside a horizontal split pane. The top
 * panel (~70%) is reserved for the transcript / preview surface T3.4.c
 * will introduce; the bottom panel (~30%) hosts the entry, filling the
 * pane. Uses module-singleton mock services so the entry stays in its
 * initial `idle` phase across remounts.
 */
export function GalleryPromptEntry() {
  const services = getPristineServices();
  return (
    <div className="gallery-prompt-entry-card" data-testid="gallery-prompt-entry">
      <TugSplitPane orientation="horizontal">
        <TugSplitPanel defaultSize="70%" minSize="20%">
          <div className="gallery-prompt-entry-placeholder" aria-hidden="true" />
        </TugSplitPanel>
        <TugSplitPanel defaultSize="30%" minSize="15%">
          <div className="gallery-prompt-entry-entry-pane">
            <TugPromptEntry
              id="gallery-prompt-entry-main"
              codeSessionStore={services.codeSessionStore}
              sessionMetadataStore={services.sessionMetadataStore}
              historyStore={services.historyStore}
              fileCompletionProvider={services.fileCompletionProvider}
            />
          </div>
        </TugSplitPanel>
      </TugSplitPane>
    </div>
  );
}
