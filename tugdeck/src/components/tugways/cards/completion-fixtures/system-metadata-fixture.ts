/**
 * system-metadata-fixture.ts — offline `/` completion source for the
 * gallery-prompt-entry demo card (D5).
 *
 * The gallery card drives `CodeSessionStore` against a `MockTugConnection`,
 * so Claude Code's `system_metadata` frame — which normally populates the
 * live `SessionMetadataStore` on session start — never reaches the card
 * and `/` would open an empty popup. This fixture feeds the *same*
 * `SessionMetadataStore` (shipped parser, shipped dedup) from the captured
 * `capabilities/<LATEST>/system-metadata.jsonl` artifact produced by D6's
 * `just capture-capabilities` runbook.
 *
 * The Vite side (`capabilitiesVirtualModulePlugin` in `vite.config.ts`)
 * exposes the raw JSONL string at `virtual:capabilities/system-metadata`.
 * The module import is wrapped in a top-level try/catch so this file
 * loads cleanly under bun-test, where the virtual module is unresolvable;
 * unit tests import `createFixtureSessionMetadataStore` directly with a
 * raw JSONL string and bypass the singleton entirely.
 */

import type { FeedStore } from "@/lib/feed-store";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { CompletionProvider } from "@/lib/tug-text-engine";
import { FeedId } from "@/protocol";
import type { TugPromptEntryDelegate } from "@/components/tugways/tug-prompt-entry";

// ---------------------------------------------------------------------------
// Capabilities JSONL — resolved at Vite build time, absent in bun-test.
// ---------------------------------------------------------------------------

let _capturedJsonl = "";
try {
  const mod = await import("virtual:capabilities/system-metadata");
  _capturedJsonl = (mod as { default?: string }).default ?? "";
} catch {
  // Virtual module unavailable (bun-test). `getFixtureSessionMetadataStore`
  // will throw if called in this environment; tests use the pure factory.
}

// ---------------------------------------------------------------------------
// FixtureFeedStore — satisfies the FeedStore contract SessionMetadataStore
// consumes (subscribe + getSnapshot). Emits the captured payload once via
// the constructor-time initial check and stays silent afterward.
// ---------------------------------------------------------------------------

class FixtureFeedStore {
  private map: Map<number, unknown>;

  constructor(payload: unknown) {
    this.map = new Map([[FeedId.SESSION_METADATA as number, payload]]);
  }

  subscribe(_listener: () => void): () => void {
    // The fixture is immutable — SessionMetadataStore's constructor-time
    // initial `_onFeedUpdate` consumes the payload synchronously, so no
    // later notifications are needed.
    return () => {};
  }

  getSnapshot(): Map<number, unknown> {
    return this.map;
  }
}

// ---------------------------------------------------------------------------
// Pure factory — tests call this directly.
// ---------------------------------------------------------------------------

/**
 * Parse the first line of a `system_metadata` JSONL capture and wrap the
 * resulting payload in a `SessionMetadataStore` backed by a one-shot
 * fixture `FeedStore`. Pure — no module-level side effects.
 */
export function createFixtureSessionMetadataStore(
  rawJsonl: string,
): SessionMetadataStore {
  const firstLine = rawJsonl.split("\n")[0];
  if (!firstLine) {
    throw new Error("system-metadata-fixture: JSONL is empty");
  }
  const payload = JSON.parse(firstLine);
  const feed = new FixtureFeedStore(payload) as unknown as FeedStore;
  return new SessionMetadataStore(feed, FeedId.SESSION_METADATA);
}

// ---------------------------------------------------------------------------
// Production singleton — uses the Vite-resolved capture.
// ---------------------------------------------------------------------------

let _store: SessionMetadataStore | null = null;

/**
 * Return the singleton `SessionMetadataStore` backed by the captured
 * `capabilities/<LATEST>/system-metadata.jsonl`.
 *
 * Under Vite (dev and production) the virtual module resolves and the
 * store carries the real capture. Under bun-test the virtual module is
 * unresolvable, so the singleton falls back to an empty `SessionMetadataStore`
 * (its `/` provider returns `[]`). Tests that need to assert over the
 * captured data use `createFixtureSessionMetadataStore(rawJsonl)` directly.
 */
export function getFixtureSessionMetadataStore(): SessionMetadataStore {
  if (_store) return _store;
  if (_capturedJsonl) {
    _store = createFixtureSessionMetadataStore(_capturedJsonl);
  } else {
    // No Vite virtual module available — return an empty store backed by a
    // feed that never emits. Matches the old InertFeedStore behavior that
    // previously lived in gallery-prompt-entry.tsx.
    const emptyFeed = new FixtureFeedStore(null) as unknown as FeedStore;
    _store = new SessionMetadataStore(emptyFeed, FeedId.SESSION_METADATA);
  }
  return _store;
}

// ---------------------------------------------------------------------------
// Position-0 gate for the `/` trigger.
// ---------------------------------------------------------------------------

/**
 * Wrap a `CompletionProvider` so it only yields results when `/` is the
 * first character of the editor's text. Anywhere else in the text, the
 * wrapped provider returns `[]` (the engine still opens the popup on the
 * trigger, but it's empty — per D5.c recommendation P1).
 */
export function wrapPositionZero(
  entryRef: React.RefObject<TugPromptEntryDelegate | null>,
  inner: CompletionProvider,
): CompletionProvider {
  return (query: string) => {
    const editor = entryRef.current?.getEditorElement();
    const text = editor?.textContent ?? "";
    if (text.length === 0 || text[0] !== "/") return [];
    return inner(query);
  };
}
