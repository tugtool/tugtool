/**
 * Height-fraction persistence for the TugSheet `shade` presentation —
 * the same `persistKey` semantics the retired TugShade carried: reads
 * clamp and validate, writes land in the tugbank cache optimistically,
 * and shades sharing a key share a height.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { TugbankClient } from "@/lib/tugbank-client";
import { setTugbankClient } from "@/lib/tugbank-singleton";
import {
  DEFAULT_SHADE_FRAC,
  SHADE_HEIGHT_DOMAIN,
  clampShadeFrac,
  readPersistedShadeFrac,
  writePersistedShadeFrac,
} from "@/components/tugways/shade-height";

/** In-memory tugbank stand-in exposing the three methods the module uses. */
function fakeClient() {
  const values = new Map<string, unknown>();
  const listeners = new Set<(domain: string) => void>();
  const client = {
    getValue: (domain: string, key: string) => values.get(`${domain}/${key}`),
    setLocalValue: (
      domain: string,
      key: string,
      value: { kind: string; value: unknown },
    ) => {
      values.set(`${domain}/${key}`, value.value);
      for (const l of [...listeners]) l(domain);
    },
    onDomainChanged: (cb: (domain: string) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { client: client as unknown as TugbankClient, values };
}

afterEach(() => {
  setTugbankClient(null);
});

describe("shade height persistence", () => {
  test("write → read round-trips through the tugbank cache", () => {
    const { client, values } = fakeClient();
    setTugbankClient(client);

    expect(readPersistedShadeFrac("session-card")).toBeNull();
    writePersistedShadeFrac("session-card", 0.42);
    expect(values.get(`${SHADE_HEIGHT_DOMAIN}/session-card`)).toBe(0.42);
    expect(readPersistedShadeFrac("session-card")).toBe(0.42);

    // Shades sharing a persistKey share the height; other keys are distinct.
    expect(readPersistedShadeFrac("other-key")).toBeNull();
  });

  test("reads clamp and reject invalid stored values", () => {
    const { client } = fakeClient();
    setTugbankClient(client);

    writePersistedShadeFrac("k", 7);
    expect(readPersistedShadeFrac("k")).toBe(1);
    writePersistedShadeFrac("k", 0.01);
    expect(readPersistedShadeFrac("k")).toBe(0.1);

    // A non-numeric stored value reads as unset (the default applies).
    (client as unknown as { setLocalValue: (d: string, k: string, v: { kind: string; value: unknown }) => void }).setLocalValue(
      SHADE_HEIGHT_DOMAIN,
      "k",
      { kind: "json", value: "mangled" },
    );
    expect(readPersistedShadeFrac("k")).toBeNull();
  });

  test("no client → reads null, default fraction stands", () => {
    setTugbankClient(null);
    expect(readPersistedShadeFrac("session-card")).toBeNull();
    expect(clampShadeFrac(DEFAULT_SHADE_FRAC)).toBe(DEFAULT_SHADE_FRAC);
  });
});
