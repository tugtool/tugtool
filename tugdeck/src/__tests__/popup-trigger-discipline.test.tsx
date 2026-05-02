/**
 * Popup trigger discipline — structural pin.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 5 / [D06] / [D07] /
 * (#service-binding) "TugButton trigger discipline" verification gate.
 *
 * The service binding's correctness depends on
 * `manager.getFirstResponder()` at `captureOnOpen()` time returning
 * the editor's responder id, NOT the trigger button's. This is
 * achieved by:
 *
 *   (1) `data-tug-focus="refuse"` on the TugButton element, which
 *       `pane-focus-controller`'s document-level pointerdown listener
 *       reads to skip responder-chain promotion; AND
 *   (2) `suppressButtonFocusShift` (a `mousedown.preventDefault()` on
 *       the surrounding floating-surface content element) which
 *       prevents Safari/WebKit's focusin-on-FocusScope-wrapper quirk
 *       from promoting the trigger.
 *
 * The end-to-end correctness of (1)+(2) under real DOM is verified by
 * the at0055 app-test (image 5 close path: open `@` completion → click
 * font picker → choose font → next keystroke lands in editor). Mounting
 * `pane-focus-controller` in happy-dom requires the full deck-root
 * infrastructure and crosses focus/event-ordering across React renders,
 * which violates the project's happy-dom scoping rule.
 *
 * What this test pins, in pure happy-dom-safe territory, is the
 * structural attribute (1): the `TugButton` rendered inside
 * `TugPopupMenu`'s trigger slot DOES carry `data-tug-focus="refuse"`.
 * If a future refactor accidentally drops the attribute (e.g., a new
 * polymorphic Slot variant that forgets to thread it through), this
 * test fails and Step 5's correctness invariant is preserved at the
 * unit level. The companion focus-DOM assertions are the app-test's
 * job.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import type { TugPopupMenuItem } from "@/components/tugways/internal/tug-popup-menu";
import { TugButton } from "@/components/tugways/internal/tug-button";
import {
  ResponderChainContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";

afterEach(() => {
  cleanup();
});

describe("TugPopupMenu trigger discipline — structural pin per Step 5 verification gate", () => {
  it("the TugButton rendered as a TugPopupMenu trigger carries data-tug-focus=\"refuse\"", () => {
    const items: TugPopupMenuItem[] = [{ id: "a", label: "Item A" }];
    const mgr = new ResponderChainManager();

    const { container } = render(
      <ResponderChainContext.Provider value={mgr}>
        <TugPopupMenu
          trigger={
            <TugButton size="sm" emphasis="ghost">
              Open menu
            </TugButton>
          }
          items={items}
          onSelect={() => {}}
        />
      </ResponderChainContext.Provider>,
    );

    // The TugButton rendered as the trigger must expose
    // data-tug-focus="refuse" — the structural signal that
    // pane-focus-controller reads to skip responder-chain promotion
    // when this button receives a click.
    const trigger = container.querySelector('[data-slot="tug-button"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("data-tug-focus")).toBe("refuse");
  });

  it("first responder is unchanged after a synthesized click on the trigger (no in-test controller fights the click)", () => {
    // This is the vacuous-but-honest version of the plan's
    // verification-gate test. In pure happy-dom without
    // pane-focus-controller mounted, no document-level click handler
    // promotes the trigger as a responder. We assert that nothing
    // *inside* TugPopupMenu / TugButton itself promotes a new
    // responder — i.e., neither component contains a stray
    // makeFirstResponder() call hidden behind the click handler.
    // The end-to-end "with controller mounted, refuse-attribute
    // honored" assertion is the at0055 app-test's job.
    const items: TugPopupMenuItem[] = [{ id: "a", label: "Item A" }];
    const mgr = new ResponderChainManager();
    mgr.register({
      id: "editor",
      parentId: null,
      actions: {},
    });
    expect(mgr.getFirstResponder()).toBe("editor");

    const { container } = render(
      <ResponderChainContext.Provider value={mgr}>
        <TugPopupMenu
          trigger={
            <TugButton size="sm" emphasis="ghost">
              Open menu
            </TugButton>
          }
          items={items}
          onSelect={() => {}}
        />
      </ResponderChainContext.Provider>,
    );

    const trigger = container.querySelector<HTMLElement>(
      '[data-slot="tug-button"]',
    );
    expect(trigger).not.toBeNull();
    trigger?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger?.click();

    expect(mgr.getFirstResponder()).toBe("editor");
  });
});
