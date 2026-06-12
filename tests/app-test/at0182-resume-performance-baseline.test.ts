/**
 * at0182-resume-performance-baseline.test.ts — resume-pipeline
 * measurement harness (small / medium / whale fixtures).
 *
 * Seeds TUI-shaped session JSONLs under the REAL `~/.claude/projects/`
 * (unique temp project path per fixture, removed in teardown), resumes
 * each through the real picker → spawn → tugcode → JSONL-replay
 * pipeline (the at0181 path), and reads the perf instrumentation back
 * via `window.__tug.getSessionPerf` — replay-ingest frames/commits/ms
 * and the row-parse counters.
 *
 * This is the MEASUREMENT leg of the resume-performance plan: it
 * asserts only structural sanity (the replay ran, counters populated)
 * and prints `BASELINE ...` lines for the plan's baseline table. The
 * budget assertions (latency ceiling, commits ≤ N, parse-once) layer
 * onto the same path in the budget app-test once the optimization
 * stages land.
 *
 * The whale leg tolerates non-completion: a 50MB+ transcript that
 * trips `REPLAY_HARD_TIMEOUT_MS` or grinds the deck is ITSELF the
 * baseline finding — the test records whatever state exists after a
 * bounded wait and reports it rather than failing.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const PICKER_FORM = ".dev-card-picker-form";
const RECENTS = '[data-tug-focus-key="dev-picker-cycle:1"]';
const OPEN = '[data-tug-focus-key="dev-picker-cycle:5"]';
const USER_ROWS =
  '[data-card-id="A"] [data-testid="dev-card-transcript-user-body"]';

const rowSel = (id: string): string => `[data-session-id="${id}"]`;

/** Mirror of claude's project-dir encoding (`/` and `.` → `-`). */
function encodeProjectDir(dir: string): string {
  return dir.replace(/[/.]/g, "-");
}

interface FixtureSpec {
  label: string;
  turns: number;
  /** Approximate size of each assistant reply's markdown body. */
  replyBytes: number;
  /** Max ms to wait for the replayed transcript / replay summary. */
  waitMs: number;
  /** When true, non-completion is recorded, not failed. */
  tolerateIncomplete: boolean;
}

const FIXTURES: FixtureSpec[] = [
  { label: "small", turns: 10, replyBytes: 300, waitMs: 60_000, tolerateIncomplete: false },
  { label: "medium", turns: 50, replyBytes: 9_000, waitMs: 120_000, tolerateIncomplete: false },
  { label: "whale", turns: 2_000, replyBytes: 26_000, waitMs: 180_000, tolerateIncomplete: true },
];

interface SeededFixture {
  spec: FixtureSpec;
  sessionId: string;
  projectDir: string;
  seededClaudeDir: string;
  jsonlBytes: number;
}

const seeded: SeededFixture[] = [];

/**
 * Markdown-ish assistant reply of roughly `bytes` length: paragraphs,
 * a list, and a code fence, so the parse cost is representative of a
 * real transcript rather than one flat text block.
 */
function assistantReplyMarkdown(turn: number, bytes: number): string {
  const para =
    `Turn ${turn}: the quick brown fox jumps over the lazy dog while ` +
    `the build pipeline hums along and the reviewer squints at the diff. `;
  const chunks: string[] = [];
  let size = 0;
  let i = 0;
  while (size < bytes) {
    let block: string;
    if (i % 4 === 2) {
      block = `\n\`\`\`ts\nfunction step${turn}_${i}(x: number): number {\n  return x * ${i + 1};\n}\n\`\`\`\n`;
    } else if (i % 4 === 3) {
      block = `\n- item one for ${turn}\n- item two for ${turn}\n- item three for ${turn}\n\n`;
    } else {
      block = para;
    }
    chunks.push(block);
    size += block.length;
    i += 1;
  }
  return chunks.join("");
}

/** TUI-shaped transcript with `turns` committed user→assistant turns. */
function tuiSessionJsonl(
  sessionId: string,
  cwd: string,
  title: string,
  turns: number,
  replyBytes: number,
): string {
  const lines: string[] = [
    JSON.stringify({ type: "mode", mode: "normal", sessionId }),
    JSON.stringify({
      type: "permission-mode",
      permissionMode: "default",
      sessionId,
    }),
  ];
  let parent: string | null = null;
  const t0 = Date.parse("2026-06-10T10:00:00.000Z");
  const stamp = (uuid: string, parentUuid: string | null, t: number) => ({
    parentUuid,
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.173",
    gitBranch: "",
    uuid,
    timestamp: new Date(t).toISOString(),
  });
  for (let n = 1; n <= turns; n++) {
    const u = randomUUID();
    const a = randomUUID();
    lines.push(
      JSON.stringify({
        ...stamp(u, parent, t0 + n * 60_000),
        type: "user",
        message: { role: "user", content: `seeded prompt ${n}` },
      }),
    );
    lines.push(
      JSON.stringify({
        ...stamp(a, u, t0 + n * 60_000 + 5_000),
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          id: `msg_at0182_${n}`,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: assistantReplyMarkdown(n, replyBytes) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        },
        requestId: `req_at0182_${n}`,
      }),
    );
    parent = a;
  }
  lines.push(JSON.stringify({ type: "ai-title", aiTitle: title, sessionId }));
  return lines.join("\n");
}

beforeAll(() => {
  if (!SHOULD_RUN) return;
  for (const spec of FIXTURES) {
    const projectDir = realpathSync(
      mkdtempSync(join(tmpdir(), `at0182-${spec.label}-`)),
    );
    const seededClaudeDir = join(
      homedir(),
      ".claude",
      "projects",
      encodeProjectDir(projectDir),
    );
    mkdirSync(seededClaudeDir, { recursive: true });
    const sessionId = randomUUID();
    const jsonl = tuiSessionJsonl(
      sessionId,
      projectDir,
      `Baseline ${spec.label}`,
      spec.turns,
      spec.replyBytes,
    );
    writeFileSync(join(seededClaudeDir, `${sessionId}.jsonl`), jsonl);
    seeded.push({
      spec,
      sessionId,
      projectDir,
      seededClaudeDir,
      jsonlBytes: jsonl.length,
    });
  }
});

afterAll(() => {
  for (const f of seeded) {
    if (existsSync(f.seededClaudeDir)) {
      rmSync(f.seededClaudeDir, { recursive: true, force: true });
    }
    if (existsSync(f.projectDir)) {
      rmSync(f.projectDir, { recursive: true, force: true });
    }
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function clickElement(
  app: { evalJS<T>(s: string): Promise<T> },
  selector: string,
): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return false;
      el.scrollIntoView({ block: "nearest" });
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    })()`,
  );
}

interface PerfRead {
  replay: { frames: number; commits: number; startedAtMs: number } | null;
  lastReplay: {
    startedAtMs: number;
    completedAtMs: number | null;
    frames: number;
    folds: number;
    commits: number;
  } | null;
  rowParse: {
    parses: number;
    cacheHits: number;
    memoHits: number;
    identities: number;
    maxParsesPerIdentity: number;
  };
}

async function resumeAndMeasure(fixture: SeededFixture): Promise<void> {
  const { spec, sessionId, projectDir, jsonlBytes } = fixture;
  const app = await launchTugApp({
    testName: `at0182-baseline-${spec.label}`,
  });
  try {
    await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
    await app.waitForCondition<boolean>(
      `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
    );
    await app.waitForCondition<boolean>(
      `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`,
      { timeoutMs: 8000 },
    );
    await app.evalJS<null>(
      `(window.__tug.setTugbankValue("dev.tugtool.dev", "recent-projects", { kind: "json", value: { paths: [${JSON.stringify(projectDir)}] } }), null)`,
    );
    await app.waitForCondition<boolean>(
      `document.querySelector(${JSON.stringify(RECENTS)}) !== null`,
      { timeoutMs: 8000 },
    );
    // The recents list seeds its owned selection to the first recent at
    // mount, which fills the path field before any interaction — the
    // sessions query fires off that fill. No keyboard dance needed (and
    // the at0181-style Tab/Tab/Enter is actively hazardous here: on a
    // slow-scanning project the picker's Enter falls through to a
    // no-selection submit that opens a NEW session and dismisses the
    // picker — observed with the 52MB whale fixture).
    await app.waitForCondition<boolean>(
      `(function(){
        var el = document.querySelector(".dev-card-picker-form input");
        return el !== null && el.value === ${JSON.stringify(projectDir)};
      })()`,
      { timeoutMs: 8000 },
    );

    // Whale-scale JSONLs take the external scan a while to parse on a
    // cold cache — give the tolerant leg a generous budget to LIST and
    // record the listing latency as part of the baseline. A tolerant
    // leg that never lists records the UI state instead of failing:
    // "the whale can't even list" is itself a baseline finding.
    const listStartedAt = Date.now();
    let listed = true;
    try {
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(rowSel(sessionId))}) !== null`,
        { timeoutMs: spec.tolerateIncomplete ? 60_000 : 20_000 },
      );
    } catch (err) {
      if (!spec.tolerateIncomplete) throw err;
      listed = false;
    }
    const listMs = Date.now() - listStartedAt;
    if (!listed) {
      const uiState = await app.evalJS<unknown>(
        `(function(){
          return {
            pickerPresent: document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null,
            sessionRowCount: document.querySelectorAll("[data-session-id]").length,
            transcriptPresent: document.querySelector('[data-testid="dev-card-transcript"]') !== null,
            pathField: (function(){ var el = document.querySelector(".dev-card-picker-form input"); return el ? el.value : null; })(),
          };
        })()`,
      );
      console.log(
        `BASELINE ${spec.label}: DID NOT LIST within ${Math.round((Date.now() - listStartedAt) / 1000)}s ` +
          `bytes=${jsonlBytes} ui=${JSON.stringify(uiState)}`,
      );
      return;
    }
    expect(await clickElement(app, rowSel(sessionId))).toBe(true);
    await app.waitForCondition<boolean>(
      `(function(){
        var el = document.querySelector(${JSON.stringify(rowSel(sessionId))});
        return el !== null && el.getAttribute("data-selected") === "true";
      })()`,
      { timeoutMs: 6000 },
    );

    const openedAt = Date.now();
    expect(await clickElement(app, OPEN)).toBe(true);

    // Wait for the replay to finish ingesting (the store's window
    // closes into lastReplay) AND the transcript rows to be present.
    // Above the windowed-mounting threshold (~1200 rows) only the
    // visible window's cells exist in the DOM, so the whale expects
    // a mounted tail, not the full row count. The whale leg also
    // tolerates a stall — whatever state exists at the deadline IS
    // the baseline finding.
    const expectedMountedRows = spec.turns * 2 > 1200 ? 1 : spec.turns;
    let completed = true;
    try {
      await app.waitForCondition<boolean>(
        `(function(){
          if (typeof window.__tug === "undefined") return false;
          var perf;
          try { perf = window.__tug.getSessionPerf("A"); } catch (e) { return false; }
          if (perf.lastReplay === null) return false;
          return document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length >= ${expectedMountedRows};
        })()`,
        { timeoutMs: spec.waitMs },
      );
    } catch (err) {
      if (!spec.tolerateIncomplete) throw err;
      completed = false;
    }
    const wallMs = Date.now() - openedAt;

    const perf = await app.evalJS<PerfRead>(
      `window.__tug.getSessionPerf("A")`,
    );
    const rows = await app.evalJS<number>(
      `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length`,
    );

    console.log(
      `BASELINE ${spec.label}: turns=${spec.turns} bytes=${jsonlBytes} ` +
        `completed=${completed} listMs=${listMs} wallMs=${wallMs} userRows=${rows} ` +
        `ingest=${JSON.stringify(perf.lastReplay ?? perf.replay)} ` +
        `rowParse=${JSON.stringify(perf.rowParse)}`,
    );

    if (!spec.tolerateIncomplete) {
      // Structural sanity — the instrumentation populated end to end.
      expect(perf.lastReplay).not.toBeNull();
      expect(perf.lastReplay!.frames).toBeGreaterThan(0);
      expect(perf.lastReplay!.commits).toBeGreaterThan(0);
      expect(perf.rowParse.parses).toBeGreaterThan(0);
      expect(rows).toBe(spec.turns);
    }
  } finally {
    await app.close();
  }
}

describe.skipIf(!SHOULD_RUN)("AT0182: resume-performance baseline", () => {
  test("small fixture resumes and records its waterfall", async () => {
    await resumeAndMeasure(seeded.find((f) => f.spec.label === "small")!);
  }, 180_000);

  test("medium fixture resumes and records its waterfall", async () => {
    await resumeAndMeasure(seeded.find((f) => f.spec.label === "medium")!);
  }, 300_000);

  // Active since windowed mounting landed. The whale's earlier
  // failure modes — pre-fold, a 7+ minute main-thread wedge from
  // one-commit-per-frame ingest; post-fold, a WebContent OOM from
  // eagerly mounting 2000 turns × 26KB of markdown — are both gone
  // once off-window rows unmount to spacers. The server side was
  // never the problem: 53MB lists in ~1s and replays end-to-end in
  // ~2.2s with zero broadcast lag.
  test("whale fixture records whatever the pipeline manages", async () => {
    await resumeAndMeasure(seeded.find((f) => f.spec.label === "whale")!);
  }, 420_000);
});
