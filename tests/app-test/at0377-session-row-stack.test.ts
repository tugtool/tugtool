/**
 * at0377-session-row-stack.test.ts — the three-level identity stack, in the
 * picker.
 *
 * ## What this gates
 *
 * The row tier's whole content is geometry, and geometry is only true in a
 * browser at a real width.
 *
 *   A. **Three lines, in identity order.** Title first, then description, then
 *      the activity. Two things are pinned by the count: the title leads (the
 *      picker used to open with a `last_user_prompt` snippet and bury the
 *      callsign in a metadata run, so a session was called one thing here and
 *      another everywhere else), and there are neither four levels nor five —
 *      the standing-goal level and the metadata line are retired, and their
 *      facts are the activity line's rest form now.
 *
 *   B. **Tight leading, and a lead gap that separates identity from the
 *      pair.** Inherited body leading (~1.45) puts a 13px run in a 19px box,
 *      and three of those is a different row than the one the geometry was
 *      measured on. The two sub-lines also share one left vertical, and on this
 *      small-dot surface it is the TITLE's own — which a zero-width strut
 *      collecting a container gap silently breaks.
 *
 *   C. **Every row is the same height, whatever its description says.** A row
 *      that resized as a description arrived would move every row beneath it,
 *      so the line holds its space in every state it has. Measured across the
 *      whole list at one moment, so it cannot pass by the feature being broken
 *      outright in one row.
 *
 *   D. **Every row leads with a quiet dot, closed sessions included.** These are
 *      all closed on-disk sessions with no card bound, which used to mean no dot
 *      at all. A session whose live state cannot be reached reads `idle` now — and
 *      emphatically not the danger reading, which would make every ordinary
 *      closed session look broken.
 *
 *   E. **The description's rungs, over real scan rows.** The `last_user_prompt`
 *      rung is load-bearing at THIS surface and nowhere else: a freshly-scanned
 *      external session has never been summarized, and its own first prompt is
 *      the only human-meaningful text the row holds. A creation date in its place
 *      is strictly less. The fixture with neither falls to the stamp.
 *
 * The rows are seeded as real transcript files in the encoded claude project
 * dir for a fresh temp path and picked up by the real scan — no mocks, and no
 * dependence on whatever sessions the host happens to have.
 *
 * @covers tugdeck/src/components/tugways/tug-session-row.tsx
 * @covers tugdeck/src/components/tugways/tug-session-row.css
 * @covers tugdeck/src/components/tugways/session-phase-dot.tsx
 * @covers tugdeck/src/components/tugways/cards/session-picker-cells.tsx
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

/** Encode an absolute project dir the way claude names its per-project subdir. */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

/**
 * Two seeded sessions: one carrying an `ai-title` (so it has a description)
 * and one carrying only a prompt. C measures them against each other.
 */
const SEEDED = [
  {
    id: "a7c03770-0000-4000-8000-0000000000b1",
    prompt: "kestrel telemetry sweep",
    title: "Kestrel telemetry sweep",
  },
  {
    id: "a7c03770-0000-4000-8000-0000000000b2",
    prompt: "narwhal ledger reconciliation",
    title: null as string | null,
  },
  // No title AND no prompt — the state a session is in before it has said
  // anything, and the only one in which the description line is genuinely
  // empty. C measures this row against the described one above.
  {
    id: "a7c03770-0000-4000-8000-0000000000b3",
    prompt: "",
    title: null as string | null,
  },
];

const ROW = '[data-testid="session-card-picker-session-resume"]';
const ROW_COUNT = `document.querySelectorAll(${JSON.stringify(ROW)}).length`;

/** A minimal one-turn session JSONL in claude's own shape. */
function buildFixtureJsonl(
  cwd: string,
  sessionId: string,
  prompt: string,
  title: string | null,
): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "1.0.0",
    gitBranch: "main",
  };
  const lines: string[] = [
    JSON.stringify({
      ...base,
      type: "user",
      uuid: `${sessionId}-u1`,
      parentUuid: null,
      timestamp: new Date(1_700_000_000_000).toISOString(),
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    }),
  ];
  if (title !== null) {
    lines.push(
      JSON.stringify({ ...base, type: "ai-title", aiTitle: title, uuid: `${sessionId}-t` }),
    );
  }
  return lines.join("\n") + "\n";
}

let projectDir = "";
let claudeProjectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0377-")));
  claudeProjectDir = join(
    homedir(),
    ".claude",
    "projects",
    encodeProjectDir(projectDir),
  );
  mkdirSync(claudeProjectDir, { recursive: true });
  for (const s of SEEDED) {
    writeFileSync(
      join(claudeProjectDir, `${s.id}.jsonl`),
      buildFixtureJsonl(projectDir, s.id, s.prompt, s.title),
      "utf8",
    );
  }
});

afterAll(() => {
  if (!SHOULD_RUN) return;
  if (claudeProjectDir !== "" && existsSync(claudeProjectDir)) {
    rmSync(claudeProjectDir, { recursive: true, force: true });
  }
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 640 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0377 — the three-level identity stack", () => {
  test(
    "the title leads, the pair is tight and indented, and every row is one height",
    async () => {
      const app = await launchTugApp({ testName: "at0377-session-row-stack" });
      try {
        // The picker is what an unbound Session card shows, so no bindSession.
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-tug-focus-key="session-picker-cycle:0"]') !== null`,
          { timeoutMs: 20_000 },
        );
        await app.evalJS<null>(`(function(){
          var el = document.querySelector('[data-tug-focus-key="session-picker-cycle:0"]');
          var setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value").set;
          setter.call(el, ${JSON.stringify("")});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          setter.call(el, ${JSON.stringify(projectDir)});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return null;
        })()`);
        // The scan is phase 2 of `list_sessions`; wait for both rows.
        await app.waitForCondition<boolean>(
          `${ROW_COUNT} >= ${SEEDED.length}`,
          { timeoutMs: 30_000 },
        );

        // ---- A. Three lines, the title first. ------------------------------
        const shape = await app.evalJS<{
          lines: number;
          order: string;
          title: string;
          dots: number;
          headlines: number;
        }>(`(function(){
          var row = document.querySelector(${JSON.stringify(ROW)});
          if (row === null) throw new Error("no picker row");
          var lines = row.querySelector(".tug-session-row-lines");
          var kids = Array.prototype.map.call(lines.children, function (n) {
            if (n.classList.contains("tug-session-row-name-line")) return "name";
            if (n.classList.contains("tug-session-row-description")) return "desc";
            if (n.matches('[data-slot="tug-pulse"]')) return "activity";
            return "other";
          });
          var title = row.querySelector(".tug-list-row-title");
          return {
            lines: kids.length,
            order: kids.join(","),
            title: title === null ? "" : (title.textContent || ""),
            dots: row.querySelectorAll('[data-slot="tug-progress-indicator"]').length,
            headlines: row.querySelectorAll('[data-slot="tug-pulse-headline"]').length,
          };
        })()`);
        expect(shape.lines).toBe(3);
        expect(shape.order).toBe("name,desc,activity");
        // The retired levels, asserted as absences: a standing-goal run
        // reappearing here is the four-level form coming back.
        expect(shape.headlines).toBe(0);
        // Every row leads with the session's dot, closed sessions included —
        // a cardless session reads idle rather than getting no mark at all.
        expect(shape.dots).toBe(1);
        // The identity line leads — `project/callsign`, the callsign an
        // `adjective-noun` from the lexicon, minted at scan time. Not the
        // prompt snippet the row used to open with, and never the raw UUID.
        // These fixtures carry no user-set name, so the line IS the whole
        // title.
        expect(shape.title.trim()).toMatch(
          /^[\w.-]+\/[a-z]+-[a-z]+(-[A-Z]\d+)*$/,
        );

        // ---- B. Tight leading, one vertical for the pair. ------------------
        const geometry = await app.evalJS<{
          nameLH: number;
          descLH: number;
          descLeft: number;
          pulseLeft: number;
          nameLeft: number;
          rowLeft: number;
        }>(`(function(){
          var row = document.querySelector(${JSON.stringify(ROW)});
          var q = function (sel) { return row.querySelector(sel); };
          // The TEXT's left, not the box's: these lines are full-width and
          // take their indent as padding, so a border-box read would report
          // every one of them starting at the same place whether the indent
          // was applied or not.
          var left = function (el) {
            return Math.round(
              el.getBoundingClientRect().left
                + parseFloat(getComputedStyle(el).paddingInlineStart || "0"),
            );
          };
          var name = q(".tug-session-row-name-line");
          var desc = q(".tug-session-row-description");
          var pulse = q('[data-slot="tug-pulse"]');
          var title = q(".tug-list-row-title");
          return {
            nameLH: parseFloat(getComputedStyle(name).lineHeight),
            descLH: parseFloat(getComputedStyle(desc).lineHeight),
            descLeft: left(desc),
            pulseLeft: left(pulse),
            nameLeft: left(title),
            // The lines column's own content edge — what the indent is measured
            // from, so "indented" is a real fact rather than a comparison
            // between two numbers that could both be zero.
            rowLeft: left(q(".tug-session-row-lines")),
          };
        })()`);
        // Tight, not inherited body leading. A 13px run under ~1.45 would be
        // 19px; tight is well under that.
        expect(geometry.descLH).toBeLessThan(19);
        expect(geometry.nameLH).toBeLessThan(22);
        // The two sub-lines start on ONE vertical, indented off the row's own
        // leading edge — the indent is what makes the title read as their
        // heading. On this surface that vertical is the TITLE's: the picker
        // wears the small dot, and three lines on two verticals read as a stack
        // that was assembled rather than set. The row publishes where its title
        // starts and the picker takes that number whole, so the equality below
        // is the whole point rather than a coincidence of two paddings.
        //
        // The Lens is the one mount that cannot follow — its 28px dot would make
        // the title inset a wide indent for a narrow rail — so it keeps the
        // row's own smaller default. Small dot, flush with the title; large dot,
        // its own number.
        expect(geometry.pulseLeft).toBe(geometry.descLeft);
        expect(geometry.descLeft).toBeGreaterThan(geometry.rowLeft);
        expect(geometry.descLeft).toBe(geometry.nameLeft);

        // ---- C. Every row is one height, whatever it has to say. -----------
        //
        // Across the whole list at one moment, so this cannot pass by the
        // feature being broken outright in one row. The fixtures deliberately
        // differ in what they have to show — one carries an agent title, one
        // only a prompt, one neither — and a row that resized as a description
        // arrived would move every row beneath it.
        const heights = await app.evalJS<{
          heights: number[];
          descriptions: number;
        }>(`(function(){
          var rows = Array.prototype.slice.call(
            document.querySelectorAll(${JSON.stringify(ROW)}));
          if (rows.length < 2) throw new Error("need at least two rows");
          return {
            heights: rows.map(function (r) {
              return Math.round(r.getBoundingClientRect().height);
            }),
            descriptions: document.querySelectorAll(
              ${JSON.stringify(ROW)} + ' .tug-session-row-description').length,
          };
        })()`);
        // Every row renders the description line, present or standing in.
        expect(heights.descriptions).toBe(heights.heights.length);
        for (const h of heights.heights) expect(h).toBe(heights.heights[0]);

        // ---- D. Every row leads with a quiet dot, closed sessions included. -
        //
        // These are all closed on-disk sessions with no card bound, which used to
        // mean NO dot at all. A session whose live state cannot be reached reads
        // idle now, so the column of marks says which rows are working without
        // saying anything false about the rest — and `idle` is emphatically not
        // the danger reading, which is what would make every ordinary closed
        // session look broken.
        const dots = await app.evalJS<
          ReadonlyArray<{ phase: string; state: string }>
        >(`Array.prototype.map.call(
             document.querySelectorAll(
               ${JSON.stringify(ROW)} + ' [data-slot="tug-progress-indicator"]'),
             function (el) {
               return {
                 phase: el.getAttribute("data-phase") || "",
                 state: el.getAttribute("data-state") || "",
               };
             })`);
        expect(dots.length).toBe(heights.heights.length);
        for (const dot of dots) {
          expect(dot.phase).toBe("idle");
          expect(dot.state).not.toBe("aborted");
        }

        // ---- E. The description's rungs, over real scan rows. --------------
        //
        // Rung 2 is load-bearing HERE and nowhere else: a freshly-scanned
        // external session has never been summarized, and its own first prompt is
        // the only human-meaningful text the row holds. A creation date in its
        // place is strictly less. The third fixture has neither, and falls to the
        // stamp.
        const rungs = await app.evalJS<ReadonlyArray<string>>(
          `Array.prototype.map.call(
             document.querySelectorAll(
               ${JSON.stringify(ROW)} + ' .tug-session-row-description'),
             function (el) { return (el.textContent || "").trim(); })`,
        );
        note("at0377 description rungs", JSON.stringify(rungs));
        // The two prompt-bearing fixtures show their prompts, not a date.
        for (const prompt of ["kestrel telemetry sweep", "narwhal ledger reconciliation"]) {
          expect(rungs.some((r) => r.includes(prompt))).toBe(true);
        }
        // And the one with neither a summary nor a prompt dates itself.
        expect(rungs.some((r) => r.startsWith("Created "))).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
