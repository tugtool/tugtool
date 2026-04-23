/**
 * matchers.ts — Trace-assertion matchers for the in-app harness.
 *
 * Exports `toContainOrderedSubset`, which asserts that a sequence of
 * partial entries appears in-order (not necessarily contiguous) inside
 * a trace array. Parent plan Spec [#s01-deck-trace-event] documents
 * the DeckTraceEvent shape; in practice the matcher is type-agnostic
 * so tests can hand it any event-like array.
 *
 * Semantics (parent plan Step 10, task 3):
 *   - "Ordered subset": the entries must appear in the given order,
 *     but additional entries may sit between them.
 *   - "Partial match": each `expected` entry's keys that ARE specified
 *     must equal the corresponding keys on the actual entry; keys NOT
 *     specified are wildcards. Nested objects match recursively using
 *     the same partial rule; arrays use deep-equal on each element.
 *
 * The matcher is dual-shaped:
 *   - {@link toContainOrderedSubset} — pure predicate returning
 *     `{ pass, message }`. This is what the unit tests call.
 *   - {@link registerSubsetMatcher} — registers the matcher via
 *     `expect.extend` so tests can write
 *     `expect(trace).toContainOrderedSubset([...])`. Call this once at
 *     module load inside any test file that wants the fluent form.
 *
 * The pure-predicate shape exists precisely so the unit tests stay
 * happy-dom-free and tsc-checkable without dragging `expect.extend`'s
 * type gymnastics into every test file.
 */

import { expect } from "bun:test";

/**
 * A result shape compatible with both the bun:test `expect.extend`
 * contract and our own predicate-style assertions. `pass` is the
 * boolean outcome; `message` is a thunk producing a human-readable
 * explanation on failure.
 */
export interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/**
 * A partially-specified entry. Every key in the expected object must
 * appear (with a matching value) in the actual entry. Extra keys on
 * the actual entry are allowed. Values are compared via
 * {@link partialMatchValue} (objects recurse, arrays deep-equal,
 * primitives strict-equal).
 *
 * Kept as `Record<string, unknown>` rather than `Partial<DeckTraceEvent>`
 * so callers can match on shapes that intentionally omit the union's
 * required fields (e.g. matching an `{ kind: "fr-flip" }` skeleton
 * without providing `from`/`to`/`trigger`).
 */
export type ExpectedEntry = Record<string, unknown>;

/**
 * Strict deep-equal for values. Used for array elements and for
 * nested objects when the expected side's key list spans the entire
 * value shape (i.e. the caller passed an "exact-match" expectation
 * for that nested level).
 *
 * For the top-level partial-match semantics use
 * {@link partialMatchValue}.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Compare a single expected value against the corresponding actual
 * value using the matcher's partial-match rules.
 *
 *   - Primitives (including `null`/`undefined`) strict-equal.
 *   - Arrays deep-equal (arrays are treated as opaque values at nested
 *     levels — the top-level "ordered subset" semantics apply only to
 *     the outer trace array, not to nested sequences).
 *   - Plain objects recurse with the same partial-match rule: every
 *     key in `expected` must be present and match in `actual`; extra
 *     keys on `actual` are ignored.
 */
function partialMatchValue(expected: unknown, actual: unknown): boolean {
  if (expected === undefined) {
    // An explicit `undefined` in the expected entry means "the actual
    // must also be undefined" — matches the user's intent if they
    // literally typed `undefined`. Missing keys are handled at the
    // object level (see `partialMatchEntry`).
    return actual === undefined;
  }
  if (expected === null) return actual === null;
  if (typeof expected !== "object") return Object.is(expected, actual);
  if (Array.isArray(expected)) return deepEqual(expected, actual);
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  for (const key of Object.keys(expected as object)) {
    const ok = partialMatchValue(
      (expected as Record<string, unknown>)[key],
      (actual as Record<string, unknown>)[key],
    );
    if (!ok) return false;
  }
  return true;
}

/**
 * Check a single expected entry against a single actual entry using
 * the partial-match rule. Every key in `expected` must be present
 * and match in `actual`; unspecified keys are wildcards.
 */
function partialMatchEntry(
  expected: ExpectedEntry,
  actual: unknown,
): boolean {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  for (const key of Object.keys(expected)) {
    const ok = partialMatchValue(
      expected[key],
      (actual as Record<string, unknown>)[key],
    );
    if (!ok) return false;
  }
  return true;
}

/**
 * Pretty-print a value for the failure message. We keep this cheap
 * and deterministic — `JSON.stringify` with a 2-space indent is plenty
 * for the shallow shapes we deal with, and it won't throw on the
 * serializable DeckTraceEvent union.
 */
function prettify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * Assert that `expected` appears as an ordered subset of `actual`:
 * every `expected[i]` must partial-match some `actual[j]`, with the
 * chosen j values strictly increasing. Extra actual entries between
 * matches are fine.
 *
 * Returns a `{ pass, message }` pair compatible with both our direct
 * test usage and the `expect.extend` registration.
 *
 * The search is greedy from the left: at each expected index we scan
 * forward in `actual` from the last-matched position + 1. This
 * matches human intuition ("find the next entry that fits") and
 * avoids pathological backtracking on trace shapes that do not
 * branch.
 */
export function toContainOrderedSubset(
  actual: readonly unknown[] | null | undefined,
  expected: readonly ExpectedEntry[],
): MatcherResult {
  if (!Array.isArray(actual)) {
    return {
      pass: false,
      message: () =>
        `expected an array of trace entries, received ${prettify(actual)}`,
    };
  }
  if (expected.length === 0) {
    return {
      pass: true,
      message: () => "expected an empty subset; trivially matches any trace",
    };
  }

  let cursor = 0;
  const matchedIndices: number[] = [];
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i];
    let found = -1;
    for (let j = cursor; j < actual.length; j++) {
      if (partialMatchEntry(want, actual[j])) {
        found = j;
        break;
      }
    }
    if (found === -1) {
      const matchedTail = matchedIndices.length
        ? ` (matched indices so far: [${matchedIndices.join(", ")}])`
        : "";
      return {
        pass: false,
        message: () =>
          `expected trace to contain entry #${i} as an ordered subset${matchedTail}:\n` +
          `looking for:\n${prettify(want)}\n` +
          `after actual index ${cursor - 1}; trace length = ${actual.length}.\n` +
          `full trace:\n${prettify(actual)}`,
      };
    }
    matchedIndices.push(found);
    cursor = found + 1;
  }

  return {
    pass: true,
    message: () =>
      `expected trace NOT to contain ordered subset, but it did at indices [${matchedIndices.join(", ")}]`,
  };
}

/**
 * Register `toContainOrderedSubset` with bun:test's `expect`. Calling
 * this once per test file that uses the fluent form is safe;
 * `expect.extend` is idempotent with respect to redefining the same
 * matcher name.
 *
 * Tests that prefer the pure predicate form can ignore this function
 * and call {@link toContainOrderedSubset} directly.
 */
export function registerSubsetMatcher(): void {
  expect.extend({
    toContainOrderedSubset(
      received: unknown,
      expected: readonly ExpectedEntry[],
    ): MatcherResult {
      // Narrow the first argument: the matcher only makes sense on
      // array-like inputs. We forward to the pure predicate so the
      // behavior is identical to the direct-call shape.
      return toContainOrderedSubset(
        received as readonly unknown[] | null | undefined,
        expected,
      );
    },
  });
}

/**
 * Augment `bun:test`'s matcher type list so tests importing this
 * module (plus calling {@link registerSubsetMatcher}) get typed
 * `.toContainOrderedSubset(...)` calls on `expect(trace)`.
 */
declare module "bun:test" {
  interface Matchers<T> {
    toContainOrderedSubset(expected: readonly ExpectedEntry[]): T;
  }
  interface AsymmetricMatchers {
    toContainOrderedSubset(expected: readonly ExpectedEntry[]): unknown;
  }
}
