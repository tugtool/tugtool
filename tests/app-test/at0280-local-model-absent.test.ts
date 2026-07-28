/**
 * at0280-local-model-absent.test.ts — what every user sees before they opt in.
 *
 * On-device inference is strict enhancement: nothing about the app changes
 * until a model is downloaded and selected. That claim is easy to state and
 * easy to break, because both tenants live on surfaces people touch constantly
 * — the PULSE strip and the prompt composer. This pins the model-less posture
 * so a regression shows up as a failing test rather than as a stray line or a
 * chip nobody asked for.
 *
 * **The model-less state has to be forced, not assumed.** Downloaded packs live
 * in a machine-shared directory ([P04]) that no per-run workspace resets, so on
 * a developer machine that has ever downloaded one the harness instance would
 * find it and light both tenants up. This test writes the declined selection
 * (`dev.tugtool.local-model/model = ""`) into its own tugbank, which makes the
 * host answer unavailable whatever is on disk — so the posture under test is
 * the same on a fresh machine and on this one.
 *
 * Two claims:
 *   1. The PULSE strip renders its single activity run and NO headline run —
 *      not an empty one, not a reserved one. Absent means absent.
 *   2. Typing lines that open with a PATH executable — `make test`, `git
 *      status` — leaves the composer holding plain text: no routing chip, no
 *      atom of any kind. Routing is a submit-time decision over the whole
 *      line, so nothing may materialize in the document while the user types.
 *   3. The Lens's row for the same session shows no goal line either. The
 *      card's strip and the Lens row read the same overview through two
 *      separate call sites, so absence has to be pinned on both.
 *
 * **Typing only — this test never submits a turn.** A real send into a
 * replay-backed harness session is out of bounds; the submit-time precondition
 * is covered as pure logic in `shell-line-classifier.test.ts`.
 *
 * @covers tugdeck/src/lib/local-model-store.ts
 * @covers tugdeck/src/lib/shell-line-classifier.ts
 * @covers tugdeck/src/components/tugways/cards/session-pulse-strip.tsx
 * @covers tugdeck/src/components/lens/sections/sessions-section.tsx
 * @covers tugdeck/src/components/tugways/tug-prompt-entry.tsx
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankWrite,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

// UUID-shaped so the bound session reads as a real one.
const SID = "a7c0d1ea-0000-4000-8000-000000000280";

const CARD = '[data-card-id="A"]';
const PROMPT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const ATOM = `${CARD} [data-slot="tug-text-editor"] img[data-atom-type]`;
const STRIP = `${CARD} [data-slot="session-pulse-strip"]`;
const HEADLINE = `${CARD} [data-slot="session-pulse-headline"]`;

// The Lens's own row for the same session. Addressed the way
// `at0257-lens-session-reorder.test.ts` addresses Sessions rows.
const LENS_ROW = `.lens-sessions-list .session-row-content[data-session-id="${SID}"]`;
const LENS_INTENT = `${LENS_ROW} [data-slot="session-row-intent"]`;

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0280-proj-")));
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session A", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 640 },
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

async function count(app: App, selector: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll(${JSON.stringify(selector)}).length`,
  );
}

/**
 * Type `text` into the composer and block until the document reads exactly it.
 *
 * The wait is the point: anything the composer materializes on its own does so
 * in a microtask after the keystroke, so a document that still reads as plain
 * text once the WHOLE line has landed is a document nothing was inserted into.
 */
async function typeLine(app: App, text: string, replace = false): Promise<void> {
  await app.nativeClickAtElement(PROMPT);
  // Select-all before typing so the second line overwrites the first — one
  // gesture instead of a separate delete whose emptied-doc state is awkward to
  // wait on.
  if (replace) await app.nativeKey("a", ["cmd"]);
  await app.nativeType(text);
  await app.waitForCondition<boolean>(
    // Trimmed: the leading edge of the composer can carry a stray space from a
    // select-all-then-type gesture. The atom count below is what actually
    // decides the claim — an inserted chip renders as its own element, and
    // contributes nothing to `textContent`, so text alone cannot see it.
    `(function(){
       var el = document.querySelector(${JSON.stringify(PROMPT)});
       return el !== null && el.textContent.trim() === ${JSON.stringify(text)};
     })()`,
    { timeoutMs: 10_000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0280: with no local model, nothing about the app changes",
  () => {
    test(
      "the strip stays single-line and typing never auto-inserts the shell chip",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        // The declined selection: no local model answers, whatever is on disk.
        tugbankWrite(tugbankPath, "dev.tugtool.local-model", "model", "string", "");
        const app = await launchTugApp({
          testName: "at0280-local-model-absent",
          env: { TUGBANK_PATH: tugbankPath },
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          // Bound, not resumed: the composer and the strip are what this pins,
          // and neither needs a live agent behind them.
          await app.bindSession("A", { tugSessionId: SID, projectDir });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PROMPT)}) !== null`,
            { timeoutMs: 20_000 },
          );

          // 1. The strip is there, and it carries no headline run.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(STRIP)}) !== null`,
            { timeoutMs: 20_000 },
          );
          expect(await count(app, HEADLINE)).toBe(0);

          // 2. Two lines that open with a real PATH executable — the exact
          //    shape that would be put to the model when one is present.
          await typeLine(app, "make test");
          expect(await count(app, ATOM)).toBe(0);

          await typeLine(app, "git status", true);
          expect(await count(app, ATOM)).toBe(0);

          // Still no headline after all that activity.
          expect(await count(app, HEADLINE)).toBe(0);

          // 3. The Lens says the same thing. The strip and the Lens row are
          //    two separate readers of the same overview, so a regression can
          //    land in one and not the other — the claim is only pinned where
          //    it is asserted.
          await app.dispatchControlAction("toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(LENS_ROW)}) !== null`,
            { timeoutMs: 10_000 },
          );
          expect(await count(app, LENS_INTENT)).toBe(0);
        } finally {
          await app.close();
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
