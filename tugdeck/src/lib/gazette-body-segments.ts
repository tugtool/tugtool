/**
 * gazette-body-segments.ts — where a post's prose mentions its own refs.
 *
 * A Gazette post carries validated refs — paths, shas, sessions the model
 * quoted verbatim from what it was shown. When the body spells one of those
 * targets out in its prose, that mention should be the clickable atom, not a
 * duplicate chip below: {@link segmentGazetteBody} splits the body into plain
 * runs and ref-bearing runs, and the card renders the ref-bearing ones as
 * inline atoms driving the same intent the trailing chips drive.
 *
 * Matching is exact substring: the refs were validated Rust-side to be
 * verbatim quotes, so the body either contains the same characters or it
 * doesn't — no fuzzy matching, no path normalization. Longer targets are
 * placed first so a target that contains another (a path and its basename
 * both cited) claims the longer span; overlapping later matches are dropped.
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

/**
 * Split `body` into prose and ref-mention runs. Every occurrence of every
 * ref's target becomes a ref run; the rest passes through untouched. Refs
 * with empty targets never match. Pure.
 */
export function segmentGazetteBody(
  body: string,
  refs: readonly GazetteRef[],
): GazetteBodySegment[] {
  const matches: Array<{ start: number; end: number; ref: GazetteRef }> = [];
  const candidates = refs
    .filter((r) => r.target.length > 0)
    .sort((a, b) => b.target.length - a.target.length);
  for (const ref of candidates) {
    let from = 0;
    for (;;) {
      const start = body.indexOf(ref.target, from);
      if (start === -1) break;
      const end = start + ref.target.length;
      if (!matches.some((m) => start < m.end && m.start < end)) {
        matches.push({ start, end, ref });
      }
      from = end;
    }
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

/** The set of targets {@link segmentGazetteBody} placed inline. */
export function inlineRefTargets(
  segments: readonly GazetteBodySegment[],
): Set<string> {
  const targets = new Set<string>();
  for (const seg of segments) {
    if (seg.ref !== null) targets.add(seg.ref.target);
  }
  return targets;
}
