/**
 * TugSwitch role prop tests.
 *
 * Tests cover:
 * - role="agent" injects --tug-toggle-on-color and sets data-role
 * - role="action" maps to tone-active via ROLE_TONE_MAP
 * - no role prop: injects option-role fg-muted style and sets data-role="option" (new default)
 * - role="option": injects --tug-toggle-on-color: var(--tug-base-fg-muted) and sets data-role="option"
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

import { TugSwitch } from "@/components/tugways/tug-switch";

afterEach(() => {
  cleanup();
});

describe("TugSwitch role prop", () => {
  it('role="agent" injects --tug-toggle-on-color set to var(--tug-base-tone-agent)', () => {
    const { getByRole } = render(<TugSwitch role="agent" aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-tone-agent)",
    );
  });

  it('role="agent" sets data-role="agent" attribute', () => {
    const { getByRole } = render(<TugSwitch role="agent" aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.getAttribute("data-role")).toBe("agent");
  });

  it('role="action" maps to --tug-base-tone-active via ROLE_TONE_MAP', () => {
    const { getByRole } = render(<TugSwitch role="action" aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-tone-active)",
    );
  });

  it('role="action" injects --tug-toggle-on-hover-color with color-mix using active tone', () => {
    const { getByRole } = render(<TugSwitch role="action" aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe(
      "color-mix(in oklch, var(--tug-base-tone-active), white 15%)",
    );
  });

  it("no role prop: injects option-role style (--tug-toggle-on-color: var(--tug-base-fg-muted))", () => {
    // With option as the default role, omitting the role prop now DOES inject
    // inline style using fg-muted (neutral/achromatic). [D06]
    const { getByRole } = render(<TugSwitch aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-fg-muted)",
    );
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe(
      "var(--tug-base-fg-subtle)",
    );
  });

  it('no role prop: sets data-role="option" (option is the new default)', () => {
    // With option as the default role, omitting the role prop now sets
    // data-role="option" on the switch element. [D06]
    const { getByRole } = render(<TugSwitch aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.getAttribute("data-role")).toBe("option");
  });

  it('role="option": injects --tug-toggle-on-color: var(--tug-base-fg-muted)', () => {
    // The option role uses fg-muted directly rather than a --tug-base-tone-*
    // token. This is intentional: option is neutral/achromatic and does not
    // have a dedicated signal hue in the tone system. [D06]
    const { getByRole } = render(<TugSwitch role="option" aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-color")).toBe(
      "var(--tug-base-fg-muted)",
    );
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe(
      "var(--tug-base-fg-subtle)",
    );
    expect(switchEl.getAttribute("data-role")).toBe("option");
  });

  it('role="accent": does NOT inject inline style (accent falls back to CSS default token)', () => {
    const { getByRole } = render(<TugSwitch role="accent" aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-color")).toBe("");
    expect(switchEl.style.getPropertyValue("--tug-toggle-on-hover-color")).toBe("");
  });

  it('role="accent": does NOT set data-role attribute', () => {
    const { getByRole } = render(<TugSwitch role="accent" aria-label="test" />);
    const switchEl = getByRole("switch");
    expect(switchEl.getAttribute("data-role")).toBeNull();
  });
});
