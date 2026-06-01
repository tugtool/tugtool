/**
 * agents-list.ts — pure projections for the read-only `/agents` sheet
 * ([#step-12b]).
 *
 * `/agents` mirrors Claude Code's `/agents`: a **Running** section (subagents
 * executing right now) and a **Library** section (the agents Claude can
 * delegate to). It is read-only — creating / editing agents is out of scope
 * (you ask Claude to write the agent file directly).
 *
 * Two pure sources, no tugcode round-trip:
 *  - **Running** — derived from the live transcript: a `Task` tool call that
 *    is still `pending` is a running subagent ({@link selectRunningAgents}).
 *  - **Library** — the built-in agents Claude ships ({@link BUILTIN_AGENTS} —
 *    a fixed, always-available set, the same list CC's Library shows; there is
 *    nothing to introspect), merged with any plugin / user agents the wire
 *    reports in `SessionMetadataStore.slashCommands` ({@link
 *    selectLibraryAgents}). Built-in models are the known shipped defaults; if
 *    Claude Code changes its built-in roster this static list is where to
 *    update it.
 *
 * @module lib/agents-list
 */

import type { SlashCommandInfo } from "./session-metadata-store";
import type { Message } from "./code-session-store/types";

/** Where an agent comes from. */
export type AgentOrigin = "built-in" | "plugin" | "user";

/** One agent in the `/agents` Library. */
export interface AgentEntry {
  /** Display name — `<plugin>:<agent>` for plugin agents, bare otherwise. */
  name: string;
  origin: AgentOrigin;
  /** Originating plugin name when `origin === "plugin"`. */
  plugin?: string;
  /** Model the agent runs on, when known (the built-in shipped defaults). */
  model?: string;
}

/**
 * The built-in subagents Claude Code ships — "always available", the same set
 * CC's `/agents` Library lists, with their shipped model defaults. These are a
 * fixed roster, not something tugcode can introspect; update this list if CC's
 * built-in set changes.
 */
export const BUILTIN_AGENTS: readonly AgentEntry[] = [
  { name: "claude", origin: "built-in", model: "inherit" },
  { name: "claude-code-guide", origin: "built-in", model: "haiku" },
  { name: "Explore", origin: "built-in", model: "haiku" },
  { name: "general-purpose", origin: "built-in", model: "inherit" },
  { name: "Plan", origin: "built-in", model: "inherit" },
  { name: "statusline-setup", origin: "built-in", model: "sonnet" },
];

/**
 * The Library list: the built-in roster, followed by any plugin / user agents
 * the wire reports (`slashCommands` category `"agent"`) that aren't already
 * built-in, sorted by name. A namespaced `<plugin>:<agent>` name is a plugin
 * agent; a bare extra name is a user agent.
 */
export function selectLibraryAgents(
  slashCommands: readonly SlashCommandInfo[],
): AgentEntry[] {
  const builtinNames = new Set(BUILTIN_AGENTS.map((a) => a.name));
  const extra: AgentEntry[] = slashCommands
    .filter((c) => c.category === "agent" && !builtinNames.has(c.name))
    .map((c) => {
      const colon = c.name.indexOf(":");
      return colon > 0
        ? { name: c.name, origin: "plugin" as const, plugin: c.name.slice(0, colon) }
        : { name: c.name, origin: "user" as const };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...BUILTIN_AGENTS, ...extra];
}

/**
 * Trailing label for a Library row. Built-in agents read their model (matching
 * CC's `claude · inherit`); plugin / user agents read their origin (model
 * isn't on the wire for those).
 */
export function agentTrailingLabel(entry: AgentEntry): string {
  if (entry.origin === "built-in") return entry.model ?? "built-in";
  if (entry.origin === "plugin") return `Plugin ${entry.plugin}`;
  return "User";
}

/** One currently-running subagent (a pending `Task` tool call). */
export interface RunningAgentEntry {
  /** The spawning `Task` call's tool-use id (stable list key). */
  toolUseId: string;
  /** The `subagent_type` input (e.g. "Explore"); falls back to "subagent". */
  subagentType: string;
  /** The call's `description` input, when present. */
  description?: string;
}

/**
 * Running subagents — every `Task` tool call still `pending` in the supplied
 * messages (the caller flattens the live `activeTurn` + committed turns). A
 * pending `Task` call is a subagent executing right now; once its result lands
 * it's `done` and drops out. Pure over the message list.
 */
export function selectRunningAgents(
  messages: readonly Message[],
): RunningAgentEntry[] {
  const out: RunningAgentEntry[] = [];
  for (const m of messages) {
    if (m.kind !== "tool_use") continue;
    if (m.toolName.toLowerCase() !== "task") continue;
    if (m.status !== "pending") continue;
    const input = (m.input ?? {}) as Record<string, unknown>;
    out.push({
      toolUseId: m.toolUseId,
      subagentType:
        typeof input.subagent_type === "string"
          ? input.subagent_type
          : "subagent",
      description:
        typeof input.description === "string" ? input.description : undefined,
    });
  }
  return out;
}
