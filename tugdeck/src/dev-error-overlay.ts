/**
 * tugdeck/src/dev-error-overlay.ts
 *
 * A compact, viewport-fitting replacement for Vite's built-in
 * `vite-error-overlay`.
 *
 * # Why this exists
 *
 * Vite's default HMR error overlay renders the full error — message,
 * code frame, AND the entire babel/rollup stack trace — into one
 * shadow-DOM window that grows with the stack. A `plugin:vite:react-babel`
 * parse error produces a forty-frame stack of `node_modules/@babel/...`
 * paths; the window runs past the bottom of a laptop display with no
 * internal scroll, so the part that actually matters (the message and
 * the code frame at the *top*) is pushed off-screen and the overlay
 * becomes unusable.
 *
 * We disable the built-in overlay (`server.hmr.overlay = false` in
 * `vite.config.ts`) and render our own from the same `vite:error`
 * payload. The layout is bounded to the viewport: the plugin tag, the
 * message, and a dismiss control are pinned at the top and always
 * visible; the file location, code frame, and stack trace live in a
 * single internal scroll region. The window can never exceed `90vh`,
 * so the error message fits on any display.
 *
 * File paths in the location header, code frame, and stack are
 * linkified to Vite's `/__open-in-editor` endpoint (the same
 * click-to-open behavior the built-in overlay provides), so a path
 * like `…/use-text-surface-context-menu.tsx:150:23` opens the editor
 * at that line.
 *
 * # Why a shadow root, not React
 *
 * The overlay is appearance that must survive — and sit above — any
 * React tree state, including a tree that failed to compile. Per [L06]
 * (appearance changes go through CSS and DOM, never React state) and
 * [L01] (one `root.render()`, at mount, ever) it is built as detached
 * DOM and appended to `document.body`. A private shadow root isolates
 * its styles from the app and from theme tokens, so a broken stylesheet
 * can't distort the error report.
 *
 * # Production safety
 *
 * `import.meta.hot` is `undefined` in production builds — Vite strips
 * it during the production bundle pass — so `installDevErrorOverlay`
 * early-returns and the module tree-shakes to nothing in shipped
 * bundles. The `vite:error` event only ever fires from the dev server.
 *
 * # Self-HMR safety
 *
 * If this module is itself hot-replaced, re-evaluating the body would
 * stack a second set of `vite:error` listeners on top of the old ones.
 * Mirroring `hmr-bridge.ts`, we ask Vite for a full reload via
 * `import.meta.hot.invalidate()` from inside `accept` — one
 * registration, ever.
 *
 * # Laws
 *
 * [L01] (no second React root — detached DOM appended to body);
 * [L03] (`import.meta.hot.on` registration runs at module init);
 * [L06] (appearance via DOM, not React state);
 * [L19] (file conventions: module docstring, single named export);
 * [L21] (`import.meta.hot.*` is Vite's own runtime API).
 */

/**
 * Shape of Vite's `vite:error` payload, narrowed to the fields we
 * render. Vite types this as `ErrorPayload`; we restate the subset to
 * avoid importing from Vite's client types into app code.
 */
interface ViteErrorLike {
  message?: string;
  stack?: string;
  id?: string;
  frame?: string;
  plugin?: string;
  loc?: { file?: string; line?: number; column?: number };
}

/**
 * Matches an absolute path followed by `:line:col` (POSIX or Windows
 * drive form). Used to linkify file references in the message, frame,
 * and stack. Mirrors the pattern Vite's own overlay uses.
 */
const FILE_LOCATION_RE = /(?:[a-zA-Z]:\\|\/)[^\s)]*?:\d+:\d+/g;

const STYLE = `
  :host { all: initial; }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.6);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .window {
    display: flex;
    flex-direction: column;
    width: min(960px, 100%);
    max-height: 90vh;
    box-sizing: border-box;
    background: #1b1b1f;
    color: #d4d4d8;
    border-radius: 8px;
    border-top: 6px solid #ff5555;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }
  .topbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid #2c2c34;
  }
  .plugin {
    color: #ff8888;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spacer { flex: 1 1 auto; }
  .hint { color: #6b6b76; white-space: nowrap; }
  .close {
    flex: 0 0 auto;
    appearance: none;
    border: 1px solid #3a3a44;
    background: #26262e;
    color: #d4d4d8;
    border-radius: 6px;
    padding: 3px 9px;
    font: inherit;
    cursor: pointer;
  }
  .close:hover { background: #32323c; }
  .message {
    flex: 0 0 auto;
    max-height: 28vh;
    overflow: auto;
    padding: 14px 16px;
    margin: 0;
    color: #ff7b7b;
    white-space: pre-wrap;
    word-break: break-word;
    border-bottom: 1px solid #2c2c34;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 14px 16px 18px;
  }
  .section-label {
    color: #6b6b76;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.06em;
    margin: 0 0 6px;
  }
  .file {
    margin: 0 0 14px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .frame {
    margin: 0 0 16px;
    padding: 10px 12px;
    background: #141417;
    border-radius: 6px;
    overflow-x: auto;
    white-space: pre;
    color: #c9c9d1;
  }
  details { margin: 0; }
  summary {
    cursor: pointer;
    color: #9a9aa6;
    user-select: none;
    margin-bottom: 8px;
  }
  summary:hover { color: #d4d4d8; }
  .stack {
    margin: 0;
    padding: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: #8a8a96;
  }
  a.loc {
    color: #79b8ff;
    text-decoration: none;
    cursor: pointer;
  }
  a.loc:hover { text-decoration: underline; }
`;

/**
 * Append text to `parent`, turning any `path:line:col` token into a
 * link that opens Vite's editor at that location. Keeps the rest as a
 * plain text node so nothing in the (untrusted) error string is ever
 * parsed as HTML.
 */
function appendLinkified(parent: Node, text: string): void {
  let lastIndex = 0;
  text.replace(FILE_LOCATION_RE, (match, offset: number) => {
    if (offset > lastIndex) {
      parent.appendChild(
        document.createTextNode(text.slice(lastIndex, offset)),
      );
    }
    const a = document.createElement("a");
    a.className = "loc";
    a.textContent = match;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      // `/__open-in-editor` is served by Vite's dev middleware; it
      // accepts the `path:line:col` form directly.
      fetch(`/__open-in-editor?file=${encodeURIComponent(match)}`).catch(
        () => {},
      );
    });
    parent.appendChild(a);
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

/**
 * Install the dev-only HMR error overlay. No-op in production
 * (`import.meta.hot` is undefined). Call once at app startup.
 */
export function installDevErrorOverlay(): void {
  const hot = import.meta.hot;
  if (!hot) return;

  let host: HTMLDivElement | null = null;

  function clear(): void {
    if (!host) return;
    host.remove();
    host = null;
    document.removeEventListener("keydown", onKeydown, true);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      clear();
    }
  }

  function show(err: ViteErrorLike): void {
    // Replace any prior overlay so a second error doesn't stack.
    clear();

    host = document.createElement("div");
    host.id = "tug-dev-error-overlay-host";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    // Click outside the window dismisses; clicks inside don't bubble out.
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) clear();
    });

    const win = document.createElement("div");
    win.className = "window";

    // Top bar: plugin tag + dismiss control (always visible).
    const topbar = document.createElement("div");
    topbar.className = "topbar";
    const plugin = document.createElement("span");
    plugin.className = "plugin";
    plugin.textContent = err.plugin ? `[plugin:${err.plugin}]` : "Build error";
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "esc to dismiss";
    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => clear());
    topbar.append(plugin, spacer, hint, close);

    // Message: pinned, capped height, scrolls if huge.
    const message = document.createElement("pre");
    message.className = "message";
    appendLinkified(message, err.message ?? "Unknown error");

    // Body: the one internal scroll region (file + frame + stack).
    const body = document.createElement("div");
    body.className = "body";

    const locText =
      err.loc?.file !== undefined
        ? `${err.loc.file}:${err.loc.line ?? 0}:${err.loc.column ?? 0}`
        : err.id;
    if (locText) {
      const fileLabel = document.createElement("p");
      fileLabel.className = "section-label";
      fileLabel.textContent = "Location";
      const file = document.createElement("pre");
      file.className = "file";
      appendLinkified(file, locText);
      body.append(fileLabel, file);
    }

    if (err.frame) {
      const frame = document.createElement("pre");
      frame.className = "frame";
      appendLinkified(frame, err.frame);
      body.appendChild(frame);
    }

    if (err.stack) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Stack trace";
      const stack = document.createElement("pre");
      stack.className = "stack";
      appendLinkified(stack, err.stack);
      details.append(summary, stack);
      body.appendChild(details);
    }

    win.append(topbar, message, body);
    backdrop.appendChild(win);
    shadow.appendChild(backdrop);
    document.body.appendChild(host);

    document.addEventListener("keydown", onKeydown, true);
  }

  hot.on("vite:error", (payload: { err: ViteErrorLike }) => {
    show(payload.err);
  });

  // Any successful update or full reload means the error cleared.
  hot.on("vite:beforeUpdate", clear);
  hot.on("vite:afterUpdate", clear);
  hot.on("vite:beforeFullReload", clear);

  // Self-HMR: full reload rather than stacking duplicate listeners.
  hot.accept(() => {
    hot.invalidate();
  });
}
