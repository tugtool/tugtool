/**
 * TugCheckbox role prop tests.
 *
 * Tests cover:
 * - role="danger" injects --tug-toggle-on-color and sets data-role
 * - role="action" maps to tone-active via ROLE_TONE_MAP
 * - no role prop: injects option-role fg-muted style and sets data-role="option" (new default)
 * - role="option": injects --tug-toggle-on-color: var(--tug-base-element-global-text-normal-muted-rest) and sets data-role="option"
 * - role="accent" (explicit): no inline style injected, no data-role attribute
 *
 * [D03] Selection control role via inline CSS custom property injection
 * [D06] TugCheckbox and TugSwitch default to role='option'
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
  it('role="danger" injects --tug-toggle-on-color set to var(--tug-base-element-tone-fill-normal-danger-rest)', () => {
    const { getByRole } = render(<TugCheckbox role="danger" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-element-tone-fill-normal-danger-rest)",
    );
  });

  it('role="danger" sets data-role="danger" attribute', () => {
    const { getByRole } = render(<TugCheckbox role="danger" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.getAttribute("data-role")).toBe("danger");
  });

  it('role="action" maps to --tug-base-element-tone-fill-normal-active-rest via ROLE_TONE_MAP', () => {
    const { getByRole } = render(<TugCheckbox role="action" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-element-tone-fill-normal-active-rest)",
    );
  });

  it('role="action" injects --tug-toggle-on-hover-color with color-mix using active tone', () => {
    const { getByRole } = render(<TugCheckbox role="action" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe(
      "color-mix(in oklch, var(--tug-base-element-tone-fill-normal-active-rest), white 15%)",
    );
  });

  it("no role prop: injects option-role style (--tug-toggle-on-color: var(--tug-base-element-global-text-normal-muted-rest))", () => {
    // With option as the default role, omitting the role prop now DOES inject
    // inline style using fg-muted (neutral/achromatic). [D06]
    const { getByRole } = render(<TugCheckbox aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-element-global-text-normal-muted-rest)",
    );
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe(
      "var(--tug-base-element-global-text-normal-subtle-rest)",
    );
  });

  it('no role prop: sets data-role="option" (option is the new default)', () => {
    // With option as the default role, omitting the role prop now sets
    // data-role="option" on the checkbox element. [D06]
    const { getByRole } = render(<TugCheckbox aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.getAttribute("data-role")).toBe("option");
  });

  it('role="option": injects --tug-toggle-on-color: var(--tug-base-element-global-text-normal-muted-rest)', () => {
    // The option role uses fg-muted directly rather than a --tug-base-tone-*
    // token. This is intentional: option is neutral/achromatic and does not
    // have a dedicated signal hue in the tone system. [D06]
    const { getByRole } = render(<TugCheckbox role="option" aria-label="test" />);
    const checkbox = getByRole("checkbox");
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-element-global-text-normal-muted-rest)",
    );
    expect(checkbox.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe(
      "var(--tug-base-element-global-text-normal-subtle-rest)",
    );
    expect(checkbox.getAttribute("data-role")).toBe("option");
  });

  it('role="accent": does NOT inject inline style (accent falls back to CSS default token)', () => {
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
