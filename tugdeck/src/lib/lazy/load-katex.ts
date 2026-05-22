/**
 * `loadKaTeX` — singleton lazy loader for the KaTeX math-typesetting
 * library and its bundled font CSS.
 *
 * Per [D08] KaTeX (not MathJax) is the math engine: smaller bundle
 * (~350 KB total), synchronous render, sufficient LaTeX coverage. Per
 * [D10] it loads on first encounter; a session that never sees `$...$`
 * or a ` ```math ` fence pays nothing for it. Per [R04] each render
 * is wrapped in an error boundary at the call site so a malformed
 * expression cannot crash the parent block.
 *
 * One-shot promise — the first caller kicks off the import, subsequent
 * callers share that promise. Once resolved, the engine is also
 * exposed via {@link getKaTeXSync} so DOM-walk consumers can render
 * synchronously after a single async wait.
 *
 * Fonts ship locally via the CSS side-effect import — `katex.min.css`
 * declares the `@font-face` rules with relative URLs into
 * `katex/dist/fonts/`, which Vite resolves to bundled asset URLs at
 * build time. No CDN.
 *
 * @module lib/lazy/load-katex
 */

/**
 * Options accepted by KaTeX's `render` / `renderToString` entry
 * points. Surfaced here as the narrow subset of `katex.KatexOptions`
 * the loader's consumers actually pass; the full library shape is
 * available via `@types/katex` for callers that need more knobs.
 */
export interface KaTeXRenderOptions {
  /** Render block-level (`true`) vs. inline (`false`). Default `false`. */
  displayMode?: boolean;
  /** Throw on malformed input (`true`) or render the error inline (`false`). Default `false` — the caller handles the inline error. */
  throwOnError?: boolean;
  /** Hex error colour for inline error rendering. */
  errorColor?: string;
  /** Trust user-supplied content (e.g. `\url{}`). Default `false`. */
  trust?: boolean;
  /** Allow `\href{}` to produce `<a>`. Default `false`. */
  strict?: boolean | "warn" | "error" | "ignore";
}

/**
 * Narrow engine surface exposed by the loader. The wrapper hides the
 * default-export shape of `katex.min.js` so consumers don't import
 * the package directly — keeping the boot bundle clean of any direct
 * KaTeX reference per [D10].
 */
export interface KaTeXEngine {
  render(source: string, el: HTMLElement, options?: KaTeXRenderOptions): void;
  renderToString(source: string, options?: KaTeXRenderOptions): string;
}

let cached: KaTeXEngine | null = null;
let inflight: Promise<KaTeXEngine> | null = null;

/**
 * Load (or return the cached) KaTeX engine. Idempotent — every caller
 * after the first shares the same singleton promise. On rejection the
 * cache resets so a future caller can retry.
 */
export function loadKaTeX(): Promise<KaTeXEngine> {
  if (cached !== null) return Promise.resolve(cached);
  if (inflight !== null) return inflight;
  inflight = (async () => {
    const [mod] = await Promise.all([
      import("katex"),
      // CSS side-effect import — Vite extracts and bundles the file
      // plus the relative font URLs it references.
      import("katex/dist/katex.min.css"),
    ]);
    const k = (mod as { default: KaTeXEngine }).default ?? (mod as unknown as KaTeXEngine);
    cached = {
      render: (source, el, options) => k.render(source, el, options),
      renderToString: (source, options) => k.renderToString(source, options),
    };
    return cached;
  })();
  inflight.catch(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Synchronous accessor for the loaded engine. Returns `null` until
 * the first {@link loadKaTeX} call resolves. Used by DOM walkers that
 * want to render in-place without re-awaiting on every encounter
 * after the initial load.
 */
export function getKaTeXSync(): KaTeXEngine | null {
  return cached;
}

/**
 * Test-only: clear the loader cache so a subsequent {@link loadKaTeX}
 * call kicks off a fresh import. Never call from production code.
 */
export function resetKaTeXForTests(): void {
  cached = null;
  inflight = null;
}

/**
 * Test-only: pre-populate the loader with a stub engine so unit
 * tests can run synchronously without a real katex import.
 */
export function injectKaTeXForTests(engine: KaTeXEngine): void {
  cached = engine;
  inflight = Promise.resolve(engine);
}
