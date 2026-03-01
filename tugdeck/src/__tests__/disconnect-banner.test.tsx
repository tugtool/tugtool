/**
 * DisconnectBanner RTL tests — Step 9.
 *
 * Tests cover:
 * - DisconnectBanner renders when connection state is disconnected
 * - DisconnectBanner shows countdown text
 * - DisconnectBanner hidden when connected
 * - DisconnectBanner shows Reconnecting text when reconnecting
 *
 * Step 9: Event Bridge Cleanup
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

import { DisconnectBanner } from "@/components/chrome/disconnect-banner";
import type { DisconnectStateCallback } from "@/connection";

// ---- Mock TugConnection ----

function makeMockConnection() {
  const callbacks: DisconnectStateCallback[] = [];
  return {
    onDisconnectState: (cb: DisconnectStateCallback) => {
      callbacks.push(cb);
      return () => {
        const idx = callbacks.indexOf(cb);
        if (idx >= 0) callbacks.splice(idx, 1);
      };
    },
    fireDisconnectState: (state: Parameters<DisconnectStateCallback>[0]) => {
      for (const cb of callbacks) {
        cb(state);
      }
    },
  };
}

// ---- Tests ----

describe("DisconnectBanner – hidden when connected", () => {
  it("renders nothing when no disconnect state has been set", () => {
    const conn = makeMockConnection() as any;
    const { container } = render(<DisconnectBanner connection={conn} />);
    expect(container.querySelector(".disconnect-banner")).toBeNull();
  });

  it("renders nothing when disconnect state is connected (disconnected=false)", async () => {
    const conn = makeMockConnection();
    const { container } = render(<DisconnectBanner connection={conn as any} />);

    await act(async () => {
      conn.fireDisconnectState({
        disconnected: false,
        countdown: 0,
        reason: null,
        reconnecting: false,
      });
    });

    expect(container.querySelector(".disconnect-banner")).toBeNull();
  });
});

describe("DisconnectBanner – renders when disconnected", () => {
  it("renders banner when disconnected=true", async () => {
    const conn = makeMockConnection();
    const { container } = render(<DisconnectBanner connection={conn as any} />);

    await act(async () => {
      conn.fireDisconnectState({
        disconnected: true,
        countdown: 5,
        reason: null,
        reconnecting: false,
      });
    });

    expect(container.querySelector(".disconnect-banner")).not.toBeNull();
  });

  it("shows countdown text when disconnected with countdown", async () => {
    const conn = makeMockConnection();
    const { container } = render(<DisconnectBanner connection={conn as any} />);

    await act(async () => {
      conn.fireDisconnectState({
        disconnected: true,
        countdown: 8,
        reason: null,
        reconnecting: false,
      });
    });

    const banner = container.querySelector(".disconnect-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("8s");
  });

  it("shows reason text when disconnected with a reason", async () => {
    const conn = makeMockConnection();
    const { container } = render(<DisconnectBanner connection={conn as any} />);

    await act(async () => {
      conn.fireDisconnectState({
        disconnected: true,
        countdown: 3,
        reason: "Server closed",
        reconnecting: false,
      });
    });

    const banner = container.querySelector(".disconnect-banner");
    expect(banner?.textContent).toContain("Server closed");
  });

  it("shows Reconnecting text when reconnecting=true", async () => {
    const conn = makeMockConnection();
    const { container } = render(<DisconnectBanner connection={conn as any} />);

    await act(async () => {
      conn.fireDisconnectState({
        disconnected: true,
        countdown: 0,
        reason: null,
        reconnecting: true,
      });
    });

    const banner = container.querySelector(".disconnect-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Reconnecting");
  });

  it("hides banner when state transitions back to connected", async () => {
    const conn = makeMockConnection();
    const { container } = render(<DisconnectBanner connection={conn as any} />);

    // First: become disconnected
    await act(async () => {
      conn.fireDisconnectState({
        disconnected: true,
        countdown: 5,
        reason: null,
        reconnecting: false,
      });
    });

    expect(container.querySelector(".disconnect-banner")).not.toBeNull();

    // Then: reconnect
    await act(async () => {
      conn.fireDisconnectState({
        disconnected: false,
        countdown: 0,
        reason: null,
        reconnecting: false,
      });
    });

    expect(container.querySelector(".disconnect-banner")).toBeNull();
  });
});

describe("DisconnectBanner – null connection", () => {
  it("renders nothing when connection is null", () => {
    const { container } = render(<DisconnectBanner connection={null} />);
    expect(container.querySelector(".disconnect-banner")).toBeNull();
  });
});
