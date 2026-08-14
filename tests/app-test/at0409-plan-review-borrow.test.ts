/**
 * at0409-plan-review-borrow.test.ts — the plan review borrows a model for one
 * turn and gives it back, in the real app.
 *
 * The whole signal path is real: the test runs `tugutil plan review-request`
 * against the launched instance, tugcast broadcasts `plan_review_request`,
 * `action-dispatch` resolves the session to card A, and the card's controller
 * acts. Nothing about the frame is simulated.
 *
 * The beat this exists to pin is the **park**. `devise` fires the signal from
 * inside its own turn, so the request always lands while a turn is in flight —
 * and a machine that treated that as a gate failure would refuse the review on
 * the happy path. So a turn is deliberately in flight when the request
 * arrives, and the test asserts nothing happens; then the turn settles and the
 * review goes out.
 *
 * The turn lifecycle is driven by injected frames rather than a live claude:
 * this is a test about a control acting on a lifecycle, and the lifecycle's
 * published phase is the whole input. The one genuine Opus run is a manual
 * checkpoint, not an app-test.
 *
 * Two assertions are about what must NOT move. The submitted turn is checked
 * for the **command atom**, never for a literal `/tugplug:review-plan …`
 * string — `buildCommandSubmission` puts the name in the atom and the text
 * carries only the placeholder plus the tail, so a string assertion would fail
 * on a working implementation. And `dev.model/A` is read before and after the
 * whole cycle and must be byte-identical: the borrow is a loan, and a loan
 * that rewrote the card's remembered model would turn a crash mid-review into
 * a durable lie about what the card runs.
 *
 * @covers tugdeck/src/lib/plan-review-controller.ts
 * @covers tugdeck/src/lib/plan-review-request-store.ts
 * @covers tugdeck/src/lib/use-model.ts
 * @covers tugdeck/src/action-dispatch.ts
 * @covers tugrust/crates/tugcast/src/server.rs
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";

import { launchTugApp, note, type App } from "./_harness";
import { tugutilPath } from "./dash-fixture";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SID = "at0409-session";
const CARD = '[data-card-id="A"]';
const CHIP_VALUE = `${CARD} [data-slot="ai-chip"] [data-slot="ai-chip-value"]`;
const USER_ROWS = `${CARD} [data-testid="session-card-transcript-user-body"]`;
const FEED_CODE_OUTPUT = 0x40;

const PROJECT_DIR = realpathSync(resolve(import.meta.dir, "..", ".."));

/**
 * A catalog whose `default` row names no concrete model of its own, so
 * `sonnet` and `opus` are distinct catalog rows and a borrow between them is a
 * real change rather than the [P03] no-op.
 */
function capabilities() {
  return {
    type: "session_capabilities",
    models: [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Chosen for you",
      },
      { value: "opus", displayName: "Opus 5", description: "Opus 5" },
      { value: "sonnet", displayName: "Sonnet 5", description: "Sonnet 5" },
    ],
    commands: [],
    agents: [],
    ipc_version: 2,
  };
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 680 },
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

/** The card's model chip, as the user reads it. */
const chipText = (app: App): Promise<string> =>
  app.evalJS<string>(
    `(document.querySelector(${JSON.stringify(CHIP_VALUE)})?.textContent ?? "").trim()`,
  );

/**
 * The persisted per-card selector, read through the same defaults endpoint the
 * deck writes it with. The body is returned as served text so the before/after
 * comparison is on the bytes, not on a re-parse of them. `fetch` is async and
 * `evalJS` evaluates an expression, so the answer is stashed on `window` and
 * polled — the shape the other defaults-reading app-tests use.
 */
async function persistedModel(app: App, tag: string): Promise<string> {
  const slot = `__at0409_${tag}`;
  await app.evalJS(`(() => {
    window.${slot} = undefined;
    fetch("/api/defaults/dev.model/A")
      .then((r) => r.text())
      .then((t) => { window.${slot} = t; })
      .catch((e) => { window.${slot} = "ERR:" + String(e); });
  })()`);
  return app.waitForCondition<string>(
    `window.${slot} === undefined ? false : window.${slot}`,
    { timeoutMs: 8000 },
  );
}

/**
 * Settle whatever turn is in flight, the way the wire would: a reply, then the
 * completion. The whole sequence matters — a bare `turn_complete` for a msg_id
 * the store never saw open does not commit the turn, so the phase would never
 * return to idle and the parked request would never get its window.
 */
async function settleTurn(app: App, msgId: string): Promise<void> {
  const frame = (decoded: Record<string, unknown>): Promise<void> =>
    app.driveSession("A", {
      op: "ingestFrame",
      feedId: FEED_CODE_OUTPUT,
      decoded: { tug_session_id: SID, ...decoded },
    });
  await frame({ type: "content_block_start", msg_id: msgId, block_index: 0, kind: "text" });
  await frame({
    type: "assistant_text",
    msg_id: msgId,
    block_index: 0,
    text: "done",
    is_partial: false,
  });
  await frame({ type: "turn_complete", msg_id: msgId, result: "success" });
}

describe.skipIf(!SHOULD_RUN)("AT0409: the plan review's model borrow", () => {
  test(
    "a request arriving mid-turn parks, then borrows, submits, and gives the model back",
    async () => {
      const scratch = mkdtempSync(join(tmpdir(), "at0409-"));
      const planPath = join(scratch, "plan.md");
      writeFileSync(planPath, "## A plan {#a-plan}\n\n### Execution Steps {#execution-steps}\n");

      const app = await launchTugApp({ testName: "at0409-plan-review-borrow" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", { tugSessionId: SID, projectDir: PROJECT_DIR });
        await app.awaitEngineReady("A", { timeoutMs: 15000 });

        // A card that remembers Sonnet, running Sonnet.
        await app.evalJS(`(() => {
          window.__at0409_seeded = false;
          fetch("/api/defaults/dev.model/A", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "string", value: "sonnet" }),
          })
            .then(() => { window.__at0409_seeded = true; })
            .catch(() => { window.__at0409_seeded = true; });
        })()`);
        await app.waitForCondition<boolean>(`window.__at0409_seeded === true`, {
          timeoutMs: 8000,
        });
        await app.ingestSessionMetadata("A", capabilities());
        await app.ingestSessionMetadata("A", {
          type: "system_metadata",
          model: "sonnet",
          ipc_version: 2,
        });
        await app.waitForCondition<boolean>(
          `(document.querySelector(${JSON.stringify(CHIP_VALUE)})?.textContent ?? "").indexOf("Sonnet") !== -1`,
          { timeoutMs: 10000 },
        );
        const before = await persistedModel(app, "before");
        note("at0409 persisted model before", before);

        // ── A turn is in flight, as it always is when the signal fires ────
        await app.driveSession("A", { op: "send", text: "devise the plan" });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length === 1`,
          { timeoutMs: 8000 },
        );

        // ── The real signal, from the real CLI ───────────────────────────
        const run = Bun.spawnSync(
          [
            tugutilPath(PROJECT_DIR),
            "plan",
            "review-request",
            "--plan",
            planPath,
            "--session",
            SID,
            "--instance",
            app.instanceId,
          ],
          { cwd: PROJECT_DIR, env: { ...process.env } },
        );
        note("at0409 review-request", run.stdout.toString() + run.stderr.toString());
        expect(run.exitCode).toBe(0);

        // It parks: no second turn, and the chip has not moved.
        await new Promise((r) => setTimeout(r, 1500));
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length`,
          ),
          "a request that arrives mid-turn must park, not submit",
        ).toBe(1);
        expect(await chipText(app)).toContain("Sonnet");

        // ── The devise turn settles: borrow, announce, submit ────────────
        await settleTurn(app, "m-devise");
        await new Promise((r) => setTimeout(r, 1500));
        note(
          "at0409 after settle",
          await app.evalJS<string>(
            `JSON.stringify({
               userRows: document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length,
               chip: (document.querySelector(${JSON.stringify(CHIP_VALUE)})?.textContent ?? ""),
               bulletins: Array.from(document.querySelectorAll("[data-sonner-toast]")).map(n => (n.textContent ?? "").slice(0, 160)),
             })`,
          ),
        );
        // Exactly one review turn. The borrow's own `model_change` notifies the
        // session store re-entrantly, and a machine still reading as `parked`
        // across that beat submits the review twice.
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length`,
          ),
        ).toBe(2);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length >= 2`,
          { timeoutMs: 10000 },
        );
        await app.waitForCondition<boolean>(
          `(document.querySelector(${JSON.stringify(CHIP_VALUE)})?.textContent ?? "").indexOf("Opus") !== -1`,
          { timeoutMs: 10000 },
        );

        // The submitted turn leads with the command ATOM and carries the plan
        // path as its tail. The transcript renders an atom as a baked
        // `svg.tug-atom-chip` whose `aria-label` is the chip's own text, so
        // that label is the atom — asserted instead of a literal
        // "/tugplug:review-plan …" string, which `submission.text` never
        // contains (the name lives only in the atom).
        const submitted = await app.evalJS<{
          chipLabel: string | null;
          text: string;
        }>(
          `(() => {
             const rows = document.querySelectorAll(${JSON.stringify(USER_ROWS)});
             const row = rows[rows.length - 1];
             const chip = row.querySelector("svg.tug-atom-chip");
             return {
               chipLabel: chip === null ? null : chip.getAttribute("aria-label"),
               text: (row.textContent ?? "").trim(),
             };
           })()`,
        );
        note("at0409 submitted row", JSON.stringify(submitted));
        expect(submitted.chipLabel).toBe("/tugplug:review-plan");
        expect(submitted.text).toContain(planPath);

        const shot = await app.screenshot();
        note("at0409 the review turn on the borrowed model", shot.path);

        // ── That turn settles: the model goes back ───────────────────────
        await settleTurn(app, "m-review");
        await app.waitForCondition<boolean>(
          `(document.querySelector(${JSON.stringify(CHIP_VALUE)})?.textContent ?? "").indexOf("Sonnet") !== -1`,
          { timeoutMs: 10000 },
        );

        // ── And the loan never touched what the card remembers ───────────
        const after = await persistedModel(app, "after");
        note("at0409 persisted model after", after);
        expect(after).toBe(before);
      } finally {
        await app.close();
        rmSync(scratch, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
