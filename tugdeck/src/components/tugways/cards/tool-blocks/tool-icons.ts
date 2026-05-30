/**
 * tool-icons.ts — central per-tool icon registry ([D07] of
 * roadmap/tool-call-header.md).
 *
 * Before the regularization each tool-block wrapper imported its own
 * lucide icon at its own size (12 or 14), so the icon set was neither
 * auditable nor uniform. `toolIconFor` is the single source: it maps a
 * wire tool name (case-insensitive, alias-aware) to one lucide glyph at
 * one fixed size. `ToolCallHeader` calls it when a wrapper doesn't pass
 * an explicit `icon`, so a wrapper migrating onto the header drops its
 * bespoke import and the registry decides.
 *
 * The map keys include the historical wire variants (`multiedit`,
 * `enterworktree`, the `task*`/`cron*` families) so the header resolves
 * the right glyph without re-deriving the dispatch's alias table — the
 * variants point at the same icon as their canonical wrapper.
 *
 * @module components/tugways/cards/tool-blocks/tool-icons
 */

import React from "react";
import {
  AlignLeft,
  BookOpen,
  Bot,
  Clock,
  FilePenLine,
  FilePlus,
  FileText,
  GitBranch,
  Globe,
  ListTodo,
  MessageCircleQuestion,
  Notebook,
  Radar,
  Search,
  Shell,
  Sparkles,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The one size every tool icon renders at in the header. Fixed here
 * (not per-wrapper) so the icon column is optically uniform across
 * every tool row.
 */
export const TOOL_ICON_SIZE = 14;

/**
 * Lowercased wire tool name → lucide icon component. Includes alias
 * variants so the header never has to consult the dispatch's alias
 * table. A name absent from this map resolves to {@link Wrench} (the
 * `DefaultToolBlock` glyph) via {@link toolIconFor}.
 */
const TOOL_ICON_BY_NAME: ReadonlyMap<string, LucideIcon> = new Map([
  ["bash", Shell],
  ["read", FileText],
  ["edit", FilePenLine],
  ["multiedit", FilePenLine],
  ["write", FilePlus],
  ["notebookedit", Notebook],
  ["glob", Search],
  ["grep", Search],
  ["agent", Bot],
  ["task", Bot],
  ["askuserquestion", MessageCircleQuestion],
  ["skill", Sparkles],
  ["monitor", Radar],
  ["worktree", GitBranch],
  ["enterworktree", GitBranch],
  ["exitworktree", GitBranch],
  ["taskmgmt", ListTodo],
  ["tasklist", ListTodo],
  ["taskget", ListTodo],
  ["taskoutput", ListTodo],
  ["taskstop", ListTodo],
  ["taskcreate", ListTodo],
  ["taskupdate", ListTodo],
  ["cron", Clock],
  ["croncreate", Clock],
  ["crondelete", Clock],
  ["cronlist", Clock],
  ["webfetch", Globe],
  ["websearch", Search],
  ["remotetrigger", Zap],
  ["shareonboardingguide", BookOpen],
  ["read_lines", AlignLeft],
]);

/**
 * Resolve the lucide icon component for a wire tool name. Returns
 * {@link Wrench} for an unknown name. Exported for tests that pin the
 * registry coverage; app code uses {@link toolIconFor}.
 */
export function toolIconComponentFor(toolName: string): LucideIcon {
  return TOOL_ICON_BY_NAME.get(toolName.toLowerCase()) ?? Wrench;
}

/**
 * Resolve a tool's header icon as a ready-to-render node at the fixed
 * {@link TOOL_ICON_SIZE}, `aria-hidden` (the tool name beside it is the
 * accessible label). `ToolCallHeader` calls this when no explicit
 * `icon` prop is supplied.
 */
export function toolIconFor(toolName: string): React.ReactNode {
  const Icon = toolIconComponentFor(toolName);
  return React.createElement(Icon, {
    size: TOOL_ICON_SIZE,
    "aria-hidden": true,
  });
}
