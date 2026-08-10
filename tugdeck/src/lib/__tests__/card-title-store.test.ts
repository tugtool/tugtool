/**
 * card-title-store.test.ts — the masthead sidecar's equality guard.
 *
 * The guard is what makes a card's publish effect safe to re-run: every
 * document card republishes its whole payload on any snapshot change, and the
 * store is expected to stay silent unless something a reader could see moved.
 * A field left out of the comparison is therefore invisible in the worst way —
 * the chrome simply keeps the stale line, with nothing to log.
 */

import { describe, test, expect, afterEach } from "bun:test";

import { cardTitleStore, type DocumentMastheadPayload } from "@/lib/card-title-store";

const BASE: DocumentMastheadPayload = {
  kind: "card-masthead",
  icon: "FileText",
  title: "notes.md",
  description: "/tmp/notes.md",
  descriptionKind: "path",
  detail: "Saved",
};

/** Publish `payload` twice over, and count the notifications it drew. */
function notifiesFor(payloads: readonly DocumentMastheadPayload[]): number {
  let notifies = 0;
  const unsubscribe = cardTitleStore.subscribe(() => {
    notifies += 1;
  });
  for (const payload of payloads) cardTitleStore.set("card", payload.title, payload);
  unsubscribe();
  return notifies;
}

afterEach(() => cardTitleStore.clear("card"));

describe("the masthead equality guard", () => {
  test("an unchanged payload notifies once, not once per publish", () => {
    expect(notifiesFor([BASE, { ...BASE }, { ...BASE }])).toBe(1);
  });

  test("every displayed field is compared", () => {
    // One case per line the tier draws, plus the two attributes that decide
    // how a line is PAINTED — a stand-in rung is a different reading from a
    // real one, and a path clips at the other end from prose.
    const changed: readonly DocumentMastheadPayload[] = [
      { ...BASE, title: "other.md" },
      { ...BASE, description: "/tmp/other.md" },
      { ...BASE, detail: "Edited" },
      { ...BASE, icon: "GitCompareArrows" },
      { ...BASE, descriptionKind: "text" },
      { ...BASE, descriptionStandIn: true },
    ];
    for (const next of changed) {
      expect(notifiesFor([BASE, next]), JSON.stringify(next)).toBe(2);
    }
  });
});
