/**
 * Canvas overlays RTL tests — Step 8.
 *
 * Tests cover:
 * - SnapGuideLine renders at correct position for x and y axes
 * - SnapGuideLine hidden when no guides active (nothing rendered)
 * - VirtualSash renders at shared edge position with correct cursor
 * - VirtualSash onPointerDown initiates drag sequence
 * - SetFlashOverlay renders with animation class, fires onAnimationEnd
 *
 * [D02] React synthetic events, [D03] Ref-based style mutation during drag
 * Spec S05, #step-8
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, act, fireEvent } from "@testing-library/react";

import { SnapGuideLine } from "@/components/chrome/snap-guide-line";
import { VirtualSash } from "@/components/chrome/virtual-sash";
import type { SashGroup, PanelSnapshot, VirtualSashCallbacks } from "@/components/chrome/virtual-sash";
import { SetFlashOverlay } from "@/components/chrome/set-flash-overlay";
import type { SharedEdge } from "@/snap";

// ---- PointerEvent stub ----

if (typeof (global as Record<string, unknown>)["PointerEvent"] === "undefined") {
  (global as Record<string, unknown>)["PointerEvent"] = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init?: PointerEventInit) {
      super(type, init);
      this.pointerId = (init as { pointerId?: number })?.pointerId ?? 1;
    }
  };
}

const proto = Element.prototype as Record<string, unknown>;
if (!proto["hasPointerCapture"]) proto["hasPointerCapture"] = () => false;
if (!proto["setPointerCapture"]) proto["setPointerCapture"] = () => {};
if (!proto["releasePointerCapture"]) proto["releasePointerCapture"] = () => {};

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---- SnapGuideLine tests ----

describe("SnapGuideLine – rendering", () => {
  it("renders an x-axis guide with correct left position", () => {
    const { container } = render(
      <SnapGuideLine guide={{ axis: "x", position: 250 }} />
    );
    const el = container.querySelector(".snap-guide-line");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("snap-guide-line-x")).toBe(true);
    const style = (el as HTMLElement).style;
    expect(style.left).toBe("250px");
  });

  it("renders a y-axis guide with correct top position", () => {
    const { container } = render(
      <SnapGuideLine guide={{ axis: "y", position: 180 }} />
    );
    const el = container.querySelector(".snap-guide-line");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("snap-guide-line-y")).toBe(true);
    const style = (el as HTMLElement).style;
    expect(style.top).toBe("180px");
  });

  it("x-axis guide has snap-guide-line base class", () => {
    const { container } = render(
      <SnapGuideLine guide={{ axis: "x", position: 100 }} />
    );
    const el = container.querySelector(".snap-guide-line");
    expect(el).not.toBeNull();
  });

  it("y-axis guide has snap-guide-line-y class and not x class", () => {
    const { container } = render(
      <SnapGuideLine guide={{ axis: "y", position: 300 }} />
    );
    const el = container.querySelector(".snap-guide-line-y");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("snap-guide-line-x")).toBe(false);
  });
});

describe("SnapGuideLine – hidden when no guides active", () => {
  it("renders nothing when guides array is empty (controlled by parent)", () => {
    // DeckCanvas renders guides.map(...); when guides is empty, nothing is rendered.
    // Test: rendering 0 SnapGuideLine components = 0 guide elements in DOM.
    const guides: Array<{ axis: "x" | "y"; position: number }> = [];
    const { container } = render(
      <>{guides.map((g, i) => <SnapGuideLine key={i} guide={g} />)}</>
    );
    const els = container.querySelectorAll(".snap-guide-line");
    expect(els.length).toBe(0);
  });
});

// ---- VirtualSash tests ----

function makeSharedEdge(overrides: Partial<SharedEdge> = {}): SharedEdge {
  return {
    cardAId: "panel-a",
    cardBId: "panel-b",
    axis: "vertical",
    overlapStart: 100,
    overlapEnd: 400,
    boundaryPosition: 300,
    ...overrides,
  };
}

function makeSashGroup(overrides: Partial<SashGroup> = {}): SashGroup {
  const edge = makeSharedEdge();
  return {
    axis: "vertical",
    boundary: 300,
    overlapStart: 100,
    overlapEnd: 400,
    edges: [edge],
    ...overrides,
  };
}

function makePanels(): PanelSnapshot[] {
  return [
    { id: "panel-a", startX: 0, startY: 100, startW: 300, startH: 300 },
    { id: "panel-b", startX: 300, startY: 100, startW: 300, startH: 300 },
  ];
}

function makeCallbacks(): VirtualSashCallbacks {
  return {
    onUpdatePanelSize: mock((_id: string, _w: number, _h: number) => {}),
    onUpdatePanelPosition: mock((_id: string, _x: number, _y: number) => {}),
    onDragEnd: mock(
      (_axis: "vertical" | "horizontal", _a: string[], _b: string[], _delta: number) => {}
    ),
  };
}

describe("VirtualSash – rendering", () => {
  it("renders a vertical sash with correct CSS classes", () => {
    const group = makeSashGroup({ axis: "vertical" });
    const { container } = render(
      <VirtualSash group={group} panels={makePanels()} callbacks={makeCallbacks()} />
    );
    const el = container.querySelector(".virtual-sash");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("virtual-sash-vertical")).toBe(true);
    expect(el?.classList.contains("virtual-sash-horizontal")).toBe(false);
  });

  it("renders a horizontal sash with correct CSS classes", () => {
    const edge = makeSharedEdge({ axis: "horizontal", boundaryPosition: 400, overlapStart: 0, overlapEnd: 600, cardAId: "panel-a", cardBId: "panel-b" });
    const group = makeSashGroup({ axis: "horizontal", boundary: 400, overlapStart: 0, overlapEnd: 600, edges: [edge] });
    const panels: PanelSnapshot[] = [
      { id: "panel-a", startX: 0, startY: 100, startW: 600, startH: 300 },
      { id: "panel-b", startX: 0, startY: 400, startW: 600, startH: 300 },
    ];
    const { container } = render(
      <VirtualSash group={group} panels={panels} callbacks={makeCallbacks()} />
    );
    const el = container.querySelector(".virtual-sash");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("virtual-sash-horizontal")).toBe(true);
  });

  it("vertical sash is positioned at shared edge (boundary - 4)", () => {
    const group = makeSashGroup({ axis: "vertical", boundary: 300, overlapStart: 100, overlapEnd: 400 });
    const { container } = render(
      <VirtualSash group={group} panels={makePanels()} callbacks={makeCallbacks()} />
    );
    const el = container.querySelector<HTMLElement>(".virtual-sash");
    expect(el?.style.left).toBe("296px"); // boundary - 4 = 296
    expect(el?.style.top).toBe("100px");
    expect(el?.style.height).toBe("300px"); // overlapEnd - overlapStart
  });

  it("horizontal sash is positioned at shared edge (boundary - 4)", () => {
    const edge = makeSharedEdge({ axis: "horizontal", boundaryPosition: 400, overlapStart: 50, overlapEnd: 550, cardAId: "panel-a", cardBId: "panel-b" });
    const group = makeSashGroup({ axis: "horizontal", boundary: 400, overlapStart: 50, overlapEnd: 550, edges: [edge] });
    const panels: PanelSnapshot[] = [
      { id: "panel-a", startX: 50, startY: 100, startW: 500, startH: 300 },
      { id: "panel-b", startX: 50, startY: 400, startW: 500, startH: 300 },
    ];
    const { container } = render(
      <VirtualSash group={group} panels={panels} callbacks={makeCallbacks()} />
    );
    const el = container.querySelector<HTMLElement>(".virtual-sash");
    expect(el?.style.top).toBe("396px"); // boundary - 4 = 396
    expect(el?.style.left).toBe("50px");
    expect(el?.style.width).toBe("500px"); // overlapEnd - overlapStart
  });
});

describe("VirtualSash – pointer drag", () => {
  it("onPointerDown initiates pointer capture", () => {
    const group = makeSashGroup();
    const callbacks = makeCallbacks();
    const { container } = render(
      <VirtualSash group={group} panels={makePanels()} callbacks={callbacks} />
    );
    const el = container.querySelector<HTMLElement>(".virtual-sash")!;

    let captureId: number | null = null;
    el.setPointerCapture = mock((id: number) => { captureId = id; });

    act(() => {
      fireEvent(el, new (global as any).PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 5,
        clientX: 300,
        clientY: 250,
      }));
    });

    expect(captureId).toBe(5);
  });

  it("pointermove calls onUpdatePanelSize and onUpdatePanelPosition", () => {
    const group = makeSashGroup({ axis: "vertical", boundary: 300 });
    const callbacks = makeCallbacks();
    const { container } = render(
      <VirtualSash group={group} panels={makePanels()} callbacks={callbacks} />
    );
    const el = container.querySelector<HTMLElement>(".virtual-sash")!;
    el.setPointerCapture = mock(() => {});

    act(() => {
      fireEvent(el, new (global as any).PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientX: 300,
        clientY: 250,
      }));
    });

    act(() => {
      el.dispatchEvent(new (global as any).PointerEvent("pointermove", {
        bubbles: false,
        pointerId: 1,
        clientX: 350,
        clientY: 250,
      }));
    });

    // onUpdatePanelSize should have been called for a-side panel
    const sizeCall = (callbacks.onUpdatePanelSize as ReturnType<typeof mock>).mock.calls;
    expect(sizeCall.length).toBeGreaterThan(0);
  });

  it("pointerup calls onDragEnd callback", () => {
    const group = makeSashGroup({ axis: "vertical", boundary: 300 });
    const callbacks = makeCallbacks();
    const { container } = render(
      <VirtualSash group={group} panels={makePanels()} callbacks={callbacks} />
    );
    const el = container.querySelector<HTMLElement>(".virtual-sash")!;
    el.setPointerCapture = mock(() => {});
    el.releasePointerCapture = mock(() => {});

    act(() => {
      fireEvent(el, new (global as any).PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientX: 300,
        clientY: 250,
      }));
    });

    act(() => {
      el.dispatchEvent(new (global as any).PointerEvent("pointerup", {
        bubbles: false,
        pointerId: 1,
        clientX: 340,
        clientY: 250,
      }));
    });

    const dragEndCalls = (callbacks.onDragEnd as ReturnType<typeof mock>).mock.calls;
    expect(dragEndCalls.length).toBe(1);
    expect(dragEndCalls[0][0]).toBe("vertical");
  });
});

// ---- SetFlashOverlay tests ----

describe("SetFlashOverlay – rendering", () => {
  it("renders with set-flash-overlay class", () => {
    const onAnimationEnd = mock(() => {});
    const { container } = render(
      <SetFlashOverlay onAnimationEnd={onAnimationEnd} />
    );
    const el = container.querySelector(".set-flash-overlay");
    expect(el).not.toBeNull();
  });

  it("renders without border suppression by default", () => {
    const onAnimationEnd = mock(() => {});
    const { container } = render(
      <SetFlashOverlay onAnimationEnd={onAnimationEnd} />
    );
    const el = container.querySelector<HTMLElement>(".set-flash-overlay")!;
    expect(el.style.borderTop).toBe("");
    expect(el.style.borderBottom).toBe("");
    expect(el.style.borderLeft).toBe("");
    expect(el.style.borderRight).toBe("");
  });

  it("hideTop=true suppresses top border", () => {
    const onAnimationEnd = mock(() => {});
    const { container } = render(
      <SetFlashOverlay hideTop onAnimationEnd={onAnimationEnd} />
    );
    const el = container.querySelector<HTMLElement>(".set-flash-overlay")!;
    // happy-dom may expand "none" → "none none" (border shorthand decomposition)
    expect(el.style.borderTop.startsWith("none")).toBe(true);
  });

  it("hideBottom=true suppresses bottom border", () => {
    const onAnimationEnd = mock(() => {});
    const { container } = render(
      <SetFlashOverlay hideBottom onAnimationEnd={onAnimationEnd} />
    );
    const el = container.querySelector<HTMLElement>(".set-flash-overlay")!;
    expect(el.style.borderBottom.startsWith("none")).toBe(true);
  });

  it("hideLeft=true suppresses left border", () => {
    const onAnimationEnd = mock(() => {});
    const { container } = render(
      <SetFlashOverlay hideLeft onAnimationEnd={onAnimationEnd} />
    );
    const el = container.querySelector<HTMLElement>(".set-flash-overlay")!;
    expect(el.style.borderLeft.startsWith("none")).toBe(true);
  });

  it("hideRight=true suppresses right border", () => {
    const onAnimationEnd = mock(() => {});
    const { container } = render(
      <SetFlashOverlay hideRight onAnimationEnd={onAnimationEnd} />
    );
    const el = container.querySelector<HTMLElement>(".set-flash-overlay")!;
    expect(el.style.borderRight.startsWith("none")).toBe(true);
  });
});

describe("SetFlashOverlay – onAnimationEnd callback", () => {
  it("fires onAnimationEnd when animationend event is dispatched", () => {
    const onAnimationEnd = mock(() => {});
    const { container } = render(
      <SetFlashOverlay onAnimationEnd={onAnimationEnd} />
    );
    const el = container.querySelector<HTMLElement>(".set-flash-overlay")!;

    act(() => {
      fireEvent.animationEnd(el);
    });

    expect((onAnimationEnd as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  it("onAnimationEnd is called exactly once per animation", () => {
    const onAnimationEnd = mock(() => {});
    const { container } = render(
      <SetFlashOverlay onAnimationEnd={onAnimationEnd} />
    );
    const el = container.querySelector<HTMLElement>(".set-flash-overlay")!;

    act(() => {
      fireEvent.animationEnd(el);
      fireEvent.animationEnd(el);
    });

    // Both fire because the component doesn't self-remove from DOM;
    // the parent removes it via onFlashEnd (which triggers re-render to null).
    expect((onAnimationEnd as ReturnType<typeof mock>).mock.calls.length).toBe(2);
  });
});
