/**
 * tug-text-editor-completion-overlay.test.tsx —
 * Structural + lifecycle tests for the CompletionOverlay portal migration.
 *
 * Scope:
 *   1. Structural placement (the popup `<div>` portals OUTSIDE the
 *      editor host, into `<CanvasOverlayRoot />` when registered or
 *      `document.body` as fallback per [D02]).
 *   2. Lifecycle pruning — the overlay closes on:
 *        - owning-card deactivation (deck-store fires
 *          `cardDidDeactivate` for the owning card; [D06]),
 *        - pane collapse (the editor host's bounding rect drops to
 *          zero; the ResizeObserver branch in CompletionOverlay
 *          dispatches `cancelCompletion`; [D06] fold-in),
 *        - `Escape` keydown (existing keymap; verify still fires
 *          after popup detachment),
 *        - `TugTextEditor` unmount while the typeahead is active
 *          (no orphaned overlay portal).
 *
 * Why a structural + lifecycle test here (not in
 * tug-text-editor-completion.test.ts):
 *   - That file is pure-logic — it tests `Transaction`-shaped inputs
 *     against the completion-extension's reducers. It deliberately
 *     does NOT mount components, per the file's docstring.
 *   - This file is component-shape: it mounts the substrate against
 *     happy-dom and asserts portal landing site + lifecycle effects.
 *     Layout-fidelity assertions (popup escapes card clip rect,
 *     anchor ±2px) belong in tests/app-test/at0051 — happy-dom can't
 *     model them.
 *
 * What this catches:
 *   - Regression that re-introduces the popup `<div>` inside the
 *     editor host (the bug this migration fixes).
 *   - Regression that detaches the active-card-deactivate
 *     subscription, leaving popups orphaned over deactivated cards.
 *   - Regression that drops the pane-collapse branch in the
 *     ResizeObserver, leaving popups visible after the holding pane
 *     collapses.
 *   - Regression that breaks the Escape keymap path post-migration.
 */

import "../../../__tests__/setup-rtl";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import type { EditorView } from "@codemirror/view";

import * as canvasOverlayRegistry from "@/lib/canvas-overlay-registry";
import { TugTextEditor } from "@/components/tugways/tug-text-editor";
import type {
  TugTextEditorDelegate,
} from "@/components/tugways/tug-text-editor";
import { EditorSelection } from "@codemirror/state";
import {
  cancelCompletion,
  getCompletionState,
} from "@/components/tugways/tug-text-editor/completion-extension";
import type { CompletionProvider } from "@/lib/tug-text-types";
import { DeckManagerContext } from "@/deck-manager-context";
import {
  CardStatePreservationContext,
  type CardStatePreservationContextValue,
} from "@/components/tugways/use-card-state-preservation";
import { makeMockStore } from "../../../__tests__/mock-deck-manager-store";

afterEach(() => {
  cleanup();
  canvasOverlayRegistry._resetForTests();
});

function findCompletionMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-slot="tug-completion-menu"]',
  );
}

function findEditorHost(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-slot="tug-text-editor"]');
}

describe("CompletionOverlay — portal target + structural placement", () => {
  test("the completion menu mounts outside the editor host", () => {
    const { container } = render(<TugTextEditor preserveState={false} />);
    // After mount, the editor's view-creation effect runs, sets
    // `view` state, and the child <CompletionOverlay /> mounts the
    // portal. RTL's `render` flushes effects synchronously.
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    const host = findEditorHost(container);
    expect(host).not.toBeNull();
    // The popup must NOT be a descendant of the editor host. This is
    // the load-bearing invariant of the migration: in-host popup is
    // exactly the bug we fixed.
    expect(host!.contains(menu)).toBe(false);
  });

  test("with no <CanvasOverlayRoot /> registered, the popup portals to document.body", () => {
    expect(canvasOverlayRegistry.getRoot()).toBeNull();
    render(<TugTextEditor preserveState={false} />);
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    expect(menu!.parentElement).toBe(document.body);
  });

  test("when an overlay root is registered, the popup portals into it", () => {
    // Pre-register a root before mounting the editor, so the hook's
    // initial snapshot already returns the registered element.
    const root = document.createElement("div");
    root.setAttribute("data-slot", "tug-canvas-overlay-root");
    document.body.appendChild(root);
    canvasOverlayRegistry.register(root);

    render(<TugTextEditor preserveState={false} />);
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    expect(menu!.parentElement).toBe(root);

    // Cleanup: remove the synthetic root from body.
    canvasOverlayRegistry.unregister(root);
    document.body.removeChild(root);
  });

  test("the popup is initially hidden (display: none)", () => {
    render(<TugTextEditor preserveState={false} />);
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    expect(menu!.style.display).toBe("none");
  });

  test("the popup carries position: fixed inline (escapes card clip rect)", () => {
    render(<TugTextEditor preserveState={false} />);
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    // The CompletionOverlay sets position: fixed inline; that is
    // the canvas-escape contract. CSS provides z-index via the
    // overlay-tier token; position itself is inline.
    expect(menu!.style.position).toBe("fixed");
  });

  test("the popup unmounts when TugTextEditor unmounts", () => {
    const { unmount } = render(<TugTextEditor preserveState={false} />);
    expect(findCompletionMenu()).not.toBeNull();
    unmount();
    expect(findCompletionMenu()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle pruning tests (Step 2)
// ---------------------------------------------------------------------------

/**
 * Test scaffolding for the lifecycle suite. Mounts a `<TugTextEditor />`
 * inside a `CardStatePreservationContext` (so `useCardId` returns the
 * given id) and a `DeckManagerContext` (so the deactivate subscription
 * actually wires up). Returns the live `EditorView` plus the unmount
 * handle.
 *
 * Each card has its own `register` function (a no-op — the editor's
 * `useCardStatePreservation` registers callbacks but the test never
 * triggers tab save/restore).
 */
function mountWithCard(opts: {
  cardId: string;
  store: ReturnType<typeof makeMockStore>;
  completionProviders?: Record<string, CompletionProvider>;
}): { view: EditorView; unmount: () => void } {
  const ctxValue: CardStatePreservationContextValue = {
    cardId: opts.cardId,
    register: () => {},
  };
  const delegateRef: { current: TugTextEditorDelegate | null } = {
    current: null,
  };
  function H(): React.ReactElement {
    const ref = React.useRef<TugTextEditorDelegate>(null);
    React.useLayoutEffect(() => {
      delegateRef.current = ref.current;
    }, []);
    return (
      <DeckManagerContext.Provider value={opts.store}>
        <CardStatePreservationContext.Provider value={ctxValue}>
          <TugTextEditor
            ref={ref}
            preserveState={false}
            completionProviders={opts.completionProviders}
          />
        </CardStatePreservationContext.Provider>
      </DeckManagerContext.Provider>
    );
  }
  const result = render(<H />);
  const view = delegateRef.current!.view()!;
  return { view, unmount: result.unmount };
}

/**
 * Activate a typeahead session by inserting the trigger character at
 * offset 0. The completion-extension's `transactionExtender` matches
 * the insertion and dispatches `activateEffect`. Verified active before
 * returning so each test fails fast on activation regressions rather
 * than masquerading as a cancel-side bug.
 */
function activateTypeahead(view: EditorView, trigger: string): void {
  // Insert at the doc end and explicitly land the caret immediately
  // after the inserted character — `detectTriggerInsertion` keys on
  // `toB === head`. Default selection mapping through an insertion at
  // the caret can leave head pinned at the insertion's start (assoc
  // bias), which the detector ignores.
  const at = view.state.doc.length;
  view.dispatch({
    changes: { from: at, insert: trigger },
    selection: EditorSelection.cursor(at + trigger.length),
  });
  if (!getCompletionState(view).active) {
    throw new Error(
      `activateTypeahead: typeahead did not activate after inserting "${trigger}" — `
        + "check the completion provider registration",
    );
  }
}

/**
 * Single-item provider for "@" — returns one match for any query, so
 * the typeahead's `filtered` list is non-empty and the painter writes
 * `display: block` on activation.
 */
const fileProvider: CompletionProvider = () => [
  {
    label: "main.ts",
    atom: { kind: "atom", type: "file", label: "main.ts", value: "main.ts" },
  },
];

const PROVIDERS: Record<string, CompletionProvider> = { "@": fileProvider };

describe("CompletionOverlay — lifecycle pruning", () => {
  test(
    "owning-card deactivate cancels the typeahead session ([D06])",
    () => {
      // Capture the deactivate callback per cardId so the test can fire
      // it deterministically. The base mock returns a no-op — override
      // here to record the registration.
      const deactivateCallbacks = new Map<string, (cardId: string) => void>();
      const store = makeMockStore({
        observeCardDidDeactivate: (cardId, callback) => {
          if (cardId === null) return () => {};
          deactivateCallbacks.set(cardId, callback);
          return () => {
            if (deactivateCallbacks.get(cardId) === callback) {
              deactivateCallbacks.delete(cardId);
            }
          };
        },
      });

      const { view } = mountWithCard({
        cardId: "card-A",
        store,
        completionProviders: PROVIDERS,
      });
      activateTypeahead(view, "@");
      expect(getCompletionState(view).active).toBe(true);

      // Simulate the deck-store firing deactivate for card-A — the
      // exact event the user would see when activating a peer card.
      const fire = deactivateCallbacks.get("card-A");
      expect(fire).toBeTypeOf("function");
      fire!("card-A");

      expect(getCompletionState(view).active).toBe(false);
    },
  );

  test(
    "deactivate cancel does not fire for a peer card's deactivation",
    () => {
      // Two cards mounted under one store. Only card-B's deactivate
      // should affect card-B's typeahead; card-A's session must
      // survive a peer-card deactivation event.
      const deactivateCallbacks = new Map<string, (cardId: string) => void>();
      const store = makeMockStore({
        observeCardDidDeactivate: (cardId, callback) => {
          if (cardId === null) return () => {};
          deactivateCallbacks.set(cardId, callback);
          return () => {
            if (deactivateCallbacks.get(cardId) === callback) {
              deactivateCallbacks.delete(cardId);
            }
          };
        },
      });

      const a = mountWithCard({
        cardId: "card-A",
        store,
        completionProviders: PROVIDERS,
      });
      const b = mountWithCard({
        cardId: "card-B",
        store,
        completionProviders: PROVIDERS,
      });
      activateTypeahead(a.view, "@");
      activateTypeahead(b.view, "@");

      // Fire deactivate for card-B only.
      deactivateCallbacks.get("card-B")!("card-B");

      expect(getCompletionState(b.view).active).toBe(false);
      expect(getCompletionState(a.view).active).toBe(true);
    },
  );

  describe("pane-collapse branch ([D06] fold-in)", () => {
    let originalRO: typeof globalThis.ResizeObserver;
    let captured: Array<{ cb: ResizeObserverCallback }> = [];

    beforeEach(() => {
      captured = [];
      originalRO = globalThis.ResizeObserver;
      class CapturingResizeObserver {
        constructor(public cb: ResizeObserverCallback) {
          captured.push({ cb });
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        CapturingResizeObserver;
    });

    afterEach(() => {
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        originalRO;
    });

    test("collapsed host (offsetHeight === 0) cancels the session", () => {
      const store = makeMockStore();
      const { view } = mountWithCard({
        cardId: "card-A",
        store,
        completionProviders: PROVIDERS,
      });
      activateTypeahead(view, "@");
      expect(getCompletionState(view).active).toBe(true);

      // The CompletionOverlay's ResizeObserver was registered against
      // the editor host on mount. happy-dom doesn't compute layout, so
      // `offsetHeight` defaults to 0 — exactly the pane-collapse signal
      // we want to assert on. Fire the captured callback synchronously
      // (real ResizeObserver delivers asynchronously, but the cancel
      // logic is synchronous given a zero-sized host).
      expect(captured.length).toBeGreaterThan(0);
      const overlayObserver = captured[captured.length - 1]!;
      overlayObserver.cb(
        [] as unknown as ResizeObserverEntry[],
        {} as ResizeObserver,
      );

      expect(getCompletionState(view).active).toBe(false);
    });

    test("non-collapsed host (offsetHeight > 0) re-anchors without cancel", () => {
      const store = makeMockStore();
      const { view } = mountWithCard({
        cardId: "card-A",
        store,
        completionProviders: PROVIDERS,
      });
      activateTypeahead(view, "@");

      // Pin the host to a non-zero size so the collapse branch is not
      // taken. The painter early-returns on inactive state, so the
      // re-anchor is a no-op observable side effect from happy-dom's
      // perspective; what we assert is that the session SURVIVES the
      // observer notification.
      const host = document.querySelector<HTMLElement>(
        '[data-slot="tug-text-editor"]',
      )!;
      Object.defineProperty(host, "offsetHeight", {
        configurable: true,
        get: () => 200,
      });
      Object.defineProperty(host, "offsetWidth", {
        configurable: true,
        get: () => 600,
      });

      const overlayObserver = captured[captured.length - 1]!;
      overlayObserver.cb(
        [] as unknown as ResizeObserverEntry[],
        {} as ResizeObserver,
      );

      expect(getCompletionState(view).active).toBe(true);
    });
  });

  test(
    "Escape keymap path still cancels the session post-migration",
    () => {
      // The migration moved the popup `<div>` to a portal but did not
      // touch the keymap. Confirm the keymap still flows: simulating
      // the keymap by calling `cancelCompletion(view)` (which is what
      // the Escape branch in `tugCompletionKeymap` invokes — see
      // completion-extension.ts) should drive the session to inactive.
      // We deliberately invoke the public function rather than
      // synthesizing a contentEditable keydown; the keymap's mapping
      // from "Escape" → `cancelCompletion(view)` is already covered by
      // tug-text-editor-completion.test.ts.
      const store = makeMockStore();
      const { view } = mountWithCard({
        cardId: "card-A",
        store,
        completionProviders: PROVIDERS,
      });
      activateTypeahead(view, "@");
      expect(getCompletionState(view).active).toBe(true);

      cancelCompletion(view);

      expect(getCompletionState(view).active).toBe(false);
    },
  );

  test(
    "TugTextEditor unmount while completion active leaves no orphaned portal",
    () => {
      const store = makeMockStore();
      const { view, unmount } = mountWithCard({
        cardId: "card-A",
        store,
        completionProviders: PROVIDERS,
      });
      activateTypeahead(view, "@");
      expect(getCompletionState(view).active).toBe(true);
      expect(findCompletionMenu()).not.toBeNull();

      unmount();

      expect(findCompletionMenu()).toBeNull();
    },
  );
});
