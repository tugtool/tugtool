/**
 * Tests for `enhanceFencedCode` — DOM-walks a markdown block container
 * and wraps each `<pre>` element with a header bar (language label +
 * copy-to-clipboard button).
 *
 * Coverage:
 *  - Wraps a `<pre><code class="language-X">` with the chrome and
 *    sets `data-lang="X"` on the wrapper.
 *  - Falls back to "code" label when the fence has no language tag.
 *  - Idempotent: re-running on an already-enhanced container is a no-op.
 *  - Copy button is a real `<button>` with `aria-label="Copy code"`.
 *  - Click on the copy button writes the code text to the clipboard
 *    and toggles the `is-copied` class for the CSS feedback swap.
 *  - Clicking does not break when `navigator.clipboard` is missing.
 *  - Containers with no fenced code (paragraphs only, etc.) are
 *    untouched.
 *
 * Test environment: happy-dom via setup-rtl. `enhanceFencedCode` is a
 * pure DOM helper (no React renders, no focus / selection / event
 * ordering across rerenders), so happy-dom is the appropriate scope.
 */

import "../../../__tests__/setup-rtl";

import { afterEach, describe, expect, mock, test, beforeEach } from "bun:test";

import { enhanceFencedCode } from "../enhance-fenced-code";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let root: HTMLElement;
let originalClipboard: PropertyDescriptor | undefined;

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  root = document.getElementById("root") as HTMLElement;
  // Snapshot navigator.clipboard so tests that mutate it can restore.
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
});

afterEach(() => {
  document.body.innerHTML = "";
  // Restore the original clipboard descriptor (or remove the override).
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  }
});

function setHtml(html: string): void {
  root.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Wrapping
// ---------------------------------------------------------------------------

describe("enhanceFencedCode — wrapping", () => {
  test("wraps a fenced code block with language chrome", () => {
    setHtml(`<pre><code class="language-rust">fn main() {}</code></pre>`);
    enhanceFencedCode(root);

    const wrapper = root.querySelector(".tugx-md-fenced-code") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.dataset.lang).toBe("rust");

    const header = wrapper.querySelector(".tugx-md-fenced-code-header");
    expect(header).not.toBeNull();

    const lang = wrapper.querySelector(".tugx-md-fenced-code-lang");
    expect(lang?.textContent).toBe("rust");

    const button = wrapper.querySelector(
      ".tugx-md-fenced-code-copy",
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Copy code");

    // The pre is now a child of the wrapper.
    const pre = wrapper.querySelector(":scope > pre") as HTMLElement;
    expect(pre).not.toBeNull();
    expect(pre.querySelector("code")?.textContent).toBe("fn main() {}");
  });

  test("Copy lives in the actions row, not in the identity header", () => {
    // Step 10.9 Phase B.2 — fenced-code Copy moved out of
    // `.tugx-md-fenced-code-header` into `.tugx-md-fenced-code-actions`
    // so the two strips can stack when both pin. The identity header
    // now carries only the language label.
    setHtml(`<pre><code class="language-ts">x</code></pre>`);
    enhanceFencedCode(root);

    const header = root.querySelector(
      ".tugx-md-fenced-code-header",
    ) as HTMLElement;
    const actions = root.querySelector(
      ".tugx-md-fenced-code-actions",
    ) as HTMLElement;
    expect(header).not.toBeNull();
    expect(actions).not.toBeNull();

    // Copy is NOT in the header.
    expect(header.querySelector(".tugx-md-fenced-code-copy")).toBeNull();
    // Copy IS in the actions row.
    expect(actions.querySelector(".tugx-md-fenced-code-copy")).not.toBeNull();

    // DOM order: header, then actions, then pre.
    const wrapper = root.querySelector(".tugx-md-fenced-code") as HTMLElement;
    const children = Array.from(wrapper.children);
    expect(children[0]).toBe(header);
    expect(children[1]).toBe(actions);
    expect(children[2]?.tagName).toBe("PRE");
  });

  test("falls back to 'code' label for fences with no language tag", () => {
    setHtml(`<pre><code>plain code</code></pre>`);
    enhanceFencedCode(root);

    const wrapper = root.querySelector(".tugx-md-fenced-code") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.dataset.lang).toBeUndefined();

    const lang = wrapper.querySelector(".tugx-md-fenced-code-lang");
    expect(lang?.textContent).toBe("code");
  });

  test("normalizes the language tag to lowercase", () => {
    setHtml(`<pre><code class="language-TypeScript">x</code></pre>`);
    enhanceFencedCode(root);

    const wrapper = root.querySelector(".tugx-md-fenced-code") as HTMLElement;
    expect(wrapper.dataset.lang).toBe("typescript");
    expect(wrapper.querySelector(".tugx-md-fenced-code-lang")?.textContent).toBe(
      "typescript",
    );
  });

  test("wraps multiple fenced blocks in one container", () => {
    setHtml(`
      <pre><code class="language-ts">a</code></pre>
      <p>between</p>
      <pre><code class="language-rust">b</code></pre>
    `);
    enhanceFencedCode(root);

    const wrappers = root.querySelectorAll(".tugx-md-fenced-code");
    expect(wrappers.length).toBe(2);
    expect((wrappers[0] as HTMLElement).dataset.lang).toBe("ts");
    expect((wrappers[1] as HTMLElement).dataset.lang).toBe("rust");
  });

  test("is idempotent — running twice on the same container is a no-op", () => {
    setHtml(`<pre><code class="language-ts">x</code></pre>`);
    enhanceFencedCode(root);
    enhanceFencedCode(root);
    expect(root.querySelectorAll(".tugx-md-fenced-code").length).toBe(1);
    expect(root.querySelectorAll(".tugx-md-fenced-code-header").length).toBe(1);
  });

  test("leaves containers without fenced code untouched", () => {
    setHtml(`<p>just a paragraph</p>`);
    const beforeHtml = root.innerHTML;
    enhanceFencedCode(root);
    expect(root.innerHTML).toBe(beforeHtml);
  });

  test("includes both 'Copy' and 'Copied!' label spans for the copied-state swap", () => {
    setHtml(`<pre><code class="language-ts">x</code></pre>`);
    enhanceFencedCode(root);
    const labels = root.querySelectorAll(".tugx-md-fenced-code-copy-label");
    expect(labels.length).toBe(2);
    const labelTexts = Array.from(labels).map((l) => l.textContent);
    expect(labelTexts).toContain("Copy");
    expect(labelTexts).toContain("Copied!");
  });

  test("includes both default and copied SVG icons", () => {
    setHtml(`<pre><code class="language-ts">x</code></pre>`);
    enhanceFencedCode(root);
    expect(
      root.querySelector(".tugx-md-fenced-code-copy-icon--default"),
    ).not.toBeNull();
    expect(
      root.querySelector(".tugx-md-fenced-code-copy-icon--copied"),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Copy interaction
// ---------------------------------------------------------------------------

describe("enhanceFencedCode — copy interaction", () => {
  test("clicking the copy button writes code text to the clipboard", () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    setHtml(`<pre><code class="language-rust">fn main() {}</code></pre>`);
    enhanceFencedCode(root);
    const button = root.querySelector(
      ".tugx-md-fenced-code-copy",
    ) as HTMLButtonElement;

    button.click();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("fn main() {}");
  });

  test("after a successful copy, button toggles 'is-copied' for CSS feedback", async () => {
    let resolveWrite: () => void = () => {};
    const writeText = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    setHtml(`<pre><code class="language-rust">fn main() {}</code></pre>`);
    enhanceFencedCode(root);
    const button = root.querySelector(
      ".tugx-md-fenced-code-copy",
    ) as HTMLButtonElement;

    button.click();
    expect(button.classList.contains("is-copied")).toBe(false);

    // Resolve the clipboard promise → the .then() should fire on the
    // next microtask, and the class flips on.
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();
    expect(button.classList.contains("is-copied")).toBe(true);
  });

  test("does not throw when navigator.clipboard is unavailable", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    setHtml(`<pre><code class="language-ts">x</code></pre>`);
    enhanceFencedCode(root);
    const button = root.querySelector(
      ".tugx-md-fenced-code-copy",
    ) as HTMLButtonElement;

    expect(() => button.click()).not.toThrow();
    expect(button.classList.contains("is-copied")).toBe(false);
  });

  test("clipboard rejection does not toggle the copied class", async () => {
    const writeText = mock(() => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    setHtml(`<pre><code class="language-ts">x</code></pre>`);
    enhanceFencedCode(root);
    const button = root.querySelector(
      ".tugx-md-fenced-code-copy",
    ) as HTMLButtonElement;

    button.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(button.classList.contains("is-copied")).toBe(false);
  });
});
