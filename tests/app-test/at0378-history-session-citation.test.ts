/**
 * at0378-history-session-citation.test.ts — the History card says which session
 * made each commit, and says it as a citation.
 *
 * ## What this gates
 *
 * The `Tug-Session:` trailer used to be raw body ink: the History card rendered
 * it unparsed, so a commit's attribution read as a truncated title followed by
 * a thirty-six-character UUID, inside the message body, where the filter also
 * matched it. tugcast now parses both trailers into typed fields and strips
 * their lines from the body, and the row renders the citation as a chip beside
 * the sha ([P10], Spec S03).
 *
 * This runs against **this repo's real commits**, not a fixture, which is the
 * point: the trailers under test were written by the shipping writers, in both
 * grammars — Phase A commits carry the typed pair, and everything older carries
 * the legacy one-line form that must still parse (Spec S03). A fixture would
 * only prove the renderer agrees with itself.
 *
 * So the assertions are the two invariants that hold across every real commit
 * rather than a specific tag on a specific sha:
 *
 *   A. **At least one row carries a session chip.** The read path reaches the
 *      renderer at all — the typed fields survive the feed and the trailer text
 *      is not silently dropped along with its body line.
 *
 *   B. **No row anywhere shows a raw session UUID, and no body shows a
 *      `Tug-Session` line.** This is the failure being fixed, and it is the
 *      assertion a re-introduction trips: an unstripped body or a chip that
 *      printed its id would both land here.
 *
 * @covers tugdeck/src/components/tugways/tug-history-list.tsx
 * @covers tugdeck/src/lib/session-identity.ts
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { launchTugApp, note } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The worktree root — the real repo tugcast serves as its bootstrap tree. */
const REPO = resolve(import.meta.dir, "..", "..");

const VIEW = `[data-slot="session-history-view"]`;
const ROW = `${VIEW} [data-testid="session-history-commit"]`;
const CHIP = `${ROW} [data-slot="tug-session-identity"]`;

/** A full session UUID anywhere in a string — what must never reach the eye. */
const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe.skipIf(!SHOULD_RUN)(
  "at0378 — History cites the session that made the commit",
  () => {
    test(
      "a citation chip beside the sha, and no raw trailer ink anywhere",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath, { sourceTreePath: REPO });
        const app = await launchTugApp({
          testName: "at0378-history-session-citation",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.waitForCondition<boolean>(
            `typeof window.__tug !== "undefined"`,
            { timeoutMs: 5_000 },
          );
          await app.seedDeckState({
            state: {
              cards: [
                { id: "D", componentId: "session", title: "Session", closable: true },
              ],
              panes: [
                {
                  id: "pD",
                  position: { x: 40, y: 40 },
                  size: { width: 900, height: 620 },
                  cardIds: ["D"],
                  activeCardId: "D",
                  title: "",
                  acceptsFamilies: ["maker"],
                },
              ],
              activePaneId: "pD",
              hasFocus: true,
            },
            focusCardId: "D",
          });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("D")`,
            { timeoutMs: 5_000 },
          );
          await app.bindSession("D", { projectDir: REPO });

          await app.dispatchControlAction("toggle-history-view");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROW)}).length > 0`,
            { timeoutMs: 10_000 },
          );

          // ---- A. The attribution reaches the row. -------------------------
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(CHIP)}).length > 0`,
            { timeoutMs: 10_000 },
          );
          const chips = await app.evalJS<string[]>(
            `Array.from(document.querySelectorAll(${JSON.stringify(CHIP)}))
              .map(function (el) { return (el.textContent || "").trim(); })`,
          );
          note(`at0378 session chips on screen: ${chips.length}`);
          expect(chips.length).toBeGreaterThan(0);
          // Every chip says something — an empty atom would be a chip that
          // resolved to nothing AND had nothing recorded to fall back on.
          for (const text of chips) expect(text.length).toBeGreaterThan(0);

          // ---- B. No raw id, and no trailer line in any body. ---------------
          const viewText = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(VIEW)}).innerText || "")`,
          );
          expect(viewText).not.toContain("Tug-Session:");
          expect(viewText).not.toContain("Tug-Session-Id:");
          const uuid = UUID_ANYWHERE.exec(viewText);
          if (uuid !== null) note(`at0378 unexpected uuid on screen: ${uuid[0]}`);
          expect(uuid).toBeNull();
        } finally {
          await app.close();
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
