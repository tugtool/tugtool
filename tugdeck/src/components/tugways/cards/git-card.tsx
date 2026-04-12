/**
 * Git Card — live git status display powered by the tugcast git feed.
 *
 * Renders branch name, ahead/behind indicators, HEAD commit message, and
 * staged/unstaged/untracked file lists. Uses `useTugcardData<GitStatus>()` to
 * read decoded feed data provided by `TugcardDataProvider` in tug-card.tsx.
 *
 * **Laws:** [L02] External state via useSyncExternalStore (handled by Tugcard/FeedStore),
 * [L15] CSS tokens for colors, [L19] data-slot annotations.
 * **Decisions:** [D04] Single-call registration, [D09] card content pattern.
 *
 * @module components/tugways/cards/git-card
 */

import React from "react";
import { GitBranch, CircleCheck, CircleDot, CircleDashed } from "lucide-react";
import { registerCard } from "@/card-registry";
import { FeedId } from "@/protocol";
import { useTugcardData } from "@/components/tugways/hooks/use-tugcard-data";

// ---------------------------------------------------------------------------
// GitStatus schema (matches tugcast-core/src/types.rs)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FileList({
  files,
  color,
  icon: Icon,
}: {
  files: Array<{ path: string; status?: string }>;
  color: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  return (
    <>
      {files.map((f) => (
        <div
          key={f.path}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.8125rem",
            color,
            fontFamily: "var(--tug-font-family-mono)",
            overflow: "hidden",
          }}
        >
          <Icon size={12} style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {f.status ? `${f.status} ${f.path}` : f.path}
          </span>
        </div>
      ))}
    </>
  );
}

function UntrackedList({ files }: { files: string[] }) {
  return (
    <>
      {files.map((path) => (
        <div
          key={path}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.8125rem",
            color: "var(--tug7-element-global-text-normal-muted-rest)",
            fontFamily: "var(--tug-font-family-mono)",
            overflow: "hidden",
          }}
        >
          <CircleDashed size={12} style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {path}
          </span>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// GitCardContent
// ---------------------------------------------------------------------------

/**
 * Card-specific content for the Git status card.
 *
 * Reads decoded GitStatus from TugcardDataProvider via useTugcardData.
 * Falls back to "Waiting for git status..." when no data has arrived yet.
 */
export function GitCardContent() {
  const data = useTugcardData<GitStatus>();

  if (!data) {
    return (
      <div
        data-slot="git-card"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 16px",
          color: "var(--tug7-element-global-text-normal-muted-rest)",
          fontFamily: "var(--tug-font-family-sans)",
          fontSize: "0.875rem",
        }}
      >
        Waiting for git status...
      </div>
    );
  }

  const { branch, ahead, behind, staged, unstaged, untracked, head_message } = data;
  const hasFiles = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;

  return (
    <div
      data-slot="git-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "12px 14px",
        fontFamily: "var(--tug-font-family-sans)",
        color: "var(--tug7-element-global-text-normal-default-rest)",
        overflowY: "auto",
      }}
    >
      {/* Branch row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "0.9375rem",
          fontWeight: 600,
        }}
      >
        <GitBranch size={16} style={{ flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {branch}
        </span>
        {ahead > 0 && (
          <span
            style={{
              marginLeft: "4px",
              fontSize: "0.75rem",
              color: "var(--tug7-element-global-text-normal-default-rest)",
              fontWeight: 500,
            }}
          >
            ↑{ahead}
          </span>
        )}
        {behind > 0 && (
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--tug7-element-global-text-normal-default-rest)",
              fontWeight: 500,
            }}
          >
            ↓{behind}
          </span>
        )}
      </div>

      {/* HEAD commit message */}
      {head_message && (
        <div
          style={{
            fontSize: "0.8125rem",
            color: "var(--tug7-element-global-text-normal-muted-rest)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {head_message}
        </div>
      )}

      {/* File lists */}
      {hasFiles ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {staged.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--tug7-element-global-text-normal-muted-rest)",
                  marginBottom: "2px",
                }}
              >
                Staged
              </div>
              <FileList
                files={staged}
                color="var(--tug-color-semantic-success-default)"
                icon={CircleCheck}
              />
            </div>
          )}
          {unstaged.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: staged.length > 0 ? "6px" : 0 }}>
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--tug7-element-global-text-normal-muted-rest)",
                  marginBottom: "2px",
                }}
              >
                Unstaged
              </div>
              <FileList
                files={unstaged}
                color="var(--tug-color-semantic-warning-default)"
                icon={CircleDot}
              />
            </div>
          )}
          {untracked.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: (staged.length > 0 || unstaged.length > 0) ? "6px" : 0 }}>
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--tug7-element-global-text-normal-muted-rest)",
                  marginBottom: "2px",
                }}
              >
                Untracked
              </div>
              <UntrackedList files={untracked} />
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.875rem",
            color: "var(--tug-color-semantic-success-default)",
          }}
        >
          <CircleCheck size={14} />
          Clean working tree
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerGitCard
// ---------------------------------------------------------------------------

/**
 * Register the Git card in the global card registry.
 *
 * Must be called before `DeckManager.addCard("git")` is invoked.
 * Call from `main.tsx` alongside `registerHelloWorldCard()`.
 */
export function registerGitCard(): void {
  registerCard({
    componentId: "git",
    contentFactory: () => <GitCardContent />,
    defaultMeta: { title: "Git", icon: "GitBranch", closable: true },
    defaultFeedIds: [FeedId.GIT],
    sizePolicy: {
      min: { width: 280, height: 200 },
      preferred: { width: 650, height: 350 },
    },
  });
}
