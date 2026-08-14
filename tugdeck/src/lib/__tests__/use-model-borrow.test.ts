/**
 * use-model-borrow.test.ts — the non-persisting model borrow.
 *
 * The property under test is a negative one: a borrow moves the live model and
 * the chip, and touches the card's remembered selector not at all. So the
 * fakes here fail the test on any write — a tugbank client whose
 * `setLocalValue` throws, and a `fetch` that throws on a PUT. A borrow that
 * quietly started routing through `setModel` would trip both.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { CapabilityModel } from "@/lib/session-metadata-store";
import { setTugbankClient } from "@/lib/tugbank-singleton";
import {
  borrowModel,
  currentModelSelector,
  evaluateMountRestore,
  hasBorrowedModel,
  releaseModel,
  resolvesToSameModel,
  type ModelBorrow,
} from "@/lib/use-model";

const CATALOG: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)", description: "Opus 5" },
  { value: "opus", displayName: "Opus", description: "Opus 5" },
  { value: "sonnet", displayName: "Sonnet", description: "Sonnet 5" },
  { value: "haiku", displayName: "Haiku", description: "Haiku 4.5" },
];

/** A catalog whose `default` is NOT the same model as `opus`. */
const SONNET_DEFAULT: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)", description: "Sonnet 5" },
  { value: "opus", displayName: "Opus", description: "Opus 5" },
  { value: "sonnet", displayName: "Sonnet", description: "Sonnet 5" },
];

/** Records what the borrow actually sent. */
function makeBorrow(cardId: string): {
  borrow: ModelBorrow;
  sent: string[];
  chip: string[];
} {
  const sent: string[] = [];
  const chip: string[] = [];
  const borrow = {
    cardId,
    codeSessionStore: {
      setModel: (selector: string) => {
        sent.push(selector);
      },
    },
    sessionMetadataStore: {
      applyModel: (selector: string) => {
        chip.push(selector);
      },
    },
  } as unknown as ModelBorrow;
  return { borrow, sent, chip };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Any tugbank write is a failure, so make one impossible to miss.
  setTugbankClient({
    // Reads are fine — the catalog is one. Writes are the failure.
    get: () => undefined,
    setLocalValue: () => {
      throw new Error("the borrow wrote to tugbank");
    },
  } as never);
  globalThis.fetch = ((url: string) => {
    throw new Error(`the borrow issued a request to ${url}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setTugbankClient(null);
});

describe("borrowModel / releaseModel", () => {
  test("a borrow sends the frame and moves the chip, and persists nothing", () => {
    const { borrow, sent, chip } = makeBorrow("card-1");
    borrowModel(borrow, "opus");
    expect(sent).toEqual(["opus"]);
    expect(chip).toEqual(["opus"]);
    expect(hasBorrowedModel("card-1")).toBe(true);
    releaseModel(borrow, "sonnet");
  });

  test("a release returns the captured selector and clears the loan", () => {
    const { borrow, sent, chip } = makeBorrow("card-2");
    borrowModel(borrow, "opus");
    releaseModel(borrow, "sonnet");
    expect(sent).toEqual(["opus", "sonnet"]);
    expect(chip).toEqual(["opus", "sonnet"]);
    expect(hasBorrowedModel("card-2")).toBe(false);
  });

  test("releasing with no captured selector is a no-op", () => {
    const { borrow, sent } = makeBorrow("card-3");
    releaseModel(borrow, null);
    expect(sent).toEqual([]);
    expect(hasBorrowedModel("card-3")).toBe(false);
  });

  test("a second release sends no second model_change", () => {
    const { borrow, sent } = makeBorrow("card-4");
    borrowModel(borrow, "opus");
    releaseModel(borrow, "sonnet");
    releaseModel(borrow, "sonnet");
    expect(sent).toEqual(["opus", "sonnet"]);
  });

  test("one card's loan does not mark another's", () => {
    const a = makeBorrow("card-5");
    const b = makeBorrow("card-6");
    borrowModel(a.borrow, "opus");
    expect(hasBorrowedModel("card-6")).toBe(false);
    expect(b.sent).toEqual([]);
    releaseModel(a.borrow, "sonnet");
  });
});

describe("resolvesToSameModel", () => {
  test("an account whose default IS opus reports no difference", () => {
    expect(resolvesToSameModel("default", "opus", CATALOG)).toBe(true);
  });

  test("an account whose default is sonnet reports a difference", () => {
    expect(resolvesToSameModel("default", "opus", SONNET_DEFAULT)).toBe(false);
  });

  test("the same model spelled two ways is the same model", () => {
    const respelled: CapabilityModel[] = [
      { value: "default", displayName: "Default", description: "Sonnet 5" },
      { value: "opus[1m]", displayName: "Opus (1M context)", description: "Opus 5" },
    ];
    expect(resolvesToSameModel("opus", "opus[1m]", respelled)).toBe(true);
  });

  test("different models are different", () => {
    expect(resolvesToSameModel("sonnet", "haiku", CATALOG)).toBe(false);
  });

  test("a spelling the catalog cannot resolve matches nothing", () => {
    expect(resolvesToSameModel("nonesuch-9", "opus", CATALOG)).toBe(false);
    expect(resolvesToSameModel("nonesuch-9", "default", CATALOG)).toBe(false);
  });
});

describe("currentModelSelector", () => {
  test("a session with no resolved model is on the account default", () => {
    expect(currentModelSelector({ models: CATALOG, model: null })).toBe("default");
  });

  test("a resolved id maps back to its selector against the live rows", () => {
    expect(currentModelSelector({ models: SONNET_DEFAULT, model: "opus" })).toBe("opus");
  });

  test("a row describing the same model as default collapses onto default", () => {
    // The account default IS Opus here, so a session resolved to Opus reads as
    // `default` — the same collapse [P03]'s comparison depends on.
    expect(currentModelSelector({ models: CATALOG, model: "opus" })).toBe("default");
  });
});

describe("evaluateMountRestore", () => {
  const ready = { models: CATALOG, model: "sonnet" };

  test("an armed mount waits", () => {
    expect(
      evaluateMountRestore({
        alreadySent: true,
        modelIsBorrowed: false,
        seedModel: "haiku",
        ...ready,
      }),
    ).toEqual({ kind: "wait" });
  });

  test("no seed, nothing to restore", () => {
    expect(
      evaluateMountRestore({
        alreadySent: false,
        modelIsBorrowed: false,
        seedModel: null,
        ...ready,
      }),
    ).toEqual({ kind: "wait" });
  });

  test("nothing known yet — do not race the spawn", () => {
    expect(
      evaluateMountRestore({
        alreadySent: false,
        modelIsBorrowed: false,
        seedModel: "sonnet",
        models: [],
        model: null,
      }),
    ).toEqual({ kind: "wait" });
  });

  test("a seed that differs from the session is restored", () => {
    expect(
      evaluateMountRestore({
        alreadySent: false,
        modelIsBorrowed: false,
        seedModel: "haiku",
        ...ready,
      }),
    ).toEqual({ kind: "restore", selector: "haiku" });
  });

  test("a seed the session already matches just arms", () => {
    expect(
      evaluateMountRestore({
        alreadySent: false,
        modelIsBorrowed: false,
        seedModel: "sonnet",
        ...ready,
      }),
    ).toEqual({ kind: "arm" });
  });

  /**
   * The interaction that would otherwise bite: readiness was never reached, so
   * the restore never armed; the borrow's own `applyModel` is what first makes
   * `model` non-null, and the effect re-runs on exactly that. Without the
   * borrow branch this is a `restore` — reverting the loan mid-review and
   * persisting the seed over it.
   */
  test("a borrow taken before the restore armed is not reverted", () => {
    const afterBorrow = {
      alreadySent: false,
      seedModel: "sonnet",
      models: [] as CapabilityModel[],
      model: "opus",
    };
    expect(evaluateMountRestore({ ...afterBorrow, modelIsBorrowed: false })).toEqual({
      kind: "restore",
      selector: "sonnet",
    });
    expect(evaluateMountRestore({ ...afterBorrow, modelIsBorrowed: true })).toEqual({
      kind: "wait",
    });
  });
});
