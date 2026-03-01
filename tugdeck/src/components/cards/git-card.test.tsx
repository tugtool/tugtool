/**
 * GitCard React component tests — Step 7.2
 *
 * Tests:
 * - Git card renders branch name from feed data
 * - Git card renders changed file list with status indicators
 * - Git card updates when new feed frames arrive
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";
import React from "react";

import { CardContextProvider } from "../../cards/card-context";
import { GitCard } from "./git-card";
import { FeedId } from "../../protocol";

// ---- Helpers ----

interface GitStatusInput {
  branch?: string;
  ahead?: number;
  behind?: number;
  staged?: { path: string; status: string }[];
  unstaged?: { path: string; status: string }[];
  untracked?: string[];
  head_sha?: string;
  head_message?: string;
}

function makeGitStatus(overrides: GitStatusInput = {}): object {
  return {
    branch: overrides.branch ?? "main",
    ahead: overrides.ahead ?? 0,
    behind: overrides.behind ?? 0,
    staged: overrides.staged ?? [],
    unstaged: overrides.unstaged ?? [],
    untracked: overrides.untracked ?? [],
    head_sha: overrides.head_sha ?? "abc1234",
    head_message: overrides.head_message ?? "Initial commit",
  };
}

function encodeStatus(status: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(status));
}

function renderGitCard(feedPayload?: Uint8Array) {
  const feedData = new Map<number, Uint8Array>();
  if (feedPayload) {
    feedData.set(FeedId.GIT, feedPayload);
  }

  // Capture meta updates via the updateMeta callback (replaces card-meta-update CustomEvent)
  const metaUpdates: any[] = [];

  const result = render(
    <CardContextProvider
      connection={null}
      feedData={feedData}
      dimensions={{ width: 0, height: 0 }}
      dragState={null}
      updateMeta={(meta) => metaUpdates.push(meta)}
    >
      <GitCard />
    </CardContextProvider>
  );
  return { ...result, metaUpdates };
}

// ---- Tests ----

describe("GitCard – initial state", () => {
  it("renders waiting message when no feed data", async () => {
    const { container, unmount } = renderGitCard();
    await act(async () => {});

    const text = container.textContent;
    expect(text).toContain("Waiting for git status");

    unmount();
  });
});

describe("GitCard – branch name", () => {
  it("renders the branch name from feed data", async () => {
    const payload = encodeStatus(makeGitStatus({ branch: "feature/my-branch" }));
    const { container, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(container.textContent).toContain("feature/my-branch");

    unmount();
  });

  it("renders ahead/behind indicators when non-zero", async () => {
    const payload = encodeStatus(makeGitStatus({ ahead: 2, behind: 1 }));
    const { container, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(container.textContent).toContain("↑2");
    expect(container.textContent).toContain("↓1");

    unmount();
  });

  it("does not render ahead/behind when both are zero", async () => {
    const payload = encodeStatus(makeGitStatus({ ahead: 0, behind: 0 }));
    const { container, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("↓");

    unmount();
  });
});

describe("GitCard – file lists", () => {
  it("renders staged files with file paths", async () => {
    const payload = encodeStatus(
      makeGitStatus({
        staged: [
          { path: "src/main.ts", status: "M" },
          { path: "src/utils.ts", status: "A" },
        ],
      })
    );
    const { container, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(container.textContent).toContain("Staged");
    expect(container.textContent).toContain("src/main.ts");
    expect(container.textContent).toContain("src/utils.ts");

    unmount();
  });

  it("renders unstaged files with file paths", async () => {
    const payload = encodeStatus(
      makeGitStatus({
        unstaged: [{ path: "tugdeck/src/app.tsx", status: "M" }],
      })
    );
    const { container, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(container.textContent).toContain("Unstaged");
    expect(container.textContent).toContain("tugdeck/src/app.tsx");

    unmount();
  });

  it("renders untracked files by default", async () => {
    const payload = encodeStatus(
      makeGitStatus({ untracked: ["new-file.ts"] })
    );
    const { container, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(container.textContent).toContain("Untracked");
    expect(container.textContent).toContain("new-file.ts");

    unmount();
  });

  it("renders clean working tree message when all lists are empty", async () => {
    const payload = encodeStatus(makeGitStatus());
    const { container, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(container.textContent).toContain("Clean working tree");

    unmount();
  });

  it("renders head commit message", async () => {
    const payload = encodeStatus(
      makeGitStatus({ head_message: "feat: add new feature" })
    );
    const { container, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(container.textContent).toContain("feat: add new feature");

    unmount();
  });
});

describe("GitCard – feed updates", () => {
  it("updates branch name when feed data changes", async () => {
    const containerEl = document.createElement("div");
    document.body.appendChild(containerEl);
    const feedData = new Map<number, Uint8Array>();
    feedData.set(FeedId.GIT, encodeStatus(makeGitStatus({ branch: "main" })));

    const { container, rerender, unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={feedData}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
        containerEl={containerEl}
      >
        <GitCard />
      </CardContextProvider>
    );
    await act(async () => {});
    expect(container.textContent).toContain("main");

    // Update to new branch
    const feedData2 = new Map<number, Uint8Array>();
    feedData2.set(
      FeedId.GIT,
      encodeStatus(makeGitStatus({ branch: "feature/new-work" }))
    );

    await act(async () => {
      rerender(
        <CardContextProvider
          connection={null}
          feedData={feedData2}
          dimensions={{ width: 0, height: 0 }}
          dragState={null}
          containerEl={containerEl}
        >
          <GitCard />
        </CardContextProvider>
      );
    });

    expect(container.textContent).toContain("feature/new-work");

    unmount();
  });
});

describe("GitCard – card meta", () => {
  it("dispatches card-meta-update with Git title and menu items", async () => {
    const payload = encodeStatus(makeGitStatus());
    const { metaUpdates, unmount } = renderGitCard(payload);
    await act(async () => {});

    expect(metaUpdates.length).toBeGreaterThan(0);
    const lastMeta = metaUpdates[metaUpdates.length - 1];
    expect(lastMeta.title).toBe("Git");
    expect(lastMeta.icon).toBe("GitBranch");

    const refreshItem = lastMeta.menuItems.find(
      (item: any) => item.label === "Refresh Now"
    );
    expect(refreshItem).not.toBeUndefined();
    expect(refreshItem?.type).toBe("action");

    const toggleItem = lastMeta.menuItems.find(
      (item: any) => item.label === "Show Untracked"
    );
    expect(toggleItem).not.toBeUndefined();
    expect(toggleItem?.type).toBe("toggle");

    unmount();
  });
});
