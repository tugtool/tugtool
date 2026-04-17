import { describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { loadCapabilitiesSnapshot } from "../../vite.config";

describe("capabilities virtual module (D6.c)", () => {
  function makeFixtureRoot(version: string, payload: string): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tugdeck-caps-"));
    fs.writeFileSync(path.join(tmp, "LATEST"), `${version}\n`, "utf-8");
    const verDir = path.join(tmp, version);
    fs.mkdirSync(verDir, { recursive: true });
    fs.writeFileSync(path.join(verDir, "system-metadata.jsonl"), payload, "utf-8");
    return tmp;
  }

  it("reads LATEST and returns the resolved snapshot content", () => {
    const payload = '{"type":"system_metadata","version":"2.1.105"}\n';
    const root = makeFixtureRoot("2.1.105", payload);
    try {
      const { content, snapshotPath, version } = loadCapabilitiesSnapshot(root);
      expect(content).toBe(payload);
      expect(version).toBe("2.1.105");
      expect(snapshotPath).toBe(path.join(root, "2.1.105", "system-metadata.jsonl"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("trims trailing whitespace from LATEST", () => {
    const payload = '{"type":"system_metadata","version":"2.1.106"}\n';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tugdeck-caps-"));
    try {
      fs.writeFileSync(path.join(tmp, "LATEST"), "  2.1.106  \n\n", "utf-8");
      const verDir = path.join(tmp, "2.1.106");
      fs.mkdirSync(verDir, { recursive: true });
      fs.writeFileSync(path.join(verDir, "system-metadata.jsonl"), payload, "utf-8");
      const { version } = loadCapabilitiesSnapshot(tmp);
      expect(version).toBe("2.1.106");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when LATEST is missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tugdeck-caps-"));
    try {
      expect(() => loadCapabilitiesSnapshot(tmp)).toThrow(/LATEST not found/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when LATEST is empty", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tugdeck-caps-"));
    try {
      fs.writeFileSync(path.join(tmp, "LATEST"), "   \n", "utf-8");
      expect(() => loadCapabilitiesSnapshot(tmp)).toThrow(/is empty/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when LATEST points at a missing version dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tugdeck-caps-"));
    try {
      fs.writeFileSync(path.join(tmp, "LATEST"), "2.9.9\n", "utf-8");
      expect(() => loadCapabilitiesSnapshot(tmp)).toThrow(
        /LATEST points at missing version 2\.9\.9/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves the real repo capabilities tree (integration)", () => {
    const { content, version } = loadCapabilitiesSnapshot();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    // Payload is a single JSONL line with type system_metadata.
    const firstLine = content.split("\n")[0];
    const parsed = JSON.parse(firstLine) as { type?: string };
    expect(parsed.type).toBe("system_metadata");
  });
});
