/**
 * `enhanceFencedCode` — DOM-walks a markdown block container after its
 * `innerHTML` is set, finds every `<pre>` element produced by
 * pulldown-cmark, and wraps it in the shared markdown block chrome: a
 * sticky header bar showing the code's language plus a copy button and a
 * fold cue (see {@link buildBlockHeader}).
 *
 * Why this lives outside `parseMarkdownToSanitizedBlocks`:
 *  - The buttons + SVG icons must be live elements with event listeners
 *    attached, not strings spliced into HTML.
 *  - Both `TugMarkdownBlock` (per-cell renderer) and `TugMarkdownView`
 *    (windowed renderer) call this from the same code path right after
 *    they assign `innerHTML`, so the enhancement is invariant across
 *    both primitives.
 *
 * The header strip + Copy + fold cue are the shared `enhance-block-
 * chrome` primitives, so a fenced code block and a markdown table wear
 * the exact same chrome (sticky pin-stack header, ghost-action icon
 * buttons, `data-collapsed` fold). The only fence-specific pieces here
 * are the frame class, the language label, and the `<pre>` body.
 *
 * Idempotent: if a `<pre>` already lives inside a `.tugx-md-fenced-code`
 * wrapper (e.g., the same block is re-walked during an incremental
 * update), the function is a no-op for that `<pre>`.
 *
 * No event-listener cleanup is needed — when a parent block element is
 * replaced (`replaceChildren`, the same `el.innerHTML = ...` write, or
 * the windowing engine's prune step), the buttons are detached and
 * garbage-collected along with their listeners.
 *
 * Laws: [L06] appearance via DOM, not React state.
 *
 * @module lib/markdown/enhance-fenced-code
 */

import {
  buildBlockHeader,
  buildCopyButton,
  buildFoldButton,
} from "./enhance-block-chrome";

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

/**
 * Walk `container` for `<pre>` elements emitted by pulldown-cmark and
 * wrap each one with the shared block chrome (sticky header with the
 * language label + a Copy button + a fold cue). Idempotent.
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

    // Language label is the fence's identity, styled like a tool name.
    const langEl = document.createElement("span");
    langEl.className = "tugx-md-fenced-code-lang";
    langEl.textContent = lang ?? "code";

    const header = buildBlockHeader({
      identity: langEl,
      actions: [
        buildCopyButton(() => codeEl?.textContent ?? "", "Copy code"),
        buildFoldButton(wrapper, {
          ariaExpand: "Expand code",
          ariaCollapse: "Collapse code",
        }),
      ],
    });

    // The `<pre>` is the collapsible body the fold cue hides.
    pre.classList.add("tugx-md-chrome-body");

    // Replace the `<pre>` with the wrapper. Insert the wrapper at the
    // `<pre>`'s slot first, then move `<pre>` into it, so the document
    // layout never briefly loses the block.
    pre.replaceWith(wrapper);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  }
}
