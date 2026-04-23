/**
 * deck-trace.ts — a bounded, in-memory ring buffer of structured deck
 * events, used to reconstruct focus / activation / lifecycle sequences
 * when diagnosing M-series regressions inside the real Tug.app
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
 * not just focus") and Spec [#s01-deck-trace-event] for the event
 * shape's authoritative definition.
 *
 * ## What this step ships
 *
 * Phase 1 Step 1 lands the module seam only: the event union,
 * the ring buffer, and the `record` / `dump` / `dumpTable` / `enable`
 * / `mark` / `since` / `clear` API. No call sites are wired here;
 * that is Step 2's job. The `window.__deckTrace` global is bound so
 * a developer can drive the trace from the Safari Web Inspector
 * console, but only under `import.meta.env.DEV` so the release
 * bundle tree-shakes the binding.
 *
 * ## Enable semantics
 *
 * Recording defaults to OFF. Callers opt in via `enable(true)`; the
 * bug-reproduction flow in Step 3 is `enable(true) → mark() →
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

import type { ActivationTarget } from "./focus-transfer";

// ---------------------------------------------------------------------------
// Event shape (Spec [#s01-deck-trace-event])
// ---------------------------------------------------------------------------

/**
 * The reason an `[A3]` effect body exited before calling `.focus()`.
 * `null` (in the event payload) means the body ran to completion.
 */
export type A3EarlyReturn =
  | "first-run"
  | "not-destination"
  | "prev-was-true"
  | "no-host"
  | "no-bag"
  | "gate-refused";

/** Source tag on `save-callback` events — matches the plan's wiring list. */
export type SaveCallbackSource =
  | "close-handoff"
  | "debounced"
  | "visibilitychange"
  | "beforeunload"
  | "manual";

/** Entry-point tag on `selection-restore` events. */
export type SelectionRestoreVia =
  | "restoreCardDomSelection"
  | "applyFocusSnapshot";

/**
 * The tagged union of events recordable in the deck trace. Every
 * event variant carries `{ timestamp, seq }` in addition to its
 * kind-specific payload; `timestamp` is `performance.now()` (or
 * `Date.now()` when `performance` is unavailable), `seq` is a
 * module-scoped monotonic counter.
 *
 * String-valued element fields (e.g. `focusin.el`) are formatted by
 * {@link formatElement} into `tag#id.class[data-card-id=foo]`-style
 * strings at record time so the trace never retains live DOM
 * references past the recording moment.
 */
export type DeckTraceEvent = { timestamp: number; seq: number } & (
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
      kind: "a3-fire";
      cardId: string;
      isFirstRun: boolean;
      prev: boolean;
      now: boolean;
      earlyReturn: A3EarlyReturn | null;
      gatePassed: boolean | null;
      target: ActivationTarget | null;
      focusedEl: string | null;
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
);

/**
 * The payload shape of {@link DeckTrace.record} — the caller provides
 * the variant-specific fields; the module stamps `timestamp` and
 * `seq` on ingest.
 */
export type DeckTraceEventInput =
  | Omit<Extract<DeckTraceEvent, { kind: "fr-flip" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "destination-flip" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "card-host-mount" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "card-host-unmount" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "a3-fire" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "focus-call" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "focusin" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "focusout" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "save-callback" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "selection-restore" }>, "timestamp" | "seq">
  | Omit<Extract<DeckTraceEvent, { kind: "commit-tick" }>, "timestamp" | "seq">;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Ring capacity. Fixed per Spec [#s01-deck-trace-event]. A 512-entry
 * ring holds roughly a few seconds of dense interaction; more than
 * enough to span any M-series reproduction window and short enough
 * that a dev reading `dumpTable()` is not overwhelmed.
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
 *   - `data-tug-persist-value`
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
    "data-tug-persist-value",
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

function appendEvent(input: DeckTraceEventInput): void {
  const stamped = {
    ...input,
    timestamp: now(),
    seq: ++seqCounter,
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
 * Public surface exposed to the wiring sites (Step 2) and to
 * developers via `window.__deckTrace` (dev builds only).
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
 * The module's singleton trace instance. Imported by Step 2 wiring
 * sites as `import { deckTrace } from "./deck-trace"`.
 */
export const deckTrace: DeckTrace = {
  record(event) {
    if (!enabled) return;
    appendEvent(event);
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
    enabled = flag === true;
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
// remain available to callers that import them directly (Step 2
// wiring sites); only the global handle is dev-gated.
if (import.meta.env?.DEV === true && typeof window !== "undefined") {
  window.__deckTrace = deckTrace;
}
