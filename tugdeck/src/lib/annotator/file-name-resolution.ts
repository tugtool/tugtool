/**
 * Filename resolution — which file does a bare `tug-button.css` mean?
 *
 * `fs/stat` can answer a path, because a path says where to look. A bare
 * filename says only what to look for, and it is the shape transcript
 * prose uses most: Claude writes the name of the file it just edited, not
 * a route to it. Answering that needs a search over the project, which is
 * exactly what Open Quickly already does — this module asks the same
 * question of the same index (FILETREE), so a name resolves here if and
 * only if typing it into Open Quickly and pressing Return would open it.
 *
 * **The match rule.** A result counts when the written text is the whole
 * tail of an indexed path — `tug-button.css` matches
 * `tugdeck/styles/tug-button.css` but not `old-tug-button.css`, and a
 * written `styles/tug-button.css` matches only a path ending in that whole
 * run. Among several such matches the best-scoring one wins, which is the
 * row Open Quickly would have put first. Fuzzy near-misses are discarded:
 * the index's scorer is built to rank candidates for a human who is about
 * to choose, and nobody is choosing here.
 *
 * **Why a queue.** The FILETREE feed is single-slot — one query
 * outstanding, and each response replaces the last snapshot — so a pass
 * that meets forty filenames cannot ask forty questions at once. Wants go
 * into a FIFO and drain one at a time. That is slow in the way a
 * background index is allowed to be slow: nothing blocks on it, verdicts
 * cache for the app's life, and a name already answered costs nothing on
 * every later pass.
 *
 * **Honesty under failure.** The feed is shared with Open Quickly, so a
 * query the user fires mid-flight can land on top of ours. An answer that
 * does not match the question is ignored, and a question that goes
 * unanswered past a deadline returns to `unknown` — never `missing`. The
 * one thing this must never do is manufacture a link.
 *
 * @module lib/annotator/file-name-resolution
 */

import { FeedStore } from "../feed-store";
import { FeedId } from "../../protocol";
import {
  FileTreeStore,
  resolveAgainstRoot,
  workspaceFeedFilter,
  type ScoredResult,
} from "../filetree-store";
import { getConnection } from "../connection-singleton";
import type { TugConnection } from "../../connection";
import type { PathVerdict } from "./path-resolution";

/** How long one query may go unanswered before it is retried later. */
const QUERY_TIMEOUT_MS = 4000;

const UNKNOWN: PathVerdict = { state: "unknown" };
const PENDING: PathVerdict = { state: "pending" };
const MISSING: PathVerdict = { state: "missing" };

/**
 * Whether `result` is the file `query` names: the written text must be the
 * whole tail of the indexed path, at a segment boundary.
 */
export function indexResultMatches(resultPath: string, query: string): boolean {
  if (resultPath === query) return true;
  return resultPath.endsWith(`/${query}`);
}

/**
 * The best result for `query`, or `null` when the index found nothing that
 * actually bears the name. A directory counts: it is a real thing the
 * reference can be pointing at, and the verdict says which it is so the
 * right gesture follows.
 */
export function bestIndexMatch(
  results: readonly ScoredResult[],
  query: string,
): ScoredResult | null {
  let best: ScoredResult | null = null;
  for (const result of results) {
    // The index spells a directory with a trailing separator; the query
    // may or may not carry one, and they mean the same place.
    const indexed = result.is_dir === true ? trimTrailingSlash(result.path) : result.path;
    if (!indexResultMatches(indexed, trimTrailingSlash(query))) continue;
    if (best === null || result.score > best.score) best = result;
  }
  return best;
}

/** Drop a trailing separator, so the two spellings of a folder agree. */
function trimTrailingSlash(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? path : trimmed;
}

/**
 * One project's filename verdict cache, backed by that project's FILETREE
 * index.
 */
export class FileNameResolutionStore {
  private readonly verdicts = new Map<string, PathVerdict>();
  private readonly queue: string[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly feedStore: FeedStore;
  private readonly fileTree: FileTreeStore;
  private readonly unsubscribeTree: () => void;
  private inFlight: string | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private currentVersion = 0;

  constructor(
    private readonly projectDir: string,
    workspaceKey: string,
    connection: TugConnection,
  ) {
    this.feedStore = new FeedStore(
      connection,
      [FeedId.FILETREE],
      undefined,
      workspaceFeedFilter(workspaceKey),
    );
    this.fileTree = new FileTreeStore(
      this.feedStore,
      FeedId.FILETREE,
      projectDir,
    );
    this.unsubscribeTree = this.fileTree.subscribe(() => {
      this.onSnapshot();
    });
  }

  /**
   * What is known about `name` right now. Synchronous by contract — the
   * annotator's DOM pass calls this for every filename candidate it meets.
   * A name never asked about is queued and reported `pending`; the answer
   * bumps the version, and the re-annotation pass asks again.
   */
  lookup = (name: string): PathVerdict => {
    const known = this.verdicts.get(name);
    if (known !== undefined) return known;
    this.verdicts.set(name, PENDING);
    this.queue.push(name);
    this.pump();
    return PENDING;
  };

  /** Subscribe to verdict arrivals. Returns the unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Bumped whenever verdicts change, so waiting ink re-marks. */
  version = (): number => this.currentVersion;

  /** Send the next queued query, if the single slot is free. */
  private pump(): void {
    if (this.inFlight !== null) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.inFlight = next;
    this.timeoutHandle = setTimeout(() => {
      // Unanswered: the shared feed may have carried someone else's
      // answer over ours. Forget the verdict so a later pass re-asks,
      // rather than recording a "no" the index never gave.
      this.timeoutHandle = null;
      this.verdicts.delete(next);
      this.inFlight = null;
      this.notify();
      this.pump();
    }, QUERY_TIMEOUT_MS);
    this.fileTree.sendQuery(next, this.projectDir);
  }

  /** Take delivery of a response, if it answers the question in flight. */
  private onSnapshot(): void {
    const pendingQuery = this.inFlight;
    if (pendingQuery === null) return;
    const snapshot = this.fileTree.getSnapshot();
    if (snapshot.query !== pendingQuery) return;
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.inFlight = null;
    const match = bestIndexMatch(snapshot.results, pendingQuery);
    this.verdicts.set(
      pendingQuery,
      match === null
        ? MISSING
        : {
            state: "confirmed",
            canonical: resolveAgainstRoot(
              this.projectDir,
              trimTrailingSlash(match.path),
            ),
            isDir: match.is_dir === true,
          },
    );
    this.notify();
    this.pump();
  }

  private notify(): void {
    this.currentVersion += 1;
    for (const listener of this.listeners) listener();
  }

  /** Release the feed subscription. */
  dispose(): void {
    if (this.timeoutHandle !== null) clearTimeout(this.timeoutHandle);
    this.unsubscribeTree();
    this.fileTree.dispose();
    this.feedStore.dispose();
    this.listeners.clear();
  }
}

/**
 * The resolver for one workspace, created on first use and kept for the
 * app's life. Filenames churn slowly and a reload rebuilds the world, so a
 * long-lived cache per project is the cheap shape; several cards on one
 * project share it and share its answers.
 */
const stores = new Map<string, FileNameResolutionStore>();

/**
 * The filename resolver for a project, or `null` when there is nothing to
 * search — no binding, or no connection to ask over.
 */
export function fileNameResolverFor(
  projectDir: string | null,
  workspaceKey: string | null,
): FileNameResolutionStore | null {
  if (projectDir === null || workspaceKey === null) return null;
  const existing = stores.get(workspaceKey);
  if (existing !== undefined) return existing;
  const connection = getConnection();
  if (connection === null) return null;
  const store = new FileNameResolutionStore(
    projectDir,
    workspaceKey,
    connection,
  );
  stores.set(workspaceKey, store);
  return store;
}

/** The verdict a context with no resolver reports: nothing is known. */
export const NO_NAME_VERDICT = UNKNOWN;
