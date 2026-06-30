/**
 * host-info-store unit tests (pure — no jsdom, no mock store).
 *
 * Covers:
 * - parseHandshakeHost extracts {os,version} from a real handshake response.
 * - parseHandshakeHost is fail-open: missing/empty/malformed host → null.
 * - HostInfoStore publishes, dedupes equal values, and ignores null (unknown)
 *   so a later host-less handshake never clears a learned value.
 */

import { describe, test, expect } from "bun:test";
import { parseHandshakeHost, HostInfoStore } from "../lib/host-info-store";

describe("parseHandshakeHost", () => {
  test("extracts os/version from a real handshake response", () => {
    const response = {
      protocol: "tugcast",
      version: 1,
      capabilities: [],
      host: { os: "macos", version: "15.7.7" },
    };
    expect(parseHandshakeHost(response)).toEqual({
      os: "macos",
      version: "15.7.7",
    });
  });

  test("missing host field → null (unknown, fail-open)", () => {
    const response = { protocol: "tugcast", version: 1, capabilities: [] };
    expect(parseHandshakeHost(response)).toBeNull();
  });

  test("empty version → null (non-macOS host reads as unknown)", () => {
    expect(parseHandshakeHost({ host: { os: "macos", version: "" } })).toBeNull();
  });

  test("non-object / malformed host → null", () => {
    expect(parseHandshakeHost(null)).toBeNull();
    expect(parseHandshakeHost("nope")).toBeNull();
    expect(parseHandshakeHost({ host: null })).toBeNull();
    expect(parseHandshakeHost({ host: { os: 123, version: "15.7" } })).toBeNull();
    expect(parseHandshakeHost({ host: { os: "macos" } })).toBeNull();
  });
});

describe("HostInfoStore", () => {
  test("publish updates snapshot and notifies once per change", () => {
    const store = new HostInfoStore();
    expect(store.getSnapshot()).toBeNull();

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.publish({ os: "macos", version: "15.7.7" });
    expect(store.getSnapshot()).toEqual({ os: "macos", version: "15.7.7" });
    expect(notifications).toBe(1);

    // Duplicate value: no snapshot replacement, no notification.
    store.publish({ os: "macos", version: "15.7.7" });
    expect(notifications).toBe(1);

    // Unknown (null): keep the prior learned value, no notification.
    store.publish(null);
    expect(store.getSnapshot()).toEqual({ os: "macos", version: "15.7.7" });
    expect(notifications).toBe(1);

    // A real change notifies.
    store.publish({ os: "macos", version: "26.0" });
    expect(store.getSnapshot()).toEqual({ os: "macos", version: "26.0" });
    expect(notifications).toBe(2);

    unsubscribe();
  });
});
