/**
 * Shell share gesture ([P08]) — the prompt-entry side, pinned through the
 * pure `applyShellShare` helper: the route flips to the code route and the
 * share text lands as an end-of-doc insertion (as-is on an empty editor,
 * appended on its own line over a mid-compose draft). No mounting — the
 * helper runs against a real `RouteLifecycle`.
 */
import { describe, expect, test } from "bun:test";

import { applyShellShare } from "@/components/tugways/tug-prompt-entry";
import { RouteLifecycle } from "@/lib/route-lifecycle";

const SHARE_TEXT = "```\n$ ls\nout\n[exit 0]\n```\n";

describe("applyShellShare", () => {
  test("flips the route from `$` to the code route", () => {
    const lifecycle = new RouteLifecycle("$");
    applyShellShare(lifecycle, SHARE_TEXT, { length: 0, isEffectivelyEmpty: true });
    expect(lifecycle.getRoute()).toBe("❯");
  });

  test("flips from `?` too, and is a no-op when already on code", () => {
    const fromBtw = new RouteLifecycle("?");
    applyShellShare(fromBtw, SHARE_TEXT, { length: 0, isEffectivelyEmpty: true });
    expect(fromBtw.getRoute()).toBe("❯");

    const onCode = new RouteLifecycle("❯");
    let fired = 0;
    onCode.observeRouteDidChange(() => {
      fired += 1;
    });
    applyShellShare(onCode, SHARE_TEXT, { length: 0, isEffectivelyEmpty: true });
    expect(onCode.getRoute()).toBe("❯");
    expect(fired).toBe(0);
  });

  test("empty editor: the share text is the insertion, at offset 0", () => {
    const lifecycle = new RouteLifecycle("$");
    const insertion = applyShellShare(lifecycle, SHARE_TEXT, {
      length: 0,
      isEffectivelyEmpty: true,
    });
    expect(insertion).toEqual({ from: 0, insert: SHARE_TEXT });
  });

  test("mid-compose draft: appended at end of doc on its own line, never clobbered", () => {
    const lifecycle = new RouteLifecycle("$");
    const insertion = applyShellShare(lifecycle, SHARE_TEXT, {
      length: 12,
      isEffectivelyEmpty: false,
    });
    expect(insertion).toEqual({ from: 12, insert: `\n${SHARE_TEXT}` });
  });
});
