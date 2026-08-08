/**
 * at0377-session-row-stack.test.ts — the four-line identity stack, in the
 * picker.
 *
 * ## What this gates
 *
 * The row tier's whole content is geometry, and geometry is only true in a
 * browser at a real width.
 *
 *   A. **Four lines, in identity order.** Callsign first, then description,
 *      then the PULSE, then the metadata. The callsign leading is the change:
 *      the picker used to lead with a `last_user_prompt` snippet and bury the
 *      callsign in a metadata run, so a session was called one thing here and
 *      another everywhere else.
 *
 *   B. **Tight leading, and a lead gap that separates identity from the
 *      group.** Inherited body leading (~1.45) puts a 13px run in a 19px box,
 *      and four of those is a different row than the one the geometry was
 *      measured on. The three sub-lines also share one left vertical — the
 *      indent that makes the callsign read as their heading — which a
 *      zero-width strut collecting a container gap silently breaks.
 *
 *   C. **An un-described session keeps its description line.** The row must
 *      not change height when a rename lands, so the line holds its space
 *      empty. Two rows in the same list at the same moment, one described and
 *      one not, measure the same.
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

import { launchTugApp } from "./_harness";

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

describe.skipIf(!SHOULD_RUN)("at0377 — the four-line identity stack", () => {
  test(
    "callsign leads, the group is tight and indented, and an empty description holds its line",
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

        // ---- A. Four lines, callsign first. --------------------------------
        const shape = await app.evalJS<{
          lines: number;
          title: string;
          hasDescription: boolean;
          hasPulse: boolean;
          hasMetadata: boolean;
          orderOk: boolean;
        }>(`(function(){
          var row = document.querySelector(${JSON.stringify(ROW)});
          if (row === null) throw new Error("no picker row");
          var lines = row.querySelector(".tug-session-row-lines");
          var kids = Array.prototype.map.call(lines.children, function (n) {
            if (n.classList.contains("tug-session-row-name-line")) return "name";
            if (n.classList.contains("tug-session-row-description")) return "desc";
            if (n.classList.contains("tug-session-row-metadata")) return "meta";
            if (n.matches('[data-slot="tug-pulse"]')) return "pulse";
            return "other";
          });
          var title = row.querySelector(".tug-list-row-title");
          return {
            lines: kids.length,
            title: title === null ? "" : (title.textContent || ""),
            hasDescription: kids.indexOf("desc") !== -1,
            hasPulse: kids.indexOf("pulse") !== -1,
            hasMetadata: kids.indexOf("meta") !== -1,
            orderOk: kids.join(",") === "name,desc,pulse,meta",
          };
        })()`);
        expect(shape.lines).toBe(4);
        expect(shape.hasDescription).toBe(true);
        expect(shape.hasPulse).toBe(true);
        expect(shape.hasMetadata).toBe(true);
        expect(shape.orderOk).toBe(true);
        // The callsign leads — an `adjective-noun` from the lexicon, minted at
        // scan time. Not the prompt snippet the row used to open with, and
        // never the raw UUID.
        expect(shape.title).toMatch(/^[a-z]+-[a-z]+(-[A-Z]\d+)*$/);

        // ---- B. Tight leading, one vertical for the group. -----------------
        const geometry = await app.evalJS<{
          nameLH: number;
          descLH: number;
          metaLH: number;
          descLeft: number;
          metaLeft: number;
          pulseLeft: number;
          nameLeft: number;
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
          var meta = q(".tug-session-row-metadata");
          var pulse = q('[data-slot="tug-pulse"]');
          var title = q(".tug-list-row-title");
          return {
            nameLH: parseFloat(getComputedStyle(name).lineHeight),
            descLH: parseFloat(getComputedStyle(desc).lineHeight),
            metaLH: parseFloat(getComputedStyle(meta).lineHeight),
            descLeft: left(desc),
            metaLeft: left(meta),
            pulseLeft: left(pulse),
            nameLeft: left(title),
          };
        })()`);
        // Tight, not inherited body leading. A 13px run under ~1.45 would be
        // 19px; tight is well under that.
        expect(geometry.descLH).toBeLessThan(19);
        expect(geometry.metaLH).toBeLessThan(19);
        expect(geometry.nameLH).toBeLessThan(22);
        // The three sub-lines start on ONE vertical, and it is indented past
        // the callsign — the indent is what makes the callsign their heading.
        expect(geometry.metaLeft).toBe(geometry.descLeft);
        expect(geometry.pulseLeft).toBe(geometry.descLeft);
        expect(geometry.descLeft).toBeGreaterThan(geometry.nameLeft);

        // ---- C. An empty description still holds its line. -----------------
        //
        // Both rows are in the same list at the same moment, so this cannot
        // pass by the feature being broken outright in one of them.
        const heights = await app.evalJS<{
          described: number;
          bare: number;
          emptyLines: number;
        }>(`(function(){
          var rows = Array.prototype.slice.call(
            document.querySelectorAll(${JSON.stringify(ROW)}));
          var described = null, bare = null;
          for (var i = 0; i < rows.length; i++) {
            var d = rows[i].querySelector(".tug-session-row-description");
            if (d === null) continue;
            if (d.getAttribute("data-empty") === "true") bare = rows[i];
            else described = rows[i];
          }
          if (described === null || bare === null) {
            throw new Error("need one described row and one without");
          }
          return {
            described: Math.round(described.getBoundingClientRect().height),
            bare: Math.round(bare.getBoundingClientRect().height),
            emptyLines: document.querySelectorAll(
              ${JSON.stringify(ROW)} + ' .tug-session-row-description[data-empty="true"]').length,
          };
        })()`);
        expect(heights.emptyLines).toBeGreaterThan(0);
        expect(heights.bare).toBe(heights.described);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
