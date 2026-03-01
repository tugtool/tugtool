/**
 * CardFrame React component RTL tests — Step 7.
 *
 * Tests cover:
 * - Renders header, content area, and 8 resize handles
 * - onPointerDown on root fires onFocus callback
 * - onPointerDown on header initiates drag (onDragStart handling)
 * - onMoveEnd callback receives final position after drag sequence
 * - onResizeEnd callback receives final geometry after resize sequence
 * - zIndex prop applied to root element style
 * - isKey prop flows to CardHeader
 * - children rendered inside card-frame-content
 * - External rootRef provided by DeckCanvas PanelContainer registers element
 *
 * Spec S03
 * [D02] React synthetic events
 * [D03] Ref-based style mutation during drag
 * [D04] Unified single React root — forwardRef/useImperativeHandle removed
 */
import "./setup-rtl";

import React, { createRef, useRef } from "react";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import { CardFrame } from "@/components/chrome/card-frame";
import type { CardFrameCallbacks } from "@/components/chrome/card-frame";
import type { CardState } from "@/layout-tree";

// ---- Setup ----

// Provide PointerEvent stub for happy-dom environments
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

// ---- Helpers ----

function makeCardState(
  x = 100,
  y = 100,
  width = 400,
  height = 300,
  title = "Test Panel"
): CardState {
  const tabId = `tab-${Math.random().toString(36).slice(2)}`;
  return {
    id: `panel-${Math.random().toString(36).slice(2)}`,
    position: { x, y },
    size: { width, height },
    tabs: [{ id: tabId, componentId: "terminal", title, closable: true }],
    activeTabId: tabId,
  };
}

function makeCallbacks(overrides: Partial<CardFrameCallbacks> = {}): {
  callbacks: CardFrameCallbacks;
  onMoveEnd: ReturnType<typeof mock>;
  onResizeEnd: ReturnType<typeof mock>;
  onFocus: ReturnType<typeof mock>;
  onClose: ReturnType<typeof mock>;
} {
  const onMoveEnd = mock((_x: number, _y: number) => {});
  const onResizeEnd = mock(
    (_x: number, _y: number, _w: number, _h: number) => {}
  );
  const onFocus = mock((_opts?: { suppressZOrder?: boolean }) => {});
  const onClose = mock(() => {});

  const callbacks: CardFrameCallbacks = {
    onMoveEnd,
    onResizeEnd,
    onFocus,
    onClose,
    ...overrides,
  };
  return { callbacks, onMoveEnd, onResizeEnd, onFocus, onClose };
}

function makeCanvasEl(width = 1280, height = 800): HTMLElement {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  document.body.appendChild(el);
  return el;
}

function renderFrame(
  overrides: Partial<{
    panelState: CardState;
    isKey: boolean;
    zIndex: number;
    callbacks: CardFrameCallbacks;
    canvasEl: HTMLElement;
    children: React.ReactNode;
  }> = {}
) {
  const canvasEl = overrides.canvasEl ?? makeCanvasEl();
  const { callbacks } = overrides.callbacks
    ? { callbacks: overrides.callbacks }
    : makeCallbacks();
  const panelState = overrides.panelState ?? makeCardState();

  const result = render(
    <CardFrame
      panelState={panelState}
      meta={{
        title: panelState.tabs[0]?.title ?? "Panel",
        icon: "Box",
        closable: true,
        menuItems: [],
      }}
      isKey={overrides.isKey ?? false}
      zIndex={overrides.zIndex ?? 100}
      canvasEl={canvasEl}
      callbacks={callbacks}
    >
      {overrides.children}
    </CardFrame>
  );

  return { ...result, panelState, canvasEl, callbacks };
}

// ---- Tests ----

describe("CardFrame – DOM structure", () => {
  it("renders .card-frame root element", () => {
    const { container } = renderFrame();
    expect(container.querySelector(".card-frame")).not.toBeNull();
  });

  it("renders .card-header inside card-frame", () => {
    const { container } = renderFrame();
    expect(container.querySelector(".card-frame .card-header")).not.toBeNull();
  });

  it("renders .card-frame-content area", () => {
    const { container } = renderFrame();
    expect(
      container.querySelector(".card-frame .card-frame-content")
    ).not.toBeNull();
  });

  it("renders all 8 resize handles", () => {
    const { container } = renderFrame();
    for (const dir of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
      expect(
        container.querySelector(`.card-frame-resize-${dir}`)
      ).not.toBeNull();
    }
  });

  it("applies zIndex prop to root element style", () => {
    const { container } = renderFrame({ zIndex: 150 });
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    expect(root.style.zIndex).toBe("150");
  });

  it("applies initial position from panelState", () => {
    const { container } = renderFrame({
      panelState: makeCardState(200, 150, 400, 300),
    });
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    expect(root.style.left).toBe("200px");
    expect(root.style.top).toBe("150px");
  });

  it("applies initial size from panelState", () => {
    const { container } = renderFrame({
      panelState: makeCardState(100, 100, 500, 400),
    });
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    expect(root.style.width).toBe("500px");
    expect(root.style.height).toBe("400px");
  });

  it("renders children inside card-frame-content", () => {
    const { container } = renderFrame({
      children: <div data-testid="child-content">child</div>,
    });
    const content = container.querySelector(".card-frame-content")!;
    expect(content.querySelector("[data-testid='child-content']")).not.toBeNull();
  });
});

describe("CardFrame – isKey prop", () => {
  it("isKey=true flows card-header-key class to CardHeader", () => {
    const { container } = renderFrame({ isKey: true });
    expect(container.querySelector(".card-header-key")).not.toBeNull();
  });

  it("isKey=false does not apply card-header-key class", () => {
    const { container } = renderFrame({ isKey: false });
    expect(container.querySelector(".card-header-key")).toBeNull();
  });
});

describe("CardFrame – onFocus callback", () => {
  it("onPointerDown on root fires onFocus callback", () => {
    const onFocus = mock((_opts?: { suppressZOrder?: boolean }) => {});
    const { callbacks } = makeCallbacks({ onFocus });
    const { container } = renderFrame({ callbacks });
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 150, clientY: 150 });
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("onFocus called with suppressZOrder=true when metaKey is pressed", () => {
    const onFocus = mock((_opts?: { suppressZOrder?: boolean }) => {});
    const { callbacks } = makeCallbacks({ onFocus });
    const { container } = renderFrame({ callbacks });
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    fireEvent.pointerDown(root, {
      pointerId: 1,
      clientX: 150,
      clientY: 150,
      metaKey: true,
    });
    expect(onFocus).toHaveBeenCalledTimes(1);
    const callArg = (onFocus.mock.calls[0] as [{ suppressZOrder?: boolean }])[0];
    expect(callArg?.suppressZOrder).toBe(true);
  });
});

describe("CardFrame – header drag (onDragStart)", () => {
  it("onPointerDown on header initiates drag (onDragStart propagated)", () => {
    const onMoving = mock((_x: number, _y: number) => ({ x: _x, y: _y }));
    const { callbacks } = makeCallbacks({ onMoving });
    const canvasEl = makeCanvasEl(1280, 800);
    const { container } = renderFrame({
      panelState: makeCardState(100, 100, 400, 300),
      callbacks,
      canvasEl,
    });

    const header = container.querySelector<HTMLElement>(".card-header")!;
    fireEvent.pointerDown(header, { pointerId: 1, clientX: 200, clientY: 110 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 215, clientY: 125 });

    expect(onMoving.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("onMoveEnd callback receives final position after drag sequence", () => {
    const onMoveEnd = mock((_x: number, _y: number) => {});
    const canvasEl = makeCanvasEl(1280, 800);
    const { callbacks } = makeCallbacks({ onMoveEnd });
    const { container } = renderFrame({
      panelState: makeCardState(100, 100, 400, 300),
      callbacks,
      canvasEl,
    });

    const header = container.querySelector<HTMLElement>(".card-header")!;
    fireEvent.pointerDown(header, { pointerId: 1, clientX: 200, clientY: 110 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 220, clientY: 130 });
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 220, clientY: 130 });

    expect(onMoveEnd).toHaveBeenCalledTimes(1);
    const [x, y] = onMoveEnd.mock.calls[0] as [number, number];
    expect(x).toBe(120);
    expect(y).toBe(120);
  });

  it("small movement (< threshold) does not fire onMoveEnd", () => {
    const onMoveEnd = mock((_x: number, _y: number) => {});
    const canvasEl = makeCanvasEl(1280, 800);
    const { callbacks } = makeCallbacks({ onMoveEnd });
    const { container } = renderFrame({
      panelState: makeCardState(100, 100, 400, 300),
      callbacks,
      canvasEl,
    });

    const header = container.querySelector<HTMLElement>(".card-header")!;
    fireEvent.pointerDown(header, { pointerId: 1, clientX: 200, clientY: 110 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 202, clientY: 110 });
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 202, clientY: 110 });

    expect(onMoveEnd).not.toHaveBeenCalled();
  });
});

describe("CardFrame – resize drag", () => {
  it("onResizeEnd callback receives final geometry after east resize", () => {
    const onResizeEnd = mock(
      (_x: number, _y: number, _w: number, _h: number) => {}
    );
    const canvasEl = makeCanvasEl(1280, 800);
    const { callbacks } = makeCallbacks({ onResizeEnd });
    const { container } = renderFrame({
      panelState: makeCardState(100, 100, 400, 300),
      callbacks,
      canvasEl,
    });

    const eHandle =
      container.querySelector<HTMLElement>(".card-frame-resize-e")!;
    fireEvent.pointerDown(eHandle, { pointerId: 1, clientX: 500, clientY: 200 });
    fireEvent.pointerMove(eHandle, { pointerId: 1, clientX: 550, clientY: 200 });
    fireEvent.pointerUp(eHandle, { pointerId: 1, clientX: 550, clientY: 200 });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    const [x, y, w, h] = onResizeEnd.mock.calls[0] as [number, number, number, number];
    expect(x).toBe(100);
    expect(y).toBe(100);
    expect(w).toBe(450);
    expect(h).toBe(300);
  });

  it("onResizeEnd callback receives final geometry after south resize", () => {
    const onResizeEnd = mock(
      (_x: number, _y: number, _w: number, _h: number) => {}
    );
    const canvasEl = makeCanvasEl(1280, 800);
    const { callbacks } = makeCallbacks({ onResizeEnd });
    const { container } = renderFrame({
      panelState: makeCardState(100, 100, 400, 300),
      callbacks,
      canvasEl,
    });

    const sHandle =
      container.querySelector<HTMLElement>(".card-frame-resize-s")!;
    fireEvent.pointerDown(sHandle, { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerMove(sHandle, { pointerId: 1, clientX: 300, clientY: 450 });
    fireEvent.pointerUp(sHandle, { pointerId: 1, clientX: 300, clientY: 450 });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    const [x, y, w, h] = onResizeEnd.mock.calls[0] as [number, number, number, number];
    expect(x).toBe(100);
    expect(y).toBe(100);
    expect(w).toBe(400);
    expect(h).toBe(350);
  });
});

describe("CardFrame – external rootRef", () => {
  it("external rootRef provided via rootRef prop is populated after render", async () => {
    const rootRef = createRef<HTMLDivElement>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();

    render(
      <CardFrame
        rootRef={rootRef}
        panelState={makeCardState()}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    expect(rootRef.current).not.toBeNull();
    expect(rootRef.current?.classList.contains("card-frame")).toBe(true);
  });

  it("direct DOM mutations via rootRef update element styles", async () => {
    const rootRef = createRef<HTMLDivElement>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();

    render(
      <CardFrame
        rootRef={rootRef}
        panelState={makeCardState(100, 100)}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});

    // Simulate DeckCanvas imperative update
    if (rootRef.current) {
      rootRef.current.style.left = "250px";
      rootRef.current.style.top = "180px";
    }
    expect(rootRef.current?.style.left).toBe("250px");
    expect(rootRef.current?.style.top).toBe("180px");
  });
});
