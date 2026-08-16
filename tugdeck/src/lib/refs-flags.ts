/**
 * refs-flags — the typed-flag grammar for `/match` and `/search` ([P07]).
 *
 * A refs command is `<needles…>` plus short flags. This module is the ONE
 * place that grammar lives: it parses a typed argument line into the needles
 * and the normalized flag record the feed's serde enums read, and it emits
 * the inverse — flags back to the tokens that would produce them. The
 * deferred option cluster (chips writing flags into the draft) calls the
 * emitter rather than growing a second grammar that can drift from this one.
 *
 * Typed flags are the truth ([P07]): whatever a future chip surface shows, it
 * has to be expressible as a line the user could have typed.
 *
 * Pure data + pure functions — no React, no DOM, no store.
 *
 * @module lib/refs-flags
 */

import type { RefsOpKind } from "./refs-session-store";

/** The flag record the feed reads — every key `false` unless the line set it. */
export type RefsFlags = Record<string, boolean>;

/** What a typed argument line parsed to. */
export interface ParsedRefsCommand {
  /** The search terms, in typed order, quotes stripped. */
  needles: string[];
  /** Flags in the feed's own spelling. */
  flags: RefsFlags;
  /** Flags the line carried that this op does not have — reported, ignored. */
  unknown: string[];
}

/**
 * `/match` flags (List L01). Defaults are case-insensitive substring over
 * filenames, all needles required.
 */
const MATCH_FLAGS: Readonly<Record<string, string>> = {
  a: "any",
  e: "exact",
  d: "dirs",
  s: "case_sensitive",
  "1": "first_only",
};

/**
 * `/search` flags (List L02). Defaults are case-sensitive string search, all
 * needles on one line, gitignore + `SecretFilter` skipped.
 *
 * `-a` and `-s` are the same flag: `-a` reads as "all files" and `-s` was the
 * older spelling, and both are kept because a user who learned either is not
 * wrong. Note `-s` means case-SENSITIVE for `/match` and all-files here —
 * the two ops have separate tables precisely so neither has to compromise.
 */
const SEARCH_FLAGS: Readonly<Record<string, string>> = {
  i: "case_insensitive",
  e: "regex",
  y: "any",
  a: "all_files",
  s: "all_files",
  l: "per_line",
};

/** The flag table for an op. */
function flagTable(kind: RefsOpKind): Readonly<Record<string, string>> {
  return kind === "match" ? MATCH_FLAGS : SEARCH_FLAGS;
}

/**
 * Split an argument line into tokens, honoring single and double quotes so a
 * needle can carry a space. An unterminated quote runs to the end of the line
 * rather than dropping the token — a user mid-type has an odd quote count
 * most of the time.
 */
export function tokenizeRefsArgs(args: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of args) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/**
 * Parse a `/match` or `/search` argument line.
 *
 * Short flags cluster (`-ie` is `-i -e`). A bare `--` ends flag parsing, so a
 * needle that genuinely starts with a dash is still reachable. An unknown
 * flag is collected rather than guessed at — the caller surfaces it as a
 * subdued notice and runs the rest of the line, because dropping the whole
 * command over one typo is worse than running the search the user meant.
 */
export function parseRefsArgs(kind: RefsOpKind, args: string): ParsedRefsCommand {
  const table = flagTable(kind);
  const needles: string[] = [];
  const flags: RefsFlags = {};
  const unknown: string[] = [];
  let flagsEnded = false;
  for (const token of tokenizeRefsArgs(args)) {
    if (!flagsEnded && token === "--") {
      flagsEnded = true;
      continue;
    }
    if (!flagsEnded && token.length > 1 && token.startsWith("-")) {
      for (const ch of token.slice(1)) {
        const name = table[ch];
        if (name === undefined) unknown.push(`-${ch}`);
        else flags[name] = true;
      }
      continue;
    }
    if (token !== "") needles.push(token);
  }
  return { needles, flags, unknown };
}

/**
 * The inverse: the flag tokens that would produce `flags` for this op, in
 * table order and clustered into one `-xyz` token (or `""` for no flags).
 * The option cluster ([P07], deferred) writes its state into the draft with
 * this, so what a chip sets is always a line the user could have typed.
 *
 * For `/search`, `all_files` emits `-a` — the two spellings mean one flag and
 * one of them has to be the canonical output.
 */
export function composeRefsFlagTokens(kind: RefsOpKind, flags: RefsFlags): string {
  const table = flagTable(kind);
  const emitted = new Set<string>();
  let letters = "";
  for (const [letter, name] of Object.entries(table)) {
    if (flags[name] !== true || emitted.has(name)) continue;
    emitted.add(name);
    letters += letter;
  }
  return letters === "" ? "" : `-${letters}`;
}

/** The command line a run echoes in its block header — `/search -i foo bar`. */
export function composeRefsCommandLine(
  kind: RefsOpKind,
  needles: readonly string[],
  flags: RefsFlags,
): string {
  const tokens = composeRefsFlagTokens(kind, flags);
  return [`/${kind}`, ...(tokens === "" ? [] : [tokens]), ...needles].join(" ");
}
