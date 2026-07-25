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
 *   bun scripts/select-tests.ts --check          # lint: @covers present, resolving, and scoped
 *   bun scripts/select-tests.ts --allow-large    # emit a selection that exceeds MAX_SELECTED
 *
 * Selected test filenames go to stdout, one per line (feed straight to `just app-test`).
 * Reasons, advisories, and diagnostics go to stderr.
 *
 * ## The selection budget
 *
 * A derived selection is only useful if it stays small. Past MAX_SELECTED files the run
 * stops being "the tests for my change" and becomes a sweep in disguise — twenty minutes
 * of serialized Tug.app launches nobody asked for. So the budget is a REFUSAL, not a
 * warning: over it, this script emits no filenames and exits EXIT_OVER_BUDGET, and the
 * caller must either narrow the diff or opt in explicitly with `--allow-large`.
 *
 * `--check` enforces the same ceiling ahead of time: no single source path may fan out to
 * more than MAX_SELECTED tests. Today's hub files already exceed it and are recorded in
 * ACCEPTED_FANOUT as known debt — the lint holds that line so the fan-out can shrink but
 * never grow, and a NEW hub fails the check on the commit that creates it.
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
    // The harness and the app shell.
    "tests/app-test/_harness/",
    "tests/app-test/scripts/",
    "tugapp/Sources/",
    "tugdeck/src/main.tsx",
    "tugdeck/index.html",
    "tugdeck/vite.config.ts",
    // Shared UI substrate: components most tests drive without naming, because they
    // mount inside every card. Declaring these honestly in each test that touches them
    // would make one edit select 23–79 files — a sweep wearing a selection's clothes.
    // They are listed here instead, so a change says plainly that it cannot be scoped.
    "tugdeck/src/components/chrome/card-host.tsx",
    "tugdeck/src/components/tugways/tug-text-editor.tsx",
    "tugdeck/src/gesture-interpreter.ts",
    "tugdeck/src/components/tugways/tug-sheet.tsx",
    "tugdeck/src/components/tugways/cards/session-card.tsx",
    "tugdeck/src/components/tugways/cards/session-card-transcript.tsx",
];

/**
 * The most test files a derived selection may run without an explicit opt-in. Sized to
 * the core tier (~20 files, a few minutes): past this, selection has stopped scoping the
 * change and the caller should be the one deciding to spend the time.
 */
const MAX_SELECTED = 20;

/** Exit code for a selection that exceeds {@link MAX_SELECTED}; distinct from a hard error. */
const EXIT_OVER_BUDGET = 3;

/**
 * Source paths already fanning out past {@link MAX_SELECTED}, with the count observed when
 * each was recorded. These are real coupling, not sloppy `@covers` — `focus-manager.ts` is
 * genuinely exercised by most focus tests — so the lint accepts them at their CURRENT number
 * and fails if it climbs. Lower a number when the fan-out shrinks; adding an entry should be
 * a deliberate, argued act, not a reflex to make the lint quiet.
 */
const ACCEPTED_FANOUT: Record<string, number> = {
    "tugdeck/src/components/tugways/focus-manager.ts": 61,
    "tugdeck/src/focus-transfer.ts": 29,
    "tugdeck/src/components/tugways/tug-text-editor/": 29,
    // The two editor modules named individually by a test on top of the 29 that name the
    // whole directory — the directory declaration is what actually costs here.
    "tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts": 30,
    "tugdeck/src/components/tugways/tug-text-editor/state-preservation.ts": 30,
    "tugdeck/src/card-state-orchestrator.ts": 21,
};

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
const holesOnly = args.includes("--holes");
const allowLarge = args.includes("--allow-large");
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

/**
 * A concrete changed-file path standing in for a `@covers` value, so a pattern's fan-out can
 * be measured with the same {@link matches} the real selection uses. A subtree pattern is
 * probed with a file inside it; a bare path is probed as itself.
 */
function representativePath(pattern: string): string {
    if (pattern.endsWith("/")) return `${pattern}__probe__.ts`;
    return pattern.replace(/\/?\*\*?$/, "/__probe__.ts");
}

/** How many test files a change to `path` would select. */
function fanOut(path: string): number {
    return coverage.filter((c) => c.covers.some((q) => matches(q, path))).length;
}

/**
 * Source roots an app-test can meaningfully cover. Everything outside these is either not
 * app-test territory (Rust unit-tested crates, build scripts) or is a SWEEP_TRIGGER, whose
 * blast radius no `@covers` line can scope anyway.
 */
const HOLE_ROOTS = ["tugdeck/src/", "tugdeck/styles/", "tugcode/src/"];

/** Source files no app-test selects — a change there runs nothing. */
function coverageHoles(): string[] {
    const proc = Bun.spawnSync(["git", "ls-files", "-z", ...HOLE_ROOTS], { cwd: REPO_ROOT });
    if (proc.exitCode !== 0) return [];
    return new TextDecoder()
        .decode(proc.stdout)
        .split("\0")
        .filter((p) => /\.(ts|tsx|css)$/.test(p))
        .filter((p) => !p.includes("/__tests__/") && !p.endsWith(".test.ts"))
        // Retired code nothing mounts — a "hole" there is not a gap to close.
        .filter((p) => !p.includes("/_archive/"))
        .filter((p) => !SWEEP_TRIGGERS.some((t) => matches(t, p)))
        .filter((p) => fanOut(p) === 0);
}

if (holesOnly) {
    const holes = coverageHoles();
    const byDir = new Map<string, number>();
    for (const h of holes) {
        const dir = h.slice(0, h.lastIndexOf("/") + 1);
        byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    }
    process.stderr.write(
        `[select-tests] ${holes.length} source file(s) no app-test selects, by directory:\n`,
    );
    for (const [dir, n] of [...byDir].sort((a, b) => b[1] - a[1])) {
        process.stderr.write(`  ${String(n).padStart(4)}  ${dir}\n`);
    }
    for (const h of holes) process.stdout.write(`${h}\n`);
    process.exit(0);
}

if (checkOnly) {
    const missing = coverage.filter((c) => c.covers.length === 0);
    const dangling = coverage.flatMap((c) =>
        c.covers.filter((p) => !resolvesOnDisk(p)).map((p) => ({ file: c.file, pattern: p })),
    );

    // Every distinct declared path, measured for blast radius.
    const patterns = [...new Set(coverage.flatMap((c) => c.covers))];
    const overBudget: { pattern: string; count: number; accepted: number | undefined }[] = [];
    for (const pattern of patterns) {
        const count = fanOut(representativePath(pattern));
        if (count <= MAX_SELECTED) continue;
        const accepted = ACCEPTED_FANOUT[pattern];
        if (accepted !== undefined && count <= accepted) continue;
        overBudget.push({ pattern, count, accepted });
    }

    if (overBudget.length > 0) {
        process.stderr.write(
            `[select-tests] ${overBudget.length} path(s) fan out past the ${MAX_SELECTED}-file selection\n` +
                `               budget — a one-line edit there turns 'app-test-changed' into a sweep:\n`,
        );
        for (const o of overBudget) {
            const was = o.accepted === undefined ? "not accepted" : `accepted at ${o.accepted}`;
            process.stderr.write(`  ${o.pattern}  →  ${o.count} tests (${was})\n`);
        }
        process.stderr.write(
            `               Narrow the @covers lines that name it, split the module, or — if the\n` +
                `               coupling is real — record it in ACCEPTED_FANOUT with its count.\n`,
        );
    }

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
    if (missing.length === 0 && dangling.length === 0 && overBudget.length === 0) {
        const worst = patterns
            .map((p) => ({ p, n: fanOut(representativePath(p)) }))
            .sort((a, b) => b.n - a.n)
            .slice(0, 3);
        process.stderr.write(
            `[select-tests] ${coverage.length} test files: @covers present, resolving, and within\n` +
                `               the ${MAX_SELECTED}-file budget. Widest fan-out: ` +
                `${worst.map((w) => `${w.p} (${w.n})`).join(", ")}\n`,
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

// The budget refusal. Deliberately AFTER the per-test reasons above, so an over-budget
// caller still sees exactly what would have run and why before deciding.
if (!printOnly && !allowLarge && selected.length > MAX_SELECTED) {
    process.stderr.write(
        `\n[select-tests] REFUSED — ${selected.length} test files exceeds the ${MAX_SELECTED}-file\n` +
            `               selection budget. That is ~${Math.round((selected.length * 15) / 60)} minutes of\n` +
            `               serialized Tug.app launches, which is a sweep, not a scoped run.\n\n` +
            `               Narrow the diff, or name the few tests you actually want:\n` +
            `                 just app-test <file>...\n` +
            `               Or opt in deliberately:\n` +
            `                 just app-test-changed --allow-large\n`,
    );
    process.exit(EXIT_OVER_BUDGET);
}

if (!printOnly) {
    for (const s of selected) process.stdout.write(`${s.file}\n`);
}
