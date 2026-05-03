/**
 * Recents-eviction → ledger-eviction wiring.
 *
 * When `cardServicesStore._construct` runs after a binding settles, it
 * also prepends the new path to the tide recent-projects list and caps
 * the list at `TIDE_RECENT_PROJECTS_MAX`. Any path that falls off the
 * tail must trigger a `forget_project_dir_sessions` CONTROL request so
 * the picker doesn't surface ledger rows for a path the user no longer
 * recognizes.
 *
 * This file pins that wire-side behavior end-to-end:
 *   - real `cardServicesStore` from production
 *   - mocked tugbank that returns a recents list at the cap
 *   - mocked connection that records outbound frames
 *   - asserting that the bind effect dispatches one
 *     `forget_project_dir_sessions { project_dir }` for the evicted path.
 */
import "./setup-rtl";

import { describe, it, expect, afterEach, mock } from "bun:test";

interface SentFrame {
  feedId: number;
  payload: Uint8Array;
}
const sentFrames: SentFrame[] = [];

const fakeConnection = {
  send: (feedId: number, payload: Uint8Array) => {
    sentFrames.push({ feedId, payload });
  },
  onFrame: (_feedId: number, _cb: (payload: Uint8Array) => void) => () => {},
};

mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => fakeConnection,
  setConnection: () => {},
}));

import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
const fakeLifecycle = new ConnectionLifecycle();
mock.module("@/lib/connection-lifecycle", () => ({
  ConnectionLifecycle,
  getConnectionLifecycle: () => fakeLifecycle,
  registerConnectionLifecycle: () => {},
}));

const tugbankStore: Record<string, Record<string, { kind: string; value: unknown }>> = {};
const fakeTugbank = {
  get(domain: string, key: string) {
    return tugbankStore[domain]?.[key];
  },
  readDomain(domain: string) {
    return tugbankStore[domain];
  },
  onDomainChanged(_cb: (domain: string) => void) {
    return () => {};
  },
};
mock.module("@/lib/tugbank-singleton", () => ({
  getTugbankClient: () => fakeTugbank,
  setTugbankClient: () => {},
}));

interface RecentsPut {
  paths: string[];
}
const recentsPuts: RecentsPut[] = [];
import * as actualSettingsApi from "@/settings-api";
mock.module("@/settings-api", () => ({
  ...actualSettingsApi,
  putTideRecentProjects: (paths: string[]) => {
    recentsPuts.push({ paths });
  },
}));

import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import { cardServicesStore } from "@/lib/card-services-store";
import { TIDE_RECENT_PROJECTS_MAX } from "@/settings-api";

const CARD_ID = "recents-eviction-test-card";

interface FakeCard {
  id: string;
}

function createFakeDeck(initial: FakeCard[]) {
  let snapshot = { cards: initial };
  const listeners = new Set<() => void>();
  return {
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot() {
      return snapshot;
    },
    setCards(cards: FakeCard[]): void {
      snapshot = { cards };
      for (const l of listeners) l();
    },
  };
}

/**
 * Bootstraps `cardServicesStore` against a fake deck holding `CARD_ID`,
 * then sets the binding so `_reconcile` constructs the per-card
 * services. Construction runs the bind-effect that prepends the path to
 * the recents list and dispatches the eviction ledger frames.
 */
function bind(projectDir: string): CardSessionBinding {
  const fakeDeck = createFakeDeck([{ id: CARD_ID }]);
  cardServicesStore.attachDeckManager(
    fakeDeck as unknown as Parameters<typeof cardServicesStore.attachDeckManager>[0],
  );
  const binding: CardSessionBinding = {
    tugSessionId: "sess-recents-test",
    workspaceKey: projectDir,
    projectDir,
    sessionMode: "new",
  };
  cardSessionBindingStore.setBinding(CARD_ID, binding);
  return binding;
}

afterEach(() => {
  cardSessionBindingStore.clearBinding(CARD_ID);
  sentFrames.length = 0;
  recentsPuts.length = 0;
  for (const domain of Object.keys(tugbankStore)) {
    delete tugbankStore[domain];
  }
});

function decodeControlFrame(frame: SentFrame): { action: string; project_dir?: string } {
  return JSON.parse(new TextDecoder().decode(frame.payload)) as {
    action: string;
    project_dir?: string;
  };
}

describe("recents-eviction → ledger-eviction wiring", () => {
  it("dispatches forget_project_dir_sessions for each path that falls off the recents tail", () => {
    // Pre-populate the recents list at the cap. Adding a fresh path
    // will push the oldest off the tail; the eviction hook should fire
    // a forget_project_dir_sessions for the dropped path.
    const cap = TIDE_RECENT_PROJECTS_MAX;
    const existing = Array.from({ length: cap }, (_, i) => `/work/old-${i}`);
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: existing } },
    };

    bind("/work/new-path");

    // The recents list now has the new path prepended and the oldest
    // (`/work/old-{cap - 1}`) dropped.
    expect(recentsPuts.length).toBe(1);
    expect(recentsPuts[0].paths.length).toBe(cap);
    expect(recentsPuts[0].paths[0]).toBe("/work/new-path");
    expect(recentsPuts[0].paths.includes(`/work/old-${cap - 1}`)).toBe(false);

    // Exactly one forget_project_dir_sessions for the evicted path.
    const forgets = sentFrames
      .map(decodeControlFrame)
      .filter((d) => d.action === "forget_project_dir_sessions");
    expect(forgets.length).toBe(1);
    expect(forgets[0].project_dir).toBe(`/work/old-${cap - 1}`);
  });

  it("dispatches no forget when the recents list isn't yet at the cap", () => {
    // Recents list has room — adding a fresh path does NOT evict.
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": {
        kind: "json",
        value: { paths: ["/work/old-1", "/work/old-2"] },
      },
    };

    bind("/work/fresh");

    expect(recentsPuts.length).toBe(1);
    const forgets = sentFrames
      .map(decodeControlFrame)
      .filter((d) => d.action === "forget_project_dir_sessions");
    expect(forgets.length).toBe(0);
  });

  it("dedup-promotion of an existing path does not trigger eviction", () => {
    // Re-binding to a path already in recents promotes it to the head
    // without evicting anything.
    const cap = TIDE_RECENT_PROJECTS_MAX;
    const existing = Array.from({ length: cap }, (_, i) => `/work/old-${i}`);
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: existing } },
    };

    // Bind to one of the EXISTING paths — dedup keeps the list at cap.
    bind("/work/old-2");

    const forgets = sentFrames
      .map(decodeControlFrame)
      .filter((d) => d.action === "forget_project_dir_sessions");
    expect(forgets.length).toBe(0);
  });
});
