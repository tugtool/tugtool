/**
 * at0368-transcript-stamp-date-context.test.ts — a transcript stamp is read
 * against today.
 *
 * A row's time is only unambiguous while the row is from today. `7∶16∶15 PM`
 * on a turn replayed out of a week-old session reads as this evening — the
 * clock is the same twenty-four hours later, so the stamp quietly lies about
 * a resumed session's history. So an older row names its day the way a person
 * would say it: `Yesterday`, then the weekday for the rest of the week, then
 * the calendar date. Today's row still shows the clock alone; a date on every
 * row would out-weigh the `#u7` it sits beside.
 *
 * The vehicle is at0192's: a real `spawn_session(resume)` over a fixture JSONL
 * placed where claude/tugcode expect it, so the stamps under assertion are the
 * ones tugcode replayed out of the file — not values handed to the renderer by
 * the test. The fixture holds one turn per bucket, so a single load walks the
 * whole rule and a regression that gets one bucket wrong fails on that turn.
 *
 * Both the fixture's instants and the locale spellings they should render as
 * come from the PAGE, not from this process: the suite and the app do not
 * necessarily share a timezone, and a day-named stamp computed test-side lands
 * a day out whenever they disagree. The test contributes the part that is
 * actually under test — which bucket each turn belongs in, and how a stamp is
 * composed from a day name and a clock.
 *
 * @covers tugdeck/src/lib/contextual-stamp.ts
 * @covers tugdeck/src/components/tugways/cards/transcript-host-helpers.ts
 * @covers tugdeck/src/components/tugways/tug-transcript-entry.tsx
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
import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "a7c0d1ea-0000-4000-8000-000000000368";

/** Mirrors tugcode's `encodeProjectDir` — see at0192 for why it's inlined. */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

/**
 * The four turns, oldest first: how far back each one's opening user message
 * sits, and the day name its stamp must carry.
 *
 * Midday on the target date, so no turn can drift across a local midnight or a
 * DST shift into the neighbouring bucket. `daysBack: 0` is the one exception —
 * "today" has to be an actual recent moment, not noon.
 */
const TURNS = [
  { daysBack: 40, bucket: "date" },
  { daysBack: 3, bucket: "weekday" },
  { daysBack: 1, bucket: "yesterday" },
  { daysBack: 0, bucket: "today" },
] as const;

/**
 * Epoch ms for each turn, computed in the PAGE's timezone: local midday on the
 * target date, or five minutes ago for today's turn.
 */
const INSTANTS_JS = `JSON.stringify(
  ${JSON.stringify(TURNS.map((t) => t.daysBack))}.map(function (back) {
    if (back === 0) return Date.now() - 5 * 60000;
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 12, 0, 0).getTime();
  }),
)`;

/**
 * The locale's own spelling of the parts a stamp at `at` is built from —
 * asked of the page so the assertion carries no opinion about how ICU writes a
 * weekday, a month, or a clock.
 */
const spellingsJs = (at: number): string => `JSON.stringify((() => {
  const d = new Date(${at});
  const now = new Date();
  const dateOpts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) dateOpts.year = "numeric";
  return {
    clock: d
      .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })
      .replace(/:/g, "∶"),
    weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
    date: d.toLocaleDateString(undefined, dateOpts),
  };
})())`;

interface Spellings {
  clock: string;
  weekday: string;
  date: string;
}

/** The stamp a row at `at` must read, given the bucket its turn belongs in. */
function expectedStamp(bucket: (typeof TURNS)[number]["bucket"], s: Spellings): string {
  if (bucket === "today") return s.clock;
  if (bucket === "yesterday") return `Yesterday, ${s.clock}`;
  if (bucket === "weekday") return `${s.weekday}, ${s.clock}`;
  return `${s.date}, ${s.clock}`;
}

/** One user + one assistant line per turn, the assistant two seconds later. */
function buildFixtureJsonl(cwd: string, sessionId: string, instants: number[]): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.105",
    gitBranch: "main",
  };
  const usage = {
    input_tokens: 1200,
    output_tokens: 50,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 8000,
  };
  const uuid = (n: number): string =>
    `00000000-0000-4000-8000-0000000d${String(n).padStart(4, "0")}`;
  const lines: unknown[] = [];
  instants.forEach((at, i) => {
    lines.push({
      ...base,
      parentUuid: i === 0 ? null : uuid(2 * i),
      type: "user",
      uuid: uuid(2 * i + 1),
      timestamp: new Date(at).toISOString(),
      message: { role: "user", content: [{ type: "text", text: `question ${i}` }] },
    });
    lines.push({
      ...base,
      parentUuid: uuid(2 * i + 1),
      type: "assistant",
      uuid: uuid(2 * i + 2),
      timestamp: new Date(at + 2_000).toISOString(),
      message: {
        id: `msg-stamp-${i}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: `answer ${i}` }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage,
      },
    });
  });
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

let projectDir = "";
let fixtureDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0368-proj-")));
  fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(projectDir));
  mkdirSync(fixtureDir, { recursive: true });
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  if (fixtureDir !== "" && existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 700 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Every rendered row stamp, in document order, with its participant. */
const STAMPS_JS = `JSON.stringify(
  Array.from(document.querySelectorAll('[data-card-id="A"] [data-slot="tug-transcript-entry"]'))
    .map(function (row) {
      var el = row.querySelector(".tug-transcript-entry__timestamp");
      return {
        participant: row.getAttribute("data-participant") || "",
        stamp: el ? (el.textContent || "").trim() : "",
      };
    })
    .filter(function (r) { return r.stamp.length > 0; }),
)`;

describe.skipIf(!SHOULD_RUN)(
  "AT0368: transcript stamps are read against today",
  () => {
    test(
      "a replayed turn names its day — date, weekday, Yesterday, or the clock alone",
      async () => {
        const app = await launchTugApp({
          testName: "at0368-transcript-stamp-date-context",
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 15_000 },
          );

          // The fixture is built from the app's clock, so it is written here
          // rather than in `beforeAll` — before the resume that reads it.
          const instants = JSON.parse(await app.evalJS<string>(INSTANTS_JS)) as number[];
          writeFileSync(
            join(fixtureDir, `${SID}.jsonl`),
            buildFixtureJsonl(projectDir, SID, instants),
          );

          await app.spawnSessionResume("A", { tugSessionId: SID, projectDir });

          const rowCount = 2 * TURNS.length;
          await app.waitForCondition<boolean>(
            `JSON.parse(${STAMPS_JS}).length >= ${rowCount}`,
            { timeoutMs: 20_000 },
          );

          const rows = JSON.parse(await app.evalJS<string>(STAMPS_JS)) as Array<{
            participant: string;
            stamp: string;
          }>;
          note("at0368 stamps", rows);

          // Each turn's user row stamps the submission, its assistant row the
          // turn's end — two seconds later in the fixture.
          const expected: string[] = [];
          for (let i = 0; i < TURNS.length; i += 1) {
            for (const at of [instants[i], instants[i] + 2_000]) {
              const spellings = JSON.parse(
                await app.evalJS<string>(spellingsJs(at)),
              ) as Spellings;
              expected.push(expectedStamp(TURNS[i].bucket, spellings));
            }
          }
          note("at0368 expected", expected);

          // Full-string equality: the rule is the whole stamp, so there is no
          // room for a day name that renders in the wrong place or a clock
          // that quietly lost its seconds.
          for (let i = 0; i < rowCount; i += 1) {
            expect(rows[i].stamp).toBe(expected[i]);
          }

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const diag = await app
            .evalJS<string>(
              `JSON.stringify((() => {
                const card = document.querySelector('[data-card-id="A"]');
                const q = (sel) => !!(card && card.querySelector(sel));
                return {
                  hasCard: !!card,
                  picker: q('[data-slot="session-card-picker"]'),
                  restoring: q('[data-slot="session-card-restoring"]'),
                  body: q('[data-slot="session-card"]'),
                  entries: card
                    ? card.querySelectorAll('[data-slot="tug-transcript-entry"]').length
                    : 0,
                };
              })())`,
            )
            .catch(() => "(diag unavailable)");
          note("at0368 diag", diag);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
