/**
 * at0320-app-test-ask-dialog.test.ts — a question raised from outside the turn
 * stream reaches the Session card, and the answer reaches the blocked caller.
 *
 * ## Why this exists
 *
 * `tugutil host ask` exists so a command-line tool can get the developer's
 * consent before doing something they will feel — an app-test run that seizes
 * the screen being the case it was built for. The whole value is in the round
 * trip: a real process blocks, a real dialog appears in the real app, a real
 * click releases it. Each half is unit-tested on its own side (`/api/ask`
 * against a live socket in `server.rs`, the store's routing in
 * `pending-ask-store.test.ts`), but only this test proves they meet.
 *
 * The properties under test:
 *   - the question reaches the focused session's card with no `sessionId`
 *     given, which is the terminal case;
 *   - the caller's text renders, but under the app's own provenance chrome, so
 *     a question arriving over loopback cannot pose as an app prompt;
 *   - answering it releases the caller with the chosen option's value;
 *   - the composer stays live while the dialog is up — the ask is a lifecycle
 *     overlay, not a turn phase, and a session with no turn must not end up
 *     with a dead composer and a live Stop button.
 *
 * This test runs in the background like everything else — it takes no screen,
 * so it carries no `@foreground`.
 *
 * @covers tugdeck/src/lib/pending-ask-store.ts
 * @covers tugdeck/src/components/tugways/chrome/session-app-test-ask-dialog.tsx
 * @covers tugdeck/src/components/tugways/chrome/session-app-test-ask-dialog.css
 * @covers tugdeck/src/lib/code-session-store/lifecycle-state.ts
 * @covers tugrust/crates/tugcast/src/server.rs
 * @covers tugrust/crates/tugutil/src/commands/ask.rs
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0320-session";
const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const TUGUTIL = resolve(REPO_ROOT, "tugrust/target/debug/tugutil");

const DIALOG = '[data-slot="session-app-test-ask-dialog"]';

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

/**
 * Start `tugutil host ask` without waiting for it. The process blocks until the
 * dialog is answered, which is the whole point — awaiting it here would
 * deadlock the test against itself.
 */
function startAsk(instanceId: string) {
  return Bun.spawn(
    [
      TUGUTIL,
      "host",
      "ask",
      "--instance",
      instanceId,
      "--title",
      "2 of 5 app-tests will take over the screen",
      "--description",
      "at0145-permission-dialog-keyboard, at0165-activation-first-responder",
      "--option",
      "run-all:Run all 5:Includes the 2 that take the screen",
      "--option",
      "background:Run the 3 background tests:Skips the 2 that take the screen",
      "--option",
      "cancel:Cancel:Run nothing",
      "--timeout-secs",
      "60",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      cwd: REPO_ROOT,
      // How the real caller runs: the session id comes from the environment
      // the Session card's shell already exports.
      env: { ...process.env, TUG_SESSION_ID: SID },
    },
  );
}

describe.skipIf(!SHOULD_RUN)("at0320 — ask dialog round trip", () => {
  let app: App;

  beforeAll(async () => {
    app = await launchTugApp();
    await app.enableDeckTrace(true);
    await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
    await app.waitForCondition<boolean>(
      `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
    );
    await app.bindSession("A", { tugSessionId: SID });
    await app.awaitEngineReady("A");
  });

  afterAll(async () => {
    await app?.close();
  });

  test(
    "a question reaches the card, and the answer reaches the caller",
    async () => {
      const proc = startAsk(app.instanceId);

      // --- it arrives -------------------------------------------------
      try {
        await app.waitForCondition<boolean>(
          `!!document.querySelector('${DIALOG}')`,
          { timeoutMs: 15_000 },
        );
      } catch (error) {
        // The CLI's own diagnostics say far more about why a question never
        // landed than "the selector never matched" does.
        proc.kill();
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`dialog never appeared; tugutil host ask said: ${stderr}`, {
          cause: error,
        });
      }

      const rendered = await app.evalJS<{
        title: string;
        provenance: string;
        detail: string;
        options: string[];
      }>(`(() => {
        const root = document.querySelector('${DIALOG}');
        const opts = [...root.querySelectorAll('[data-slot="tug-inline-dialog-options"] button')];
        return {
          title: root.querySelector('.tug-inline-dialog-title')?.textContent ?? '',
          provenance: root.querySelector('.session-app-test-ask-dialog-provenance')?.textContent ?? '',
          detail: root.querySelector('.session-app-test-ask-dialog-detail')?.textContent ?? '',
          options: opts.map((b) => b.textContent ?? ''),
        };
      })()`);

      expect(
        rendered.title,
        "ARRIVES: the caller's title is the dialog's title",
      ).toContain("2 of 5 app-tests");
      expect(
        rendered.detail,
        "ARRIVES: the caller's detail text renders",
      ).toContain("at0145-permission-dialog-keyboard");
      // The impersonation guard: the caller's text never occupies the whole
      // surface — the app's own provenance line sits above it.
      expect(
        rendered.provenance,
        "PROVENANCE: app-owned chrome names the question's origin",
      ).toContain("command on this machine");
      expect(rendered.options, "ARRIVES: all three choices render").toHaveLength(3);

      // --- it does not masquerade as a turn ---------------------------
      // The regression this dialog's design exists to prevent. Routing the ask
      // through the `awaiting_approval` phase — the obvious way to reuse the
      // existing Awaiting plumbing — would flip Z5 to the disabled
      // `awaiting-user` button on a session with no turn running at all,
      // leaving a dead composer and a Stop button with nothing to stop. The
      // ask is an overlay instead, so Z5 must be untouched.
      const submitMode = await app.evalJS<string | null>(
        `(function(){
          var el = document.querySelector(
            '[data-card-id="A"] .tug-prompt-entry-submit-button');
          return el === null ? null : el.getAttribute("data-mode");
        })()`,
      );
      expect(
        submitMode,
        "OVERLAY: Z5 stays an enabled Submit — the ask is not a turn phase",
      ).toBe("submit");

      // --- answering it releases the caller ---------------------------
      await app.evalJS(`(() => {
        const root = document.querySelector('${DIALOG}');
        const opts = [...root.querySelectorAll('[data-slot="tug-inline-dialog-options"] button')];
        opts[1].click();
      })()`);
      await app.evalJS(`(() => {
        const root = document.querySelector('${DIALOG}');
        [...root.querySelectorAll('button')]
          .find((b) => (b.textContent ?? '').includes('Continue'))
          .click();
      })()`);

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      expect(proc.exitCode, "RELEASED: the caller exits 0").toBe(0);
      expect(
        stdout.trim(),
        "RELEASED: stdout carries exactly the chosen option's value",
      ).toBe("background");

      // --- and the dialog goes away -----------------------------------
      await app.waitForCondition<boolean>(
        `!document.querySelector('${DIALOG}')`,
        { timeoutMs: 5_000 },
      );
    },
    TEST_TIMEOUT_MS,
  );
});
