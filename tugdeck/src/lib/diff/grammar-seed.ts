/**
 * Grammar-state seeding for hunk-side tokenization.
 *
 * A diff hunk is a window into a file: its first line can sit inside a
 * block comment or (for CSS) inside a rule's declaration block, but the
 * text above the window — the `/*` or the selector's `{` — is not part
 * of the hunk. Tokenizing the reconstructed side from the hunk boundary
 * therefore mis-scopes those leading lines (a bare `margin: 0;` outside
 * braces parses as a selector; comment prose parses as code).
 *
 * `grammarSeedLines` inspects a side's text and returns synthetic
 * opener lines to prepend before tokenizing: a `/*` when the side
 * closes a block comment it never opened, and a placeholder selector +
 * `{` when a CSS-family side closes a rule it never opened. The caller
 * prepends the seeds, tokenizes, and drops the first `seeds.length`
 * rows of the result.
 *
 * Heuristic by design: a `*` + `/` or `}` inside a string literal can
 * trigger a false seed, which at worst shifts the same class of
 * mis-scoping this fixes. Both scans are first-occurrence checks, so
 * the cost is O(side length).
 *
 * @module lib/diff/grammar-seed
 */

/** Extensions whose languages have C-style block comments (registry
 *  file-extension keys, not Shiki ids). */
const BLOCK_COMMENT_LANGS: ReadonlySet<string> = new Set([
  "css",
  "scss",
  "less",
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "cxx",
  "cc",
  "hpp",
  "hxx",
  "cs",
  "swift",
  "kt",
  "kts",
  "dart",
  "php",
  "scala",
]);

/** Extensions where declarations live inside `selector { … }` rules. */
const CSS_RULE_LANGS: ReadonlySet<string> = new Set(["css", "scss", "less"]);

/**
 * Compute synthetic opener lines for one reconstructed hunk side.
 *
 * @param sideText The side's full text (lines joined with `\n`).
 * @param ext Registry file-extension key (e.g. `"ts"`, `"css"`); `null`
 *            for plain text. Unknown extensions seed nothing.
 * @returns Lines to prepend, outermost first (a rule opener precedes a
 *          comment opener, since an open comment sits inside the rule).
 */
export function grammarSeedLines(sideText: string, ext: string | null): string[] {
  if (ext === null) return [];
  let text = sideText;

  const commentSeeds: string[] = [];
  if (BLOCK_COMMENT_LANGS.has(ext)) {
    const open = text.indexOf("/*");
    const close = text.indexOf("*/");
    if (close !== -1 && (open === -1 || close < open)) {
      commentSeeds.push("/*");
      // The rule scan below must only see text outside the seeded
      // comment, or braces inside the comment prose would count.
      text = text.slice(close + 2);
    }
  }

  const ruleSeeds: string[] = [];
  if (CSS_RULE_LANGS.has(ext)) {
    const open = text.indexOf("{");
    const close = text.indexOf("}");
    if (close !== -1 && (open === -1 || close < open)) {
      ruleSeeds.push("seed {");
    } else if (open === -1 && close === -1 && looksLikeDeclaration(text)) {
      // A window entirely inside one rule body shows no braces at all;
      // a leading `prop:`-shaped line is the tell.
      ruleSeeds.push("seed {");
    }
    if (ruleSeeds.length > 0) {
      // A window can also start mid-*declaration*, inside an open
      // function call — `calc(` above the window, a stray `);` inside
      // it. The unmatched `)` breaks CSS's declaration parsing and
      // everything after mis-scopes as selectors. Seed an open
      // declaration with one `f(` per unmatched close.
      const debt = parenDebt(text);
      if (debt > 0) {
        ruleSeeds.push(`seed: ${"f(".repeat(debt)}`);
      }
    }
  }

  return [...ruleSeeds, ...commentSeeds];
}

/** True when the text's first non-empty line is shaped like a CSS
 * declaration (`margin: …` / `--custom-prop: …`). */
function looksLikeDeclaration(text: string): boolean {
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    return /^\s*(--|[a-zA-Z-]+\s*:)/.test(line);
  }
  return false;
}

/** Count unmatched `)` up to the first `}` (the end of the enclosing
 * rule): the number of parens some construct above the window opened. */
function parenDebt(text: string): number {
  let depth = 0;
  let debt = 0;
  for (const ch of text) {
    if (ch === "}") break;
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        debt += 1;
        depth = 0;
      }
    }
  }
  return debt;
}
