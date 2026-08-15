/**
 * at0422-filter-forward.test.ts — typing at a focused list lands in the filter
 * field attached to it ([AT0422]).
 *
 * ## What this gates
 *
 * The upward half of the attached-list contract ([P08]). The downward half —
 * ↑/↓ from the caret drive the list's cursor — is at0265's (C). This is the
 * other direction: with the ring on the LIST, a printable character is a
 * request to filter, so the engine grants the caret to the field the list
 * nominates and the browser types the character in. Before it existed the
 * character was declined by `handleListKey`'s `default:` and silently dropped,
 * and filtering cost a Tab out and a Tab back.
 *
 * The keystrokes here are REAL (`nativeType` / `nativeKey`), not synthesized
 * KeyboardEvents, because the whole mechanism is a synchronous un-prevented
 * grant that relies on the browser's own `beforeinput` → `input` pipeline to
 * land the character. A dispatched `KeyboardEvent` has no default action, so it
 * would exercise the grant and prove nothing about the character.
 *
 *   - **The forward itself (A):** with the sessions list holding the key view,
 *     typing a fragment moves the caret into the filter field, leaves the
 *     field holding exactly what was typed, and narrows the list. Fails if the
 *     nomination is unwired, if the grant parks instead of granting (a parked
 *     deputy swallows the character that asked for it), or if the provider
 *     prevents the event and kills the browser's insertion.
 *   - **The round trip stays keyboard-only (B):** from there ↓ cursors the list
 *     without moving the caret, so narrow-then-choose is one gesture with no
 *     Tab in it.
 *   - **A forwarded arrival APPENDS (C):** the field selects-all on a Tab-in,
 *     which would make the second forwarded character erase the first. A
 *     forwarded arrival puts the caret at the end instead, so a query typed
 *     across a re-entry survives.
 *   - **Space does not forward (D):** on a list Space is commit, and a query
 *     opening with a space means nothing. Typing a space with the ring on the
 *     list must leave the field empty.
 *
 * ## Deterministic rows
 *
 * Same approach as at0265: real transcript JSONL seeded into the encoded claude
 * project dir for a fresh temp path, read by the real scan. No mocks.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/attached-filter.ts
 * @covers tugdeck/src/components/tugways/tug-filter-field.tsx
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/responder-chain-provider.tsx
 * @covers tugdeck/src/components/tugways/cards/session-card.tsx
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
import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

/** How claude names its per-project subdir under `~/.claude/projects/`. */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

const SEEDED = [
  {
    id: "a7c04220-0000-4000-8000-0000000000b1",
    prompt: "zebra harmonica calibration",
    title: "zebra harmonica calibration",
  },
  {
    id: "a7c04220-0000-4000-8000-0000000000b2",
    prompt: "quokka telemetry sweep",
    title: "quokka telemetry sweep",
  },
  {
    id: "a7c04220-0000-4000-8000-0000000000b3",
    prompt: "walrus ledger reconciliation",
    title: "walrus ledger reconciliation",
  },
];
/** A fragment of exactly one seeded title. */
const FRAGMENT = "zebra";

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
      uuid: `00000000-0000-4000-8000-0000000${suffix}e01`,
      timestamp: "2026-07-20T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    },
    {
      ...base,
      parentUuid: `00000000-0000-4000-8000-0000000${suffix}e01`,
      type: "assistant",
      uuid: `00000000-0000-4000-8000-0000000${suffix}e02`,
      timestamp: "2026-07-20T10:00:01.000Z",
      message: {
        id: `msg-forward-${suffix}`,
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
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0422-proj-")));
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
const PATH_FIELD = '[data-tug-focus-key="session-picker-cycle:0"]';
const SESSIONS_STOP = '[data-tug-focus-key="session-picker-cycle:2"]';
const FILTER_INPUT = '[data-testid="session-card-picker-filter"] input';
const RESUME_ROW = '[data-testid="session-card-picker-session-resume"]';

const RESUME_COUNT = `document.querySelectorAll(${JSON.stringify(RESUME_ROW)}).length`;

/** The filter field's current value — `null` when the field is not mounted. */
const FILTER_VALUE = `(function(){
  var el = document.querySelector(${JSON.stringify(FILTER_INPUT)});
  return el === null ? null : el.value;
})()`;

/** Whether the caret is really in the filter field (not merely ringed there). */
const CARET_IN_FILTER = `(function(){
  var el = document.querySelector(${JSON.stringify(FILTER_INPUT)});
  return el !== null && document.activeElement === el;
})()`;

/** The caret's offset in the filter field, or -1 when it does not hold focus. */
const CARET_OFFSET = `(function(){
  var el = document.querySelector(${JSON.stringify(FILTER_INPUT)});
  if (el === null || document.activeElement !== el) return -1;
  return el.selectionStart;
})()`;

/** Which row the list's cursor rests on — its rendered text, or `null`. */
const CURSOR_ROW_TEXT = `(function(){
  var el = document.querySelector('[data-tug-key-within], [data-attached-cursor]');
  return el === null ? null : (el.textContent || '');
})()`;

/** The focus key of whatever wears the keyboard ring — for diagnosing a stall. */
const KEY_VIEW_STOP = `(function(){
  var el = document.querySelector("[data-key-view-kbd]");
  return el === null ? null : (el.getAttribute("data-tug-focus-key") || el.tagName);
})()`;

/** Whether the engine's keyboard key view is the sessions list right now. */
const KEY_VIEW_IS_LIST = `(function(){
  var el = document.querySelector(${JSON.stringify(SESSIONS_STOP)});
  return el !== null && el.hasAttribute("data-key-view-kbd");
})()`;

/**
 * Walk the picker's Tab cycle until the sessions list holds the key view —
 * the same real gesture the user makes, rather than a placement the test
 * authors. Bounded: the cycle's membership is host-dependent.
 */
async function focusSessionsList(app: App): Promise<void> {
  for (let i = 0; i < 12; i++) {
    if (await app.evalJS<boolean>(KEY_VIEW_IS_LIST)) return;
    await app.nativeKey("Tab");
    try {
      await app.waitForCondition<boolean>(KEY_VIEW_IS_LIST, { timeoutMs: 1_500 });
      return;
    } catch {
      // Not this stop — keep walking.
    }
  }
  note(`tab walk stalled; key view is ${await app.evalJS<string | null>(KEY_VIEW_STOP)}`);
  throw new Error("tab walk never reached the sessions list");
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

/** Open the picker on the seeded project and wait for all three rows. */
async function openPickerOnSeededProject(app: App): Promise<void> {
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.waitForCondition<boolean>(PICKER_OPEN, { timeoutMs: 8000 });
  await app.evalJS<null>(`(function(){
    var el = document.querySelector(${JSON.stringify(PATH_FIELD)});
    if (!el) throw new Error("path field not found");
    el.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(projectDir)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return null;
  })()`);
  await app.waitForCondition<boolean>(`${RESUME_COUNT} >= ${SEEDED.length}`, {
    timeoutMs: 20_000,
  });
  // Typing the path opens the recents dropdown, and an OPEN dropdown consumes
  // Tab (the combo box owns it while its list is up), so a walk from here
  // would never leave the path field.
  await app.nativeKey("Escape");
}

describe.skipIf(!SHOULD_RUN)(
  "AT0422: typing at a focused list forwards into its attached filter",
  () => {
    test(
      "a character typed at the sessions list lands in the filter, narrows it, and leaves the round trip keyboard-only",
      async () => {
        // Real keystrokes need a real key window: the forward's whole point is
        // the browser's default insertion, which a background app never runs.
        const app = await launchTugApp({
          testName: "at0422-filter-forward",
          foreground: true,
        });
        try {
          await openPickerOnSeededProject(app);
          const baselineCount = await app.evalJS<number>(RESUME_COUNT);

          // The ring goes on the LIST — the state the user is complaining
          // about, and the picker's own default focus when sessions are ready.
          await focusSessionsList(app);
          await app.waitForCondition<boolean>(KEY_VIEW_IS_LIST, { timeoutMs: 4000 });
          expect(await app.evalJS<boolean>(CARET_IN_FILTER)).toBe(false);

          // (A) Type the fragment with the ring still on the list. Every
          // character but the first arrives with the caret already in the
          // field; the FIRST is the one the forward carries.
          await app.nativeType(FRAGMENT);
          expect(
            await app.waitForCondition<string>(
              `(function(){ var v = ${FILTER_VALUE}; return v === ${JSON.stringify(
                FRAGMENT,
              )} ? v : null; })()`,
              { timeoutMs: 6000 },
            ),
          ).toBe(FRAGMENT);
          expect(await app.evalJS<boolean>(CARET_IN_FILTER)).toBe(true);
          await app.waitForCondition<boolean>(
            `${RESUME_COUNT} < ${baselineCount}`,
            { timeoutMs: 6000 },
          );
          note(
            `forward: ${baselineCount} rows → ${await app.evalJS<number>(RESUME_COUNT)} after typing "${FRAGMENT}" at the list`,
          );

          // (B) From here ↓ cursors the list and the caret stays put — the
          // narrow-then-choose round trip with no Tab in it ([P08]).
          await app.nativeKey("ArrowDown");
          expect(await app.evalJS<boolean>(CARET_IN_FILTER)).toBe(true);
          const cursorText = await app.evalJS<string | null>(CURSOR_ROW_TEXT);
          expect(cursorText).not.toBeNull();
          expect((cursorText ?? "").toLowerCase()).toContain(FRAGMENT);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0422-forward] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "a forwarded arrival appends to the query, and Space never starts a forward",
      async () => {
        const app = await launchTugApp({
          testName: "at0422-filter-append",
          foreground: true,
        });
        try {
          await openPickerOnSeededProject(app);

          // Build a partial query by forwarding, then go back to the list and
          // forward again — the second arrival must EXTEND, not replace. A
          // Tab-in selects-all, and reusing that here would erase the query
          // the user can see while they type the next letter of it.
          await focusSessionsList(app);
          await app.nativeType("zeb");
          expect(
            await app.waitForCondition<string>(
              `(function(){ var v = ${FILTER_VALUE}; return v === "zeb" ? v : null; })()`,
              { timeoutMs: 6000 },
            ),
          ).toBe("zeb");

          await focusSessionsList(app);
          await app.waitForCondition<boolean>(KEY_VIEW_IS_LIST, { timeoutMs: 4000 });
          expect(await app.evalJS<boolean>(CARET_IN_FILTER)).toBe(false);
          // The query is intact while the ring sits on the list — the field
          // does not clear itself just because the caret left.
          expect(await app.evalJS<string | null>(FILTER_VALUE)).toBe("zeb");

          // (C) One more forwarded character extends it to the full fragment.
          await app.nativeType("r");
          expect(
            await app.waitForCondition<string>(
              `(function(){ var v = ${FILTER_VALUE}; return v === "zebr" ? v : null; })()`,
              { timeoutMs: 6000 },
            ),
          ).toBe("zebr");
          expect(await app.evalJS<number>(CARET_OFFSET)).toBe(4);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0422-append] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "Space never starts a forward — on a list it is still the commit",
      async () => {
        const app = await launchTugApp({
          testName: "at0422-filter-space",
          foreground: true,
        });
        try {
          await openPickerOnSeededProject(app);
          await focusSessionsList(app);

          // (D) A query cannot usefully OPEN with a space, and on a list Space
          // is the commit — so it must not carry the caret into the field. Its
          // own test because the commit is real: where the engine leaves the
          // key view afterwards is that gesture's business, and threading it
          // through the append flow would be testing two things at once.
          await app.nativeKey(" ");
          await new Promise((r) => setTimeout(r, 500));
          expect(await app.evalJS<string | null>(FILTER_VALUE)).toBe("");
          expect(await app.evalJS<boolean>(CARET_IN_FILTER)).toBe(false);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0422-space] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
