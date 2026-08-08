/**
 * at0265-picker-filter.test.ts — the session picker's filter field trims the
 * SESSIONS list ([AT0265]).
 *
 * ## What this gates (failure modes, not busywork)
 *
 * A busy project lists hundreds of sessions. The `TugFilterField` on the
 * picker's SESSIONS line is how the user cuts that down, and every seam below
 * has a way to break silently:
 *
 *   - **Live narrowing + highlight (A):** typing a fragment of a row's title
 *     drops the non-matching rows and paints `<mark class="tug-filter-mark">`
 *     on what matched. Fails if the query never reaches the data source, if the
 *     recompute doesn't re-render the list, or if the highlight helper is
 *     computing ranges against a different string than the row renders.
 *   - **"New session" survives any query (B):** a fragment matching nothing
 *     leaves exactly the "New session" row. Fails if the picker started
 *     dropping that row under filter — which would make Open's fall-to-new
 *     behavior a lie and let the list go empty.
 *   - **ArrowDown lands on a match (C):** arrowing out of a non-empty filter
 *     field puts the cursor on a real session, not "New session". The list is
 *     `singleSelect` and commits as its cursor lands, so a wrong seed would
 *     silently overwrite the user's prior pick with "New session".
 *   - **Clear restores (D):** the ✕ returns the list to its pre-filter size.
 *     Fails if the clear path skips the change notification.
 *   - **Trash-all ignores the filter (E):** the Move-all-to-Trash label,
 *     tooltip, and enable gate are identical with a filter active. The sweep is
 *     a per-path operation; making a destructive action's scope depend on a
 *     transient text box would be a real bug.
 *
 * ## Deterministic rows
 *
 * The picker's rows come from tugcast's ledger plus a JSONL scan of real host
 * state, so this test seeds its own: real transcript files in the encoded
 * claude project dir for a fresh temp path, picked up by the real scan. No
 * mocks, and no dependence on whatever sessions the host happens to have.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/tug-filter-field.tsx
 * @covers tugdeck/src/components/tugways/filter-highlight.tsx
 * @covers tugdeck/src/lib/text-match.ts
 * @covers tugdeck/src/lib/session-picker-data-source.ts
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
 * @covers tugdeck/src/components/tugways/cards/session-picker-cells.tsx
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
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

/**
 * Encode an absolute project dir the way claude names its per-project subdir
 * under `~/.claude/projects/` (every character outside `[A-Za-z0-9-]` → `-`).
 * Kept inline so the app-test graph does not import tugcode.
 */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

/**
 * The seeded sessions. Each carries an `ai-title` record and a prompt, so the
 * leading word of each is a fragment appearing in exactly one rendered row.
 *
 * Which LINE of the row carries it is the callsign's doing: the callsign leads
 * every session row, so the title line is the minted callsign — a different
 * string every run — and the seeded text lands on the row's description line
 * instead. Assertions here therefore read the whole row's rendered text, not
 * the title line alone.
 */
const SEEDED = [
  {
    id: "a7c02650-0000-4000-8000-0000000000a1",
    prompt: "zebra harmonica calibration",
    title: "zebra harmonica calibration",
  },
  {
    id: "a7c02650-0000-4000-8000-0000000000a2",
    prompt: "quokka telemetry sweep",
    title: "quokka telemetry sweep",
  },
  {
    id: "a7c02650-0000-4000-8000-0000000000a3",
    prompt: "walrus ledger reconciliation",
    title: "walrus ledger reconciliation",
  },
];
/** A fragment of exactly one seeded title. */
const MATCHING_FRAGMENT = "zebra";
/** A fragment of no title at all. */
const ABSENT_FRAGMENT = "qqzzxx";

/** A minimal one-turn session JSONL in claude's own shape. */
function buildFixtureJsonl(
  cwd: string,
  sessionId: string,
  prompt: string,
  title: string,
): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.105",
    gitBranch: "main",
  };
  const suffix = sessionId.slice(-2);
  const lines = [
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: `00000000-0000-4000-8000-0000000${suffix}d01`,
      timestamp: "2026-07-20T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    },
    {
      ...base,
      parentUuid: `00000000-0000-4000-8000-0000000${suffix}d01`,
      type: "assistant",
      uuid: `00000000-0000-4000-8000-0000000${suffix}d02`,
      timestamp: "2026-07-20T10:00:01.000Z",
      message: {
        id: `msg-filter-${suffix}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    { type: "ai-title", aiTitle: title, sessionId },
  ];
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

let projectDir = "";
let fixtureDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  // realpath: macOS `mkdtemp` returns `/var/folders/…` but the scan resolves
  // `/var` → `/private/var` before encoding — encode the SAME resolved string.
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0265-proj-")));
  fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(projectDir));
  mkdirSync(fixtureDir, { recursive: true });
  for (const session of SEEDED) {
    writeFileSync(
      join(fixtureDir, `${session.id}.jsonl`),
      buildFixtureJsonl(projectDir, session.id, session.prompt, session.title),
    );
  }
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  if (fixtureDir !== "" && existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

const PICKER_FORM = ".session-card-picker-form";
const PICKER_OPEN = `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`;
const FILTER_INPUT = '[data-testid="session-card-picker-filter"] input';
const FILTER_CLEAR = '[data-testid="session-card-picker-filter"] button';
const RESUME_ROW = '[data-testid="session-card-picker-session-resume"]';
const SESSIONS_LIST = '[data-tug-focus-key="session-picker-cycle:2"]';

/** How many `session-resume` rows the list is showing. */
const RESUME_COUNT = `document.querySelectorAll(${JSON.stringify(RESUME_ROW)}).length`;

/**
 * The full rendered text of every visible resume row — the callsign line and
 * the description line together, which is what the filter matches against and
 * what the highlight paints into.
 */
const RESUME_TITLES = `(function(){
  return Array.prototype.map.call(
    document.querySelectorAll(${JSON.stringify(RESUME_ROW)}),
    function (row) { return row.textContent || ''; },
  );
})()`;

/** How many filter marks are painted anywhere in the sessions list. */
const MARK_COUNT = `document.querySelectorAll(${JSON.stringify(RESUME_ROW)} + ' mark.tug-filter-mark').length`;

/**
 * Type `text` into the filter field. Uses the prototype value setter so React's
 * input-value tracker still sees a change and fires the field's `onChange` —
 * the same path a real keystroke takes.
 */
function typeFilter(
  app: { evalJS<T>(s: string): Promise<T> },
  text: string,
): Promise<null> {
  return app.evalJS<null>(`(function(){
    var el = document.querySelector(${JSON.stringify(FILTER_INPUT)});
    if (!el) throw new Error("filter input not found");
    el.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return null;
  })()`);
}

function pressKey(
  app: { evalJS<T>(s: string): Promise<T> },
  selector: string,
  key: string,
): Promise<null> {
  return app.evalJS<null>(`(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("key target not found: " + ${JSON.stringify(selector)});
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return null;
  })()`);
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 860, height: 640 },
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

describe.skipIf(!SHOULD_RUN)("AT0265: the picker's filter field trims the sessions list", () => {
  test(
    "typing narrows and highlights, a non-match leaves only New session, ArrowDown lands on a match, and the clear restores",
    async () => {
      const app = await launchTugApp({ testName: "at0265-picker-filter" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        // An UNBOUND session card presents its picker.
        await app.waitForCondition<boolean>(PICKER_OPEN, { timeoutMs: 8000 });

        // Point the picker at the temp project (the picker seeds its own path
        // from recents / host facts on open, so type over it) — the path drives
        // the ledger fetch that lists the seeded transcripts.
        await app.evalJS<null>(`(function(){
          var el = document.querySelector('[data-tug-focus-key="session-picker-cycle:0"]');
          if (!el) throw new Error("path field not found");
          el.focus();
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(el, ${JSON.stringify(projectDir)});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return null;
        })()`);
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('[data-tug-focus-key="session-picker-cycle:0"]');
            return el !== null && el.value === ${JSON.stringify(projectDir)};
          })()`,
          { timeoutMs: 10_000 },
        );
        // The scan is phase 2 of `list_sessions`, so wait for all three rows.
        await app.waitForCondition<boolean>(`${RESUME_COUNT} >= ${SEEDED.length}`, {
          timeoutMs: 20_000,
        });
        const baselineCount = await app.evalJS<number>(RESUME_COUNT);
        const trashAllLabel = await app.evalJS<string>(
          `(function(){
            var el = document.querySelector('[data-testid="session-card-picker-trash-all-label"]');
            return el ? (el.textContent || '') : '';
          })()`,
        );
        const trashAllTooltip = await app.evalJS<string | null>(
          `(function(){
            var el = document.querySelector('.session-card-picker-trash-all');
            return el ? el.getAttribute('title') : null;
          })()`,
        );

        // (A) Typing narrows the list, and every survivor RENDERS the fragment
        // — with at least one painted mark, since the fragment came from text
        // the row actually displays.
        await typeFilter(app, MATCHING_FRAGMENT);
        await app.waitForCondition<boolean>(`${RESUME_COUNT} < ${baselineCount}`, {
          timeoutMs: 6000,
        });
        const titles = await app.evalJS<string[]>(RESUME_TITLES);
        expect(titles.length).toBeGreaterThan(0);
        for (const title of titles) {
          expect(title.toLowerCase()).toContain(MATCHING_FRAGMENT);
        }
        expect(await app.evalJS<number>(MARK_COUNT)).toBeGreaterThan(0);

        // (E) The trash-all sweep is per-path: an active filter changes neither
        // its label, its tooltip, nor its enabled state.
        expect(
          await app.evalJS<string>(
            `(function(){
              var el = document.querySelector('[data-testid="session-card-picker-trash-all-label"]');
              return el ? (el.textContent || '') : '';
            })()`,
          ),
        ).toBe(trashAllLabel);
        expect(
          await app.evalJS<string | null>(
            `(function(){
              var el = document.querySelector('.session-card-picker-trash-all');
              return el ? el.getAttribute('title') : null;
            })()`,
          ),
        ).toBe(trashAllTooltip);
        expect(
          await app.evalJS<boolean>(
            `(function(){
              var el = document.querySelector('.session-card-picker-trash-all');
              return el !== null && el.getAttribute('data-disabled') === null;
            })()`,
          ),
        ).toBe(true);

        // (C) ArrowDown hands the key view to the list and the cursor seeds onto
        // a real session — never "New session".
        await pressKey(app, FILTER_INPUT, "ArrowDown");
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(SESSIONS_LIST)});
            return el !== null && el.hasAttribute("data-key-view-kbd");
          })()`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var cursor = document.querySelector('${SESSIONS_LIST} [data-key-cursor]');
            if (cursor === null) return false;
            return cursor.getAttribute('data-tug-list-cell-kind') === 'session-resume';
          })()`,
          { timeoutMs: 6000 },
        );

        // (B) A fragment matching nothing empties the resume rows but keeps
        // "New session" — the list is never empty in the full picker.
        await typeFilter(app, ABSENT_FRAGMENT);
        await app.waitForCondition<boolean>(`${RESUME_COUNT} === 0`, { timeoutMs: 6000 });
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll('[data-testid="session-card-picker-session-new"]').length`,
          ),
        ).toBe(1);

        // (D) The ✕ restores the full list.
        await app.evalJS<null>(`(function(){
          var btn = document.querySelector(${JSON.stringify(FILTER_CLEAR)});
          if (!btn) throw new Error("clear button not found");
          btn.click();
          return null;
        })()`);
        await app.waitForCondition<boolean>(`${RESUME_COUNT} === ${baselineCount}`, {
          timeoutMs: 6000,
        });
        expect(await app.evalJS<number>(MARK_COUNT)).toBe(0);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0265-picker-filter] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
