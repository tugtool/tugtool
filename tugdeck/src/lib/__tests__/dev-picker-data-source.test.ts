/**
 * Pure-logic tests for the Sessions picker data source: row
 * computation over a `(query, ledger snapshot)` pair. No DOM — the
 * rendered treatment (badges, disabled rows) is covered by app-tests.
 */

import { describe, expect, test } from "bun:test";

import { DevSessionsDataSource } from "@/lib/dev-picker-data-source";
import type { WorkspaceSnapshot } from "@/lib/dev-session-ledger-store";
import type { SessionRow } from "@/protocol";

function makeRow(partial: Partial<SessionRow> & { session_id: string }): SessionRow {
  return {
    session_id: partial.session_id,
    workspace_key: partial.workspace_key ?? "ws-1",
    project_dir: partial.project_dir ?? "/proj",
    created_at: partial.created_at ?? 1,
    last_used_at: partial.last_used_at ?? 1,
    turn_count: partial.turn_count ?? 1,
    last_user_prompt: partial.last_user_prompt ?? "hello",
    state: partial.state ?? "closed",
    card_id: partial.card_id ?? null,
    name: partial.name ?? null,
    origin: partial.origin ?? "tug",
    terminal_live: partial.terminal_live ?? null,
    file_size: partial.file_size ?? null,
  };
}

function readySnapshot(rows: SessionRow[]): WorkspaceSnapshot {
  return { status: "ready", rows, dirExists: true } as WorkspaceSnapshot;
}

function rowsOf(ds: DevSessionsDataSource): string[] {
  const out: string[] = [];
  for (let i = 0; i < ds.numberOfItems(); i++) {
    const row = ds.rowAt(i);
    out.push(row.kind === "session-resume" ? row.row.session_id : row.kind);
  }
  return out;
}

describe("DevSessionsDataSource with external rows", () => {
  test("external rows list exactly like ledger rows, in snapshot order", () => {
    const ds = new DevSessionsDataSource({
      query: "/proj",
      ledger: readySnapshot([
        makeRow({ session_id: "ext-1", origin: "external", last_used_at: 9 }),
        makeRow({ session_id: "tug-1", origin: "tug", last_used_at: 5 }),
      ]),
    });
    expect(rowsOf(ds)).toEqual(["session-new", "ext-1", "tug-1"]);
  });

  test("zero-turn external rows are hidden like zero-turn ledger rows", () => {
    const ds = new DevSessionsDataSource({
      query: "/proj",
      ledger: readySnapshot([
        makeRow({ session_id: "ext-empty", origin: "external", turn_count: 0 }),
        makeRow({ session_id: "ext-real", origin: "external", turn_count: 2 }),
      ]),
    });
    expect(rowsOf(ds)).toEqual(["session-new", "ext-real"]);
  });

  test("content-bearing (file_size > 0) zero-count row is still visible", () => {
    // [P09]/[R06]: visibility is decoupled from the strict turn count. A
    // scanned external row with on-disk bytes but a (correctly) zero count
    // must NOT vanish from the picker.
    const ds = new DevSessionsDataSource({
      query: "/proj",
      ledger: readySnapshot([
        makeRow({
          session_id: "ext-bytes",
          origin: "external",
          turn_count: 0,
          file_size: 2048,
        }),
        // No bytes, no turns, not live → genuinely empty, stays hidden.
        makeRow({ session_id: "ext-void", origin: "external", turn_count: 0 }),
      ]),
    });
    expect(rowsOf(ds)).toEqual(["session-new", "ext-bytes"]);
  });

  test("a live zero-count row is visible (file_size is null for tug/live rows)", () => {
    const ds = new DevSessionsDataSource({
      query: "/proj",
      ledger: readySnapshot([
        makeRow({ session_id: "tug-live", state: "live", turn_count: 0 }),
        // Non-live tug row with no turns and no bytes → hidden.
        makeRow({ session_id: "tug-empty", state: "closed", turn_count: 0 }),
      ]),
    });
    expect(rowsOf(ds)).toEqual(["session-new", "tug-live"]);
  });

  test("nonLiveCount tracks content by bytes OR canonical turns", () => {
    const ds = new DevSessionsDataSource({
      query: "/proj",
      ledger: readySnapshot([
        makeRow({ session_id: "a", state: "closed", turn_count: 3 }),
        makeRow({
          session_id: "b",
          state: "closed",
          turn_count: 0,
          file_size: 1024,
        }),
        makeRow({ session_id: "c", state: "live", turn_count: 0 }), // live, excluded
        makeRow({ session_id: "d", state: "closed", turn_count: 0 }), // empty, excluded
      ]),
    });
    expect(ds.nonLiveCount()).toBe(2);
  });

  test("terminal-live rows are still listed (blocking is render-side)", () => {
    const ds = new DevSessionsDataSource({
      query: "/proj",
      ledger: readySnapshot([
        makeRow({
          session_id: "held",
          origin: "external",
          terminal_live: { status: "busy" },
        }),
      ]),
    });
    expect(rowsOf(ds)).toEqual(["session-new", "held"]);
    const row = ds.rowAt(1);
    if (row.kind !== "session-resume") throw new Error("expected resume row");
    expect(row.row.terminal_live).toEqual({ status: "busy" });
  });
});
