/**
 * Unit tests for `RestorePassGate` — the one-shot signal that gates
 * the Dev project picker behind the startup restore pass.
 *
 * `DevCardContent` holds an unbound card on the restore placeholder
 * until this gate is settled, so the project-picker sheet cannot
 * flash during the `list_card_bindings` round-trip. The gate's one
 * load-bearing invariant is idempotency: `restoreDevSessions` is
 * re-run on every reconnect, and a timeout backstop can race the
 * response — none of those re-settles must re-notify subscribers or
 * un-settle the gate. These tests pin that on fresh instances.
 */

import { describe, it, expect } from "bun:test";

import { RestorePassGate } from "@/lib/dev-session-restore";

describe("RestorePassGate", () => {
  it("starts unsettled", () => {
    expect(new RestorePassGate().getSnapshot()).toBe(false);
  });

  it("_settle flips the snapshot to true", () => {
    const gate = new RestorePassGate();
    gate._settle();
    expect(gate.getSnapshot()).toBe(true);
  });

  it("_settle notifies subscribers exactly once", () => {
    const gate = new RestorePassGate();
    let notifications = 0;
    gate.subscribe(() => {
      notifications += 1;
    });
    gate._settle();
    expect(notifications).toBe(1);
  });

  it("a second _settle is idempotent — no re-notify, still settled", () => {
    // Models a reconnect `restoreDevSessions` pass, or a timeout
    // backstop firing after the response already settled the gate.
    const gate = new RestorePassGate();
    let notifications = 0;
    gate.subscribe(() => {
      notifications += 1;
    });
    gate._settle();
    gate._settle();
    gate._settle();
    expect(notifications).toBe(1);
    expect(gate.getSnapshot()).toBe(true);
  });

  it("unsubscribe stops further notifications", () => {
    const gate = new RestorePassGate();
    let notifications = 0;
    const unsubscribe = gate.subscribe(() => {
      notifications += 1;
    });
    unsubscribe();
    gate._settle();
    expect(notifications).toBe(0);
    // The snapshot still reflects the settle — only the listener left.
    expect(gate.getSnapshot()).toBe(true);
  });

  it("a subscriber added after settle is not retroactively notified", () => {
    // `useSyncExternalStore` reads `getSnapshot` on subscribe, so a
    // late subscriber sees the settled value without a notification.
    const gate = new RestorePassGate();
    gate._settle();
    let notifications = 0;
    gate.subscribe(() => {
      notifications += 1;
    });
    expect(notifications).toBe(0);
    expect(gate.getSnapshot()).toBe(true);
  });
});
