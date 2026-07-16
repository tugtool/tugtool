/**
 * at0172-session-menu-live-state.test.ts — Session-menu validation
 * tracks live session state.
 *
 * Three live transitions on one bound session card:
 *
 *   1. **Permission-mode checkmark** — the radio submenu's `.on` state
 *      (snapshot `state`, refreshed during the validation sweep)
 *      starts on Default; dispatching the menu's own
 *      `set-permission-mode {mode}` control action moves the chip AND
 *      the checkmark to Plan.
 *   2. **Stop** — disabled idle, enabled the moment a turn is in
 *      flight (`canInterrupt`), disabled again after `turn_complete`.
 *   3. **Copy Last Response / Rewind** — flip enabled once the
 *      transcript commits a turn carrying an assistant message.
 *   4. **Permission Mode radios + Cycle** — the inverse of Stop: enabled
 *      idle, disabled mid-turn (`canChangeSettings` / `canSubmit`) so a
 *      mode change can never race the running turn, re-enabled at idle.
 *
 * The turn is driven through the real `CodeSessionStore` wire path
 * (`driveSession` send + ingestFrame — the at0099 pattern); the
 * mode change goes through `dispatchControlAction`, byte-identical to
 * the control frame the Swift menu item posts.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0172-session";
const FEED_CODE_OUTPUT = 0x40;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const MODE_CHIP = `${CARD} [data-slot="permission-mode-chip"]`;

function deckShape() {
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

function chipTitleExpr(): string {
  return `(function(){ var e = document.querySelector(${JSON.stringify(MODE_CHIP)}); return e ? e.getAttribute("title") : null; })()`;
}

/** Poll until the item's validated enabled state matches. */
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

/** Poll until the item's checkmark (`state`, 1 = on) matches. */
async function waitMenuChecked(
  app: App,
  identifier: string,
  wantChecked: boolean,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastState: number | undefined;
  while (Date.now() < deadline) {
    const item = await app.menuItemState(identifier);
    if (item.found) {
      lastState = item.state;
      if ((item.state === 1) === wantChecked) return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(
    (lastState === 1) === wantChecked,
    `${identifier} checked=${wantChecked} (last state=${lastState})`,
  ).toBe(true);
}

describe.skipIf(!SHOULD_RUN)("AT0172: Session-menu live-state validation", () => {
  test(
    "checkmark follows the mode; Stop tracks the turn; copy/rewind flip on a committed turn",
    async () => {
      const app = await launchTugApp({ testName: "at0172-live-state" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        // ── 1. Permission-mode checkmark ──
        // Fresh session: chip and checkmark both read Default.
        await app.waitForCondition<boolean>(
          `${chipTitleExpr()} === "Permission mode: Default"`,
          { timeoutMs: 8000 },
        );
        await waitMenuChecked(app, "session.permissionMode.default", true);
        await waitMenuChecked(app, "session.permissionMode.plan", false);

        // Focus the card so the key-card-scoped dispatch resolves it,
        // then fire the exact control action the menu item posts.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("set-permission-mode", { mode: "plan" }), null)`,
        );
        await app.waitForCondition<boolean>(
          `${chipTitleExpr()} === "Permission mode: Plan"`,
          { timeoutMs: 8000 },
        );
        await waitMenuChecked(app, "session.permissionMode.plan", true);
        await waitMenuChecked(app, "session.permissionMode.default", false);

        // ── 2 + 3. Stop across a turn; copy/rewind on commit ──
        await expectEnabled(app, "session.stop", false);
        await expectEnabled(app, "edit.copyLastResponse", false);
        await expectEnabled(app, "session.rewind", false);

        const frame = (decoded: Record<string, unknown>) =>
          app.driveSession("A", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: { tug_session_id: SID, ...decoded },
          });

        // A turn in flight: canInterrupt → Stop enables.
        await app.driveSession("A", { op: "send", text: "hello there" });
        await expectEnabled(app, "session.stop", true);

        // The Mode control locks mid-turn: the Permission Mode radios and
        // Cycle gate on canChangeSettings (canSubmit) exactly like the Z4B
        // chips, so a mode change can never race the running turn.
        await expectEnabled(app, "session.permissionMode.plan", false);
        await expectEnabled(app, "session.permissionMode.cycle", false);

        // Commit the turn with an assistant message.
        await frame({ type: "prompt_anchor", promptUuid: "uuid-1" });
        await frame({ type: "content_block_start", msg_id: "m1", block_index: 0, kind: "text" });
        await frame({ type: "assistant_text", msg_id: "m1", block_index: 0, text: "hi", is_partial: false });
        await frame({ type: "turn_complete", msg_id: "m1", result: "success" });

        // Back to idle: Stop gates off; the committed transcript
        // enables Copy Last Response and Rewind; the Mode control unlocks.
        await expectEnabled(app, "session.stop", false);
        await expectEnabled(app, "session.permissionMode.plan", true);
        await expectEnabled(app, "session.permissionMode.cycle", true);
        await expectEnabled(app, "edit.copyLastResponse", true);
        await expectEnabled(app, "session.rewind", true);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0172-live-state] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
