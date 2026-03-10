/**
 * TugSkeleton unit tests -- Step 8.
 *
 * Tests cover:
 * - TugSkeleton renders a div with class "tug-skeleton"
 * - TugSkeleton applies width and height as inline styles
 * - TugSkeleton applies radius override as inline style
 * - TugSkeleton default props produce expected output
 * - TugSkeleton forwards additional className
 * - TugSkeletonGroup renders children within a ".tug-skeleton-group" container
 * - TugSkeletonGroup applies gap as inline style
 * - TugSkeletonGroup default gap
 * - TugSkeletonGroup forwards additional className
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { render } from "@testing-library/react";

import { TugSkeleton, TugSkeletonGroup } from "@/components/tugways/tug-skeleton";

// ============================================================================
// TugSkeleton
// ============================================================================

describe("TugSkeleton – class and aria", () => {
  it("renders a div with class tug-skeleton", () => {
    const { container } = render(<TugSkeleton />);
    const el = container.querySelector(".tug-skeleton");
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("DIV");
  });

  it("has aria-hidden=true", () => {
    const { container } = render(<TugSkeleton />);
    const el = container.querySelector(".tug-skeleton");
    expect(el!.getAttribute("aria-hidden")).toBe("true");
  });

  it("forwards additional className", () => {
    const { container } = render(<TugSkeleton className="my-extra" />);
    const el = container.querySelector(".tug-skeleton");
    expect(el!.className).toContain("my-extra");
    expect(el!.className).toContain("tug-skeleton");
  });
});

describe("TugSkeleton – default props", () => {
  it("defaults to width 100%", () => {
    const { container } = render(<TugSkeleton />);
    const el = container.querySelector<HTMLElement>(".tug-skeleton");
    expect(el!.style.width).toBe("100%");
  });

  it("defaults to height 14px", () => {
    const { container } = render(<TugSkeleton />);
    const el = container.querySelector<HTMLElement>(".tug-skeleton");
    expect(el!.style.height).toBe("14px");
  });

  it("does not set inline borderRadius by default (uses CSS token)", () => {
    const { container } = render(<TugSkeleton />);
    const el = container.querySelector<HTMLElement>(".tug-skeleton");
    expect(el!.style.borderRadius).toBe("");
  });
});

describe("TugSkeleton – explicit props", () => {
  it("applies width prop as inline style", () => {
    const { container } = render(<TugSkeleton width="60%" />);
    const el = container.querySelector<HTMLElement>(".tug-skeleton");
    expect(el!.style.width).toBe("60%");
  });

  it("applies height prop as inline style in px", () => {
    const { container } = render(<TugSkeleton height={24} />);
    const el = container.querySelector<HTMLElement>(".tug-skeleton");
    expect(el!.style.height).toBe("24px");
  });

  it("applies radius prop as inline borderRadius", () => {
    const { container } = render(<TugSkeleton radius="50%" />);
    const el = container.querySelector<HTMLElement>(".tug-skeleton");
    expect(el!.style.borderRadius).toBe("50%");
  });

  it("applies pixel width prop", () => {
    const { container } = render(<TugSkeleton width="120px" />);
    const el = container.querySelector<HTMLElement>(".tug-skeleton");
    expect(el!.style.width).toBe("120px");
  });
});

// ============================================================================
// TugSkeletonGroup
// ============================================================================

describe("TugSkeletonGroup – class and structure", () => {
  it("renders a div with class tug-skeleton-group", () => {
    const { container } = render(
      <TugSkeletonGroup>
        <TugSkeleton />
      </TugSkeletonGroup>
    );
    const el = container.querySelector(".tug-skeleton-group");
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("DIV");
  });

  it("renders children within the group container", () => {
    const { container } = render(
      <TugSkeletonGroup>
        <TugSkeleton width="80%" />
        <TugSkeleton width="60%" />
        <TugSkeleton width="40%" />
      </TugSkeletonGroup>
    );
    const group = container.querySelector(".tug-skeleton-group");
    const skeletons = group!.querySelectorAll(".tug-skeleton");
    expect(skeletons.length).toBe(3);
  });

  it("forwards additional className", () => {
    const { container } = render(
      <TugSkeletonGroup className="extra-group">
        <TugSkeleton />
      </TugSkeletonGroup>
    );
    const el = container.querySelector(".tug-skeleton-group");
    expect(el!.className).toContain("extra-group");
    expect(el!.className).toContain("tug-skeleton-group");
  });
});

describe("TugSkeletonGroup – gap", () => {
  it("defaults to gap 8px", () => {
    const { container } = render(
      <TugSkeletonGroup>
        <TugSkeleton />
      </TugSkeletonGroup>
    );
    const el = container.querySelector<HTMLElement>(".tug-skeleton-group");
    expect(el!.style.gap).toBe("8px");
  });

  it("applies custom gap as inline style", () => {
    const { container } = render(
      <TugSkeletonGroup gap={16}>
        <TugSkeleton />
      </TugSkeletonGroup>
    );
    const el = container.querySelector<HTMLElement>(".tug-skeleton-group");
    expect(el!.style.gap).toBe("16px");
  });
});
