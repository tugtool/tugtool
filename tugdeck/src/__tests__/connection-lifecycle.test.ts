/**
 * connection-lifecycle unit tests.
 *
 * The lifecycle is a stateless event pipe: `notify*` calls drive named
 * events into observer sets, and the observable `state` updates in
 * lockstep. There is no WebSocket I/O — the unit under test is the
 * event-routing logic plus the close-then-open gating that distinguishes
 * `connectionDidReconnect` from a plain `connectionDidOpen`.
 */

import { describe, test, expect } from "bun:test";

import {
  ConnectionLifecycle,
  type ConnectionState,
} from "../lib/connection-lifecycle";

describe("ConnectionLifecycle – initial state", () => {
  test("starts in 'closed'", () => {
    const lifecycle = new ConnectionLifecycle();
    expect(lifecycle.getState()).toBe<ConnectionState>("closed");
    expect(lifecycle.isOpen()).toBe(false);
  });
});

describe("ConnectionLifecycle – state transitions", () => {
  test("connectionWillOpen sets state to 'opening'", () => {
    const lifecycle = new ConnectionLifecycle();
    lifecycle.notifyConnectionWillOpen();
    expect(lifecycle.getState()).toBe<ConnectionState>("opening");
    expect(lifecycle.isOpen()).toBe(false);
  });

  test("connectionDidOpen sets state to 'open' and isOpen() is true", () => {
    const lifecycle = new ConnectionLifecycle();
    lifecycle.notifyConnectionWillOpen();
    lifecycle.notifyConnectionDidOpen();
    expect(lifecycle.getState()).toBe<ConnectionState>("open");
    expect(lifecycle.isOpen()).toBe(true);
  });

  test("connectionDidClose sets state to 'closed'", () => {
    const lifecycle = new ConnectionLifecycle();
    lifecycle.notifyConnectionWillOpen();
    lifecycle.notifyConnectionDidOpen();
    lifecycle.notifyConnectionDidClose();
    expect(lifecycle.getState()).toBe<ConnectionState>("closed");
    expect(lifecycle.isOpen()).toBe(false);
  });

  test("connectionDidEnterReconnecting sets state to 'reconnecting'", () => {
    const lifecycle = new ConnectionLifecycle();
    lifecycle.notifyConnectionWillOpen();
    lifecycle.notifyConnectionDidOpen();
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidEnterReconnecting();
    expect(lifecycle.getState()).toBe<ConnectionState>("reconnecting");
  });
});

describe("ConnectionLifecycle – observer dispatch", () => {
  test("connectionDidOpen observers fire on every did-open", () => {
    const lifecycle = new ConnectionLifecycle();
    let fired = 0;
    lifecycle.observeConnectionDidOpen(() => {
      fired += 1;
    });

    lifecycle.notifyConnectionDidOpen();
    expect(fired).toBe(1);

    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidOpen();
    expect(fired).toBe(2);
  });

  test("connectionDidClose observers fire on every did-close", () => {
    const lifecycle = new ConnectionLifecycle();
    let fired = 0;
    lifecycle.observeConnectionDidClose(() => {
      fired += 1;
    });

    lifecycle.notifyConnectionDidOpen();
    lifecycle.notifyConnectionDidClose();
    expect(fired).toBe(1);

    lifecycle.notifyConnectionDidOpen();
    lifecycle.notifyConnectionDidClose();
    expect(fired).toBe(2);
  });

  test("connectionWillOpen observers fire on every will-open", () => {
    const lifecycle = new ConnectionLifecycle();
    let fired = 0;
    lifecycle.observeConnectionWillOpen(() => {
      fired += 1;
    });

    lifecycle.notifyConnectionWillOpen();
    expect(fired).toBe(1);

    lifecycle.notifyConnectionDidOpen();
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionWillOpen();
    expect(fired).toBe(2);
  });

  test("connectionDidEnterReconnecting observers fire on every backoff entry", () => {
    const lifecycle = new ConnectionLifecycle();
    let fired = 0;
    lifecycle.observeConnectionDidEnterReconnecting(() => {
      fired += 1;
    });

    lifecycle.notifyConnectionDidOpen();
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidEnterReconnecting();
    expect(fired).toBe(1);
  });

  test("unsubscribe stops further notifications", () => {
    const lifecycle = new ConnectionLifecycle();
    let fired = 0;
    const unsub = lifecycle.observeConnectionDidOpen(() => {
      fired += 1;
    });

    lifecycle.notifyConnectionDidOpen();
    expect(fired).toBe(1);

    unsub();
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidOpen();
    expect(fired).toBe(1);
  });

  test("a throwing observer does not stop later observers from running", () => {
    // Every event channel is a synchronous fan-out; a single bad
    // subscriber must not break the rest. Mirrors the same defense
    // in AppLifecycle.fire.
    const lifecycle = new ConnectionLifecycle();
    const calls: string[] = [];
    lifecycle.observeConnectionDidOpen(() => {
      calls.push("first");
      throw new Error("intentional");
    });
    lifecycle.observeConnectionDidOpen(() => {
      calls.push("second");
    });

    // Suppress the console.error from the catch.
    const originalError = console.error;
    console.error = () => {};
    try {
      lifecycle.notifyConnectionDidOpen();
    } finally {
      console.error = originalError;
    }

    expect(calls).toEqual(["first", "second"]);
  });
});

describe("ConnectionLifecycle – connectionDidReconnect gating", () => {
  test("does not fire on the very first connectionDidOpen (mount path)", () => {
    const lifecycle = new ConnectionLifecycle();
    let openFired = 0;
    let reconnectFired = 0;
    lifecycle.observeConnectionDidOpen(() => {
      openFired += 1;
    });
    lifecycle.observeConnectionDidReconnect(() => {
      reconnectFired += 1;
    });

    lifecycle.notifyConnectionDidOpen();

    expect(openFired).toBe(1);
    expect(reconnectFired).toBe(0);
  });

  test("fires on every connectionDidOpen that follows a connectionDidClose", () => {
    const lifecycle = new ConnectionLifecycle();
    let reconnectFired = 0;
    lifecycle.observeConnectionDidReconnect(() => {
      reconnectFired += 1;
    });

    // Mount: no reconnect.
    lifecycle.notifyConnectionDidOpen();
    expect(reconnectFired).toBe(0);

    // Recovery 1.
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidOpen();
    expect(reconnectFired).toBe(1);

    // Recovery 2.
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidOpen();
    expect(reconnectFired).toBe(2);
  });

  test("multiple closes between opens produce exactly one reconnect on next open", () => {
    // Defensive: a flaky network where the first reconnect attempt
    // closes again before the handshake completes. The next successful
    // open should fire connectionDidReconnect exactly once.
    const lifecycle = new ConnectionLifecycle();
    let reconnectFired = 0;
    lifecycle.observeConnectionDidReconnect(() => {
      reconnectFired += 1;
    });

    lifecycle.notifyConnectionDidOpen(); // mount
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidClose(); // duplicate close (e.g., already-closed event)
    lifecycle.notifyConnectionDidOpen(); // recovery

    expect(reconnectFired).toBe(1);
  });

  test("fires connectionDidReconnect after connectionDidOpen, in that order", () => {
    // Subscribers that listen to BOTH should see did-open before
    // did-reconnect, so they can use did-open for "wire is alive" work
    // and did-reconnect for "wire is alive AGAIN" follow-up work.
    const lifecycle = new ConnectionLifecycle();
    const order: string[] = [];
    lifecycle.observeConnectionDidOpen(() => {
      order.push("did-open");
    });
    lifecycle.observeConnectionDidReconnect(() => {
      order.push("did-reconnect");
    });

    lifecycle.notifyConnectionDidOpen(); // mount
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidOpen(); // recovery

    expect(order).toEqual(["did-open", "did-open", "did-reconnect"]);
  });

  test("close-before-first-successful-open does NOT mark the next open as a reconnect", () => {
    // Edge case: the very first connect attempt closes before its
    // handshake completes (e.g., protocol/version mismatch in
    // `connection.ts:117-145`, where `ws.close()` runs without
    // `notifyConnectionDidOpen` ever firing). The reconnect logic in
    // `TugConnection` then re-attempts and the second handshake
    // succeeds. That second attempt is the FIRST successful open of
    // the lifecycle's lifetime — it must not fire
    // `connectionDidReconnect`, because there was no prior successful
    // open to recover from.
    const lifecycle = new ConnectionLifecycle();
    let openFired = 0;
    let reconnectFired = 0;
    lifecycle.observeConnectionDidOpen(() => {
      openFired += 1;
    });
    lifecycle.observeConnectionDidReconnect(() => {
      reconnectFired += 1;
    });

    // First attempt: TCP open → handshake fails → close.
    lifecycle.notifyConnectionWillOpen();
    lifecycle.notifyConnectionDidClose();

    // Reconnect kicks in.
    lifecycle.notifyConnectionDidEnterReconnecting();

    // Second attempt: succeeds. This is the first real open of the
    // lifecycle's lifetime, not a recovery.
    lifecycle.notifyConnectionWillOpen();
    lifecycle.notifyConnectionDidOpen();

    expect(openFired).toBe(1);
    expect(reconnectFired).toBe(0);

    // Now a real close → reopen IS a reconnect.
    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidOpen();

    expect(openFired).toBe(2);
    expect(reconnectFired).toBe(1);
  });

  test("subscribing AFTER mount still receives later reconnects", () => {
    // Late subscribers (e.g., a card that mounts after app boot) should
    // receive every reconnect that happens after their subscription —
    // not be silenced because the lifecycle "remembers" the mount path.
    const lifecycle = new ConnectionLifecycle();

    lifecycle.notifyConnectionDidOpen(); // mount happened before subscription

    let reconnectFired = 0;
    lifecycle.observeConnectionDidReconnect(() => {
      reconnectFired += 1;
    });

    lifecycle.notifyConnectionDidClose();
    lifecycle.notifyConnectionDidOpen();

    expect(reconnectFired).toBe(1);
  });
});
