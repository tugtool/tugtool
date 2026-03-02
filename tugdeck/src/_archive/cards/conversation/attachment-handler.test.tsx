/**
 * AttachmentHandler React component tests — Step 8.2
 *
 * Covers:
 * - Renders the attach button
 * - Shows attachment chips when attachments are added
 * - Remove button removes the attachment
 * - Accepts file drops (simulated via addFile imperative handle)
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import React, { createRef } from "react";
import { AttachmentHandler, type AttachmentHandlerHandle } from "./attachment-handler";

// ---- Helpers ----

function makeTextFile(name: string, content: string): File {
  return new File([content], name, { type: "text/plain" });
}

// ---- Tests ----

describe("AttachmentHandler – renders attach button", () => {
  it("renders the attach button", async () => {
    const { container, unmount } = render(<AttachmentHandler />);
    await act(async () => {});
    const btn = container.querySelector("[data-testid='attach-button']");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("Attach files");
    unmount();
  });

  it("renders no chips when no attachments", async () => {
    const { container, unmount } = render(<AttachmentHandler />);
    await act(async () => {});
    const chips = container.querySelectorAll("[data-testid='attachment-chip']");
    expect(chips.length).toBe(0);
    unmount();
  });
});

describe("AttachmentHandler – attachment chips", () => {
  it("shows a chip after addFile is called", async () => {
    const ref = createRef<AttachmentHandlerHandle>();
    const { container, unmount } = render(<AttachmentHandler ref={ref} />);
    await act(async () => {});

    const file = makeTextFile("hello.txt", "hello content");
    await act(async () => {
      await ref.current?.addFile(file);
    });

    const chips = container.querySelectorAll("[data-testid='attachment-chip']");
    expect(chips.length).toBe(1);
    expect(container.textContent).toContain("hello.txt");
    unmount();
  });

  it("shows multiple chips for multiple files", async () => {
    const ref = createRef<AttachmentHandlerHandle>();
    const { container, unmount } = render(<AttachmentHandler ref={ref} />);
    await act(async () => {});

    await act(async () => {
      await ref.current?.addFile(makeTextFile("a.txt", "a"));
      await ref.current?.addFile(makeTextFile("b.md", "b"));
    });

    const chips = container.querySelectorAll("[data-testid='attachment-chip']");
    expect(chips.length).toBe(2);
    unmount();
  });

  it("removes a chip when remove button is clicked", async () => {
    const ref = createRef<AttachmentHandlerHandle>();
    const { container, unmount } = render(<AttachmentHandler ref={ref} />);
    await act(async () => {});

    await act(async () => {
      await ref.current?.addFile(makeTextFile("delete-me.txt", "bye"));
    });

    expect(
      container.querySelectorAll("[data-testid='attachment-chip']").length
    ).toBe(1);

    const removeBtn = container.querySelector(
      "[data-testid='remove-attachment-0']"
    ) as HTMLButtonElement;
    expect(removeBtn).not.toBeNull();

    await act(async () => { fireEvent.click(removeBtn); });

    expect(
      container.querySelectorAll("[data-testid='attachment-chip']").length
    ).toBe(0);
    unmount();
  });
});

describe("AttachmentHandler – imperative handle", () => {
  it("getAttachments returns empty array initially", async () => {
    const ref = createRef<AttachmentHandlerHandle>();
    const { unmount } = render(<AttachmentHandler ref={ref} />);
    await act(async () => {});
    expect(ref.current?.getAttachments()).toEqual([]);
    unmount();
  });

  it("getAttachments returns added attachment", async () => {
    const ref = createRef<AttachmentHandlerHandle>();
    const { unmount } = render(<AttachmentHandler ref={ref} />);
    await act(async () => {});

    const file = makeTextFile("readme.md", "# title");
    await act(async () => { await ref.current?.addFile(file); });

    const attachments = ref.current?.getAttachments() ?? [];
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe("readme.md");
    unmount();
  });

  it("clear() removes all attachments", async () => {
    const ref = createRef<AttachmentHandlerHandle>();
    const { container, unmount } = render(<AttachmentHandler ref={ref} />);
    await act(async () => {});

    await act(async () => {
      await ref.current?.addFile(makeTextFile("a.txt", "a"));
      await ref.current?.addFile(makeTextFile("b.txt", "b"));
    });

    await act(async () => { ref.current?.clear(); });

    expect(
      container.querySelectorAll("[data-testid='attachment-chip']").length
    ).toBe(0);
    expect(ref.current?.getAttachments()).toEqual([]);
    unmount();
  });
});
