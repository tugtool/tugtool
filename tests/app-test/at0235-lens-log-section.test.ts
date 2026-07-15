/**
 * at0235-lens-log-section.test.ts — the Lens **Log** section renders the
 * real `tugDevLogStore` buffer, with a live collapsed-summary and a
 * working level filter.
 *
 * The Log section is registered at boot; opening the Lens (`toggle-lens`)
 * mounts it. Entries are driven through `window.tugDevLog` (the store
 * itself, attached under the in-app test harness) so the assertions run
 * against the real store + real rendering, not a fixture.
 *
 * Scenario:
 *   1. Open the Lens; the Log section mounts.
 *   2. Clear + emit one info / warn / error entry; assert the body
 *      renders all three rows.
 *   3. Collapse the section; assert the band's collapsed-summary reflects
 *      the live warn/error counts, the body is gone, and the collapse
 *      persists to `dev.tugtool.lens/collapsedSections` (at0232 folds in).
 *   4. Expand; narrow the level filter to `error`; assert the list
 *      narrows to the single error row while the summary (all entries)
 *      is unchanged.
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const LOG_SECTION = `.lens-section[data-lens-section="log"]`;
const LOG_ROWS = `${LOG_SECTION} .tug-devlog-row`;

async function rowCount(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll(${JSON.stringify(LOG_ROWS)}).length`,
  );
}

async function dispatch(app: App, action: string): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction(${JSON.stringify(action)})`,
  );
}

async function seedLogEntries(app: App): Promise<void> {
  await app.evalJS<void>(
    `(function(){
      window.tugDevLog.clear();
      window.tugDevLog.info("at0235", "hello-info");
      window.tugDevLog.warn("at0235", "hello-warn");
      window.tugDevLog.error("at0235", "hello-error");
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0235 — Lens Log section renders real entries, summary, and filter",
  () => {
    test(
      "log entries render; collapsed summary counts; level filter narrows",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0235-lens-log-section",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.waitForCondition<boolean>(
              `typeof window.__tug !== "undefined" && typeof window.tugDevLog !== "undefined"`,
              { timeoutMs: 5_000 },
            );

            // Open the Lens → the Log section mounts.
            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(LOG_SECTION)}) !== null`,
              { timeoutMs: 3_000 },
            );

            // Emit a known trio; the body renders all three rows.
            await seedLogEntries(app);
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(LOG_ROWS)}).length >= 3`,
              { timeoutMs: 3_000 },
            );
            expect(await rowCount(app)).toBeGreaterThanOrEqual(3);

            // Collapse → live summary reflects warn/error counts, body gone,
            // collapse persisted (at0232).
            await app.nativeClickAtElement(
              `${LOG_SECTION} [aria-label="Collapse Log"]`,
            );
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(LOG_SECTION)}).getAttribute("data-collapsed") === "true"`,
              { timeoutMs: 3_000 },
            );
            const summary = await app.evalJS<string>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(
                  `${LOG_SECTION} [data-testid="lens-section-summary"]`,
                )});
                return el ? el.textContent : "";
              })()`,
            );
            expect(summary).toContain("1 warn");
            expect(summary).toContain("1 error");
            // Body is unmounted while collapsed.
            expect(
              await app.evalJS<boolean>(
                `document.querySelector(${JSON.stringify(
                  `${LOG_SECTION} [data-testid="lens-section-body"]`,
                )}) === null`,
              ),
            ).toBe(true);
            // Collapse persisted.
            const collapsed = tugbankRead<string[]>(
              tugbankPath,
              "dev.tugtool.lens",
              "collapsedSections",
            );
            expect(collapsed?.value).toContain("log");

            // Expand again; narrow the level filter to error only.
            await app.nativeClickAtElement(
              `${LOG_SECTION} [aria-label="Expand Log"]`,
            );
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(
                `${LOG_SECTION} [data-testid="lens-section-body"]`,
              )}) !== null`,
              { timeoutMs: 3_000 },
            );
            await app.evalJS<void>(
              `window.tugDevLog.setLevels(new Set(["error"]))`,
            );
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(LOG_ROWS)}).length === 1`,
              { timeoutMs: 3_000 },
            );
            expect(await rowCount(app)).toBe(1);
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "Telemetry section follows the focused dev card and shows its telemetry",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0235-lens-telemetry",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({
              state: {
                cards: [
                  { id: "D", componentId: "dev", title: "Dev", closable: true },
                ],
                panes: [
                  {
                    id: "pD",
                    position: { x: 40, y: 40 },
                    size: { width: 620, height: 460 },
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
            await app.bindDevSession("D");
            await app.awaitEngineReady("D");

            // Open the Lens (its Telemetry section mounts).
            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelector('.lens-section[data-lens-section="telemetry"]') !== null`,
              { timeoutMs: 3_000 },
            );

            // Re-activate the dev card so the section observes it as the
            // last non-lens key card ([P11]).
            await app.nativeClickAtElement(
              `.tug-pane[data-pane-id="pD"] .tug-pane-title-bar`,
            );

            // Telemetry follows D: names it and renders non-empty fields.
            await app.waitForCondition<boolean>(
              `document.querySelector('[data-testid="lens-telemetry-card-name"]') !== null`,
              { timeoutMs: 4_000 },
            );
            const cardName = await app.evalJS<string>(
              `(function(){
                var el = document.querySelector('[data-testid="lens-telemetry-card-name"]');
                return el ? el.textContent : "";
              })()`,
            );
            expect(cardName.length).toBeGreaterThan(0);
            const fieldRows = await app.evalJS<number>(
              `document.querySelectorAll('.lens-section[data-lens-section="telemetry"] .tug-devpanel-field-row').length`,
            );
            expect(fieldRows).toBeGreaterThan(0);

            // Collapsed summary is a live stat (not the "No card" empty state).
            await app.nativeClickAtElement(
              `.lens-section[data-lens-section="telemetry"] [aria-label="Collapse Telemetry"]`,
            );
            await app.waitForCondition<boolean>(
              `document.querySelector('.lens-section[data-lens-section="telemetry"]').getAttribute("data-collapsed") === "true"`,
              { timeoutMs: 3_000 },
            );
            const summary = await app.evalJS<string>(
              `(function(){
                var el = document.querySelector('.lens-section[data-lens-section="telemetry"] [data-testid="lens-section-summary"]');
                return el ? el.textContent : "";
              })()`,
            );
            expect(summary.length).toBeGreaterThan(0);
            expect(summary).not.toBe("No card");
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
