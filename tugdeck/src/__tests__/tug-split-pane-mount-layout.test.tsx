/**
 * react-resizable-panels mount-time `onLayoutChanged` behavior test.
 *
 * The TugSplitPane primitive's `handleLayoutChanged` is the ONLY writer of
 * the userSize map + tugbank. On fresh mount with no stored layout
 * (user has never dragged), the userSize map starts empty. If the
 * library fires `onLayoutChanged` at initial layout resolution, our
 * handler seeds the map from the resolved-defaultSize values and
 * `restoreUserSize()` works on snap-back. If the library does NOT fire
 * at mount, the map stays empty, `restoreUserSize()` returns 0, and
 * submit-after-grow leaves the pane at the grown transient size.
 *
 * This test directly probes the library, not the wrapper — the wrapper's
 * behavior is a straight consequence of the library's callback timing.
 *
 * Environment caveat: happy-dom does not perform real layout, so the
 * library's percentage math may or may not resolve to exact input
 * values. The test verifies the callback FIRES with a non-empty layout
 * for the declared panel ids; exact values are not the point.
 */

import "./setup-rtl";
import React from "react";
import { describe, test, expect, beforeEach } from "bun:test";
import { render } from "@testing-library/react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";

describe("react-resizable-panels mount-time onLayoutChanged", () => {
  let fires: Layout[] = [];

  beforeEach(() => {
    fires = [];
  });

  test("fires for initial layout resolution with defaultSize props", () => {
    render(
      <Group
        orientation="vertical"
        onLayoutChanged={(layout) => { fires.push({ ...layout }); }}
      >
        <Panel id="top" defaultSize="70%" />
        <Separator />
        <Panel id="bottom" defaultSize="30%" />
      </Group>,
    );

    // If the library fires at mount, fires should have at least one
    // entry covering both panel ids. If not, this test fails and we
    // know we need a different mount-time seeding strategy in
    // TugSplitPane.handleLayoutChanged.
    expect(fires.length).toBeGreaterThan(0);
    const lastFire = fires[fires.length - 1]!;
    expect(Object.keys(lastFire).sort()).toEqual(["bottom", "top"]);
  });

  test("fires for initial layout with defaultLayout prop", () => {
    render(
      <Group
        orientation="vertical"
        defaultLayout={{ top: 65, bottom: 35 }}
        onLayoutChanged={(layout) => { fires.push({ ...layout }); }}
      >
        <Panel id="top" defaultSize="50%" />
        <Separator />
        <Panel id="bottom" defaultSize="50%" />
      </Group>,
    );

    expect(fires.length).toBeGreaterThan(0);
    const lastFire = fires[fires.length - 1]!;
    expect(Object.keys(lastFire).sort()).toEqual(["bottom", "top"]);
  });
});
