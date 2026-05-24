/**
 * Dispatch-wiring tests for `TideErrorBlock`.
 *
 * The wrapper is render-only — the visible behaviour (tone selection
 * via `data-tugx-error-tone`, the Retry / Copy action selection by
 * `recoverable`) is all CSS / template logic. The pinning concern at
 * this layer is dispatch wiring: `KIND_RENDERERS.error` must point
 * at the real `TideErrorBlock` so the routing test stays correct.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import { TideErrorBlock, COPIED_FLASH_MS } from "./tide-error-block";
import { KIND_RENDERERS } from "../cards/tide-assistant-renderer-dispatch";

describe("error dispatch wiring", () => {
  test("KIND_RENDERERS.error is TideErrorBlock", () => {
    expect(KIND_RENDERERS.error).toBe(TideErrorBlock);
  });

  test("COPIED_FLASH_MS is a positive integer", () => {
    expect(Number.isInteger(COPIED_FLASH_MS)).toBe(true);
    expect(COPIED_FLASH_MS).toBeGreaterThan(0);
  });
});
