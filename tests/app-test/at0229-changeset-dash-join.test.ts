/**
 * at0229-changeset-dash-join.test.ts — the changeset card's dash Join flow,
 * end-to-end, for the two behaviors that can only be verified in the real
 * browser against real git worktrees (the verbs, the resolution ladder, and the
 * stores are covered by Rust + bun unit tests on real content):
 *
 *   1. **Conflicted preview** — a dash whose committed change overlaps a base
 *      change: clicking Join runs the preview and renders the structured
 *      conflict list (never a dead end).
 *   2. **Clean join, end-to-end** — a dash whose change is disjoint from the
 *      base: Join → the clean-bill preview → Confirm join runs the
 *      `changeset_join` verb, which squash-lands the dash and tears its branch
 *      down (verified against real git).
 *
 * One dev card is opened via real `spawn_session(mode=resume)` on a scratch git
 * repo, so the project is "open" and its `tugdash/*` branches surface as dash
 * entries in the aggregate.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const encodeProjectDir = (absDir: string): string => absDir.replace(/[^A-Za-z0-9-]/g, "-");

function buildFixtureJsonl(cwd: string, sessionId: string): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.105",
    gitBranch: "main",
  };
  const lines = [
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-4000-8000-000000000e01",
      timestamp: "2026-06-17T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    },
    {
      ...base,
      parentUuid: "00000000-0000-4000-8000-000000000e01",
      type: "assistant",
      uuid: "00000000-0000-4000-8000-000000000e02",
      timestamp: "2026-06-17T10:00:01.000Z",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "hi there" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 1200,
          output_tokens: 50,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 8000,
        },
      },
    },
  ];
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function git(dir: string, args: string[]): void {
  const r = Bun.spawnSync(["git", "-C", dir, ...args]);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
}

const SID = "at0229-dev";
const REPO = { dir: "", fixtureDir: "" };

beforeAll(() => {
  if (!SHOULD_RUN) return;
  REPO.dir = realpathSync(mkdtempSync(join(tmpdir(), "at0229-proj-")));
  const d = REPO.dir;
  git(d, ["init", "-q", "-b", "main"]);
  git(d, ["config", "user.email", "t@t"]);
  git(d, ["config", "user.name", "t"]);
  writeFileSync(join(d, "foo.txt"), "base\n");
  writeFileSync(join(d, "shared.txt"), "s\n");
  git(d, ["add", "."]);
  git(d, ["commit", "-q", "-m", "base"]);

  // A CLEAN dash: adds a disjoint new file (no overlap with the base change).
  git(d, ["branch", "tugdash/clean"]);
  git(d, ["config", "branch.tugdash/clean.tugbase", "main"]);
  const cleanWt = join(d, ".tug", "worktrees", "clean");
  git(d, ["worktree", "add", "-q", cleanWt, "tugdash/clean"]);
  writeFileSync(join(cleanWt, "newfile.txt"), "added by the dash\n");
  git(cleanWt, ["add", "."]);
  git(cleanWt, ["commit", "-q", "-m", "add newfile"]);

  // A CONFLICTING dash: changes foo.txt, which the base will also change.
  git(d, ["branch", "tugdash/clash"]);
  git(d, ["config", "branch.tugdash/clash.tugbase", "main"]);
  const clashWt = join(d, ".tug", "worktrees", "clash");
  git(d, ["worktree", "add", "-q", clashWt, "tugdash/clash"]);
  writeFileSync(join(clashWt, "foo.txt"), "branch change\n");
  git(clashWt, ["add", "."]);
  git(clashWt, ["commit", "-q", "-m", "change foo on the dash"]);

  // Base advances foo.txt differently → the clash dash now conflicts.
  writeFileSync(join(d, "foo.txt"), "main change\n");
  git(d, ["commit", "-q", "-am", "change foo on main"]);

  REPO.fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(d));
  mkdirSync(REPO.fixtureDir, { recursive: true });
  writeFileSync(join(REPO.fixtureDir, `${SID}.jsonl`), buildFixtureJsonl(d, SID));
});

afterAll(() => {
  if (REPO.dir !== "" && existsSync(REPO.dir)) rmSync(REPO.dir, { recursive: true, force: true });
  if (REPO.fixtureDir !== "" && existsSync(REPO.fixtureDir)) {
    rmSync(REPO.fixtureDir, { recursive: true, force: true });
  }
});

// The changeset content lives in the Lens `kind: "sessions"` section now.
const SECTION = '.lens-section[data-lens-section="sessions"]';

async function dispatch(app: Awaited<ReturnType<typeof launchTugApp>>, action: string): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction(${JSON.stringify(action)})`,
  );
}

function deckShape() {
  return {
    cards: [
      { id: "B", componentId: "dev", title: "Dev B", closable: true },
    ],
    panes: [
      { id: "p2", position: { x: 780, y: 40 }, size: { width: 680, height: 560 }, cardIds: ["B"], activeCardId: "B", title: "", acceptsFamilies: ["maker"] },
    ],
    activePaneId: "p2",
    hasFocus: true,
  };
}

const dashEntry = (name: string) =>
  `${SECTION} [data-testid="sessions-entry"][data-entry-id="dash:${REPO.dir}:tugdash/${name}"]`;

function branchExists(name: string): boolean {
  const r = Bun.spawnSync(["git", "-C", REPO.dir, "branch", "--list", `tugdash/${name}`]);
  return r.stdout.toString().trim().length > 0;
}

describe.skipIf(!SHOULD_RUN)("AT0229: changeset card — dash Join preview + clean join", () => {
  test(
    "a conflicting dash previews its conflict list; a clean dash joins end-to-end",
    async () => {
      const app = await launchTugApp({ testName: "at0229-changeset-dash-join" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "B" });
        await app.spawnSessionResume("B", { tugSessionId: SID, projectDir: REPO.dir });

        // Open + focus the Lens so the Sessions section (and its dash
        // Join/Confirm responders) mount in the active chain.
        await dispatch(app, "focus-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SECTION)}) !== null &&
           document.querySelector(${JSON.stringify(
             `${SECTION} [data-testid="lens-section-body"]`,
           )}) !== null`,
          { timeoutMs: 10_000 },
        );

        // Both dash entries appear (the project is open via the dev card).
        await app.waitForCondition<boolean>(
          `document.querySelector('${dashEntry("clean")} [data-testid="sessions-dash-join"]') !== null &&
           document.querySelector('${dashEntry("clash")} [data-testid="sessions-dash-join"]') !== null`,
          { timeoutMs: 40_000 },
        );

        // (1) Conflicting dash: Join → the structured conflict list, naming foo.txt.
        await app.click(`${dashEntry("clash")} [data-testid="sessions-dash-join"]`);
        await app.waitForCondition<boolean>(
          `document.querySelector('${dashEntry("clash")} [data-testid="sessions-dash-preview-conflicts"]') !== null`,
          { timeoutMs: 20_000 },
        );
        expect(
          await app.evalJS<boolean>(
            `(document.querySelector('${dashEntry("clash")} [data-testid="sessions-dash-preview-conflicts"]').textContent || "").indexOf("foo.txt") !== -1`,
          ),
          "the conflict list names foo.txt",
        ).toBe(true);

        // (2) Clean dash: Join → clean-bill preview → Confirm → squash-lands and
        // tears down the branch (verified against real git).
        expect(branchExists("clean"), "clean dash branch exists before join").toBe(true);
        await app.click(`${dashEntry("clean")} [data-testid="sessions-dash-join"]`);
        await app.waitForCondition<boolean>(
          `document.querySelector('${dashEntry("clean")} [data-testid="sessions-dash-preview-clean"]') !== null`,
          { timeoutMs: 20_000 },
        );
        await app.click(`${dashEntry("clean")} [data-testid="sessions-dash-confirm-join"]`);

        // The join verb lands and tears the branch down.
        await waitFor(() => !branchExists("clean"), 30_000);
        expect(branchExists("clean"), "clean dash branch gone after join").toBe(false);

        // The squash landed the dash's file on main.
        const landed = Bun.spawnSync(["git", "-C", REPO.dir, "show", "HEAD:newfile.txt"]);
        expect(landed.exitCode, "newfile.txt is on main after the join").toBe(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

/** Poll a predicate off the real filesystem (git state) until true or timeout. */
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("waitFor: predicate did not become true in time");
}
