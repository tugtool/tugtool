/**
 * GitCard — React functional component for the Git card.
 *
 * Renders git repository status: branch, ahead/behind, staged, unstaged,
 * and untracked file lists using Tailwind utilities and shadcn ScrollArea.
 *
 * Replaces the vanilla GitCard class (src/cards/git-card.ts),
 * which is retained until Step 10 bulk deletion.
 *
 * References: [D03] React content only, [D06] Replace tests, Table T03
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  GitBranch,
  CircleCheck,
  CircleDot,
  CircleDashed,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFeed } from "../../hooks/use-feed";
import { useCardMeta } from "../../hooks/use-card-meta";
import { FeedId } from "../../protocol";
import type { TugCardMeta } from "../../cards/card";

// ---- Types ----

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

// ---- Sub-components ----

function FileEntry({
  path,
  variant,
}: {
  path: string;
  variant: "staged" | "unstaged" | "untracked";
}) {
  const iconProps = { size: 14, "aria-hidden": true } as const;
  const icon =
    variant === "staged" ? (
      <CircleCheck {...iconProps} className="text-green-500" />
    ) : variant === "unstaged" ? (
      <CircleDot {...iconProps} className="text-yellow-500" />
    ) : (
      <CircleDashed {...iconProps} className="text-muted-foreground" />
    );

  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-xs">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate font-mono">{path}</span>
    </div>
  );
}

function FileSection({
  title,
  files,
  variant,
}: {
  title: string;
  files: { path: string }[];
  variant: "staged" | "unstaged" | "untracked";
}) {
  return (
    <div className="mb-2">
      <div className="px-1 py-0.5 text-xs font-semibold text-muted-foreground">
        {title} ({files.length})
      </div>
      {files.map((f) => (
        <FileEntry key={f.path} path={f.path} variant={variant} />
      ))}
    </div>
  );
}

// ---- Component ----

export function GitCard() {
  const feedPayload = useFeed(FeedId.GIT);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [showUntracked, setShowUntracked] = useState(true);

  // ---- Parse feed payload ----

  useEffect(() => {
    if (!feedPayload || feedPayload.length === 0) return;

    const text = new TextDecoder().decode(feedPayload);
    try {
      const status = JSON.parse(text) as GitStatus;
      setGitStatus(status);
    } catch {
      console.error("git-card: failed to parse GitStatus payload");
    }
  }, [feedPayload]);

  // ---- Menu actions ----

  const handleRefresh = useCallback(() => {
    // No-op for React version — re-render happens automatically via feed
  }, []);

  const handleToggleUntracked = useCallback(() => {
    setShowUntracked((prev) => !prev);
  }, []);

  // ---- Card meta ----

  const meta = useMemo<TugCardMeta>(
    () => ({
      title: "Git",
      icon: "GitBranch",
      closable: true,
      menuItems: [
        {
          type: "action",
          label: "Refresh Now",
          action: handleRefresh,
        },
        {
          type: "toggle",
          label: "Show Untracked",
          checked: showUntracked,
          action: handleToggleUntracked,
        },
      ],
    }),
    [showUntracked, handleRefresh, handleToggleUntracked]
  );

  useCardMeta(meta);

  // ---- Render ----

  if (!gitStatus) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground">Waiting for git status...</p>
      </div>
    );
  }

  const isClean =
    gitStatus.staged.length === 0 &&
    gitStatus.unstaged.length === 0 &&
    gitStatus.untracked.length === 0;

  return (
    <ScrollArea className="h-full w-full">
      <div className="flex flex-col gap-1 p-2">
        {/* Branch badge */}
        <div className="mb-1 flex items-center gap-1.5">
          <GitBranch
            size={14}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium">
            {gitStatus.branch}
          </span>
          {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
            <span className="text-xs text-muted-foreground">
              {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
              {gitStatus.ahead > 0 && gitStatus.behind > 0 && " "}
              {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
            </span>
          )}
        </div>

        {/* Head commit message */}
        {gitStatus.head_message && (
          <div className="mb-1 truncate px-1 text-xs text-muted-foreground">
            {gitStatus.head_message}
          </div>
        )}

        {/* File sections */}
        {gitStatus.staged.length > 0 && (
          <FileSection
            title="Staged"
            files={gitStatus.staged}
            variant="staged"
          />
        )}
        {gitStatus.unstaged.length > 0 && (
          <FileSection
            title="Unstaged"
            files={gitStatus.unstaged}
            variant="unstaged"
          />
        )}
        {showUntracked && gitStatus.untracked.length > 0 && (
          <FileSection
            title="Untracked"
            files={gitStatus.untracked.map((p) => ({ path: p }))}
            variant="untracked"
          />
        )}

        {/* Clean state */}
        {isClean && (
          <p className="py-2 text-center text-xs text-muted-foreground">
            Clean working tree
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
