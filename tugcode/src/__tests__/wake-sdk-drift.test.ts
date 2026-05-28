/**
 * SDK shape drift test for `SDKTaskNotificationMessage`.
 *
 * Pins the contract that `buildWakeStartedMessage` depends on: the
 * SDK's `system/task_notification` event carries the fields tugcode
 * forwards onto the `wake_started` IPC frame
 * (`roadmap/tugplan-dev-session-wake.md` [R01] / [#spec-wire-frames]).
 *
 * **Compile-time pinning** — every field tugcode reads via
 * `buildWakeStartedMessage` is exercised through a typed variable
 * declaration. If the SDK renames or removes any of `task_id` /
 * `status` / `output_file` / `summary`, this file fails tsc and the
 * drift is caught before any production wake silently breaks. A
 * future SDK that ADDS fields is fine (we don't forward them and the
 * check still passes).
 *
 * **Runtime cross-validation** — the captured Step-1 fixture's
 * `task_notification` line (line 49) is parsed and asserted to carry
 * the same field set. This pins the SDK type against the *actual
 * wire shape* the spike was captured against — divergence between
 * the declared type and the wire surfaces here as a runtime failure.
 *
 * **Why `tool_use_id` is asserted at runtime, not at compile time:**
 * The wire emits `tool_use_id` on every task_notification (verified
 * in the captured fixture, and tugcode reads it via
 * `buildWakeStartedMessage`), but `SDKTaskNotificationMessage` in
 * `@anthropic-ai/claude-agent-sdk/sdk.d.ts:1659-1668` does NOT
 * declare it. The SDK type is incomplete — the wire is the
 * authoritative contract for fields the bracket payload needs. This
 * is documented here so a future SDK type-fix doesn't get
 * mistakenly treated as breaking; quite the opposite — it would
 * close the gap and let `tool_use_id` join the compile-time list.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

import type { SDKTaskNotificationMessage } from "@anthropic-ai/claude-agent-sdk";

describe("SDK drift — SDKTaskNotificationMessage shape", () => {
  test("compile-time: every forwarded SDK-declared field is present (a removal would break tsc here)", () => {
    // Construct a value via the SDK type — if a field is renamed or
    // removed from `SDKTaskNotificationMessage`, this assignment fails
    // tsc and the drift is surfaced at build time.
    const probe: SDKTaskNotificationMessage = {
      type: "system",
      subtype: "task_notification",
      task_id: "task-drift-probe",
      status: "stopped",
      output_file: "",
      summary: "",
      // SDK-declared metadata, not forwarded but present in the type.
      uuid: "00000000-0000-0000-0000-000000000000" as SDKTaskNotificationMessage["uuid"],
      session_id: "session-drift-probe",
    };
    expect(probe.type).toBe("system");
    expect(probe.subtype).toBe("task_notification");
    expect(probe.task_id).toBe("task-drift-probe");
    expect(probe.status).toBe("stopped");
    expect(probe.output_file).toBe("");
    expect(probe.summary).toBe("");
  });

  test("compile-time: status union accepts all three SDK-declared values", () => {
    const statuses: Array<SDKTaskNotificationMessage["status"]> = [
      "completed",
      "failed",
      "stopped",
    ];
    expect(statuses).toEqual(["completed", "failed", "stopped"]);
  });

  test("runtime: captured Step-1 fixture exercises every wire field tugcode forwards (including tool_use_id)", () => {
    // The captured stream-json fixture's `system/task_notification`
    // line — the empirical wire shape. Cross-references the
    // compile-time pinning above against real captured data, and
    // covers `tool_use_id` (which the SDK type omits but the wire
    // emits).
    const fixturePath = new URL(
      "../../../tugrust/crates/tugcast/tests/fixtures/" +
        "stream-json-catalog/v2.1.150-spike/test-monitor-wake-raw.jsonl",
      import.meta.url,
    ).pathname;
    const raw = readFileSync(fixturePath, "utf8");
    const wireRows: Array<Record<string, unknown>> = [];
    for (const line of raw.split("\n").filter((l) => l.length > 0)) {
      const ev = JSON.parse(line) as Record<string, unknown>;
      if (ev.type === "system" && ev.subtype === "task_notification") {
        wireRows.push(ev);
      }
    }
    expect(wireRows).toHaveLength(1);
    const wire = wireRows[0];

    // Five fields tugcode reads into the `wake_trigger` payload —
    // pinned against the actual captured wire shape.
    expect(typeof wire.task_id).toBe("string");
    expect(typeof wire.tool_use_id).toBe("string");
    expect(typeof wire.status).toBe("string");
    expect(typeof wire.summary).toBe("string");
    expect(typeof wire.output_file).toBe("string");

    // The captured task_id and status are pinned as a regression
    // anchor — a future fixture-regen that loses the wake signal
    // would fail loudly here.
    expect(wire.task_id).toBe("b9klbr5tx");
    expect(wire.status).toBe("stopped");
  });
});
