/**
 * markdown-height-estimator.ts — HeightEstimator interface and DefaultTextEstimator.
 *
 * Pure module: no DOM imports, no React imports. Safe to import in web workers.
 *
 * Design decisions:
 * - [D05] Height estimation constants; Phase 3B will replace with theme measurement.
 * - [D06] Pluggable HeightEstimator interface — callers may supply a custom estimator;
 *   DefaultTextEstimator implements the heuristics previously inlined in
 *   tug-markdown-view.tsx's estimateBlockHeight().
 *
 * HeightEstimatorMeta carries optional block-level metadata for more accurate
 * estimates when available (heading depth, list item count, table row count).
 * When meta fields are absent, DefaultTextEstimator falls back to raw-string parsing.
 */

// ---------------------------------------------------------------------------
// Height constants [D05]
// TODO(Phase 3B): Replace hardcoded constants with CSS custom property measurement
// once theme tokens are available for precise height computation.

/** Base line height in pixels for paragraph text. */
export const LINE_HEIGHT = 24;

/** Line height in pixels for code block content. */
export const CODE_LINE_HEIGHT = 20;

/** Fixed header height for code blocks (language label + border). */
export const CODE_HEADER_HEIGHT = 36;

/** Height of a horizontal rule in pixels. */
export const HR_HEIGHT = 33;

/**
 * Heading heights by level (index 0 = unused, 1-6 = h1-h6).
 * Includes top/bottom margins.
 */
export const HEADING_HEIGHTS: readonly number[] = [0, 56, 48, 40, 36, 32, 28];

// ---------------------------------------------------------------------------
// HeightEstimatorMeta

/**
 * Optional metadata passed to HeightEstimator.estimate() for more accurate
 * height computation when structural information is available from the token.
 */
export interface HeightEstimatorMeta {
  /** Heading level (1-6) for heading tokens. */
  depth?: number;
  /** Number of list items for list tokens. */
  itemCount?: number;
  /** Number of data rows (excluding header) for table tokens. */
  rowCount?: number;
}

// ---------------------------------------------------------------------------
// HeightEstimator interface

/**
 * HeightEstimator estimates the rendered pixel height of a markdown block before
 * it has been measured by the DOM. Implementations must be pure (no DOM access,
 * no async) so they can run on the main thread and in web workers alike.
 */
export interface HeightEstimator {
  /**
   * Return the estimated height in pixels for a block.
   *
   * @param tokenType - The marked token type string (e.g. "paragraph", "code").
   * @param raw - The raw source text of the token.
   * @param meta - Optional structural metadata for more accurate estimation.
   */
  estimate(tokenType: string, raw: string, meta?: HeightEstimatorMeta): number;
}

// ---------------------------------------------------------------------------
// DefaultTextEstimator

/**
 * DefaultTextEstimator implements the heuristics from [D05]:
 * - heading: lookup by depth, fallback to h6 height
 * - code: CODE_HEADER_HEIGHT + line count * CODE_LINE_HEIGHT
 * - hr: HR_HEIGHT
 * - space: 0
 * - paragraph: ceil(raw.length / 80) * LINE_HEIGHT + 8px padding
 * - blockquote: ceil(raw.length / 70) * LINE_HEIGHT + 16px padding
 * - list: itemCount * (LINE_HEIGHT + 4) + 8px padding
 * - table: (rowCount + 1) * (LINE_HEIGHT + 8) + 16px padding (+1 for header row)
 * - default: LINE_HEIGHT * 2
 *
 * When meta fields are absent the estimator falls back to raw-string parsing:
 * - heading depth falls back to level 1 (largest) when meta.depth is undefined
 * - list itemCount falls back to counting "\n" occurrences in raw
 * - table rowCount falls back to counting "\n" occurrences in raw
 */
export class DefaultTextEstimator implements HeightEstimator {
  estimate(tokenType: string, raw: string, meta?: HeightEstimatorMeta): number {
    switch (tokenType) {
      case "heading": {
        const level =
          meta?.depth !== undefined
            ? Math.min(6, Math.max(1, meta.depth))
            : 1;
        return HEADING_HEIGHTS[level] ?? HEADING_HEIGHTS[6] ?? LINE_HEIGHT * 2;
      }

      case "code": {
        // Count newlines in raw to determine line count.
        const lines = (raw.match(/\n/g) ?? []).length + 1;
        return CODE_HEADER_HEIGHT + lines * CODE_LINE_HEIGHT;
      }

      case "hr":
        return HR_HEIGHT;

      case "space":
        return 0;

      case "paragraph": {
        const text = raw ?? "";
        const lines = Math.max(1, Math.ceil(text.length / 80));
        return lines * LINE_HEIGHT + 8;
      }

      case "blockquote": {
        const text = raw ?? "";
        const lines = Math.max(1, Math.ceil(text.length / 70));
        return lines * LINE_HEIGHT + 16;
      }

      case "list": {
        const count =
          meta?.itemCount !== undefined
            ? meta.itemCount
            : (raw.match(/\n/g) ?? []).length + 1;
        return Math.max(count, 1) * (LINE_HEIGHT + 4) + 8;
      }

      case "table": {
        const rows =
          meta?.rowCount !== undefined
            ? meta.rowCount
            : (raw.match(/\n/g) ?? []).length;
        return (rows + 1) * (LINE_HEIGHT + 8) + 16;
      }

      default:
        return LINE_HEIGHT * 2;
    }
  }
}
