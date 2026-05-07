/**
 * TugPaneBanner unit tests — card-scoped modal banner.
 *
 * Covers the 7 cases from the plan's § Tests section plus the R2 risk
 * (inert cleanup on unmount). The WAAPI mock installed by setup-rtl
 * lets us drive animations to completion deterministically and assert
 * on the post-animation DOM state.
 *
 * Note: setup-rtl MUST be the first import.
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act, waitFor } from "@testing-library/react";

import { TugPaneBanner } from "@/components/tugways/tug-pane-banner";
import { TugPanePortalContext } from "@/components/chrome/tug-pane";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderInCard(ui: React.ReactElement) {
  const cardEl = document.createElement("div");
  cardEl.className = "tug-pane-chrome";
  const cardBody = document.createElement("div");
  cardBody.className = "tug-pane-body";
  cardEl.appendChild(cardBody);
  document.body.appendChild(cardEl);

  const result = render(
    <TugPanePortalContext.Provider value={cardEl}>
      {ui}
    </TugPanePortalContext.Provider>,
  );

  return {
    ...result,
    cardEl,
    cardBody,
    cleanupCard: () => {
      if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    },
  };
}

function getBanner(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot=\"tug-pane-banner\"]");
}

function resolveAllWaapiAnimations() {
  const mock = (global as unknown as {
    __waapi_mock__: { calls: Array<{ resolve: () => void }>; reset: () => void };
  }).__waapi_mock__;
  for (const call of mock.calls) call.resolve();
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(".tug-pane-chrome").forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
  const mock = (global as unknown as {
    __waapi_mock__: { reset: () => void };
  }).__waapi_mock__;
  mock.reset();
});

// ---------------------------------------------------------------------------
// 1. Renders without throwing inside a card portal context
// ---------------------------------------------------------------------------

describe("TugPaneBanner — mount + props", () => {
  it("T-CARDBANNER-01: renders without throwing when visible=false (nothing in DOM)", () => {
    const { cleanupCard } = renderInCard(
      <TugPaneBanner visible={false} message="hello" />,
    );
    expect(getBanner()).toBeNull();
    cleanupCard();
  });

  // -------------------------------------------------------------------------
  // 2. visible=true mounts; visible=false unmounts after exit animation
  // -------------------------------------------------------------------------

  it("T-CARDBANNER-02: visible=true mounts, visible=false removes after exit animation", async () => {
    // Opt out of the min-mount-time gate so the exit animation runs
    // immediately on visible=false (this test verifies the bare
    // animation path, not the gate's deferral).
    const { rerender, cleanupCard } = renderInCard(
      <TugPaneBanner visible={false} minMountedMs={0} message="m" />,
    );
    expect(getBanner()).toBeNull();

    // Visible → mounted (one layout-effect round to set mounted=true).
    act(() => {
      rerender(
        <TugPanePortalContext.Provider value={document.querySelector(".tug-pane-chrome")!}>
          <TugPaneBanner visible={true} minMountedMs={0} message="m" />
        </TugPanePortalContext.Provider>,
      );
    });
    expect(getBanner()).not.toBeNull();

    // Flip visible false. The banner stays mounted during the exit
    // animation; only after .finished resolves does it unmount.
    act(() => {
      rerender(
        <TugPanePortalContext.Provider value={document.querySelector(".tug-pane-chrome")!}>
          <TugPaneBanner visible={false} minMountedMs={0} message="m" />
        </TugPanePortalContext.Provider>,
      );
    });
    expect(getBanner()).not.toBeNull();

    await act(async () => {
      resolveAllWaapiAnimations();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(getBanner()).toBeNull();
    });
    cleanupCard();
  });

  // -------------------------------------------------------------------------
  // 3. data-variant / data-tone / data-visible attributes reflect props
  // -------------------------------------------------------------------------

  it("T-CARDBANNER-03: data-variant, data-tone, data-visible reflect props", () => {
    const { cleanupCard } = renderInCard(
      <TugPaneBanner
        visible={true}
        variant="error"
        tone="caution"
        message="m"
      />,
    );
    const el = getBanner();
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-variant")).toBe("error");
    expect(el!.getAttribute("data-tone")).toBe("caution");
    expect(el!.getAttribute("data-visible")).toBe("true");
    cleanupCard();
  });

  // -------------------------------------------------------------------------
  // 4. inert appears on .tug-pane-body when visible=true; disappears on exit
  // -------------------------------------------------------------------------

  it("T-CARDBANNER-04: inert on .tug-pane-body while mounted; released after exit animation", async () => {
    // Opt out of the min-mount-time gate so the exit animation runs
    // immediately and inert release happens on the same WAAPI .finished
    // tick (not after the gate's deferral).
    const { cardBody, rerender, cleanupCard } = renderInCard(
      <TugPaneBanner visible={true} minMountedMs={0} message="m" />,
    );
    expect(cardBody.hasAttribute("inert")).toBe(true);

    act(() => {
      rerender(
        <TugPanePortalContext.Provider value={document.querySelector(".tug-pane-chrome")!}>
          <TugPaneBanner visible={false} minMountedMs={0} message="m" />
        </TugPanePortalContext.Provider>,
      );
    });
    // Still inert during exit animation.
    expect(cardBody.hasAttribute("inert")).toBe(true);

    await act(async () => {
      resolveAllWaapiAnimations();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(cardBody.hasAttribute("inert")).toBe(false);
    });
    cleanupCard();
  });

  // -------------------------------------------------------------------------
  // 5. contained=true skips inert application
  // -------------------------------------------------------------------------

  it("T-CARDBANNER-05: contained=true leaves .tug-pane-body interactive", () => {
    const { cardBody, cleanupCard } = renderInCard(
      <TugPaneBanner visible={true} contained={true} message="m" />,
    );
    expect(getBanner()).not.toBeNull();
    expect(cardBody.hasAttribute("inert")).toBe(false);
    cleanupCard();
  });

  // -------------------------------------------------------------------------
  // 6. label / message / footer / children content renders correctly
  // -------------------------------------------------------------------------

  it("T-CARDBANNER-06: renders label, message, children body, and footer", () => {
    const { getByText, cleanupCard } = renderInCard(
      <TugPaneBanner
        visible={true}
        variant="error"
        label="Connection lost"
        message="transport closed"
        footer={<button type="button">Dismiss</button>}
      >
        <p>Detail body content.</p>
      </TugPaneBanner>,
    );
    expect(getByText("Connection lost")).not.toBeNull();
    expect(getByText("transport closed")).not.toBeNull();
    expect(getByText("Detail body content.")).not.toBeNull();
    expect(getByText("Dismiss")).not.toBeNull();
    cleanupCard();
  });

  // -------------------------------------------------------------------------
  // 7. Tone attribute flips on re-render
  // -------------------------------------------------------------------------

  it("T-CARDBANNER-07: tone attribute updates on prop change", () => {
    const { rerender, cleanupCard } = renderInCard(
      <TugPaneBanner visible={true} tone="danger" message="m" />,
    );
    expect(getBanner()!.getAttribute("data-tone")).toBe("danger");

    act(() => {
      rerender(
        <TugPanePortalContext.Provider value={document.querySelector(".tug-pane-chrome")!}>
          <TugPaneBanner visible={true} tone="default" message="m" />
        </TugPanePortalContext.Provider>,
      );
    });
    expect(getBanner()!.getAttribute("data-tone")).toBe("default");
    cleanupCard();
  });

  // -------------------------------------------------------------------------
  // R2 — unmount while visible=true clears inert
  // -------------------------------------------------------------------------

  it("T-CARDBANNER-R2: unmounting a visible banner clears inert on the body", () => {
    const { cardBody, unmount, cleanupCard } = renderInCard(
      <TugPaneBanner visible={true} message="m" />,
    );
    expect(cardBody.hasAttribute("inert")).toBe(true);

    act(() => {
      unmount();
    });
    expect(cardBody.hasAttribute("inert")).toBe(false);
    cleanupCard();
  });

  // -------------------------------------------------------------------------
  // Status variant — minimal strip-only render
  // -------------------------------------------------------------------------

  it("T-CARDBANNER-08: status variant renders strip only (no detail panel)", () => {
    const { cleanupCard } = renderInCard(
      <TugPaneBanner visible={true} variant="status" message="heads up" />,
    );
    const el = getBanner();
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-variant")).toBe("status");
    expect(el!.querySelector(".tug-pane-banner-strip")).not.toBeNull();
    expect(el!.querySelector(".tug-pane-banner-detail-panel")).toBeNull();
    cleanupCard();
  });
});

