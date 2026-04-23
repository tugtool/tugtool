/**
 * `initActionDispatch` app-lifecycle save wiring — Step 13.
 *
 * Pins the contract that `initActionDispatch` subscribes `saveAndFlush`
 * to the will-phase events (`applicationWillResignActive`,
 * `applicationWillHide`) *as well as* the did-phase `didResignActive`
 * backstop. The will-phase subscribers read authoritative state
 * BEFORE WebKit tears down selection visibility on app-resign, which
 * is the only window where `document.activeElement` still identifies
 * the user's focused input and `selectionGuard.getCardRange(cardId)`
 * still reflects the live selection. [Collision 3], [L23].
 *
 * Coverage:
 *   - `notifyApplicationWillResignActive` → `saveAndFlush` fires once.
 *   - `notifyApplicationWillHide` → `saveAndFlush` fires once.
 *   - `notifyApplicationDidResignActive` → `saveAndFlush` fires once
 *     (backstop preserved).
 *   - Full will → did cascade fires `saveAndFlush` twice (both
 *     subscribers run; the saves are idempotent).
 *   - Disposer returned by `initActionDispatch` unsubscribes all three.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { initActionDispatch, _resetForTest } from "@/action-dispatch";
import { AppLifecycle, registerAppLifecycle } from "@/lib/app-lifecycle";

// ---------------------------------------------------------------------------
// Minimal mocks (only what the lifecycle save wiring touches)
// ---------------------------------------------------------------------------

function createMockDeckManager(): {
  saveAndFlushCount: number;
  // Cast target: `initActionDispatch` types expect a full DeckManager.
  // Tests only exercise a narrow surface, so `as any` at callsite keeps
  // the mock minimal without tripping the compiler.
  saveAndFlush: () => void;
  addCard: (componentId: string) => string | null;
  prepareForReload: () => Promise<void>;
} {
  let saveAndFlushCount = 0;
  return {
    get saveAndFlushCount() {
      return saveAndFlushCount;
    },
    saveAndFlush: () => {
      saveAndFlushCount += 1;
    },
    addCard: () => null,
    prepareForReload: () => Promise.resolve(),
  };
}

function createMockConnection() {
  return {
    onFrame: (_id: number, _cb: (payload: Uint8Array) => void) => {},
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let appLifecycle: AppLifecycle;
let deck: ReturnType<typeof createMockDeckManager>;
let teardown: (() => void) | undefined;

beforeEach(() => {
  _resetForTest();
  appLifecycle = new AppLifecycle();
  registerAppLifecycle(appLifecycle);
  deck = createMockDeckManager();
  teardown = initActionDispatch(createMockConnection() as any, deck as any);
});

afterEach(() => {
  teardown?.();
  teardown = undefined;
  registerAppLifecycle(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("initActionDispatch — app-lifecycle save wiring (Step 13)", () => {
  it("fires saveAndFlush on applicationWillResignActive", () => {
    expect(deck.saveAndFlushCount).toBe(0);
    appLifecycle.notifyApplicationWillResignActive();
    expect(deck.saveAndFlushCount).toBe(1);
  });

  it("fires saveAndFlush on applicationWillHide", () => {
    appLifecycle.notifyApplicationWillHide();
    expect(deck.saveAndFlushCount).toBe(1);
  });

  it("fires saveAndFlush on applicationDidResignActive (backstop)", () => {
    appLifecycle.notifyApplicationDidResignActive();
    expect(deck.saveAndFlushCount).toBe(1);
  });

  it("fires saveAndFlush twice on a full will→did cascade (will + backstop)", () => {
    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationDidResignActive();
    expect(deck.saveAndFlushCount).toBe(2);
  });

  it("disposer returned by initActionDispatch unsubscribes all three wires", () => {
    teardown?.();
    teardown = undefined;

    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationWillHide();
    appLifecycle.notifyApplicationDidResignActive();
    expect(deck.saveAndFlushCount).toBe(0);
  });

  it("never crashes when AppLifecycle was never registered", () => {
    // Re-init with no lifecycle registered, then fire through a
    // freshly-created instance nobody subscribed to. The key assertion
    // is that setup and teardown do not throw.
    teardown?.();
    registerAppLifecycle(null);
    const freshDeck = createMockDeckManager();
    expect(() => {
      teardown = initActionDispatch(
        createMockConnection() as any,
        freshDeck as any,
      );
    }).not.toThrow();
    expect(freshDeck.saveAndFlushCount).toBe(0);
  });
});
