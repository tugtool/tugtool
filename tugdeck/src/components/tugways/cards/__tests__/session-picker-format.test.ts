/**
 * session-picker-format — pure-logic tests for the session-row subtitle
 * ([P07] no client recompute). The subtitle reads `turn_count` straight
 * from the row (the reconciled authority) and renders it beside the size.
 */

import { describe, expect, test } from "bun:test";

import { formatSessionRowSubtitle } from "../session-picker-format";
import type { SessionRow } from "@/protocol";

function row(over: Partial<SessionRow>): SessionRow {
  return {
    session_id: "abcdef1234567890",
    workspace_key: "w",
    project_dir: "/p",
    created_at: 0,
    last_used_at: Date.now(), // → "just now", deterministic timestamp segment
    turn_count: 0,
    last_user_prompt: null,
    state: "closed",
    card_id: null,
    name: null,
    name_user_set: false,
    origin: "external",
    terminal_live: null,
    ...over,
  };
}

describe("formatSessionRowSubtitle — turns beside size", () => {
  test("renders [timestamp, N turns, size, id] in order", () => {
    const s = formatSessionRowSubtitle(row({ turn_count: 42, file_size: 4096 }));
    expect(s).toBe("just now · 42 turns · 4.0 KB · id abcdef12");
  });

  test("singular turn", () => {
    const s = formatSessionRowSubtitle(row({ turn_count: 1, file_size: 100 }));
    expect(s).toBe("just now · 1 turn · 100 B · id abcdef12");
  });

  test("drops the turns segment when turn_count is 0", () => {
    const s = formatSessionRowSubtitle(row({ turn_count: 0, file_size: 2048 }));
    expect(s).toBe("just now · 2.0 KB · id abcdef12");
  });

  test("drops the size segment when file_size is null (tug/live row)", () => {
    const s = formatSessionRowSubtitle(row({ turn_count: 7, file_size: null }));
    expect(s).toBe("just now · 7 turns · id abcdef12");
  });

  test("both turns and size absent → just timestamp + id", () => {
    const s = formatSessionRowSubtitle(row({ turn_count: 0 }));
    expect(s).toBe("just now · id abcdef12");
  });
});
