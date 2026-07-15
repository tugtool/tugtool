/**
 * Live ordering-armed capture of the post-compaction summary event ([P08]).
 *
 * On 2.1.207 the live stream carries, mid-turn: a `system`/`compact_boundary`
 * event, then a synthetic `user` event whose `message.content` is the summary
 * as a plain string (NO `isCompactSummary` flag on the wire), then the
 * `<local-command-stdout>Compacted</local-command-stdout>` echo, then `result`.
 * `routeTopLevelEvent` arms on the boundary and captures the next qualifying
 * synthetic user string as a `compact_summary` frame, disarming after.
 *
 * These drive the pure `routeTopLevelEvent` directly, threading the armed
 * state through `ctx.pendingCompactSummary` / the returned
 * `pendingCompactSummary` exactly as `dispatchEventToTurn` does live.
 */

import { describe, test, expect } from "bun:test";

import { routeTopLevelEvent } from "../session.ts";
import type { EventMappingContext } from "../session.ts";

const baseCtx = (): EventMappingContext => ({ msgId: "m1", seq: 1, rev: 0 });

/** Verbatim-shaped live summary string (Claude Code's continuation framing). */
const SUMMARY =
  "This session is being continued from a previous conversation that ran " +
  "out of context. The summary below covers the earlier portion.\n\nSummary:\n" +
  "1. Primary Request and Intent: fun facts about numbers 1-8.";

const boundaryEvent = (): Record<string, unknown> => ({
  type: "system",
  subtype: "compact_boundary",
  session_id: "s1",
  uuid: "b-uuid",
  compact_metadata: { trigger: "manual", pre_tokens: 786 },
});

const syntheticUserString = (content: string): Record<string, unknown> => ({
  type: "user",
  isReplay: false,
  isSynthetic: true,
  message: { role: "user", content },
});

const resultEvent = (): Record<string, unknown> => ({
  type: "result",
  subtype: "success",
  session_id: "s1",
});

describe("routeTopLevelEvent — live compaction summary capture", () => {
  test("boundary arms the capture and emits the boundary frame", () => {
    const res = routeTopLevelEvent(boundaryEvent(), baseCtx());
    const boundaries = res.messages.filter((m) => m.type === "compact_boundary");
    expect(boundaries).toHaveLength(1);
    expect(res.pendingCompactSummary).toBe(true);
  });

  test("full live sequence yields exactly one compact_summary with the summary string", () => {
    // Replay the live sequence the way dispatchEventToTurn does: seed each
    // call's ctx.pendingCompactSummary from the prior call's returned value.
    let armed = false;
    const summaries: string[] = [];
    const route = (event: Record<string, unknown>) => {
      const ctx = { ...baseCtx(), pendingCompactSummary: armed };
      const res = routeTopLevelEvent(event, ctx);
      if (res.pendingCompactSummary !== undefined) armed = res.pendingCompactSummary;
      for (const m of res.messages) {
        if (m.type === "compact_summary") summaries.push(m.summary);
      }
    };

    route(boundaryEvent());
    expect(armed).toBe(true);
    route(syntheticUserString(SUMMARY));
    route(syntheticUserString("<local-command-stdout>Compacted </local-command-stdout>"));
    route(resultEvent());

    expect(summaries).toEqual([SUMMARY]);
    expect(armed).toBe(false);
  });

  test("goal-feedback synthetic events never translate to compact_summary, armed or not", () => {
    const ctx = { ...baseCtx(), pendingCompactSummary: true };
    const feedback =
      "Stop hook feedback:\n[the condition holds]: not yet satisfied";
    const res = routeTopLevelEvent(syntheticUserString(feedback), ctx);
    expect(res.messages.some((m) => m.type === "compact_summary")).toBe(false);
    expect(res.messages.some((m) => m.type === "goal_feedback")).toBe(true);
    // Goal feedback does not consume the armed state — the real summary can
    // still follow it (defensive; empirically feedback and compaction don't mix).
    expect(res.pendingCompactSummary).toBeUndefined();
  });

  test("boundary followed directly by result emits no summary and disarms", () => {
    let armed = false;
    const summaries: string[] = [];
    const route = (event: Record<string, unknown>) => {
      const ctx = { ...baseCtx(), pendingCompactSummary: armed };
      const res = routeTopLevelEvent(event, ctx);
      if (res.pendingCompactSummary !== undefined) armed = res.pendingCompactSummary;
      for (const m of res.messages) {
        if (m.type === "compact_summary") summaries.push(m.summary);
      }
    };

    route(boundaryEvent());
    expect(armed).toBe(true);
    route(resultEvent());

    expect(summaries).toHaveLength(0);
    expect(armed).toBe(false);
  });

  test("an armed local-command-stdout echo is not captured as the summary", () => {
    const ctx = { ...baseCtx(), pendingCompactSummary: true };
    const res = routeTopLevelEvent(
      syntheticUserString("<local-command-stdout>Compacted </local-command-stdout>"),
      ctx,
    );
    expect(res.messages.some((m) => m.type === "compact_summary")).toBe(false);
    // Still armed — the stdout echo is skipped, not consumed.
    expect(res.pendingCompactSummary).toBeUndefined();
  });
});
