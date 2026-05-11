/**
 * Token coverage for the markdown typography pass.
 *
 * `--tugx-md-*` slots are component-local per tuglaws/token-naming.md:
 * declared in `tug-markdown-view.css`'s `body {}` block (the canonical
 * home for a public component's `--tugx-*` slots). Per-theme variance
 * flows through the `--tug7-*` base tokens those aliases resolve to.
 *
 * What this test guards:
 *  - Every `--tugx-md-*` token referenced by markdown CSS is declared
 *    in `tug-markdown-view.css`.
 *  - Theme files (`brio.css`, `harmony.css`) DO NOT declare any
 *    `--tugx-md-*` slot — that would be the original-sin pattern this
 *    migration cleaned up.
 *
 * Token names are extracted via a simple `--tugx-md-([a-z0-9-]+):`
 * regex; the test does NOT validate values, only declared/referenced
 * token names.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test, expect } from "bun:test";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

const TUGDECK = join(__dir, "../../../..");
const BRIO = join(TUGDECK, "styles/themes/brio.css");
const HARMONY = join(TUGDECK, "styles/themes/harmony.css");
const MARKDOWN_VIEW_CSS = join(
  TUGDECK,
  "src/components/tugways/tug-markdown-view.css",
);
const MARKDOWN_BLOCK_CSS = join(
  TUGDECK,
  "src/components/tugways/tug-markdown-block.css",
);

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

/** Tokens this theme file *declares* — `--tugx-md-foo: value;`. */
function extractDeclared(cssText: string): Set<string> {
  const set = new Set<string>();
  const re = /--tugx-md-([a-z0-9-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText)) !== null) {
    set.add(`--tugx-md-${m[1]}`);
  }
  return set;
}

/** Tokens a CSS file *references* — `var(--tugx-md-foo[, ...])`.
 *  Captures only the var name, not its fallback. */
function extractReferenced(cssText: string): Set<string> {
  const set = new Set<string>();
  const re = /var\(\s*(--tugx-md-[a-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText)) !== null) {
    set.add(m[1]);
  }
  return set;
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("markdown token coverage", () => {
  test("theme files declare zero --tugx-md-* slots (the component-local migration cleared them)", () => {
    const brio = extractDeclared(read(BRIO));
    const harmony = extractDeclared(read(HARMONY));

    expect(brio.size).toBe(0);
    expect(harmony.size).toBe(0);
  });

  test("every --tugx-md-* token referenced by markdown CSS is declared in tug-markdown-view.css", () => {
    const referenced = new Set<string>([
      ...extractReferenced(read(MARKDOWN_VIEW_CSS)),
      ...extractReferenced(read(MARKDOWN_BLOCK_CSS)),
    ]);
    const declared = extractDeclared(read(MARKDOWN_VIEW_CSS));

    const undeclared = [...referenced].filter((t) => !declared.has(t)).sort();

    expect(undeclared).toEqual([]);
  });

  test("token vocabulary covers every typography axis the pass commits to", () => {
    // Spot-check a representative subset of the typography surface so a
    // future refactor that accidentally drops a category fails loudly here.
    const declared = extractDeclared(read(MARKDOWN_VIEW_CSS));
    const required: ReadonlyArray<string> = [
      // Body
      "--tugx-md-body-color",
      "--tugx-md-body-line-height",
      "--tugx-md-paragraph-margin",
      // Headings
      "--tugx-md-h1-size",
      "--tugx-md-h2-size",
      "--tugx-md-h3-size",
      "--tugx-md-h4-size",
      "--tugx-md-h5-size",
      "--tugx-md-h6-size",
      "--tugx-md-heading-line-height",
      "--tugx-md-heading-margin-top",
      "--tugx-md-heading-margin-bottom",
      "--tugx-md-h1-weight",
      "--tugx-md-h6-color",
      // Inline
      "--tugx-md-strong-weight",
      "--tugx-md-em-style",
      "--tugx-md-strikethrough-decoration",
      // Links
      "--tugx-md-link-color",
      "--tugx-md-link-color-hover",
      // Code
      "--tugx-md-mono-font",
      "--tugx-md-inline-code-bg",
      "--tugx-md-inline-code-padding",
      "--tugx-md-inline-code-radius",
      "--tugx-md-fenced-code-bg",
      "--tugx-md-fenced-code-padding",
      "--tugx-md-fenced-code-radius",
      // Blockquote / hr / lists / table / image / footnote
      "--tugx-md-blockquote-border",
      "--tugx-md-hr-color",
      "--tugx-md-list-indent",
      "--tugx-md-table-border",
      "--tugx-md-table-header-bg",
      "--tugx-md-image-radius",
      "--tugx-md-footnote-color",
      // Layout
      "--tugx-md-block-padding-x",
      "--tugx-md-bottom-buffer",
    ];
    const missing = required.filter((t) => !declared.has(t));
    expect(missing).toEqual([]);
  });

  test("markdown CSS references no --tugx-md-* fallback literals (theme is the sole source)", () => {
    const view = read(MARKDOWN_VIEW_CSS);
    const block = read(MARKDOWN_BLOCK_CSS);
    // After the typography pass, every var() should reference the
    // declared token without a comma-separated fallback. The
    // existence of `var(--tugx-md-..., <fallback>)` would mean a
    // theme-level value can be overridden by a hardcoded literal —
    // which defeats the per-theme contract.
    //
    // tug-markdown-block.css's `--tugx-md-block-padding-x` is the
    // intentional exception (a soft default for consumers that mount
    // a Block without theme tokens, per its module docstring); the
    // regex below skips that single token.
    const allRefsView = [...view.matchAll(/var\(\s*(--tugx-md-[a-z0-9-]+)\s*,/g)].map((m) => m[1]);
    const allRefsBlock = [...block.matchAll(/var\(\s*(--tugx-md-[a-z0-9-]+)\s*,/g)].map((m) => m[1]);
    const fallbacked = [...allRefsView, ...allRefsBlock].filter(
      (t) => t !== "--tugx-md-block-padding-x",
    );
    expect(fallbacked).toEqual([]);
  });
});
