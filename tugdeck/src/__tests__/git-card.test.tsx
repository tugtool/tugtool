/**
 * Git card tests.
 *
 * Tests cover:
 * - Renders "Waiting for git status..." with no feed data
 * - Renders branch name from feed data
 * - Renders ahead/behind indicators
 * - Renders staged/unstaged/untracked file lists
 * - Renders "Clean working tree" when all lists empty
 * - Renders HEAD commit message
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

import { TugcardDataProvider } from "@/components/tugways/hooks/use-tugcard-data";
import { GitCardContent } from "@/components/tugways/cards/git-card";
import { FeedId } from "@/protocol";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface FileStatus {
  path: string;
  status: string;
}

interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: string[];
  head_sha: string;
  head_message: string;
}

function makeGitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: "main",
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    head_sha: "abc1234",
    head_message: "initial commit",
    ...overrides,
  };
}

function renderWithFeedData(status: GitStatus | null) {
  const feedData = status !== null
    ? new Map<number, unknown>([[FeedId.GIT, status]])
    : new Map<number, unknown>();

  return render(
    <TugcardDataProvider feedData={feedData}>
      <GitCardContent />
    </TugcardDataProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitCardContent – no data", () => {
  it("renders waiting message when no feed data", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(null));
    });
    expect(container.textContent).toContain("Waiting for git status...");
  });
});

describe("GitCardContent – branch name", () => {
  it("renders the branch name", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({ branch: "feature/my-branch" })));
    });
    expect(container.textContent).toContain("feature/my-branch");
  });
});

describe("GitCardContent – ahead/behind", () => {
  it("renders ahead indicator when ahead > 0", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({ ahead: 3, behind: 0 })));
    });
    expect(container.textContent).toContain("↑3");
  });

  it("renders behind indicator when behind > 0", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({ ahead: 0, behind: 2 })));
    });
    expect(container.textContent).toContain("↓2");
  });

  it("renders both ahead and behind indicators", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({ ahead: 1, behind: 4 })));
    });
    expect(container.textContent).toContain("↑1");
    expect(container.textContent).toContain("↓4");
  });

  it("does not render ahead indicator when ahead is 0", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({ ahead: 0, behind: 0 })));
    });
    expect(container.textContent).not.toContain("↑");
  });
});

describe("GitCardContent – staged files", () => {
  it("renders staged file list", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({
        staged: [{ path: "src/foo.ts", status: "M" }],
      })));
    });
    expect(container.textContent).toContain("Staged");
    expect(container.textContent).toContain("src/foo.ts");
  });
});

describe("GitCardContent – unstaged files", () => {
  it("renders unstaged file list", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({
        unstaged: [{ path: "src/bar.ts", status: "M" }],
      })));
    });
    expect(container.textContent).toContain("Unstaged");
    expect(container.textContent).toContain("src/bar.ts");
  });
});

describe("GitCardContent – untracked files", () => {
  it("renders untracked file list", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({
        untracked: ["new-file.ts"],
      })));
    });
    expect(container.textContent).toContain("Untracked");
    expect(container.textContent).toContain("new-file.ts");
  });
});

describe("GitCardContent – clean working tree", () => {
  it("renders clean working tree when all file lists are empty", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({
        staged: [],
        unstaged: [],
        untracked: [],
      })));
    });
    expect(container.textContent).toContain("Clean working tree");
  });
});

describe("GitCardContent – HEAD commit message", () => {
  it("renders HEAD commit message", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderWithFeedData(makeGitStatus({
        head_message: "feat: add git card revival",
      })));
    });
    expect(container.textContent).toContain("feat: add git card revival");
  });
});
