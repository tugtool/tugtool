/**
 * `loadKaTeX` — singleton + test-injection contract.
 *
 * Pure-logic checks against the loader's cache + injection surfaces;
 * no actual katex import (the import would trigger a CSS load that
 * jsdom isn't set up for, and the loader's *plumbing* is what we
 * need to pin — the underlying katex render is exercised in the
 * KaTeXBlock real-app vetting, not here).
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  getKaTeXSync,
  injectKaTeXForTests,
  loadKaTeX,
  resetKaTeXForTests,
  type KaTeXEngine,
} from "../load-katex";

function makeStubEngine(): KaTeXEngine {
  return {
    render(_source, el) {
      el.textContent = "STUB_RENDER";
    },
    renderToString() {
      return "<span class=\"katex-stub\">stub</span>";
    },
  };
}

describe("loadKaTeX", () => {
  beforeEach(() => {
    resetKaTeXForTests();
  });

  test("getKaTeXSync returns null before any load", () => {
    expect(getKaTeXSync()).toBeNull();
  });

  test("injectKaTeXForTests primes the synchronous accessor", () => {
    const engine = makeStubEngine();
    injectKaTeXForTests(engine);
    expect(getKaTeXSync()).toBe(engine);
  });

  test("loadKaTeX returns the injected engine without a real import", async () => {
    const engine = makeStubEngine();
    injectKaTeXForTests(engine);
    const got = await loadKaTeX();
    expect(got).toBe(engine);
  });

  test("subsequent loadKaTeX calls share the cached engine", async () => {
    const engine = makeStubEngine();
    injectKaTeXForTests(engine);
    const a = await loadKaTeX();
    const b = await loadKaTeX();
    expect(a).toBe(b);
    expect(a).toBe(engine);
  });

  test("resetKaTeXForTests clears the cache", async () => {
    injectKaTeXForTests(makeStubEngine());
    expect(getKaTeXSync()).not.toBeNull();
    resetKaTeXForTests();
    expect(getKaTeXSync()).toBeNull();
  });
});
