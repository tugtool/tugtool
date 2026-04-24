/**
 * client.ts — Typed wrappers around `evalJS` / `waitForCondition`.
 *
 * Scope of this module
 * --------------------
 * Pure helpers that serialize a call into the shape
 * `window.__tug.<method>(...)` (parent plan Spec [#s03-tug-surface])
 * and hand it to the transport. `App` (see `./index.ts`) delegates
 * its public methods here so the wire-format logic lives in one
 * testable place.
 *
 * Every helper takes the {@link HarnessCaller} transport — a minimal
 * `{ evalJS, waitForCondition }` pair — as its first argument rather
 * than a full `App`. That keeps the helpers easy to unit-test with a
 * mock caller and avoids a cyclic import between `client.ts` and
 * `index.ts`.
 *
 * Nothing in this file uses `setTimeout` / `setInterval` — every
 * wait-style assertion is expressed as a `waitForCondition` over a
 * pure boolean expression. Parent plan [D12] ban.
 */

import type { EvalJsOptions, WaitForConditionOptions } from "./types";

// ---------------------------------------------------------------------------
// Mirrored surface types
//
// These shapes MIRROR `tugdeck/src/test-surface.ts` and
// `tugdeck/src/deck-trace.ts`. We declare them locally (rather than
// `import type`-ing from the tugdeck source) so the `tests/in-app/`
// tsc run does not have to type-check the full tugdeck React/DOM
// graph. Drift is caught at handshake time via the surface-version
// check (parent plan [D11]); the bridge's `SURFACE_VERSION` is the
// single source of truth for wire-compat.
//
// When tugdeck's `SURFACE_VERSION` bumps, the matching shapes here
// must be hand-updated (parent plan follow-up for every bump).
// ---------------------------------------------------------------------------

/** Mirrors `tugdeck/src/test-surface.ts` → `CaretState`. */
export type CaretState =
  | {
      kind: "input";
      selectionStart: number;
      selectionEnd: number;
      selectionDirection: "forward" | "backward" | "none";
      value: string;
    }
  | {
      kind: "range";
      anchorPath: readonly number[];
      anchorOffset: number;
      focusPath: readonly number[];
      focusOffset: number;
      text: string;
    };

/** Mirrors `tugdeck/src/test-surface.ts` → `ClickOptions`. */
export interface ClickOptions {
  clientX?: number;
  clientY?: number;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/** Mirrors `tugdeck/src/test-surface.ts` → `ResetOptions`. */
export interface ResetOptions {
  /** Clear DeckState back to empty. */
  deck?: boolean;
  /** Clear registered selection boundaries + pinned card ranges. */
  selectionGuard?: boolean;
  /** Drop per-card Component Persistence Protocol registries. */
  orchestrator?: boolean;
  /** `deckTrace.clear()`. Preserves the enable flag. */
  trace?: boolean;
  /** Wipe `localStorage` and scoped IndexedDB stores. */
  storage?: boolean;
}

/**
 * Mirrors `tugdeck/src/test-surface.ts` → `SeedDeckStateArgs`.
 *
 * `state` and `cardStates` stay as opaque records here: the harness
 * never inspects them — it forwards them as JSON to the page. Tests
 * that want a typed constructor should build values with a local
 * factory and pass them through.
 */
export interface SeedDeckStateArgs {
  state: unknown;
  cardStates?: Record<string, unknown>;
  focusCardId?: string;
}

/**
 * Mirrors `tugdeck/src/deck-trace.ts` → `DeckTraceEvent`. The wrapper
 * types here are the superset union — tests match on partial shapes
 * via `toContainOrderedSubset` so we do not need the exact
 * narrow-per-kind types to stay in lockstep. The `kind` field is
 * authoritative.
 */
export type DeckTraceEvent = {
  readonly timestamp: number;
  readonly seq: number;
  readonly kind: string;
  readonly [k: string]: unknown;
};

// ---------------------------------------------------------------------------
// Caller interface
// ---------------------------------------------------------------------------

/**
 * Minimal transport the client helpers need. Anything that can
 * round-trip `evalJS` / `waitForCondition` satisfies this shape,
 * which keeps unit tests free from subprocess plumbing.
 */
export interface HarnessCaller {
  evalJS<T = unknown>(script: string, opts?: EvalJsOptions): Promise<T>;
  waitForCondition<T = unknown>(
    script: string,
    opts?: WaitForConditionOptions,
  ): Promise<T>;
}

// ---------------------------------------------------------------------------
// Script-fragment helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a value as a JavaScript expression. Uses `JSON.stringify`
 * which covers every value the surface accepts (selectors, cardIds,
 * DeckState, CardStateBag records). `undefined` becomes the bare
 * token `undefined` so method calls preserve "omitted" semantics.
 */
function lit(v: unknown): string {
  if (v === undefined) return "undefined";
  return JSON.stringify(v);
}

/**
 * Wrap a surface call in the standard access path. Throws a helpful
 * error if `window.__tug` is absent — that means the page is not in
 * test mode (see parent plan Spec [#s03-tug-surface] DEV gate).
 *
 * The check is cheap on the page-side (`typeof window.__tug`) and
 * stabilizes the error message shape so harness code doesn't need to
 * depend on Swift's error-translation layer for the "not attached" case.
 */
function callSurface(script: string): string {
  // Defensive IIFE. Two responsibilities:
  // 1. Prevent "return outside function" under evalJS try/catch wrapping.
  // 2. Coerce `undefined` results to `null`. WKWebView's evaluateJavaScript
  //    rejects `undefined` with "JavaScript execution returned a result of
  //    an unsupported type" — so void surface methods (enableDeckTrace,
  //    click, focusElement, reset, seedDeckState, ...) must not leak
  //    their undefined return through.
  return `(function(){\n  if (typeof window.__tug === "undefined") {\n    throw new Error("[tug] window.__tug is not attached (is the page in test mode?)");\n  }\n  var __r = ${script};\n  return typeof __r === "undefined" ? null : __r;\n})()`;
}

// ---------------------------------------------------------------------------
// Gesture wrappers (Spec [#s04-event-synthesis])
// ---------------------------------------------------------------------------

/**
 * Dispatch the full pointerdown → mousedown → pointerup → mouseup →
 * click sequence on the element matched by `selector`. Prefer this
 * over direct DOM clicks — production handlers condition on the full
 * sequence (not just `click`).
 */
export function click(
  caller: HarnessCaller,
  selector: string,
  opts?: ClickOptions,
  evalOpts?: EvalJsOptions,
): Promise<void> {
  const script = callSurface(
    `window.__tug.click(${lit(selector)}, ${lit(opts)})`,
  );
  return caller.evalJS<void>(script, evalOpts);
}

/**
 * Type `text` into the input/textarea matched by `selector` using
 * the native-setter pattern (Spec [#s04-event-synthesis]). React
 * sees each character's InputEvent.
 */
export function type_(
  caller: HarnessCaller,
  selector: string,
  text: string,
  evalOpts?: EvalJsOptions,
): Promise<void> {
  const script = callSurface(
    `window.__tug.type(${lit(selector)}, ${lit(text)})`,
  );
  return caller.evalJS<void>(script, evalOpts);
}

/**
 * Directly `.focus()` the element matched by `selector`. Escape
 * hatch for the `isTrusted`-gated browser-default focus path (parent
 * plan [D09] fidelity limits).
 */
export function focusElement(
  caller: HarnessCaller,
  selector: string,
  evalOpts?: EvalJsOptions,
): Promise<void> {
  const script = callSurface(
    `window.__tug.focusElement(${lit(selector)})`,
  );
  return caller.evalJS<void>(script, evalOpts);
}

// ---------------------------------------------------------------------------
// Reset / seed wrappers
// ---------------------------------------------------------------------------

/**
 * Granular reset per {@link ResetOptions}. Each axis defaults to
 * false; callers opt in exactly what a test case needs (parent plan
 * [D01]).
 */
export function reset(
  caller: HarnessCaller,
  opts: ResetOptions,
  evalOpts?: EvalJsOptions,
): Promise<void> {
  const script = callSurface(`window.__tug.reset(${lit(opts)})`);
  return caller.evalJS<void>(script, evalOpts);
}

/**
 * Replace `DeckState` atomically and (optionally) merge card-state
 * bags / run cold-boot focus restore. Thin wrapper over
 * `DeckManager.seedDeckState`.
 */
export function seedDeckState(
  caller: HarnessCaller,
  args: SeedDeckStateArgs,
  evalOpts?: EvalJsOptions,
): Promise<void> {
  const script = callSurface(`window.__tug.seedDeckState(${lit(args)})`);
  return caller.evalJS<void>(script, evalOpts);
}

// ---------------------------------------------------------------------------
// State reads
// ---------------------------------------------------------------------------

/**
 * Read the current "active card" (first-responder card) id.
 */
export function getActiveCardId(
  caller: HarnessCaller,
  evalOpts?: EvalJsOptions,
): Promise<string | null> {
  const script = callSurface(`window.__tug.getActiveCardId()`);
  return caller.evalJS<string | null>(script, evalOpts);
}

/**
 * Read the current focused card id (the card the deck marks as
 * holding DOM focus).
 */
export function getFocusedCardId(
  caller: HarnessCaller,
  evalOpts?: EvalJsOptions,
): Promise<string | null> {
  const script = callSurface(`window.__tug.getFocusedCardId()`);
  return caller.evalJS<string | null>(script, evalOpts);
}

/**
 * Read the caret / selection snapshot for `cardId`. Returns `null`
 * when the card has no registered host root or no classifiable caret
 * state.
 */
export function getCaretState(
  caller: HarnessCaller,
  cardId: string,
  evalOpts?: EvalJsOptions,
): Promise<CaretState | null> {
  const script = callSurface(
    `window.__tug.getCaretState(${lit(cardId)})`,
  );
  return caller.evalJS<CaretState | null>(script, evalOpts);
}

/**
 * Read the value of a persisted form control by its
 * `data-tug-persist-value` key.
 */
export function getFormControlValue(
  caller: HarnessCaller,
  cardId: string,
  persistKey: string,
  evalOpts?: EvalJsOptions,
): Promise<string | null> {
  const script = callSurface(
    `window.__tug.getFormControlValue(${lit(cardId)}, ${lit(persistKey)})`,
  );
  return caller.evalJS<string | null>(script, evalOpts);
}

/**
 * Return `true` iff the deck has registered a card-host root for
 * `cardId`.
 */
export function assertHostRootRegistered(
  caller: HarnessCaller,
  cardId: string,
  evalOpts?: EvalJsOptions,
): Promise<boolean> {
  const script = callSurface(
    `window.__tug.assertHostRootRegistered(${lit(cardId)})`,
  );
  return caller.evalJS<boolean>(script, evalOpts);
}

// ---------------------------------------------------------------------------
// Trace access
// ---------------------------------------------------------------------------

/**
 * Pull the DeckTrace ring. `since` returns only entries with
 * `seq > that`.
 */
export function getDeckTrace(
  caller: HarnessCaller,
  opts?: { since?: number },
  evalOpts?: EvalJsOptions,
): Promise<readonly DeckTraceEvent[]> {
  const script = callSurface(
    `window.__tug.getDeckTrace(${lit(opts)})`,
  );
  return caller.evalJS<readonly DeckTraceEvent[]>(script, evalOpts);
}

/**
 * Stamp the current trace sequence counter. Test pattern: take a
 * mark before the action under test, then `getDeckTrace({ since:
 * mark })` to scope the assertion to just this step's output.
 */
export function markDeckTrace(
  caller: HarnessCaller,
  evalOpts?: EvalJsOptions,
): Promise<number> {
  const script = callSurface(`window.__tug.markDeckTrace()`);
  return caller.evalJS<number>(script, evalOpts);
}

/**
 * Drop every buffered trace event. Preserves the enable flag.
 */
export function clearDeckTrace(
  caller: HarnessCaller,
  evalOpts?: EvalJsOptions,
): Promise<void> {
  const script = callSurface(`window.__tug.clearDeckTrace()`);
  return caller.evalJS<void>(script, evalOpts);
}

/**
 * Toggle trace recording. Disabled state is the no-op fast path
 * (see parent plan Spec [#s01-deck-trace-event]).
 */
export function enableDeckTrace(
  caller: HarnessCaller,
  flag: boolean,
  evalOpts?: EvalJsOptions,
): Promise<void> {
  const script = callSurface(
    `window.__tug.enableDeckTrace(${lit(flag)})`,
  );
  return caller.evalJS<void>(script, evalOpts);
}

// ---------------------------------------------------------------------------
// Wait-style assertions
// ---------------------------------------------------------------------------

/**
 * Block until the deck reports `cardId` as the focused card, or
 * until the `waitForCondition` budget elapses (default 2000ms).
 *
 * Implementation note: a pure equality check on the server side,
 * so the condition script is stringified inline. `waitForCondition`
 * returns the truthy value — here we discard it.
 */
export async function expectFocusedCard(
  caller: HarnessCaller,
  cardId: string,
  opts?: WaitForConditionOptions,
): Promise<void> {
  // `window.__tug.getFocusedCardId() === cardId` is the contract the
  // plan requires. We inline-serialize cardId so the Swift side
  // doesn't need to marshal any bindings — the script is a pure
  // expression.
  const script = `(typeof window.__tug !== "undefined") && (window.__tug.getFocusedCardId() === ${lit(cardId)})`;
  await caller.waitForCondition<boolean>(script, opts);
}

/**
 * Block until `__tug.getCaretState(cardId)` deep-equals the expected
 * snapshot, or the budget elapses. Uses a server-side deep-equal
 * evaluated on the returned JSON — keeps the polled predicate pure.
 *
 * The `expected` value is stringified client-side and compared via
 * `JSON.stringify(actual) === JSON.stringify(expected)` on the page.
 * That works because both sides agree on the `CaretState` shape and
 * every field is a primitive or a readonly array of primitives.
 */
export async function expectCaret(
  caller: HarnessCaller,
  cardId: string,
  expected: CaretState,
  opts?: WaitForConditionOptions,
): Promise<void> {
  // Build the inline expression. We compare the stringifications
  // because the two CaretState variants are flat / shallow enough
  // for JSON to be total. `tug.getCaretState` may return `null` if
  // the card root isn't registered yet; the comparison then yields
  // `"null" === "{...}"` → false, which is exactly the polling
  // behavior we want.
  const expectedJson = JSON.stringify(expected);
  const script =
    `(typeof window.__tug !== "undefined") && ` +
    `(JSON.stringify(window.__tug.getCaretState(${lit(cardId)})) === ${JSON.stringify(expectedJson)})`;
  await caller.waitForCondition<boolean>(script, opts);
}

// ---------------------------------------------------------------------------
// Type-level sanity: client wrappers are exhaustive.
// ---------------------------------------------------------------------------

/**
 * The set of `TugTestSurface` methods this client has wrappers for.
 * Checked at plan-review time against `tugdeck/src/test-surface.ts`
 * — when a new surface method lands, add its name here AND a helper
 * above. The handshake's `SURFACE_VERSION` is the runtime gate
 * (parent plan [D11]); this union is the authoring-time reminder.
 */
export type ClientMethodNames =
  | "click"
  | "type"
  | "focusElement"
  | "reset"
  | "seedDeckState"
  | "getActiveCardId"
  | "getFocusedCardId"
  | "getCaretState"
  | "getFormControlValue"
  | "assertHostRootRegistered"
  | "getDeckTrace"
  | "markDeckTrace"
  | "clearDeckTrace"
  | "enableDeckTrace";
