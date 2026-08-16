/**
 * ref-spec — the `/ref <spec>` number grammar (Spec S04, [P09]).
 *
 * A spec is any mix of single numbers, inclusive ranges, and lists:
 * `/ref 3`, `/ref 3-5`, `/ref 3 7 9`, `/ref 1,4-6 9`. It resolves against
 * the latest run's refs, which are numbered in emission order and never
 * renumbered ([P12]) — so the number the user reads off a row is the number
 * that opens it, for the life of that run.
 *
 * Opening is capped: a `/ref 1-500` that spawned five hundred Text cards
 * would be a worse outcome than the one the user meant. The cap is reported,
 * not silently applied.
 *
 * Pure — the caller dispatches the opens.
 *
 * @module lib/ref-spec
 */

/** How many refs one `/ref` may open. Past this the spec is truncated and
 *  the caller warns; the refs themselves are untouched. */
export const REF_OPEN_CAP = 10;

/** What a spec resolved to against a run's refs. */
export interface RefSpecResolution {
  /** Ref numbers to open, in spec order, deduped and capped. */
  numbers: number[];
  /** Numbers the spec named that this run has no ref for. */
  outOfRange: number[];
  /** Tokens that are not a number or a range at all. */
  invalid: string[];
  /** Whether the cap dropped numbers the spec named. */
  capped: boolean;
}

/**
 * Parse a spec into the numbers it names, in order and deduped, plus any
 * tokens that were not numbers. A range is inclusive and normalized
 * ascending, so `5-3` reads the same as `3-5` — a descending range is far
 * more likely a typo than a request to open files backwards.
 *
 * Tokens split on whitespace and commas, so `1,4-6 9` and `1 4-6 9` are the
 * same spec.
 */
export function parseRefSpec(spec: string): { numbers: number[]; invalid: string[] } {
  const numbers: number[] = [];
  const seen = new Set<number>();
  const invalid: string[] = [];
  const push = (n: number): void => {
    if (seen.has(n)) return;
    seen.add(n);
    numbers.push(n);
  };
  for (const token of spec.split(/[\s,]+/).filter((t) => t !== "")) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range !== null) {
      const a = Number.parseInt(range[1], 10);
      const b = Number.parseInt(range[2], 10);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let n = lo; n <= hi; n++) push(n);
      continue;
    }
    if (/^\d+$/.test(token)) {
      push(Number.parseInt(token, 10));
      continue;
    }
    invalid.push(token);
  }
  return { numbers, invalid };
}

/**
 * Resolve a spec against the ref numbers a run actually has. Out-of-range
 * numbers are reported and skipped rather than shifting the rest along — the
 * numbers are addresses, not positions in a queue.
 */
export function resolveRefSpec(
  spec: string,
  hasRef: (n: number) => boolean,
  cap: number = REF_OPEN_CAP,
): RefSpecResolution {
  const { numbers, invalid } = parseRefSpec(spec);
  const found: number[] = [];
  const outOfRange: number[] = [];
  for (const n of numbers) {
    if (hasRef(n)) found.push(n);
    else outOfRange.push(n);
  }
  return {
    numbers: found.slice(0, cap),
    outOfRange,
    invalid,
    capped: found.length > cap,
  };
}
