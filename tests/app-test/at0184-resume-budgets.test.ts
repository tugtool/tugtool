/**
 * at0184-resume-budgets.test.ts — the resume-performance BUDGET
 * gates. Where at0182/at0183 measure, this file asserts:
 *
 *  medium (50 turns, inline mounting):
 *   - wall from Open → transcript committed under the 2s ceiling
 *     (machine-generous; the dev-machine number runs ~0.8s)
 *   - replay ingest ≤ 5 store commits (the fold contract)
 *   - parse-once after replay: no identity parsed more than once
 *   - live incremental turn (synthesized wake bracket — no wire
 *     emission, no real claude call): only the streaming tail parses;
 *     the 100 finalized cells memo out
 *   - [L23] selection survives a full scroll round trip under the
 *     content-visibility deferral
 *
 *  whale-rows (2500 turns, windowed mounting):
 *   - completes; replay paints progressively (multiple fold flushes
 *     before the window closes)
 *   - parse-once holds at scale
 *   - scrolling into never-mounted territory is served by the warm
 *     cache (cache hits grow; fresh parses stay ~zero)
 *   - [L23] a selection in a bottom row survives scrolling to the
 *     top: the selection pin keeps its row MOUNTED while every other
 *     bottom row unmounts
 *
 * Wall-clock gates are deliberately generous (CI variance); the
 * counters are the machine-insensitive teeth.
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
const FEED_CODE_OUTPUT = 0x40;

const rowSel = (id: string): string => `[data-session-id="${id}"]`;

function encodeProjectDir(dir: string): string {
  return dir.replace(/[/.]/g, "-");
}

interface BudgetSpec {
  label: "medium" | "whale-rows" | "tool-heavy";
  turns: number;
  replyBytes: number;
  /** Tool_use/tool_result pairs per turn (the real-session shape). */
  toolsPerTurn: number;
  windowed: boolean;
  waitMs: number;
}

const FIXTURES: BudgetSpec[] = [
  { label: "medium", turns: 50, replyBytes: 9_000, toolsPerTurn: 0, windowed: false, waitMs: 60_000 },
  { label: "whale-rows", turns: 2_500, replyBytes: 2_000, toolsPerTurn: 0, windowed: true, waitMs: 120_000 },
  // Mirrors a real working session that froze the deck ~20s pre-fix:
  // few rows, thousands of message blocks (tool calls dominate). 50
  // turns × 20 tool pairs ≈ 2,100 messages — over the message-weight
  // threshold, so windowed mounting bounds the commit.
  { label: "tool-heavy", turns: 50, replyBytes: 2_000, toolsPerTurn: 20, windowed: true, waitMs: 120_000 },
];

interface SeededBudget {
  spec: BudgetSpec;
  sessionId: string;
  projectDir: string;
  seededClaudeDir: string;
}

const seeded: SeededBudget[] = [];

function reply(turn: number, bytes: number): string {
  const para =
    `Turn ${turn}: budget fixture prose with **bold**, \`code\`, and ` +
    `enough body to make the parse representative of a real reply. `;
  const chunks: string[] = [];
  let size = 0;
  let i = 0;
  while (size < bytes) {
    const block =
      i % 3 === 2
        ? `\n\`\`\`ts\nfunction b${turn}_${i}(x: number) { return x + ${i}; }\n\`\`\`\n`
        : para;
    chunks.push(block);
    size += block.length;
    i += 1;
  }
  return chunks.join("");
}

function budgetJsonl(sessionId: string, cwd: string, spec: BudgetSpec): string {
  const lines: string[] = [
    JSON.stringify({ type: "mode", mode: "normal", sessionId }),
  ];
  let parent: string | null = null;
  const t0 = Date.parse("2026-06-01T10:00:00.000Z");
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
  for (let n = 1; n <= spec.turns; n++) {
    const u = randomUUID();
    lines.push(
      JSON.stringify({
        ...stamp(u, parent, t0 + n * 30_000),
        type: "user",
        message: { role: "user", content: `budget prompt ${n}` },
      }),
    );
    parent = u;
    // Tool cycle: assistant tool_use (stop_reason "tool_use" keeps
    // the turn open) followed by the user-side tool_result — the
    // shape real working sessions are made of.
    for (let i = 0; i < spec.toolsPerTurn; i++) {
      const at = randomUUID();
      const ut = randomUUID();
      lines.push(
        JSON.stringify({
          ...stamp(at, parent, t0 + n * 30_000 + 1_000 + i * 100),
          type: "assistant",
          message: {
            model: "claude-opus-4-7",
            id: `msg_at0184_${n}_t${i}`,
            type: "message",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: `toolu_at0184_${n}_${i}`,
                name: "Bash",
                input: { command: `echo step ${n}.${i} && ls -la src/` },
              },
            ],
            stop_reason: "tool_use",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          },
          requestId: `req_at0184_${n}_t${i}`,
        }),
      );
      lines.push(
        JSON.stringify({
          ...stamp(ut, at, t0 + n * 30_000 + 1_050 + i * 100),
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: `toolu_at0184_${n}_${i}`,
                content: `output ${n}.${i}: ${"line of tool output\n".repeat(i % 5 === 0 ? 200 : 12)}`,
              },
            ],
          },
        }),
      );
      parent = ut;
    }
    const a = randomUUID();
    lines.push(
      JSON.stringify({
        ...stamp(a, parent, t0 + n * 30_000 + 5_000),
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          id: `msg_at0184_${n}`,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: reply(n, spec.replyBytes) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        },
        requestId: `req_at0184_${n}`,
      }),
    );
    parent = a;
  }
  lines.push(
    JSON.stringify({ type: "ai-title", aiTitle: `Budget ${spec.label}`, sessionId }),
  );
  return lines.join("\n");
}

beforeAll(() => {
  if (!SHOULD_RUN) return;
  for (const spec of FIXTURES) {
    const projectDir = realpathSync(
      mkdtempSync(join(tmpdir(), `at0184-${spec.label}-`)),
    );
    const seededClaudeDir = join(
      homedir(),
      ".claude",
      "projects",
      encodeProjectDir(projectDir),
    );
    mkdirSync(seededClaudeDir, { recursive: true });
    const sessionId = randomUUID();
    writeFileSync(
      join(seededClaudeDir, `${sessionId}.jsonl`),
      budgetJsonl(sessionId, projectDir, spec),
    );
    seeded.push({ spec, sessionId, projectDir, seededClaudeDir });
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

interface AppHandle {
  evalJS<T>(s: string): Promise<T>;
  waitForCondition<T>(s: string, o?: { timeoutMs?: number }): Promise<T>;
}

function clickElement(app: AppHandle, selector: string): Promise<boolean> {
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

function readPerf(app: AppHandle): Promise<PerfRead> {
  return app.evalJS<PerfRead>(`window.__tug.getSessionPerf("A")`);
}

/** Resume the seeded session through the real picker flow. */
async function resume(app: AppHandle, fixture: SeededBudget): Promise<number> {
  const { sessionId, projectDir, spec } = fixture;
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
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(".dev-card-picker-form input");
      return el !== null && el.value === ${JSON.stringify(projectDir)};
    })()`,
    { timeoutMs: 8000 },
  );
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(rowSel(sessionId))}) !== null`,
    { timeoutMs: 30_000 },
  );
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
  const expectedMounted = spec.windowed ? 1 : spec.turns;
  await app.waitForCondition<boolean>(
    `(function(){
      if (typeof window.__tug === "undefined") return false;
      var perf;
      try { perf = window.__tug.getSessionPerf("A"); } catch (e) { return false; }
      if (perf.lastReplay === null) return false;
      return document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length >= ${expectedMounted};
    })()`,
    { timeoutMs: spec.waitMs },
  );
  return Date.now() - openedAt;
}

const SCROLLER = '[data-card-id="A"] .dev-card-transcript .tug-list-view';

function setScroll(app: AppHandle, expr: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(SCROLLER)});
      if (el === null) return false;
      el.scrollTop = ${expr};
      void el.offsetHeight;
      return true;
    })()`,
  );
}

/** Select the contents of the first (or last) mounted user row. */
function selectUserRow(
  app: AppHandle,
  which: "first" | "last",
): Promise<string> {
  return app.evalJS<string>(
    `(function(){
      var rows = document.querySelectorAll(${JSON.stringify(USER_ROWS)});
      if (rows.length === 0) return "";
      var el = rows[${which === "first" ? "0" : "rows.length - 1"}];
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return sel.toString();
    })()`,
  );
}

function selectionText(app: AppHandle): Promise<string> {
  return app.evalJS<string>(
    `(window.getSelection() ? window.getSelection().toString() : "")`,
  );
}

describe.skipIf(!SHOULD_RUN)("AT0184: resume budgets", () => {
  test("medium: latency + fold + parse-once budgets, live tail-only turn, selection survival", async () => {
    const fixture = seeded.find((f) => f.spec.label === "medium")!;
    const app = await launchTugApp({ testName: "at0184-medium" });
    try {
      await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );
      const wallMs = await resume(app, fixture);

      // Latency ceiling — generous for CI; the dev machine runs ~0.8s.
      expect(wallMs).toBeLessThan(2000);

      // Fold contract: the whole replay lands in at most 5 commits.
      const perf = await readPerf(app);
      expect(perf.lastReplay).not.toBeNull();
      expect(perf.lastReplay!.commits).toBeLessThanOrEqual(5);

      // Parse-once after replay: no identity parsed twice.
      expect(perf.rowParse.maxParsesPerIdentity).toBe(1);
      expect(perf.rowParse.parses).toBe(fixture.spec.turns);

      // Live incremental turn — a synthesized wake bracket through the
      // REAL store (no wire emission, no claude call). Only the
      // streaming tail may parse; the 100 finalized cells memo out.
      const before = perf.rowParse;
      const frames = [
        {
          type: "wake_started",
          session_id: fixture.sessionId,
          wake_trigger: {
            task_id: "bg-1",
            tool_use_id: "tu-1",
            status: "completed",
            summary: "budget-test wake",
            output_file: "/tmp/none",
          },
        },
        { type: "assistant_text", msg_id: "msg_live", text: "live **tail** one. ", is_partial: true, rev: 0, seq: 0 },
        { type: "assistant_text", msg_id: "msg_live", text: "live **tail** one. and two. ", is_partial: true, rev: 0, seq: 1 },
        { type: "turn_complete", msg_id: "msg_live", result: "success" },
      ];
      for (const f of frames) {
        await app.evalJS<null>(
          `(window.__tug.driveDevSession("A", { op: "ingestFrame", feedId: ${FEED_CODE_OUTPUT}, decoded: ${JSON.stringify({ ...f, tug_session_id: fixture.sessionId })} }), null)`,
        );
      }
      // Let the rAF-coalesced markdown reconcile drain.
      await app.waitForCondition<boolean>(
        `window.__tug.getSessionPerf("A").rowParse.identities >= ${before.identities + 1}`,
        { timeoutMs: 5000 },
      );
      const after = (await readPerf(app)).rowParse;
      // Tail-only: a handful of parses for the streaming tail (one per
      // delta at most), NOT a re-parse of the 50 finalized rows.
      expect(after.parses - before.parses).toBeLessThanOrEqual(4);
      expect(after.identities - before.identities).toBe(1);
      // The finalized cells memo'd out of the live commits.
      expect(after.memoHits).toBeGreaterThan(before.memoHits);

      // [L23] selection survives a full scroll round trip under the
      // content-visibility deferral (inline mounting — DOM alive).
      const selected = await selectUserRow(app, "first");
      expect(selected.length).toBeGreaterThan(0);
      await setScroll(app, "el.scrollHeight");
      await setScroll(app, "0");
      expect(await selectionText(app)).toBe(selected);
    } finally {
      await app.close();
    }
  }, 180_000);

  test("tool-heavy: a real-session shape (few rows, thousands of message blocks) commits fast", async () => {
    const fixture = seeded.find((f) => f.spec.label === "tool-heavy")!;
    const app = await launchTugApp({ testName: "at0184-tool-heavy" });
    try {
      await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );
      const wallMs = await resume(app, fixture);
      // Pre-fix this shape froze the deck ~20s in one inline mount
      // commit; the message-weight threshold flips it to windowed
      // mounting, bounding the commit to the visible window.
      expect(wallMs).toBeLessThan(8000);

      const perf = await readPerf(app);
      expect(perf.lastReplay).not.toBeNull();
      expect(perf.lastReplay!.commits).toBeLessThanOrEqual(
        Math.ceil(perf.lastReplay!.frames / 250) + 2,
      );
      expect(perf.rowParse.maxParsesPerIdentity).toBe(1);
    } finally {
      await app.close();
    }
  }, 300_000);

  test("whale-rows: progressive paint, parse-once, warm-cache scroll, selection pin", async () => {
    const fixture = seeded.find((f) => f.spec.label === "whale-rows")!;
    const app = await launchTugApp({ testName: "at0184-whale-rows" });
    try {
      await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );
      const wallMs = await resume(app, fixture);
      expect(wallMs).toBeLessThan(30_000);

      // Progressive paint: the fold flushed multiple times before the
      // window closed (threshold flushes = paints before complete).
      const perf = await readPerf(app);
      expect(perf.lastReplay).not.toBeNull();
      expect(perf.lastReplay!.folds).toBeGreaterThan(1);

      // Parse-once at scale.
      expect(perf.rowParse.maxParsesPerIdentity).toBe(1);

      // [L23] under WINDOWED mounting: select a bottom row, scroll to
      // the top — without the pin the row would unmount and the
      // selection would collapse. The pin keeps it mounted.
      const selected = await selectUserRow(app, "last");
      expect(selected.length).toBeGreaterThan(0);
      await setScroll(app, "0");
      await app.waitForCondition<boolean>(
        `(function(){
          var el = document.querySelector(${JSON.stringify(SCROLLER)});
          return el !== null && el.scrollTop < 100;
        })()`,
        { timeoutMs: 5000 },
      );
      expect(await selectionText(app)).toBe(selected);

      // Warm-cache scroll: jumping into never-mounted territory mounts
      // fresh cells. Their content is served through the same
      // `ensureParsed` chokepoint the warm queue drains through, so
      // the falsifiable invariant is parse-ONCE: no identity ever
      // parses twice (whichever of mount or queue arrives first does
      // the single parse; the other is a cache hit), and the scroll
      // produced cache hits. The queue may still be draining its
      // 2500 entries during this window — those background parses are
      // the design, so a raw parse-count delta is NOT asserted.
      const beforeScroll = (await readPerf(app)).rowParse;
      await setScroll(app, "Math.floor(el.scrollHeight / 2)");
      await app.waitForCondition<boolean>(
        `window.__tug.getSessionPerf("A").rowParse.cacheHits > ${beforeScroll.cacheHits}`,
        { timeoutMs: 10_000 },
      );
      const afterScroll = (await readPerf(app)).rowParse;
      expect(afterScroll.cacheHits).toBeGreaterThan(beforeScroll.cacheHits);
      expect(afterScroll.maxParsesPerIdentity).toBe(1);
    } finally {
      await app.close();
    }
  }, 300_000);
});
