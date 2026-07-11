/**
 * Tests for `grammar-seed.ts` — synthetic opener lines that restore
 * grammar state when a hunk side begins inside a block comment or a
 * CSS rule whose opener sits above the hunk window.
 */

import { describe, expect, test } from "bun:test";

import { grammarSeedLines } from "../grammar-seed";

describe("grammarSeedLines", () => {
  test("side starting inside a CSS rule seeds a rule opener", () => {
    const text = "  padding-inline-start: 0;\n}\n\n.next {\n  margin: 0;\n}";
    expect(grammarSeedLines(text, "css")).toEqual(["seed {"]);
  });

  test("side starting inside a block comment seeds a comment opener", () => {
    const text = "   continued prose of a comment */\nconst x = 1;";
    expect(grammarSeedLines(text, "ts")).toEqual(["/*"]);
  });

  test("mid-comment AND mid-rule seeds both, rule opener first", () => {
    const text = "   still a comment */\n  margin: 0;\n}\n.next {\n}";
    expect(grammarSeedLines(text, "css")).toEqual(["seed {", "/*"]);
  });

  test("a side that opens its own structures needs no seeds", () => {
    expect(grammarSeedLines(".a {\n  margin: 0;\n}", "css")).toEqual([]);
    expect(grammarSeedLines("/* note */\nconst x = 1;", "ts")).toEqual([]);
  });

  test("braces inside a seeded comment do not trigger a rule seed", () => {
    // The `}` sits inside the comment prose; the side never leaves a
    // rule, so only the comment opener is seeded.
    const text = "   prose with a } brace */\n.a {\n  margin: 0;\n}";
    expect(grammarSeedLines(text, "css")).toEqual(["/*"]);
  });

  test("languages without C-style comments never seed a comment", () => {
    const text = "text with a stray */ marker";
    expect(grammarSeedLines(text, "py")).toEqual([]);
    expect(grammarSeedLines(text, "sh")).toEqual([]);
  });

  test("rule seeding is CSS-family only", () => {
    const text = "  return x;\n}";
    expect(grammarSeedLines(text, "ts")).toEqual([]);
    expect(grammarSeedLines(text, "scss")).toEqual(["seed {"]);
  });

  test("a braceless declaration-shaped window seeds a rule opener", () => {
    const text = "  margin-inline: 0;\n  gap: var(--tug-space-xs);";
    expect(grammarSeedLines(text, "css")).toEqual(["seed {"]);
  });

  test("a braceless non-declaration window does not seed", () => {
    expect(grammarSeedLines(".a,\n.b,", "css")).toEqual([]);
  });

  test("mid-declaration window seeds an open declaration per paren debt", () => {
    // The window starts inside `width: calc(` — the `);` closes a paren
    // the window never opened.
    const text =
      "    var(--frame-width) - var(--row-gap)\n  );\n  margin-inline: 0;\n}";
    expect(grammarSeedLines(text, "css")).toEqual(["seed {", "seed: f("]);
  });

  test("balanced parens inside the rule add no declaration seed", () => {
    const text = "  width: var(--w);\n}";
    expect(grammarSeedLines(text, "css")).toEqual(["seed {"]);
  });
});
