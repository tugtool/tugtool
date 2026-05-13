/**
 * `enhanceFencedCode` — DOM-walks a markdown block container after
 * its `innerHTML` is set, finds every `<pre>` element produced by
 * pulldown-cmark, and wraps it in chrome: a header bar showing the
 * code's language plus a copy-to-clipboard button.
 *
 * Why this lives outside `parseMarkdownToSanitizedBlocks`:
 *  - The button + SVG icon must be live elements with an event
 *    listener attached, not strings spliced into HTML.
 *  - Both `TugMarkdownBlock` (per-cell renderer) and `TugMarkdownView`
 *    (windowed renderer) call this from the same code path right after
 *    they assign `innerHTML`, so the enhancement is invariant across
 *    both primitives.
 *
 * Idempotent: if a `<pre>` already lives inside a
 * `.tugx-md-fenced-code` wrapper (e.g., the same block is re-walked
 * during an incremental update), the function is a no-op for that
 * `<pre>`.
 *
 * No event-listener cleanup is needed — when a parent block element
 * is replaced (`replaceChildren`, the same `el.innerHTML = ...` write,
 * or the windowing engine's prune step), the buttons are detached
 * and garbage-collected along with their listeners.
 *
 * Laws: [L06] appearance via DOM, not React state. The "Copied!"
 *       feedback toggles a class via DOM mutation; React never
 *       re-renders for this.
 *
 * @module lib/markdown/enhance-fenced-code
 */

// ---------------------------------------------------------------------------
// SVG icon paths (lucide). Inlined here so the imperative DOM build
// path doesn't need to mount React components for icons.
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide `Copy` icon path data (24×24 viewBox). */
const COPY_ICON_PATHS: ReadonlyArray<{ tag: string; attrs: Record<string, string> }> = [
  { tag: "rect", attrs: { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" } },
  { tag: "path", attrs: { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" } },
];

/** Lucide `Check` icon path data (24×24 viewBox). */
const CHECK_ICON_PATHS: ReadonlyArray<{ tag: string; attrs: Record<string, string> }> = [
  { tag: "path", attrs: { d: "M20 6 9 17l-5-5" } },
];

/**
 * Build a 14×14 SVG icon element with the standard lucide stroke
 * styling. The size is small enough to sit inline within the header
 * row without crowding the language label.
 */
function buildIcon(
  paths: ReadonlyArray<{ tag: string; attrs: Record<string, string> }>,
  variant: "default" | "copied",
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("tugx-md-fenced-code-copy-icon");
  svg.classList.add(`tugx-md-fenced-code-copy-icon--${variant}`);
  for (const p of paths) {
    const child = document.createElementNS(SVG_NS, p.tag);
    for (const [k, v] of Object.entries(p.attrs)) child.setAttribute(k, v);
    svg.appendChild(child);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/** Parses the language tag off a `<code class="language-X">` element.
 *  Returns `null` for unspecified-language fenced blocks. */
function readLanguage(codeEl: HTMLElement): string | null {
  for (const cls of codeEl.classList) {
    if (cls.startsWith("language-")) {
      const lang = cls.slice("language-".length).trim().toLowerCase();
      return lang === "" ? null : lang;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Copy interaction
// ---------------------------------------------------------------------------

const COPIED_CLASS = "is-copied";
const COPIED_DURATION_MS = 1200;

/**
 * Read the code text out of the `<pre><code>...</code></pre>` and
 * write it to the clipboard. On success, toggle the `is-copied` class
 * on the button so the CSS swaps the icon and label briefly.
 *
 * Falls back to no-op if `navigator.clipboard` is unavailable (e.g.,
 * non-secure contexts in older browsers); the surface stays usable.
 */
function attachCopyHandler(button: HTMLButtonElement, codeEl: HTMLElement): void {
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  button.addEventListener("click", (e) => {
    e.preventDefault();
    const text = codeEl.textContent ?? "";
    const writer = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!writer) return;
    void writer(text)
      .then(() => {
        button.classList.add(COPIED_CLASS);
        if (resetTimer !== null) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          button.classList.remove(COPIED_CLASS);
          resetTimer = null;
        }, COPIED_DURATION_MS);
      })
      .catch(() => {
        // Clipboard write rejected (permission denied, etc.) — leave
        // the button in its rest state.
      });
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Walk `container` for `<pre>` elements emitted by pulldown-cmark and
 * wrap each one with the fenced-code chrome (header bar with the
 * language label + a copy button). Idempotent.
 */
export function enhanceFencedCode(container: HTMLElement): void {
  const preEls = container.querySelectorAll("pre");
  for (const pre of preEls) {
    // Already enhanced — skip. The wrapper `.tugx-md-fenced-code` is
    // an immediate parent for an enhanced `<pre>`.
    const parent = pre.parentElement;
    if (parent !== null && parent.classList.contains("tugx-md-fenced-code")) {
      continue;
    }

    const codeEl = pre.querySelector(":scope > code") as HTMLElement | null;
    const lang = codeEl !== null ? readLanguage(codeEl) : null;

    const wrapper = document.createElement("div");
    wrapper.className = "tugx-md-fenced-code";
    if (lang !== null) wrapper.dataset.lang = lang;

    // Header — language label at the left, Copy `<button>` at the
    // trailing edge. Affordances live in the header itself (no
    // dedicated `.tugx-md-fenced-code-actions` sticky strip), so the
    // resting chrome is a single row carrying both identity and Copy,
    // matching FileBlock / DiffBlock / TerminalBlock's shape.
    const header = document.createElement("div");
    header.className = "tugx-md-fenced-code-header";

    const langEl = document.createElement("span");
    langEl.className = "tugx-md-fenced-code-lang";
    langEl.textContent = lang ?? "code";
    header.appendChild(langEl);

    const spacer = document.createElement("span");
    spacer.className = "tugx-md-fenced-code-header-spacer";
    header.appendChild(spacer);

    // Trailing actions cluster — hosts Copy. Mirrors the React body
    // kinds' `.tugx-{kind}-actions-cluster` shape; the
    // `data-slot="md-fenced-code-actions"` hook lets tests and
    // consumers locate "this block's affordances" by data-slot.
    const actions = document.createElement("span");
    actions.className = "tugx-md-fenced-code-actions-cluster";
    actions.dataset.slot = "md-fenced-code-actions";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tugx-md-fenced-code-copy";
    button.setAttribute("aria-label", "Copy code");

    button.appendChild(buildIcon(COPY_ICON_PATHS, "default"));
    button.appendChild(buildIcon(CHECK_ICON_PATHS, "copied"));

    const labelDefault = document.createElement("span");
    labelDefault.className =
      "tugx-md-fenced-code-copy-label tugx-md-fenced-code-copy-label--default";
    labelDefault.textContent = "Copy";
    button.appendChild(labelDefault);

    const labelCopied = document.createElement("span");
    labelCopied.className =
      "tugx-md-fenced-code-copy-label tugx-md-fenced-code-copy-label--copied";
    labelCopied.textContent = "Copied!";
    button.appendChild(labelCopied);

    if (codeEl !== null) attachCopyHandler(button, codeEl);

    actions.appendChild(button);
    header.appendChild(actions);

    // Replace the `<pre>` with the wrapper. The order of operations
    // matters: insert the wrapper at the `<pre>`'s slot first, then
    // move `<pre>` into the wrapper, so the document layout never
    // briefly loses the block.
    pre.replaceWith(wrapper);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  }
}
