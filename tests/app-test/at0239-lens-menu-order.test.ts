/**
 * at0239-lens-menu-order.test.ts — the Lens `…` menu ordering INVARIANTS
 * (not a fixed order):
 *
 *   1. Mirror — with all sections visible, the menu lists them in the
 *      exact order the rail stacks them.
 *   2. Alphabetical tail — hidden sections are listed after the visible
 *      ones, sorted alphabetically by title. (Exercised by hiding every
 *      section: the whole menu is then the hidden tail, so its labels
 *      must come out alphabetical.)
 *
 * Everything is read from the live DOM — no section kind, title, or
 * default order is hardcoded — so the test survives any change to the
 * default section order or the set of registered sections.
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const MENU_BUTTON = `.tug-pane[data-anchored] [data-testid="tug-pane-title-bar-menu-button"]`;

async function dispatch(app: App, action: string): Promise<void> {
  await app.dispatchControlAction(action);
}

/** Rendered rail section kinds, top-to-bottom. */
async function railKinds(app: App): Promise<string[]> {
  const json = await app.evalJS<string>(
    `JSON.stringify(Array.from(document.querySelectorAll('.lens-section[data-lens-section]')).map(function(n){ return n.getAttribute("data-lens-section"); }))`,
  );
  return JSON.parse(json) as string[];
}

/** Menu items ({ id, label }) in DOM order. */
async function menuItems(app: App): Promise<{ id: string; label: string }[]> {
  const json = await app.evalJS<string>(
    `JSON.stringify(Array.from(document.querySelectorAll('[data-item-id]')).map(function(n){ return { id: n.getAttribute("data-item-id"), label: (n.textContent || "").trim() }; }))`,
  );
  return JSON.parse(json) as { id: string; label: string }[];
}

async function menuCount(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll('[data-item-id]').length`,
  );
}

async function openMenu(app: App, expectCount: number): Promise<void> {
  await app.nativeClickAtElement(MENU_BUTTON);
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('[data-item-id]').length === ${expectCount}`,
    { timeoutMs: 3_000 },
  );
}

async function closeMenu(app: App): Promise<void> {
  await app.nativeKey("Escape");
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('[data-item-id]').length === 0`,
    { timeoutMs: 3_000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0239 — Lens … menu mirrors the rail; hidden sections sort alphabetically",
  () => {
    test(
      "menu order equals rail order; hiding all yields an alphabetical menu",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0239-lens-menu-order",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('.lens-section[data-lens-section]').length >= 2 && document.querySelector('${MENU_BUTTON}') !== null`,
              { timeoutMs: 5_000 },
            );

            const rail = await railKinds(app);
            const total = rail.length;

            // (1) Mirror: with everything visible, the menu order is the
            // rail order — item-for-item.
            await openMenu(app, total);
            expect((await menuItems(app)).map((i) => i.id)).toEqual(rail);
            await closeMenu(app);

            // Hide every section, one at a time (each toggle closes the
            // menu and drops that section from the rail).
            for (const kind of rail) {
              await openMenu(app, total);
              await app.nativeClickAtElement(`[data-item-id="${kind}"]`);
              await app.waitForCondition<boolean>(
                `document.querySelector('.lens-section[data-lens-section="${kind}"]') === null`,
                { timeoutMs: 3_000 },
              );
            }

            // (2) Alphabetical tail: the menu is now all-hidden, so its
            // labels must be in ascending alphabetical order.
            await openMenu(app, total);
            expect(await menuCount(app)).toBe(total);
            const labels = (await menuItems(app)).map((i) => i.label);
            const sorted = [...labels].sort((a, b) => a.localeCompare(b));
            expect(labels).toEqual(sorted);
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
