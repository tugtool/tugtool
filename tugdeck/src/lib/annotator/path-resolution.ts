/**
 * Path resolution — does this path reference point at a file that exists?
 *
 * A path only becomes actionable once the answer is yes, because a link
 * that dead-ends is worse than plain text. The answer comes from the
 * filesystem, which means it is asynchronous, which means the annotator's
 * synchronous DOM pass cannot wait for it. This module is how those two
 * clocks are reconciled.
 *
 * **Why a store and not a fetch per call.** Streaming re-runs the pass on
 * every delta, and a pass over a long transcript sees the same paths over
 * and over. A probe per pass would issue the same question dozens of
 * times per second. Instead `lookup` is synchronous and answers from
 * cache: a path it has never seen is recorded as wanted and returns
 * `unknown`, a short debounce later the accumulated wants go out as one
 * deduped batch, and the verdicts land in a cache that every subsequent
 * pass reads for free. Steady state does no network work at all.
 *
 * Verdict arrival bumps a version and notifies listeners, which is what
 * drives the re-annotation pass that turns a newly-confirmed path into a
 * link over already-rendered ink.
 *
 * **Honesty under failure.** A transport error returns candidates to
 * `unknown`, never to `confirmed` and never to `missing`: an unreachable
 * server means we don't know, and the next pass may ask again. The one
 * thing this must never do is manufacture a link.
 *
 * The endpoint rejects relative paths outright, so a relative candidate is
 * joined against the session cwd first. Until the cwd arrives — it is null
 * until the session handshake lands — a relative candidate is parked
 * rather than probed, and the pass that follows the cwd's arrival asks
 * again.
 *
 * @module lib/annotator/path-resolution
 */

/** Cap on paths per request, matching the endpoint's own batch cap. */
const MAX_STAT_PATHS = 64;

/** How long wants accumulate before going out as one batch. */
const FLUSH_DELAY_MS = 16;

/** What is known about a path reference. */
export type PathVerdict =
  /** Never asked, or asked and the answer was lost. Not actionable. */
  | { state: "unknown" }
  /** A probe is in flight. Not actionable yet. */
  | { state: "pending" }
  /**
   * Something is there. Actionable, at the canonical path. `isDir` says
   * which gesture it earns — a folder is revealed, not opened in an
   * editor.
   */
  | { state: "confirmed"; canonical: string; isDir: boolean }
  /** Nothing is there. Never actionable. */
  | { state: "missing" };

const UNKNOWN: PathVerdict = { state: "unknown" };
const PENDING: PathVerdict = { state: "pending" };
const MISSING: PathVerdict = { state: "missing" };

/**
 * Join a relative path onto `cwd` and normalize away `.` and `..`
 * segments. Pure string work — the endpoint canonicalizes for real, and
 * its own guard rejects anything that escapes; this only needs to produce
 * a well-formed absolute path to ask about.
 */
export function joinPath(cwd: string, relative: string): string {
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  const segments: string[] = [];
  for (const segment of `${base}/${relative}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/**
 * The absolute path a candidate should be probed at, or `null` when it
 * cannot be resolved yet — a relative path with no cwd to resolve
 * against. Absolute candidates are normalized so two spellings of one
 * path share a cache entry.
 */
export function resolveCandidate(
  rawPath: string,
  cwd: string | null,
): string | null {
  if (rawPath.startsWith("/")) return joinPath("/", rawPath);
  if (cwd === null) return null;
  return joinPath(cwd, rawPath);
}

/** Split `paths` into batches the endpoint will accept whole. */
export function chunkPaths(
  paths: readonly string[],
  size: number = MAX_STAT_PATHS,
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < paths.length; i += size) {
    chunks.push(paths.slice(i, i + size));
  }
  return chunks;
}

/** The endpoint's answer for one batch. */
export interface ProbeResult {
  exists: Record<string, boolean>;
  canonical: Record<string, string>;
  /** Reachable paths that are directories; absent means file-like. */
  isDir: Record<string, boolean>;
}

/** Ask the filesystem about a batch of absolute paths. */
async function probePaths(paths: readonly string[]): Promise<ProbeResult | null> {
  try {
    const res = await fetch("/api/fs/stat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `any` is the loose question: a reference in ink can name a
      // directory, a symlink, a device node — all real things worth
      // pointing at. Asking only for regular files would leave true
      // references inert.
      body: JSON.stringify({ paths, kind: "any" }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      exists?: unknown;
      canonical?: unknown;
      isDir?: unknown;
    };
    if (body.exists === null || typeof body.exists !== "object") return null;
    const exists: Record<string, boolean> = {};
    for (const [path, value] of Object.entries(
      body.exists as Record<string, unknown>,
    )) {
      exists[path] = value === true;
    }
    const canonical: Record<string, string> = {};
    if (body.canonical !== null && typeof body.canonical === "object") {
      for (const [path, value] of Object.entries(
        body.canonical as Record<string, unknown>,
      )) {
        if (typeof value === "string") canonical[path] = value;
      }
    }
    const isDir: Record<string, boolean> = {};
    if (body.isDir !== null && typeof body.isDir === "object") {
      for (const [path, value] of Object.entries(
        body.isDir as Record<string, unknown>,
      )) {
        isDir[path] = value === true;
      }
    }
    return { exists, canonical, isDir };
  } catch {
    return null;
  }
}

/**
 * The app's path-verdict cache. One per app: paths churn slowly, and a
 * reload rebuilds the world anyway.
 */
export class PathResolutionStore {
  private readonly verdicts = new Map<string, PathVerdict>();
  private readonly wanted = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private flushHandle: ReturnType<typeof setTimeout> | null = null;
  private currentVersion = 0;

  /**
   * What is known about `rawPath` right now, resolving it against `cwd`
   * first. Synchronous by contract — the annotator's DOM pass calls this
   * for every path candidate it meets. A path this has never seen is
   * recorded as wanted and reported `unknown`; the probe that follows
   * bumps the version, and the re-annotation pass asks again.
   */
  lookup(rawPath: string, cwd: string | null): PathVerdict {
    const resolved = resolveCandidate(rawPath, cwd);
    // A relative candidate with no cwd yet: parked, not asked. The cwd's
    // arrival re-runs the pass, which asks again with something to
    // resolve against.
    if (resolved === null) return UNKNOWN;
    const known = this.verdicts.get(resolved);
    if (known !== undefined) return known;
    this.want(resolved);
    return UNKNOWN;
  }

  /** Subscribe to verdict arrivals. Returns the unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Bumped whenever verdicts change. The annotation inputs read this, so
   * a probe's answer re-marks the ink that was waiting on it.
   */
  version = (): number => this.currentVersion;

  /**
   * Record a probe's answer. A path the response did not mention (past
   * the endpoint's cap, or dropped) returns to `unknown` so a later pass
   * can ask again rather than being told something false.
   */
  applyProbeResult(paths: readonly string[], result: ProbeResult | null): void {
    let changed = false;
    for (const path of paths) {
      const next = verdictFor(path, result);
      const prev = this.verdicts.get(path);
      if (next === null) {
        // Unknown again: drop the entry entirely so the next lookup
        // re-wants it.
        if (prev !== undefined) {
          this.verdicts.delete(path);
          changed = true;
        }
        continue;
      }
      if (
        prev === undefined ||
        prev.state !== next.state ||
        (prev.state === "confirmed" &&
          next.state === "confirmed" &&
          prev.canonical !== next.canonical)
      ) {
        this.verdicts.set(path, next);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  /** Record that `resolved` is wanted, and schedule the batch. */
  private want(resolved: string): void {
    if (this.wanted.has(resolved)) return;
    this.wanted.add(resolved);
    if (this.flushHandle !== null) return;
    this.flushHandle = setTimeout(() => {
      this.flushHandle = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  /** Send every accumulated want, in batches the endpoint accepts. */
  private async flush(): Promise<void> {
    const paths = Array.from(this.wanted);
    this.wanted.clear();
    if (paths.length === 0) return;
    for (const path of paths) this.verdicts.set(path, PENDING);
    this.notify();
    for (const chunk of chunkPaths(paths)) {
      this.applyProbeResult(chunk, await probePaths(chunk));
    }
  }

  private notify(): void {
    this.currentVersion += 1;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The verdict a probe result implies for one path, or `null` when the
 * result says nothing about it (a lost answer is not a "no").
 */
function verdictFor(
  path: string,
  result: ProbeResult | null,
): PathVerdict | null {
  if (result === null) return null;
  const exists = result.exists[path];
  if (exists === undefined) return null;
  if (!exists) return MISSING;
  const canonical = result.canonical[path] ?? path;
  return { state: "confirmed", canonical, isDir: result.isDir[path] === true };
}

/** The app's single store. */
export const pathResolutionStore = new PathResolutionStore();
