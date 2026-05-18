// Produces `/context`-style per-category token breakdowns of the session's
// context window. Tokenizes static categories (system prompt, tool schemas,
// custom agents, memory files, skills) locally; derives `messages_tokens`
// by subtracting the calibrated static sum from Claude's observed input
// tokens; emits a {@link ContextBreakdown} wire frame for the popover.
//
// Spike S3 in roadmap/tide-assistant-turns-context-breakdown-spikes.md
// established the calibration algorithm (locally-tokenize statics, pin
// the total to observed `usage.input_tokens` truth via a per-session
// ratio, derive messages by subtraction). Spike S4 established the
// emit cadence (session_init + every cost_update + after compact_boundary)
// and the file-mtime cache. Spike S5 established the autocompact reading
// (settings.json → `autoCompactEnabled`).
//
// The CLI's actual system prompt and tool schemas are opaque to us —
// they live inside the Claude Code binary and the SDK does not surface
// them. {@link SYSTEM_PROMPT_DEFAULT_TOKENS} and
// {@link TOOL_SCHEMA_DEFAULT_TOKENS} are heuristic approximations; the
// per-session calibration ratio absorbs the residual drift, keeping
// the displayed total within Anthropic's `count_tokens` truth and the
// per-category split within the documented 5–10% accuracy bar.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { countTokens } from "@anthropic-ai/tokenizer";

import type { ClaudeCodeSettings } from "./claude-code-settings.ts";
import type { ContextBreakdown, ContextBreakdownCategory } from "./types.ts";

/**
 * Heuristic estimate of the CLI's internal system prompt in tokens.
 * The actual bytes are CLI-internal and not addressable from the SDK
 * (see spike S1). The calibration ratio (S3) absorbs the residual.
 * If a future SDK release surfaces the actual count, replace this
 * with the SDK-provided value.
 */
export const SYSTEM_PROMPT_DEFAULT_TOKENS = 3_500;

/**
 * Per-tool schema-token estimate. Built-in Claude Code tools average
 * roughly this in token count (per spike S1's reference research).
 * The calibration ratio absorbs per-tool variance.
 */
export const TOOL_SCHEMA_DEFAULT_TOKENS = 500;

/**
 * Default reserved-buffer size when the user has autocompact enabled.
 * Per spike S5: current Claude Code reserves ~33k tokens when the
 * `autoCompactEnabled` setting is true (reduced from ~45k in early
 * 2026). Hardcoded here rather than queried from the SDK because the
 * SDK exposes neither the setting nor the buffer size.
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
 * Tokenize the session's static categories using the local BPE
 * tokenizer plus heuristic constants for CLI-internal bytes
 * (`system_prompt`, `system_tools`). File-backed categories
 * (`custom_agents`, `memory_files`, `skills`) read from disk; absent
 * files contribute 0.
 *
 * Plugin walking is intentionally minimal in this version. Plugin-
 * shipped agents and skills currently undercount; the calibration
 * ratio absorbs the resulting drift uniformly. If plugin accuracy
 * proves load-bearing, walk `metadata.plugins[].path` here (each
 * plugin dir conventionally has `agents/` and `skills/` subdirs).
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

  let skills = 0;
  for (const s of metadata.skills) {
    if (typeof s !== "string") continue;
    skills += tokenizeFileCached(
      join(homeDir, ".claude", "skills", s, "SKILL.md"),
      cache,
    );
  }

  return { system_prompt, system_tools, custom_agents, memory_files, skills };
}

/**
 * Compute the per-session calibration ratio that pins our locally-
 * tokenized static estimate to Claude's observed input-token truth.
 * Anchor: the first `cost_update` after the user has submitted at
 * least one message.
 *
 *   ratio = observedInput / (staticTotal + userMessageTokens)
 *
 * Returns 1.0 (no calibration) when there's no anchor data, when
 * the divisor is zero/non-finite, or when the computed ratio falls
 * outside a defensive `[0.5, 2.0]` clamp — drift that extreme suggests
 * something is wrong with the inputs and would warp the breakdown
 * worse than no calibration at all.
 */
export function computeCalibrationRatio(
  observedInput: number,
  staticTotalTokens: number,
  userMessageTokens: number,
): number {
  if (userMessageTokens <= 0) return 1.0;
  const divisor = staticTotalTokens + userMessageTokens;
  if (divisor <= 0) return 1.0;
  const ratio = observedInput / divisor;
  if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 2.0) return 1.0;
  return ratio;
}

/**
 * Derive `messages_tokens` for the current cost_update by subtracting
 * the calibrated static sum from observed input. Clamps to 0 — a
 * negative result (rare; usually a sparse first cost_update where our
 * static estimate slightly exceeds observed) reads as "no message
 * content yet" rather than a confusing negative slice.
 */
export function computeMessagesTokens(
  observedInput: number,
  calibratedStaticSum: number,
): number {
  return Math.max(0, Math.round(observedInput - calibratedStaticSum));
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
  calibrationRatio: number;
  messagesTokens: number;
  autocompactEnabled: boolean;
  autocompactBufferTokens?: number;
}

/**
 * Assemble the {@link ContextBreakdown} wire frame. Static categories
 * are scaled by the calibration ratio; messages tokens come pre-derived;
 * the autocompact buffer slice is included iff the setting is enabled
 * and the reserved count is non-zero.
 */
export function buildContextBreakdownFrame(
  input: BuildFrameInput,
): ContextBreakdown {
  const {
    sessionId,
    contextMax,
    staticEstimates,
    calibrationRatio,
    messagesTokens,
    autocompactEnabled,
  } = input;
  const bufferTokens =
    input.autocompactBufferTokens ?? AUTOCOMPACT_BUFFER_DEFAULT_TOKENS;

  const categories: ContextBreakdownCategory[] = [
    {
      id: "system_prompt",
      label: CATEGORY_LABELS.system_prompt,
      tokens: Math.round(staticEstimates.system_prompt * calibrationRatio),
    },
    {
      id: "system_tools",
      label: CATEGORY_LABELS.system_tools,
      tokens: Math.round(staticEstimates.system_tools * calibrationRatio),
    },
    {
      id: "custom_agents",
      label: CATEGORY_LABELS.custom_agents,
      tokens: Math.round(staticEstimates.custom_agents * calibrationRatio),
    },
    {
      id: "memory_files",
      label: CATEGORY_LABELS.memory_files,
      tokens: Math.round(staticEstimates.memory_files * calibrationRatio),
    },
    {
      id: "skills",
      label: CATEGORY_LABELS.skills,
      tokens: Math.round(staticEstimates.skills * calibrationRatio),
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
 *   (calibration_ratio = 1.0, messages_tokens = 0).
 * - {@link onCostUpdate}: recomputes messages_tokens from observed
 *   usage; calibrates against truth on the first call that has anchor
 *   data (a user message has been submitted).
 * - {@link onCompactBoundary}: currently a no-op — the next cost_update
 *   reflects the post-compaction state via the same subtraction.
 *
 * The caller is responsible for writing the returned frame to the
 * wire. All methods are synchronous; file IO is best-effort and uses
 * `readFileSync` against small fixture-shaped paths (CLAUDE.md,
 * agent/skill manifests). Sub-millisecond on the first call, cache-hit
 * thereafter.
 */
export class ContextBreakdownEmitter {
  private readonly sessionId: string;
  private readonly homeDir: string;
  private readonly cwd: string;
  private readonly settings: ClaudeCodeSettings;

  private staticEstimates: StaticCategoryEstimates | null = null;
  private contextMax: number = DEFAULT_CONTEXT_MAX;
  private calibrationRatio: number = 1.0;
  private hasCalibrated: boolean = false;
  private userMessageTokenAccumulator: number = 0;
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
   * Accumulate a user-submitted message's token count for calibration.
   * Called from `SessionManager.handleUserMessage` on every live
   * submit. Empty strings contribute 0 (no-op).
   */
  onUserMessageSubmitted(text: string): void {
    if (text.length === 0) return;
    this.userMessageTokenAccumulator += countTokens(text);
  }

  /**
   * Recompute and return the updated frame. Calibrates against
   * observed truth on the first call that has user-message anchor
   * data. Returns `null` if the emitter has not been initialized
   * (no session_init yet — defensive; should not occur in practice).
   */
  onCostUpdate(
    usage: Record<string, unknown>,
    modelUsage?: Record<string, unknown>,
  ): ContextBreakdown | null {
    if (!this.staticEstimates) return null;

    this.contextMax = extractContextMax(modelUsage);
    const observedInput = extractObservedInputTokens(usage);

    if (!this.hasCalibrated && this.userMessageTokenAccumulator > 0) {
      this.calibrationRatio = computeCalibrationRatio(
        observedInput,
        staticTotal(this.staticEstimates),
        this.userMessageTokenAccumulator,
      );
      this.hasCalibrated = true;
    }

    const calibratedSum =
      staticTotal(this.staticEstimates) * this.calibrationRatio;
    const messagesTokens = computeMessagesTokens(observedInput, calibratedSum);

    return this.buildCurrentFrame(messagesTokens);
  }

  /**
   * Currently a no-op. After compaction, the next `cost_update`
   * arrives with a reduced `usage.input_tokens` total reflecting the
   * post-compact context window; the messages-by-subtraction
   * arithmetic in {@link onCostUpdate} surfaces the new `messages_tokens`
   * automatically. If post-compact drift becomes a problem in
   * practice, this is where to reset {@link hasCalibrated} so the
   * next cost_update re-anchors the ratio.
   */
  onCompactBoundary(): void {
    // Intentionally empty; see method docstring.
  }

  /** Diagnostic accessor. Exposed for tests; not consumed elsewhere. */
  get calibrationRatioForTests(): number {
    return this.calibrationRatio;
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
      calibrationRatio: this.calibrationRatio,
      messagesTokens,
      autocompactEnabled: this.settings.autoCompactEnabled,
      autocompactBufferTokens: AUTOCOMPACT_BUFFER_DEFAULT_TOKENS,
    });
  }
}
