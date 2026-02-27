/**
 * MessageRenderer React component tests — Step 8.1
 *
 * Covers:
 * - Renders markdown content as HTML
 * - Sanitizes HTML via dompurify (XSS prevention)
 * - Shows streaming cursor when isStreaming=true
 * - Hides streaming cursor when isStreaming=false
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";
import React from "react";
import { MessageRenderer } from "./message-renderer";

describe("MessageRenderer – markdown rendering", () => {
  it("renders plain text", async () => {
    const { container, unmount } = render(
      <MessageRenderer text="Hello world" />
    );
    await act(async () => {});
    expect(container.textContent).toContain("Hello world");
    unmount();
  });

  it("renders markdown bold as <strong>", async () => {
    const { container, unmount } = render(
      <MessageRenderer text="**bold text**" />
    );
    await act(async () => {});
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold text");
    unmount();
  });

  it("wraps content in conversation-prose div", async () => {
    const { container, unmount } = render(
      <MessageRenderer text="some text" />
    );
    await act(async () => {});
    const prose = container.querySelector(".conversation-prose");
    expect(prose).not.toBeNull();
    unmount();
  });
});

describe("MessageRenderer – HTML sanitization", () => {
  it("removes script tags (XSS prevention)", async () => {
    const { container, unmount } = render(
      <MessageRenderer text={"<script>alert('xss')</script>safe content"} />
    );
    await act(async () => {});
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("safe content");
    unmount();
  });

  it("removes onclick attributes", async () => {
    const { container, unmount } = render(
      <MessageRenderer text={'<p onclick="evil()">click me</p>'} />
    );
    await act(async () => {});
    const p = container.querySelector("p");
    expect(p?.getAttribute("onclick")).toBeNull();
    unmount();
  });
});

describe("MessageRenderer – streaming cursor", () => {
  it("shows streaming cursor when isStreaming=true", async () => {
    const { container, unmount } = render(
      <MessageRenderer text="partial text" isStreaming={true} />
    );
    await act(async () => {});
    const cursor = container.querySelector("[data-testid='streaming-cursor']");
    expect(cursor).not.toBeNull();
    unmount();
  });

  it("hides streaming cursor when isStreaming=false", async () => {
    const { container, unmount } = render(
      <MessageRenderer text="complete text" isStreaming={false} />
    );
    await act(async () => {});
    const cursor = container.querySelector("[data-testid='streaming-cursor']");
    expect(cursor).toBeNull();
    unmount();
  });

  it("defaults isStreaming to false", async () => {
    const { container, unmount } = render(
      <MessageRenderer text="text" />
    );
    await act(async () => {});
    const cursor = container.querySelector("[data-testid='streaming-cursor']");
    expect(cursor).toBeNull();
    unmount();
  });
});
