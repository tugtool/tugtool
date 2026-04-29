/**
 * deck-trace.ts — a bounded, in-memory ring buffer of structured deck
 * events, used to reconstruct focus / activation / lifecycle sequences
 * when diagnosing AT-series regressions inside the real Tug.app
 * WKWebView.
 *
 * ## Why this exists
 *
 * Our production focus bugs are rarely bugs in the focus-calling code
 * itself. They are bugs in why the focus-calling code never runs: an
 * `[A3]` mount-guard that early-returns on its first frame after a
 * destination flip, a `save-callback` that fires from the wrong
 * trigger, a `card-host` that mounts or unmounts a frame later than
 * expected. A narrow `focus-trace` cannot tell "the effect body
 * early-returned" from "the effect body ran but chose the wrong
 * target". A whole-deck trace can.
 *
 * This module records, in order, every focus-adjacent event that
 * matters: first-responder flips, destination-flips (the per-card view
 * of focus-destination bit transitions), `<CardHost>` mount / unmount,
 * every `[A3]` activation-effect run (including early-returns, tagged
 * with the reason), every `.focus()` call site, document-level
 * `focusin` / `focusout`, save callbacks (with the triggering source),
 * selection-restore entries, and a per-commit `commit-tick` beacon so
 * we can align events with React commit boundaries.
 *
 * See Design Decision [D06] ("Instrumentation covers the whole deck,
 * not just focus") for the instrumentation philosophy; the event union
 * below is the contract for consumers.
 *
 * ## API surface
 *
 * This module provides the event union, the ring buffer, and
 * `record` / `dump` / `dumpTable` / `enable` / `mark` / `since` /
 * `clear`. Call sites in the deck install separately. The
 * `window.__deckTrace` global is bound so a developer can drive the
 * trace from the Safari Web Inspector console, but only under
 * `import.meta.env.DEV` so the release bundle tree-shakes the binding.
 *
 * ## Enable semantics
 *
 * Recording defaults to OFF. Callers opt in via `enable(true)`; a
 * typical flow is `enable(true) → mark() →
 * interact → dumpTable()`. While `enabled === false`, `record` is a
 * single bounds-check and return — callers may leave `record` calls
 * in hot paths without metering concerns. `mark`, `since`, `clear`,
 * and `dump` remain callable regardless of the enable flag (they do
 * not write new events); toggling `enable` never clears the existing
 * buffer.
 *
 * ## Bounded ring
 *
 * Capacity is 512 entries. When the 513th event is recorded, the
 * oldest is evicted. The `seq` counter is monotonic over the process
 * lifetime (never rewound) so `since(lastSeq)` returns a strictly
 * forward slice even across evictions; eviction does not renumber.
 *
 * The ring is stored as a pre-allocated array with a head pointer and
 * a `full` flag; we avoid `Array.prototype.shift` (which is O(n) on
 * dense arrays in most engines) by writing in place and re-ordering
 * on `dump`. `dump` returns a fresh array so callers can safely
 * mutate their copy without disturbing the ring.
 *
 * ## Tuglaws
 *
 *   - **L10** — this module owns exactly one responsibility (record
 *     + expose deck events for diagnostic trace).
 *   - **L06** — the module never drives React state; dev-only
 *     diagnostic side effects (console output, DOM access by
 *     serializers) are one-way.
 *
 * @module deck-trace
 */

import { getDeckStore } from "./lib/deck-store-registry";
import { isFocusDestination } from "./deck-store-selectors";

// ---------------------------------------------------------------------------
// Event shape (`DeckTraceEvent` union)
// ---------------------------------------------------------------------------

/**
 * Source tag on `save-callback` events.
 *
 * Production tags fire from real lifecycle moments — card close
 * (`"close-handoff"`), debounced auto-save (`"debounced"`),
 * visibility change (`"visibilitychange"`, fires on cmd-tab away or
 * app hide), page unload (`"beforeunload"`), window blur
 * (`"window-blur"`), and explicit manual saves (`"manual"`).
 *
 * Dev-only tags (`"hmr"`, `"hmr-full-reload"`) fire from the Vite
 * HMR pipeline so the trace ring records HMR-driven save passes
 * with a distinct source for observability. They are dead code in
 * production bundles — `import.meta.hot` is `undefined` outside
 * `vite dev`, so the handlers that emit these tags never run.
 */
export type SaveCallbackSource =
  | "close-handoff"
  | "debounced"
  | "visibilitychange"
  | "beforeunload"
  | "window-blur"
  | "manual"
  | "hmr"
  | "hmr-full-reload";

/** Entry-point tag on `selection-restore` events. */
export type SelectionRestoreVia =
  | "restoreCardDomSelection"
  | "applyFocusSnapshot";

/**
 * Snapshot of the DeckManager store at the moment a trace event is
 * recorded. Surfaces the pieces of state that drive activation /
 * first-responder decisions so an ordering diagnosis ("did
 * destination-flip fire while the store still thought A was active?")
 * does not require inferring state transitions from adjacent events.
 *
 * Null when `getDeckStore()` returns null — i.e. the trace module
 * recorded an event before the `DeckManager` constructor ran and
 * registered its store. This is a transient pre-registration state
 * during boot; once any pane is mounted, the snapshot is populated
 * on every subsequent record call.
 *
 * `activeCardId` is derived: it is the `activeCardId` of the pane
 * whose id equals `activePaneId`. Null when no active pane exists
 * or when the active pane has no active card.
 *
 * `hasFocus` mirrors `state.hasFocus` — whether the tugdeck window
 * owns OS foreground focus. `isFocusDestination(cardId)` returns
 * true only when `hasFocus === true` and `cardId === activeCardId`;
 * matcher readers can reconstruct that bit from the snapshot alone.
 */
export interface DeckTraceStoreSnapshot {
  activePaneId: string | null;
  activeCardId: string | null;
  hasFocus: boolean;
}

/**
 * The tagged union of events recordable in the deck trace. Every
 * event variant carries `{ timestamp, seq, loc?, store? }` in addition
 * to its kind-specific payload; `timestamp` is `performance.now()` (or
 * `Date.now()` when `performance` is unavailable), `seq` is a
 * module-scoped monotonic counter, `loc` is the caller's `file.tsx:line:col`
 * captured via `new Error().stack` at record time (empty string when
 * the engine does not expose a usable stack frame), `store` is a
 * {@link DeckTraceStoreSnapshot} captured synchronously at record
 * time (null when no store is registered).
 *
 * String-valued element fields (e.g. `focusin.el`) are formatted by
 * {@link formatElement} into `tag#id.class[data-card-id=foo]`-style
 * strings at record time so the trace never retains live DOM
 * references past the recording moment.
 */
export type DeckTraceEvent = {
  timestamp: number;
  seq: number;
  loc?: string;
  store?: DeckTraceStoreSnapshot | null;
} & (
  | {
      kind: "fr-flip";
      from: string | null;
      to: string | null;
      trigger: string;
    }
  | {
      kind: "destination-flip";
      cardId: string;
      from: boolean;
      to: boolean;
    }
  | {
      kind: "card-host-mount";
      cardId: string;
      hostStackId: string;
    }
  | {
      kind: "card-host-unmount";
      cardId: string;
      hostStackId: string;
    }
  | {
      kind: "focus-call";
      site: string;
      cardId: string;
      targetSelector: string;
      activeBefore: string;
      activeAfter: string;
      hidden: boolean;
    }
  | {
      kind: "focusin";
      el: string;
      relatedTarget: string | null;
    }
  | {
      kind: "focusout";
      el: string;
      relatedTarget: string | null;
    }
  | {
      kind: "save-callback";
      cardId: string;
      source: SaveCallbackSource;
    }
  | {
      kind: "selection-restore";
      cardId: string;
      via: SelectionRestoreVia;
    }
  | {
      kind: "commit-tick";
      count: number;
    }
  | {
      // Fired by EM-engine factories once their engine has finished
      // mounting and is ready to accept input / publish state.
      // `engine` tags the factory ("tug-prompt-input", "tide-card",
      // "gallery-prompt-entry"). Used by harness tests to gate
      // assertions on engine-state surface methods.
      kind: "engine-ready";
      cardId: string;
      engine: string;
    }
  | {
      // Fired when an EM-engine factory's `onCardActivated` callback
      // runs as a result of an activation gesture. `dispatchedFrom`
      // names the trigger row from the activation taxonomy
      // activation-trigger trace sites. Wired at each
      // factory's onCardActivated registration; event shape is
      // defined here, per-card wiring is incremental.
      kind: "engine-activation-dispatched";
      cardId: string;
      engine: string;
      dispatchedFrom: string;
    }
  | {
      // Fired from `CardHost.registerStatePreservationCallbacks` immediately
      // before the persisted `bag.content` is forwarded to the
      // factory's `onRestore`. Captures what the framework knows about
      // the saved state on the cold-boot / cross-pane-mount path:
      // whether `bag.content` is populated and, for EM cards using the
      // engine-state shape, whether a non-null selection range is
      // present in the saved snapshot. Diagnostic for the cold-boot
      // selection-paint gap — lets a
      // trace dump show whether the save side captured a selection at
      // all before any restore work runs.
      kind: "cold-boot-restore-snapshot";
      cardId: string;
      hasContent: boolean;
      engineSelection: { start: number; end: number } | null;
    }
  | {
      // Fired from each EM factory's onRestore implementation
      // immediately after the engine's `restoreState` returns, with
      // `selectionApplied` echoing what was passed in (the saved
      // selection from the bag) and `domSelectionAfter` reading
      // `engine.getSelectedRange()` against the live DOM. Side-by-side
      // these two fields say whether the engine's `setSelectedRange`
      // actually landed the selection in the document. Diagnostic for
      // inactive-paint gap.
      kind: "engine-restore-applied";
      cardId: string;
      engine: string;
      selectionApplied: { start: number; end: number } | null;
      domSelectionAfter: { start: number; end: number } | null;
    }
);

/**
 * The payload shape of {@link DeckTrace.record} — the caller provides
 * the variant-specific fields; the module stamps `timestamp`, `seq`,
 * `loc`, and `store` on ingest.
 */
type StampedFields = "timestamp" | "seq" | "loc" | "store";
export type DeckTraceEventInput =
  | Omit<Extract<DeckTraceEvent, { kind: "fr-flip" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "destination-flip" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "card-host-mount" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "card-host-unmount" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "focus-call" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "focusin" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "focusout" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "save-callback" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "selection-restore" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "commit-tick" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "engine-ready" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "engine-activation-dispatched" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "cold-boot-restore-snapshot" }>, StampedFields>
  | Omit<Extract<DeckTraceEvent, { kind: "engine-restore-applied" }>, StampedFields>;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Ring capacity. Fixed at 512 entries — enough to span typical
 * AT-series reproductions while keeping `dumpTable()` output readable.
 */
export const DECK_TRACE_CAPACITY = 512;

/**
 * Serialize a DOM element (or `null`) to a stable short string for
 * the trace. Shape: `tag#id.class[data-card-id=foo]` — tag is always
 * present; `#id` / `.class*` / selected data-attrs are appended when
 * available. The function must be side-effect-free and tolerant of
 * detached / unusual nodes (e.g. `document`, `Window`); callers may
 * hand in arbitrary focus targets.
 *
 * Data attributes prioritized into the label:
 *   - `data-card-id`
 *   - `data-card-host`
 *   - `data-tug-focus-key`
 *   - `data-tug-state-key`
 *
 * Non-Element inputs (Document, Window, null) collapse to a
 * descriptive tag: `#document`, `#window`, or the empty string for
 * null. We never throw; serialization must not break a trace record.
 */
export function formatElement(el: EventTarget | Element | null): string {
  if (el === null) return "";
  if (typeof Document !== "undefined" && el instanceof Document) return "#document";
  if (typeof Window !== "undefined" && el instanceof Window) return "#window";

  const node = el as Element;
  if (typeof node.tagName !== "string") {
    // Fallback for EventTargets that are not Elements (XHR, AbortSignal, ...).
    return "#non-element";
  }

  let out = node.tagName.toLowerCase();
  const id = node.id;
  if (id) out += `#${id}`;

  const className = node.getAttribute?.("class");
  if (className) {
    const classes = className
      .split(/\s+/)
      .filter((c) => c.length > 0)
      .slice(0, 3);
    if (classes.length > 0) out += `.${classes.join(".")}`;
  }

  const dataKeys = [
    "data-card-id",
    "data-card-host",
    "data-tug-focus-key",
    "data-tug-state-key",
  ];
  const attrs: string[] = [];
  for (const key of dataKeys) {
    const value = node.getAttribute?.(key);
    if (typeof value === "string") {
      attrs.push(`${key}=${value}`);
    }
  }
  if (attrs.length > 0) out += `[${attrs.join(",")}]`;
  return out;
}

function now(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

/**
 * Pluck the last `*.ts` / `*.tsx` `file:line:col` match out of a stack
 * frame string. Tolerant of both V8 format (`    at name (url:line:col)`)
 * and JSC format (`name@url:line:col`) — both end with `:line:col` and
 * both can be scanned for the trailing `.ts[x]` file token.
 *
 * Returns `null` when no match — the caller falls through to the next
 * frame or returns an empty-string loc.
 */
function extractLocFromFrame(frame: string): string | null {
  const matches = [...frame.matchAll(/([A-Za-z0-9._-]+\.tsx?):(\d+):(\d+)/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1]!;
  return `${last[1]}:${last[2]}:${last[3]}`;
}

/**
 * Capture the caller's `file.tsx:line:col` at record time via
 * `new Error().stack`. Walks frames until it finds one that does not
 * reference `deck-trace` (the module's own call sites), then extracts
 * the short form via {@link extractLocFromFrame}.
 *
 * Returns the empty string when the engine does not expose a usable
 * stack (older browsers, edge-case synthetic calls). The `loc` field
 * on `DeckTraceEvent` is typed as optional so matchers can accept
 * empty-string locations without tightening their assertions.
 */
function captureCallerLoc(): string {
  let stack: string | undefined;
  try {
    stack = new Error().stack;
  } catch {
    return "";
  }
  if (typeof stack !== "string") return "";
  const lines = stack.split("\n");
  // Skip frames inside deck-trace.ts itself; do NOT skip `deck-trace.test.ts`
  // or other files that merely share the prefix. The trailing `:` anchors
  // the match to the file-colon-line form on both V8 and JSC stacks.
  for (const line of lines) {
    if (line.includes("deck-trace.ts:")) continue;
    const loc = extractLocFromFrame(line);
    if (loc !== null) return loc;
  }
  return "";
}

/**
 * Capture a {@link DeckTraceStoreSnapshot} synchronously at record
 * time. Returns `null` when the deck store registry has not yet
 * bound a store (pre-DeckManager boot) or when the snapshot throws
 * unexpectedly — both are transient conditions we tolerate rather
 * than propagating up into the caller's record call.
 *
 * Derives `activeCardId` by looking up the active pane's `activeCardId`
 * in `state.panes` — this matches {@link isFocusDestination}'s model
 * exactly, so readers of the trace can reconstruct "was this card the
 * focus destination at record time?" from the snapshot alone.
 */
function captureStoreSnapshot(): DeckTraceStoreSnapshot | null {
  const store = getDeckStore();
  if (store === null) return null;
  try {
    const state = store.getSnapshot();
    const activePaneId = state.activePaneId ?? null;
    let activeCardId: string | null = null;
    if (activePaneId !== null) {
      const pane = state.panes.find((p) => p.id === activePaneId);
      activeCardId = pane?.activeCardId ?? null;
    }
    return {
      activePaneId,
      activeCardId,
      hasFocus: state.hasFocus,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ring buffer + public API
// ---------------------------------------------------------------------------

/**
 * The live ring. Pre-allocated to {@link DECK_TRACE_CAPACITY} entries
 * once we have observed at least one record; until then `buffer` is
 * empty and we push. After the first wrap we overwrite at `head`.
 *
 * `buffer.length <= DECK_TRACE_CAPACITY` is an invariant. When `full`
 * is true `buffer.length === DECK_TRACE_CAPACITY` and `head` is the
 * index of the oldest (next-to-evict) entry.
 */
const buffer: DeckTraceEvent[] = [];
let head = 0;
let full = false;

/** Monotonic sequence counter. Never rewound; survives eviction. */
let seqCounter = 0;

/** Recording gate. `record` short-circuits when this is false. */
let enabled = false;

function appendEvent(
  input: DeckTraceEventInput,
  loc: string,
  store: DeckTraceStoreSnapshot | null,
): void {
  const stamped = {
    ...input,
    timestamp: now(),
    seq: ++seqCounter,
    loc,
    store,
  } as DeckTraceEvent;
  if (full) {
    buffer[head] = stamped;
    head = (head + 1) % DECK_TRACE_CAPACITY;
  } else {
    buffer.push(stamped);
    if (buffer.length === DECK_TRACE_CAPACITY) {
      full = true;
      head = 0;
    }
  }
}

function readOrdered(): DeckTraceEvent[] {
  if (!full) return buffer.slice();
  const out: DeckTraceEvent[] = new Array<DeckTraceEvent>(DECK_TRACE_CAPACITY);
  for (let i = 0; i < DECK_TRACE_CAPACITY; i++) {
    out[i] = buffer[(head + i) % DECK_TRACE_CAPACITY]!;
  }
  return out;
}

/**
 * Public surface exposed to deck wiring and to developers via
 * `window.__deckTrace` (dev builds only).
 *
 * All methods are safe to call regardless of the enable flag — the
 * flag gates only whether {@link DeckTrace.record} writes new events.
 */
export interface DeckTrace {
  /**
   * Record an event. No-op when `enable(false)`; under `enable(true)`
   * the call stamps `timestamp` and `seq` and appends to the ring.
   */
  record(event: DeckTraceEventInput): void;
  /** Return a fresh array of every event currently in the ring, oldest-first. */
  dump(): readonly DeckTraceEvent[];
  /**
   * Pretty-print the ring as a table to the console. Intended for
   * `window.__deckTrace.dumpTable()` during manual reproduction.
   */
  dumpTable(): void;
  /**
   * Toggle recording. When called with `true`, subsequent `record`
   * calls write to the ring. When called with `false`, subsequent
   * `record` calls short-circuit. Does NOT clear the existing
   * buffer.
   */
  enable(flag: boolean): void;
  /**
   * Return the current sequence counter. Paired with
   * {@link DeckTrace.since} to slice "events since this mark".
   */
  mark(): number;
  /**
   * Return only events whose `seq` is strictly greater than `seq`.
   * Returns a fresh array.
   */
  since(seq: number): readonly DeckTraceEvent[];
  /**
   * Empty the ring and reset the head pointer. Preserves the
   * `seqCounter` (so successive `since(oldMark)` calls still return
   * a strictly forward slice) and preserves the enable flag.
   */
  clear(): void;
}

/**
 * The module's singleton trace instance. Imported by deck wiring as
 * `import { deckTrace } from "./deck-trace"`.
 */
export const deckTrace: DeckTrace = {
  record(event) {
    if (!enabled) return;
    const loc = captureCallerLoc();
    const store = captureStoreSnapshot();
    appendEvent(event, loc, store);
  },
  dump() {
    return readOrdered();
  },
  dumpTable() {
    const rows = readOrdered();
    if (typeof console !== "undefined" && typeof console.table === "function") {
      console.table(rows);
    } else if (typeof console !== "undefined") {
      console.log(rows);
    }
  },
  enable(flag) {
    const next = flag === true;
    if (next === enabled) return;
    enabled = next;
    if (next) {
      installObservers();
    } else {
      uninstallObservers();
    }
  },
  mark() {
    return seqCounter;
  },
  since(seq) {
    const rows = readOrdered();
    const out: DeckTraceEvent[] = [];
    for (const e of rows) {
      if (e.seq > seq) out.push(e);
    }
    return out;
  },
  clear() {
    buffer.length = 0;
    head = 0;
    full = false;
  },
};

// ---------------------------------------------------------------------------
// Observers — destination-flip + document-level focusin/focusout
// ---------------------------------------------------------------------------
//
// The observers attach on `enable(true)` and detach on `enable(false)` so
// traces reflect real user-driven transitions without the instrumentation
// incurring cost when disabled. Both observers are idempotent and safe to
// invoke repeatedly.
//
// **Destination-flip observer.** Subscribes to the deck store and, on
// every notify, diffs `isFocusDestination(cardId)` per known card against
// the previous reading. Flipped cards emit one `destination-flip` event
// each. The per-card prior-state map is reset to the store's current
// readings on install so the first post-install notify does not emit a
// flood of spurious transitions.
//
// **Focusin / focusout observer.** Document-level capture-phase listeners
// record external focus moves (including those WebKit drives back after
// the deck's own focus() call), so a reader of `dumpTable()` can see
// every time the browser committed a focus change — not just the ones
// our own code authored.

/**
 * Module-scope state for the destination-flip observer. `null` when not
 * installed; populated with the store-unsubscribe handle and the
 * previous-readings map while installed.
 */
let destinationFlipDispose: (() => void) | null = null;

/**
 * Module-scope state for the focus-capture observer. `null` when not
 * installed; populated with a disposer that removes both document-level
 * listeners while installed.
 */
let focusObserverDispose: (() => void) | null = null;

/**
 * Build the per-card focus-destination readings from the current deck
 * store snapshot. Used as the baseline on observer install so that the
 * first post-install notify does not emit `destination-flip` events for
 * every card (they've all been "flipped from unknown to their current
 * value" in the eyes of a fresh diff map).
 */
function snapshotDestinations(): Map<string, boolean> {
  const readings = new Map<string, boolean>();
  const store = getDeckStore();
  if (!store) return readings;
  const state = store.getSnapshot();
  for (const card of state.cards) {
    readings.set(card.id, isFocusDestination(card.id, state));
  }
  return readings;
}

function installDestinationFlipObserver(): void {
  if (destinationFlipDispose !== null) return;
  const store = getDeckStore();
  if (!store) return;
  const prevReadings = snapshotDestinations();
  const unsubscribe = store.subscribe(() => {
    const state = store.getSnapshot();
    // Include every card currently in the deck, plus any card we had
    // been tracking that has since been removed (so a removed card's
    // last true-reading flips to false exactly once).
    const seen = new Set<string>();
    for (const card of state.cards) {
      seen.add(card.id);
      const now = isFocusDestination(card.id, state);
      const prev = prevReadings.get(card.id) ?? false;
      if (prev !== now) {
        deckTrace.record({
          kind: "destination-flip",
          cardId: card.id,
          from: prev,
          to: now,
        });
        prevReadings.set(card.id, now);
      } else if (!prevReadings.has(card.id)) {
        prevReadings.set(card.id, now);
      }
    }
    for (const [cardId, prev] of prevReadings) {
      if (seen.has(cardId)) continue;
      if (prev) {
        deckTrace.record({
          kind: "destination-flip",
          cardId,
          from: true,
          to: false,
        });
      }
      prevReadings.delete(cardId);
    }
  });
  destinationFlipDispose = () => {
    unsubscribe();
    prevReadings.clear();
  };
}

function installFocusObserver(): void {
  if (focusObserverDispose !== null) return;
  if (typeof document === "undefined") return;
  const handleFocusIn = (ev: FocusEvent): void => {
    deckTrace.record({
      kind: "focusin",
      el: formatElement(ev.target ?? null),
      relatedTarget:
        ev.relatedTarget !== null ? formatElement(ev.relatedTarget) : null,
    });
  };
  const handleFocusOut = (ev: FocusEvent): void => {
    deckTrace.record({
      kind: "focusout",
      el: formatElement(ev.target ?? null),
      relatedTarget:
        ev.relatedTarget !== null ? formatElement(ev.relatedTarget) : null,
    });
  };
  document.addEventListener("focusin", handleFocusIn, { capture: true });
  document.addEventListener("focusout", handleFocusOut, { capture: true });
  focusObserverDispose = () => {
    document.removeEventListener("focusin", handleFocusIn, { capture: true });
    document.removeEventListener("focusout", handleFocusOut, { capture: true });
  };
}

function installObservers(): void {
  installDestinationFlipObserver();
  installFocusObserver();
}

function uninstallObservers(): void {
  destinationFlipDispose?.();
  destinationFlipDispose = null;
  focusObserverDispose?.();
  focusObserverDispose = null;
}

// ---------------------------------------------------------------------------
// `window.__deckTrace` binding — DEV only
// ---------------------------------------------------------------------------

/**
 * Global `window.__deckTrace` handle for ad-hoc reproduction from
 * the Safari Web Inspector console. Typed via `declare global` so
 * the assignment does not need to route through `Record<string,
 * unknown>`.
 */
declare global {
  interface Window {
    __deckTrace?: DeckTrace;
  }
}

// Bind only under `import.meta.env.DEV` so Vite's release bundle
// tree-shakes the binding entirely. The module's other exports
// remain available to callers that import them directly; only the
// global handle is dev-gated.
if (import.meta.env?.DEV === true && typeof window !== "undefined") {
  window.__deckTrace = deckTrace;
}
