/**
 * Git card implementation
 *
 * Displays git repository status: branch, ahead/behind, staged/unstaged/untracked files.
 */

import { createElement, GitBranch, CircleCheck, CircleDot, CircleDashed } from "lucide";
import { FeedId, FeedIdValue } from "../protocol";
import { TugCard } from "./card";

/** GitStatus as serialized by tugcast-core (matches Spec S02) */
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

interface FileStatus {
  path: string;
  status: string;
}

export class GitCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [FeedId.GIT];

  private container: HTMLElement | null = null;
  private header: HTMLElement | null = null;
  private content: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.classList.add("git-card");

    // Create header
    this.header = document.createElement("div");
    this.header.className = "card-header";
    this.header.textContent = "Git";
    this.container.appendChild(this.header);

    // Create scrollable content area
    this.content = document.createElement("div");
    this.content.className = "git-content";
    this.container.appendChild(this.content);
  }

  onFrame(feedId: FeedIdValue, payload: Uint8Array): void {
    if (feedId !== FeedId.GIT || !this.content) return;
    if (payload.length === 0) return;

    const text = new TextDecoder().decode(payload);
    let status: GitStatus;
    try {
      status = JSON.parse(text);
    } catch {
      console.error("git-card: failed to parse GitStatus payload");
      return;
    }

    this.render(status);
  }

  onResize(_width: number, _height: number): void {
    // CSS handles scrolling
  }

  destroy(): void {
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
      this.header = null;
      this.content = null;
    }
  }

  private render(status: GitStatus): void {
    if (!this.content) return;
    this.content.innerHTML = "";

    // Branch badge with short SHA
    const branchSection = document.createElement("div");
    branchSection.className = "branch-section";

    const branchIcon = createElement(GitBranch, { width: 14, height: 14 });
    (branchIcon as HTMLElement).style.color = "var(--muted-foreground)";
    branchSection.appendChild(branchIcon);

    const branchBadge = document.createElement("span");
    branchBadge.className = "branch-badge";
    branchBadge.textContent = status.branch;
    branchSection.appendChild(branchBadge);

    // Ahead/behind counters (only show if non-zero)
    if (status.ahead > 0 || status.behind > 0) {
      const ab = document.createElement("span");
      ab.className = "ahead-behind";
      const parts: string[] = [];
      if (status.ahead > 0) parts.push(`↑${status.ahead}`);
      if (status.behind > 0) parts.push(`↓${status.behind}`);
      ab.textContent = parts.join(" ");
      branchSection.appendChild(ab);
    }

    this.content.appendChild(branchSection);

    // Head commit message
    if (status.head_message) {
      const commitMsg = document.createElement("div");
      commitMsg.className = "head-message";
      commitMsg.textContent = status.head_message;
      this.content.appendChild(commitMsg);
    }

    // File sections
    if (status.staged.length > 0) {
      this.renderFileSection("Staged", "staged", status.staged);
    }
    if (status.unstaged.length > 0) {
      this.renderFileSection("Unstaged", "unstaged", status.unstaged);
    }
    if (status.untracked.length > 0) {
      this.renderUntrackedSection(status.untracked);
    }

    // Clean state message
    if (
      status.staged.length === 0 &&
      status.unstaged.length === 0 &&
      status.untracked.length === 0
    ) {
      const clean = document.createElement("div");
      clean.className = "clean-status";
      clean.textContent = "Clean working tree";
      this.content.appendChild(clean);
    }
  }

  private renderFileSection(
    title: string,
    className: string,
    files: FileStatus[]
  ): void {
    if (!this.content) return;

    const section = document.createElement("div");
    section.className = `file-section ${className}`;

    const sectionTitle = document.createElement("div");
    sectionTitle.className = "section-title";
    sectionTitle.textContent = `${title} (${files.length})`;
    section.appendChild(sectionTitle);

    for (const file of files) {
      const entry = document.createElement("div");
      entry.className = "file-entry";

      const statusSpan = document.createElement("span");
      statusSpan.className = "file-status";
      const icon = className === "staged"
        ? createElement(CircleCheck, { width: 14, height: 14 })
        : createElement(CircleDot, { width: 14, height: 14 });
      statusSpan.appendChild(icon);

      const pathSpan = document.createElement("span");
      pathSpan.className = "file-path";
      pathSpan.textContent = file.path;

      entry.appendChild(statusSpan);
      entry.appendChild(pathSpan);
      section.appendChild(entry);
    }

    this.content.appendChild(section);
  }

  private renderUntrackedSection(paths: string[]): void {
    if (!this.content) return;

    const section = document.createElement("div");
    section.className = "file-section untracked";

    const sectionTitle = document.createElement("div");
    sectionTitle.className = "section-title";
    sectionTitle.textContent = `Untracked (${paths.length})`;
    section.appendChild(sectionTitle);

    for (const path of paths) {
      const entry = document.createElement("div");
      entry.className = "file-entry";

      const statusSpan = document.createElement("span");
      statusSpan.className = "file-status";
      statusSpan.appendChild(createElement(CircleDashed, { width: 14, height: 14 }));

      const pathSpan = document.createElement("span");
      pathSpan.className = "file-path";
      pathSpan.textContent = path;

      entry.appendChild(statusSpan);
      entry.appendChild(pathSpan);
      section.appendChild(entry);
    }

    this.content.appendChild(section);
  }
}
