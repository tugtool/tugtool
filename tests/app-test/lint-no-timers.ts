#!/usr/bin/env bun
/**
 * lint-no-timers.ts — Lint check: no `setTimeout` / `setInterval` in
 * `tests/app-test/`.
 *
 * Parent plan [D12] bans `setTimeout` / `setInterval` from in-app test
 * files. Every wait is a `waitForCondition` over a pure boolean
 * expression so the test's timing budget lives in one place (the RPC
 * server) rather than being smeared across local polling loops.
 *
 * Scope
 * -----
 * The ban applies to:
 *   - every `.ts` file under `tests/app-test/` that is NOT a harness
 *     internal (`tests/app-test/_harness/**`).
 *
 * The harness itself is allowed to use `setTimeout` / `setInterval`
 * because it owns subprocess lifecycle timing (connect backoff,
 * SIGTERM grace window). The harness indirects through a
 * `setTimeoutNative` local so the ban's grep check here has no false
 * positives outside `_harness/`.
 *
 * Usage
 * -----
 *     bun run tests/app-test/lint-no-timers.ts
 *
 * Exits 0 if clean, 1 if any banned token is found. A failure prints
 * each `file:line: line-content` hit so the author can locate it.
 *
 * Design notes
 * ------------
 * We do not shell out to `grep` or `rg` because the harness runs on
 * bun and we want this check to work on any developer machine
 * regardless of grep dialect. The Bun stdlib via `node:fs` is enough
 * for a recursive walk over a ~dozen-file tree.
 *
 * Detection uses a word-boundary regex (`\bsetTimeout\b` /
 * `\bsetInterval\b`). That means prose mentions inside comments also
 * trip the linter — which is the right thing: we don't want a
 * helpful comment to accidentally train tests to reach for the
 * native scheduler later. Test files that need to reference the
 * banned names in documentation should spell them without the
 * exact token (e.g. "set-timeout").
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

// Absolute root for the scan. `import.meta.dir` resolves to the
// directory of this file, so the project root is the directory
// itself (we want to scan every `.ts` below it).
const ROOT = resolve(import.meta.dir);

// Directories NEVER scanned. `_harness/` is the allowlist — harness
// internals own the subprocess lifecycle and need the native
// scheduler. `node_modules/` and `logs/` are generated.
const DIRECTORY_ALLOWLIST = new Set(["_harness", "node_modules", "logs"]);

// Don't scan this lint script itself — every documented-ban mention
// of `setTimeout` / `setInterval` in the prose block above would
// otherwise be a false positive, and the block is required to
// explain the lint rule.
const FILE_ALLOWLIST = new Set(["lint-no-timers.ts"]);

// The banned patterns. `\b` is the JS regex word-boundary, which
// matches between `\w` and `\W` positions; that rules out matches
// like `resetTimeout` or `mySetInterval`.
const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "setTimeout", regex: /\bsetTimeout\b/ },
  { name: "setInterval", regex: /\bsetInterval\b/ },
];

interface Hit {
  filePath: string; // relative to ROOT for readable output
  line: number;     // 1-indexed
  content: string;  // trimmed line content
  name: string;     // "setTimeout" or "setInterval"
}

/**
 * Recursively collect every `.ts` file under `dir`, skipping any
 * directory whose basename is in {@link DIRECTORY_ALLOWLIST}.
 */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir);
  for (const name of entries) {
    const abs = resolve(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (DIRECTORY_ALLOWLIST.has(name)) continue;
      out.push(...collectTsFiles(abs));
      continue;
    }
    if (!st.isFile()) continue;
    if (!name.endsWith(".ts")) continue;
    if (FILE_ALLOWLIST.has(name)) continue;
    out.push(abs);
  }
  return out;
}

/**
 * Scan a single file for banned patterns. Returns an array of
 * {@link Hit} — one per (line, pattern) match. We report every match
 * so a fix-up sweep sees the whole picture in one pass.
 */
function scanFile(filePath: string): Hit[] {
  const src = readFileSync(filePath, "utf8");
  const lines = src.split("\n");
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    for (const { name, regex } of PATTERNS) {
      if (regex.test(raw)) {
        hits.push({
          filePath: relative(ROOT, filePath),
          line: i + 1,
          content: raw.trim(),
          name,
        });
      }
    }
  }
  return hits;
}

function main(): number {
  const files = collectTsFiles(ROOT);
  const hits: Hit[] = [];
  for (const file of files) {
    hits.push(...scanFile(file));
  }
  if (hits.length === 0) {
    console.log(`lint-no-timers: clean (${files.length} files scanned)`);
    return 0;
  }
  console.error(`lint-no-timers: ${hits.length} banned-token hit(s):`);
  for (const h of hits) {
    console.error(`  ${h.filePath}:${h.line}: [${h.name}] ${h.content}`);
  }
  console.error(
    "\nParent plan [D12]: `setTimeout` / `setInterval` are banned in " +
      "`tests/app-test/` outside `_harness/`. Use `app.waitForCondition(...)` " +
      "instead — the server polls on a pure boolean expression and honors a " +
      "single, explicit timeout budget.",
  );
  return 1;
}

process.exit(main());
