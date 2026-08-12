/**
 * gazette-body-segments.ts — where a post's prose mentions its own refs.
 *
 * A Gazette post carries validated refs — paths, shas, sessions the model
 * quoted verbatim from what it was shown. When the body mentions one of
 * those targets, that mention should be the clickable atom, not a duplicate
 * chip below: {@link segmentGazetteBody} splits the body into plain runs and
 * ref-bearing runs, and the card renders the ref-bearing ones as inline
 * atoms driving the same gesture the trailing chips drive.
 *
 * Matching is looser than the ref's exact spelling, because prose and
 * provenance naturally spell one thing two ways: the ref quotes the path as
 * the activity spelled it (`tugrust/scripts/xcodebuild-quiet.sh`) while the
 * sentence says `xcodebuild-quiet.sh`. So a file-shaped ref claims its full
 * target *or its basename*, and a commit ref claims any hex run of 7+
 * characters that is a prefix of its sha (or that extends it — either side
 * may have spelled more). Every match is boundary-checked so a basename
 * never claims the tail of some longer, different path, and a sha fragment
 * never matches inside an unrelated hex run. A session ref still matches
 * only verbatim: session ids have no shorter spelling that means the same
 * thing.
 *
 * Longer candidates are placed first so a target that contains another (a
 * path and its basename both citable) claims the longer span; overlapping
 * later matches are dropped.
 *
 * @module lib/gazette-body-segments
 */

import type { GazetteRef } from "@/protocol";

/** One run of a post body: plain prose, or the mention of one ref. */
export interface GazetteBodySegment {
  text: string;
  /** The ref this run mentions, or null for plain prose. */
  ref: GazetteRef | null;
}

/** Characters that continue a path or name token — a match that touches one
 *  of these on either side is a fragment of something else, not a mention. */
const TOKEN_CHAR = /[A-Za-z0-9._~-]/;

/**
 * Whether a match at `[start, end)` stands on its own feet: the characters
 * beside it are not token characters or path separators. One reprieve on
 * the trailing side: a `.` that ends the mention is a sentence period, not
 * a longer name, when nothing token-like follows it — `…layout-imposer.ts.`
 * at the end of a sentence must still match.
 */
function boundaryOk(body: string, start: number, end: number): boolean {
  const before = start > 0 ? body[start - 1]! : "";
  if (before === "/" || TOKEN_CHAR.test(before)) return false;
  const after = end < body.length ? body[end]! : "";
  if (after === "/") return false;
  if (after === ".") {
    const next = end + 1 < body.length ? body[end + 1]! : "";
    return next === "" || !TOKEN_CHAR.test(next);
  }
  return !TOKEN_CHAR.test(after);
}

/** The last path segment of a target, or null when it adds nothing. */
function basenameOf(target: string): string | null {
  const base = target.split("/").pop() ?? "";
  if (base === "" || base === target) return null;
  return base;
}

/** A run of hex long enough to be a spelled commit sha. */
const HEX_RUN = /[0-9a-f]{7,40}/g;

interface Match {
  start: number;
  end: number;
  ref: GazetteRef;
}

/** Collect this ref's mentions of `text` into `matches`, skipping overlaps. */
function collectOccurrences(
  body: string,
  text: string,
  ref: GazetteRef,
  matches: Match[],
): void {
  let from = 0;
  for (;;) {
    const start = body.indexOf(text, from);
    if (start === -1) break;
    const end = start + text.length;
    if (
      boundaryOk(body, start, end) &&
      !matches.some((m) => start < m.end && m.start < end)
    ) {
      matches.push({ start, end, ref });
    }
    from = end;
  }
}

/** Every hex run in the body that spells (a prefix of) this commit's sha. */
function collectCommitMentions(
  body: string,
  ref: GazetteRef,
  matches: Match[],
): void {
  HEX_RUN.lastIndex = 0;
  for (const hit of body.matchAll(HEX_RUN)) {
    const run = hit[0];
    const start = hit.index;
    const end = start + run.length;
    if (!ref.target.startsWith(run) && !run.startsWith(ref.target)) continue;
    if (!boundaryOk(body, start, end)) continue;
    if (matches.some((m) => start < m.end && m.start < end)) continue;
    matches.push({ start, end, ref });
  }
}

/**
 * Split `body` into prose and ref-mention runs. Every mention of every ref
 * becomes a ref run; the rest passes through untouched. Refs with empty
 * targets never match. Pure.
 */
export function segmentGazetteBody(
  body: string,
  refs: readonly GazetteRef[],
): GazetteBodySegment[] {
  const matches: Match[] = [];
  const live = refs.filter((r) => r.target.length > 0);
  // Full targets first, longest first, so a path containing another path's
  // basename claims the longer span; then basenames; commits last (a sha
  // fragment can never collide with a path match anyway).
  const fullTargets = live
    .filter((r) => r.kind !== "commit")
    .sort((a, b) => b.target.length - a.target.length);
  for (const ref of fullTargets) {
    collectOccurrences(body, ref.target, ref, matches);
  }
  for (const ref of fullTargets) {
    if (ref.kind === "session") continue;
    const base = basenameOf(ref.target);
    if (base !== null) collectOccurrences(body, base, ref, matches);
  }
  for (const ref of live) {
    if (ref.kind === "commit") collectCommitMentions(body, ref, matches);
  }
  matches.sort((a, b) => a.start - b.start);
  const out: GazetteBodySegment[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) out.push({ text: body.slice(pos, m.start), ref: null });
    out.push({ text: body.slice(m.start, m.end), ref: m.ref });
    pos = m.end;
  }
  if (pos < body.length) out.push({ text: body.slice(pos), ref: null });
  return out;
}

/** The set of ref targets {@link segmentGazetteBody} placed inline. */
export function inlineRefTargets(
  segments: readonly GazetteBodySegment[],
): Set<string> {
  const targets = new Set<string>();
  for (const seg of segments) {
    if (seg.ref !== null) targets.add(seg.ref.target);
  }
  return targets;
}
