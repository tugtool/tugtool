// Lane-partitioned per-turn stream state — interleaved main + subagent.
//
// A turn's stdout multiplexes the main loop's stream with any background
// subagents' streams; each lane (keyed `parent_tool_use_id ?? null`) runs
// its own message cycle with its own `message.id`s. This suite pins the
// lane contract in dispatchEventToTurn: a subagent's `message_start`
// arriving between two main-loop text deltas must NOT re-stamp the main
// lane's subsequent deltas with the subagent's msg_id (the reducer would
// mint a spurious second Message mid-block — the "I / 'll wait…"
// transcript split), and vice versa.
//
// The event sequence mirrors the captured failure (session 5e7da52d): the
// main loop streams "I'll wait for the tugcast architecture map…" while a
// background Explore agent's first API call opens its own message.

import { describe, expect, test } from "bun:test";
import { ActiveTurn, SessionManager } from "../session.ts";
import { unwrapReplayBatches } from "./capture-ipc.ts";
import type { AssistantText, OutboundMessage } from "../types.ts";

async function captureStdout(
  fn: () => Promise<void> | void,
): Promise<{ emitted: OutboundMessage[] }> {
  const captured: OutboundMessage[] = [];
  const originalWrite = Bun.write;
  const decoder = new TextDecoder();
  (Bun as unknown as { write: typeof Bun.write }).write = ((
    dest: unknown,
    data: unknown,
  ) => {
    if (dest === Bun.stdout) {
      let text = "";
      if (typeof data === "string") text = data;
      else if (data instanceof Uint8Array) text = decoder.decode(data);
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (t.length > 0) {
          try {
            captured.push(JSON.parse(t) as OutboundMessage);
          } catch {
            // ignore
          }
        }
      }
    }
    return Promise.resolve(
      data instanceof Uint8Array
        ? data.length
        : typeof data === "string"
          ? data.length
          : 0,
    );
  }) as typeof Bun.write;
  try {
    await fn();
    const { drainPendingWrites } = await import("../ipc.ts");
    await drainPendingWrites();
  } finally {
    (Bun as unknown as { write: typeof Bun.write }).write = originalWrite;
  }
  return { emitted: unwrapReplayBatches(captured) };
}

function newManagerWithTurn(turn: ActiveTurn): SessionManager {
  const manager = new SessionManager(
    "/tmp/lane-partition-" + Date.now() + "-" + Math.random().toString(36).slice(2),
    crypto.randomUUID(),
  );
  (manager as unknown as { activeTurn: ActiveTurn }).activeTurn = turn;
  return manager;
}

const AGENT_LANE = "toolu_explore_agent";

/** Wrap an inner API stream event in claude's top-level stream_event shape. */
function streamEvent(
  inner: Record<string, unknown>,
  parentToolUseId?: string,
): Record<string, unknown> {
  return {
    type: "stream_event",
    event: inner,
    session_id: "sess",
    ...(parentToolUseId !== undefined
      ? { parent_tool_use_id: parentToolUseId }
      : {}),
  };
}

function messageStart(msgId: string): Record<string, unknown> {
  return {
    type: "message_start",
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      content: [],
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  };
}

function textBlockStart(index: number): Record<string, unknown> {
  return {
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" },
  };
}

function textDelta(index: number, text: string): Record<string, unknown> {
  return {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  };
}

/**
 * Drive the captured failure's interleaving through dispatchEventToTurn
 * and return the emitted frames plus the turn for state assertions.
 */
async function runInterleavedTurn(): Promise<{
  emitted: OutboundMessage[];
  turn: ActiveTurn;
}> {
  const turn = new ActiveTurn(0, [{ type: "text", text: "go" }]);
  const manager = newManagerWithTurn(turn);
  const dispatch = (event: Record<string, unknown>) =>
    (
      manager as unknown as {
        dispatchEventToTurn(t: ActiveTurn, e: Record<string, unknown>): void;
      }
    ).dispatchEventToTurn(turn, event);

  const { emitted } = await captureStdout(() => {
    // Main lane opens its message and streams the first delta.
    dispatch(streamEvent(messageStart("msg_MAIN")));
    dispatch(streamEvent(textBlockStart(0)));
    dispatch(streamEvent(textDelta(0, "I")));

    // Background subagent's first API call interleaves: its own
    // message_start + text stream, tagged with the launching tool_use.
    dispatch(streamEvent(messageStart("msg_AGENT"), AGENT_LANE));
    dispatch(streamEvent(textBlockStart(0), AGENT_LANE));
    dispatch(streamEvent(textDelta(0, "Mapping tugcast"), AGENT_LANE));

    // Main lane's stream continues mid-block.
    dispatch(streamEvent(textDelta(0, "'ll wait for the map.")));

    // Subagent's terminal message_delta (its own usage) interleaves too.
    dispatch(
      streamEvent(
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 500, output_tokens: 40 },
        },
        AGENT_LANE,
      ),
    );
  });
  return { emitted, turn };
}

describe("dispatchEventToTurn — lane-partitioned stream state", () => {
  test("main-lane deltas keep the main msg_id across an interleaved subagent message_start", async () => {
    const { emitted } = await runInterleavedTurn();

    const mainText = emitted.filter(
      (m): m is AssistantText =>
        m.type === "assistant_text" &&
        (m as unknown as Record<string, unknown>).parent_tool_use_id ===
          undefined,
    );
    // Both main deltas — "I" and "'ll wait for the map." — under ONE
    // (msg_id, block_index) key. Under the pre-lane shared pointer the
    // second delta was stamped msg_AGENT and the reducer minted a
    // spurious second Message.
    expect(mainText.map((m) => m.text)).toEqual(["I", "'ll wait for the map."]);
    for (const m of mainText) {
      expect(m.msg_id).toBe("msg_MAIN");
      expect(m.block_index).toBe(0);
    }
    const mainKeys = new Set(mainText.map((m) => `${m.msg_id}#${m.block_index}`));
    expect(mainKeys.size).toBe(1);
  });

  test("subagent-lane frames carry the subagent msg_id and parent_tool_use_id", async () => {
    const { emitted } = await runInterleavedTurn();

    const agentText = emitted.filter(
      (m): m is AssistantText =>
        m.type === "assistant_text" &&
        (m as unknown as Record<string, unknown>).parent_tool_use_id ===
          AGENT_LANE,
    );
    expect(agentText.map((m) => m.text)).toEqual(["Mapping tugcast"]);
    for (const m of agentText) {
      expect(m.msg_id).toBe("msg_AGENT");
    }

    // The subagent's content_block_start is tagged and keyed to its own
    // message — never minted under the main lane's msg_id.
    const agentStarts = emitted.filter(
      (m) =>
        m.type === "content_block_start" &&
        (m as unknown as Record<string, unknown>).parent_tool_use_id ===
          AGENT_LANE,
    );
    expect(agentStarts.length).toBe(1);
    expect(
      (agentStarts[0] as unknown as Record<string, unknown>).msg_id,
    ).toBe("msg_AGENT");
  });

  test("partialText and messageBlocks stay lane-pure", async () => {
    const { turn } = await runInterleavedTurn();

    // Main-lane accessors (turn-scoped consumers: gotResult terminal,
    // EOF partial_result, mid-turn snapshot) see only main-loop content.
    expect(turn.partialText).toBe("I'll wait for the map.");
    expect([...turn.messageBlocks.keys()]).toEqual(["msg_MAIN"]);
    expect(turn.currentMessageId).toBe("msg_MAIN");

    // The subagent's lane holds its own accumulation.
    const agentLane = turn.laneFor(AGENT_LANE);
    expect(agentLane.partialText).toBe("Mapping tugcast");
    expect(agentLane.msgId).toBe("msg_AGENT");
    expect([...agentLane.messageBlocks.keys()]).toEqual(["msg_AGENT"]);
  });

  test("a subagent message_delta's usage does not clobber the turn's cost latch", async () => {
    const { turn } = await runInterleavedTurn();

    // The main lane's message_start usage is latched; the subagent's
    // message_delta usage (input_tokens: 500) must not become the
    // turn's cost_update source.
    expect(turn.lastMessageDeltaUsage).toBeNull();
    expect(
      (turn.lastMessageStartUsage as Record<string, unknown>).input_tokens,
    ).toBe(10);
  });
});
