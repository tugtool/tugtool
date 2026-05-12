/**
 * `BlockFoldCue` — affordance library tests.
 *
 * Pins the contract that future body kinds compose against:
 *  - Chevron direction reflects `collapsed`.
 *  - `aria-expanded` reflects `!collapsed`.
 *  - `aria-label` chooses between the verb pair.
 *  - Click fires `onToggle(!collapsed)`.
 *  - Click dispatches the bubbling `tug-disengage-follow-bottom`
 *    event BEFORE invoking `onToggle`.
 *  - The button carries `data-tug-focus="refuse"`.
 */

import "../../../../../__tests__/setup-rtl";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";

import { BlockFoldCue } from "../block-fold-cue";

afterEach(() => {
  cleanup();
});

describe("BlockFoldCue", () => {
  test("renders chevron-down when collapsed (expand affordance) with the expand aria-label", () => {
    const { container } = render(
      <BlockFoldCue
        collapsed={true}
        onToggle={() => undefined}
        label="42 lines"
        ariaLabelCollapse="Collapse it"
        ariaLabelExpand="Expand it"
      />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toBe("Expand it");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.textContent).toContain("42 lines");
    // Chevron icon — lucide renders an svg; we don't pin the specific
    // shape (that's an implementation detail of the icon library),
    // just that there IS an svg.
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  test("renders chevron-up when expanded (collapse affordance) with the collapse aria-label", () => {
    const { container } = render(
      <BlockFoldCue
        collapsed={false}
        onToggle={() => undefined}
        label="42 lines"
        ariaLabelCollapse="Collapse it"
        ariaLabelExpand="Expand it"
      />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toBe("Collapse it");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  test("click fires onToggle with the inverted collapsed value", () => {
    const onToggle = mock((_next: boolean) => undefined);
    const { container } = render(
      <BlockFoldCue
        collapsed={true}
        onToggle={onToggle}
        label="3 hunks"
        ariaLabelCollapse="Collapse"
        ariaLabelExpand="Expand"
      />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(false);

    cleanup();
    onToggle.mockClear();

    const { container: c2 } = render(
      <BlockFoldCue
        collapsed={false}
        onToggle={onToggle}
        label="3 hunks"
        ariaLabelCollapse="Collapse"
        ariaLabelExpand="Expand"
      />,
    );
    const btn2 = c2.querySelector("button") as HTMLButtonElement;
    btn2.click();
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  test("click dispatches bubbling 'tug-disengage-follow-bottom' BEFORE invoking onToggle", () => {
    // The host TugListView relies on the bubbling event firing
    // BEFORE the state update so its `isFollowingBottom` flag
    // flips false before the React commit triggers a ResizeObserver
    // flush. If onToggle ran first, the cell-height change would
    // race with the disengage and the auto-pin would scroll the
    // cue off-screen.
    const order: string[] = [];
    const onToggle = mock(() => {
      order.push("toggle");
    });

    // Set up a listener on a wrapper that catches the bubbling
    // event. The listener pushes "event" to the order array. The
    // listener must see the event BEFORE the toggle callback runs.
    function Wrapper({ children }: { children: React.ReactNode }) {
      const ref = React.useRef<HTMLDivElement | null>(null);
      React.useEffect(() => {
        const node = ref.current;
        if (node === null) return;
        const handler = () => {
          order.push("event");
        };
        node.addEventListener("tug-disengage-follow-bottom", handler);
        return () => {
          node.removeEventListener("tug-disengage-follow-bottom", handler);
        };
      }, []);
      return <div ref={ref}>{children}</div>;
    }

    const { container } = render(
      <Wrapper>
        <BlockFoldCue
          collapsed={true}
          onToggle={onToggle}
          label="x"
          ariaLabelCollapse="Collapse"
          ariaLabelExpand="Expand"
        />
      </Wrapper>,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(order).toEqual(["event", "toggle"]);
  });

  test("button carries data-tug-focus='refuse' (TugButton baseline contract)", () => {
    const { container } = render(
      <BlockFoldCue
        collapsed={false}
        onToggle={() => undefined}
        label="x"
        ariaLabelCollapse="Collapse"
        ariaLabelExpand="Expand"
      />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.getAttribute("data-tug-focus")).toBe("refuse");
  });

  test("onToggle is read FRESH at click time (latest-ref pattern, [L07])", () => {
    // The stable click handler reads `onToggle` and `collapsed`
    // through latest-refs mirrored via useLayoutEffect. A consumer
    // that passes a fresh `onToggle` per render (deps-based) gets
    // the LATEST callback at click time, not the one bound at
    // first render. Same for `collapsed`.
    const firstToggle = mock(() => undefined);
    const secondToggle = mock(() => undefined);
    const { container, rerender } = render(
      <BlockFoldCue
        collapsed={true}
        onToggle={firstToggle}
        label="x"
        ariaLabelCollapse="Collapse"
        ariaLabelExpand="Expand"
      />,
    );
    // Update both `collapsed` AND `onToggle` between renders to
    // exercise both latest-refs.
    rerender(
      <BlockFoldCue
        collapsed={false}
        onToggle={secondToggle}
        label="x"
        ariaLabelCollapse="Collapse"
        ariaLabelExpand="Expand"
      />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    // Only the second toggle fires — the first is stale and never
    // sees the click. The new collapsed value (false) was inverted
    // and passed (true).
    expect(firstToggle).not.toHaveBeenCalled();
    expect(secondToggle).toHaveBeenCalledTimes(1);
    expect(secondToggle).toHaveBeenCalledWith(true);
  });

  test("uses the provided data-slot (falls back to 'block-fold-cue')", () => {
    const { container } = render(
      <BlockFoldCue
        collapsed={false}
        onToggle={() => undefined}
        label="x"
        ariaLabelCollapse="Collapse"
        ariaLabelExpand="Expand"
      />,
    );
    expect(
      container.querySelector('[data-slot="block-fold-cue"]'),
    ).not.toBeNull();

    cleanup();
    const { container: c2 } = render(
      <BlockFoldCue
        collapsed={false}
        onToggle={() => undefined}
        label="x"
        ariaLabelCollapse="Collapse"
        ariaLabelExpand="Expand"
        data-slot="diff-fold-cue"
      />,
    );
    expect(
      c2.querySelector('[data-slot="diff-fold-cue"]'),
    ).not.toBeNull();
  });
});
