/**
 * at0227-changeset-card.test.ts — the Changeset card end-to-end over the
 * account-global aggregate CHANGESET_ALL feed (0x24).
 *
 * Drives the REAL pipeline: tugcast's process-level ChangesetAllFeed
 * enumerates the open workspaces, composes each with `git status` + the
 * per-instance sessions.db `file_events` rows for owner grouping, and the
 * card renders one collapsible section per project (auto-expanded on first
 * appearance) holding that project's owner groups. The test seeds real
 * state — untracked files created at the bootstrap repo root plus attribution
 * rows written into the live per-instance sessions.db — and asserts the
 * bootstrap project's owner sections, badges, and unattributed bucket settle
 * from feed frames alone (no synthetic frame injection, no Claude session).
 *
 *   1. **Header** — the card renders the checkout's branch from the live
 *      feed before any seeding (the retired git card's data).
 *   2. **Owner grouping** — a session with a user-set name renders a
 *      section ("alpha session", live dot on) holding its attributed
 *      files; a session with no ledger row falls back to the id-prefix
 *      display name with the live dot off.
 *   3. **Badges** — a file owned by both sessions wears the shared badge
 *      in both sections; the bash-bracketed ambiguous row wears the
 *      ambiguous badge.
 *   4. **Unattributed** — a hand-created untracked file no owner claims
 *      lands in the Unattributed section.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// This file lives at tests/app-test/, two levels below the repo root the
// harness seeds as the bootstrap source tree — the checkout the workspace
// ChangesetFeed polls.
const REPO_ROOT = resolve(import.meta.dir, "..", "..");

// Fixed instance id so the per-instance sessions.db path is known before
// launch. Scoped under the worktree's apptest prefix so the recipe's
// clean-slate sweeps cover it; unique per run via pid.
const INSTANCE_ID = `${process.env.TUG_APPTEST_ID_PREFIX ?? "apptest"}-at0227-${process.pid}`;
const SESSIONS_DB = join(
  homedir(),
  "Library",
  "Application Support",
  "Tug",
  "instances",
  INSTANCE_ID,
  "sessions.db",
);

// Seeded working-tree dirt — untracked files at the repo root (a directory
// would collapse to one `?? dir/` porcelain entry). Removed in afterAll.
const OWNED = "at0227-owned.txt";
const SHARED = "at0227-shared.txt";
const HAND = "at0227-hand.txt";
const SEEDED = [OWNED, SHARED, HAND];

const CARD = '[data-card-id="A"]';
const CARD_BODY = `${CARD} .changeset-card`;
const SECTIONS = `${CARD} [data-testid="changeset-session"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "changeset", title: "Changeset", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 700, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Write attribution state into the LIVE per-instance sessions.db (WAL —
 *  cross-process writes are safe). Runs after boot so tugcast has already
 *  created the schema. */
function seedLedger(): void {
  const sql = `
    INSERT INTO sessions (session_id, workspace_key, project_dir, created_at,
                          last_used_at, turn_count, state, name, name_user_set)
    VALUES ('at0227-alpha', '${REPO_ROOT}', '${REPO_ROOT}', 1, 1, 0, 'live',
            'alpha session', 1);
    INSERT INTO file_events (tug_session_id, tool_use_id, file_path, tool_name,
                             op, origin, ambiguous, parent_tool_use_id,
                             project_dir, at) VALUES
      ('at0227-alpha', 'at0227-tu-1', '${join(REPO_ROOT, OWNED)}',
       'Write', 'write', 'exact', 0, NULL, '${REPO_ROOT}', 1000),
      ('at0227-alpha', 'at0227-tu-2', '${join(REPO_ROOT, SHARED)}',
       'Bash', 'modified', 'bash', 1, NULL, '${REPO_ROOT}', 2000),
      ('at0227-beta', 'at0227-tu-3', '${join(REPO_ROOT, SHARED)}',
       'Write', 'write', 'exact', 0, NULL, '${REPO_ROOT}', 3000);
  `;
  const result = Bun.spawnSync(["sqlite3", SESSIONS_DB, sql]);
  if (result.exitCode !== 0) {
    throw new Error(`sqlite3 seed failed: ${result.stderr.toString()}`);
  }
}

/** All file rows under the section whose trigger shows `name`. */
async function sectionRows(
  app: App,
  name: string,
): Promise<Array<{ path: string; badges: string[] }>> {
  return app.evalJS<Array<{ path: string; badges: string[] }>>(
    `(function(){
      var sections = Array.from(document.querySelectorAll(${JSON.stringify(SECTIONS)}));
      var section = sections.find(function(s){
        var n = s.querySelector(".changeset-section-name");
        return n !== null && n.textContent.trim() === ${JSON.stringify(name)};
      });
      if (!section) return [];
      return Array.from(section.querySelectorAll('[data-testid="changeset-file"]')).map(
        function(row){
          return {
            path: (row.querySelector(".changeset-file-path") || {}).textContent || "",
            badges: Array.from(row.querySelectorAll(".changeset-badge")).map(function(b){
              return b.textContent.trim();
            }),
          };
        });
    })()`,
  );
}

afterAll(() => {
  for (const name of SEEDED) {
    const p = join(REPO_ROOT, name);
    if (existsSync(p)) rmSync(p, { force: true });
  }
});

describe.skipIf(!SHOULD_RUN)("AT0227: changeset card — grouped live snapshot", () => {
  test(
    "owner sections, badges, and unattributed bucket settle from the live feed",
    async () => {
      const app = await launchTugApp({
        testName: "at0227-changeset-card",
        instanceId: INSTANCE_ID,
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });

        // The bootstrap project section appears once the first CHANGESET_ALL
        // frame lands (process-level feed, 2s poll) and shows its branch in
        // the trigger — the aggregate's equivalent of the old header.
        await app.waitForCondition<boolean>(
          `(function(){
            var d = document.querySelector(${JSON.stringify(`${CARD} [data-testid="changeset-project"] .changeset-project-detail`)});
            return d !== null && d.textContent.trim().length > 0;
          })()`,
          { timeoutMs: 20_000 },
        );

        // Seed: real untracked dirt + attribution rows in the live ledger.
        for (const name of SEEDED) {
          writeFileSync(join(REPO_ROOT, name), `${name}\n`);
        }
        seedLedger();

        // Both owner sections settle on a subsequent poll cycle.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(SECTIONS)}).length >= 2`,
          { timeoutMs: 20_000 },
        );

        // Named live session: user-set display name, live dot on, its two
        // files with the right badge sets.
        const alpha = await sectionRows(app, "alpha session");
        const alphaPaths = alpha.map((r) => r.path);
        expect(alphaPaths).toContain(OWNED);
        expect(alphaPaths).toContain(SHARED);
        expect(alpha.find((r) => r.path === OWNED)?.badges).toEqual([]);
        expect(alpha.find((r) => r.path === SHARED)?.badges).toEqual([
          "ambiguous",
          "shared",
        ]);
        const alphaLive = await app.evalJS<boolean>(
          `(function(){
            var sections = Array.from(document.querySelectorAll(${JSON.stringify(SECTIONS)}));
            var section = sections.find(function(s){
              var n = s.querySelector(".changeset-section-name");
              return n !== null && n.textContent.trim() === "alpha session";
            });
            return section !== null &&
              section.querySelector(".changeset-live-dot-on") !== null;
          })()`,
        );
        expect(alphaLive, "alpha session wears the live dot").toBe(true);

        // Ledgerless owner: id-prefix display name, no live dot, shared
        // badge on the co-owned file.
        const beta = await sectionRows(app, "at0227-b");
        expect(beta.map((r) => r.path)).toContain(SHARED);
        expect(beta.find((r) => r.path === SHARED)?.badges).toEqual(["shared"]);
        const betaLive = await app.evalJS<boolean>(
          `(function(){
            var sections = Array.from(document.querySelectorAll(${JSON.stringify(SECTIONS)}));
            var section = sections.find(function(s){
              var n = s.querySelector(".changeset-section-name");
              return n !== null && n.textContent.trim() === "at0227-b";
            });
            return section !== null &&
              section.querySelector(".changeset-live-dot-on") === null;
          })()`,
        );
        expect(betaLive, "ledgerless owner has no live dot").toBe(true);

        // The hand-created file lands in Unattributed (subset assertion —
        // the checkout may carry other unrelated dirt during a dev run).
        const unattributed = await app.evalJS<string[]>(
          `Array.from(document.querySelectorAll(
             ${JSON.stringify(`${CARD} [data-testid="changeset-unattributed"] .changeset-file-path`)}
           )).map(function(el){ return el.textContent; })`,
        );
        expect(unattributed).toContain(HAND);
        expect(unattributed).not.toContain(OWNED);
        expect(unattributed).not.toContain(SHARED);

        // Read-only law: no file row (nor any ancestor inside the list)
        // carries a tabindex.
        const tabbable = await app.evalJS<number>(
          `document.querySelectorAll(
             ${JSON.stringify(`${CARD} [data-testid="changeset-file"] [tabindex], ${CARD} [data-testid="changeset-file"][tabindex]`)}
           ).length`,
        );
        expect(tabbable, "read-only rows render no tabindex").toBe(0);

        // Present (non-deleted) files render as open-file links; the click
        // opens the file in a Text card. All seeded files are created
        // (present), so each carries the link affordance.
        const linkPaths = await app.evalJS<string[]>(
          `Array.from(document.querySelectorAll(
             ${JSON.stringify(`${CARD} [data-slot="changeset-file-ref"]`)}
           )).map(function(el){ return el.getAttribute("title"); })`,
        );
        expect(linkPaths).toContain(OWNED);
        expect(linkPaths).toContain(HAND);

        // Click the owned file's link → a Text card opens on that file.
        const OWNED_LINK = `${CARD} [data-slot="changeset-file-ref"][title="${OWNED}"]`;
        await app.click(OWNED_LINK);
        await app.waitForCondition<boolean>(
          `(function(){
            var eds = document.querySelectorAll('[data-slot="tug-text-card-editor"] .cm-content');
            for (var i = 0; i < eds.length; i++) {
              if ((eds[i].textContent || "").indexOf(${JSON.stringify(OWNED)}) !== -1) return true;
            }
            return false;
          })()`,
          { timeoutMs: 8000 },
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
