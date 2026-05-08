/**
 * Theme-token coverage for the markdown typography pass.
 *
 * The typography pass declares a vocabulary of `--tugx-md-*` tokens
 * in both `styles/themes/brio.css` (dark) and
 * `styles/themes/harmony.css` (light). The contract: both themes
 * declare the *same set* of token names, and every `--tugx-md-*`
 * token referenced by `tug-markdown-view.css` (the consumer) is
 * declared in both themes.
 *
 * What this test guards:
 *  - A new token added to one theme but not the other → fails.
 *  - A token referenced in the markdown CSS but not declared in the
 *    themes → fails. (This used to be silently survivable because of
 *    `var(--name, fallback-literal)`; the typography pass dropped
 *    those fallbacks and made theme declarations the sole source.)
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

describe("markdown theme-token coverage", () => {
  test("brio.css and harmony.css declare the same set of --tugx-md-* tokens", () => {
    const brio = extractDeclared(read(BRIO));
    const harmony = extractDeclared(read(HARMONY));

    // Both themes declare a non-trivial set.
    expect(brio.size).toBeGreaterThan(20);
    expect(harmony.size).toBeGreaterThan(20);

    const onlyInBrio = [...brio].filter((t) => !harmony.has(t)).sort();
    const onlyInHarmony = [...harmony].filter((t) => !brio.has(t)).sort();

    expect(onlyInBrio).toEqual([]);
    expect(onlyInHarmony).toEqual([]);
  });

  test("every --tugx-md-* token referenced by markdown CSS is declared in both themes", () => {
    const referenced = new Set<string>([
      ...extractReferenced(read(MARKDOWN_VIEW_CSS)),
      ...extractReferenced(read(MARKDOWN_BLOCK_CSS)),
    ]);
    const brio = extractDeclared(read(BRIO));
    const harmony = extractDeclared(read(HARMONY));

    const undeclaredInBrio = [...referenced]
      .filter((t) => !brio.has(t))
      .sort();
    const undeclaredInHarmony = [...referenced]
      .filter((t) => !harmony.has(t))
      .sort();

    expect(undeclaredInBrio).toEqual([]);
    expect(undeclaredInHarmony).toEqual([]);
  });

  test("token vocabulary covers every typography axis the pass commits to", () => {
    // Spot-check a representative subset of the typography surface so a
    // future refactor that accidentally drops a category fails loudly
    // here, even if the brio↔harmony equality test still passes.
    const brio = extractDeclared(read(BRIO));
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
    const missing = required.filter((t) => !brio.has(t));
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
