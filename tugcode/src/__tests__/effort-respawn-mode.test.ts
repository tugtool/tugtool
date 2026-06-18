/**
 * effort-respawn-mode.test.ts — the spawn mode a live setting change (effort /
 * add-dir) picks when it respawns the session in place.
 *
 * Claude writes a session's JSONL only after a turn lands, and rejects
 * `--session-id` for an id that already exists. So `SessionManager.liveRespawnMode()`
 * must match the on-disk reality on both ends, or the respawned process dies
 * immediately and the next submit surfaces "Claude process stream ended
 * unexpectedly":
 *
 *   - fresh session, no committed turn → `--session-id` (nothing to resume)
 *   - fresh session, turn committed     → `--resume`   (history exists)
 *   - session restored from disk        → `--resume`   (history exists)
 *
 * `liveRespawnId()` then resolves the id: the tug id for a fresh re-create, the
 * resume id (a forked session's rotated claude id) for a resume.
 */

import { describe, expect, test } from "bun:test";
import { SessionManager } from "../session.ts";

const SID = "11111111-1111-1111-1111-111111111111";
const CLAUDE_ID = "22222222-2222-2222-2222-222222222222";

function manager(
  sessionMode: "new" | "resume" = "new",
  resumeSessionId?: string,
): SessionManager {
  return new SessionManager(
    "/tmp/tugcode-effort-respawn-" + Date.now(),
    SID,
    sessionMode,
    resumeSessionId,
    { sessionsDbPath: null },
  );
}

describe("liveRespawnMode / liveRespawnId", () => {
  test("fresh session, no committed turn → re-create under --session-id", () => {
    const m = manager("new") as any;
    expect(m.claudeReceivedInput).toBe(false);
    expect(m.liveRespawnMode()).toBe("session-id");
    expect(m.liveRespawnId("session-id")).toBe(SID);
  });

  test("fresh session, turn committed → --resume the tug id", () => {
    const m = manager("new") as any;
    m.claudeReceivedInput = true;
    expect(m.liveRespawnMode()).toBe("resume");
    expect(m.liveRespawnId("resume")).toBe(SID);
  });

  test("restored session (resume mode, no input yet) → --resume, not --session-id", () => {
    // The regression: a restored session has history on disk but hasn't seen a
    // message this process, so the input proxy alone would wrongly re-create it
    // and collide ("is already in use").
    const m = manager("resume") as any;
    expect(m.claudeReceivedInput).toBe(false);
    expect(m.liveRespawnMode()).toBe("resume");
    expect(m.liveRespawnId("resume")).toBe(SID);
  });

  test("forked/resumed session → --resume the rotated claude id", () => {
    const m = manager("resume", CLAUDE_ID) as any;
    expect(m.liveRespawnMode()).toBe("resume");
    expect(m.liveRespawnId("resume")).toBe(CLAUDE_ID);
  });
});
