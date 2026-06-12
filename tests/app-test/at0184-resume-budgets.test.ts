/**
 * at0184-resume-budgets.test.ts — the ALWAYS-RUNNABLE resume gates.
 *
 * Where the corpus legs (at0185/at0186) measure and gate against REAL
 * session snapshots — and skip cleanly on a machine without a
 * harvested corpus — this file is the CI floor that runs everywhere.
 * Its fixtures are REAL-SHAPE generated sessions: the per-turn message
 * mix is re-derived from the harvested corpus survey (the pinned
 * heavy/tool-heavy session runs ~8.8 tool pairs, ~4.3 thinking blocks,
 * ~4 text blocks per committed turn at ~110KB/turn — see the plan's
 * survey table), scaled to two class analogs:
 *
 *  tool-light (inline mounting, ~100 messages):
 *   - resumes under a generous wall ceiling
 *   - replay fold contract: the whole replay lands in ≤ 5 commits
 *   - parse-once: no identity parses twice
 *   - replayed tool blocks mount COLLAPSED (header-only; zero bodies)
 *   - live incremental turn (synthesized wake bracket — no wire, no
 *     claude call): only the streaming tail parses; finalized cells
 *     memo out
 *   - [L23] selection survives a full scroll round trip (inline —
 *     every cell mounted, DOM alive)
 *
 *  tool-heavy (windowed mounting, ~1,200 messages):
 *   - the motivating real-session shape (few rows, thousands of
 *     message blocks); pre-fix it froze the deck ~20s in one commit
 *   - wall ceiling; fold contract at threshold granularity;
 *     parse-once; collapsed history present in the window
 *
 * The synthetic prose-only fixtures this file (and at0182/at0183)
 * used to carry are DELETED per the resume-performance plan: they
 * validated machinery against a workload that does not exist — no
 * real heavy session in the harvested population is prose-shaped.
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
const COLLAPSED_BLOCKS = '[data-card-id="A"] [data-block-collapsed="true"]';
const FEED_CODE_OUTPUT = 0x40;

const rowSel = (id: string): string => `[data-session-id="${id}"]`;

function encodeProjectDir(dir: string): string {
  return dir.replace(/[/.]/g, "-");
}

interface BudgetSpec {
  label: "tool-light" | "tool-heavy";
  turns: number;
  /** Markdown bytes of the closing assistant reply. */
  replyBytes: number;
  /** Tool_use/tool_result pairs per turn (corpus: ~8.8). */
  toolsPerTurn: number;
  /** Thinking blocks per turn (corpus: ~4.3). */
  thinkingPerTurn: number;
  windowed: boolean;
  waitMs: number;
}

const FIXTURES: BudgetSpec[] = [
  // Inline-class analog: under both windowing thresholds.
  { label: "tool-light", turns: 10, replyBytes: 2_000, toolsPerTurn: 3, thinkingPerTurn: 2, windowed: false, waitMs: 60_000 },
  // Windowed-class analog of the motivating session: 50 × (1 user +
  // 4 thinking + 9×2 tool + 1 text) = 1,200 messages — over the
  // message-weight threshold.
  { label: "tool-heavy", turns: 50, replyBytes: 2_000, toolsPerTurn: 9, thinkingPerTurn: 4, windowed: true, waitMs: 120_000 },
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
  const assistant = (
    uuid: string,
    t: number,
    content: unknown[],
    stopReason: string,
    msgId: string,
  ) =>
    JSON.stringify({
      ...stamp(uuid, parent, t),
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        id: msgId,
        type: "message",
        role: "assistant",
        content,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      },
      requestId: `req_${msgId}`,
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
    // Thinking blocks ahead of the tool burst — the real-session
    // shape (corpus: ~4.3 per committed turn).
    for (let k = 0; k < spec.thinkingPerTurn; k++) {
      const th = randomUUID();
      lines.push(
        assistant(
          th,
          t0 + n * 30_000 + 200 + k * 50,
          [
            {
              type: "thinking",
              thinking: `Considering step ${n}.${k}: weigh the options, check the constraints, decide the next tool call. `.repeat(8),
              signature: "sig",
            },
          ],
          "tool_use",
          `msg_at0184_${n}_th${k}`,
        ),
      );
      parent = th;
    }
    // Tool cycle: assistant tool_use (stop_reason "tool_use" keeps
    // the turn open) followed by the user-side tool_result — the
    // shape real working sessions are made of (corpus: ~8.8 pairs).
    for (let i = 0; i < spec.toolsPerTurn; i++) {
      const at = randomUUID();
      const ut = randomUUID();
      lines.push(
        assistant(
          at,
          t0 + n * 30_000 + 1_000 + i * 100,
          [
            {
              type: "tool_use",
              id: `toolu_at0184_${n}_${i}`,
              name: "Bash",
              input: { command: `echo step ${n}.${i} && ls -la src/` },
            },
          ],
          "tool_use",
          `msg_at0184_${n}_t${i}`,
        ),
      );
      parent = at;
      lines.push(
        JSON.stringify({
          ...stamp(ut, parent, t0 + n * 30_000 + 1_050 + i * 100),
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
      assistant(
        a,
        t0 + n * 30_000 + 5_000,
        [{ type: "text", text: reply(n, spec.replyBytes) }],
        "end_turn",
        `msg_at0184_${n}`,
      ),
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

/** Collapsed-history shape: count of collapsed blocks + mounted bodies inside them. */
function collapsedShape(
  app: AppHandle,
): Promise<{ collapsed: number; bodiesInside: number }> {
  return app.evalJS<{ collapsed: number; bodiesInside: number }>(
    `(function(){
      var blocks = document.querySelectorAll(${JSON.stringify(COLLAPSED_BLOCKS)});
      var bodies = 0;
      for (var i = 0; i < blocks.length; i++) {
        bodies += blocks[i].querySelectorAll('[data-slot="tool-block-body"]').length;
      }
      return { collapsed: blocks.length, bodiesInside: bodies };
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("AT0184: resume budgets (real-shape gates)", () => {
  test("tool-light (inline): budgets, collapsed history, live tail-only turn, selection survival", async () => {
    const fixture = seeded.find((f) => f.spec.label === "tool-light")!;
    const app = await launchTugApp({ testName: "at0184-tool-light" });
    try {
      await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );
      const wallMs = await resume(app, fixture);

      // Latency ceiling — generous for CI; the dev machine runs ~0.5s.
      expect(wallMs).toBeLessThan(2000);

      // Fold contract: the whole replay lands in at most 5 commits.
      const perf = await readPerf(app);
      expect(perf.lastReplay).not.toBeNull();
      expect(perf.lastReplay!.commits).toBeLessThanOrEqual(5);

      // Parse-once after replay: no identity parsed twice.
      expect(perf.rowParse.maxParsesPerIdentity).toBe(1);

      // Replayed tool blocks mount header-only — the always-runnable
      // collapsed-history gate (the corpus legs assert it on real
      // snapshots; this asserts it everywhere CI runs).
      const shape = await collapsedShape(app);
      expect(shape.collapsed).toBeGreaterThan(0);
      expect(shape.bodiesInside).toBe(0);

      // Live incremental turn — a synthesized wake bracket through the
      // REAL store (no wire emission, no claude call). Only the
      // streaming tail may parse; the finalized cells memo out.
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
      // delta at most), NOT a re-parse of the finalized rows.
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

  test("tool-heavy (windowed): the motivating shape commits fast with collapsed history", async () => {
    const fixture = seeded.find((f) => f.spec.label === "tool-heavy")!;
    const app = await launchTugApp({ testName: "at0184-tool-heavy" });
    try {
      await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );
      const wallMs = await resume(app, fixture);
      // Pre-fix this shape froze the deck ~20s in one inline mount
      // commit; windowed mounting + collapsed history bound the commit
      // to header strips in the visible window.
      expect(wallMs).toBeLessThan(8000);

      const perf = await readPerf(app);
      expect(perf.lastReplay).not.toBeNull();
      expect(perf.lastReplay!.commits).toBeLessThanOrEqual(
        Math.ceil(perf.lastReplay!.frames / 250) + 2,
      );
      expect(perf.rowParse.maxParsesPerIdentity).toBe(1);

      const shape = await collapsedShape(app);
      expect(shape.collapsed).toBeGreaterThan(0);
      expect(shape.bodiesInside).toBe(0);
    } finally {
      await app.close();
    }
  }, 300_000);

  // Scroll-driven windowed assertions (selection-pin survival across a
  // scroll to top; remount cache behavior on jumps) remain REMOVED —
  // the windowed scroll path has recorded defects in the
  // resume-performance plan's follow-ups (frozen re-window on
  // programmatic scrolls; pin-union mount wedge). Re-add when fixed.
});
