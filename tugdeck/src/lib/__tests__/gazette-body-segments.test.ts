/**
 * Unit tests for `segmentGazetteBody` — the pure split of a post body into
 * prose runs and inline ref mentions.
 */

import { describe, expect, test } from "bun:test";

import {
  inlineRefTargets,
  segmentGazetteBody,
} from "@/lib/gazette-body-segments";
import type { GazetteRef } from "@/protocol";

const file = (target: string): GazetteRef => ({ kind: "file", target });
const commit = (target: string): GazetteRef => ({ kind: "commit", target });

describe("segmentGazetteBody", () => {
  test("a body with no ref mentions is one plain run", () => {
    const segs = segmentGazetteBody("Fixed the flaky test.", [
      file("tugdeck/src/main.tsx"),
    ]);
    expect(segs).toEqual([{ text: "Fixed the flaky test.", ref: null }]);
  });

  test("a mentioned target becomes a ref run with prose around it", () => {
    const ref = file("tugdeck/src/main.tsx");
    const segs = segmentGazetteBody(
      "Retuned tugdeck/src/main.tsx to match.",
      [ref],
    );
    expect(segs).toEqual([
      { text: "Retuned ", ref: null },
      { text: "tugdeck/src/main.tsx", ref },
      { text: " to match.", ref: null },
    ]);
  });

  test("every occurrence is marked, and targets never overlap", () => {
    const long = file("tugdeck/src/main.tsx");
    const short = file("main.tsx");
    const segs = segmentGazetteBody(
      "tugdeck/src/main.tsx imports main.tsx",
      [short, long],
    );
    // The longer target claims the span its shorter sibling also matches.
    expect(segs.map((s) => [s.text, s.ref?.target ?? null])).toEqual([
      ["tugdeck/src/main.tsx", "tugdeck/src/main.tsx"],
      [" imports ", null],
      ["main.tsx", "main.tsx"],
    ]);
  });

  test("a sha and a path can both be inline in one body", () => {
    const sha = commit("a1b2c3d4e");
    const path = file("roadmap/plan.md");
    const segs = segmentGazetteBody(
      "Commit a1b2c3d4e landed roadmap/plan.md.",
      [sha, path],
    );
    expect(inlineRefTargets(segs)).toEqual(
      new Set(["a1b2c3d4e", "roadmap/plan.md"]),
    );
  });

  test("empty targets never match", () => {
    const segs = segmentGazetteBody("Anything at all.", [file("")]);
    expect(segs).toEqual([{ text: "Anything at all.", ref: null }]);
  });
});
