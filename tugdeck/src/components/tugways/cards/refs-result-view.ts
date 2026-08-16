/**
 * Pure view-derivation for a refs run ([P08], Spec S05) — the data a
 * `/match` or `/search` block hands to its body kind, plus the text its
 * Copy and Share affordances write.
 *
 * A run streams a flat, numbered `TextRef[]`. The block renders it through
 * an existing body kind rather than a bespoke list: `PathListData` for a
 * filename match, `SearchResultData` for a content search. Grouping is by
 * file in first-appearance order, so the emission-order numbering the feed
 * assigned is never disturbed ([P12]).
 *
 * Every path emitted here is ABSOLUTE ([P15]). The wire and the ledger keep
 * paths relative to the run's `root`; a relative path renders perfectly and
 * then silently does not open, because `PathListBlock` annotates only a path
 * that starts with `/` and `FilePathPayload.path` is contractually absolute.
 *
 * Kept pure so it is unit-tested without a render (the rendered DOM is
 * covered by the app-test).
 *
 * @module components/tugways/cards/refs-result-view
 */

import type { RefsResultMessage, TextRef } from "@/lib/code-session-store/types";
import type { PathListData } from "../body-kinds/path-list-block";
import type {
  SearchResultData,
  SearchResultFile,
  SearchResultMatch,
} from "../body-kinds/search-result-block";

/**
 * Cap on the number of refs a Share carries ([P03]). Sharing routes the
 * list into a Claude turn's input, and a walk can legally return tens of
 * thousands of refs; the whole list stays in the transcript row.
 */
export const REFS_SHARE_CAP = 200;

/** Join a run's `root` onto one ref's relative path ([P15]).
 *
 *  A path that is already absolute is returned as-is, so a wire that ever
 *  sends one is not corrupted into `/root//abs`. An empty `root` (a restore
 *  that found no project dir) leaves the path alone — un-annotated is the
 *  honest outcome, a fabricated absolute path is not. */
export function joinRefPath(root: string, path: string): string {
  if (path.startsWith("/")) return path;
  if (root === "") return path;
  return `${root.replace(/\/+$/, "")}/${path}`;
}

/** A `match` run's refs as the path list body kind reads them. */
export function refsToPathListData(
  root: string,
  refs: ReadonlyArray<TextRef>,
): PathListData {
  // The number rides along with the path: it is the handle `/ref N` opens by,
  // and a row the user cannot name is a row they cannot act on ([P09]/[P12]).
  return {
    paths: refs.map((ref) => joinRefPath(root, ref.path)),
    numbers: refs.map((ref) => ref.index),
  };
}

/**
 * A `search` run's refs as the search-result body kind reads them: one
 * group per file in first-appearance order, one match per ref. The ref's
 * `columns` pass through as `spans` byte-identical — they are already the
 * 0-based half-open char offsets into `preview` that `SearchResultSpan`
 * means ([P14]), so there is nothing to convert and nothing to re-derive.
 */
export function refsToSearchResultData(
  root: string,
  refs: ReadonlyArray<TextRef>,
): SearchResultData {
  const byPath = new Map<string, SearchResultMatch[]>();
  const order: string[] = [];
  for (const ref of refs) {
    const path = joinRefPath(root, ref.path);
    let matches = byPath.get(path);
    if (matches === undefined) {
      matches = [];
      byPath.set(path, matches);
      order.push(path);
    }
    matches.push({
      line: ref.line ?? 0,
      text: ref.preview ?? "",
      spans: ref.columns,
      refNumber: ref.index,
    });
  }
  const files: SearchResultFile[] = order.map((path) => ({
    path,
    matches: byPath.get(path) ?? [],
  }));
  return { files };
}

/**
 * The absolute file paths the block renders as its own rows, in DOM order —
 * one per path row for a `match` run, one per file group for a `search` run.
 *
 * This is the projection half of `data-tugx-findable`: the body kinds mark
 * exactly these paths, and `transcript-search-index` projects exactly this
 * list, so the k-th index match in a refs row is the k-th DOM match. Match
 * LINES are not included, because whether a match row exists depends on the
 * search block's own per-file collapse set — state the index cannot see.
 */
export function refsFindablePaths(message: RefsResultMessage): string[] {
  if (message.opKind === "match") {
    return refsToPathListData(message.root, message.refs).paths.slice();
  }
  return refsToSearchResultData(message.root, message.refs).files.map(
    (file) => file.path,
  );
}

/** One ref as a line of plain text: `12  /abs/a.ts:40  const foo = 1`. */
function refLine(root: string, ref: TextRef): string {
  const path = joinRefPath(root, ref.path);
  const located = ref.line === null ? path : `${path}:${ref.line}`;
  const preview = ref.preview === null ? "" : `  ${ref.preview.trim()}`;
  return `${ref.index}  ${located}${preview}`;
}

/** The whole run as plain text — the block header's Copy payload. */
export function composeRefsCopyText(message: RefsResultMessage): string {
  return message.refs.map((ref) => refLine(message.root, ref)).join("\n");
}

/**
 * Compose the text a shared refs block carries into Claude's context
 * ([P03]) — the command that produced it, then its numbered refs, fenced.
 * Share is the only bridge out of non-context ink, so the block states what
 * it is: the paths are absolute, which is the form Claude can act on.
 *
 * A run past `cap` refs shares its first `cap` and says so, rather than
 * pushing a five-figure list into a turn's input.
 */
export function composeRefsShareText(
  message: RefsResultMessage,
  cap: number = REFS_SHARE_CAP,
): string {
  const shown = message.refs.slice(0, cap);
  const lines = [message.command, ...shown.map((ref) => refLine(message.root, ref))];
  if (message.refs.length > shown.length) {
    lines.push(`…${shown.length} of ${message.refs.length} refs shown`);
  }
  const body = lines.join("\n");
  // A fence must be longer than any backtick run inside the block — a
  // matched line can legally contain one.
  const longestRun =
    body.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${body}\n${fence}\n`;
}

/** The Share chip's label — `refs #r3`, the `#s{n}` analog for a refs run. */
export function refsShareLabel(refsNumber: number): string {
  return `refs #r${refsNumber}`;
}
