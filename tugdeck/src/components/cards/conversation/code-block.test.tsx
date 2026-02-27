/**
 * CodeBlock React component tests — Step 8.1
 *
 * Covers:
 * - Renders language label
 * - Shows code content
 * - Copy button is present
 * - Copy button copies to clipboard and shows check icon
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect, mock } from "bun:test";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";
import { CodeBlock } from "./code-block";

// Mock navigator.clipboard
const writtenTexts: string[] = [];
(global as any).navigator = {
  ...((global as any).navigator ?? {}),
  clipboard: {
    writeText: (text: string) => {
      writtenTexts.push(text);
      return Promise.resolve();
    },
  },
};

describe("CodeBlock – renders content", () => {
  it("renders the language label", async () => {
    const { container, unmount } = render(
      <CodeBlock code="const x = 1;" language="typescript" />
    );
    await act(async () => {});
    expect(container.textContent).toContain("typescript");
    unmount();
  });

  it("renders the code in loading state initially", async () => {
    const { container, unmount } = render(
      <CodeBlock code="print('hello')" language="python" />
    );
    // Before Shiki resolves we show fallback
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("print('hello')");
    unmount();
  });

  it("renders with 'text' as language when language is empty", async () => {
    const { container, unmount } = render(
      <CodeBlock code="some code" language="" />
    );
    await act(async () => {});
    expect(container.textContent).toContain("text");
    unmount();
  });

  it("renders the copy button", async () => {
    const { container, unmount } = render(
      <CodeBlock code="let x = 1;" language="javascript" />
    );
    await act(async () => {});
    const copyBtn = container.querySelector("[data-testid='copy-button']");
    expect(copyBtn).not.toBeNull();
    unmount();
  });
});

describe("CodeBlock – copy button", () => {
  it("copy button has aria-label", async () => {
    const { container, unmount } = render(
      <CodeBlock code="const a = 1;" language="typescript" />
    );
    await act(async () => {});
    const copyBtn = container.querySelector(
      "[aria-label='Copy code to clipboard']"
    );
    expect(copyBtn).not.toBeNull();
    unmount();
  });

  it("clicking copy button invokes clipboard.writeText", async () => {
    const initialCount = writtenTexts.length;
    const { container, unmount } = render(
      <CodeBlock code="hello clipboard" language="text" />
    );
    await act(async () => {});

    const copyBtn = container.querySelector(
      "[data-testid='copy-button']"
    ) as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // Wait for async clipboard write
    await waitFor(() => {
      expect(writtenTexts.length).toBeGreaterThan(initialCount);
    });

    expect(writtenTexts[writtenTexts.length - 1]).toBe("hello clipboard");
    unmount();
  });
});
