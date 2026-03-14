/**
 * TugCheckbox role prop tests — Step 3.
 *
 * Tests cover:
 * - role="danger" injects --tug-toggle-on-color and sets data-role
 * - role="action" maps to tone-active via ROLE_TONE_MAP
 * - no role prop: no inline style injected, no data-role attribute
 * - role="accent" (default): no inline style injected, no data-role attribute
 *
 * [D03] Selection control role via inline CSS custom property injection
 * [D04] Role prop type is the 7-role union from TugBadgeRole
 * [Spec S01] Inline CSS Custom Property Injection
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { TugCheckbox } from "@/components/tugways/tug-checkbox";

afterEach(() => {
  cleanup();
});

describe("TugCheckbox role prop", () => {
  it('role="danger" injects --tug-toggle-on-color set to var(--tug-base-tone-danger)', () => {
    const { getByRole } = render(<TugCheckbox role="danger" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-tone-danger)",
    );
  });

  it('role="danger" sets data-role="danger" attribute', () => {
    const { getByRole } = render(<TugCheckbox role="danger" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.getAttribute("data-role")).toBe("danger");
  });

  it('role="action" maps to --tug-base-tone-active via ROLE_TONE_MAP', () => {
    const { getByRole } = render(<TugCheckbox role="action" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-tone-active)",
    );
  });

  it('role="action" injects --tug-toggle-on-hover-color with color-mix using active tone', () => {
    const { getByRole } = render(<TugCheckbox role="action" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe(
      "color-mix(in oklch, var(--tug-base-tone-active), white 15%)",
    );
  });

  it("no role prop: does NOT inject inline style", () => {
    const { getByRole } = render(<TugCheckbox aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-color")).toBe("");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe("");
  });

  it("no role prop: does NOT set data-role attribute", () => {
    const { getByRole } = render(<TugCheckbox aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.getAttribute("data-role")).toBeNull();
  });

  it('role="accent": does NOT inject inline style (accent is the default)', () => {
    const { getByRole } = render(<TugCheckbox role="accent" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-color")).toBe("");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe("");
  });

  it('role="accent": does NOT set data-role attribute', () => {
    const { getByRole } = render(<TugCheckbox role="accent" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.getAttribute("data-role")).toBeNull();
  });
});
