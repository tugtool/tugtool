/**
 * ComponentGallery tests -- Step 3.
 *
 * Tests cover:
 * - ComponentGallery renders without errors
 * - Close button calls onClose callback
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock } from "bun:test";
import { render, fireEvent } from "@testing-library/react";

import { ComponentGallery } from "@/components/tugways/component-gallery";

describe("ComponentGallery – basic render", () => {
  it("renders without errors", () => {
    const onClose = mock(() => {});
    const { container } = render(<ComponentGallery onClose={onClose} />);
    const panel = container.querySelector(".cg-panel");
    expect(panel).not.toBeNull();
  });

  it("renders the title 'Component Gallery'", () => {
    const onClose = mock(() => {});
    const { container } = render(<ComponentGallery onClose={onClose} />);
    const title = container.querySelector(".cg-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("Component Gallery");
  });
});

describe("ComponentGallery – close button", () => {
  it("calls onClose when close button is clicked", () => {
    const onClose = mock(() => {});
    const { container } = render(<ComponentGallery onClose={onClose} />);
    // The close button has aria-label "Close Component Gallery"
    const closeBtn = container.querySelector("button[aria-label='Close Component Gallery']");
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
