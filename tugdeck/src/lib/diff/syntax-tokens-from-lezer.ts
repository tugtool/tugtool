/**
 * Tokenize one reconstructed diff-hunk side through the shared Lezer
 * fragment tokenizer, returning per-line character-range tokens with
 * highlight class names — the same grammar + `--tug-syntax-*` classes
 * the Text card editor and Read/Write blocks use.
 *
 * The heavy lifting lives in `lib/language-registry`'s `tokenizeFragment`
 * (headless `EditorState` + `ensureSyntaxTree` + `highlightTree`). This
 * module adds the diff-specific bit: a hunk side is a window into a
 * file, so its first line can sit inside a block comment or a CSS rule
 * whose opener is above the window. `grammarSeedLines` returns synthetic
 * opener lines to prepend before tokenizing; we drop their rows from the
 * result so offsets line up with the side's real lines.
 *
 * The `className`-carrying tokens merge with the word-level diff overlay
 * classes in `render-line.ts` on the same `<span>` — both decorations
 * compose, exactly as before (only the syntax decoration changed from a
 * Shiki inline style to a Lezer class).
 *
 * @module lib/diff/syntax-tokens-from-lezer
 */

import { tokenizeFragment, type FragmentToken } from "@/lib/language-registry";
import { grammarSeedLines } from "./grammar-seed";

/** One syntax run within a line (line-relative), carrying a class name. */
export type SyntaxToken = FragmentToken;

/**
 * Tokenize a hunk side (its lines) and return per-line tokens aligned to
 * `sideLines` — row N of the result is the tokens for `sideLines[N]`.
 *
 * `ext` is the registry file-extension key (e.g. `"ts"`, `"css"`);
 * `null` or an unregistered extension yields all-empty rows (plain text).
 */
export async function tokenizeHunkSide(
  sideLines: string[],
  ext: string | null,
): Promise<SyntaxToken[][]> {
  if (sideLines.length === 0) return [];
  const text = sideLines.join("\n");
  const seeds = grammarSeedLines(text, ext);
  const combined = seeds.length === 0 ? text : seeds.join("\n") + "\n" + text;
  const perLine = await tokenizeFragment(combined, ext);
  // Drop the synthetic seed rows; the rest align 1:1 with `sideLines`.
  return perLine.slice(seeds.length);
}
