/**
 * at0171-session-menu-card-type.test.ts — Session-menu card-type and
 * session-bound validation.
 *
 * The Session menu is disabled-not-hidden: every `session.*` item
 * requires a frontmost session card, and below that tier:
 *
 *   - `session.focusPrompt` — any frontmost session card (bound or not).
 *   - `session.stop` — an interruptible turn (`canInterrupt`).
 *   - `session.rewind` — a bound session with committed turns.
 *   - everything else — a bound session.
 *
 * Two states here: an UNBOUND session card (picker stage — no dev block
 * rides menuState, so only Focus Prompt and the tier-3-only items
 * light up) and a BOUND, idle session (command surfaces enabled, Stop
 * and Rewind still gated). The non-dev negative half (every surface
 * disabled with a gallery card frontmost) is covered by the deck-tier
 * test; live turn/transcript transitions by the live-state test.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

function sessionDeckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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

/** Poll the validated menu-item state until it matches `wantEnabled`. */
async function waitMenuEnabled(
  app: App,
  identifier: string,
  wantEnabled: boolean,
  timeoutMs = 8000,
): Promise<{ found: boolean; enabled?: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let last: { found: boolean; enabled?: boolean } = { found: false };
  while (Date.now() < deadline) {
    last = await app.menuItemState(identifier);
    if (last.found && last.enabled === wantEnabled) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

async function expectEnabled(app: App, identifier: string, want: boolean): Promise<void> {
  const state = await waitMenuEnabled(app, identifier, want);
  expect(state.found, `${identifier} must exist`).toBe(true);
  expect(state.enabled, `${identifier} enabled=${want}`).toBe(want);
}

describe.skipIf(!SHOULD_RUN)("AT0171: Session-menu card-type validation", () => {
  test(
    "unbound session card: Focus Prompt and tier-3 items enabled; bound-session items disabled",
    async () => {
      const app = await launchTugApp({ testName: "at0171-unbound" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: sessionDeckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );

        // Card-type tier passes (session card frontmost)…
        await expectEnabled(app, "session.focusPrompt", true);
        await expectEnabled(app, "file.exportTranscript", true);
        await expectEnabled(app, "help.shortcuts", true);
        // …but with no binding there is no dev block: the
        // session-state tier gates everything else off.
        await expectEnabled(app, "session.stop", false);
        await expectEnabled(app, "session.model", false);
        await expectEnabled(app, "session.new", false);
        await expectEnabled(app, "session.rewind", false);
        await expectEnabled(app, "session.permissionMode.default", false);
        await expectEnabled(app, "edit.copyLastResponse", false);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0171-unbound] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "bound idle session: command surfaces enabled; Stop and Rewind stay gated",
    async () => {
      const app = await launchTugApp({ testName: "at0171-bound-idle" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: sessionDeckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", { tugSessionId: "at0171-session" });
        await app.awaitEngineReady("A");

        await expectEnabled(app, "session.focusPrompt", true);
        await expectEnabled(app, "session.new", true);
        await expectEnabled(app, "session.resume", true);
        await expectEnabled(app, "session.rename", true);
        await expectEnabled(app, "session.model", true);
        await expectEnabled(app, "session.effort", true);
        await expectEnabled(app, "session.permissionMode.default", true);
        await expectEnabled(app, "session.permissionMode.cycle", true);
        await expectEnabled(app, "session.permissionRules", true);
        await expectEnabled(app, "session.compact", true);
        await expectEnabled(app, "session.addDir", true);
        await expectEnabled(app, "session.diff", true);
        await expectEnabled(app, "session.context", true);
        await expectEnabled(app, "session.skills", true);
        await expectEnabled(app, "session.agents", true);
        await expectEnabled(app, "session.hooks", true);
        await expectEnabled(app, "session.memory", true);

        // Idle: nothing to interrupt; empty transcript: nothing to
        // rewind to or copy.
        await expectEnabled(app, "session.stop", false);
        await expectEnabled(app, "session.rewind", false);
        await expectEnabled(app, "edit.copyLastResponse", false);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0171-bound-idle] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
