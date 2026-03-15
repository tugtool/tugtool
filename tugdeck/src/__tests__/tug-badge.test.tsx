/**
 * TugBadge unit tests.
 *
 * Tests cover:
 * - Default render: filled active sm
 * - All 3 emphasis x 7 role combinations render correct class names
 * - All 3 sizes render correct size class
 * - children content is rendered
 * - className prop is forwarded
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { render } from "@testing-library/react";

import { TugBadge } from "@/components/tugways/tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole } from "@/components/tugways/tug-badge";

// ---- Helper: render TugBadge and get the <span> element ----

function renderBadge(props: Parameters<typeof TugBadge>[0]) {
  const { container } = render(<TugBadge {...props} />);
  return container.querySelector("span") as HTMLSpanElement;
}

// ============================================================================
// Default render
// ============================================================================

describe("TugBadge – default render", () => {
  it("renders a span element", () => {
    const badge = renderBadge({ children: "Tag" });
    expect(badge).not.toBeNull();
  });

  it("default props produce tug-badge-tinted-action and tug-badge-size-sm classes", () => {
    const badge = renderBadge({ children: "Tag" });
    expect(badge.className).toContain("tug-badge-tinted-action");
    expect(badge.className).toContain("tug-badge-size-sm");
  });

  it("renders children content", () => {
    const badge = renderBadge({ children: "Status" });
    expect(badge.textContent).toContain("Status");
  });

  it("forwards className prop", () => {
    const badge = renderBadge({ children: "Tag", className: "my-custom-class" });
    expect(badge.className).toContain("my-custom-class");
    expect(badge.className).toContain("tug-badge");
  });
});

// ============================================================================
// Size CSS classes (Spec S07)
// ============================================================================

describe("TugBadge – sizes", () => {
  it("sm size: applies tug-badge-size-sm class", () => {
    const badge = renderBadge({ size: "sm", children: "Small" });
    expect(badge.className).toContain("tug-badge-size-sm");
  });

  it("md size: applies tug-badge-size-md class", () => {
    const badge = renderBadge({ size: "md", children: "Medium" });
    expect(badge.className).toContain("tug-badge-size-md");
  });

  it("lg size: applies tug-badge-size-lg class", () => {
    const badge = renderBadge({ size: "lg", children: "Large" });
    expect(badge.className).toContain("tug-badge-size-lg");
  });
});

// ============================================================================
// Emphasis x Role CSS classes — tinted emphasis
// ============================================================================

describe("TugBadge – tinted emphasis", () => {
  const tintedCases: Array<[TugBadgeRole, string]> = [
    ["accent",  "tug-badge-tinted-accent"],
    ["action",  "tug-badge-tinted-action"],
    ["agent",   "tug-badge-tinted-agent"],
    ["data",    "tug-badge-tinted-data"],
    ["danger",  "tug-badge-tinted-danger"],
    ["success", "tug-badge-tinted-success"],
    ["caution", "tug-badge-tinted-caution"],
  ];

  for (const [role, expectedClass] of tintedCases) {
    it(`emphasis=tinted role=${role}: applies ${expectedClass}`, () => {
      const badge = renderBadge({ emphasis: "tinted", role, children: role });
      expect(badge.className).toContain(expectedClass);
    });
  }
});

// ============================================================================
// Emphasis x Role CSS classes — filled emphasis (Spec S08, S09)
// ============================================================================

describe("TugBadge – filled emphasis", () => {
  const filledCases: Array<[TugBadgeRole, string]> = [
    ["accent",  "tug-badge-filled-accent"],
    ["action",  "tug-badge-filled-action"],
    ["agent",   "tug-badge-filled-agent"],
    ["data",    "tug-badge-filled-data"],
    ["danger",  "tug-badge-filled-danger"],
    ["success", "tug-badge-filled-success"],
    ["caution", "tug-badge-filled-caution"],
  ];

  for (const [role, expectedClass] of filledCases) {
    it(`emphasis=filled role=${role}: applies ${expectedClass}`, () => {
      const badge = renderBadge({ emphasis: "filled", role, children: role });
      expect(badge.className).toContain(expectedClass);
    });
  }
});

// ============================================================================
// Emphasis x Role CSS classes — outlined emphasis (Spec S08, S09)
// ============================================================================

describe("TugBadge – outlined emphasis", () => {
  const outlinedCases: Array<[TugBadgeRole, string]> = [
    ["accent",  "tug-badge-outlined-accent"],
    ["action",  "tug-badge-outlined-action"],
    ["agent",   "tug-badge-outlined-agent"],
    ["data",    "tug-badge-outlined-data"],
    ["danger",  "tug-badge-outlined-danger"],
    ["success", "tug-badge-outlined-success"],
    ["caution", "tug-badge-outlined-caution"],
  ];

  for (const [role, expectedClass] of outlinedCases) {
    it(`emphasis=outlined role=${role}: applies ${expectedClass}`, () => {
      const badge = renderBadge({ emphasis: "outlined", role, children: role });
      expect(badge.className).toContain(expectedClass);
    });
  }
});

// ============================================================================
// Emphasis x Role CSS classes — ghost emphasis (Spec S08, S09)
// ============================================================================

describe("TugBadge – ghost emphasis", () => {
  const ghostCases: Array<[TugBadgeRole, string]> = [
    ["accent",  "tug-badge-ghost-accent"],
    ["action",  "tug-badge-ghost-action"],
    ["agent",   "tug-badge-ghost-agent"],
    ["data",    "tug-badge-ghost-data"],
    ["danger",  "tug-badge-ghost-danger"],
    ["success", "tug-badge-ghost-success"],
    ["caution", "tug-badge-ghost-caution"],
  ];

  for (const [role, expectedClass] of ghostCases) {
    it(`emphasis=ghost role=${role}: applies ${expectedClass}`, () => {
      const badge = renderBadge({ emphasis: "ghost", role, children: role });
      expect(badge.className).toContain(expectedClass);
    });
  }
});

// ============================================================================
// Base class always present
// ============================================================================

describe("TugBadge – base class", () => {
  it("always applies tug-badge base class", () => {
    const badge = renderBadge({ children: "Tag" });
    expect(badge.className).toContain("tug-badge");
  });

  it("applies tug-badge base class with non-default emphasis and role", () => {
    const badge = renderBadge({ emphasis: "ghost", role: "danger", children: "Tag" });
    expect(badge.className).toContain("tug-badge");
  });
});
