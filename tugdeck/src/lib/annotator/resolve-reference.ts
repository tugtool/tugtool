/**
 * Reference resolution — routing a path candidate to whoever can answer
 * it.
 *
 * Two resolvers know different things. `fs/stat` answers a path, because
 * a path says where to look; the project's file index answers a name,
 * because a name says only what to look for. Ink contains both, often in
 * the same sentence, so the annotator asks one question and this decides
 * who hears it:
 *
 *  - An **absolute** path is a complete address. `fs/stat` is the whole
 *    answer, and the index — which holds project-relative paths — has
 *    nothing to add.
 *  - A **relative** path is asked of `fs/stat` against the session cwd
 *    first, and falls back to the index when that misses. The fallback is
 *    what makes a path written relative to somewhere *else* still
 *    resolve: a tool header citing `tugdeck/src/…` is written relative to
 *    the repo root whether or not the session's cwd is the repo root.
 *  - A **bare name** goes straight to the index. There is nothing for
 *    `fs/stat` to try that would not be a guess.
 *
 * A `pending` answer is passed through rather than escalated: the first
 * resolver is still speaking, and asking the second one in parallel would
 * spend an index query to race an answer already on its way.
 *
 * @module lib/annotator/resolve-reference
 */

import type { PathReference } from "./detect-path-reference";
import type { PathResolutionStore, PathVerdict } from "./path-resolution";

const UNKNOWN: PathVerdict = { state: "unknown" };

/**
 * The one thing this needs from a file index. Narrower than the store that
 * implements it, so the routing can be exercised over a plain answer table
 * without standing up a feed.
 */
export interface NameLookup {
  lookup: (name: string) => PathVerdict;
}

/** The resolvers a context has to work with. */
export interface ReferenceResolvers {
  /** Filesystem probes, for candidates that carry a location. */
  paths: PathResolutionStore;
  /**
   * The project's file index, for candidates that carry only a name.
   * `null` when the card is bound to no project — then a bare name simply
   * never resolves, which is the honest answer rather than a guess.
   */
  names: NameLookup | null;
  /** The session's working directory; `null` until the handshake lands. */
  cwd: string | null;
}

/**
 * Build the synchronous resolver an {@link AnnotationContext} carries.
 * Returns cached verdicts and records what it could not answer, so the
 * DOM pass never waits and a later pass sees the answer.
 */
/**
 * Resolve against SEVERAL roots, taking the first that confirms.
 *
 * A surface can hold text from more than one project — a jot pasted into twice
 * is about both — and there is no way to tell from a relative path which of
 * them it was written against. So ask each, and let the filesystem decide: a
 * confirmed answer anywhere wins, because a path that names a real file under
 * some root the text actually came from is not a coincidence worth refusing.
 *
 * The fold is ordered by certainty, not by root: **confirmed** beats
 * everything; failing that a **pending** answer is reported, so the run stays
 * silent and re-marks when the verdict lands rather than settling on "missing"
 * while a probe is still out; failing that, whatever the first root said. A
 * `names` index answers bare filenames once, not per root — it searches a
 * project, not a directory.
 *
 * Roots are tried in order, so a caller that knows which is likeliest should
 * put it first. Cost is one cached lookup per root per reference; the resolvers
 * memoize, so a re-mark over already-answered ink is free.
 */
export function makeMultiRootReferenceResolver(
  resolvers: Omit<ReferenceResolvers, "cwd"> & { cwds: readonly (string | null)[] },
): (reference: PathReference) => PathVerdict {
  const { paths, names, cwds } = resolvers;
  const roots = cwds.filter((cwd): cwd is string => cwd !== null);
  // No root to try is exactly the single-resolver case with a null cwd: an
  // absolute path still stats, a relative one goes to the index.
  const perRoot = (roots.length === 0 ? [null] : roots).map((cwd) =>
    makeReferenceResolver({ paths, names, cwd }),
  );
  if (perRoot.length === 1) return perRoot[0];
  return (reference: PathReference): PathVerdict => {
    let pending: PathVerdict | null = null;
    let first: PathVerdict | null = null;
    for (const resolve of perRoot) {
      const verdict = resolve(reference);
      if (verdict.state === "confirmed") return verdict;
      if (verdict.state === "pending" && pending === null) pending = verdict;
      if (first === null) first = verdict;
    }
    return pending ?? first ?? UNKNOWN;
  };
}

export function makeReferenceResolver(
  resolvers: ReferenceResolvers,
): (reference: PathReference) => PathVerdict {
  const { paths, names, cwd } = resolvers;
  return (reference: PathReference): PathVerdict => {
    if (reference.shape === "path") {
      // An absolute path is a complete address: whatever the filesystem
      // says about it is the answer.
      if (reference.path.startsWith("/")) return paths.lookup(reference.path, cwd);
      if (cwd !== null) {
        const probed = paths.lookup(reference.path, cwd);
        // Only a definite "no file there" escalates. An answer still on
        // its way would otherwise spend an index query racing it, and the
        // index queue is single-file.
        if (probed.state !== "missing") return probed;
      }
    }
    return names === null ? UNKNOWN : names.lookup(reference.path);
  };
}
