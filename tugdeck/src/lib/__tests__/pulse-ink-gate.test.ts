/**
 * pulse-ink-gate — `PULSE` is an internal name, never ink a reader sees.
 *
 * The word had two jobs and lost both. It was the Z2 strip's legend pill, naming
 * the band a session's commentary arrived in; and it was the headline level's
 * stand-in, printing where no goal had been composed so the line kept its
 * height. The strip is retired and the headline level renders only when a caller
 * supplies one, so nothing needs a placeholder word — and a band that names
 * itself is furniture where a sentence belongs ([D132]).
 *
 * The name STAYS everywhere it is not ink: stores, modules, feeds, class names,
 * constants, and the prose that explains any of them. What this gate forbids is
 * the bare token surviving in code — a JSX text node, a label, a string a
 * surface renders — which is a thing a reviewer cannot enforce by habit and a
 * type-check cannot see at all.
 *
 * How it decides, in order:
 *
 *  1. Comments are stripped first. Explaining the vocabulary is not printing it,
 *     and this file's own header is the proof that has to be allowed.
 *  2. What remains is scanned for `PULSE` as a WHOLE WORD. `PULSE_HISTORY_COUNT`,
 *     `COMPACTING_PULSE_TEXT`, `usePulse`, and `FeedId.PULSE` are identifiers,
 *     not ink; only a token with no word character and no `.` before it, and no
 *     word character after, is a candidate.
 *  3. Gallery cards are exempt. They are the design surface where the
 *     vocabulary is discussed and auditioned, and a card that could not write
 *     the word could not document its retirement.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The two trees a surface's ink can live in. */
const ROOTS = ["src/components", "src/lib"];

/** Files whose whole job is to discuss the vocabulary. */
function isExempt(path: string): boolean {
  // Gallery cards are the design surface, and this gate is itself prose.
  return (
    path.includes("/cards/gallery-") || path.endsWith("pulse-ink-gate.test.ts")
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      continue;
    }
    if (/\.(ts|tsx|css)$/.test(entry) && !isExempt(path)) out.push(path);
  }
  return out;
}

/**
 * Drop `/* … *\/` and `// …` runs.
 *
 * Deliberately naive: a `//` inside a string literal (a URL) truncates that
 * line early, which can only ever make the gate MISS something, never fire
 * falsely. A gate that reported a phantom would be worse than one that reads a
 * line short.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * `PULSE` standing alone — a token, not an identifier.
 *
 * The `.` in the lookbehind is what excludes `FeedId.PULSE`: a property access
 * names the feed, and the feed keeps the name.
 */
const BARE_PULSE = /(?<![A-Za-z0-9_$.])PULSE(?![A-Za-z0-9_$])/;

describe("no user-facing PULSE ink", () => {
  test("every component and lib file is clean", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const path of walk(root)) {
        const code = stripComments(readFileSync(path, "utf8"));
        code.split("\n").forEach((line, i) => {
          if (BARE_PULSE.test(line)) {
            offenders.push(`${path}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the gate can actually see the thing it forbids", () => {
    // Without this, a broken regex or a mis-walked tree would report a clean
    // corpus forever and the gate would be decoration.
    expect(BARE_PULSE.test('<span>PULSE</span>')).toBe(true);
    expect(BARE_PULSE.test('label="PULSE"')).toBe(true);
    // And it does not fire on the name's legitimate homes.
    expect(BARE_PULSE.test("const PULSE_HISTORY_COUNT = 8;")).toBe(false);
    expect(BARE_PULSE.test("import { usePulse } from '@/lib/pulse-store';")).toBe(
      false,
    );
    expect(BARE_PULSE.test('className="tug-pulse-line"')).toBe(false);
    expect(BARE_PULSE.test("this.conn.onFrame(FeedId.PULSE, cb)")).toBe(false);
    // A comment explaining the vocabulary survives stripping.
    expect(stripComments("// the PULSE feed").trim()).toBe("");
    expect(stripComments("/* the PULSE feed */").trim()).toBe("");
  });
});
