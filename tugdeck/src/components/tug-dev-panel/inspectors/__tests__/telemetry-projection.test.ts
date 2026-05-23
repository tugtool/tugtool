/**
 * Pure-logic tests for `projectTelemetryInspector`. The projection is
 * the single point of truth for "which fields the telemetry inspector
 * surfaces"; the tests pin that contract.
 *
 * Builds synthetic `CodeSessionState` + `TurnEntry` values directly
 * (no reducer, no fixtures) so each test makes one assertion clearly.
 */

import { describe, it, expect } from "bun:test";

import {
  formatMs,
  formatUsd,
  projectTelemetryInspector,
} from "@/components/tug-dev-panel/inspectors/telemetry-projection";
import { createInitialState } from "@/lib/code-session-store/reducer";
import type { CodeSessionState } from "@/lib/code-session-store/reducer";
import type { TurnEntry } from "@/lib/code-session-store/types";
import { TURN_ENTRY_TELEMETRY_DEFAULTS } from "@/lib/code-session-store/testing/turn-entry-defaults";

function fresh(): CodeSessionState {
  return createInitialState("tug-session-id-x", "Display Label X", "new");
}

function turn(overrides: Partial<TurnEntry>): TurnEntry {
  return {
    turnKey: "k1",
    msgId: "m1",
    userMessage: { text: "", attachments: [], submitAt: 0 },
    thinking: "",
    assistant: "",
    toolCalls: [],
    result: "success",
    endedAt: 0,
    ...TURN_ENTRY_TELEMETRY_DEFAULTS,
    ...overrides,
  };
}

function findRow(
  sections: ReturnType<typeof projectTelemetryInspector>,
  sectionTitle: string,
  rowLabel: string,
) {
  const section = sections.find((s) => s.title === sectionTitle);
  if (!section) throw new Error(`section not found: ${sectionTitle}`);
  const row = section.rows.find((r) => r.label === rowLabel);
  if (!row) {
    throw new Error(
      `row not found: ${rowLabel} in section ${sectionTitle}. ` +
        `Available: ${section.rows.map((r) => r.label).join(", ")}`,
    );
  }
  return row;
}

describe("projectTelemetryInspector — empty state", () => {
  it("returns an explicit empty-state section when state is null", () => {
    const sections = projectTelemetryInspector({
      state: null,
      transcript: [],
      tickAt: 0,
      tugSessionId: null,
      displayLabel: null,
    });
    expect(sections.length).toBe(1);
    expect(sections[0].title).toBe("Card");
    expect(sections[0].rows[0].value).toContain("No card selected");
  });
});

describe("projectTelemetryInspector — populated state", () => {
  it("surfaces card identity, phase + transport, live clocks, counters, last turn, totals", () => {
    const state: CodeSessionState = {
      ...fresh(),
      phase: "streaming",
      transportState: "online",
      pendingUserMessage: {
        text: "hi",
        atoms: [],
        submitAt: 1_000_000,
        turnKey: "k-live",
      },
      awaitingApprovalAccumulatedMs: 250,
      awaitingApprovalSince: null,
      transportDowntimeAccumulatedMs: 0,
      transportReconnectCount: 2,
      maxStreamGapMs: 700,
      firstAssistantDeltaAt: 1_000_100,
      firstToolUseAt: null,
      interruptInFlight: false,
    };
    const t = turn({
      msgId: "msg-1",
      wallClockMs: 5_000,
      awaitingApprovalMs: 1_000,
      transportDowntimeMs: 250,
      activeMs: 3_750,
      ttftMs: 120,
      ttftcMs: null,
      reconnectCount: 1,
      maxStreamGapMs: 300,
      turnEndReason: "complete",
      cost: {
        inputTokens: 3,
        outputTokens: 10,
        cacheCreationInputTokens: 6_180,
        cacheReadInputTokens: 12_507,
        totalCostUsd: 0.045,
      },
    });
    const sections = projectTelemetryInspector({
      state,
      transcript: [t],
      tickAt: 1_001_500,
      tugSessionId: "tug-session-id-x",
      displayLabel: "Display Label X",
    });

    // Card identity
    expect(findRow(sections, "Card identity", "Tug session id").value).toBe(
      "tug-session-id-x",
    );
    expect(findRow(sections, "Card identity", "Display label").value).toBe(
      "Display Label X",
    );

    // Phase + transport
    expect(findRow(sections, "Phase + transport", "Phase").value).toBe(
      "streaming",
    );
    expect(findRow(sections, "Phase + transport", "Transport state").value).toBe(
      "online",
    );

    // Live in-flight clocks: wall = 1500ms (live), awaiting = 250ms,
    // downtime = 0, active = 1250ms.
    expect(findRow(sections, "Live in-flight clocks", "Wall clock").value).toBe(
      "1.50 s",
    );
    expect(
      findRow(sections, "Live in-flight clocks", "Awaiting approval").value,
    ).toBe("250 ms");
    expect(findRow(sections, "Live in-flight clocks", "Active").value).toBe(
      "1.25 s",
    );

    // Live counters
    expect(findRow(sections, "Live counters", "Reconnect count").value).toBe(
      "2",
    );
    expect(findRow(sections, "Live counters", "Max stream gap").value).toBe(
      "700 ms",
    );
    expect(
      findRow(sections, "Live counters", "First tool use at").value,
    ).toBe("null");

    // Last committed TurnEntry
    expect(
      findRow(sections, "Last committed TurnEntry", "msgId").value,
    ).toBe("msg-1");
    expect(
      findRow(sections, "Last committed TurnEntry", "turnEndReason").value,
    ).toBe("complete");
    expect(
      findRow(sections, "Last committed TurnEntry", "awaitingApprovalMs")
        .value,
    ).toBe("1.00 s");
    expect(
      findRow(sections, "Last committed TurnEntry", "ttftcMs").value,
    ).toBe("null");
    expect(
      findRow(
        sections,
        "Last committed TurnEntry",
        "Context size (this turn)",
      ).value,
    ).toBe(String(3 + 6_180 + 12_507));

    // Session totals
    expect(findRow(sections, "Session totals", "Turn count").value).toBe("1");
    expect(findRow(sections, "Session totals", "Total cost").value).toBe(
      "$0.0450",
    );
  });

  it("renders explicit empty-state row when no committed turns exist", () => {
    const state = { ...fresh(), phase: "idle" as const };
    const sections = projectTelemetryInspector({
      state,
      transcript: [],
      tickAt: 0,
      tugSessionId: "x",
      displayLabel: "x",
    });
    const lastTurnSection = sections.find(
      (s) => s.title === "Last committed TurnEntry",
    );
    expect(lastTurnSection).toBeDefined();
    expect(lastTurnSection!.rows[0].value).toContain("No committed turns yet");
  });

  it("surfaces every Step 20.3 TurnEntry field", () => {
    const state = { ...fresh(), phase: "idle" as const };
    const t = turn({ msgId: "m-cover" });
    const sections = projectTelemetryInspector({
      state,
      transcript: [t],
      tickAt: 0,
      tugSessionId: "x",
      displayLabel: "x",
    });
    const lastTurn = sections.find(
      (s) => s.title === "Last committed TurnEntry",
    )!;
    const labels = lastTurn.rows.map((r) => r.label);
    for (const label of [
      "msgId",
      "turnEndReason",
      "wallClockMs",
      "awaitingApprovalMs",
      "transportDowntimeMs",
      "activeMs",
      "ttftMs",
      "ttftcMs",
      "reconnectCount",
      "maxStreamGapMs",
      "Context size (this turn)",
      "cost.inputTokens",
      "cost.outputTokens",
      "cost.cacheCreationInputTokens",
      "cost.cacheReadInputTokens",
      "cost.totalCostUsd",
    ]) {
      expect(labels).toContain(label);
    }
  });
});

describe("telemetry-projection formatters", () => {
  it("formatMs handles ms / s / m+s buckets", () => {
    expect(formatMs(0)).toBe("0 ms");
    expect(formatMs(999)).toBe("999 ms");
    expect(formatMs(1_000)).toBe("1.00 s");
    expect(formatMs(59_999)).toBe("60.00 s");
    expect(formatMs(60_000)).toBe("1m 00s");
    expect(formatMs(125_000)).toBe("2m 05s");
  });

  it("formatUsd switches precision with magnitude", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.000123)).toBe("$0.000123");
    expect(formatUsd(0.045)).toBe("$0.0450");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});
