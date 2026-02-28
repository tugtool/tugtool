/**
 * CardFrame React component RTL tests.
 *
 * Tests cover:
 * - Renders header, content area, and 8 resize handles
 * - onPointerDown on root fires onFocus callback
 * - onPointerDown on header initiates drag (onDragStart handling)
 * - onMoveEnd callback receives final position after drag sequence
 * - onResizeEnd callback receives final geometry after resize sequence
 * - zIndex prop applied to root element style
 * - isKey prop flows to CardHeader
 * - Imperative handle: ref.current.setZIndex updates element style
 * - Imperative handle: ref.current.updatePosition/updateSize mutate element styles
 * - Imperative handle: ref.current.setKey toggles card-header-key class
 * - Imperative handle: ref.current.setDockedStyle applies squared corners and position offset
 * - Imperative handle: ref.current.resetDockedStyle restores default rounded corners
 *
 * Spec S03, Spec S03a
 * [D02] React synthetic events
 * [D03] Ref-based style mutation during drag
 * [D08] useImperativeHandle transition
 */
import "./setup-rtl";

import React, { createRef } from "react";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import { CardFrame } from "@/components/chrome/card-frame";
import type { CardFrameHandle, CardFrameCallbacks } from "@/components/chrome/card-frame";
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
  }> = {}
) {
  const canvasEl = overrides.canvasEl ?? makeCanvasEl();
  const { callbacks } = overrides.callbacks ? { callbacks: overrides.callbacks } : makeCallbacks();
  const ref = createRef<CardFrameHandle>();
  const panelState = overrides.panelState ?? makeCardState();

  const result = render(
    <CardFrame
      ref={ref}
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
    />
  );

  return { ...result, ref, panelState, canvasEl, callbacks };
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
    // pointerdown to start drag
    fireEvent.pointerDown(header, { pointerId: 1, clientX: 200, clientY: 110 });
    // Move with delta > DRAG_THRESHOLD_PX (3)
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 215, clientY: 125 });

    // onMoving should have been called (drag in progress)
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
    // dx=20, dy=20 from start (100,100), result = (120, 120)
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
    // Move only 2px (below 3px threshold)
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 202, clientY: 110 });
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 202, clientY: 110 });

    // No drag occurred
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
    expect(x).toBe(100); // x unchanged for east resize
    expect(y).toBe(100); // y unchanged
    expect(w).toBe(450); // width grew by 50px
    expect(h).toBe(300); // height unchanged
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
    expect(h).toBe(350); // height grew by 50px
  });
});

describe("CardFrame – imperative handle (ref.current)", () => {
  it("ref.current.setZIndex updates element style", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState()}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    ref.current!.setZIndex(200);
    expect(root.style.zIndex).toBe("200");
  });

  it("ref.current.updatePosition mutates element styles", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState(100, 100)}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    ref.current!.updatePosition(250, 180);
    expect(root.style.left).toBe("250px");
    expect(root.style.top).toBe("180px");
  });

  it("ref.current.updateSize mutates element styles", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState(100, 100, 400, 300)}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    ref.current!.updateSize(600, 450);
    expect(root.style.width).toBe("600px");
    expect(root.style.height).toBe("450px");
  });

  it("ref.current.setKey(true) toggles card-header-key class", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState()}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    expect(container.querySelector(".card-header-key")).toBeNull();

    await act(async () => {
      ref.current!.setKey(true);
    });

    expect(container.querySelector(".card-header-key")).not.toBeNull();
  });

  it("ref.current.setKey(false) removes card-header-key class", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState()}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={true}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    expect(container.querySelector(".card-header-key")).not.toBeNull();

    await act(async () => {
      ref.current!.setKey(false);
    });

    expect(container.querySelector(".card-header-key")).toBeNull();
  });

  it("ref.current.setDockedStyle applies squared corners and position offset", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState(100, 200)}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    // Apply squared bottom corners and -1px Y offset
    ref.current!.setDockedStyle([true, true, false, false], { dx: 0, dy: -1 });

    // Border-radius: TL TR BR BL = 6px 6px 0 0
    // happy-dom normalizes "0" to "0px" in border-radius shorthand
    expect(root.style.borderRadius).toMatch(/6px 6px 0/);
    // Position offset applied
    expect(root.style.top).toBe("199px"); // 200 + (-1)
    expect(root.style.left).toBe("100px"); // unchanged
  });

  it("ref.current.resetDockedStyle restores default rounded corners", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState(100, 200)}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const root = container.querySelector<HTMLElement>(".card-frame")!;

    // First apply docked style, then reset
    ref.current!.setDockedStyle([true, true, false, false], { dx: -1, dy: 0 });
    ref.current!.resetDockedStyle();

    expect(root.style.borderRadius).toBe("6px");
    // Position restored to logical position
    expect(root.style.left).toBe("100px");
    expect(root.style.top).toBe("200px");
  });

  it("ref.current.getElement() returns the root .card-frame element", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState()}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const root = container.querySelector<HTMLElement>(".card-frame")!;
    expect(ref.current!.getElement()).toBe(root);
  });

  it("ref.current.getCardAreaElement() returns the .card-frame-content element", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState()}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const content = container.querySelector<HTMLElement>(".card-frame-content")!;
    expect(ref.current!.getCardAreaElement()).toBe(content);
  });

  it("ref.current.getCardState() returns the CardState with live position", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const panelState = makeCardState(100, 100, 400, 300);
    render(
      <CardFrame
        ref={ref}
        panelState={panelState}
        meta={{ title: "T", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    ref.current!.updatePosition(250, 300);
    const state = ref.current!.getCardState();
    expect(state.position.x).toBe(250);
    expect(state.position.y).toBe(300);
  });

  it("ref.current.updateMeta updates the card header title", async () => {
    const ref = createRef<CardFrameHandle>();
    const canvasEl = makeCanvasEl();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <CardFrame
        ref={ref}
        panelState={makeCardState()}
        meta={{ title: "Original", icon: "Box", closable: true, menuItems: [] }}
        isKey={false}
        zIndex={100}
        canvasEl={canvasEl}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const title = container.querySelector(".card-header-title");
    expect(title?.textContent).toBe("Original");

    await act(async () => {
      ref.current!.updateMeta({
        title: "Updated",
        icon: "Box",
        closable: true,
        menuItems: [],
      });
    });

    expect(title?.textContent).toBe("Updated");
  });
});
