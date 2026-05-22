/**
 * `enhance-mermaid.ts` — post-`innerHTML` diagram renderer for
 * markdown blocks. Sibling of {@link enhanceFencedCode} and
 * {@link enhanceMath}; called from {@link renderIncremental}
 * immediately after a block element's content has been written.
 *
 * **One pass per block.**
 *
 *  1. Find every placeholder the `mermaidTransformer` emitted into
 *     the block's html — selector
 *     `.tugx-mermaid[data-tugx-mermaid-pending="true"]`.
 *  2. Read the raw diagram source out of `el.textContent`, lazy-load
 *     Mermaid on first encounter, and render the SVG asynchronously.
 *  3. Replace the placeholder's `innerHTML` with the resulting SVG.
 *     On success, swap the pending flag for `data-tugx-mermaid-rendered`.
 *     On failure (parse error, render abort), restore the raw source
 *     to `textContent` and stamp `data-tugx-mermaid-error` so the CSS
 *     can paint the shared caution band.
 *
 * **Failure mode** (per [R04]). Any Mermaid render error is contained
 * to the offending placeholder; the parent markdown block continues
 * rendering. A toast surface is left to the caller via the optional
 * `onError` callback so the markdown primitive doesn't have to know
 * about toast plumbing.
 *
 * **Idempotency.** Each placeholder carries
 * `data-tugx-mermaid-pending="true"` until rendered; after a
 * successful render the attribute is removed and
 * `data-tugx-mermaid-rendered="true"` is set, so a re-enhance pass
 * on the same DOM is a no-op for already-rendered placeholders.
 * Streaming updates rewrite the parent's `innerHTML`, which removes
 * every placeholder; the next enhance pass starts fresh.
 *
 * **Theme awareness.** The walker reads `--tugx-host-canvas-color`
 * via `getComputedStyle` to detect dark vs. light, then picks
 * Mermaid's `theme: 'dark'` or `theme: 'default'`. Switching themes
 * is a future markdown re-render away — the next enhance pass over a
 * fresh innerHTML write picks up the new colour scheme. Individual
 * `themeVariables` overrides are intentionally not threaded through;
 * Mermaid's built-in themes already produce coherent diagrams on
 * both surfaces, and per-token overrides risk colour collisions we'd
 * have to vet diagram-by-diagram.
 *
 * @module lib/markdown/enhance-mermaid
 */

import {
  getMermaidSync,
  loadMermaid,
  type MermaidEngine,
  type MermaidRenderConfig,
} from "@/lib/lazy/load-mermaid";

/** Selector for pending Mermaid placeholders. */
const PENDING_SELECTOR = '.tugx-mermaid[data-tugx-mermaid-pending="true"]';

/**
 * Process-local id counter for the Mermaid render call. Mermaid
 * builds the SVG with `id` baked into its element ids; a duplicate
 * across two diagrams on the same page would yield invalid markup,
 * so we burn one per render. The counter resets across page loads
 * because it lives in module scope, which is the lifetime we want.
 */
let nextMermaidId = 0;
function mintMermaidId(): string {
  nextMermaidId += 1;
  return `tugx-mermaid-${nextMermaidId}`;
}

// ---------------------------------------------------------------------------
// Theme detection — small, deliberately conservative.
// ---------------------------------------------------------------------------

/**
 * Read the relative luminance of a CSS colour string. Returns a
 * value in `[0, 1]` for `#RRGGBB`, `#RGB`, and `rgb(...)` inputs;
 * unrecognised shapes resolve to `0.5` (treated as neither clearly
 * dark nor clearly light by callers). Exported for unit tests.
 */
export function readColorLuminance(raw: string): number {
  const v = raw.trim().toLowerCase();
  let r = 0;
  let g = 0;
  let b = 0;
  const hex6 = v.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    r = parseInt(hex6[1].slice(0, 2), 16);
    g = parseInt(hex6[1].slice(2, 4), 16);
    b = parseInt(hex6[1].slice(4, 6), 16);
  } else {
    const hex3 = v.match(/^#([0-9a-f]{3})$/i);
    if (hex3) {
      r = parseInt(hex3[1][0] + hex3[1][0], 16);
      g = parseInt(hex3[1][1] + hex3[1][1], 16);
      b = parseInt(hex3[1][2] + hex3[1][2], 16);
    } else {
      const rgb = v.match(/^rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)$/);
      if (!rgb) return 0.5;
      r = Number(rgb[1]);
      g = Number(rgb[2]);
      b = Number(rgb[3]);
    }
  }
  // Rec. 709 luma — good enough for dark/light bucketing; full WCAG
  // contrast would mean linearising the sRGB channels, which is
  // overkill for a binary theme pick.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Pick a Mermaid theme name from the current document's host-canvas
 * colour. Returns `"dark"` when the canvas reads as a dark surface,
 * `"default"` otherwise. Outside the browser (tests, SSR) the
 * function defaults to `"default"` so callers don't have to guard
 * the environment check themselves. Exported for unit tests.
 */
export function pickMermaidTheme(): "dark" | "default" {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "default";
  }
  const canvas = getComputedStyle(document.body)
    .getPropertyValue("--tugx-host-canvas-color")
    .trim();
  if (canvas === "") return "default";
  return readColorLuminance(canvas) < 0.5 ? "dark" : "default";
}

// ---------------------------------------------------------------------------
// Render plumbing
// ---------------------------------------------------------------------------

/**
 * Render one placeholder element via the supplied engine. The
 * placeholder's existing `textContent` is the diagram source. On
 * success the placeholder's `innerHTML` is replaced with the
 * resulting SVG; on failure the raw source is restored and the
 * caution flag set.
 */
async function renderPlaceholder(
  el: HTMLElement,
  engine: MermaidEngine,
  config: MermaidRenderConfig,
  onError?: (message: string, source: string) => void,
): Promise<void> {
  const source = el.textContent ?? "";
  try {
    const { svg } = await engine.render(mintMermaidId(), source, config);
    // The element may have been detached or replaced by a streaming
    // update between scheduling and resolution; only paint when the
    // pending flag is still ours.
    if (el.dataset.tugxMermaidPending !== "true") return;
    el.innerHTML = svg;
    delete el.dataset.tugxMermaidPending;
    el.dataset.tugxMermaidRendered = "true";
  } catch (err) {
    if (el.dataset.tugxMermaidPending !== "true") return;
    el.textContent = source;
    delete el.dataset.tugxMermaidPending;
    el.dataset.tugxMermaidError = "true";
    if (onError !== undefined) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message, source);
    }
  }
}

/**
 * Optional knobs for {@link enhanceMermaid}. Kept tiny on purpose —
 * heavier configuration belongs on the caller surface, not here.
 */
export interface EnhanceMermaidOptions {
  /** Invoked once per failing placeholder, after fallback content
   *  has been restored. */
  onError?: (message: string, source: string) => void;
  /** Override theme picking — useful for tests or for hosts that
   *  want a fixed Mermaid theme regardless of the document canvas. */
  themeName?: MermaidRenderConfig["themeName"];
}

/**
 * Walk `container` for pending Mermaid placeholders and render every
 * one through the lazy-loaded engine. Returns the {@link Promise}
 * the lazy load resolves to so callers that need to await first
 * paint can. Callers that don't care can fire-and-forget.
 */
export function enhanceMermaid(
  container: HTMLElement,
  options?: EnhanceMermaidOptions,
): Promise<void> {
  const pending = Array.from(
    container.querySelectorAll<HTMLElement>(PENDING_SELECTOR),
  );
  if (pending.length === 0) return Promise.resolve();

  const config: MermaidRenderConfig = {
    themeName: options?.themeName ?? pickMermaidTheme(),
  };

  const sync = getMermaidSync();
  if (sync !== null) {
    return Promise.all(
      pending.map((el) => renderPlaceholder(el, sync, config, options?.onError)),
    ).then(() => undefined);
  }

  return loadMermaid().then(
    async (engine) => {
      // Re-query after the load resolves: the DOM may have been
      // mutated between scheduling and resolution (a streaming
      // delta wiping our earlier placeholders). The original
      // snapshot is still safe to walk — rendering into a detached
      // node is harmless — but re-querying picks up new
      // placeholders the original snapshot missed.
      const live = Array.from(
        container.querySelectorAll<HTMLElement>(PENDING_SELECTOR),
      );
      await Promise.all(
        live.map((el) => renderPlaceholder(el, engine, config, options?.onError)),
      );
    },
    () => {
      // Load failed — leave the pending placeholders alone so the
      // raw diagram source remains visible as the fallback.
    },
  );
}

/**
 * Render exactly one element through the lazy engine. Used by the
 * `MermaidBlock` React body kind so it doesn't duplicate the
 * load + render plumbing of {@link enhanceMermaid}. Returns a
 * promise that resolves once the element has been rendered (or had
 * its error path taken).
 */
export function renderMermaidInto(
  el: HTMLElement,
  source: string,
  options?: EnhanceMermaidOptions,
): Promise<void> {
  // Stamp the source + metadata that `renderPlaceholder` reads.
  // Idempotent — repeat calls overwrite.
  el.classList.add("tugx-mermaid");
  el.dataset.tugxMermaidPending = "true";
  delete el.dataset.tugxMermaidRendered;
  delete el.dataset.tugxMermaidError;
  el.textContent = source;

  const config: MermaidRenderConfig = {
    themeName: options?.themeName ?? pickMermaidTheme(),
  };

  const sync = getMermaidSync();
  if (sync !== null) {
    return renderPlaceholder(el, sync, config, options?.onError);
  }
  return loadMermaid().then(
    (engine) => renderPlaceholder(el, engine, config, options?.onError),
    () => {
      // Loader failed — raw source is already in textContent.
    },
  );
}
