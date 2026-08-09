/**
 * The grep gate `session-identity.ts` promises: no component calls
 * `resolveSessionIdentity`.
 *
 * The imperative resolver exists for non-React projections (transcript export,
 * the test surface). A component that called it would read the identity stores
 * without subscribing to them, and its label would go stale the moment a tag
 * rerolled or a synopsis landed — `useSessionIdentity` is the only door into
 * React ([L02]). This test is the enforcement the module's header names.
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS_DIR = join(import.meta.dir, "..", "..", "components");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield path;
    }
  }
}

test("no component calls resolveSessionIdentity — useSessionIdentity is the only door", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(COMPONENTS_DIR)) {
    if (readFileSync(file, "utf8").includes("resolveSessionIdentity")) {
      offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});
