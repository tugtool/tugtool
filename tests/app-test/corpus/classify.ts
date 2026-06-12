/**
 * classify.ts — pure-logic session-JSONL statistics and classification
 * for the real-session corpus harvester.
 *
 * The accumulator is streaming-friendly: the harvester feeds it one
 * line at a time so a multi-hundred-MB session never has to exist in
 * memory as a single string. All semantics mirror the production
 * scanners where they overlap:
 *
 * - A "turn" is a user record whose `message.content` is a string or
 *   an array containing at least one non-`tool_result` block — the
 *   same predicate tugcast's external-session scanner uses for the
 *   picker's turn count (`is_user_submission_content`).
 * - Malformed lines are skipped silently (torn final lines from a
 *   live append included), matching the translator's tolerance.
 */

export type SizeClass = "typical" | "heavy" | "whale";

export type ShapeTag =
  | "tool-heavy"
  | "thinking-heavy"
  | "image-bearing"
  | "prose";

/** Class boundaries by raw JSONL size. */
export const TYPICAL_MAX_BYTES = 1_000_000;
export const WHALE_MIN_BYTES = 20_000_000;

/** Shape-tag thresholds over the content-block histogram. */
export const TOOL_HEAVY_MIN_FRACTION = 0.25;
export const TOOL_HEAVY_MIN_COUNT = 10;
export const THINKING_HEAVY_MIN_FRACTION = 0.15;
export const THINKING_HEAVY_MIN_COUNT = 10;

export interface BlockHistogram {
  text: number;
  thinking: number;
  tool_use: number;
  tool_result: number;
  image: number;
  other: number;
}

export interface SessionStats {
  lines: number;
  /** Lines that parsed as JSON objects (rest skipped, torn lines included). */
  parsedLines: number;
  /** Committed user submissions (picker-compatible turn count). */
  turns: number;
  blocks: BlockHistogram;
  totalBlocks: number;
  /**
   * Rough count of deck wire messages a replay produces: one per
   * submission, one per text/thinking/image block, two per tool
   * lifecycle block (start + completion).
   */
  wireMessageEstimate: number;
  /** Serialized size of the single largest content block seen. */
  largestBlockBytes: number;
  /** First record timestamp, unix millis (0 when absent). */
  createdAtMs: number;
}

export interface StatsAccumulator {
  stats: SessionStats;
}

export function createStatsAccumulator(): StatsAccumulator {
  return {
    stats: {
      lines: 0,
      parsedLines: 0,
      turns: 0,
      blocks: {
        text: 0,
        thinking: 0,
        tool_use: 0,
        tool_result: 0,
        image: 0,
        other: 0,
      },
      totalBlocks: 0,
      wireMessageEstimate: 0,
      largestBlockBytes: 0,
      createdAtMs: 0,
    },
  };
}

function blockBytes(block: Record<string, unknown>): number {
  const type = block["type"];
  try {
    if (type === "text" && typeof block["text"] === "string") {
      return (block["text"] as string).length;
    }
    if (type === "thinking" && typeof block["thinking"] === "string") {
      return (block["thinking"] as string).length;
    }
    if (type === "tool_use") {
      return JSON.stringify(block["input"] ?? null).length;
    }
    if (type === "tool_result") {
      return JSON.stringify(block["content"] ?? null).length;
    }
    return JSON.stringify(block).length;
  } catch {
    return 0;
  }
}

function countBlock(stats: SessionStats, block: unknown): void {
  if (block === null || typeof block !== "object") return;
  const rec = block as Record<string, unknown>;
  const type = rec["type"];
  stats.totalBlocks += 1;
  switch (type) {
    case "text":
      stats.blocks.text += 1;
      stats.wireMessageEstimate += 1;
      break;
    case "thinking":
      stats.blocks.thinking += 1;
      stats.wireMessageEstimate += 1;
      break;
    case "tool_use":
      stats.blocks.tool_use += 1;
      stats.wireMessageEstimate += 2;
      break;
    case "tool_result":
      stats.blocks.tool_result += 1;
      stats.wireMessageEstimate += 2;
      break;
    case "image":
      stats.blocks.image += 1;
      stats.wireMessageEstimate += 1;
      break;
    default:
      stats.blocks.other += 1;
      stats.wireMessageEstimate += 1;
      break;
  }
  const bytes = blockBytes(rec);
  if (bytes > stats.largestBlockBytes) stats.largestBlockBytes = bytes;
}

/** Mirror of the scanner's user-submission predicate. */
function isUserSubmissionContent(content: unknown): boolean {
  if (typeof content === "string") return true;
  if (Array.isArray(content)) {
    return content.some(
      (block) =>
        block !== null &&
        typeof block === "object" &&
        (block as Record<string, unknown>)["type"] !== "tool_result",
    );
  }
  return false;
}

/** Feed one raw JSONL line. Malformed lines count toward `lines` only. */
export function accumulateLine(acc: StatsAccumulator, line: string): void {
  const stats = acc.stats;
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  stats.lines += 1;
  let record: unknown;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (record === null || typeof record !== "object") return;
  stats.parsedLines += 1;
  const rec = record as Record<string, unknown>;

  if (stats.createdAtMs === 0 && typeof rec["timestamp"] === "string") {
    const ms = Date.parse(rec["timestamp"] as string);
    if (Number.isFinite(ms)) stats.createdAtMs = ms;
  }

  const kind = rec["type"];
  if (kind !== "user" && kind !== "assistant") return;
  const message = rec["message"];
  if (message === null || typeof message !== "object") return;
  const content = (message as Record<string, unknown>)["content"];

  if (kind === "user") {
    if (isUserSubmissionContent(content)) {
      stats.turns += 1;
      stats.wireMessageEstimate += 1;
    }
    if (typeof content === "string") {
      stats.totalBlocks += 1;
      stats.blocks.text += 1;
      if (content.length > stats.largestBlockBytes) {
        stats.largestBlockBytes = content.length;
      }
      return;
    }
  }

  if (Array.isArray(content)) {
    for (const block of content) countBlock(stats, block);
  }
}

export function classifySize(bytes: number): SizeClass {
  if (bytes >= WHALE_MIN_BYTES) return "whale";
  if (bytes >= TYPICAL_MAX_BYTES) return "heavy";
  return "typical";
}

/**
 * Shape tags from the histogram. Multiple tags may apply; `prose` is
 * the fallback when the session is neither tool- nor thinking-heavy.
 */
export function shapeTags(stats: SessionStats): ShapeTag[] {
  const tags: ShapeTag[] = [];
  const total = stats.totalBlocks;
  const toolish = stats.blocks.tool_use;
  if (
    total > 0 &&
    toolish >= TOOL_HEAVY_MIN_COUNT &&
    toolish / total >= TOOL_HEAVY_MIN_FRACTION
  ) {
    tags.push("tool-heavy");
  }
  if (
    total > 0 &&
    stats.blocks.thinking >= THINKING_HEAVY_MIN_COUNT &&
    stats.blocks.thinking / total >= THINKING_HEAVY_MIN_FRACTION
  ) {
    tags.push("thinking-heavy");
  }
  if (stats.blocks.image >= 1) tags.push("image-bearing");
  if (!tags.includes("tool-heavy") && !tags.includes("thinking-heavy")) {
    tags.push("prose");
  }
  return tags;
}

/** The single shape used for class × shape selection cells. */
export function primaryShape(tags: ShapeTag[]): ShapeTag {
  if (tags.includes("tool-heavy")) return "tool-heavy";
  if (tags.includes("thinking-heavy")) return "thinking-heavy";
  if (tags.includes("image-bearing")) return "image-bearing";
  return "prose";
}

/** Nearest-rank percentile over an unsorted sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
