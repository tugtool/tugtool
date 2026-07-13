/** Test helper: one `dom` segment per row from plain strings. */
import type { RowSegment } from "../../transcript-search";

export function buildSegments(rows: readonly string[]): RowSegment[][] {
  return rows.map((text) => [{ kind: "dom" as const, text }]);
}
