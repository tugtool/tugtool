/**
 * gallery-prompt-entry.tsx — TugPromptEntry pristine showcase card.
 *
 * Mounts `TugPromptEntry` against a module-singleton `MockTugConnection`-
 * backed `CodeSessionStore` in the `idle` phase. Also exports
 * `buildMockServices()` as the factory the sandbox card re-uses for its
 * "reset store" flow.
 *
 * The card uses a minimal `InertFeedStore` for the session-metadata
 * store: T3.4.b doesn't exercise metadata, but `SessionMetadataStore`'s
 * constructor calls `feedStore.subscribe(listener)` once at
 * construction, so the shim only needs to stash the listener and
 * implement a no-op `getSnapshot`. A no-op completion provider closes
 * out the file-completion prop that the input forwards to `TugPromptInput`.
 *
 * See Spec S06 for the mock-driver API used by the sandbox card.
 */

import React from "react";

import { TugPromptEntry } from "../tug-prompt-entry";
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
 * The sandbox card reuses this constant when dispatching synthetic
 * frames so the reducer's per-session routing accepts them.
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
 * instance. Each call returns a distinct tuple. The pristine card
 * memoizes a single instance at module scope; the sandbox card re-
 * invokes this builder on every "reset store" click to hand back a
 * clean environment.
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
 * Pristine showcase of `TugPromptEntry`. Uses module-singleton mock
 * services so the rendered entry stays in its initial `idle` phase
 * across remounts — ideal for eyeballing the at-rest visual chrome.
 *
 * The sandbox card is the companion piece: it drives the same component
 * through every phase transition via synthetic frames.
 */
export function GalleryPromptEntry() {
  const services = getPristineServices();
  return (
    <div className="gallery-prompt-entry-card" data-testid="gallery-prompt-entry">
      <TugPromptEntry
        id="gallery-prompt-entry-main"
        codeSessionStore={services.codeSessionStore}
        sessionMetadataStore={services.sessionMetadataStore}
        historyStore={services.historyStore}
        fileCompletionProvider={services.fileCompletionProvider}
      />
    </div>
  );
}
