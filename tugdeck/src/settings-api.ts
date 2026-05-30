/**
 * Settings API client for tugcast.
 *
 * Read functions pull from the TugbankClient in-memory cache (populated via
 * the DEFAULTS WebSocket feed). Write functions PUT to the tugcast HTTP API.
 *
 * Domain/key mapping:
 *   Layout    → domain `dev.tugtool.deck.layout`,   key `layout`        (Value::Json)
 *   Theme     → domain `dev.tugtool.app`,            key `theme`         (Value::String)
 *   Card state → domain `dev.tugtool.deck.cardstate`, key `<cardId>`      (Value::Json) — `putCardState` / `readCardStates`
 *   Deck state→ domain `dev.tugtool.deck.state`,     key `focusedCardId` (Value::String)
 *
 * The tagged-value wire format is `{"kind":"json","value":{...}}` for JSON
 * values and `{"kind":"string","value":"brio"}` for strings.
 */

import type { CardStateBag } from "./layout-tree";
import type { TugbankClient, TaggedValue } from "./lib/tugbank-client";
import type { HistoryEntry } from "./lib/prompt-history-store";
import { logSessionLifecycle } from "./lib/session-lifecycle-log";

const CARDSTATE_DOMAIN = "dev.tugtool.deck.cardstate";

// ── Read functions (TugbankClient cache) ─────────────────────────────────────

/**
 * Read the deck layout from the TugbankClient cache.
 * Returns the unwrapped layout object, or null if not stored.
 */
export function readLayout(client: TugbankClient): object | null {
  const entry = client.get("dev.tugtool.deck.layout", "layout");
  if (entry && entry.kind === "json" && entry.value !== undefined) {
    return entry.value as object;
  }
  return null;
}

/**
 * Read the app theme from the TugbankClient cache.
 * Returns the theme string, or null if not stored.
 */
export function readTheme(client: TugbankClient): string | null {
  const entry = client.get("dev.tugtool.app", "theme");
  if (entry && entry.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  return null;
}

/**
 * Read the focused card ID from the TugbankClient cache.
 * Returns the string value, or null if not stored.
 */
export function readDeckState(client: TugbankClient): string | null {
  const entry = client.get("dev.tugtool.deck.state", "focusedCardId");
  if (entry && entry.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  return null;
}

/**
 * Read per-card state bags from the TugbankClient cache for the given card ids.
 * Returns a Map of cardId → CardStateBag for cards that have stored state under
 * `dev.tugtool.deck.cardstate`.
 *
 * Backward-compat coercion: persisted bags from before Phase E.11 stored
 * `{ kind: "component-owned" }` in `bag.focus` for engine-owned focus
 * targets. The current `FocusSnapshot` union names this variant
 * `engine`; the structure (no payload fields beyond `kind`) is
 * identical, so the rename is a pure relabel. We coerce on read so
 * downstream consumers see the post-E.11 shape exclusively. Bags
 * written by this client after Phase E.11 already carry
 * `kind: "engine"`; the coercion is a no-op for them.
 */
export function readCardStates(client: TugbankClient, cardIds: string[]): Map<string, CardStateBag> {
  const map = new Map<string, CardStateBag>();
  const domain = client.readDomain(CARDSTATE_DOMAIN);
  if (!domain) return map;

  for (const cardId of cardIds) {
    const entry = domain[cardId] as TaggedValue | undefined;
    if (entry && entry.kind === "json" && entry.value !== undefined) {
      map.set(cardId, coerceFocusSnapshotOnRead(entry.value as CardStateBag));
    }
  }
  return map;
}

/**
 * Coerce legacy `{ kind: "component-owned" }` in `bag.focus` to
 * `{ kind: "engine" }` on read. Information-preserving — the variants
 * are structurally identical and represent the same focus state — so
 * the rewrite is safe to apply unconditionally at the deserialization
 * boundary. Returns the input bag (possibly with a new `focus` field)
 * when a coercion fires, the same reference otherwise.
 */
function coerceFocusSnapshotOnRead(bag: CardStateBag): CardStateBag {
  const focus = bag.focus;
  if (focus === undefined || focus === null) return bag;
  // The persisted value may carry a kind string the current
  // `FocusSnapshot` union no longer names; cast through `unknown` to
  // read the legacy tag without losing type safety on the rewrite.
  if ((focus as unknown as { kind: string }).kind === "component-owned") {
    return { ...bag, focus: { kind: "engine" } };
  }
  return bag;
}

// ── Write functions (HTTP PUT, unchanged) ────────────────────────────────────

/**
 * PUT the deck layout to tugbank.
 *
 * Returns the fetch Promise so callers can await it when needed (e.g. before
 * page reload). Normal saves are fire-and-forget — the Promise is ignored.
 */
export function putLayout(layout: object): Promise<void> {
  return fetch("/api/defaults/dev.tugtool.deck.layout/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: layout }),
  })
    .then(() => {})
    .catch((err) => {
      console.warn("[settings] PUT layout failed:", err);
    });
}

/**
 * PUT the app theme to tugbank (fire-and-forget).
 */
export function putTheme(theme: string): void {
  fetch("/api/defaults/dev.tugtool.app/theme", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: theme }),
  }).catch((err) => {
    console.warn("[settings] PUT theme failed:", err);
  });
}

/**
 * PUT a single per-card state bag to tugbank under `dev.tugtool.deck.cardstate/{cardId}`.
 *
 * Returns a Promise that resolves when the write completes. Callers that
 * need to wait (e.g. prepareForReload) can await it; fire-and-forget
 * callers can ignore the return value.
 */
export function putCardState(cardId: string, bag: CardStateBag, options?: { keepalive?: boolean; sync?: boolean }): Promise<void> {
  const url = `/api/defaults/${CARDSTATE_DOMAIN}/${encodeURIComponent(cardId)}`;
  const body = JSON.stringify({ kind: "json", value: bag });

  if (options?.sync) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, false);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(body);
    } catch (err) {
      console.warn("[settings] PUT cardState (sync) failed for card", cardId, err);
    }
    return Promise.resolve();
  }

  return fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: options?.keepalive,
  }).then(() => {}).catch((err) => {
    console.warn("[settings] PUT cardState failed for card", cardId, err);
  });
}

/**
 * PUT the focused card ID to tugbank (fire-and-forget).
 */
export function putFocusedCardId(focusedCardId: string): void {
  fetch("/api/defaults/dev.tugtool.deck.state/focusedCardId", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: focusedCardId }),
  }).catch((err) => {
    console.warn("[settings] PUT focusedCardId failed:", err);
  });
}

// ── Editor settings ─────────────────────────────────────────────────────────

/** Editor settings shape stored in tugbank. */
export interface EditorSettings {
  fontId: string;
  fontSize: number;
  letterSpacing: number;
  /** Unit-less line-height multiplier (e.g. 1.7). */
  lineHeight: number;
  /** Whether the editor wraps long lines. Defaults to false on the
   *  substrate; opt-in via the editor settings sheet. */
  lineWrap: boolean;
  /** Whether the editor renders the line-numbers gutter. */
  lineNumbers: boolean;
  /** Whether the editor highlights the gutter cell of the line containing
   *  the cursor. Independent of `lineNumbers`. */
  highlightActiveLineGutter: boolean;
}

/**
 * Read editor settings from the TugbankClient cache.
 */
export function readEditorSettings(client: TugbankClient): EditorSettings | null {
  const entry = client.get("dev.tugtool.editor", "settings");
  if (entry && entry.kind === "json" && entry.value !== undefined) {
    return entry.value as EditorSettings;
  }
  return null;
}

/**
 * PUT editor settings to tugbank (fire-and-forget).
 */
export function putEditorSettings(settings: EditorSettings): void {
  fetch("/api/defaults/dev.tugtool.editor/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: settings }),
  }).catch((err) => {
    console.warn("[settings] PUT editorSettings failed:", err);
  });
}

/**
 * GET editor settings from tugbank (HTTP, for use without TugbankClient).
 */
export async function getEditorSettings(): Promise<EditorSettings | null> {
  try {
    const response = await fetch("/api/defaults/dev.tugtool.editor/settings");
    if (response.status === 404) return null;
    const tagged = await response.json() as { kind: string; value: unknown };
    if (tagged.kind === "json" && tagged.value !== undefined) {
      return tagged.value as EditorSettings;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Response (transcript) settings ──────────────────────────────────────────

/**
 * Response-settings shape stored in tugbank. Presentation knobs for
 * the Dev card's transcript pane (top pane, distinct from the editor
 * pane below it):
 *
 *   - `entryMargin`: inter-entry vertical gap in CSS pixels.
 *   - `magnification`: the Settings sheet's Magnification slider value
 *     (1 = 100%). Now implemented as CSS `zoom` on the transcript root —
 *     it scales the whole transcript subtree (text, code, atoms, icons)
 *     uniformly via layout zoom, scoped to this card's transcript and
 *     leaving the surrounding chrome at 1×. Distinct from the macOS
 *     host's `WKWebView.pageZoom` (View > Zoom In / Out), which scales
 *     the entire window; the two compose.
 */
export interface ResponseSettings {
  entryMargin: number;
  magnification: number;
}

/**
 * Read response settings from the TugbankClient cache.
 */
export function readResponseSettings(client: TugbankClient): ResponseSettings | null {
  const entry = client.get("dev.tugtool.dev.response", "settings");
  if (entry && entry.kind === "json" && entry.value !== undefined) {
    return entry.value as ResponseSettings;
  }
  return null;
}

/**
 * PUT response settings to tugbank (fire-and-forget).
 */
export function putResponseSettings(settings: ResponseSettings): void {
  fetch("/api/defaults/dev.tugtool.dev.response/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: settings }),
  }).catch((err) => {
    console.warn("[settings] PUT responseSettings failed:", err);
  });
}

// ── Split pane layouts ──────────────────────────────────────────────────────

/**
 * Split-pane layout persisted in tugbank.
 *
 * - `layout`: panel id → flex-grow value, mirroring react-resizable-panels'
 *   `Layout` type. This is the relative-size dimension; restored as the
 *   library's `defaultLayout`.
 * - `pixels`: panel id → pixel size, for panels that opted into
 *   `groupResizeBehavior="preserve-pixel-size"`. Captured at every
 *   `onLayoutChanged` (drags and library-driven container resizes).
 *   Restored imperatively via `panel.resize("Npx")` after first measure
 *   so pixel-pinned panes keep their size across cards, reloads, and
 *   different container sizes — independent of the flex-grow ratio.
 *
 * The legacy on-disk shape was a bare `Record<string, number>` (the old
 * `layout` map). `readSplitPaneLayout` accepts either shape; the writer
 * always emits the new shape.
 */
export interface SplitPaneLayout {
  layout: Record<string, number>;
  pixels?: Record<string, number>;
}

/**
 * Legacy on-disk shape (bare flex-grow map). Read path lifts this into
 * the new `SplitPaneLayout` shape transparently.
 */
type SplitPaneLayoutLegacy = Record<string, number>;

function isLegacyLayoutShape(value: unknown): value is SplitPaneLayoutLegacy {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  // New shape always has a `layout` object; legacy shape stores numbers
  // directly under panel ids.
  if ("layout" in obj && typeof obj.layout === "object") return false;
  for (const v of Object.values(obj)) {
    if (typeof v !== "number") return false;
  }
  return true;
}

// Cache lifted shapes so identical raw entries (same TugbankClient cache
// reference) produce the same lifted reference. `useSyncExternalStore`
// requires stable snapshots — without this, a legacy record would lift
// to a fresh object every read and loop the subscriber.
const liftedSplitPaneLayoutCache: WeakMap<object, SplitPaneLayout> = new WeakMap();

/**
 * Read a split-pane layout from the TugbankClient cache.
 *
 * Domain: `dev.tugtool.tugways.split-pane`, key: caller-provided `storageKey`.
 * Returns the layout object, or null if not stored. Lifts the legacy
 * bare-record shape into `{ layout: <record> }` and caches the lift so
 * repeated reads return the same reference.
 */
export function readSplitPaneLayout(
  client: TugbankClient,
  storageKey: string,
): SplitPaneLayout | null {
  const entry = client.get("dev.tugtool.tugways.split-pane", storageKey);
  if (!entry || entry.kind !== "json" || entry.value === undefined) {
    return null;
  }
  const raw = entry.value as object;
  const cached = liftedSplitPaneLayoutCache.get(raw);
  if (cached) return cached;
  const lifted: SplitPaneLayout = isLegacyLayoutShape(raw)
    ? { layout: raw }
    : (raw as SplitPaneLayout);
  liftedSplitPaneLayoutCache.set(raw, lifted);
  return lifted;
}

/**
 * PUT a split-pane layout to tugbank (fire-and-forget).
 *
 * Domain: `dev.tugtool.tugways.split-pane`, key: caller-provided `storageKey`.
 *
 * `keepalive: true` lets the request outlive the page. Callers fire this
 * on sash pointerup, and users frequently reload immediately after
 * dragging; without `keepalive`, the reload cancels the in-flight PUT
 * before it reaches the server and the drag is silently lost.
 */
export function putSplitPaneLayout(storageKey: string, layout: SplitPaneLayout): void {
  const url = `/api/defaults/dev.tugtool.tugways.split-pane/${encodeURIComponent(storageKey)}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: layout }),
    keepalive: true,
  }).catch((err) => {
    console.warn("[settings] PUT splitPaneLayout failed for key", storageKey, err);
  });
}

// ── Dev recent projects ────────────────────────────────────────────────────

/** Maximum number of recent-project paths retained in the quick-pick list. */
export const DEV_RECENT_PROJECTS_MAX = 5;

/**
 * Read the dev-card recent-projects list from the TugbankClient cache.
 *
 * Domain: `dev.tugtool.dev`, key: `recent-projects`.
 * Value shape: `{ paths: string[] }`. Returns `[]` if unset or malformed.
 *
 * The list is keyed by the user-typed project path — the same identifier
 * the picker displays, submits on `spawn_session`, and uses to key the
 * `session-id-by-workspace` map. Session bookkeeping uses a single
 * identifier so every consumer (recents, session-id map, bind
 * payload, tugcode's persistence) reads and writes the same string.
 */
export function readDevRecentProjects(client: TugbankClient): string[] {
  const entry = client.get("dev.tugtool.dev", "recent-projects");
  if (!entry || entry.kind !== "json" || entry.value === undefined) {
    return [];
  }
  const raw = entry.value as { paths?: unknown } | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.paths)) {
    return [];
  }
  return raw.paths.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/**
 * PUT the dev-card recent-projects list to tugbank (fire-and-forget).
 * Callers are responsible for dedup + capping; the helper writes the list
 * verbatim.
 */
export function putDevRecentProjects(paths: string[]): void {
  fetch("/api/defaults/dev.tugtool.dev/recent-projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: { paths } }),
  }).catch((err) => {
    console.warn("[settings] PUT recent-projects failed:", err);
  });
}

/**
 * Prepend `projectDir` onto `existing`, dedup case-sensitively, and cap at
 * `DEV_RECENT_PROJECTS_MAX`. Pure helper so callers can compose the new
 * list before handing it to `putDevRecentProjects`.
 */
export function insertDevRecentProject(existing: string[], projectDir: string): string[] {
  const next = [projectDir, ...existing.filter((p) => p !== projectDir)];
  return next.slice(0, DEV_RECENT_PROJECTS_MAX);
}

/**
 * PUT prompt history for a session to tugbank (fire-and-forget).
 *
 * Domain: `dev.tugtool.prompt.history`, key: `{sessionId}`.
 * Body format: `{ kind: "json", value: [...entries] }`
 */
export function putPromptHistory(sessionId: string, entries: HistoryEntry[]): void {
  const url = `/api/defaults/dev.tugtool.prompt.history/${encodeURIComponent(sessionId)}`;
  logSessionLifecycle("history.put", {
    session_id: sessionId,
    url,
    entry_count: entries.length,
  });
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: entries }),
  }).catch((err) => {
    console.warn("[settings] PUT promptHistory failed for session", sessionId, err);
  });
}

/**
 * GET prompt history for a session from tugbank.
 *
 * Returns the entries array, or an empty array on 404 or parse error.
 *
 * Domain: `dev.tugtool.prompt.history`, key: `{sessionId}`.
 * Response format: `{ kind: "json", value: [...entries] }`
 */
export async function getPromptHistory(sessionId: string): Promise<HistoryEntry[]> {
  const url = `/api/defaults/dev.tugtool.prompt.history/${encodeURIComponent(sessionId)}`;
  try {
    // `cache: "no-store"` defeats the browser HTTP cache. Without it a
    // 404 (or stale 200) from a prior load on the same URL gets reused
    // and the picker silently shows old/empty history after another
    // tugdeck process / card has already pushed new entries.
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 404) {
      logSessionLifecycle("history.get", {
        session_id: sessionId,
        url,
        status: 404,
        entry_count: 0,
      });
      return [];
    }
    const tagged = await response.json() as { kind: string; value: unknown };
    if (tagged.kind === "json" && Array.isArray(tagged.value)) {
      const entries = tagged.value as HistoryEntry[];
      logSessionLifecycle("history.get", {
        session_id: sessionId,
        url,
        status: response.status,
        entry_count: entries.length,
      });
      return entries;
    }
    logSessionLifecycle("history.get", {
      session_id: sessionId,
      url,
      status: response.status,
      entry_count: 0,
    });
    return [];
  } catch (err) {
    console.warn("[settings] GET promptHistory failed for session", sessionId, err);
    return [];
  }
}
