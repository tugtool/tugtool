import { describe, expect, it } from "bun:test";

import {
  diffablePathsOf,
  entryDiffDescriptor,
  fileExpandKey,
  hasHeadDiff,
  type TugChangesListEntry,
} from "@/components/tugways/tug-changes-list";
import type {
  ChangesetFile,
  ProjectChangeset,
  SessionChangesetEntry,
  UnattributedFile,
} from "@/lib/changeset-types";

function project(overrides: Partial<ProjectChangeset> = {}): ProjectChangeset {
  return {
    workspace_key: "ws",
    branch: "main",
    ahead: 0,
    behind: 0,
    head_sha: "0".repeat(40),
    head_message: "head",
    changesets: [],
    unattributed: [],
    project_dir: "/repo",
    display_name: "repo",
    no_repo: false,
    ...overrides,
  };
}

function file(path: string, git_status: string): ChangesetFile {
  return { path, git_status, op: "modified", origin: "turn", shared: false, last_touched: 0 };
}

function sessionEntry(files: ChangesetFile[]): SessionChangesetEntry {
  return { kind: "session", owner_id: "own", display_name: "own", live: true, files };
}

function sessionItem(files: ChangesetFile[], proj = project()): TugChangesListEntry {
  return { kind: "session", id: "sess", project: proj, entry: sessionEntry(files) };
}

function unattributedItem(files: UnattributedFile[], proj = project()): TugChangesListEntry {
  return { kind: "unattributed", id: "unattr", project: proj, files };
}

describe("hasHeadDiff", () => {
  it("is false for untracked files and true otherwise", () => {
    expect(hasHeadDiff("??")).toBe(false);
    expect(hasHeadDiff(".M")).toBe(true);
    expect(hasHeadDiff("A.")).toBe(true);
  });
});

describe("fileExpandKey", () => {
  it("joins entry id and path with a pipe", () => {
    expect(fileExpandKey("sess", "src/a.ts")).toBe("sess|src/a.ts");
  });
});

describe("diffablePathsOf", () => {
  it("keeps tracked paths and drops untracked ones (session entry)", () => {
    const item = sessionItem([file("a.ts", ".M"), file("new.ts", "??"), file("b.ts", "A.")]);
    expect(diffablePathsOf(item)).toEqual(["a.ts", "b.ts"]);
  });

  it("reads from the files array for an unattributed entry", () => {
    const item = unattributedItem([
      { path: "u.ts", git_status: ".M" },
      { path: "fresh.ts", git_status: "??" },
    ]);
    expect(diffablePathsOf(item)).toEqual(["u.ts"]);
  });
});

describe("entryDiffDescriptor", () => {
  it("returns a head descriptor scoped to the diffable paths", () => {
    const item = sessionItem([file("a.ts", ".M"), file("new.ts", "??")]);
    expect(entryDiffDescriptor(item)).toEqual({ kind: "head", root: "/repo", paths: ["a.ts"] });
  });

  it("returns null when no file is diffable", () => {
    expect(entryDiffDescriptor(sessionItem([file("new.ts", "??")]))).toBeNull();
  });

  it("returns null for a non-repo project", () => {
    const item = sessionItem([file("a.ts", ".M")], project({ no_repo: true }));
    expect(entryDiffDescriptor(item)).toBeNull();
  });
});
