/**
 * annotate-counters — module-level counters for the content annotator's
 * DOM-pass economy, in the same shape as `markdown/parse-counters`.
 *
 * The annotator's cost is not one pass; it is how many passes an arriving
 * verdict provokes and how much DOM each one walks. Those two numbers are
 * what make a claim about its performance falsifiable, so they are
 * counted rather than reasoned about:
 *
 *   - `passes` — calls into `annotateElement`, the whole per-container
 *     walk (stale-wrap sweep, inline-code classification, text scan).
 *   - `totalMs` — cumulative wall time inside those passes.
 *   - `textNodes` — text nodes visited across all passes; the multiplier
 *     that turns a cheap pass into an expensive one on a long transcript.
 *   - `contentPasses` — calls into `annotateContent`, the full pass for
 *     freshly written HTML, which additionally runs link detection and
 *     text-node normalization over the container.
 *
 * Plain module state, not a store: diagnostics read imperatively by perf
 * probes and tests, never rendered.
 *
 * @module lib/annotator/annotate-counters
 */

/** What the annotator has done since the last reset. */
export interface AnnotateCountersSnapshot {
  passes: number;
  contentPasses: number;
  totalMs: number;
  textNodes: number;
}

let passes = 0;
let contentPasses = 0;
let totalMs = 0;
let textNodes = 0;

/** Record one `annotateElement` pass and what it walked. */
export function recordElementPass(ms: number, nodes: number): void {
  passes += 1;
  totalMs += ms;
  textNodes += nodes;
}

/** Record one `annotateContent` pass (link detection included). */
export function recordContentPass(): void {
  contentPasses += 1;
}

/** Read the counters. */
export function annotateCounters(): AnnotateCountersSnapshot {
  return { passes, contentPasses, totalMs, textNodes };
}

/** Zero the counters, so a probe can measure one interval. */
export function resetAnnotateCounters(): void {
  passes = 0;
  contentPasses = 0;
  totalMs = 0;
  textNodes = 0;
}
