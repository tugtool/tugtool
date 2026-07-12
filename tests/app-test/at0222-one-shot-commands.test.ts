/**
 * at0222-one-shot-commands.test.ts — the Code route's one-shot slash
 * commands, `/shell` and `/find` ([AT0222]).
 *
 * ## Why this exists
 *
 * With first-character route switching removed, the Code route gains
 * one-shot accelerators: `/shell <cmd>` runs one exchange against the card's
 * shell session and `/find <query>` runs the transcript search with live
 * ⌘G cycling — both while the route STAYS `❯`. They are `codeRouteOnly` in
 * the local-command registry: not offered by the `/` popup on other routes,
 * and not intercepted at submit there (a literal `/shell ls` typed on `$`
 * reaches the shell as typed).
 *
 * ## Test matrix
 *
 *   1. `/shell echo …` lands a settled shell exchange row; route stays Code.
 *   2. `/find <term>` paints both matches, actives the first, ⌘G advances,
 *      Escape (empty editor) dissolves, a fresh `/find` re-seeds, and a
 *      subsequent non-find submission (`/shell`) dissolves again — route
 *      stays Code throughout.
 *   3. On the `$` route the `/` popup offers no one-shot commands while
 *      still offering ordinary local commands.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "a7c0d1ea-0000-4000-8000-00000000a222";

const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

/** Two plain turns, each carrying one `oneshotmark` occurrence. */
function buildFixtureJsonl(cwd: string, sessionId: string): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.105",
    gitBranch: "main",
  };
  const usage = {
    input_tokens: 1000,
    output_tokens: 50,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 5000,
  };
  const texts = [
    "oneshotmark alpha sits in the first reply",
    "oneshotmark omega sits in the second reply",
  ];
  const lines: unknown[] = [];
  let parent: string | null = null;
  let seq = 1;
  let clock = Date.parse("2026-06-17T10:00:00.000Z");
  for (const [i, text] of texts.entries()) {
    const userUuid = `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
    clock += 5000;
    lines.push({
      ...base,
      parentUuid: parent,
      type: "user",
      uuid: userUuid,
      timestamp: new Date(clock).toISOString(),
      message: { role: "user", content: [{ type: "text", text: `ask ${i}` }] },
    });
    parent = userUuid;
    const aUuid = `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
    clock += 5000;
    lines.push({
      ...base,
      parentUuid: parent,
      type: "assistant",
      uuid: aUuid,
      timestamp: new Date(clock).toISOString(),
      message: {
        id: `msg-oneshot-${i}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage,
      },
    });
    parent = aUuid;
  }
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

let projectDir = "";
let fixtureDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0222-proj-")));
  fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(projectDir));
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, `${SID}.jsonl`), buildFixtureJsonl(projectDir, SID));
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
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 20, y: 20 },
        size: { width: 860, height: 720 },
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

const EDITOR_SELECTOR =
  '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';
const ROUTE_TRIGGER_SELECTOR =
  '[data-card-id="A"] .tug-prompt-entry-toolbar button[aria-label="Route"]';
const ROUTE_LABEL_SELECTOR = `${ROUTE_TRIGGER_SELECTOR} [data-tug-stable="active"]`;
const COMPLETION_MENU_SELECTOR = '[data-slot="tug-completion-menu"]';

async function mountAndReplay(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
    { timeoutMs: 15_000 },
  );
  await app.spawnSessionResume("A", { tugSessionId: SID, projectDir });
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('[data-card-id="A"] [data-tug-list-cell-index]').length >= 4`,
    { timeoutMs: 30_000 },
  );
}

async function readRouteLabel(app: App): Promise<string> {
  return await app.evalJS<string>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
      return el ? (el.textContent || '').trim() : '';
    })()`,
  );
}

/** Focus the editor, type `line`, settle, and force-submit with ⌘Enter. */
async function submitLine(app: App, line: string): Promise<void> {
  await app.nativeClickAtElement(EDITOR_SELECTOR);
  await app.nativeType(line);
  await new Promise((r) => setTimeout(r, 150));
  await app.nativeKey("Enter", ["cmd"]);
}

/** Painted find ranges as `{text, row, active}` in document order. */
async function readPaintedRanges(
  app: App,
): Promise<Array<{ text: string; row: number; active: boolean }>> {
  const raw = await app.evalJS<string>(
    `(() => {
      const collect = (name, isActive) => {
        const hl = CSS.highlights.get(name);
        const out = [];
        if (hl) {
          for (const r of hl) {
            const el = r.startContainer.parentElement;
            const cell = el ? el.closest('[data-tug-list-cell-index]') : null;
            out.push({
              text: r.toString(),
              row: cell ? Number(cell.getAttribute('data-tug-list-cell-index')) : -1,
              active: isActive,
              range: r,
            });
          }
        }
        return out;
      };
      const all = collect('transcript-find-match', false)
        .concat(collect('transcript-find-active', true));
      all.sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range));
      return JSON.stringify(all.map(({ text, row, active }) => ({ text, row, active })));
    })()`,
  );
  return JSON.parse(raw) as Array<{ text: string; row: number; active: boolean }>;
}

async function waitForPaintedCount(app: App, expected: number): Promise<void> {
  await app.waitForCondition<boolean>(
    `(() => {
      let n = 0;
      for (const name of ['transcript-find-match', 'transcript-find-active']) {
        const hl = CSS.highlights.get(name);
        if (hl) for (const _ of hl) n += 1;
      }
      return n === ${expected};
    })()`,
    { timeoutMs: 8000 },
  );
}

/** Synthetic keybinding chord at the active element (see at0221). */
async function dispatchChord(
  app: App,
  code: string,
  key: string,
  modifiers: { meta?: boolean; shift?: boolean },
): Promise<void> {
  await app.evalJS<boolean>(
    `(function(){
      var target = document.activeElement || document;
      return target.dispatchEvent(new KeyboardEvent("keydown", {
        code: ${JSON.stringify(code)},
        key: ${JSON.stringify(key)},
        metaKey: ${modifiers.meta === true},
        shiftKey: ${modifiers.shift === true},
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("AT0222: one-shot /shell and /find", () => {
  test(
    "/shell runs one exchange into the transcript; the route stays Code",
    async () => {
      const app = await launchTugApp({ testName: "at0222-shell" });
      try {
        await mountAndReplay(app);
        expect(await readRouteLabel(app)).toBe("Code");

        await submitLine(app, "/shell echo oneshot-shell-probe");
        await app.waitForCondition<boolean>(
          `(() => {
            const rows = document.querySelectorAll('[data-slot="dev-transcript-shell-row"]');
            if (rows.length === 0) return false;
            const row = rows[rows.length - 1];
            const foot = row.querySelector('[data-slot="dev-z1b-end-state"]');
            return foot !== null && (foot.textContent || '').includes('exit') &&
              (row.textContent || '').includes('oneshot-shell-probe');
          })()`,
          { timeoutMs: 20_000 },
        );
        expect(await readRouteLabel(app)).toBe("Code");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "/find paints + cycles on the Code route; Escape and a new submission dissolve it",
    async () => {
      const app = await launchTugApp({ testName: "at0222-find" });
      try {
        await mountAndReplay(app);

        await submitLine(app, "/find oneshotmark");
        await waitForPaintedCount(app, 2);
        expect(await readRouteLabel(app)).toBe("Code");
        const painted = await readPaintedRanges(app);
        expect(painted.map((p) => p.text)).toEqual(["oneshotmark", "oneshotmark"]);
        const firstActiveRow = painted.find((p) => p.active)!.row;

        // ⌘G advances the active match to the other occurrence.
        await dispatchChord(app, "KeyG", "g", { meta: true });
        await app.waitForCondition<boolean>(
          `(() => {
            const hl = CSS.highlights.get('transcript-find-active');
            if (!hl) return false;
            for (const r of hl) {
              const el = r.startContainer.parentElement;
              const cell = el ? el.closest('[data-tug-list-cell-index]') : null;
              if (cell && Number(cell.getAttribute('data-tug-list-cell-index')) !== ${firstActiveRow}) {
                return true;
              }
            }
            return false;
          })()`,
          { timeoutMs: 6000 },
        );

        // Escape on the (submit-emptied) editor dissolves the one-shot find.
        await app.nativeClickAtElement(EDITOR_SELECTOR);
        await app.nativeKey("Escape");
        await waitForPaintedCount(app, 0);

        // A fresh /find re-seeds…
        await submitLine(app, "/find oneshotmark");
        await waitForPaintedCount(app, 2);
        // …and a subsequent non-find submission dissolves it again.
        await submitLine(app, "/shell echo oneshot-clear");
        await waitForPaintedCount(app, 0);
        expect(await readRouteLabel(app)).toBe("Code");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the `/` popup offers no one-shot commands on the `$` route",
    async () => {
      const app = await launchTugApp({ testName: "at0222-gating" });
      try {
        await mountAndReplay(app);
        await app.click(ROUTE_TRIGGER_SELECTOR);
        await app.click('.tug-menu-item[data-item-id="$"]');
        await app.waitForCondition<boolean>(
          `(() => {
            const el = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
            return el !== null && (el.textContent || '').trim() === "Shell";
          })()`,
          { timeoutMs: 4000 },
        );

        await app.nativeClickAtElement(EDITOR_SELECTOR);
        await app.nativeType("/");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)}) !== null`,
          { timeoutMs: 4000 },
        );
        const labels = await app.evalJS<string>(
          `(() => {
            const popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
            if (!popup) return "[]";
            const items = popup.querySelectorAll(".tug-completion-menu-item");
            return JSON.stringify(Array.from(items).map((el) => (el.textContent || '').trim()));
          })()`,
        );
        const names = JSON.parse(labels) as string[];
        expect(names.length).toBeGreaterThan(0);
        for (const gated of ["shell", "find", "btw"]) {
          expect(
            names.some((n) => n === gated || n.startsWith(`${gated} `)),
            `gated one-shot "/${gated}" must not be offered on the $ route`,
          ).toBe(false);
        }
        expect(
          names.some((n) => n.includes("permissions")),
          "ordinary local commands stay offered",
        ).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
