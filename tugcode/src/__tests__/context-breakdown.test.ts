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
  computeMessagesTokens,
  computeStaticCategories,
  ContextBreakdownEmitter,
  DEFAULT_CONTEXT_MAX,
  extractContextMax,
  extractObservedInputTokens,
  staticTotal,
  SYSTEM_PROMPT_DEFAULT_TOKENS,
  tokenizeFileCached,
  tokenizeMarkdownDirCached,
  tokenizePluginAgents,
  tokenizePluginSkills,
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
    const t2 = tokenizeFileCached(path, cache);
    expect(t2).toBe(t1);
  });

  test("invalidates the cache when the file's mtime changes", () => {
    const dir = scratch();
    const path = join(dir, "doc.md");
    writeFileSync(path, "first version of the content\n");
    const cache = new Map();
    const t1 = tokenizeFileCached(path, cache);
    writeFileSync(path, "second version of content ".repeat(100));
    const future = new Date(Date.now() + 60_000);
    utimesSync(path, future, future);
    const t2 = tokenizeFileCached(path, cache);
    expect(t2).toBeGreaterThan(t1);
  });
});

// ---- tokenizeMarkdownDirCached ------------------------------------------

describe("tokenizeMarkdownDirCached", () => {
  test("returns 0 for a missing directory", () => {
    expect(tokenizeMarkdownDirCached("/no/such/dir/here", new Map())).toBe(0);
  });

  test("sums *.md files in the directory", () => {
    const dir = scratch();
    writeFileSync(join(dir, "MEMORY.md"), "memory index entry ".repeat(30));
    writeFileSync(join(dir, "feedback_one.md"), "feedback content ".repeat(40));
    writeFileSync(join(dir, "user_thing.md"), "user data ".repeat(50));
    writeFileSync(join(dir, "ignored.txt"), "not a markdown file");
    const total = tokenizeMarkdownDirCached(dir, new Map());
    expect(total).toBeGreaterThan(0);
    // Same call hits the cache; same result.
    expect(tokenizeMarkdownDirCached(dir, new Map(
      Array.from(new Map().entries()),
    ))).toBe(total);
  });

  test("returns 0 for an empty directory", () => {
    const dir = scratch();
    expect(tokenizeMarkdownDirCached(dir, new Map())).toBe(0);
  });
});

// ---- tokenizePluginAgents / tokenizePluginSkills ------------------------

describe("tokenizePluginAgents / tokenizePluginSkills", () => {
  test("plugin with agents/ + skills/ subdirs contributes from both", () => {
    const plugin = scratch();
    mkdirSync(join(plugin, "agents"), { recursive: true });
    mkdirSync(join(plugin, "skills", "plan"), { recursive: true });
    mkdirSync(join(plugin, "skills", "merge"), { recursive: true });
    writeFileSync(
      join(plugin, "agents", "coder-agent.md"),
      "You are a coder ".repeat(40),
    );
    writeFileSync(
      join(plugin, "agents", "reviewer-agent.md"),
      "You are a reviewer ".repeat(40),
    );
    writeFileSync(
      join(plugin, "skills", "plan", "SKILL.md"),
      "Plan skill body ".repeat(50),
    );
    writeFileSync(
      join(plugin, "skills", "merge", "SKILL.md"),
      "Merge skill body ".repeat(50),
    );
    const cache = new Map();
    expect(tokenizePluginAgents(plugin, cache)).toBeGreaterThan(0);
    expect(tokenizePluginSkills(plugin, cache)).toBeGreaterThan(0);
  });

  test("plugin with missing subdirs contributes 0 (best-effort)", () => {
    const plugin = scratch();
    // No `agents/` or `skills/` created.
    expect(tokenizePluginAgents(plugin, new Map())).toBe(0);
    expect(tokenizePluginSkills(plugin, new Map())).toBe(0);
  });

  test("skill subdir without SKILL.md contributes 0", () => {
    const plugin = scratch();
    mkdirSync(join(plugin, "skills", "empty-skill"), { recursive: true });
    expect(tokenizePluginSkills(plugin, new Map())).toBe(0);
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
    expect(result.custom_agents).toBeGreaterThan(0);
  });

  test("memory_files sums ~/.claude/CLAUDE.md + cwd/CLAUDE.md + project memory dir", () => {
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
    // Auto-memory directory at ~/.claude/projects/<encoded>/memory/
    const encoded = cwd.replace(/\//g, "-");
    const memoryDir = join(home, ".claude", "projects", encoded, "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, "MEMORY.md"),
      "MEMORY index entry ".repeat(40),
    );
    writeFileSync(
      join(memoryDir, "feedback_one.md"),
      "feedback content here ".repeat(50),
    );
    writeFileSync(
      join(memoryDir, "user_thing.md"),
      "user data ".repeat(60),
    );
    const result = computeStaticCategories(
      { tools: [], agents: [], skills: [], plugins: [] },
      { homeDir: home, cwd, cache: new Map() },
    );
    expect(result.memory_files).toBeGreaterThan(0);
    // Sanity: contributing files should swell the count well past just
    // the cwd/CLAUDE.md contribution alone.
    const cwdOnly = computeStaticCategories(
      { tools: [], agents: [], skills: [], plugins: [] },
      { homeDir: scratch(), cwd, cache: new Map() },
    );
    expect(result.memory_files).toBeGreaterThan(cwdOnly.memory_files);
  });

  test("memory_files = 0 when neither file nor memory dir exists", () => {
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

  test("plugin agents/skills fold into custom_agents/skills", () => {
    const home = scratch();
    const cwd = scratch();
    const plugin = scratch();
    mkdirSync(join(plugin, "agents"), { recursive: true });
    mkdirSync(join(plugin, "skills", "merge"), { recursive: true });
    writeFileSync(
      join(plugin, "agents", "coder-agent.md"),
      "You are a coder ".repeat(60),
    );
    writeFileSync(
      join(plugin, "skills", "merge", "SKILL.md"),
      "Merge skill body ".repeat(60),
    );
    const result = computeStaticCategories(
      {
        tools: [],
        agents: [],
        skills: [],
        plugins: [{ name: "tugplug", path: plugin }],
      },
      { homeDir: home, cwd, cache: new Map() },
    );
    expect(result.custom_agents).toBeGreaterThan(0);
    expect(result.skills).toBeGreaterThan(0);
  });

  test("non-string entries in agents/skills are skipped; plugin without path is skipped", () => {
    const home = scratch();
    const result = computeStaticCategories(
      {
        tools: [],
        agents: [42, null, { weird: true }, "still-absent"],
        skills: [true, "still-absent-skill"],
        plugins: [
          // Plugin object missing `path` — skipped.
          { name: "no-path" },
          // Non-object plugin entry — skipped.
          "string-not-object",
          // `path` of wrong type — skipped.
          { name: "bad-path", path: 42 },
        ],
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

// ---- computeMessagesTokens -----------------------------------------------

describe("computeMessagesTokens", () => {
  test("subtracts the static total from observed input", () => {
    expect(computeMessagesTokens(10_000, 8_000)).toBe(2_000);
  });

  test("clamps to 0 when static estimate exceeds observed", () => {
    expect(computeMessagesTokens(100, 500)).toBe(0);
  });

  test("rounds fractional inputs", () => {
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

  test("static categories pass through unmodified (no calibration)", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "s1",
      contextMax: 200_000,
      staticEstimates: baseStatics,
      messagesTokens: 12_345,
      autocompactEnabled: false,
    });
    const findCat = (id: string) =>
      frame.categories.find((c) => c.id === id)!;
    expect(findCat("system_prompt").tokens).toBe(3_000);
    expect(findCat("system_tools").tokens).toBe(5_000);
    expect(findCat("custom_agents").tokens).toBe(2_000);
    expect(findCat("memory_files").tokens).toBe(500);
    expect(findCat("skills").tokens).toBe(1_000);
  });

  test("messages tokens pass through unmodified", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "s1",
      contextMax: 200_000,
      staticEstimates: baseStatics,
      messagesTokens: 9_999,
      autocompactEnabled: false,
    });
    expect(frame.categories.find((c) => c.id === "messages")!.tokens).toBe(
      9_999,
    );
  });

  test("omits autocompact_buffer when the setting is disabled", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "s1",
      contextMax: 200_000,
      staticEstimates: baseStatics,
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
      messagesTokens: 1_000,
      autocompactEnabled: true,
    });
    for (const c of frame.categories) {
      expect(c.id).not.toBe("mcp_tools");
    }
  });

  test("wire shape carries type, tug_session_id, context_max, ipc_version", () => {
    const frame = buildContextBreakdownFrame({
      sessionId: "sess-42",
      contextMax: 1_000_000,
      staticEstimates: baseStatics,
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
    expect(frame.categories.find((c) => c.id === "messages")!.tokens).toBe(0);
  });

  test("onCostUpdate before onSessionInit returns null (defensive)", () => {
    const { emitter } = fresh(settingsOff);
    expect(emitter.onCostUpdate({ input_tokens: 100 })).toBeNull();
  });

  test("messages_tokens grows turn-over-turn as observed_input grows", () => {
    const { emitter } = fresh(settingsOff);
    emitter.onSessionInit({ tools: [], agents: [], skills: [], plugins: [] });
    const t1 = emitter.onCostUpdate({ input_tokens: 5_000 })!;
    const t2 = emitter.onCostUpdate({ input_tokens: 12_000 })!;
    const t3 = emitter.onCostUpdate({ input_tokens: 25_000 })!;
    const msgs = (f: typeof t1) =>
      f.categories.find((c) => c.id === "messages")!.tokens;
    expect(msgs(t1)).toBeLessThan(msgs(t2));
    expect(msgs(t2)).toBeLessThan(msgs(t3));
  });

  test("resume case: large observed_input on first cost_update does not warp statics", () => {
    // Regression test for the pre-fix calibration-on-resume bug.
    // A resumed session's first cost_update arrives with
    // observed_input including ALL prior history. With the old
    // calibration trick the ratio would scale statics by a too-large
    // factor; with calibration dropped, statics pass through
    // unchanged and messages_tokens absorbs the history correctly.
    const { emitter } = fresh(settingsOff);
    const init = emitter.onSessionInit({
      tools: ["Read"],
      agents: [],
      skills: [],
      plugins: [],
    });
    const staticAtInit = init.categories.find((c) => c.id === "system_prompt")!.tokens;
    // Simulate a resumed-session cost_update with a big observed.
    const f = emitter.onCostUpdate({ input_tokens: 100_000 })!;
    const staticAfter = f.categories.find((c) => c.id === "system_prompt")!.tokens;
    expect(staticAfter).toBe(staticAtInit);
    // Messages absorbs the rest.
    const msgs = f.categories.find((c) => c.id === "messages")!.tokens;
    expect(msgs).toBeGreaterThan(80_000);
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
    emitter.onCostUpdate({ input_tokens: 100_000 });
    // No state to assert on directly; verify subsequent cost_update
    // still produces a frame with the expected shape after the
    // boundary event.
    emitter.onCompactBoundary();
    const f = emitter.onCostUpdate({ input_tokens: 20_000 })!;
    expect(f.type).toBe("context_breakdown");
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
});
