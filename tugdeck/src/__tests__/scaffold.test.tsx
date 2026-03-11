/**
 * Scaffold validation tests for Step 1 (Phase 8a).
 *
 * Validates:
 * 1. TugButton can be imported and rendered (shadcn removed; Radix-direct).
 * 2. React rendering via createRoot works with happy-dom + bun test.
 * 3. RTL render() and fireEvent work correctly.
 */
import "./setup-rtl";

import { describe, it, expect, mock } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import { TugButton } from "@/components/tugways/tug-button";

describe("tug-button scaffold", () => {
  it("renders a TugButton component", () => {
    const { container } = render(<TugButton>Click me</TugButton>);
    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("Click me");
  });

  it("RTL fireEvent works with happy-dom", () => {
    const handler = mock(() => {});
    const { container } = render(<button onClick={handler}>click me</button>);
    const btn = container.querySelector("button")!;
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
