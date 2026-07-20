/**
 * ChangesRouteController — pure-derivation unit tests ([P07]).
 *
 * `deriveChangesRouteSnapshot` scopes the account-global aggregate
 * (`WorkspacesChangesetSnapshot`) to one card's workspace + session and
 * layers the Lens selection defaults over an override map. Exercised
 * against the shared golden fixture so drift on either side fails.
 */
import { describe, it, expect } from "bun:test";

import {
  deriveChangesRouteSnapshot,
  draftDrifted,
  overridesFromSelection,
  selectionFromOverrides,
  sessionFileDefaultSelected,
  type ChangesRouteBinding,
} from "@/lib/changes-route-controller";
import type { WorkspacesChangesetSnapshot } from "@/lib/changeset-types";
import golden from "@/__tests__/fixtures/workspaces-changeset-snapshot.golden.json";

const DATA = golden as WorkspacesChangesetSnapshot;

// The tugtool project's binding (workspace_key + the session that owns its
// changeset entry), read from the fixture's first project.
const BINDING: ChangesRouteBinding = {
  tugSessionId: "sess-0197a2b4-c8d1-7e02-9f3a-b5c6d7e8f901",
  workspaceKey: "a1b2c3d4e5f60718",
  projectDir: "/Users/dev/src/tugtool",
};

const NO_OVERRIDES = new Map<string, boolean>();

describe("deriveChangesRouteSnapshot", () => {
  it("selects this card's project by workspace_key", () => {
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, NO_OVERRIDES);
    expect(snap.project.project_dir).toBe("/Users/dev/src/tugtool");
    expect(snap.project.branch).toBe("main");
  });

  it("matches the session entry by owner_id and collects dashes separately", () => {
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, NO_OVERRIDES);
    expect(snap.entry?.kind).toBe("session");
    expect(snap.entry?.owner_id).toBe(BINDING.tugSessionId);
    expect(snap.entry?.files.map((f) => f.path)).toEqual([
      "tugdeck/src/lib/changeset-types.ts",
      "tugrust/crates/tugcast/src/feeds/changeset.rs",
    ]);
    expect(snap.dashes.map((d) => d.owner_id)).toEqual(["tugdash/fix-join"]);
  });

  it("passes the unattributed bucket through", () => {
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, NO_OVERRIDES);
    expect(snap.unattributed.map((f) => f.path)).toEqual(["notes/scratch.md"]);
  });

  it("selects clean session files by default; skips shared and unattributed", () => {
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, NO_OVERRIDES);
    // changeset-types.ts: not shared → selected.
    expect(snap.selectedPaths.has("tugdeck/src/lib/changeset-types.ts")).toBe(true);
    // changeset.rs: shared → deselected (explicit opt-in).
    expect(
      snap.selectedPaths.has("tugrust/crates/tugcast/src/feeds/changeset.rs"),
    ).toBe(false);
    // Unattributed defaults OFF — no owner claims it, inclusion is an
    // explicit election (the card mirror of the CLI's exit-3 refusal).
    expect(snap.selectedPaths.has("notes/scratch.md")).toBe(false);
  });

  it("honors overrides in both directions", () => {
    const overrides = new Map<string, boolean>([
      // Force the shared file ON.
      ["tugrust/crates/tugcast/src/feeds/changeset.rs", true],
      // Elect the (default-off) unattributed file ON.
      ["notes/scratch.md", true],
      // Force a default-on session file OFF.
      ["tugdeck/src/lib/changeset-types.ts", false],
    ]);
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, overrides);
    expect(
      snap.selectedPaths.has("tugrust/crates/tugcast/src/feeds/changeset.rs"),
    ).toBe(true);
    expect(snap.selectedPaths.has("notes/scratch.md")).toBe(true);
    expect(snap.selectedPaths.has("tugdeck/src/lib/changeset-types.ts")).toBe(false);
  });

  it("dash files never enter the commit selection", () => {
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, NO_OVERRIDES);
    expect(
      snap.selectedPaths.has("tugrust/crates/tugutil/src/commands/dash.rs"),
    ).toBe(false);
  });

  it("falls back to a placeholder project when the feed hasn't emitted it", () => {
    const snap = deriveChangesRouteSnapshot(
      { projects: [] },
      BINDING,
      NO_OVERRIDES,
    );
    expect(snap.entry).toBeNull();
    expect(snap.dashes).toEqual([]);
    expect(snap.unattributed).toEqual([]);
    expect(snap.project.display_name).toBe("tugtool");
    expect(snap.project.workspace_key).toBe("a1b2c3d4e5f60718");
    expect(snap.selectedPaths.size).toBe(0);
  });

  it("returns a null entry when no session owns a changeset in this workspace", () => {
    const snap = deriveChangesRouteSnapshot(
      DATA,
      { ...BINDING, tugSessionId: "sess-unknown" },
      NO_OVERRIDES,
    );
    expect(snap.entry).toBeNull();
    // The dash + unattributed bucket still belong to the project.
    expect(snap.dashes).toHaveLength(1);
    // The pinned regression: a brand-new session on a dirty tree must not
    // arrive with the whole unattributed bucket pre-selected — that would
    // one-click sweep another session's work under this session's name.
    expect(snap.selectedPaths.size).toBe(0);
  });
});

describe("selection ⇄ overrides mapping ([P02])", () => {
  it("persisted selection seeds the override map in both directions", () => {
    const overrides = overridesFromSelection({
      include: ["notes/scratch.md"],
      exclude: ["tugdeck/src/lib/changeset-types.ts"],
    });
    expect(overrides.get("notes/scratch.md")).toBe(true);
    expect(overrides.get("tugdeck/src/lib/changeset-types.ts")).toBe(false);

    // Round-trip: layering those overrides over the fixture defaults maps
    // back to the same deltas.
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, overrides);
    const selection = selectionFromOverrides(snap, overrides);
    expect(selection.include).toEqual(["notes/scratch.md"]);
    expect(selection.exclude).toEqual(["tugdeck/src/lib/changeset-types.ts"]);
  });

  it("absent or empty selection yields no overrides", () => {
    expect(overridesFromSelection(undefined).size).toBe(0);
    expect(overridesFromSelection(null).size).toBe(0);
    expect(overridesFromSelection({ include: [], exclude: [] }).size).toBe(0);
  });

  it("drops default-matching and stale-path overrides from the persisted deltas", () => {
    const overrides = new Map<string, boolean>([
      // Matches the default (clean session file defaults ON) — not a delta.
      ["tugdeck/src/lib/changeset-types.ts", true],
      // Matches the default (shared defaults OFF) — not a delta.
      ["tugrust/crates/tugcast/src/feeds/changeset.rs", false],
      // A file no longer in the snapshot — dropped, never accretes.
      ["gone/file.rs", true],
    ]);
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, overrides);
    const selection = selectionFromOverrides(snap, overrides);
    expect(selection.include).toEqual([]);
    expect(selection.exclude).toEqual([]);
  });

  it("captures genuine deltas: shared file on, clean file off, unattributed elected", () => {
    const overrides = new Map<string, boolean>([
      ["tugrust/crates/tugcast/src/feeds/changeset.rs", true],
      ["tugdeck/src/lib/changeset-types.ts", false],
      ["notes/scratch.md", true],
    ]);
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, overrides);
    const selection = selectionFromOverrides(snap, overrides);
    expect(selection.include).toEqual([
      "notes/scratch.md",
      "tugrust/crates/tugcast/src/feeds/changeset.rs",
    ]);
    expect(selection.exclude).toEqual(["tugdeck/src/lib/changeset-types.ts"]);
  });
});

describe("draftDrifted", () => {
  it("plumbs the drift boolean from file touches vs the draft timestamp", () => {
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, NO_OVERRIDES);
    const entry = snap.entry;
    expect(entry).not.toBeNull();
    // Fixture: draft.updated_at (1752264130000) is newer than both files'
    // last_touched — no drift.
    expect(draftDrifted(entry)).toBe(false);
    // A file touched after the draft was written → drift.
    const drifted = {
      ...entry!,
      files: entry!.files.map((f, i) =>
        i === 0 ? { ...f, last_touched: 1752264999999 } : f,
      ),
    };
    expect(draftDrifted(drifted)).toBe(true);
    // No draft, no drift.
    expect(draftDrifted({ ...entry!, draft: undefined })).toBe(false);
    expect(draftDrifted(null)).toBe(false);
  });
});

describe("sessionFileDefaultSelected", () => {
  const base = {
    path: "x",
    git_status: ".M",
    op: "edit",
    origin: "exact",
    last_touched: 0,
  };
  it("clean files default on", () => {
    expect(sessionFileDefaultSelected({ ...base, shared: false })).toBe(true);
  });
  it("shared files default off", () => {
    expect(sessionFileDefaultSelected({ ...base, shared: true })).toBe(false);
  });
});
