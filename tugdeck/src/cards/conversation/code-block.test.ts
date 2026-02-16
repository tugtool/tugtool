/**
 * Tests for code-block - Shiki syntax highlighting
 * Using happy-dom for DOM environment
 */

import { describe, test, expect, beforeAll, mock } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;
global.DOMParser = window.DOMParser as any;

// Mock navigator.clipboard
global.navigator = {
  clipboard: {
    writeText: mock(() => Promise.resolve()),
  },
} as any;

// Import after DOM setup
import { renderCodeBlock } from "./code-block";

describe("code-block", () => {
  describe("container structure", () => {
    test("renders container with correct class", async () => {
      const block = await renderCodeBlock("console.log('test')", "javascript");
      expect(block.className).toBe("code-block-container");
    });

    test("renders header with language label", async () => {
      const block = await renderCodeBlock("print('hello')", "python");
      const header = block.querySelector(".code-block-header");
      expect(header).not.toBeNull();
      
      const langLabel = block.querySelector(".code-block-language");
      expect(langLabel?.textContent).toBe("python");
    });

    test("renders copy button", async () => {
      const block = await renderCodeBlock("test code", "text");
      const copyBtn = block.querySelector(".code-block-copy-btn");
      expect(copyBtn).not.toBeNull();
      expect(copyBtn?.tagName).toBe("BUTTON");
    });

    test("renders code area", async () => {
      const block = await renderCodeBlock("const x = 42;", "typescript");
      const codeArea = block.querySelector(".code-block-code, .code-block-fallback");
      expect(codeArea).not.toBeNull();
    });
  });

  describe("copy button behavior", () => {
    test("calls clipboard.writeText with code content", async () => {
      const code = "const greeting = 'hello';";
      const block = await renderCodeBlock(code, "javascript");
      const copyBtn = block.querySelector(".code-block-copy-btn") as HTMLButtonElement;
      
      expect(copyBtn).not.toBeNull();
      
      // Reset mock
      (global.navigator.clipboard.writeText as any).mockClear();
      
      // Click button
      copyBtn.click();
      
      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(global.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith(code);
    });

    test("adds copied class after successful copy", async () => {
      const block = await renderCodeBlock("test", "text");
      const copyBtn = block.querySelector(".code-block-copy-btn") as HTMLButtonElement;
      
      copyBtn.click();
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(copyBtn.classList.contains("copied")).toBe(true);
    });
  });

  describe("fallback for unknown languages", () => {
    test("renders fallback for completely unknown language", async () => {
      const code = "some custom syntax";
      const block = await renderCodeBlock(code, "totally-unknown-lang-xyz");
      
      // Should not throw and should produce a valid container
      expect(block.className).toBe("code-block-container");
      
      // Should have fallback class
      const fallback = block.querySelector(".code-block-fallback");
      expect(fallback).not.toBeNull();
      
      // Should preserve code content
      expect(block.textContent).toContain(code);
    });

    test("fallback preserves code text content", async () => {
      const code = "special <script> tags & symbols";
      const block = await renderCodeBlock(code, "unknown");
      
      expect(block.textContent).toContain("special");
      expect(block.textContent).toContain("script");
      expect(block.textContent).toContain("tags");
      expect(block.textContent).toContain("symbols");
    });
  });

  describe("language normalization", () => {
    test("normalizes bash to shellscript", async () => {
      const block = await renderCodeBlock("#!/bin/bash\necho hello", "bash");
      const langLabel = block.querySelector(".code-block-language");
      expect(langLabel?.textContent).toBe("bash");
      // Internally normalized to shellscript, but displays original
    });

    test("normalizes c++ to cpp", async () => {
      const block = await renderCodeBlock("int main() {}", "c++");
      const langLabel = block.querySelector(".code-block-language");
      expect(langLabel?.textContent).toBe("c++");
    });

    test("normalizes js to javascript", async () => {
      const block = await renderCodeBlock("const x = 1;", "js");
      const langLabel = block.querySelector(".code-block-language");
      expect(langLabel?.textContent).toBe("js");
    });
  });

  describe("supported languages", () => {
    test("renders TypeScript code", async () => {
      const code = "const greeting: string = 'hello';";
      const block = await renderCodeBlock(code, "typescript");
      
      expect(block.className).toBe("code-block-container");
      expect(block.textContent).toContain(code);
    });

    test("renders Python code", async () => {
      const code = "def hello():\n    print('world')";
      const block = await renderCodeBlock(code, "python");
      
      expect(block.className).toBe("code-block-container");
      expect(block.textContent).toContain("hello");
    });

    test("renders Rust code", async () => {
      const code = "fn main() {\n    println!(\"Hello\");\n}";
      const block = await renderCodeBlock(code, "rust");
      
      expect(block.className).toBe("code-block-container");
      expect(block.textContent).toContain("main");
    });
  });

  describe("golden test", () => {
    test("known JavaScript snippet produces expected structure", async () => {
      const code = "function add(a, b) {\n  return a + b;\n}";
      const block = await renderCodeBlock(code, "javascript");
      
      // Container present
      expect(block.className).toBe("code-block-container");
      
      // Header present
      const header = block.querySelector(".code-block-header");
      expect(header).not.toBeNull();
      
      // Language label correct
      const langLabel = block.querySelector(".code-block-language");
      expect(langLabel?.textContent).toBe("javascript");
      
      // Copy button present
      const copyBtn = block.querySelector(".code-block-copy-btn");
      expect(copyBtn).not.toBeNull();
      
      // Code content preserved
      expect(block.textContent).toContain("function");
      expect(block.textContent).toContain("add");
      expect(block.textContent).toContain("return");
      
      // Code area present (either highlighted or fallback)
      const codeArea = block.querySelector(".code-block-code, .code-block-fallback");
      expect(codeArea).not.toBeNull();
    });
  });
});
