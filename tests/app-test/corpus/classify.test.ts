/**
 * classify.test.ts — pure-logic coverage for the corpus classifier and
 * the harvester's selection / dry-run behavior. No app, no DOM.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accumulateLine,
  classifySize,
  createStatsAccumulator,
  percentile,
  primaryShape,
  shapeTags,
  TYPICAL_MAX_BYTES,
  WHALE_MIN_BYTES,
} from "./classify";
import { harvest, liveSessionIds, type Manifest } from "./harvest";

function statsOf(lines: string[]) {
  const acc = createStatsAccumulator();
  for (const line of lines) accumulateLine(acc, line);
  return acc.stats;
}

const stamp = {
  parentUuid: null,
  isSidechain: false,
  userType: "external",
  cwd: "/tmp/project",
  sessionId: "s",
  version: "2.1.175",
  uuid: "u",
  timestamp: "2026-06-10T10:00:00.000Z",
};

function userLine(content: unknown): string {
  return JSON.stringify({
    ...stamp,
    type: "user",
    message: { role: "user", content },
  });
}

function assistantLine(content: unknown[]): string {
  return JSON.stringify({
    ...stamp,
    type: "assistant",
    message: { role: "assistant", content },
  });
}

describe("corpus classifier", () => {
  test("counts turns with the scanner's submission predicate", () => {
    const stats = statsOf([
      userLine("a real prompt"),
      userLine([{ type: "text", text: "typed prompt" }]),
      userLine([{ type: "tool_result", tool_use_id: "t1", content: "out" }]),
      assistantLine([{ type: "text", text: "reply" }]),
    ]);
    expect(stats.turns).toBe(2);
  });

  test("builds the content-block histogram and tracks the largest block", () => {
    const bigInput = { command: "x".repeat(5_000) };
    const stats = statsOf([
      userLine("prompt"),
      assistantLine([
        { type: "thinking", thinking: "hmm".repeat(10) },
        { type: "text", text: "short" },
        { type: "tool_use", id: "t1", name: "Bash", input: bigInput },
      ]),
      userLine([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
    ]);
    expect(stats.blocks.thinking).toBe(1);
    expect(stats.blocks.tool_use).toBe(1);
    expect(stats.blocks.tool_result).toBe(1);
    // string user content counts as one text block alongside the reply text
    expect(stats.blocks.text).toBe(2);
    expect(stats.largestBlockBytes).toBeGreaterThanOrEqual(5_000);
    // submission + thinking + text + 2×tool_use + 2×tool_result
    expect(stats.wireMessageEstimate).toBe(1 + 1 + 1 + 2 + 2);
  });

  test("skips malformed and torn lines without losing the rest", () => {
    const stats = statsOf([
      userLine("first"),
      '{"type":"user","message":{"role":"user","content":"torn final li',
      "",
      "not json at all",
      userLine("second"),
    ]);
    expect(stats.turns).toBe(2);
    expect(stats.lines).toBe(4); // empty line ignored entirely
    expect(stats.parsedLines).toBe(2);
  });

  test("records the first timestamp as createdAtMs", () => {
    const stats = statsOf([userLine("x")]);
    expect(stats.createdAtMs).toBe(Date.parse("2026-06-10T10:00:00.000Z"));
  });

  test("classifies size tiers at the documented boundaries", () => {
    expect(classifySize(17_000)).toBe("typical");
    expect(classifySize(TYPICAL_MAX_BYTES - 1)).toBe("typical");
    expect(classifySize(TYPICAL_MAX_BYTES)).toBe("heavy");
    expect(classifySize(WHALE_MIN_BYTES - 1)).toBe("heavy");
    expect(classifySize(WHALE_MIN_BYTES)).toBe("whale");
    expect(classifySize(626_000_000)).toBe("whale");
  });

  test("tags tool-heavy and thinking-heavy from the histogram", () => {
    // Per-turn shape of the motivating real session (~20 tool calls
    // and ~10 thinking blocks per committed cycle): tools and thinking
    // both clear their thresholds with user prompts counted as text.
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) {
      lines.push(userLine(`prompt ${i}`));
      const blocks: unknown[] = [];
      for (let j = 0; j < 4; j++) {
        blocks.push({ type: "thinking", thinking: "consider" });
      }
      for (let j = 0; j < 8; j++) {
        blocks.push({ type: "tool_use", id: `t${i}-${j}`, name: "Bash", input: {} });
      }
      blocks.push({ type: "text", text: "done" });
      lines.push(assistantLine(blocks));
      lines.push(
        userLine(
          Array.from({ length: 8 }, (_, j) => ({
            type: "tool_result",
            tool_use_id: `t${i}-${j}`,
            content: "",
          })),
        ),
      );
    }
    const stats = statsOf(lines);
    const tags = shapeTags(stats);
    expect(tags).toContain("tool-heavy");
    expect(tags).toContain("thinking-heavy");
    expect(tags).not.toContain("prose");
    expect(primaryShape(tags)).toBe("tool-heavy");
  });

  test("falls back to prose and flags image-bearing", () => {
    const proseStats = statsOf([
      userLine("q"),
      assistantLine([{ type: "text", text: "a" }]),
    ]);
    expect(shapeTags(proseStats)).toEqual(["prose"]);

    const imageStats = statsOf([
      userLine([
        { type: "text", text: "look" },
        { type: "image", source: { type: "base64", data: "aGk=" } },
      ]),
      assistantLine([{ type: "text", text: "seen" }]),
    ]);
    const tags = shapeTags(imageStats);
    expect(tags).toContain("image-bearing");
    expect(tags).toContain("prose");
    expect(primaryShape(tags)).toBe("image-bearing");
  });

  test("percentile uses nearest-rank", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10], 99)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
});

describe("corpus harvest", () => {
  const roots: string[] = [];

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "corpus-harvest-test-"));
    roots.push(root);
    return root;
  }

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  interface FixtureSession {
    id: string;
    project: string;
    lines: string[];
  }

  function seed(root: string, sessions: FixtureSession[]): string {
    const projectsRoot = join(root, "projects");
    for (const s of sessions) {
      const dir = join(projectsRoot, s.project);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${s.id}.jsonl`), s.lines.join("\n"));
    }
    return projectsRoot;
  }

  function proseSession(id: string, project: string): FixtureSession {
    return {
      id,
      project,
      lines: [userLine("hi"), assistantLine([{ type: "text", text: "yo" }])],
    };
  }

  test("dry-run writes a manifest and materializes nothing", async () => {
    const root = tempRoot();
    const projectsRoot = seed(root, [
      proseSession("aaaa1111-0000-0000-0000-000000000001", "-tmp-proj-a"),
      proseSession("bbbb2222-0000-0000-0000-000000000002", "-tmp-proj-b"),
    ]);
    const outDir = join(root, "out");
    const manifest = await harvest({
      projectsRoot,
      sessionsDir: join(root, "no-sessions"),
      outDir,
      pins: [],
      dryRun: true,
    });
    expect(manifest.dryRun).toBe(true);
    expect(manifest.survey.sessions).toBe(2);
    expect(manifest.selected.length).toBeGreaterThan(0);
    for (const s of manifest.selected) expect(s.snapshotPath).toBeNull();
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(outDir, "snapshots"))).toBe(false);
    const onDisk = JSON.parse(
      readFileSync(join(outDir, "manifest.json"), "utf8"),
    ) as Manifest;
    expect(onDisk.survey.sessions).toBe(2);
  });

  test("harvest copies the selected snapshots and honors pins", async () => {
    const root = tempRoot();
    const pinned = proseSession(
      "763cd1d8-0000-0000-0000-000000000003",
      "-tmp-proj-pin",
    );
    const projectsRoot = seed(root, [
      proseSession("aaaa1111-0000-0000-0000-000000000001", "-tmp-proj-a"),
      pinned,
    ]);
    const outDir = join(root, "out");
    const manifest = await harvest({
      projectsRoot,
      sessionsDir: join(root, "no-sessions"),
      outDir,
      pins: ["763cd1d8"],
    });
    const pin = manifest.selected.find((s) => s.id === pinned.id);
    expect(pin).toBeDefined();
    expect(pin!.pinned).toBe(true);
    expect(pin!.strategy).toBe("copy");
    expect(pin!.snapshotPath).not.toBeNull();
    expect(existsSync(pin!.snapshotPath!)).toBe(true);
    expect(readFileSync(pin!.snapshotPath!, "utf8")).toBe(
      pinned.lines.join("\n"),
    );
  });

  test("skips sessions held by a live terminal", async () => {
    const root = tempRoot();
    const liveId = "cccc3333-0000-0000-0000-000000000004";
    const projectsRoot = seed(root, [
      proseSession(liveId, "-tmp-proj-live"),
      proseSession("dddd4444-0000-0000-0000-000000000005", "-tmp-proj-d"),
    ]);
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "12345.json"),
      JSON.stringify({ pid: 12345, sessionId: liveId, kind: "interactive" }),
    );
    writeFileSync(join(sessionsDir, "torn.json"), '{"pid": 99');

    expect(liveSessionIds(sessionsDir).has(liveId)).toBe(true);

    const manifest = await harvest({
      projectsRoot,
      sessionsDir,
      outDir: join(root, "out"),
      pins: [],
      dryRun: true,
    });
    expect(manifest.survey.sessions).toBe(1);
    expect(manifest.survey.skippedLive).toBe(1);
    expect(manifest.sessions.some((s) => s.id === liveId)).toBe(false);
  });

  test("excludes harness-seeded project dirs from the survey", async () => {
    const root = tempRoot();
    const projectsRoot = seed(root, [
      proseSession("aaaa1111-0000-0000-0000-000000000008", "-tmp-proj-real"),
      proseSession(
        "bbbb2222-0000-0000-0000-000000000009",
        "-private-var-folders-x-T-at0183-rows-1k-AbCdEf",
      ),
      proseSession(
        "cccc3333-0000-0000-0000-00000000000a",
        "-tmp-hmr-mid-stream-test-12345",
      ),
    ]);
    const manifest = await harvest({
      projectsRoot,
      sessionsDir: join(root, "no-sessions"),
      outDir: join(root, "out"),
      pins: [],
      dryRun: true,
    });
    expect(manifest.survey.sessions).toBe(1);
    expect(manifest.survey.skippedSeeded).toBe(2);
    expect(manifest.sessions[0].projectDir).toBe("-tmp-proj-real");
  });

  test("selects the newest representative per class × shape", async () => {
    const root = tempRoot();
    const older = proseSession(
      "eeee5555-0000-0000-0000-000000000006",
      "-tmp-proj-e",
    );
    const newer = proseSession(
      "ffff6666-0000-0000-0000-000000000007",
      "-tmp-proj-f",
    );
    const projectsRoot = seed(root, [older, newer]);
    const olderPath = join(projectsRoot, older.project, `${older.id}.jsonl`);
    const past = new Date(Date.now() - 86_400_000);
    const { utimesSync } = await import("node:fs");
    utimesSync(olderPath, past, past);

    const manifest = await harvest({
      projectsRoot,
      sessionsDir: join(root, "no-sessions"),
      outDir: join(root, "out"),
      pins: [],
      dryRun: true,
    });
    const typicalProse = manifest.selected.filter(
      (s) => s.class === "typical" && s.primaryShape === "prose" && !s.largest,
    );
    expect(typicalProse.length).toBe(1);
    expect(typicalProse[0].id).toBe(newer.id);
  });

  test("always selects the single largest session in the population", async () => {
    const root = tempRoot();
    const monster: FixtureSession = {
      id: "9999aaaa-0000-0000-0000-00000000000b",
      project: "-tmp-proj-monster",
      lines: [
        userLine("start"),
        ...Array.from({ length: 200 }, (_, i) =>
          assistantLine([{ type: "text", text: `bulk ${i} ${"x".repeat(500)}` }]),
        ),
      ],
    };
    const projectsRoot = seed(root, [
      proseSession("aaaa1111-0000-0000-0000-00000000000c", "-tmp-proj-small"),
      monster,
    ]);
    const manifest = await harvest({
      projectsRoot,
      sessionsDir: join(root, "no-sessions"),
      outDir: join(root, "out"),
      pins: [],
      dryRun: true,
    });
    const big = manifest.selected.find((s) => s.id === monster.id);
    expect(big).toBeDefined();
    expect(big!.largest).toBe(true);
  });
});
