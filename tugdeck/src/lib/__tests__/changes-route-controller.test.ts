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

  it("selects clean session files + unattributed by default; skips ambiguous/shared", () => {
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, NO_OVERRIDES);
    // changeset-types.ts: not ambiguous, not shared → selected.
    expect(snap.selectedPaths.has("tugdeck/src/lib/changeset-types.ts")).toBe(true);
    // changeset.rs: ambiguous + shared → deselected (explicit opt-in).
    expect(
      snap.selectedPaths.has("tugrust/crates/tugcast/src/feeds/changeset.rs"),
    ).toBe(false);
    // unattributed always defaults on.
    expect(snap.selectedPaths.has("notes/scratch.md")).toBe(true);
  });

  it("honors overrides in both directions", () => {
    const overrides = new Map<string, boolean>([
      // Force the ambiguous+shared file ON.
      ["tugrust/crates/tugcast/src/feeds/changeset.rs", true],
      // Force a default-on file OFF.
      ["notes/scratch.md", false],
    ]);
    const snap = deriveChangesRouteSnapshot(DATA, BINDING, overrides);
    expect(
      snap.selectedPaths.has("tugrust/crates/tugcast/src/feeds/changeset.rs"),
    ).toBe(true);
    expect(snap.selectedPaths.has("notes/scratch.md")).toBe(false);
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
    expect(snap.selectedPaths.has("notes/scratch.md")).toBe(true);
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
    expect(
      sessionFileDefaultSelected({ ...base, ambiguous: false, shared: false }),
    ).toBe(true);
  });
  it("ambiguous or shared files default off", () => {
    expect(
      sessionFileDefaultSelected({ ...base, ambiguous: true, shared: false }),
    ).toBe(false);
    expect(
      sessionFileDefaultSelected({ ...base, ambiguous: false, shared: true }),
    ).toBe(false);
  });
});
