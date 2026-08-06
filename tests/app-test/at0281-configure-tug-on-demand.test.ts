/**
 * at0281-configure-tug-on-demand.test.ts — the Tug ▸ Configure Tug… route into ConfigureTug.
 *
 * The setup wizard used to be reachable only by being un-set-up. The Tug-menu
 * "Configure Tug…" item opens it on demand, and because it is app-modal it must not
 * land on top of a running turn. Both branches of that gate are pinned here,
 * on one session card:
 *
 *   1. **Idle** — the `setup` control action opens the wizard outright, no
 *      confirm, and the Done button closes it again with its steps unchanged
 *      under the fade (the panel outlives the flag that shapes it). (Under the harness the
 *      wizard is otherwise suppressed, so an on-demand open is the ONLY way it
 *      appears here — nothing else could be mistaken for it.)
 *   2. **Mid-turn** — with a turn in flight the wizard does not open; a
 *      confirm alert comes up first. Confirming stops the turn (Session ▸ Stop
 *      gates back off) and then the wizard opens.
 *
 * Driven through the real stores: `driveSession send` puts a real turn in
 * flight, and `dispatchControlAction("configure-tug")` is the exact action the native
 * menu item posts (the item itself carries no key equivalent, so there is no
 * CGEvent path to drive — at0168 pins its presence).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/configure-tug.tsx
 * @covers tugdeck/src/components/tugways/configure-tug-request.tsx
 * @covers tugdeck/src/lib/configure-tug-request-store.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0281-configure-tug-on-demand";
const SETUP = '[data-slot="configure-tug"]';
const ALERT = '[data-slot="tug-alert"]';
const SETUP_DONE = `${SETUP} .tug-alert-actions [data-slot="tug-push-button"]`;
const SETUP_STEP_LABEL = `${SETUP} .configure-tug-step-label`;
// The alert's actions row is [Cancel, confirm] — the confirm is the last.
const ALERT_CONFIRM = `${ALERT} .tug-alert-actions [data-slot="tug-push-button"]:last-child`;

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
        acceptsFamilies: ["work"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function present(selector: string): string {
  return `document.querySelector(${JSON.stringify(selector)}) !== null`;
}

function absent(selector: string): string {
  return `document.querySelector(${JSON.stringify(selector)}) === null`;
}

/**
 * Click a control that is still mounting. Both dialogs here portal in and
 * animate, so a click fired the instant the panel appears can land before its
 * buttons have geometry — wait for the button itself, then let the frame
 * settle before the synthetic press.
 */
async function clickWhenReady(
  app: Awaited<ReturnType<typeof launchTugApp>>,
  selector: string,
): Promise<void> {
  await app.waitForCondition<boolean>(present(selector), { timeoutMs: 8000 });
  await new Promise((r) => setTimeout(r, 150));
  await app.nativeClickAtElement(selector);
}

describe.skipIf(!SHOULD_RUN)("AT0281: Configure Tug… opens the wizard on demand", () => {
  test(
    "idle opens straight through; mid-turn confirms and stops the turn first",
    async () => {
      const app = await launchTugApp({ testName: "at0281-configure-tug-on-demand" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        // ── 1. Idle: straight through, and dismissible ──
        expect(await app.evalJS<boolean>(absent(SETUP))).toBe(true);
        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("configure-tug", {}), null)`,
        );
        await app.waitForCondition<boolean>(present(SETUP), { timeoutMs: 8000 });
        // Nothing to confirm with no work in flight.
        expect(await app.evalJS<boolean>(absent(ALERT))).toBe(true);

        // The steps the user is looking at when they press Done. Radix keeps
        // the panel mounted through its close animation, so the wizard must
        // still read the same on the way out — closing is not a state change
        // to watch happen.
        const labels = async (): Promise<string[]> =>
          JSON.parse(
            await app.evalJS<string>(
              `JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(SETUP_STEP_LABEL)})).map((n) => n.textContent))`,
            ),
          ) as string[];
        const before = await labels();
        expect(before.length, "steps on screen before Done").toBeGreaterThan(0);

        // No row offers a model. Aux model work runs on the user's Claude
        // subscription, so signing in is the only answer that question ever
        // needed — and this is the surface where a resurrected download step
        // would show up first.
        expect(
          before.filter((label) => /on-device|local ai|download/i.test(label)),
          "a model-offer row came back to the wizard",
        ).toEqual([]);

        await clickWhenReady(app, SETUP_DONE);
        let sampled = 0;
        for (let i = 0; i < 40; i += 1) {
          if (await app.evalJS<boolean>(absent(SETUP))) break;
          expect(await labels(), "steps unchanged during the fade out").toEqual(
            before,
          );
          sampled += 1;
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(sampled, "sampled the closing panel at least once").toBeGreaterThan(0);
        await app.waitForCondition<boolean>(absent(SETUP), { timeoutMs: 8000 });

        // ── 2. Mid-turn: the confirm gate ──
        const stopEnabled = async (): Promise<boolean> => {
          const state = await app.menuItemState("session.stop");
          return state.found && state.enabled;
        };
        await app.driveSession("A", { op: "send", text: "hello there" });
        for (let i = 0; i < 60; i += 1) {
          if (await stopEnabled()) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(await stopEnabled(), "turn in flight before Configure Tug…").toBe(true);

        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("configure-tug", {}), null)`,
        );
        // The confirm comes up; the wizard stays shut behind it.
        await app.waitForCondition<boolean>(present(ALERT), { timeoutMs: 8000 });
        expect(await app.evalJS<boolean>(absent(SETUP))).toBe(true);

        await clickWhenReady(app, ALERT_CONFIRM);
        await app.waitForCondition<boolean>(present(SETUP), { timeoutMs: 8000 });

        // Confirming stopped the turn before the wizard covered it.
        for (let i = 0; i < 60; i += 1) {
          if (!(await stopEnabled())) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(await stopEnabled(), "turn stopped by the setup gate").toBe(false);

        await clickWhenReady(app, SETUP_DONE);
        await app.waitForCondition<boolean>(absent(SETUP), { timeoutMs: 8000 });
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0281-configure-tug-on-demand] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
