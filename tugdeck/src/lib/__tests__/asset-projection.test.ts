/**
 * Pure-logic coverage of the derivation: what the buffer says becomes what the
 * strip holds. The existence check reaches for `fetch`, which is stubbed per
 * test so the projection's own logic is what is under test rather than a
 * server.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { AssetProjection } from "../asset-projection";

const BASE = "/u/docs";

const realFetch = globalThis.fetch;

/** Every path exists — the ordinary case. */
function stubFetchAllPresent(): void {
  globalThis.fetch = (async () =>
    new Response(null, { status: 200 })) as unknown as typeof fetch;
}

/** Every path is absent, so every tile resolves to `missing`. */
function stubFetchAllAbsent(): void {
  globalThis.fetch = (async () =>
    new Response(null, { status: 404 })) as unknown as typeof fetch;
}

/** Let the in-flight existence checks settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A projection already pointed at `text`, with no idle wait needed. */
function projectionOver(text: string): AssetProjection {
  const projection = new AssetProjection();
  projection.setTextSource(() => text);
  projection.setBase(BASE);
  return projection;
}

describe("AssetProjection", () => {
  beforeEach(() => {
    stubFetchAllPresent();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("projects one tile per assets-scoped link", () => {
    const projection = projectionOver(
      "# notes\n\n![pic](assets/a.png)\n\n[zip](assets/b.zip)\n\n[other](../elsewhere/c.png)\n",
    );

    const tiles = projection.getSnapshot();

    expect(tiles.map((t) => t.name)).toEqual(["a.png", "b.zip"]);
    expect(tiles.map((t) => t.path)).toEqual([
      "/u/docs/assets/a.png",
      "/u/docs/assets/b.zip",
    ]);
    projection.dispose();
  });

  test("distinguishes image and file tiles", () => {
    const projection = projectionOver(
      "![pic](assets/a.png)\n[zip](assets/b.zip)\n",
    );

    expect(projection.getSnapshot().map((t) => t.kind)).toEqual([
      "image",
      "file",
    ]);
    // The synthetic atoms carry the same distinction through to the component,
    // which needs it to pick a paint branch.
    expect(projection.getAtoms().map((a) => a.type)).toEqual(["image", "file"]);
    projection.dispose();
  });

  test("publishes nothing when the link set is unchanged", () => {
    let text = "![pic](assets/a.png)\n";
    const projection = new AssetProjection();
    projection.setTextSource(() => text);
    projection.setBase(BASE);

    let notifications = 0;
    projection.subscribe(() => {
      notifications += 1;
    });
    const before = projection.getSnapshot();

    // Prose typed around the link — the link set did not move.
    text = "![pic](assets/a.png)\n\nsome prose the user typed\n";
    projection.derive();

    expect(notifications).toBe(0);
    // Reference-stable, which the component's snapshot cache depends on.
    expect(projection.getSnapshot()).toBe(before);
    projection.dispose();
  });

  test("publishes when a link is added or removed", () => {
    let text = "![pic](assets/a.png)\n";
    const projection = new AssetProjection();
    projection.setTextSource(() => text);
    projection.setBase(BASE);

    let notifications = 0;
    projection.subscribe(() => {
      notifications += 1;
    });

    text = "![pic](assets/a.png)\n![two](assets/b.png)\n";
    projection.derive();
    expect(notifications).toBe(1);
    expect(projection.getSnapshot()).toHaveLength(2);

    text = "";
    projection.derive();
    expect(notifications).toBe(2);
    expect(projection.getSnapshot()).toHaveLength(0);
    projection.dispose();
  });

  test("a document linking one file twice shows one tile", () => {
    const projection = projectionOver(
      "![pic](assets/a.png)\n\nand again: ![pic](assets/a.png)\n",
    );

    expect(projection.getSnapshot()).toHaveLength(1);
    projection.dispose();
  });

  test("an image tile paints from its path, holding no bytes", () => {
    const projection = projectionOver("![pic](assets/a.png)\n");
    const [tile] = projection.getSnapshot();

    const entry = projection.bytesStore.get(tile.id);
    expect(entry).not.toBeNull();
    expect(entry?.path).toBe("/u/docs/assets/a.png");
    // The whole point: the strip never materializes a document's assets.
    expect(entry?.content).toBe("");
    projection.dispose();
  });

  test("marks an unresolvable link missing", async () => {
    stubFetchAllAbsent();
    const projection = projectionOver("![gone](assets/gone.png)\n");

    expect(projection.getSnapshot()[0].missing).toBe(false);
    await settle();

    // A typo is visible as a missing tile rather than silently absent.
    expect(projection.getSnapshot()[0].missing).toBe(true);
    projection.dispose();
  });

  test("has no tiles without a base", () => {
    const projection = new AssetProjection();
    projection.setTextSource(() => "![pic](assets/a.png)\n");

    expect(projection.getSnapshot()).toHaveLength(0);
    projection.dispose();
  });

  test("records and clears a failure against a tile", () => {
    const projection = projectionOver("![pic](assets/a.png)\n");

    projection.noteFailure("a.png", "Could not attach a.png.");
    expect(projection.getSnapshot()[0].failed).toBe(true);
    expect(projection.failureFor("a.png")).toBe("Could not attach a.png.");

    projection.clearFailure("a.png");
    expect(projection.getSnapshot()[0].failed).toBe(false);
    projection.dispose();
  });

  test("a disposed projection publishes nothing further", () => {
    let text = "![pic](assets/a.png)\n";
    const projection = new AssetProjection();
    projection.setTextSource(() => text);
    projection.setBase(BASE);

    let notifications = 0;
    projection.subscribe(() => {
      notifications += 1;
    });
    projection.dispose();

    text = "![pic](assets/a.png)\n![two](assets/b.png)\n";
    projection.derive();

    expect(notifications).toBe(0);
  });
});
