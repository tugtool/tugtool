// PulseVoice tool labels — the strip must name skills, AskUserQuestion, and
// generic non-file tools so it stays live (off "None") when the assistant is
// running something it doesn't narrate in prose. These frames flatlined the
// strip before ([#context]); the labels are the fix.

import { describe, expect, it } from "bun:test";
import { PulseVoice } from "../pulse/voice.ts";
import type { OutboundMessage, ToolUse } from "../types.ts";

function toolUse(
  tool_name: string,
  input: object,
  tool_use_id = "t1",
): OutboundMessage {
  const frame: ToolUse = {
    type: "tool_use",
    msg_id: "m1",
    seq: 1,
    tool_name,
    tool_use_id,
    input,
    ipc_version: 2,
  };
  return frame;
}

describe("PulseVoice — tool labels", () => {
  it("names a <plugin>:<skill> invocation surfaced as the tool name", () => {
    const v = new PulseVoice();
    expect(v.onFrame("s", toolUse("tugplug:vet", {}), 1000)).toBeNull();
    const lines = v.flush(1000);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Running vet");
  });

  it("names the generic Skill tool from its input command", () => {
    const v = new PulseVoice();
    v.onFrame("s", toolUse("Skill", { command: "tugplug:commit" }), 1000);
    expect(v.flush(1000)[0]?.text).toBe("Running commit");
  });

  it("surfaces an AskUserQuestion beat, borrowing the first question header", () => {
    const v = new PulseVoice();
    v.onFrame(
      "s",
      toolUse("AskUserQuestion", { questions: [{ header: "Auth method" }] }),
      1000,
    );
    expect(v.flush(1000)[0]?.text).toBe("Asking: Auth method");
  });

  it("falls back to a non-empty label for an arbitrary non-file tool", () => {
    const v = new PulseVoice();
    v.onFrame("s", toolUse("WebSearch", { query: "sysinfo cpu subtree" }), 1000);
    const line = v.flush(1000)[0];
    expect(line?.text.length ?? 0).toBeGreaterThan(0);
    expect(line?.text).toBe("WebSearch");
  });

  it("leaves a file tool to the monologue (no generic label flashes)", () => {
    const v = new PulseVoice();
    // A Read carries a file_path — it defers to the assistant's narration,
    // so with no monologue accumulated the flush stays silent.
    v.onFrame("s", toolUse("Read", { file_path: "/x/foo.ts" }), 1000);
    expect(v.flush(1000)).toHaveLength(0);
  });
});
