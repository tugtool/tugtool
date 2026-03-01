/**
 * Dock React component RTL tests.
 *
 * Tests cover:
 * - Renders all 6 card-type icon buttons plus settings button
 * - Clicking an icon button fires onShowCard callback with correct card type
 * - Settings menu: Reset Layout fires onResetLayout
 * - Settings menu: Restart Server fires onRestartServer
 * - Settings menu: Reset Everything fires onResetEverything
 * - Settings menu: Reload Frontend fires onReloadFrontend
 * - Settings menu theme select: Brio/Bluenote/Harmony radio items present
 * - Settings menu theme select: clicking Bluenote adds td-theme-bluenote to body class
 * - Settings menu theme select: clicking Harmony adds td-theme-harmony to body class
 * - Badge count renders when count > 0, hidden when count === 0
 *
 * Spec S07, [D01] shadcn DropdownMenu, [D05] DevNotificationContext, [D07] lucide-react
 */
import "./setup-rtl";

import React, { createRef } from "react";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import { Dock } from "@/components/chrome/dock";
import type { DockCallbacks } from "@/components/chrome/dock";
import { DevNotificationProvider } from "@/contexts/dev-notification-context";
import type { DevNotificationRef } from "@/contexts/dev-notification-context";

// ---- Setup ----

// Radix DropdownMenu uses PointerEvent internally. Provide a minimal stub
// for happy-dom environments that may lack a full PointerEvent implementation.
if (typeof (global as Record<string, unknown>)["PointerEvent"] === "undefined") {
  (global as Record<string, unknown>)["PointerEvent"] = class PointerEvent extends MouseEvent {
    constructor(type: string, init?: PointerEventInit) {
      super(type, init);
    }
  };
}

// Radix uses hasPointerCapture / setPointerCapture on elements
const proto = Element.prototype as Record<string, unknown>;
if (!proto["hasPointerCapture"]) {
  proto["hasPointerCapture"] = () => false;
}
if (!proto["setPointerCapture"]) {
  proto["setPointerCapture"] = () => {};
}
if (!proto["releasePointerCapture"]) {
  proto["releasePointerCapture"] = () => {};
}

beforeEach(() => {
  document.body.innerHTML = "";
  // Remove any td-theme-* classes applied by previous tests
  document.body.classList.remove("td-theme-bluenote", "td-theme-harmony");
});

/** Wait for the next tick so Radix portals can flush. */
async function flushAsync() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

// ---- Helpers ----

function makeCallbacks(overrides: Partial<DockCallbacks> = {}): {
  callbacks: DockCallbacks;
  onShowCard: ReturnType<typeof mock>;
  onResetLayout: ReturnType<typeof mock>;
  onRestartServer: ReturnType<typeof mock>;
  onResetEverything: ReturnType<typeof mock>;
  onReloadFrontend: ReturnType<typeof mock>;
} {
  const onShowCard = mock((_cardType: string) => {});
  const onResetLayout = mock(() => {});
  const onRestartServer = mock(() => {});
  const onResetEverything = mock(() => {});
  const onReloadFrontend = mock(() => {});
  const callbacks: DockCallbacks = {
    onShowCard,
    onResetLayout,
    onRestartServer,
    onResetEverything,
    onReloadFrontend,
    ...overrides,
  };
  return {
    callbacks,
    onShowCard,
    onResetLayout,
    onRestartServer,
    onResetEverything,
    onReloadFrontend,
  };
}

function renderDock(callbacks?: DockCallbacks, devNotifRef?: React.MutableRefObject<DevNotificationRef | null>) {
  const cb = callbacks ?? makeCallbacks().callbacks;
  if (devNotifRef) {
    return render(
      <DevNotificationProvider controlRef={devNotifRef}>
        <Dock callbacks={cb} />
      </DevNotificationProvider>
    );
  }
  return render(
    <DevNotificationProvider>
      <Dock callbacks={cb} />
    </DevNotificationProvider>
  );
}

// ---- Tests ----

describe("Dock – DOM structure", () => {
  it("renders .dock root element", () => {
    const { container } = renderDock();
    expect(container.querySelector(".dock")).not.toBeNull();
  });

  it("renders 6 card-type icon buttons", () => {
    const { container } = renderDock();
    // There are 6 card type buttons (code, terminal, git, files, stats, developer)
    // plus 1 settings button = 7 total dock-icon-btn elements
    const iconBtns = container.querySelectorAll(".dock-icon-btn");
    expect(iconBtns.length).toBe(7);
  });

  it("renders the settings button", () => {
    const { container } = renderDock();
    const settingsBtn = container.querySelector("[aria-label='Settings']");
    expect(settingsBtn).not.toBeNull();
  });

  it("renders dock logo", () => {
    const { container } = renderDock();
    const logo = container.querySelector(".dock-logo");
    expect(logo).not.toBeNull();
  });

  it("renders dock-spacer", () => {
    const { container } = renderDock();
    const spacer = container.querySelector(".dock-spacer");
    expect(spacer).not.toBeNull();
  });
});

describe("Dock – icon button callbacks", () => {
  it("clicking code button fires onShowCard('code')", () => {
    const { callbacks, onShowCard } = makeCallbacks();
    const { container } = render(<Dock callbacks={callbacks} />);
    const codeBtn = container.querySelector("[aria-label='Add code card']") as HTMLElement;
    expect(codeBtn).not.toBeNull();
    fireEvent.click(codeBtn);
    expect(onShowCard).toHaveBeenCalledTimes(1);
    expect((onShowCard.mock.calls[0] as [string])[0]).toBe("code");
  });

  it("clicking terminal button fires onShowCard('terminal')", () => {
    const { callbacks, onShowCard } = makeCallbacks();
    const { container } = render(<Dock callbacks={callbacks} />);
    const btn = container.querySelector("[aria-label='Add terminal card']") as HTMLElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onShowCard).toHaveBeenCalledTimes(1);
    expect((onShowCard.mock.calls[0] as [string])[0]).toBe("terminal");
  });

  it("clicking git button fires onShowCard('git')", () => {
    const { callbacks, onShowCard } = makeCallbacks();
    const { container } = render(<Dock callbacks={callbacks} />);
    const btn = container.querySelector("[aria-label='Add git card']") as HTMLElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onShowCard).toHaveBeenCalledTimes(1);
    expect((onShowCard.mock.calls[0] as [string])[0]).toBe("git");
  });

  it("clicking files button fires onShowCard('files')", () => {
    const { callbacks, onShowCard } = makeCallbacks();
    const { container } = render(<Dock callbacks={callbacks} />);
    const btn = container.querySelector("[aria-label='Add files card']") as HTMLElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onShowCard).toHaveBeenCalledTimes(1);
    expect((onShowCard.mock.calls[0] as [string])[0]).toBe("files");
  });

  it("clicking stats button fires onShowCard('stats')", () => {
    const { callbacks, onShowCard } = makeCallbacks();
    const { container } = render(<Dock callbacks={callbacks} />);
    const btn = container.querySelector("[aria-label='Add stats card']") as HTMLElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onShowCard).toHaveBeenCalledTimes(1);
    expect((onShowCard.mock.calls[0] as [string])[0]).toBe("stats");
  });

  it("clicking developer button fires onShowCard('developer')", () => {
    const { callbacks, onShowCard } = makeCallbacks();
    const { container } = render(<Dock callbacks={callbacks} />);
    const btn = container.querySelector("[aria-label='Add developer card']") as HTMLElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onShowCard).toHaveBeenCalledTimes(1);
    expect((onShowCard.mock.calls[0] as [string])[0]).toBe("developer");
  });
});

describe("Dock – settings menu callbacks", () => {
  it("settings menu: Reset Layout fires onResetLayout", async () => {
    const { callbacks, onResetLayout } = makeCallbacks();
    const { unmount, container } = render(<Dock callbacks={callbacks} />);

    // Open settings menu
    const settingsBtn = container.querySelector("[aria-label='Settings']") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(settingsBtn, { pointerId: 1, button: 0, bubbles: true });
    });
    await flushAsync();

    // Find and click the Reset Layout menu item
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Reset Layout");

    const menuItems = Array.from(document.querySelectorAll("[role='menuitem']"));
    const resetItem = menuItems.find((el) =>
      (el.textContent ?? "").includes("Reset Layout")
    ) as HTMLElement | undefined;
    expect(resetItem).not.toBeUndefined();
    await act(async () => {
      fireEvent.click(resetItem!);
    });

    expect(onResetLayout).toHaveBeenCalledTimes(1);
    // Unmount explicitly so React removes the Radix portal before beforeEach clears innerHTML
    await act(async () => { unmount(); });
  });

  it("settings menu: Restart Server fires onRestartServer", async () => {
    const { callbacks, onRestartServer } = makeCallbacks();
    const { unmount, container } = render(<Dock callbacks={callbacks} />);

    const settingsBtn = container.querySelector("[aria-label='Settings']") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(settingsBtn, { pointerId: 1, button: 0, bubbles: true });
    });
    await flushAsync();

    const menuItems = Array.from(document.querySelectorAll("[role='menuitem']"));
    const item = menuItems.find((el) =>
      (el.textContent ?? "").includes("Restart Server")
    ) as HTMLElement | undefined;
    expect(item).not.toBeUndefined();
    await act(async () => {
      fireEvent.click(item!);
    });

    expect(onRestartServer).toHaveBeenCalledTimes(1);
    await act(async () => { unmount(); });
  });

  it("settings menu: Reset Everything fires onResetEverything", async () => {
    const { callbacks, onResetEverything } = makeCallbacks();
    const { unmount, container } = render(<Dock callbacks={callbacks} />);

    const settingsBtn = container.querySelector("[aria-label='Settings']") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(settingsBtn, { pointerId: 1, button: 0, bubbles: true });
    });
    await flushAsync();

    const menuItems = Array.from(document.querySelectorAll("[role='menuitem']"));
    const item = menuItems.find((el) =>
      (el.textContent ?? "").includes("Reset Everything")
    ) as HTMLElement | undefined;
    expect(item).not.toBeUndefined();
    await act(async () => {
      fireEvent.click(item!);
    });

    expect(onResetEverything).toHaveBeenCalledTimes(1);
    await act(async () => { unmount(); });
  });

  it("settings menu: Reload Frontend fires onReloadFrontend", async () => {
    const { callbacks, onReloadFrontend } = makeCallbacks();
    const { unmount, container } = render(<Dock callbacks={callbacks} />);

    const settingsBtn = container.querySelector("[aria-label='Settings']") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(settingsBtn, { pointerId: 1, button: 0, bubbles: true });
    });
    await flushAsync();

    const menuItems = Array.from(document.querySelectorAll("[role='menuitem']"));
    const item = menuItems.find((el) =>
      (el.textContent ?? "").includes("Reload Frontend")
    ) as HTMLElement | undefined;
    expect(item).not.toBeUndefined();
    await act(async () => {
      fireEvent.click(item!);
    });

    expect(onReloadFrontend).toHaveBeenCalledTimes(1);
    await act(async () => { unmount(); });
  });

  it("settings menu contains all expected items", async () => {
    const { callbacks } = makeCallbacks();
    const { unmount, container } = render(<Dock callbacks={callbacks} />);

    const settingsBtn = container.querySelector("[aria-label='Settings']") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(settingsBtn, { pointerId: 1, button: 0, bubbles: true });
    });
    await flushAsync();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Add Code");
    expect(bodyText).toContain("Add Terminal");
    expect(bodyText).toContain("Add Git");
    expect(bodyText).toContain("Add Files");
    expect(bodyText).toContain("Add Stats");
    expect(bodyText).toContain("Reset Layout");
    expect(bodyText).toContain("Theme");
    expect(bodyText).toContain("Restart Server");
    expect(bodyText).toContain("Reset Everything");
    expect(bodyText).toContain("Reload Frontend");
    expect(bodyText).toContain("About tugdeck");
    await act(async () => { unmount(); });
  });

  it("settings menu theme select renders Brio/Bluenote/Harmony radio items", async () => {
    const { callbacks } = makeCallbacks();
    const { unmount, container } = render(<Dock callbacks={callbacks} />);

    const settingsBtn = container.querySelector("[aria-label='Settings']") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(settingsBtn, { pointerId: 1, button: 0, bubbles: true });
    });
    await flushAsync();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Theme");
    // Radio items for theme options
    expect(bodyText).toContain("Brio");
    expect(bodyText).toContain("Bluenote");
    expect(bodyText).toContain("Harmony");
    // Verify radio items are rendered with the correct role
    const radioItems = document.body.querySelectorAll("[role='menuitemradio']");
    expect(radioItems.length).toBeGreaterThanOrEqual(3);
    await act(async () => { unmount(); });
  });

  it("settings menu theme select: clicking Bluenote applies td-theme-bluenote body class", async () => {
    const { callbacks } = makeCallbacks();
    const { unmount, container } = render(<Dock callbacks={callbacks} />);

    // Verify starting state: no bluenote class
    expect(document.body.classList.contains("td-theme-bluenote")).toBe(false);

    // Open settings menu
    const settingsBtn = container.querySelector("[aria-label='Settings']") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(settingsBtn, { pointerId: 1, button: 0, bubbles: true });
    });
    await flushAsync();

    // Find the Bluenote radio item and click it
    const radioItems = Array.from(document.body.querySelectorAll("[role='menuitemradio']"));
    const bluenoteItem = radioItems.find((el) =>
      (el.textContent ?? "").trim() === "Bluenote"
    ) as HTMLElement | undefined;
    expect(bluenoteItem).not.toBeUndefined();

    await act(async () => {
      fireEvent.click(bluenoteItem!);
    });
    await flushAsync();

    // useTheme setter applies the body class as its canonical visual side effect.
    // (localStorage is not available in the happy-dom RTL environment.)
    expect(document.body.classList.contains("td-theme-bluenote")).toBe(true);
    await act(async () => { unmount(); });
  });

  it("settings menu theme select: clicking Harmony applies td-theme-harmony body class", async () => {
    const { callbacks } = makeCallbacks();
    const { unmount, container } = render(<Dock callbacks={callbacks} />);

    expect(document.body.classList.contains("td-theme-harmony")).toBe(false);

    const settingsBtn = container.querySelector("[aria-label='Settings']") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(settingsBtn, { pointerId: 1, button: 0, bubbles: true });
    });
    await flushAsync();

    const radioItems = Array.from(document.body.querySelectorAll("[role='menuitemradio']"));
    const harmonyItem = radioItems.find((el) =>
      (el.textContent ?? "").trim() === "Harmony"
    ) as HTMLElement | undefined;
    expect(harmonyItem).not.toBeUndefined();

    await act(async () => {
      fireEvent.click(harmonyItem!);
    });
    await flushAsync();

    // useTheme setter applies the body class as its canonical visual side effect.
    expect(document.body.classList.contains("td-theme-harmony")).toBe(true);
    await act(async () => { unmount(); });
  });
});

describe("Dock – badge counts", () => {
  it("badge is not rendered when count is 0", () => {
    const { callbacks } = makeCallbacks();
    const { container } = renderDock(callbacks);
    const badges = container.querySelectorAll(".dock-badge");
    expect(badges.length).toBe(0);
  });

  it("badge renders when DevNotificationContext.setBadge fires with count > 0", async () => {
    const { callbacks } = makeCallbacks();
    const devNotifRef = createRef<DevNotificationRef | null>() as React.MutableRefObject<DevNotificationRef | null>;
    const { container } = renderDock(callbacks, devNotifRef);

    await act(async () => {
      devNotifRef.current?.setBadge("developer", 3);
    });

    const badge = container.querySelector(".dock-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("3");
  });

  it("badge is removed when DevNotificationContext.setBadge fires with count 0", async () => {
    const { callbacks } = makeCallbacks();
    const devNotifRef = createRef<DevNotificationRef | null>() as React.MutableRefObject<DevNotificationRef | null>;
    const { container } = renderDock(callbacks, devNotifRef);

    // First add a badge
    await act(async () => {
      devNotifRef.current?.setBadge("developer", 5);
    });

    expect(container.querySelector(".dock-badge")).not.toBeNull();

    // Then remove it
    await act(async () => {
      devNotifRef.current?.setBadge("developer", 0);
    });

    expect(container.querySelector(".dock-badge")).toBeNull();
  });
});
