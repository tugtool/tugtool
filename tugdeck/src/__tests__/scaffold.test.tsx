/**
 * Scaffold validation tests for Step 1.
 *
 * Validates:
 * 1. shadcn Button can be imported and rendered.
 * 2. React rendering via createRoot works with happy-dom + bun test.
 * 3. RTL render() and fireEvent work correctly.
 *
 * Uses @testing-library/react via container queries (not screen, which requires
 * document.body integration with happy-dom) for cross-worker compatibility in
 * bun 1.3.9.
 */
import "./setup-rtl";

import { describe, it, expect, mock } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("shadcn scaffold", () => {
  it("renders a shadcn Button component", () => {
    const { container } = render(<Button>Click me</Button>);
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
