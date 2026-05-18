// Produces `/context`-style per-category token breakdowns of the session's
// context window. Tokenizes static categories (system prompt, tool schemas,
// custom agents, memory files, skills) locally; derives `messages_tokens`
// by subtracting the static total from Claude's observed input tokens;
// emits a {@link ContextBreakdown} wire frame for the popover.
//
// Spike S3 in roadmap/tide-assistant-turns-context-breakdown-spikes.md
// originally proposed a per-session calibration ratio to pin our local
// estimates to observed truth. The implementation revealed the
// calibration breaks on resumed sessions: observed_input on resume
// includes the entire prior conversation, the anchor (static +
// new_user_msg) is much smaller, and the resulting ratio warps every
// static category by a too-large factor. The S3 benchmark already
// showed raw drift is 0.5–5.6% — inside the 5–10% accuracy bar — so
// dropping calibration is the simpler, correct thing on both fresh
// and resumed sessions. The spike's drift benchmark appendix carries
// the post-mortem.
//
// The CLI's actual system prompt and tool schemas are opaque to us —
// they live inside the Claude Code binary and the SDK does not surface
// them. {@link SYSTEM_PROMPT_DEFAULT_TOKENS} and
// {@link TOOL_SCHEMA_DEFAULT_TOKENS} are heuristic approximations.
// File-backed categories (custom_agents, memory_files, skills) come
// from disk reads cached by `(path, mtime)`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { countTokens } from "@anthropic-ai/tokenizer";

import type { ClaudeCodeSettings } from "./claude-code-settings.ts";
import type { ContextBreakdown, ContextBreakdownCategory } from "./types.ts";

/**
 * Heuristic estimate of the CLI's internal system prompt in tokens.
 * The actual bytes are CLI-internal and not addressable from the SDK
 * (see spike S1). If a future SDK release surfaces the actual count,
 * replace this constant with the SDK-provided value.
 */
export const SYSTEM_PROMPT_DEFAULT_TOKENS = 3_500;

/**
 * Per-tool schema-token estimate. Built-in Claude Code tools average
 * roughly this in token count (per spike S1's reference research).
 */
export const TOOL_SCHEMA_DEFAULT_TOKENS = 500;

/**
 * Default reserved-buffer size when the user has autocompact enabled.
 * Per spike S5: current Claude Code reserves ~33k tokens when the
 * `autoCompactEnabled` setting is true. Hardcoded here rather than
 * queried from the SDK because the SDK exposes neither the setting
 * nor the buffer size.
 */
export const AUTOCOMPACT_BUFFER_DEFAULT_TOKENS = 33_000;

/**
 * Fallback context window cap when `modelUsage` does not carry one
 * (e.g., the first emit before any `cost_update` has landed). 200k
 * matches the current Sonnet/Opus default; the SDK's beta 1M-context
 * flag would override.
 */
export const DEFAULT_CONTEXT_MAX = 200_000;

interface CacheEntry {
  mtimeMs: number;
  tokens: number;
}

/**
 * Read a file's text and return its token count, using a per-path
 * (mtime-keyed) cache. Returns 0 if the file does not exist or is
 * unreadable. Safe to call across HMR boundaries — the mtime in the
 * cache key invalidates on file edit.
 */
export function tokenizeFileCached(
  absPath: string,
  cache: Map<string, CacheEntry>,
): number {
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return 0;
  }
  const cached = cache.get(absPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.tokens;
  }
  let text: string;
  try {
    text = readFileSync(absPath, "utf-8");
  } catch {
    return 0;
  }
  const tokens = countTokens(text);
  cache.set(absPath, { mtimeMs: stat.mtimeMs, tokens });
  return tokens;
}

/**
 * Sum the token counts of every `*.md` file directly inside `dirPath`.
 * Best-effort: missing or unreadable directory returns 0 silently.
 * Used to tokenize a memory directory's full corpus (MEMORY.md +
 * sibling entry files) without hard-coding individual filenames.
 */
export function tokenizeMarkdownDirCached(
  dirPath: string,
  cache: Map<string, CacheEntry>,
): number {
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    total += tokenizeFileCached(join(dirPath, name), cache);
  }
  return total;
}

/**
 * Sum the token counts of every `SKILL.md` under `<pluginPath>/skills/<name>/SKILL.md`.
 * Used to fold plugin-shipped skills into the breakdown's `skills`
 * category — without this walk, users with plugin-loaded skills
 * would see their skills under-count by the full plugin corpus.
 */
export function tokenizePluginSkills(
  pluginPath: string,
  cache: Map<string, CacheEntry>,
): number {
  const skillsRoot = join(pluginPath, "skills");
  let entries: string[];
  try {
    entries = readdirSync(skillsRoot);
  } catch {
    return 0;
  }
  let total = 0;
  for (const skillDirName of entries) {
    total += tokenizeFileCached(
      join(skillsRoot, skillDirName, "SKILL.md"),
      cache,
    );
  }
  return total;
}

/**
 * Sum the token counts of every `*.md` under `<pluginPath>/agents/`.
 * Used to fold plugin-shipped agents into the breakdown's
 * `custom_agents` category. Mirrors {@link tokenizePluginSkills}.
 */
export function tokenizePluginAgents(
  pluginPath: string,
  cache: Map<string, CacheEntry>,
): number {
  return tokenizeMarkdownDirCached(join(pluginPath, "agents"), cache);
}

/**
 * Per-category token estimates for the session-stable categories.
 * `messages` is excluded — it's derived per turn from observed input
 * tokens, not tokenized locally.
 */
export interface StaticCategoryEstimates {
  system_prompt: number;
  system_tools: number;
  custom_agents: number;
  memory_files: number;
  skills: number;
}

/**
 * Sum of the per-category estimates.
 */
export function staticTotal(s: StaticCategoryEstimates): number {
  return (
    s.system_prompt +
    s.system_tools +
    s.custom_agents +
    s.memory_files +
    s.skills
  );
}

/**
 * Subset of the SDK's `system:init` event fields we need for static-
 * category tokenization. Tugcode already projects this shape into
 * its `SystemMetadata` IPC — we read the same data here.
 *
 * Plugin entries are objects with at least a `path` field (the on-
 * disk plugin directory); we walk each plugin's `agents/` and
 * `skills/` subdirs to fold plugin-shipped content into the
 * corresponding categories.
 */
export interface SessionInitMetadata {
  tools: ReadonlyArray<unknown>;
  agents: ReadonlyArray<unknown>;
  skills: ReadonlyArray<unknown>;
  plugins: ReadonlyArray<unknown>;
}

/**
 * Inputs for {@link computeStaticCategories} other than the metadata.
 * `cache` carries the per-(path, mtime) tokenization cache the emitter
 * threads across calls.
 */
export interface ComputeStaticCategoriesOptions {
  homeDir: string;
  cwd: string;
  cache: Map<string, CacheEntry>;
}

/**
 * Encode an absolute cwd into Claude Code's project-directory naming
 * convention (`/` → `-`). Mirrors `encodeProjectDir` in
 * `tugcode/src/session.ts` — duplicated here rather than imported
 * to keep this module standalone for testing.
 */
function encodeProjectDir(absDir: string): string {
  return absDir.replace(/\//g, "-");
}

/**
 * Tokenize the session's static categories using the local BPE
 * tokenizer plus heuristic constants for CLI-internal bytes
 * (`system_prompt`, `system_tools`). File-backed categories
 * (`custom_agents`, `memory_files`, `skills`) read from disk; absent
 * files contribute 0.
 *
 * The walk covers:
 * - User-level files under `~/.claude/agents/` and
 *   `~/.claude/skills/<name>/SKILL.md` for each name in `metadata.agents`
 *   / `metadata.skills`.
 * - User-level + project memory: `~/.claude/CLAUDE.md`, `cwd/CLAUDE.md`,
 *   and every `*.md` inside
 *   `~/.claude/projects/<encoded-cwd>/memory/` (so the auto-memory
 *   `MEMORY.md` index + every sibling entry file contributes).
 * - Plugin-shipped agents and skills: for every plugin entry that
 *   carries a `path`, walk `<path>/agents/` and `<path>/skills/`.
 */
export function computeStaticCategories(
  metadata: SessionInitMetadata,
  options: ComputeStaticCategoriesOptions,
): StaticCategoryEstimates {
  const { homeDir, cwd, cache } = options;

  const system_prompt = SYSTEM_PROMPT_DEFAULT_TOKENS;

  const system_tools = metadata.tools.length * TOOL_SCHEMA_DEFAULT_TOKENS;

  let custom_agents = 0;
  for (const a of metadata.agents) {
    if (typeof a !== "string") continue;
    custom_agents += tokenizeFileCached(
      join(homeDir, ".claude", "agents", `${a}.md`),
      cache,
    );
  }

  let memory_files = 0;
  memory_files += tokenizeFileCached(
    join(homeDir, ".claude", "CLAUDE.md"),
    cache,
  );
  memory_files += tokenizeFileCached(join(cwd, "CLAUDE.md"), cache);
  // Auto-memory directory: `~/.claude/projects/<encoded-cwd>/memory/`
  // holds `MEMORY.md` (the index) plus per-entry `*.md` files the
  // assistant maintains across sessions. Walk the whole directory so
  // the full corpus counts toward memory_files — undercounting just
  // MEMORY.md would miss the bulk of the user's persistent memory.
  memory_files += tokenizeMarkdownDirCached(
    join(homeDir, ".claude", "projects", encodeProjectDir(cwd), "memory"),
    cache,
  );

  let skills = 0;
  for (const s of metadata.skills) {
    if (typeof s !== "string") continue;
    skills += tokenizeFileCached(
      join(homeDir, ".claude", "skills", s, "SKILL.md"),
      cache,
    );
  }

  // Walk every plugin's `agents/` and `skills/` subdirs. For users
  // with plugins loaded (the common case in Tug development), this
  // is the bulk of the agents/skills contribution; without it the
  // categories would significantly under-count.
  for (const p of metadata.plugins) {
    if (typeof p !== "object" || p === null) continue;
    const path = (p as { path?: unknown }).path;
    if (typeof path !== "string" || path.length === 0) continue;
    custom_agents += tokenizePluginAgents(path, cache);
    skills += tokenizePluginSkills(path, cache);
  }

  return { system_prompt, system_tools, custom_agents, memory_files, skills };
}

/**
 * Derive `messages_tokens` for the current cost_update by subtracting
 * the static-category total from observed input. Clamps to 0 — if our
 * static estimate slightly exceeds observed (rare; usually a sparse
 * first cost_update on a fresh session) the messages slice reads as
 * 0 rather than a confusing negative.
 *
 * `observedInput` should include cache-read + cache-creation tokens
 * (i.e., the full content-byte count Claude has in context, not just
 * the billed-this-turn input).
 */
export function computeMessagesTokens(
  observedInput: number,
  staticTotalTokens: number,
): number {
  return Math.max(0, Math.round(observedInput - staticTotalTokens));
}

const CATEGORY_LABELS: Record<
  keyof StaticCategoryEstimates | "messages" | "autocompact_buffer",
  string
> = {
  system_prompt: "System prompt",
  system_tools: "System tools",
  custom_agents: "Custom agents",
  memory_files: "Memory files",
  skills: "Skills",
  messages: "Messages",
  autocompact_buffer: "Autocompact buffer",
};

export interface BuildFrameInput {
  sessionId: string;
  contextMax: number;
  staticEstimates: StaticCategoryEstimates;
  messagesTokens: number;
  autocompactEnabled: boolean;
  autocompactBufferTokens?: number;
}

/**
 * Assemble the {@link ContextBreakdown} wire frame. Static categories
 * pass through unmodified — there is no per-session calibration; the
 * local tokenizer's raw output sits inside the documented 5–10%
 * accuracy bar. The autocompact buffer slice is included iff the
 * setting is enabled and the reserved count is non-zero.
 */
export function buildContextBreakdownFrame(
  input: BuildFrameInput,
): ContextBreakdown {
  const {
    sessionId,
    contextMax,
    staticEstimates,
    messagesTokens,
    autocompactEnabled,
  } = input;
  const bufferTokens =
    input.autocompactBufferTokens ?? AUTOCOMPACT_BUFFER_DEFAULT_TOKENS;

  const categories: ContextBreakdownCategory[] = [
    {
      id: "system_prompt",
      label: CATEGORY_LABELS.system_prompt,
      tokens: staticEstimates.system_prompt,
    },
    {
      id: "system_tools",
      label: CATEGORY_LABELS.system_tools,
      tokens: staticEstimates.system_tools,
    },
    {
      id: "custom_agents",
      label: CATEGORY_LABELS.custom_agents,
      tokens: staticEstimates.custom_agents,
    },
    {
      id: "memory_files",
      label: CATEGORY_LABELS.memory_files,
      tokens: staticEstimates.memory_files,
    },
    {
      id: "skills",
      label: CATEGORY_LABELS.skills,
      tokens: staticEstimates.skills,
    },
    {
      id: "messages",
      label: CATEGORY_LABELS.messages,
      tokens: messagesTokens,
    },
  ];

  if (autocompactEnabled && bufferTokens > 0) {
    categories.push({
      id: "autocompact_buffer",
      label: CATEGORY_LABELS.autocompact_buffer,
      tokens: bufferTokens,
    });
  }

  return {
    type: "context_breakdown",
    tug_session_id: sessionId,
    context_max: contextMax,
    categories,
    ipc_version: 2,
  };
}

/**
 * Sum input + cache-read + cache-creation tokens from a `cost_update`
 * usage payload. This is content-byte truth ("what's in the model's
 * context window"), not billing truth ("what's billed this turn") —
 * cache reads are content the model sees but doesn't pay for, and we
 * want to surface them on the popover's gauge.
 */
export function extractObservedInputTokens(
  usage: Record<string, unknown>,
): number {
  const input = numericOrZero(usage.input_tokens);
  const cacheRead = numericOrZero(usage.cache_read_input_tokens);
  const cacheCreation = numericOrZero(usage.cache_creation_input_tokens);
  return input + cacheRead + cacheCreation;
}

function numericOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Extract the context-window cap from `modelUsage`. The SDK's
 * `modelUsage` is `{ [modelName]: { contextWindow, ... } }`; we read
 * the first model's cap. Falls back to {@link DEFAULT_CONTEXT_MAX}
 * when modelUsage is absent or carries no contextWindow.
 */
export function extractContextMax(
  modelUsage: Record<string, unknown> | undefined,
): number {
  if (!modelUsage) return DEFAULT_CONTEXT_MAX;
  for (const v of Object.values(modelUsage)) {
    if (typeof v === "object" && v !== null) {
      const cw = (v as Record<string, unknown>).contextWindow;
      if (typeof cw === "number" && Number.isFinite(cw) && cw > 0) return cw;
    }
  }
  return DEFAULT_CONTEXT_MAX;
}

/**
 * Per-session stateful emitter for `context_breakdown` frames.
 * Constructed once per SessionManager; methods are invoked as events
 * flow through the dispatcher.
 *
 * Emit cadence (per spike S4):
 * - {@link onSessionInit}: tokenizes statics, returns the initial frame
 *   (messages_tokens = 0).
 * - {@link onCostUpdate}: recomputes messages_tokens from observed
 *   usage via subtraction from the static total.
 * - {@link onCompactBoundary}: currently a no-op — the next cost_update
 *   reflects the post-compaction state via the same subtraction.
 *
 * The caller is responsible for writing the returned frame to the
 * wire. All methods are synchronous; file IO is best-effort and uses
 * `readFileSync` against small fixture-shaped paths (CLAUDE.md,
 * agent/skill manifests, memory entries, plugin agents/skills).
 * Sub-millisecond on first call, cache-hit thereafter.
 */
export class ContextBreakdownEmitter {
  private readonly sessionId: string;
  private readonly homeDir: string;
  private readonly cwd: string;
  private readonly settings: ClaudeCodeSettings;

  private staticEstimates: StaticCategoryEstimates | null = null;
  private contextMax: number = DEFAULT_CONTEXT_MAX;
  private readonly tokenizationCache: Map<string, CacheEntry> = new Map();

  constructor(opts: {
    sessionId: string;
    homeDir: string;
    cwd: string;
    settings: ClaudeCodeSettings;
  }) {
    this.sessionId = opts.sessionId;
    this.homeDir = opts.homeDir;
    this.cwd = opts.cwd;
    this.settings = opts.settings;
  }

  /**
   * Tokenize static categories and return the initial frame. Safe
   * to call multiple times — subsequent calls re-tokenize through
   * the mtime cache (cheap on hit, correct on file edit).
   */
  onSessionInit(metadata: SessionInitMetadata): ContextBreakdown {
    this.staticEstimates = computeStaticCategories(metadata, {
      homeDir: this.homeDir,
      cwd: this.cwd,
      cache: this.tokenizationCache,
    });
    return this.buildCurrentFrame(0);
  }

  /**
   * Recompute and return the updated frame. Returns `null` if the
   * emitter has not been initialized (no session_init yet —
   * defensive; should not occur in practice).
   */
  onCostUpdate(
    usage: Record<string, unknown>,
    modelUsage?: Record<string, unknown>,
  ): ContextBreakdown | null {
    if (!this.staticEstimates) return null;

    this.contextMax = extractContextMax(modelUsage);
    const observedInput = extractObservedInputTokens(usage);
    const messagesTokens = computeMessagesTokens(
      observedInput,
      staticTotal(this.staticEstimates),
    );

    return this.buildCurrentFrame(messagesTokens);
  }

  /**
   * Currently a no-op. After compaction, the next `cost_update`
   * arrives with a reduced `usage.input_tokens` total reflecting the
   * post-compact context window; the messages-by-subtraction
   * arithmetic in {@link onCostUpdate} surfaces the new `messages_tokens`
   * automatically.
   */
  onCompactBoundary(): void {
    // Intentionally empty; see method docstring.
  }

  private buildCurrentFrame(messagesTokens: number): ContextBreakdown {
    return buildContextBreakdownFrame({
      sessionId: this.sessionId,
      contextMax: this.contextMax,
      staticEstimates:
        this.staticEstimates ?? {
          system_prompt: 0,
          system_tools: 0,
          custom_agents: 0,
          memory_files: 0,
          skills: 0,
        },
      messagesTokens,
      autocompactEnabled: this.settings.autoCompactEnabled,
      autocompactBufferTokens: AUTOCOMPACT_BUFFER_DEFAULT_TOKENS,
    });
  }
}
