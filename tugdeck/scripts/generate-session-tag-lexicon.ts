/**
 * generate-session-tag-lexicon.ts — emit the Rust copy of the session-tag
 * lexicon from its TypeScript source of truth.
 *
 * The client mints a tag "from the drop" and the ledger rerolls one when a
 * mint collides, so both sides need the same two word pools. TypeScript
 * owns the words; this script writes the Rust mirror, and a Rust unit test
 * reads the TS file back at test time so drift fails the build.
 *
 * Run via `just gen-session-tag-lexicon`.
 */

import fs from "fs";
import path from "path";

import { TAG_ADJECTIVES, TAG_NOUNS } from "../src/lib/session-tag-lexicon";

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_FILE = path.join(
  ROOT,
  "tugrust",
  "crates",
  "tugcast",
  "src",
  "session_tag_lexicon.rs",
);

function poolLines(words: readonly string[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 8) {
    const chunk = words.slice(i, i + 8).map((w) => `"${w}",`);
    lines.push(`    ${chunk.join(" ")}`);
  }
  return lines;
}

export function renderRust(): string {
  return [
    "//! GENERATED — do not edit by hand.",
    "//!",
    "//! The Rust mirror of `tugdeck/src/lib/session-tag-lexicon.ts`, the two",
    "//! word pools a session's `adjective-noun` callsign is drawn from. The",
    "//! client mints from the TS lists; the ledger rerolls from these when a",
    "//! mint collides, so the two must hold the same words.",
    "//!",
    "//! Regenerate with `just gen-session-tag-lexicon`. The drift test in",
    "//! `session_ledger.rs` reads the TS source at test time and fails if the",
    "//! lists have parted.",
    "",
    "/// Adjective pool — the first word of a session tag.",
    "pub const TAG_ADJECTIVES: &[&str] = &[",
    ...poolLines(TAG_ADJECTIVES),
    "];",
    "",
    "/// Noun pool — the second word of a session tag.",
    "pub const TAG_NOUNS: &[&str] = &[",
    ...poolLines(TAG_NOUNS),
    "];",
    "",
  ].join("\n");
}

export function main(): void {
  fs.writeFileSync(OUT_FILE, renderRust(), "utf-8");
  process.stdout.write(
    `wrote ${OUT_FILE} (${TAG_ADJECTIVES.length} adjectives, ${TAG_NOUNS.length} nouns)\n`,
  );
}

if (import.meta.main) {
  main();
}
