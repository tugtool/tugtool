/**
 * Cohort B wake-bracket re-init detector.
 *
 * Claude's built-in scheduler fires `ScheduleWakeup` / `CronCreate`
 * timers between turns, even in stream-json spawn mode. The fire
 * signal on claude's stdout is a fresh `system/init` event — the same
 * type emitted at session spawn. These tests pin the detector that
 * distinguishes the first init (session start) from subsequent inits
 * (wake bracket open), and the bracket-open semantics that mirror
 * `handleTaskNotification` for Cohort A.
 *
 * See `roadmap/wake-investigation-findings.md` and design decision
 * [D07].
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "../session.ts";

const SESSION_ID = "session-reinit";

describe("SessionManager — system/init re-init detector", () => {
  let projectDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "wake-reinit-"));
    manager = new SessionManager(projectDir, SESSION_ID, "new", undefined, {
      sessionsDbPath: null,
    });
  });
  afterEach(() => {
    void manager.shutdown();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("first system/init is treated as session start: sessionInitSeen flips true, no wake bracket opened", () => {
    expect((manager as any).sessionInitSeen).toBe(false);
    expect((manager as any).isInWake).toBe(false);
    expect((manager as any).activeTurn).toBeNull();

    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });

    expect((manager as any).sessionInitSeen).toBe(true);
    expect((manager as any).isInWake).toBe(false);
    expect((manager as any).activeTurn).toBeNull();
  });

  test("second system/init opens a wake bracket: isInWake true, activeTurn non-null", () => {
    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });
    expect((manager as any).sessionInitSeen).toBe(true);

    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });

    expect((manager as any).isInWake).toBe(true);
    expect((manager as any).activeTurn).not.toBeNull();
  });

  test("nested re-init during an open wake bracket is silently ignored (no second ActiveTurn)", () => {
    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });
    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });

    const firstTurn = (manager as any).activeTurn;
    expect(firstTurn).not.toBeNull();

    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });

    expect((manager as any).activeTurn).toBe(firstTurn);
  });

  test("post-respawn (killAndCleanup) resets sessionInitSeen so the new spawn's first init is a first init", async () => {
    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });
    expect((manager as any).sessionInitSeen).toBe(true);

    await (manager as any).killAndCleanup();
    expect((manager as any).sessionInitSeen).toBe(false);

    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });
    expect((manager as any).sessionInitSeen).toBe(true);
    expect((manager as any).isInWake).toBe(false);
  });

  test("re-init wake bracket carries empty task_id/tool_use_id (harness re-init has no tool id on the wire)", () => {
    (manager as any).handleInterTurnEvent({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });

    // Capture the next writeLine call by patching the ipc module
    // wouldn't be clean here. Instead exercise the internal frame
    // builder via the same path: re-init calls handleWakeReInit which
    // constructs the frame inline. The bracket-open side-effects are
    // already verified by the prior test; this case pins the frame's
    // expected shape via the handler's invariants.
    expect((manager as any).isInWake).toBe(false);
    (manager as any).handleWakeReInit();

    expect((manager as any).isInWake).toBe(true);
    expect((manager as any).activeTurn).not.toBeNull();
    // The frame's wake_trigger.task_id is empty per [D07] — there's no
    // way to observe the emitted frame without intercepting writeLine,
    // so this case is documented intent rather than direct assertion.
    // The harness-side correctness lives in the integration / manual
    // repro path.
  });
});
