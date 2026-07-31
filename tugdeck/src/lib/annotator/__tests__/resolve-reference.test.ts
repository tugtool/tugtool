/**
 * Pure-logic coverage for reference routing and the file index's match
 * rule.
 *
 * These two decisions are the whole of "does this text name a real file",
 * and they are where the annotator's earlier version went wrong: it had
 * one resolver, so the shapes that resolver could not answer — a bare
 * filename, a path written relative to somewhere other than the session
 * cwd — were excluded by grammar instead of being asked of someone who
 * could answer them.
 *
 * The filesystem side runs against the real `PathResolutionStore`, seeded
 * through the same `applyProbeResult` the network path uses. The index
 * side is exercised over an answer table, because what is being pinned is
 * which resolver's verdict comes back — a behavior, visible in the result.
 */

import { describe, expect, test } from "bun:test";

import type { PathReference } from "../detect-path-reference";
import { bestIndexMatch, indexResultMatches } from "../file-name-resolution";
import type { ScoredResult } from "../../filetree-store";
import { PathResolutionStore, type PathVerdict } from "../path-resolution";
import { makeReferenceResolver, type NameLookup } from "../resolve-reference";

/** A store already holding the answers a probe would have brought back. */
function seededPaths(answers: Record<string, string | false>): PathResolutionStore {
  const store = new PathResolutionStore();
  const paths = Object.keys(answers);
  const exists: Record<string, boolean> = {};
  const canonical: Record<string, string> = {};
  for (const [path, answer] of Object.entries(answers)) {
    exists[path] = answer !== false;
    if (answer !== false) canonical[path] = answer;
  }
  store.applyProbeResult(paths, { exists, canonical, isDir: {} });
  return store;
}

/** An index that answers from a table and knows nothing else. */
function seededNames(answers: Record<string, string>): NameLookup {
  return {
    lookup: (name: string): PathVerdict =>
      answers[name] === undefined
        ? { state: "missing" }
        : { state: "confirmed", canonical: answers[name], isDir: false },
  };
}

const pathRef = (path: string): PathReference => ({ path, shape: "path" });
const nameRef = (path: string): PathReference => ({ path, shape: "name" });

describe("indexResultMatches — the written text must be the whole tail", () => {
  test("a bare name matches its own basename", () => {
    expect(indexResultMatches("tugdeck/styles/tug-button.css", "tug-button.css")).toBe(
      true,
    );
  });

  test("and not a name that merely ends with it", () => {
    expect(indexResultMatches("tugdeck/styles/old-tug-button.css", "tug-button.css")).toBe(
      false,
    );
  });

  test("a written partial path matches at a segment boundary", () => {
    expect(indexResultMatches("a/b/styles/tug.css", "styles/tug.css")).toBe(true);
    expect(indexResultMatches("a/b/mystyles/tug.css", "styles/tug.css")).toBe(false);
  });

  test("an exact index path matches itself", () => {
    expect(indexResultMatches("justfile", "justfile")).toBe(true);
  });
});

describe("bestIndexMatch — the row Open Quickly would have put first", () => {
  const result = (path: string, score: number, is_dir = false): ScoredResult => ({
    path,
    score,
    matches: [],
    is_dir,
  });

  test("among exact-name matches, the best score wins", () => {
    const best = bestIndexMatch(
      [result("old/tug.css", 10), result("src/tug.css", 90), result("z/tug.css", 40)],
      "tug.css",
    );
    expect(best?.path).toBe("src/tug.css");
  });

  test("a high-scoring fuzzy near-miss is not a match", () => {
    // The index scores for a human about to choose from a list; nobody is
    // choosing here, so only a real name match counts.
    expect(bestIndexMatch([result("src/tugs.css", 99)], "tug.css")).toBeNull();
  });

  test("a directory is a match too — it is a real thing to point at", () => {
    // The index spells a folder with a trailing separator; the reference
    // may or may not, and they mean the same place. The verdict carries
    // which it is, so the right gesture follows.
    const best = bestIndexMatch([result("src/styles/", 99, true)], "styles");
    expect(best?.path).toBe("src/styles/");
    expect(best?.is_dir).toBe(true);
  });

  test("nothing found is null, not a guess", () => {
    expect(bestIndexMatch([], "tug.css")).toBeNull();
  });
});

describe("makeReferenceResolver — who gets asked", () => {
  test("a bare name goes to the index", () => {
    const resolve = makeReferenceResolver({
      paths: seededPaths({}),
      names: seededNames({ "tug-button.css": "/repo/tugdeck/tug-button.css" }),
      cwd: "/repo",
    });
    expect(resolve(nameRef("tug-button.css"))).toEqual({
      state: "confirmed",
      canonical: "/repo/tugdeck/tug-button.css",
      isDir: false,
    });
  });

  test("with no project bound, a bare name is unknown — never missing", () => {
    const resolve = makeReferenceResolver({
      paths: seededPaths({}),
      names: null,
      cwd: "/repo",
    });
    expect(resolve(nameRef("tug-button.css"))).toEqual({ state: "unknown" });
  });

  test("a relative path the cwd confirms is answered by the filesystem", () => {
    const resolve = makeReferenceResolver({
      paths: seededPaths({ "/repo/lib/a.ts": "/repo/lib/a.ts" }),
      names: seededNames({ "lib/a.ts": "/elsewhere/lib/a.ts" }),
      cwd: "/repo",
    });
    expect(resolve(pathRef("lib/a.ts"))).toEqual({
      state: "confirmed",
      canonical: "/repo/lib/a.ts",
      isDir: false,
    });
  });

  test("a relative path the cwd misses falls back to the index", () => {
    // The Bash-header case: the path is written relative to the repo root
    // while the session's cwd is somewhere else. One resolver says no; the
    // other knows where the file actually is.
    const resolve = makeReferenceResolver({
      paths: seededPaths({ "/repo/sub/tugdeck/src/a.ts": false }),
      names: seededNames({ "tugdeck/src/a.ts": "/repo/tugdeck/src/a.ts" }),
      cwd: "/repo/sub",
    });
    expect(resolve(pathRef("tugdeck/src/a.ts"))).toEqual({
      state: "confirmed",
      canonical: "/repo/tugdeck/src/a.ts",
      isDir: false,
    });
  });

  test("an absolute path is the filesystem's alone — the index holds relative paths", () => {
    const resolve = makeReferenceResolver({
      paths: seededPaths({ "/nowhere/a.ts": false }),
      names: seededNames({ "/nowhere/a.ts": "/repo/a.ts" }),
      cwd: "/repo",
    });
    expect(resolve(pathRef("/nowhere/a.ts"))).toEqual({ state: "missing" });
  });

  test("an unanswered filesystem probe is not escalated to the index", () => {
    // Asking both would spend an index query racing an answer already on
    // its way, and the index queue is single-file. A queued probe reports
    // `pending` — the state that marks its container as awaiting — and the
    // answer's batch re-marks it.
    const resolve = makeReferenceResolver({
      paths: new PathResolutionStore(),
      names: seededNames({ "lib/a.ts": "/repo/lib/a.ts" }),
      cwd: "/repo",
    });
    expect(resolve(pathRef("lib/a.ts"))).toEqual({ state: "pending" });
  });

  test("with no cwd to resolve against, a relative path goes to the index", () => {
    // The handshake has not landed, so there is nothing to join the path
    // onto — but the project index does not need a cwd to find it.
    const resolve = makeReferenceResolver({
      paths: new PathResolutionStore(),
      names: seededNames({ "lib/a.ts": "/repo/lib/a.ts" }),
      cwd: null,
    });
    expect(resolve(pathRef("lib/a.ts"))).toEqual({
      state: "confirmed",
      canonical: "/repo/lib/a.ts",
      isDir: false,
    });
  });
});
