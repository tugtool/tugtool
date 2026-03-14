/**
 * TugPopupButton unit tests.
 *
 * Tests cover:
 * - Trigger renders with class tug-button-outlined-option
 * - Trigger has ChevronDown trailing icon (.tug-button-trailing-icon present)
 * - Trigger has border-radius: 0 (rounded="none")
 * - Label text is rendered in the trigger
 * - Mounts without throwing
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupMenuItem } from "@/components/tugways/tug-popup-button";

// ---- Helpers ----

const ITEMS: TugPopupMenuItem[] = [
  { id: "copy", label: "Copy" },
  { id: "paste", label: "Paste" },
  { id: "cut", label: "Cut", disabled: true },
];

function renderPopupButton(onSelect = mock(() => {})) {
  return render(
    <TugPopupButton
      label="Select"
      items={ITEMS}
      onSelect={onSelect}
    />
  );
}

afterEach(() => {
  cleanup();
  (global as any).__waapi_mock__.reset();
});

// ============================================================================
// Basic render
// ============================================================================

describe("TugPopupButton – basic render", () => {
  it("mounts without throwing", () => {
    expect(() => renderPopupButton()).not.toThrow();
  });

  it("renders the trigger button", () => {
    const { container } = renderPopupButton();
    const btn = container.querySelector(".tug-button");
    expect(btn).not.toBeNull();
  });

  it("renders the label text in the trigger", () => {
    const { getByText } = renderPopupButton();
    expect(getByText("Select")).not.toBeNull();
  });
});

// ============================================================================
// Trigger class: tug-button-outlined-option [D04, step-2]
// ============================================================================

describe("TugPopupButton – trigger emphasis x role class", () => {
  it("trigger has class tug-button-outlined-option", () => {
    const { container } = renderPopupButton();
    const btn = container.querySelector(".tug-button");
    expect(btn).not.toBeNull();
    expect(btn!.className).toContain("tug-button-outlined-option");
  });

  it("trigger does NOT have tug-button-outlined-action class", () => {
    const { container } = renderPopupButton();
    const btn = container.querySelector(".tug-button");
    expect(btn!.className).not.toContain("tug-button-outlined-action");
  });
});

// ============================================================================
// Trailing icon: ChevronDown [D04]
// ============================================================================

describe("TugPopupButton – ChevronDown trailing icon", () => {
  it("trigger has .tug-button-trailing-icon element", () => {
    const { container } = renderPopupButton();
    const trailingIcon = container.querySelector(".tug-button-trailing-icon");
    expect(trailingIcon).not.toBeNull();
  });

  it("trailing icon contains an SVG (ChevronDown)", () => {
    const { container } = renderPopupButton();
    const trailingIcon = container.querySelector(".tug-button-trailing-icon");
    expect(trailingIcon).not.toBeNull();
    const svg = trailingIcon!.querySelector("svg");
    expect(svg).not.toBeNull();
  });
});

// ============================================================================
// Border radius: rounded="none" → border-radius: 0 [D04]
// ============================================================================

describe("TugPopupButton – border-radius: 0 (rounded=none)", () => {
  it("trigger has inline style border-radius: 0", () => {
    const { container } = renderPopupButton();
    const btn = container.querySelector(".tug-button") as HTMLElement | null;
    expect(btn).not.toBeNull();
    // TugButton applies border-radius via inline style from ROUNDED_MAP["none"] = "0".
    // happy-dom normalizes the computed value to "0px"; accept either form.
    expect(["0", "0px"]).toContain(btn!.style.borderRadius);
  });
});

// ============================================================================
// Props passthrough
// ============================================================================

describe("TugPopupButton – props passthrough", () => {
  it("passes size=sm to the trigger (tug-button-size-sm class)", () => {
    const { container } = render(
      <TugPopupButton
        label="Small"
        items={ITEMS}
        onSelect={mock(() => {})}
        size="sm"
      />
    );
    const btn = container.querySelector(".tug-button");
    expect(btn!.className).toContain("tug-button-size-sm");
  });

  it("passes className to the trigger button", () => {
    const { container } = render(
      <TugPopupButton
        label="Classed"
        items={ITEMS}
        onSelect={mock(() => {})}
        className="my-custom-class"
      />
    );
    const btn = container.querySelector(".tug-button");
    expect(btn!.className).toContain("my-custom-class");
  });

  it("passes aria-label to the trigger button", () => {
    const { container } = render(
      <TugPopupButton
        label="Labeled"
        items={ITEMS}
        onSelect={mock(() => {})}
        aria-label="Choose an option"
      />
    );
    const btn = container.querySelector(".tug-button");
    expect(btn!.getAttribute("aria-label")).toBe("Choose an option");
  });
});
