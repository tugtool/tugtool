import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClaudeCodeSettings } from "../claude-code-settings.ts";
import {
  AUTOCOMPACT_BUFFER_DEFAULT_TOKENS,
  buildContextBreakdownFrame,
  computeCalibrationRatio,
  computeMessagesTokens,
  computeStaticCategories,
  ContextBreakdownEmitter,
  DEFAULT_CONTEXT_MAX,
  extractContextMax,
  extractObservedInputTokens,
  staticTotal,
  SYSTEM_PROMPT_DEFAULT_TOKENS,
  tokenizeFileCached,
  TOOL_SCHEMA_DEFAULT_TOKENS,
} from "../context-breakdown.ts";

let scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "tugcode-ctx-"));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  scratchDirs = [];
});

// ---- tokenizeFileCached --------------------------------------------------

describe("tokenizeFileCached", () => {
  test("returns 0 for a missing file", () => {
    const cache = new Map();
    expect(tokenizeFileCached("/no/such/path/here.md", cache)).toBe(0);
    // Cache must not be poisoned with a miss entry.
    expect(cache.size).toBe(0);
  });

  test("tokenizes a present file and caches the result", () => {
    const dir = scratch();
    const path = join(dir, "doc.md");
    writeFileSync(path, "hello world this is a test\n".repeat(40));
    const cache = new Map();
    const t1 = tokenizeFileCached(path, cache);
    expect(t1).toBeGreaterThan(0);
    expect(cache.size).toBe(1);
    // Second call returns cached value without re-reading.
    const t2 = tokenizeFileCached(path, cache);
    expect(t2).toBe(t1);
  });

  test("invalidates the cache when the file's mtime changes", () => {
    const dir = scratch();
    const path = join(dir, "doc.md");
    writeFileSync(path, "first version of the content\n");
    const cache = new Map();
    const t1 = tokenizeFileCached(path, cache);
    // Rewrite with much larger content + bump mtime to a future value.
    writeFileSync(path, "second version of content ".repeat(100));
    const future = new Date(Date.now() + 60_000);
    utimesSync(path, future, future);
    const t2 = tokenizeFileCached(path, cache);
    expect(t2).toBeGreaterThan(t1);
  });
});

// ---- computeStaticCategories --------------------------------------------

describe("computeStaticCategories", () => {
  test("system_prompt and system_tools follow the documented heuristics", () => {
    const dir = scratch();
    const result = computeStaticCategories(
      { tools: ["Read", "Bash", "Edit"], agents: [], skills: [], plugins: [] },
      { homeDir: dir, cwd: dir, cache: new Map() },
    );
    expect(result.system_prompt).toBe(SYSTEM_PROMPT_DEFAULT_TOKENS);
    expect(result.system_tools).toBe(3 * TOOL_SCHEMA_DEFAULT_TOKENS);
  });

  test("custom_agents reads ~/.claude/agents/<name>.md", () => {
    const home = scratch();
    mkdirSync(join(home, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "agents", "reviewer-agent.md"),
      "You are a code reviewer who checks for clarity ".repeat(50),
    );
    const result = computeStaticCategories(
      {
        tools: [],
        agents: ["reviewer-agent", "absent-agent"],
        skills: [],
        plugins: [],
      },
      { homeDir: home, cwd: scratch(), cache: new Map() },
    );
    // Present file contributes tokens; absent agent contributes 0.
    expect(result.custom_agents).toBeGreaterThan(0);
  });

  test("memory_files sums ~/.claude/CLAUDE.md + cwd/CLAUDE.md", () => {
    const home = scratch();
    const cwd = scratch();
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "CLAUDE.md"),
      "home-level memory content here ".repeat(30),
    );
    writeFileSync(
      join(cwd, "CLAUDE.md"),
      "project-level memory content here ".repeat(30),
    );
    const result = computeStaticCategories(
      { tools: [], agents: [], skills: [], plugins: [] },
      { homeDir: home, cwd, cache: new Map() },
    );
    // Sum of both files; each contributes >0.
    expect(result.memory_files).toBeGreaterThan(0);
  });

  test("memory_files = 0 when neither file exists", () => {
    const home = scratch();
    const cwd = scratch();
    const result = computeStaticCategories(
      { tools: [], agents: [], skills: [], plugins: [] },
      { homeDir: home, cwd, cache: new Map() },
    );
    expect(result.memory_files).toBe(0);
  });

  test("skills reads ~/.claude/skills/<name>/SKILL.md", () => {
    const home = scratch();
    mkdirSync(join(home, ".claude", "skills", "plan"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "skills", "plan", "SKILL.md"),
      "The plan skill helps you build implementation plans ".repeat(40),
    );
    const result = computeStaticCategories(
      { tools: [], agents: [], skills: ["plan", "absent-skill"], plugins: [] },
      { homeDir: home, cwd: scratch(), cache: new Map() },
    );
    expect(result.skills).toBeGreaterThan(0);
  });

  test("non-string entries in agents/skills are skipped", () => {
    // Defensive: SDK init carries `string[]` but we accept `unknown[]`
    // at the type boundary. Non-strings must not crash.
    const home = scratch();
    const result = computeStaticCategories(
      {
        tools: [],
        agents: [42, null, { weird: true }, "still-absent"],
        skills: [true, "still-absent-skill"],
        plugins: [],
      },
      { homeDir: home, cwd: scratch(), cache: new Map() },
    );
    expect(result.custom_agents).toBe(0);
    expect(result.skills).toBe(0);
  });
});

// ---- staticTotal ----------------------------------------------------------

describe("staticTotal", () => {
  test("sums the five static fields", () => {
    expect(
      staticTotal({
        system_prompt: 1000,
        system_tools: 500,
        custom_agents: 200,
        memory_files: 50,
        skills: 250,
      }),
    ).toBe(2000);
  });
});

// ---- computeCalibrationRatio ---------------------------------------------

describe("computeCalibrationRatio", () => {
  test("returns 1.0 when no user message anchor data is available", () => {
    expect(computeCalibrationRatio(10_000, 8_000, 0)).toBe(1.0);
  });

  test("computes observed / (static + user) when anchored", () => {
    // 10100 / (8000 + 100) = 10100 / 8100 = 1.2469...
    const ratio = computeCalibrationRatio(10_100, 8_000, 100);
    expect(ratio).toBeCloseTo(10_100 / 8_100, 4);
  });

  test("matches the spike benchmark (~1.005 against natural-language anchor)", () => {
    // Mirrors the drift numbers from the spike companion appendix:
    // local under-counts by ~0.5% on prose-shaped content. ratio ~1.005.
    const local = 751;
    const apiTruth = 755;
    const ratio = computeCalibrationRatio(apiTruth, local, 0.0001);
    // user-message-anchor of ~0 lets the ratio collapse to api/local.
    expect(ratio).toBeCloseTo(apiTruth / local, 3);
  });

  test("clamps extreme drift to 1.0 (defensive)", () => {
    // observed wildly larger than estimate → clamp.
    expect(computeCalibrationRatio(1_000_000, 100, 50)).toBe(1.0);
    // observed wildly smaller → clamp.
    expect(computeCalibrationRatio(10, 8_000, 100)).toBe(1.0);
  });

  test("handles degenerate inputs (negative, NaN, Infinity)", () => {
    expect(computeCalibrationRatio(NaN, 100, 50)).toBe(1.0);
    expect(computeCalibrationRatio(100, NaN, 50)).toBe(1.0);
    // Negative divisor → divisor <= 0 short circuit.
    expect(computeCalibrationRatio(100, -100, 50)).toBe(1.0);
  });
});

// ---- computeMessagesTokens -----------------------------------------------

describe("computeMessagesTokens", () => {
  test("subtracts the calibrated static sum from observed input", () => {
    expect(computeMessagesTokens(10_000, 8_000)).toBe(2_000);
  });

  test("clamps to 0 when static estimate exceeds observed", () => {
    expect(computeMessagesTokens(100, 500)).toBe(0);
  });

  test("rounds fractional inputs", () => {
    // 10_000 - 7_999.6 = 2000.4 → 2000
    expect(computeMessagesTokens(10_000, 7_999.6)).toBe(2_000);
  });
});

// ---- extractObservedInputTokens / extractContextMax ----------------------

describe("extractObservedInputTokens", () => {
  test("sums input + cache_read + cache_creation", () => {
    expect(
      extractObservedInputTokens({
        input_tokens: 1000,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 200,
      }),
    ).toBe(1700);
  });

  test("ignores missing/non-numeric fields", () => {
    expect(extractObservedInputTokens({})).toBe(0);
    expect(
      extractObservedInputTokens({
        input_tokens: "1000",
        cache_read_input_tokens: null,
      }),
    ).toBe(0);
  });
});

describe("extractContextMax", () => {
  test("reads contextWindow from the first model in modelUsage", () => {
    expect(
      extractContextMax({
        "claude-sonnet-4-5": { contextWindow: 1_000_000 },
      }),
    ).toBe(1_000_000);
  });

  test("falls back to DEFAULT_CONTEXT_MAX when modelUsage is undefined", () => {
    expect(extractContextMax(undefined)).toBe(DEFAULT_CONTEXT_MAX);
  });

  test("falls back to DEFAULT_CONTEXT_MAX when no model has a contextWindow", () => {
    expect(extractContextMax({ foo: { other: 1 } })).toBe(DEFAULT_CONTEXT_MAX);
  });
});

// ---- buildContextBreakdownFrame ------------------------------------------

describe("buildContextBreakdownFrame", () => {
  const baseStatics = {
    system_prompt: 3_000,
    system_tools: 5_000,
    custom_agents: 2_000,
    memory_files: 500,
    skills: 1_000,
  };

  test("scales static categories by calibrationRatio", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "s1",
      contextMax: 200_000,
      staticEstimates: baseStatics,
      calibrationRatio: 1.10,
      messagesTokens: 12_345,
      autocompactEnabled: false,
    });
    const findCat = (id: string) =>
      frame.categories.find((c) => c.id === id)!;
    expect(findCat("system_prompt").tokens).toBe(Math.round(3_000 * 1.10));
    expect(findCat("system_tools").tokens).toBe(Math.round(5_000 * 1.10));
    expect(findCat("custom_agents").tokens).toBe(Math.round(2_000 * 1.10));
    expect(findCat("memory_files").tokens).toBe(Math.round(500 * 1.10));
    expect(findCat("skills").tokens).toBe(Math.round(1_000 * 1.10));
  });

  test("messages tokens pass through unmodified by calibration ratio", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "s1",
      contextMax: 200_000,
      staticEstimates: baseStatics,
      calibrationRatio: 1.50,
      messagesTokens: 9_999,
      autocompactEnabled: false,
    });
    const messages = frame.categories.find((c) => c.id === "messages")!;
    expect(messages.tokens).toBe(9_999);
  });

  test("omits autocompact_buffer when the setting is disabled", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "s1",
      contextMax: 200_000,
      staticEstimates: baseStatics,
      calibrationRatio: 1.0,
      messagesTokens: 1_000,
      autocompactEnabled: false,
    });
    expect(
      frame.categories.find((c) => c.id === "autocompact_buffer"),
    ).toBeUndefined();
  });

  test("includes autocompact_buffer with default reserved tokens when enabled", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "s1",
      contextMax: 200_000,
      staticEstimates: baseStatics,
      calibrationRatio: 1.0,
      messagesTokens: 1_000,
      autocompactEnabled: true,
    });
    const buf = frame.categories.find((c) => c.id === "autocompact_buffer")!;
    expect(buf.tokens).toBe(AUTOCOMPACT_BUFFER_DEFAULT_TOKENS);
  });

  test("never emits an mcp_tools category", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "s1",
      contextMax: 200_000,
      staticEstimates: baseStatics,
      calibrationRatio: 1.0,
      messagesTokens: 1_000,
      autocompactEnabled: true,
    });
    // The category id union excludes `mcp_tools`; this test pins the
    // out-of-scope-MCP invariant at the frame-shape level too.
    for (const c of frame.categories) {
      expect(c.id).not.toBe("mcp_tools");
    }
  });

  test("wire shape carries type, tug_session_id, context_max, ipc_version", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "sess-42",
      contextMax: 1_000_000,
      staticEstimates: baseStatics,
      calibrationRatio: 1.0,
      messagesTokens: 0,
      autocompactEnabled: false,
    });
    expect(frame.type).toBe("context_breakdown");
    expect(frame.tug_session_id).toBe("sess-42");
    expect(frame.context_max).toBe(1_000_000);
    expect(frame.ipc_version).toBe(2);
  });
});

// ---- ContextBreakdownEmitter (lifecycle) ---------------------------------

describe("ContextBreakdownEmitter", () => {
  const settingsOff: ClaudeCodeSettings = { autoCompactEnabled: false };
  const settingsOn: ClaudeCodeSettings = { autoCompactEnabled: true };

  function fresh(settings: ClaudeCodeSettings): {
    emitter: ContextBreakdownEmitter;
    home: string;
    cwd: string;
  } {
    const home = scratch();
    const cwd = scratch();
    const emitter = new ContextBreakdownEmitter({
      sessionId: "test-session",
      homeDir: home,
      cwd,
      settings,
    });
    return { emitter, home, cwd };
  }

  test("onSessionInit returns the initial frame with messages_tokens = 0", () => {
    const { emitter } = fresh(settingsOff);
    const frame = emitter.onSessionInit({
      tools: ["Read", "Bash"],
      agents: [],
      skills: [],
      plugins: [],
    });
    expect(frame.type).toBe("context_breakdown");
    expect(frame.tug_session_id).toBe("test-session");
    const messages = frame.categories.find((c) => c.id === "messages")!;
    expect(messages.tokens).toBe(0);
  });

  test("onCostUpdate before onSessionInit returns null (defensive)", () => {
    const { emitter } = fresh(settingsOff);
    const frame = emitter.onCostUpdate({ input_tokens: 100 });
    expect(frame).toBeNull();
  });

  test("onCostUpdate without a user-message anchor leaves ratio at 1.0", () => {
    const { emitter } = fresh(settingsOff);
    emitter.onSessionInit({ tools: [], agents: [], skills: [], plugins: [] });
    // Observed input matches the heuristic static_prompt directly;
    // without a user-message anchor the ratio cannot calibrate.
    emitter.onCostUpdate({ input_tokens: 5_000 });
    expect(emitter.calibrationRatioForTests).toBe(1.0);
  });

  test("calibrates on first cost_update with anchor data", () => {
    const { emitter } = fresh(settingsOff);
    emitter.onSessionInit({ tools: [], agents: [], skills: [], plugins: [] });
    // staticTotal = SYSTEM_PROMPT_DEFAULT_TOKENS (no tools, no files)
    emitter.onUserMessageSubmitted("hello, this is a user message");
    // observed = static * 1.05 + user_tokens (roughly)
    const observed = Math.round(SYSTEM_PROMPT_DEFAULT_TOKENS * 1.05) + 20;
    emitter.onCostUpdate({ input_tokens: observed });
    expect(emitter.calibrationRatioForTests).not.toBe(1.0);
    expect(emitter.calibrationRatioForTests).toBeGreaterThan(1.0);
    expect(emitter.calibrationRatioForTests).toBeLessThan(1.10);
  });

  test("hasCalibrated latches — subsequent cost_updates reuse the ratio", () => {
    const { emitter } = fresh(settingsOff);
    emitter.onSessionInit({ tools: [], agents: [], skills: [], plugins: [] });
    emitter.onUserMessageSubmitted("first message");
    emitter.onCostUpdate({ input_tokens: 4_000 });
    const firstRatio = emitter.calibrationRatioForTests;

    // Submit more messages, fire another cost_update with very
    // different totals — ratio must stay pinned.
    emitter.onUserMessageSubmitted("second longer message ".repeat(50));
    emitter.onCostUpdate({ input_tokens: 50_000 });
    expect(emitter.calibrationRatioForTests).toBe(firstRatio);
  });

  test("messages_tokens grows turn-over-turn for steady-state operation", () => {
    const { emitter } = fresh(settingsOff);
    emitter.onSessionInit({ tools: [], agents: [], skills: [], plugins: [] });
    emitter.onUserMessageSubmitted("hello");
    const t1 = emitter.onCostUpdate({ input_tokens: 5_000 })!;
    const t2 = emitter.onCostUpdate({ input_tokens: 12_000 })!;
    const t3 = emitter.onCostUpdate({ input_tokens: 25_000 })!;
    const msgs = (f: typeof t1) =>
      f.categories.find((c) => c.id === "messages")!.tokens;
    expect(msgs(t1)).toBeLessThan(msgs(t2));
    expect(msgs(t2)).toBeLessThan(msgs(t3));
  });

  test("autocompact-on emits the autocompact_buffer slice", () => {
    const { emitter } = fresh(settingsOn);
    const frame = emitter.onSessionInit({
      tools: [],
      agents: [],
      skills: [],
      plugins: [],
    });
    const buf = frame.categories.find((c) => c.id === "autocompact_buffer");
    expect(buf).toBeDefined();
    expect(buf!.tokens).toBe(AUTOCOMPACT_BUFFER_DEFAULT_TOKENS);
  });

  test("autocompact-off omits the autocompact_buffer slice", () => {
    const { emitter } = fresh(settingsOff);
    const frame = emitter.onSessionInit({
      tools: [],
      agents: [],
      skills: [],
      plugins: [],
    });
    expect(
      frame.categories.find((c) => c.id === "autocompact_buffer"),
    ).toBeUndefined();
  });

  test("onCompactBoundary is a no-op (next cost_update reflects the new state)", () => {
    const { emitter } = fresh(settingsOff);
    emitter.onSessionInit({ tools: [], agents: [], skills: [], plugins: [] });
    emitter.onUserMessageSubmitted("hello");
    emitter.onCostUpdate({ input_tokens: 100_000 });
    const ratioBefore = emitter.calibrationRatioForTests;
    emitter.onCompactBoundary();
    // No state mutation; the next cost_update handles the reset via
    // the messages-by-subtraction arithmetic.
    expect(emitter.calibrationRatioForTests).toBe(ratioBefore);
  });

  test("modelUsage contextWindow is reflected in subsequent frames", () => {
    const { emitter } = fresh(settingsOff);
    emitter.onSessionInit({ tools: [], agents: [], skills: [], plugins: [] });
    const f = emitter.onCostUpdate(
      { input_tokens: 1_000 },
      { "claude-sonnet-4-5": { contextWindow: 1_000_000 } },
    )!;
    expect(f.context_max).toBe(1_000_000);
  });

  test("empty user message text is a no-op", () => {
    const { emitter } = fresh(settingsOff);
    emitter.onSessionInit({ tools: [], agents: [], skills: [], plugins: [] });
    emitter.onUserMessageSubmitted("");
    emitter.onCostUpdate({ input_tokens: 5_000 });
    expect(emitter.calibrationRatioForTests).toBe(1.0);
  });
});
