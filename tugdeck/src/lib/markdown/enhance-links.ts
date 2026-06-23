/**
 * `enhanceLinks` — DOM-walks a rendered markdown block and turns bare
 * URLs in its text into real `<a>` anchors so they can be clicked.
 *
 * pulldown-cmark already renders markdown link syntax (`[text](url)`)
 * as `<a href>`, but a URL typed as plain prose — the common case in
 * tool output and error messages, e.g. an `API Error … check
 * https://status.claude.com.` line — stays inert text. This pass scans
 * the block's text nodes and wraps any URL it finds, matching the
 * behaviour a user expects from chat/terminal surfaces.
 *
 * Detection is delegated to `linkify-element` (linkifyjs, MIT) rather
 * than a hand-rolled regex: it handles the fiddly edges (trailing
 * punctuation, parenthesised URLs, `www.`-prefixed hosts) well enough
 * for transcript content without us owning that surface.
 *
 * The anchors this produces deliberately carry **no `target`** and no
 * `rel` — they navigate the main frame as an ordinary link click. The
 * macOS host's `WKNavigationDelegate` (`MainWindow.swift`) intercepts
 * `.linkActivated` for any non-internal URL and hands it to
 * `NSWorkspace` to open in the system browser, so the app's own webview
 * never navigates away. Outside the host (browser dev / tests) the same
 * anchors behave as normal links.
 *
 * Why this lives outside `parseMarkdownToSanitizedBlocks` (and beside
 * the other `enhance-*` passes): it must run against live DOM after
 * `innerHTML` is assigned, and both the static and streaming render
 * paths call it from the same place (`buildBlockElement` /
 * `updateBlockElement` in `render-incremental.ts`), so every rendered
 * block is linkified identically.
 *
 * Scope guards:
 *  - `<a>` subtrees are skipped by linkify itself (no double-wrapping a
 *    markdown-authored link).
 *  - `CODE` / `PRE` subtrees are skipped via `ignoreTags` — a URL inside
 *    inline code or a fenced block is content, not a link to follow.
 *
 * Idempotent in practice: callers assign fresh `innerHTML` immediately
 * before invoking this, so each call linkifies once over new content;
 * there is no half-linkified state to re-walk.
 *
 * No listener cleanup is needed — the anchors are plain `<a href>` with
 * no attached listeners; when the parent block's `innerHTML` is
 * rewritten they are detached and garbage-collected with it.
 *
 * Laws: [L06] appearance via DOM, not React state. [L21] license —
 * linkifyjs / linkify-element are MIT, vendored via the lockfile.
 *
 * @module lib/markdown/enhance-links
 */

import linkifyElement from "linkify-element";
import type { Opts } from "linkifyjs";

/**
 * Tag names (uppercase — `linkify-element` compares against
 * `Element.tagName`) whose subtrees are left untouched. `A` is already
 * skipped internally by linkify; listing `CODE`/`PRE` keeps URLs inside
 * code spans and fenced blocks as literal text.
 */
const IGNORE_TAGS = ["A", "CODE", "PRE"];

const LINKIFY_OPTS: Opts = {
  // A `www.foo.com` host with no scheme links as https, not http.
  defaultProtocol: "https",
  // `target`/`rel` are left at linkify's defaults (both null), so the
  // anchor carries no `target` and activates in the main frame, where
  // the host's navigation delegate routes it to the system browser. A
  // `target="_blank"` would instead go through `createWebViewWith`,
  // which is only a safety net.
  className: "tugx-md-autolink",
  ignoreTags: IGNORE_TAGS,
};

/**
 * Wrap bare URLs in `container`'s text in clickable `<a>` anchors.
 * Markdown-authored links and code spans are left as-is. No-op when the
 * container holds no linkifiable text.
 */
export function enhanceLinks(container: HTMLElement): void {
  linkifyElement(container, LINKIFY_OPTS);
}
