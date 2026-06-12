/**
 * at0183-transcript-scale.test.ts — transcript row-count scaling
 * measurement (the [Q04] gate evidence: does content-visibility
 * deferral carry whale-scale ROW COUNTS, or is true windowing
 * required?).
 *
 * Seeds TUI-shaped sessions of 1k / 5k / 10k transcript rows with
 * moderate per-reply content (~2KB — row-count scaling, deliberately
 * not the 26KB content-heavy whale of at0182), resumes each through
 * the real pipeline, and records: wall to full transcript, replay
 * ingest stats, parse counters, scrollHeight, and a full-range
 * scroll-jump timing as a layout-responsiveness proxy.
 *
 * Like at0182's whale leg, scale legs tolerate non-completion — a
 * leg that can't finish IS the measurement. Legs print
 * `SCALE ...` lines for the plan's [Q04] table.
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

function encodeProjectDir(dir: string): string {
  return dir.replace(/[/.]/g, "-");
}

interface ScaleSpec {
  label: string;
  turns: number;
  waitMs: number;
  /** Leg must complete within budget (regression gate, not just measurement). */
  assertCompletes: boolean;
  /**
   * All legs run by default now that windowed mounting carries them
   * (5k completes in ~0.6s, 10k in ~0.8s; pre-windowing 5k took 40.5s
   * and 10k wedged the page — the evidence that gated windowing in).
   * The flag stays so a future heavier leg can ship skipped with its
   * numbers recorded.
   */
  skip: boolean;
}

// rows ≈ 2 × turns (user + assistant per turn).
const SCALES: ScaleSpec[] = [
  { label: "rows-1k", turns: 500, waitMs: 120_000, assertCompletes: true, skip: false },
  { label: "rows-5k", turns: 2_500, waitMs: 240_000, assertCompletes: true, skip: false },
  { label: "rows-10k", turns: 5_000, waitMs: 300_000, assertCompletes: true, skip: false },
];

interface SeededScale {
  spec: ScaleSpec;
  sessionId: string;
  projectDir: string;
  seededClaudeDir: string;
  jsonlBytes: number;
}

const seeded: SeededScale[] = [];

function reply(turn: number): string {
  const para =
    `Turn ${turn}: a modest paragraph of transcript prose with **bold** ` +
    `and a touch of \`inline code\` so the parse is representative. `;
  return (
    para +
    para +
    `\n\n- item one for ${turn}\n- item two for ${turn}\n\n` +
    "```ts\n" +
    `function step${turn}(x: number): number { return x * ${turn}; }\n` +
    "```\n" +
    para
  );
}

function scaleJsonl(sessionId: string, cwd: string, turns: number): string {
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
  for (let n = 1; n <= turns; n++) {
    const u = randomUUID();
    const a = randomUUID();
    lines.push(
      JSON.stringify({
        ...stamp(u, parent, t0 + n * 30_000),
        type: "user",
        message: { role: "user", content: `scale prompt ${n}` },
      }),
    );
    lines.push(
      JSON.stringify({
        ...stamp(a, u, t0 + n * 30_000 + 5_000),
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          id: `msg_at0183_${n}`,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: reply(n) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        },
        requestId: `req_at0183_${n}`,
      }),
    );
    parent = a;
  }
  lines.push(
    JSON.stringify({ type: "ai-title", aiTitle: `Scale ${turns}`, sessionId }),
  );
  return lines.join("\n");
}

beforeAll(() => {
  if (!SHOULD_RUN) return;
  for (const spec of SCALES) {
    const projectDir = realpathSync(
      mkdtempSync(join(tmpdir(), `at0183-${spec.label}-`)),
    );
    const seededClaudeDir = join(
      homedir(),
      ".claude",
      "projects",
      encodeProjectDir(projectDir),
    );
    mkdirSync(seededClaudeDir, { recursive: true });
    const sessionId = randomUUID();
    const jsonl = scaleJsonl(sessionId, projectDir, spec.turns);
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

async function measureScale(fixture: SeededScale): Promise<void> {
  const { spec, sessionId, projectDir, jsonlBytes } = fixture;
  const app = await launchTugApp({ testName: `at0183-${spec.label}` });
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

    // Completion: the replay window closed AND transcript rows are
    // painted. Above the windowed-mounting threshold only the visible
    // window's cells exist in the DOM, so "all rows mounted" is the
    // wrong predicate at scale — presence of the windowed tail (the
    // transcript follows bottom) plus the closed replay window is the
    // honest "transcript ready" signal at every scale.
    let completed = true;
    try {
      await app.waitForCondition<boolean>(
        `(function(){
          if (typeof window.__tug === "undefined") return false;
          var perf;
          try { perf = window.__tug.getSessionPerf("A"); } catch (e) { return false; }
          if (perf.lastReplay === null) return false;
          // Windowed mounting keeps only the visible window in the
          // DOM (tall assistant rows mean a follow-bottom viewport
          // holds as few as one or two user rows) — any mounted user
          // row + the closed replay window means the transcript is up.
          var mounted = document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length;
          return mounted >= 1;
        })()`,
        { timeoutMs: spec.waitMs },
      );
    } catch {
      completed = false;
    }
    const wallMs = Date.now() - openedAt;

    // Layout-responsiveness proxy under content-visibility: jump the
    // transcript scroller across its full range and time the forced
    // layouts. Smooth-scroll frame pacing isn't measurable from the
    // harness; full-range jumps are the worst-case layout the
    // deferral has to absorb.
    const scroll = await app.evalJS<{
      scrollHeight: number;
      jumpMs: number;
    } | null>(
      `(function(){
        var host = document.querySelector('[data-card-id="A"] .dev-card-transcript');
        if (host === null) return null;
        var scroller = host.querySelector('.tug-list-view');
        if (scroller === null) return null;
        var t0 = performance.now();
        scroller.scrollTop = 0;
        void scroller.offsetHeight;
        scroller.scrollTop = scroller.scrollHeight / 2;
        void scroller.offsetHeight;
        scroller.scrollTop = scroller.scrollHeight;
        void scroller.offsetHeight;
        return { scrollHeight: scroller.scrollHeight, jumpMs: Math.round(performance.now() - t0) };
      })()`,
    );

    let perf: unknown = null;
    try {
      perf = await app.evalJS<unknown>(`window.__tug.getSessionPerf("A")`);
    } catch {
      // page too far gone to read — recorded as null.
    }
    const rows = await app.evalJS<number>(
      `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length`,
    );

    console.log(
      `SCALE ${spec.label}: turns=${spec.turns} bytes=${jsonlBytes} ` +
        `completed=${completed} wallMs=${wallMs} userRows=${rows} ` +
        `scroll=${JSON.stringify(scroll)} perf=${JSON.stringify(perf)}`,
    );
    if (spec.assertCompletes) {
      expect(completed).toBe(true);
      expect(rows).toBeGreaterThan(0);
    }
  } finally {
    await app.close();
  }
}

describe.skipIf(!SHOULD_RUN)("AT0183: transcript row-count scaling", () => {
  for (const spec of SCALES) {
    const t = spec.skip ? test.skip : test;
    t(`${spec.label} resumes and records its scaling numbers`, async () => {
      await measureScale(seeded.find((f) => f.spec.label === spec.label)!);
    }, spec.waitMs + 120_000);
  }
});
