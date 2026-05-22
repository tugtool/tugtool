/**
 * `loadMermaid` — singleton + test-injection contract.
 *
 * Pure-logic checks against the loader's cache + injection surfaces;
 * no actual mermaid import (the import would trigger a heavy
 * dependency graph that adds nothing to what the loader plumbing is
 * actually pinning here). The underlying Mermaid render is exercised
 * in the MermaidBlock real-app vetting, not here.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  getMermaidSync,
  injectMermaidForTests,
  loadMermaid,
  resetMermaidForTests,
  type MermaidEngine,
} from "../load-mermaid";

function makeStubEngine(): MermaidEngine {
  return {
    async render(id, text) {
      return { svg: `<svg id="${id}">${text}</svg>`, diagramType: "flowchart" };
    },
  };
}

describe("loadMermaid", () => {
  beforeEach(() => {
    resetMermaidForTests();
  });

  test("getMermaidSync returns null before any load", () => {
    expect(getMermaidSync()).toBeNull();
  });

  test("injectMermaidForTests primes the synchronous accessor", () => {
    const engine = makeStubEngine();
    injectMermaidForTests(engine);
    expect(getMermaidSync()).toBe(engine);
  });

  test("loadMermaid returns the injected engine without a real import", async () => {
    const engine = makeStubEngine();
    injectMermaidForTests(engine);
    const got = await loadMermaid();
    expect(got).toBe(engine);
  });

  test("subsequent loadMermaid calls share the cached engine", async () => {
    const engine = makeStubEngine();
    injectMermaidForTests(engine);
    const a = await loadMermaid();
    const b = await loadMermaid();
    expect(a).toBe(b);
    expect(a).toBe(engine);
  });

  test("resetMermaidForTests clears the cache", async () => {
    injectMermaidForTests(makeStubEngine());
    expect(getMermaidSync()).not.toBeNull();
    resetMermaidForTests();
    expect(getMermaidSync()).toBeNull();
  });

  test("the stub engine's render call passes through the diagram source", async () => {
    const engine = makeStubEngine();
    injectMermaidForTests(engine);
    const got = await engine.render("test-id", "flowchart LR\nA --> B");
    expect(got.svg).toContain("test-id");
    expect(got.svg).toContain("flowchart LR\nA --> B");
  });
});
