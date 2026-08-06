/**
 * A reveal request survives the gap before the Settings card mounts.
 *
 * The contract this pins: "Review Defaults" dispatches SHOW_SETTINGS and then
 * asks for a section, and those two arrive in either order depending on
 * whether the card was already open. A request made with no card attached has
 * to be waiting when one attaches, or the reader lands on a card that is not
 * showing what they were sent to see.
 */

import { describe, test, expect } from "bun:test";

import {
  registerSettingsRevealConsumer,
  requestSettingsReveal,
} from "@/lib/settings-reveal";

describe("requestSettingsReveal", () => {
  test("a card already mounted is told straight away", () => {
    const seen: string[] = [];
    const unregister = registerSettingsRevealConsumer((s) => seen.push(s));
    requestSettingsReveal("sessionCard");
    expect(seen).toEqual(["sessionCard"]);
    unregister();
  });

  test("a request made before the card mounts is flushed on registration", () => {
    requestSettingsReveal("sessionCard");
    const seen: string[] = [];
    const unregister = registerSettingsRevealConsumer((s) => seen.push(s));
    expect(seen).toEqual(["sessionCard"]);
    unregister();
  });

  test("a flushed request is not delivered twice", () => {
    requestSettingsReveal("textCard");
    const first = registerSettingsRevealConsumer(() => {});
    first();

    const seen: string[] = [];
    const second = registerSettingsRevealConsumer((s) => seen.push(s));
    expect(seen).toEqual([]);
    second();
  });

  test("only the most recent parked request is kept", () => {
    requestSettingsReveal("textCard");
    requestSettingsReveal("general");
    const seen: string[] = [];
    const unregister = registerSettingsRevealConsumer((s) => seen.push(s));
    expect(seen).toEqual(["general"]);
    unregister();
  });

  test("an unregistered card stops hearing requests", () => {
    const seen: string[] = [];
    const unregister = registerSettingsRevealConsumer((s) => seen.push(s));
    unregister();
    requestSettingsReveal("app");
    expect(seen).toEqual([]);

    // …and the request it did not hear is waiting for the next card.
    const later: string[] = [];
    const next = registerSettingsRevealConsumer((s) => later.push(s));
    expect(later).toEqual(["app"]);
    next();
  });
});
