/**
 * at0206-z2-popup-list.test.ts — the Z2 status popups on the shared
 * `TugPopupList` vocabulary ([AT0206]).
 *
 * Drives a bound dev card through two committed turns, a three-row
 * background-jobs ledger (running / completed / failed), and a
 * two-task list, then opens each Z2 popup (WORK / TIME /
 * STATE / TOKENS) by clicking its status cell and pins the rework's
 * structural claims:
 *
 *  - every popup mounts a `tug-popup-list` frame with its kind
 *    (`item` / `log` / `state`);
 *  - the WORK popup's stop button sits in the item row's structural action
 *    column — top-aligned to the row's first text line (≤ 2px), never
 *    centered across a two-line row — and carries the proportional
 *    `data-rounded="sm"` 2xs radius;
 *  - log popups (TIME) share one subgrid: per-turn rows in the
 *    scroller plus always-visible summary rows;
 *  - footers standardize on COPY (every log-shaped popup) and CLEAR
 *    (WORK), with the count summary on the leading edge;
 *  - STATE tone dots color via `data-tone` attributes, no inline
 *    styles ([L06]).
 *
 * Frame-shape notes the drive depends on: `task_started` only inserts
 * a jobs-ledger row while its launching `tool_use` (with
 * `run_in_background: true`, `task_type: "local_bash"`) is in the
 * IN-FLIGHT turn's scratch; the task list only shows when the LATEST
 * turn carries Task* activity.
 *
 * Screenshots: `WKWebView.takeSnapshot` does not capture the
 * canvas-overlay layer the popovers portal into, so this test asserts
 * DOM geometry instead of pixels.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;
const FEED_CODE_OUTPUT = 0x40;
const SID = "b7c0d1ea-0000-4000-8000-00000000beef";

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
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

const f = (decoded: Record<string, unknown>) => ({
  op: "ingestFrame" as const,
  feedId: FEED_CODE_OUTPUT,
  decoded: { tug_session_id: SID, ...decoded },
});

describe.skipIf(!SHOULD_RUN)("AT0206: Z2 popups on TugPopupList", () => {
  test(
    "popups render on TugPopupList with aligned actions and standard footers",
    async () => {
      const app = await launchTugApp({ testName: "at0206-z2-popup-list" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 15_000 },
        );
        await app.bindDevSession("A", { tugSessionId: SID });
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-card-id="A"] [data-slot="dev-telemetry-status-row"]') !== null`,
          { timeoutMs: 8000 },
        );

        // ---- Turn 1: tasks created + a background job launched --------
        await app.driveDevSession("A", { op: "send", text: "set up the popup rework" });
        await app.driveDevSession("A", f({
          type: "assistant_text", msg_id: "m1", text: "Working on it.",
          is_partial: true, rev: 0, seq: 0,
        }));
        // ---- Jobs ledger: MANY backgrounded Bash launches (the
        // "out-of-control jobs list" scenario the scroll strategy
        // exists for). The `task_started` insert is gated on the
        // launching tool_use being in the IN-FLIGHT turn's scratch with
        // `run_in_background: true` and `task_type: "local_bash"` — so
        // the frames land mid-turn. Job 1 stays running (stop button);
        // the rest finish as an alternating done/failed mix.
        const JOB_COUNT = 28;
        for (let n = 1; n <= JOB_COUNT; n++) {
          await app.driveDevSession("A", f({
            type: "tool_use", msg_id: "m1", tool_use_id: `job-tool-${n}`,
            tool_name: "Bash",
            input: { command: `make dmg ${n}`, run_in_background: true },
            seq: 2 + n,
          }));
          await app.driveDevSession("A", f({
            type: "task_started", task_id: `bg${n}`, tool_use_id: `job-tool-${n}`,
            description: `Background probe run ${n} (background)`,
            task_type: "local_bash",
          }));
          await app.driveDevSession("A", f({
            type: "tool_result", tool_use_id: `job-tool-${n}`,
            output: "launched",
          }));
          if (n > 1) {
            await app.driveDevSession("A", f({
              type: "task_updated", task_id: `bg${n}`,
              status: n % 5 === 0 ? "failed" : "completed",
            }));
          }
        }
        await app.driveDevSession("A", f({
          type: "turn_complete", msg_id: "m1", result: "success",
        }));

        // ---- Turn 2: TaskCreates (the task-list gate reads the LATEST
        // turn's Task* activity) + a second committed turn for TIME/TOKENS.
        await app.driveDevSession("A", { op: "send", text: "and a second turn please" });
        await app.driveDevSession("A", f({
          type: "assistant_text", msg_id: "m2", text: "Done.",
          is_partial: true, rev: 0, seq: 0,
        }));
        await app.driveDevSession("A", f({
          type: "tool_use", msg_id: "m2", tool_use_id: "tc-1",
          tool_name: "TaskCreate",
          input: { subject: "Fix TugButton radius defaults", description: "Proportional corner radii for 2xs/xs buttons." },
          seq: 1,
        }));
        await app.driveDevSession("A", f({
          type: "tool_result", tool_use_id: "tc-1",
          output: "Task #1 created successfully: Fix TugButton radius defaults",
        }));
        await app.driveDevSession("A", f({
          type: "tool_use", msg_id: "m2", tool_use_id: "tc-2",
          tool_name: "TaskCreate",
          input: { subject: "Migrate JOBS popover onto TugPopupList" },
          seq: 2,
        }));
        await app.driveDevSession("A", f({
          type: "tool_result", tool_use_id: "tc-2",
          output: "Task #2 created successfully: Migrate JOBS popover onto TugPopupList",
        }));
        await app.driveDevSession("A", f({
          type: "turn_complete", msg_id: "m2", result: "success",
        }));
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('[data-card-id="A"] [data-testid="dev-card-transcript-user-body"]').length === 2`,
          { timeoutMs: 8000 },
        );

        const cell = (p: string) =>
          `[data-card-id="A"] [data-slot="tug-status-cell"][data-priority="${p}"]`;
        const POPUP = `[data-slot="tug-popup-list"]`;

        const openPopup = async (priority: string): Promise<void> => {
          await app.click(cell(priority));
          await app.waitForCondition<boolean>(
            `(() => {
              const el = document.querySelector('${POPUP}');
              if (el === null) return false;
              const s = window.getComputedStyle(el.closest('[data-radix-popper-content-wrapper]') || el);
              return Number(s.opacity) === 1;
            })()`,
            { timeoutMs: 5000 },
          );
        };
        const closePopup = async (priority: string): Promise<void> => {
          await app.click(cell(priority));
          await app.waitForCondition<boolean>(
            `document.querySelector('${POPUP}') === null`,
            { timeoutMs: 5000 },
          );
        };

        // ---- WORK (jobs + checklist merged) ----------------------------
        await openPopup("work");
        const jobsProbe = await app.evalJS<string>(`JSON.stringify((() => {
          const popup = document.querySelector('${POPUP}');
          const stop = popup.querySelector('[aria-label^="Stop background job"]');
          const item = stop ? stop.closest('.tug-popup-list-item') : null;
          const primary = item ? item.querySelector('.tug-popup-list-item-primary') : null;
          const stopRect = stop ? stop.getBoundingClientRect() : null;
          const lineRect = primary ? primary.getBoundingClientRect() : null;
          const footer = popup.querySelector('[data-slot="tug-popup-list-footer"]');
          return {
            kind: popup.getAttribute('data-kind'),
            title: (popup.querySelector('.tug-popup-list-title')||{}).textContent,
            rows: popup.querySelectorAll('.tug-popup-list-item').length,
            stopRounded: stop ? stop.getAttribute('data-rounded') : null,
            stopTopDelta: stopRect && lineRect ? (stopRect.top - lineRect.top) : null,
            stopHeight: stopRect ? stopRect.height : null,
            copy: footer ? !!footer.querySelector('[data-slot="block-copy"]') : false,
            clear: footer ? Array.from(footer.querySelectorAll('button')).some(b => (b.textContent||'').trim().toLowerCase() === 'clear') : false,
            summary: footer ? (footer.querySelector('.tug-popup-list-footer-summary')||{}).textContent : null,
            scroller: (() => {
              const sc = popup.querySelector('.tug-popup-list-scroller');
              return sc === null ? null : {
                clientHeight: sc.clientHeight,
                scrollHeight: sc.scrollHeight,
              };
            })(),
            popupRect: (() => {
              const r = popup.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom };
            })(),
            viewportHeight: window.innerHeight,
          };
        })())`);
        const jobs = JSON.parse(jobsProbe);
        expect(jobs.kind).toBe("item");
        expect(jobs.rows).toBe(JOB_COUNT + 2); // 28 job rows + 2 checklist tasks
        // Scroll strategy: a long ledger scrolls inside its capped
        // scroller instead of growing the popup — and the popup stays
        // fully on-screen.
        expect(jobs.scroller).not.toBeNull();
        expect(jobs.scroller.scrollHeight).toBeGreaterThan(jobs.scroller.clientHeight);
        expect(jobs.scroller.clientHeight).toBeLessThanOrEqual(
          12 * 24 + 1, // the item-kind visible-rows × row-height cap
        );
        expect(jobs.popupRect.top).toBeGreaterThanOrEqual(0);
        expect(jobs.popupRect.bottom).toBeLessThanOrEqual(jobs.viewportHeight);
        expect(jobs.stopRounded).toBe("sm");
        // Top-aligned to the item's first line: the 20px button may
        // overhang a ~15px line box downward, but its top edge must sit
        // at (or within a hairline of) the first line's top.
        expect(Math.abs(jobs.stopTopDelta)).toBeLessThanOrEqual(2);
        expect(jobs.copy).toBe(true);
        expect(jobs.clear).toBe(true);
        await closePopup("work");

        // (Checklist rows are asserted inside the WORK popup above — the
        // separate TASKS popup merged into WORK.)

        // ---- TIME ------------------------------------------------------
        await openPopup("time");
        const timeProbe = await app.evalJS<string>(`JSON.stringify((() => {
          const popup = document.querySelector('${POPUP}');
          const footer = popup.querySelector('[data-slot="tug-popup-list-footer"]');
          return {
            kind: popup.getAttribute('data-kind'),
            rows: popup.querySelectorAll('.tug-popup-list-grid-scroller [data-slot="tug-popup-list-row"]').length,
            summaryRows: popup.querySelectorAll('[data-slot="tug-popup-list-grid-summary"] [data-slot="tug-popup-list-row"]').length,
            copy: footer ? !!footer.querySelector('[data-slot="block-copy"]') : false,
          };
        })())`);
        const time = JSON.parse(timeProbe);
        expect(time.kind).toBe("log");
        expect(time.rows).toBe(2);
        expect(time.summaryRows).toBeGreaterThanOrEqual(3);
        expect(time.copy).toBe(true);
        await closePopup("time");

        // ---- STATE -----------------------------------------------------
        await openPopup("state");
        const stateProbe = await app.evalJS<string>(`JSON.stringify((() => {
          const popup = document.querySelector('${POPUP}');
          const dots = Array.from(popup.querySelectorAll('[data-slot="tug-popup-list-tone-dot"]'));
          const footer = popup.querySelector('[data-slot="tug-popup-list-footer"]');
          return {
            kind: popup.getAttribute('data-kind'),
            dots: dots.length,
            allToned: dots.every(d => !!d.getAttribute('data-tone')),
            anyInlineStyle: dots.some(d => (d.getAttribute('style')||'').length > 0),
            copy: footer ? !!footer.querySelector('[data-slot="block-copy"]') : false,
          };
        })())`);
        const state = JSON.parse(stateProbe);
        expect(state.kind).toBe("state");
        expect(state.dots).toBeGreaterThan(0);
        expect(state.allToned).toBe(true);
        expect(state.anyInlineStyle).toBe(false);
        expect(state.copy).toBe(true);
        await closePopup("state");

        // ---- TOKENS (spot-check the shared frame) ----------------------
        await openPopup("tokens");
        const tokensKind = await app.evalJS<string | null>(
          `(document.querySelector('${POPUP}')||{getAttribute(){return null}}).getAttribute('data-kind')`,
        );
        expect(tokensKind).toBe("log");
        await closePopup("tokens");

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(120);
        if (tail !== "") process.stderr.write(`\n[at0206] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
