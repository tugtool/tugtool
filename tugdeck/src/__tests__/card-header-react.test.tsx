/**
 * CardHeader React component RTL tests.
 *
 * Tests cover:
 * - Renders icon, title, and buttons based on TugCardMeta props
 * - Close button fires onClose callback
 * - Menu button opens CardDropdownMenu with correct items
 * - onPointerDown on header (not on buttons) fires onDragStart
 * - isKey=true applies card-header-key class
 * - Re-renders correctly when meta props change
 *
 * [D02] React synthetic events for all pointer interactions
 * [D07] lucide-react replaces vanilla lucide for chrome icons
 * Spec S02
 */
import "./setup-rtl";

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { CardHeader } from "@/components/chrome/card-header";
import type { TugCardMeta, CardMenuItem } from "@/cards/card";

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

function makeMeta(overrides: Partial<TugCardMeta> = {}): TugCardMeta {
  return {
    title: "Test",
    icon: "Activity",
    closable: true,
    menuItems: [],
    ...overrides,
  };
}

/** Wait for async Radix portals to flush. */
async function flushAsync() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

// ---- Tests ----

describe("CardHeader – DOM structure", () => {
  it("renders .card-header root element", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector(".card-header")).not.toBeNull();
  });

  it("renders .card-header-title with meta.title text", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta({ title: "Git" })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    const title = container.querySelector(".card-header-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("Git");
  });

  it("renders .card-header-icon with an SVG icon", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta({ icon: "Terminal" })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    const icon = container.querySelector(".card-header-icon");
    expect(icon).not.toBeNull();
    expect(icon?.querySelector("svg")).not.toBeNull();
  });

  it("renders close button when meta.closable is true", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta({ closable: true })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector('[aria-label="Close card"]')).not.toBeNull();
  });

  it("does NOT render close button when meta.closable is false", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta({ closable: false })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector('[aria-label="Close card"]')).toBeNull();
  });

  it("renders menu button when meta.menuItems is non-empty", () => {
    const items: CardMenuItem[] = [{ type: "action", label: "Do it", action: mock(() => {}) }];
    const { container } = render(
      <CardHeader
        meta={makeMeta({ menuItems: items })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector('[aria-label="Card menu"]')).not.toBeNull();
  });

  it("does NOT render menu button when meta.menuItems is empty", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta({ menuItems: [] })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector('[aria-label="Card menu"]')).toBeNull();
  });

  it("renders collapse button when showCollapse=true", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        showCollapse={true}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector('[aria-label="Collapse card"]')).not.toBeNull();
  });

  it("does NOT render collapse button when showCollapse=false (default)", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector('[aria-label="Collapse card"]')).toBeNull();
  });
});

describe("CardHeader – close button", () => {
  it("close button fires onClose callback", () => {
    const onClose = mock(() => {});
    const { container } = render(
      <CardHeader
        meta={makeMeta({ closable: true })}
        isKey={false}
        onClose={onClose}
        onCollapse={mock(() => {})}
      />
    );
    const btn = container.querySelector('[aria-label="Close card"]') as HTMLElement;
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close button click does not fire onCollapse", () => {
    const onCollapse = mock(() => {});
    const { container } = render(
      <CardHeader
        meta={makeMeta({ closable: true })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={onCollapse}
      />
    );
    const btn = container.querySelector('[aria-label="Close card"]') as HTMLElement;
    fireEvent.click(btn);
    expect(onCollapse).not.toHaveBeenCalled();
  });
});

describe("CardHeader – collapse button", () => {
  it("collapse button fires onCollapse callback", () => {
    const onCollapse = mock(() => {});
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        showCollapse={true}
        onClose={mock(() => {})}
        onCollapse={onCollapse}
      />
    );
    const btn = container.querySelector('[aria-label="Collapse card"]') as HTMLElement;
    fireEvent.click(btn);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});

describe("CardHeader – menu button opens CardDropdownMenu", () => {
  it("menu button renders action items in dropdown when clicked", async () => {
    const actionFn = mock(() => {});
    const items: CardMenuItem[] = [
      { type: "action", label: "Refresh Now", action: actionFn },
    ];
    const { container } = render(
      <CardHeader
        meta={makeMeta({ menuItems: items })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );

    const menuBtn = container.querySelector('[aria-label="Card menu"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    await flushAsync();

    // Radix portals render into document.body
    const menuItem = Array.from(document.body.querySelectorAll("[role='menuitem']")).find(
      (el) => el.textContent?.includes("Refresh Now")
    );
    expect(menuItem).not.toBeNull();
  });

  it("action item in dropdown fires its callback when clicked", async () => {
    const actionFn = mock(() => {});
    const items: CardMenuItem[] = [
      { type: "action", label: "New Session", action: actionFn },
    ];

    // Append a dedicated container to body so we can manage it cleanly
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);

    const { unmount } = render(
      <CardHeader
        meta={makeMeta({ menuItems: items })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />,
      { container: wrapper }
    );

    // Open the dropdown
    await act(async () => {
      fireEvent.click(wrapper.querySelector('[aria-label="Card menu"]') as HTMLElement);
    });
    await flushAsync();

    // Find the menu item in the document (Radix portals render into body)
    const allItems = Array.from(document.body.querySelectorAll("[role='menuitem']"));
    const menuItem = allItems.find((el) => el.textContent?.includes("New Session")) as HTMLElement | undefined;
    expect(menuItem).not.toBeNull();

    if (menuItem) {
      await act(async () => {
        fireEvent.click(menuItem);
      });
      expect(actionFn).toHaveBeenCalledTimes(1);
    }

    unmount();
  });
});

describe("CardHeader – drag initiation via onDragStart", () => {
  it("pointerdown on header (not on a button) fires onDragStart", () => {
    const onDragStart = mock((_e: React.PointerEvent<HTMLDivElement>) => {});
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
        onDragStart={onDragStart}
      />
    );
    const header = container.querySelector(".card-header") as HTMLElement;
    fireEvent.pointerDown(header, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it("pointerdown on the close button does NOT fire onDragStart", () => {
    const onDragStart = mock((_e: React.PointerEvent<HTMLDivElement>) => {});
    const { container } = render(
      <CardHeader
        meta={makeMeta({ closable: true })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
        onDragStart={onDragStart}
      />
    );
    const closeBtn = container.querySelector('[aria-label="Close card"]') as HTMLElement;
    fireEvent.pointerDown(closeBtn, { pointerId: 1, clientX: 100, clientY: 50 });
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("header has grab cursor when onDragStart is provided", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
        onDragStart={mock(() => {})}
      />
    );
    const header = container.querySelector(".card-header") as HTMLElement;
    expect(header.style.cursor).toBe("grab");
  });

  it("header has no cursor style when onDragStart is not provided", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    const header = container.querySelector(".card-header") as HTMLElement;
    expect(header.style.cursor).toBe("");
  });
});

describe("CardHeader – isKey class", () => {
  it("isKey=true applies card-header-key class", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={true}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector(".card-header-key")).not.toBeNull();
  });

  it("isKey=false does not apply card-header-key class", () => {
    const { container } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector(".card-header-key")).toBeNull();
  });
});

describe("CardHeader – re-renders on prop changes", () => {
  it("title updates when meta prop changes", () => {
    const { container, rerender } = render(
      <CardHeader
        meta={makeMeta({ title: "Before" })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector(".card-header-title")?.textContent).toBe("Before");

    rerender(
      <CardHeader
        meta={makeMeta({ title: "After" })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector(".card-header-title")?.textContent).toBe("After");
  });

  it("menu button appears when menuItems changes from empty to non-empty", () => {
    const { container, rerender } = render(
      <CardHeader
        meta={makeMeta({ menuItems: [] })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector('[aria-label="Card menu"]')).toBeNull();

    const items: CardMenuItem[] = [{ type: "action", label: "Clear", action: mock(() => {}) }];
    rerender(
      <CardHeader
        meta={makeMeta({ menuItems: items })}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector('[aria-label="Card menu"]')).not.toBeNull();
  });

  it("card-header-key class toggles correctly on isKey change", () => {
    const { container, rerender } = render(
      <CardHeader
        meta={makeMeta()}
        isKey={false}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector(".card-header-key")).toBeNull();

    rerender(
      <CardHeader
        meta={makeMeta()}
        isKey={true}
        onClose={mock(() => {})}
        onCollapse={mock(() => {})}
      />
    );
    expect(container.querySelector(".card-header-key")).not.toBeNull();
  });

  it("all card type icons render correctly", () => {
    const icons = ["MessageSquare", "Terminal", "GitBranch", "FolderOpen", "Activity", "Info", "Settings", "Code"];
    for (const icon of icons) {
      const { container } = render(
        <CardHeader
          meta={makeMeta({ icon })}
          isKey={false}
          onClose={mock(() => {})}
          onCollapse={mock(() => {})}
        />
      );
      expect(container.querySelector(".card-header-icon svg")).not.toBeNull();
    }
  });
});
