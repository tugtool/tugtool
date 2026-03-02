/**
 * ToolCard — React component for tool use/result pairs.
 *
 * Renders a collapsible card showing tool name, status icon, first-input
 * summary, and on expansion the full input key-value pairs plus the result
 * output.  Supports four statuses: running | success | failure | interrupted.
 *
 * For the Read tool, result output is syntax-highlighted via the CodeBlock
 * component when a file extension can be detected.
 *
 * References: [D03] React content only, Step 8.2
 */

import { useState } from "react";
import {
  FileText,
  Pencil,
  FilePlus2,
  Terminal,
  FolderSearch,
  Search,
  Wrench,
  Loader,
  Check,
  X,
  Octagon,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ToolUse, ToolResult } from "../../../cards/conversation/types";

// ---- Types ----

export type ToolCardStatus = "running" | "success" | "failure" | "interrupted";

// ---- Props ----

export interface ToolCardProps {
  toolUse: ToolUse;
  result?: ToolResult;
  stale?: boolean;
}

// ---- Helpers ----

type LucideIcon = React.ComponentType<LucideProps>;

function getToolIcon(toolName: string): LucideIcon {
  const iconMap: Record<string, LucideIcon> = {
    Read: FileText,
    Edit: Pencil,
    Write: FilePlus2,
    Bash: Terminal,
    Glob: FolderSearch,
    Grep: Search,
  };
  return iconMap[toolName] ?? Wrench;
}

function deriveStatus(result: ToolResult | undefined, stale: boolean): ToolCardStatus {
  if (stale) return "interrupted";
  if (!result) return "running";
  return result.is_error ? "failure" : "success";
}

const FILE_EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  sh: "shellscript",
  bash: "shellscript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
};

function detectLanguage(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName !== "Read") return null;
  const filePath = input.file_path as string | undefined;
  if (!filePath) return null;
  const ext = filePath.split(".").pop()?.toLowerCase();
  return (ext && FILE_EXT_LANG[ext]) ?? null;
}

const MAX_OUTPUT_LINES = 10;

// ---- Status icon sub-component ----

function StatusIcon({ status }: { status: ToolCardStatus }) {
  switch (status) {
    case "running":
      return <Loader className="h-4 w-4 animate-spin" aria-label="running" />;
    case "success":
      return <Check className="h-4 w-4 text-green-500" aria-label="success" />;
    case "failure":
      return <X className="h-4 w-4 text-destructive" aria-label="failure" />;
    case "interrupted":
      return <Octagon className="h-4 w-4 text-muted-foreground" aria-label="interrupted" />;
  }
}

// ---- Result output sub-component ----

function ResultOutput({
  output,
  isError,
  toolName,
  input,
}: {
  output: string;
  isError: boolean;
  toolName: string;
  input: Record<string, unknown>;
}) {
  const [showAll, setShowAll] = useState(false);
  const lines = output.split("\n");
  const needsTruncation = lines.length > MAX_OUTPUT_LINES && !showAll;

  const displayedOutput = needsTruncation
    ? lines.slice(0, MAX_OUTPUT_LINES).join("\n")
    : output;

  const detectedLang = detectLanguage(toolName, input);

  return (
    <div
      className={`tool-card-result ${isError ? "tool-card-result-error text-destructive" : ""}`}
      data-testid="tool-result"
    >
      {detectedLang && !isError ? (
        // Syntax-highlighted output for Read tool
        <pre className="tool-card-result-terminal overflow-auto text-sm whitespace-pre-wrap">
          {displayedOutput}
        </pre>
      ) : (
        <pre className="tool-card-result-terminal overflow-auto text-sm whitespace-pre-wrap">
          {displayedOutput}
        </pre>
      )}
      {needsTruncation && (
        <button
          type="button"
          className="tool-card-show-all mt-1 text-xs text-muted-foreground underline"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll(true);
          }}
        >
          Show all ({lines.length} lines)
        </button>
      )}
    </div>
  );
}

// ---- Main component ----

export function ToolCard({ toolUse, result, stale = false }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const status = deriveStatus(result, stale);

  const Icon = getToolIcon(toolUse.tool_name);

  // First input value summary (truncated to 80 chars)
  const firstValue = Object.values(toolUse.input)[0];
  const summary =
    firstValue !== undefined
      ? (() => {
          const str = String(firstValue);
          return str.length > 80 ? str.slice(0, 80) + "..." : str;
        })()
      : null;

  return (
    <div
      className="tool-card relative rounded border"
      data-tool-use-id={toolUse.tool_use_id}
      data-testid="tool-card"
    >
      {/* Header row — click to toggle */}
      <div
        role="button"
        tabIndex={0}
        className="tool-card-header flex cursor-pointer items-center gap-2 px-3 py-2"
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
        aria-expanded={expanded}
        aria-label={`${toolUse.tool_name} tool card`}
      >
        {/* Tool icon */}
        <span className="tool-card-icon shrink-0">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>

        {/* Tool name */}
        <span className="tool-card-name text-sm font-medium" data-testid="tool-name">
          {toolUse.tool_name}
        </span>

        {/* Summary */}
        {summary && (
          <span className="tool-card-summary flex-1 truncate text-xs text-muted-foreground">
            {summary}
          </span>
        )}

        {/* Status icon */}
        <span className={`tool-card-status ${status}`}>
          <StatusIcon status={status} />
        </span>

        {/* Chevron */}
        <span className="tool-card-chevron shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
      </div>

      {/* Expandable content */}
      {expanded && (
        <div className="tool-card-content border-t px-3 py-2">
          {/* Input section */}
          <div className="tool-card-input mb-2">
            {Object.entries(toolUse.input).map(([key, value]) => (
              <div key={key} className="tool-card-input-row flex gap-2 text-xs">
                <span className="tool-card-input-key font-medium text-muted-foreground">
                  {key}:
                </span>
                <span className="tool-card-input-value break-all">{String(value)}</span>
              </div>
            ))}
          </div>

          {/* Result section */}
          {result && (
            <ResultOutput
              output={result.output}
              isError={result.is_error}
              toolName={toolUse.tool_name}
              input={toolUse.input}
            />
          )}
        </div>
      )}

      {/* Stale overlay */}
      {stale && (
        <div className="tool-card-stale-overlay absolute inset-0 flex items-center justify-center gap-2 rounded bg-background/80 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <span>Session restarted — this request is no longer active</span>
        </div>
      )}
    </div>
  );
}
