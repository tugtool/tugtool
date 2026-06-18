/**
 * inline-command-ghost — unit tests for the mid-text ghost-completion
 * geometry. Pure string logic; no DOM, no CodeMirror.
 */

import { describe, expect, test } from "bun:test";

import {
  computeInlineGhost,
  type InlineCommandMatcher,
} from "../inline-command-ghost";

const C = "￼"; // atom placeholder

/** Matcher over a fixed catalog: best case-insensitive prefix-extension. */
const CATALOG = ["rewind", "review", "compact", "context", "tugplug:commit"];
const matcher: InlineCommandMatcher = (query) => {
  const q = query.toLowerCase();
  const hit = CATALOG.find((name) => name.toLowerCase().startsWith(q));
  return hit ?? null;
};

/** Cursor convention: pass the caret as the index just past the typed text. */
function ghostAtEnd(text: string, m: InlineCommandMatcher = matcher) {
  return computeInlineGhost(text, text.length, m);
}

describe("computeInlineGhost — shows a ghost", () => {
  test("mid-text /rewi → suffix nd", () => {
    const g = ghostAtEnd("hello /rewi");
    expect(g).not.toBeNull();
    expect(g!.name).toBe("rewind");
    expect(g!.suffix).toBe("nd");
    expect(g!.slashOffset).toBe(6);
    expect(g!.caret).toBe(11);
  });

  test("after a trailing space + caret at token end, with text following", () => {
    // "hi /comp world" with the caret right after "comp".
    const text = "hi /comp world";
    const g = computeInlineGhost(text, "hi /comp".length, matcher);
    expect(g).not.toBeNull();
    expect(g!.name).toBe("compact");
    expect(g!.suffix).toBe("act");
  });

  test("token right after an atom chip is mid-text", () => {
    const g = ghostAtEnd(`${C}/revi`);
    expect(g).not.toBeNull();
    expect(g!.name).toBe("review");
    expect(g!.suffix).toBe("ew");
  });

  test("case-insensitive prefix keeps the catalog casing in the suffix", () => {
    const g = ghostAtEnd("go /REW");
    expect(g).not.toBeNull();
    expect(g!.suffix).toBe("ind");
  });
});

describe("computeInlineGhost — no ghost", () => {
  test("leading / is the popup's territory, not the ghost's", () => {
    expect(ghostAtEnd("/rewi")).toBeNull();
  });

  test("bare / with nothing typed", () => {
    expect(ghostAtEnd("hello /")).toBeNull();
  });

  test("caret mid-token (text continues past the caret)", () => {
    // caret after "rew" but the token continues "ind".
    expect(computeInlineGhost("say /rewind", "say /rew".length, matcher)).toBeNull();
  });

  test("a path fragment (slash glued to preceding word) is not a command", () => {
    expect(ghostAtEnd("src/rewi")).toBeNull();
  });

  test("no catalog match", () => {
    expect(ghostAtEnd("hello /zzz")).toBeNull();
  });

  test("query already equals the full name (nothing left to complete)", () => {
    expect(ghostAtEnd("hello /rewind")).toBeNull();
  });

  test("only a full-name prefix ghosts — a leaf-only match does not (v1)", () => {
    // "commit" is the leaf of "tugplug:commit"; the full name does not start
    // with "com", so no ghost. (compact DOES, and wins — covered above.)
    const leafOnly: InlineCommandMatcher = (q) =>
      "tugplug:commit".startsWith(q.toLowerCase()) ? "tugplug:commit" : null;
    expect(computeInlineGhost("hi /com", "hi /com".length, leafOnly)).toBeNull();
  });
});
