/**
 * Tests for attachment-handler.ts
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Window } from "happy-dom";
import { processFile, AttachmentHandler, renderAttachmentChips, renderAttachButton } from "./attachment-handler";

describe("attachment-handler", () => {
  let window: Window;
  let document: Document;

  beforeEach(() => {
    window = new Window();
    document = window.document;
    globalThis.document = document as unknown as Document;
  });

  describe("processFile", () => {
    test("processes PNG image to base64", async () => {
      // Create a minimal PNG file (1x1 transparent pixel)
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
      ]);

      const file = new File([pngBytes], "test.png", { type: "image/png" });
      const attachment = await processFile(file);

      expect(attachment.filename).toBe("test.png");
      expect(attachment.media_type).toBe("image/png");
      expect(attachment.content).toBeTruthy();
      expect(attachment.content.length).toBeGreaterThan(0);
      // Content should be base64 encoded
      expect(/^[A-Za-z0-9+/]+=*$/.test(attachment.content)).toBe(true);
    });

    test("processes JPEG image to base64", async () => {
      // Minimal JPEG marker bytes
      const jpegBytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
        0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
      ]);

      const file = new File([jpegBytes], "photo.jpg", { type: "image/jpeg" });
      const attachment = await processFile(file);

      expect(attachment.filename).toBe("photo.jpg");
      expect(attachment.media_type).toBe("image/jpeg");
      expect(attachment.content).toBeTruthy();
      expect(/^[A-Za-z0-9+/]+=*$/.test(attachment.content)).toBe(true);
    });

    test("processes text file as text content", async () => {
      const content = "Hello, world!\nThis is a test.";
      const file = new File([content], "test.txt", { type: "text/plain" });
      const attachment = await processFile(file);

      expect(attachment.filename).toBe("test.txt");
      // Bun's File API may add charset parameter
      expect(attachment.media_type.startsWith("text/plain")).toBe(true);
      expect(attachment.content).toBe(content);
    });

    test("processes .md file as text", async () => {
      const content = "# Markdown Title\n\nParagraph text.";
      const file = new File([content], "README.md", { type: "" });
      const attachment = await processFile(file);

      expect(attachment.filename).toBe("README.md");
      expect(attachment.content).toBe(content);
      // Media type should default to text/plain for files with no type
      expect(attachment.media_type).toBe("text/plain");
    });

    test("processes .json file as text", async () => {
      const content = '{"key": "value"}';
      const file = new File([content], "data.json", { type: "application/json" });
      const attachment = await processFile(file);

      expect(attachment.filename).toBe("data.json");
      expect(attachment.content).toBe(content);
    });

    test("rejects binary file", async () => {
      const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const file = new File([bytes], "binary.dat", { type: "application/octet-stream" });

      await expect(processFile(file)).rejects.toThrow(/Unsupported file type/);
    });

    test("rejects PDF file", async () => {
      const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      const file = new File([pdfHeader], "document.pdf", { type: "application/pdf" });

      await expect(processFile(file)).rejects.toThrow(/Unsupported file type/);
    });
  });

  describe("AttachmentHandler", () => {
    test("addFile adds to pending attachments", async () => {
      const handler = new AttachmentHandler();
      const file = new File(["test content"], "test.txt", { type: "text/plain" });

      await handler.addFile(file);
      const attachments = handler.getAttachments();

      expect(attachments.length).toBe(1);
      expect(attachments[0].filename).toBe("test.txt");
      expect(attachments[0].content).toBe("test content");
    });

    test("removeAttachment removes correct index", async () => {
      const handler = new AttachmentHandler();
      const file1 = new File(["content 1"], "file1.txt", { type: "text/plain" });
      const file2 = new File(["content 2"], "file2.txt", { type: "text/plain" });
      const file3 = new File(["content 3"], "file3.txt", { type: "text/plain" });

      await handler.addFile(file1);
      await handler.addFile(file2);
      await handler.addFile(file3);

      handler.removeAttachment(1); // Remove file2
      const attachments = handler.getAttachments();

      expect(attachments.length).toBe(2);
      expect(attachments[0].filename).toBe("file1.txt");
      expect(attachments[1].filename).toBe("file3.txt");
    });

    test("clear empties pending list", async () => {
      const handler = new AttachmentHandler();
      const file = new File(["test"], "test.txt", { type: "text/plain" });

      await handler.addFile(file);
      expect(handler.hasPending()).toBe(true);

      handler.clear();
      expect(handler.hasPending()).toBe(false);
      expect(handler.getAttachments().length).toBe(0);
    });

    test("onUpdate callback fires on add", async () => {
      const handler = new AttachmentHandler();
      let callCount = 0;
      handler.onUpdate = () => { callCount++; };

      const file = new File(["test"], "test.txt", { type: "text/plain" });
      await handler.addFile(file);

      expect(callCount).toBe(1);
    });

    test("onUpdate callback fires on remove", async () => {
      const handler = new AttachmentHandler();
      const file = new File(["test"], "test.txt", { type: "text/plain" });
      await handler.addFile(file);

      let callCount = 0;
      handler.onUpdate = () => { callCount++; };

      handler.removeAttachment(0);
      expect(callCount).toBe(1);
    });

    test("onUpdate callback fires on clear", async () => {
      const handler = new AttachmentHandler();
      const file = new File(["test"], "test.txt", { type: "text/plain" });
      await handler.addFile(file);

      let callCount = 0;
      handler.onUpdate = () => { callCount++; };

      handler.clear();
      expect(callCount).toBe(1);
    });

    test("hasPending returns correct state", async () => {
      const handler = new AttachmentHandler();
      expect(handler.hasPending()).toBe(false);

      const file = new File(["test"], "test.txt", { type: "text/plain" });
      await handler.addFile(file);
      expect(handler.hasPending()).toBe(true);

      handler.clear();
      expect(handler.hasPending()).toBe(false);
    });

    test("getAttachments returns copy", async () => {
      const handler = new AttachmentHandler();
      const file = new File(["test"], "test.txt", { type: "text/plain" });
      await handler.addFile(file);

      const attachments = handler.getAttachments();
      attachments.push({
        filename: "fake.txt",
        content: "fake",
        media_type: "text/plain",
      });

      // Original should be unchanged
      expect(handler.getAttachments().length).toBe(1);
    });
  });

  describe("renderAttachmentChips", () => {
    test("renders chips with filename and Paperclip icon", () => {
      const attachments = [
        { filename: "test.txt", content: "content", media_type: "text/plain" },
        { filename: "image.png", content: "base64data", media_type: "image/png" },
      ];

      const container = renderAttachmentChips(attachments, { removable: false });

      expect(container.className).toBe("attachment-chips");
      expect(container.children.length).toBe(2);

      const chip1 = container.children[0] as HTMLElement;
      expect(chip1.className).toBe("attachment-chip");
      expect(chip1.querySelector(".attachment-chip-name")?.textContent).toBe("test.txt");
      expect(chip1.querySelector(".attachment-chip-icon")).toBeTruthy();

      const chip2 = container.children[1] as HTMLElement;
      expect(chip2.querySelector(".attachment-chip-name")?.textContent).toBe("image.png");
    });

    test("removable chips have X button", () => {
      const attachments = [
        { filename: "test.txt", content: "content", media_type: "text/plain" },
      ];

      let removedIndex = -1;
      const container = renderAttachmentChips(attachments, {
        removable: true,
        onRemove: (index) => { removedIndex = index; },
      });

      const chip = container.children[0] as HTMLElement;
      const removeBtn = chip.querySelector(".attachment-chip-remove") as HTMLButtonElement;

      expect(removeBtn).toBeTruthy();
      expect(removeBtn.dataset.index).toBe("0");

      removeBtn.click();
      expect(removedIndex).toBe(0);
    });

    test("non-removable chips have no X button", () => {
      const attachments = [
        { filename: "test.txt", content: "content", media_type: "text/plain" },
      ];

      const container = renderAttachmentChips(attachments, { removable: false });
      const chip = container.children[0] as HTMLElement;
      const removeBtn = chip.querySelector(".attachment-chip-remove");

      expect(removeBtn).toBeNull();
    });

    test("renders empty container for empty array", () => {
      const container = renderAttachmentChips([], { removable: false });

      expect(container.className).toBe("attachment-chips");
      expect(container.children.length).toBe(0);
    });
  });

  describe("renderAttachButton", () => {
    test("renders button with Paperclip icon", () => {
      const button = renderAttachButton(() => {});

      expect(button.className).toBe("attach-btn");
      expect(button.type).toBe("button");
      expect(button.title).toBe("Attach files");
      expect(button.querySelector("svg")).toBeTruthy();
    });

    test("clicking button triggers file picker", () => {
      let fileListReceived: FileList | null = null;
      const button = renderAttachButton((files) => {
        fileListReceived = files;
      });

      // Create a mock FileList
      const mockFile = new File(["test"], "test.txt", { type: "text/plain" });
      const mockFileList = {
        0: mockFile,
        length: 1,
        item: (index: number) => (index === 0 ? mockFile : null),
        [Symbol.iterator]: function* () {
          yield mockFile;
        },
      } as unknown as FileList;

      // Mock the input click behavior
      const originalCreateElement = document.createElement.bind(document);
      document.createElement = function (tagName: string) {
        const element = originalCreateElement(tagName);
        if (tagName === "input") {
          // Mock the input behavior
          Object.defineProperty(element, "files", {
            get: () => mockFileList,
            configurable: true,
          });
          // Override click to immediately trigger change event
          const originalClick = element.click.bind(element);
          element.click = function () {
            originalClick();
            // Trigger change event
            const changeEvent = new window.Event("change");
            element.dispatchEvent(changeEvent);
          };
        }
        return element;
      };

      button.click();

      // Callback should be called with the mock FileList
      expect(fileListReceived).toBeTruthy();
      expect(fileListReceived?.length).toBe(1);

      // Restore
      document.createElement = originalCreateElement;
    });
  });
});
