#!/usr/bin/env bun
/**
 * select-tests.ts — resolve changed source paths to the app-test files that cover them.
 *
 * Every `*.test.ts` under `tests/app-test/` declares the source it exercises with `@covers`
 * lines in its header docblock:
 *
 *     /**
 *      * at0240-lens-focus-grammar.test.ts — ...prose...
 *      *
 *      * @covers tugdeck/src/components/lens/
 *      * @covers tugdeck/src/lib/lens-store/
 *      *\/
 *
 * A `@covers` value is either a repo-relative path prefix (a trailing `/` means the whole
 * subtree) or a glob. A changed file selects a test when it matches any of that test's
 * `@covers` values.
 *
 * Usage:
 *   bun scripts/select-tests.ts                  # derive changed paths from git
 *   bun scripts/select-tests.ts <path>...        # explicit changed paths
 *   bun scripts/select-tests.ts --print          # print the selection, run nothing
 *   bun scripts/select-tests.ts --check          # lint: exit 1 if any test lacks @covers
 *
 * Selected test filenames go to stdout, one per line (feed straight to `just app-test`).
 * Reasons, advisories, and diagnostics go to stderr.
 */

import { Glob } from "bun";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const APP_TEST_DIR = resolve(dirname(import.meta.dir));
const REPO_ROOT = resolve(APP_TEST_DIR, "..", "..");

/**
 * Changes here invalidate coverage-based selection: the harness and the app shell sit
 * underneath every test, so no `@covers` line can scope their blast radius. Selection
 * still runs, but the caller is told a full sweep is the honest answer.
 */
const SWEEP_TRIGGERS = [
    "tests/app-test/_harness/",
    "tests/app-test/scripts/",
    "tugapp/Sources/",
    "tugdeck/src/main.tsx",
    "tugdeck/index.html",
    "tugdeck/vite.config.ts",
];

interface TestCoverage {
    file: string;
    covers: string[];
}

/** Repo-relative paths of every app-test file, in run order (smoke first). */
function testFiles(): string[] {
    const bare = readdirSync(APP_TEST_DIR)
        .filter((n) => n.endsWith(".test.ts"))
        .sort();
    const smoke = readdirSync(join(APP_TEST_DIR, "harness-smoke"))
        .filter((n) => n.endsWith(".test.ts"))
        .sort()
        .map((n) => `harness-smoke/${n}`);
    return [...smoke, ...bare];
}

const COVERS_LINE = /^\s*\*?\s*@covers\s+(\S+)/;

function readCoverage(file: string): TestCoverage {
    const text = readFileSync(join(APP_TEST_DIR, file), "utf8");
    const covers: string[] = [];
    for (const line of text.split("\n")) {
        const m = COVERS_LINE.exec(line);
        if (m) covers.push(m[1]);
        // @covers lines live in the header docblock; stop at the first import.
        if (/^import\s/.test(line)) break;
    }
    return { file, covers };
}

/** A `@covers` value matches a changed path by subtree prefix or by glob. */
function matches(pattern: string, path: string): boolean {
    if (pattern.endsWith("/")) return path === pattern.slice(0, -1) || path.startsWith(pattern);
    if (!/[*?[\]{}]/.test(pattern)) return path === pattern || path.startsWith(`${pattern}/`);
    if (new Glob(pattern).match(path)) return true;
    // `dir/**` should also match `dir` itself and its direct children.
    if (pattern.endsWith("/**")) {
        const base = pattern.slice(0, -3);
        return path === base || path.startsWith(`${base}/`);
    }
    return false;
}

/** Changed paths in the working tree: staged, unstaged, and untracked. */
function changedFromGit(): string[] {
    const proc = Bun.spawnSync(["git", "status", "--porcelain", "-z", "--untracked-files=all"], {
        cwd: REPO_ROOT,
    });
    if (proc.exitCode !== 0) {
        process.stderr.write("[select-tests] git status failed — pass changed paths explicitly.\n");
        process.exit(1);
    }
    const out = new TextDecoder().decode(proc.stdout);
    const paths: string[] = [];
    // -z records are `XY <path>\0`, with renames adding a second `<origPath>\0` record.
    const records = out.split("\0").filter((r) => r.length > 0);
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const status = record.slice(0, 2);
        paths.push(record.slice(3));
        if (status.includes("R")) i++; // skip the rename's origin record
    }
    return paths;
}

const args = process.argv.slice(2);
const printOnly = args.includes("--print");
const checkOnly = args.includes("--check");
const explicit = args.filter((a) => !a.startsWith("--"));

const coverage = testFiles().map(readCoverage);

/** A `@covers` value that resolves to nothing on disk can never select its test. */
function resolvesOnDisk(pattern: string): boolean {
    const literal = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern.replace(/\/?\*\*?$/, "");
    if (existsSync(join(REPO_ROOT, literal))) return true;
    if (!/[*?[\]{}]/.test(pattern)) return false;
    const dir = literal.includes("/") ? literal.slice(0, literal.lastIndexOf("/")) : "";
    return existsSync(join(REPO_ROOT, dir));
}

if (checkOnly) {
    const missing = coverage.filter((c) => c.covers.length === 0);
    const dangling = coverage.flatMap((c) =>
        c.covers.filter((p) => !resolvesOnDisk(p)).map((p) => ({ file: c.file, pattern: p })),
    );

    if (missing.length > 0) {
        process.stderr.write(
            `[select-tests] ${missing.length} test file(s) declare no @covers — they can never be\n` +
                `               selected by 'just app-test-changed'. Add @covers to each:\n`,
        );
        for (const m of missing) process.stderr.write(`  ${m.file}\n`);
    }
    if (dangling.length > 0) {
        process.stderr.write(
            `[select-tests] ${dangling.length} @covers path(s) resolve to nothing on disk — a moved or\n` +
                `               mistyped path silently stops selecting its test:\n`,
        );
        for (const d of dangling) process.stderr.write(`  ${d.file}  →  ${d.pattern}\n`);
    }
    if (missing.length === 0 && dangling.length === 0) {
        process.stderr.write(
            `[select-tests] all ${coverage.length} test files declare @covers; every path resolves.\n`,
        );
        process.exit(0);
    }
    process.exit(1);
}

const changed = explicit.length > 0 ? explicit : changedFromGit();

if (changed.length === 0) {
    process.stderr.write("[select-tests] no changed files — nothing to select.\n");
    process.exit(0);
}

const tripped = changed.filter((p) => SWEEP_TRIGGERS.some((t) => matches(t, p)));

const selected: { file: string; because: string[] }[] = [];
for (const c of coverage) {
    const because = changed.filter((p) => c.covers.some((pattern) => matches(pattern, p)));
    if (because.length > 0) selected.push({ file: c.file, because });
}

process.stderr.write(`[select-tests] ${changed.length} changed file(s) → ${selected.length} test file(s)\n`);
for (const s of selected) {
    process.stderr.write(`  ${s.file}  ←  ${s.because.slice(0, 3).join(", ")}${s.because.length > 3 ? ", …" : ""}\n`);
}

const uncovered = changed.filter(
    (p) => !p.startsWith("tests/app-test/") && !selected.some((s) => s.because.includes(p)),
);
if (uncovered.length > 0) {
    process.stderr.write(`[select-tests] no app-test covers these changed files:\n`);
    for (const p of uncovered) process.stderr.write(`  ${p}\n`);
}

if (tripped.length > 0) {
    process.stderr.write(
        `\n[select-tests] SWEEP ADVISED — these changes sit underneath every test, so\n` +
            `               coverage-based selection cannot scope them:\n`,
    );
    for (const p of tripped) process.stderr.write(`  ${p}\n`);
    process.stderr.write(`               Consider 'just app-test-all' (every test file).\n\n`);
}

if (!printOnly) {
    for (const s of selected) process.stdout.write(`${s.file}\n`);
}
