/**
 * CardPortal — portal component that renders its children into a stable
 * slot and moves that slot between host pane content elements via
 * `appendChild` as the host changes.
 *
 * Tests cover: render-into-registered-element, re-root on hostCardId change,
 * **children are not unmounted across re-root**, mid-mount registration,
 * no unmount when the host unregisters temporarily.
 */
import "./setup-rtl";

import React, { useEffect } from "react";
import { describe, it, expect, beforeEach } from "bun:test";
import { render, act } from "@testing-library/react";

import { CardPortal } from "@/components/chrome/card-portal";
import * as paneContentRegistry from "@/components/chrome/pane-content-registry";

function makeDiv(): HTMLDivElement {
  const d = document.createElement("div");
  document.body.appendChild(d);
  return d;
}

/**
 * Probe component that increments mount/unmount counters. Used to assert the
 * portal does (or does not) unmount children across re-roots.
 */
function Probe({ counters, label }: {
  counters: { mount: number; unmount: number };
  label: string;
}) {
  useEffect(() => {
    counters.mount += 1;
    return () => {
      counters.unmount += 1;
    };
  }, []);
  return <div data-testid={label}>{label}</div>;
}

describe("CardPortal", () => {
  beforeEach(() => {
    paneContentRegistry._resetForTests();
    // Clean up any leftover DOM from previous tests.
    document.body.innerHTML = "";
  });

  it("renders children into the registered host element", () => {
    const host = makeDiv();
    paneContentRegistry.register("card-1", host);
    render(
      <CardPortal hostStackId="card-1">
        <div data-testid="portal-child">hello</div>
      </CardPortal>,
    );
    const child = host.querySelector('[data-testid="portal-child"]');
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe("hello");
  });

  it("does not insert into any registered host when hostCardId is unregistered", () => {
    const registeredHost = makeDiv();
    paneContentRegistry.register("other-card", registeredHost);
    render(
      <CardPortal hostStackId="missing">
        <div data-testid="portal-child">hello</div>
      </CardPortal>,
    );
    expect(registeredHost.querySelector('[data-testid="portal-child"]')).toBeNull();
  });

  it("re-roots into the new element when the registry updates", () => {
    const host1 = makeDiv();
    const host2 = makeDiv();
    paneContentRegistry.register("card-1", host1);
    render(
      <CardPortal hostStackId="card-1">
        <div data-testid="portal-child">hello</div>
      </CardPortal>,
    );
    expect(host1.querySelector('[data-testid="portal-child"]')).not.toBeNull();
    act(() => {
      paneContentRegistry.register("card-1", host2);
    });
    expect(host1.querySelector('[data-testid="portal-child"]')).toBeNull();
    expect(host2.querySelector('[data-testid="portal-child"]')).not.toBeNull();
  });

  it("does not unmount children when re-rooting to a new registered element", () => {
    const host1 = makeDiv();
    const host2 = makeDiv();
    const counters = { mount: 0, unmount: 0 };
    paneContentRegistry.register("card-1", host1);
    render(
      <CardPortal hostStackId="card-1">
        <Probe counters={counters} label="probe" />
      </CardPortal>,
    );
    expect(counters.mount).toBe(1);
    expect(counters.unmount).toBe(0);
    act(() => {
      paneContentRegistry.register("card-1", host2);
    });
    expect(counters.mount).toBe(1);
    expect(counters.unmount).toBe(0);
  });

  it("does not unmount children when hostCardId changes to a new registered card", () => {
    const hostA = makeDiv();
    const hostB = makeDiv();
    paneContentRegistry.register("card-A", hostA);
    paneContentRegistry.register("card-B", hostB);

    const counters = { mount: 0, unmount: 0 };

    function Shell({ hostStackId }: { hostStackId: string }) {
      return (
        <CardPortal hostStackId={hostStackId}>
          <Probe counters={counters} label="probe" />
        </CardPortal>
      );
    }

    const { rerender } = render(<Shell hostStackId="card-A" />);
    expect(counters.mount).toBe(1);
    expect(hostA.querySelector('[data-testid="probe"]')).not.toBeNull();

    rerender(<Shell hostStackId="card-B" />);
    expect(counters.mount).toBe(1);
    expect(counters.unmount).toBe(0);
    expect(hostA.querySelector('[data-testid="probe"]')).toBeNull();
    expect(hostB.querySelector('[data-testid="probe"]')).not.toBeNull();
  });

  it("becomes visible when the host registers mid-mount", () => {
    const host = makeDiv();
    render(
      <CardPortal hostStackId="card-1">
        <div data-testid="portal-child">hello</div>
      </CardPortal>,
    );
    expect(host.querySelector('[data-testid="portal-child"]')).toBeNull();

    act(() => {
      paneContentRegistry.register("card-1", host);
    });
    expect(host.querySelector('[data-testid="portal-child"]')).not.toBeNull();
  });

  it("does not unmount children when the host unregisters temporarily", () => {
    const host = makeDiv();
    paneContentRegistry.register("card-1", host);
    const counters = { mount: 0, unmount: 0 };
    render(
      <CardPortal hostStackId="card-1">
        <Probe counters={counters} label="probe" />
      </CardPortal>,
    );
    expect(counters.mount).toBe(1);
    act(() => {
      paneContentRegistry.unregister("card-1");
    });
    // Children stay mounted even though the host is gone — identity is
    // preserved across the dark window.
    expect(counters.mount).toBe(1);
    expect(counters.unmount).toBe(0);

    const hostLater = makeDiv();
    act(() => {
      paneContentRegistry.register("card-1", hostLater);
    });
    expect(counters.mount).toBe(1);
    expect(hostLater.querySelector('[data-testid="probe"]')).not.toBeNull();
  });

  it("unmounts children when the CardPortal itself unmounts", () => {
    const host = makeDiv();
    paneContentRegistry.register("card-1", host);
    const counters = { mount: 0, unmount: 0 };
    const { unmount } = render(
      <CardPortal hostStackId="card-1">
        <Probe counters={counters} label="probe" />
      </CardPortal>,
    );
    expect(counters.mount).toBe(1);
    unmount();
    expect(counters.unmount).toBe(1);
  });
});
