/**
 * types.ts — RPC wire types for the in-app test harness.
 *
 * Mirrors Spec [#s01-rpc-protocol] from `roadmap/tugplan-in-app-bridge.md`.
 * This file is types-only — no tugdeck runtime imports, no side effects.
 * The Swift side implements the same shape informally; drift is caught
 * at handshake via `VersionSkewError`.
 *
 * Framing: newline-delimited JSON (NDJSON). Every request carries a
 * numeric `id`; the response shares it. See `./rpc.ts` for the
 * correlator and framing implementation.
 */

/**
 * Method names the harness can invoke over the bridge. Kept as a
 * string-literal union so callers get type narrowing in `switch`.
 */
export type RpcMethod =
  | "evalJS"
  | "waitForCondition"
  | "version"
  | "checkAccessibilityPermission"
  | "getElementScreenBounds"
  | "nativeClick"
  | "nativeDoubleClick"
  | "nativeRightClick"
  | "nativeDrag"
  | "nativeMouseDown"
  | "nativeMouseUp"
  | "nativeKey"
  | "nativeType"
  | "holdModifier";

/**
 * Viewport-space point passed to the native-gesture verbs. `{x, y}` is
 * in CSS viewport coords (Y-down, origin top-left of the WKWebView).
 * Swift-side `CoordMapping.viewportToScreen` does the conversion to
 * screen CG before `CGEvent.post`.
 */
export interface ViewportPoint {
  x: number;
  y: number;
}

/**
 * Accepted button-string values on the wire. The Swift side decodes
 * via `MouseButton(rawValue:)`.
 */
export type NativeMouseButton = "left" | "right";

/**
 * Accepted modifier-string values on the wire. The Swift side decodes
 * via `ModifierKey(rawValue:)`.
 */
export type NativeModifier = "cmd" | "shift" | "alt" | "ctrl";

/**
 * Inner verb envelopes nested inside a `holdModifier` request.
 * Identical to the top-level native verbs (minus `id` / `timeoutMs`)
 * since the Swift-side `executeHoldModifier` dispatches each inner
 * verb through `executeNativeVerb(_, handlers:)`.
 */
export type InnerNativeVerb =
  | {
      method: "nativeClick";
      viewportPoint: ViewportPoint;
      button?: NativeMouseButton;
      clickCount?: number;
      mouseDownDelayMs?: number;
      mouseUpDelayMs?: number;
    }
  | {
      method: "nativeDoubleClick";
      viewportPoint: ViewportPoint;
      button?: NativeMouseButton;
    }
  | {
      method: "nativeRightClick";
      viewportPoint: ViewportPoint;
    }
  | {
      method: "nativeDrag";
      from: ViewportPoint;
      to: ViewportPoint;
      button?: NativeMouseButton;
      mouseDownDelayMs?: number;
      mouseUpDelayMs?: number;
    }
  | {
      method: "nativeMouseDown";
      viewportPoint: ViewportPoint;
      button?: NativeMouseButton;
    }
  | {
      method: "nativeMouseUp";
      viewportPoint: ViewportPoint;
      button?: NativeMouseButton;
    }
  | {
      method: "nativeKey";
      key: string;
      modifiers?: readonly NativeModifier[];
    }
  | {
      method: "nativeType";
      text: string;
    };

/**
 * Screen-space rect returned by `getElementScreenBounds`. All values
 * in CG screen coords (Y-down, primary-screen-relative) — suitable
 * for passing directly to CGEvent.post via `nativeClick`'s underlying
 * machinery (tests rarely need to; prefer `app.nativeClickAtElement`
 * which routes through viewport-space internally).
 */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Result of `checkAccessibilityPermission`.
 */
export interface AccessibilityStatus {
  trusted: boolean;
  bundlePath: string;
  bundleId: string;
}

/**
 * The request shape sent from harness → Swift, NDJSON-framed. Every
 * variant carries `id` (numeric, unique per connection) and a
 * discriminating `method` string.
 */
export type Request =
  | {
      id: number;
      method: "evalJS";
      script: string;
      timeoutMs?: number;
    }
  | {
      id: number;
      method: "waitForCondition";
      script: string;
      timeoutMs?: number;
      pollMs?: number;
    }
  | {
      id: number;
      method: "version";
    }
  | {
      id: number;
      method: "checkAccessibilityPermission";
      /**
       * Whether macOS should show the "grant in System Settings"
       * dialog when the bit is missing. Default true on the first
       * call; explicit `false` allows silent re-probe after a grant.
       */
      prompt?: boolean;
    }
  | {
      id: number;
      method: "getElementScreenBounds";
      selector: string;
    }
  | {
      id: number;
      method: "nativeClick";
      viewportPoint: ViewportPoint;
      button?: NativeMouseButton;
      clickCount?: number;
      mouseDownDelayMs?: number;
      mouseUpDelayMs?: number;
    }
  | {
      id: number;
      method: "nativeDoubleClick";
      viewportPoint: ViewportPoint;
      button?: NativeMouseButton;
    }
  | {
      id: number;
      method: "nativeRightClick";
      viewportPoint: ViewportPoint;
    }
  | {
      id: number;
      method: "nativeDrag";
      from: ViewportPoint;
      to: ViewportPoint;
      button?: NativeMouseButton;
      mouseDownDelayMs?: number;
      mouseUpDelayMs?: number;
    }
  | {
      id: number;
      method: "nativeMouseDown";
      viewportPoint: ViewportPoint;
      button?: NativeMouseButton;
    }
  | {
      id: number;
      method: "nativeMouseUp";
      viewportPoint: ViewportPoint;
      button?: NativeMouseButton;
    }
  | {
      id: number;
      method: "nativeKey";
      key: string;
      modifiers?: readonly NativeModifier[];
    }
  | {
      id: number;
      method: "nativeType";
      text: string;
    }
  | {
      id: number;
      method: "holdModifier";
      modifiers: readonly NativeModifier[];
      innerVerbs: readonly InnerNativeVerb[];
    };

/**
 * Generic response shape. Discriminated on `ok`. Swift-side script
 * throws and non-serializable return values both serialize into the
 * `ok: false` branch.
 */
export type Response<T> =
  | {
      id: number;
      ok: true;
      value: T;
    }
  | {
      id: number;
      ok: false;
      error: {
        name: string;
        message: string;
        stack?: string;
      };
    };

/**
 * Options for a single `evalJS` call.
 */
export interface EvalJsOptions {
  /** Server-side hard timeout in milliseconds. Default 5000. */
  timeoutMs?: number;
}

/**
 * Options for a single `waitForCondition` call.
 */
export interface WaitForConditionOptions {
  /** Server-side overall timeout in milliseconds. Default 2000. */
  timeoutMs?: number;
  /** Poll interval in milliseconds. Default 16. */
  pollMs?: number;
}

/**
 * Options for `launchTugApp`.
 */
export interface LaunchTugAppOptions {
  /**
   * Absolute path to the Tug.app binary to launch. If unset, the
   * harness resolves a default debug build via `Tug.app/Contents/
   * MacOS/Tug` under `tugapp/` build products.
   */
  appPath?: string;

  /**
   * Socket path the harness will tell Tug.app to listen on. If unset,
   * a per-invocation uuid path under `/tmp/tugapp-test-<uuid>.sock` is
   * generated.
   */
  socketPath?: string;

  /**
   * Maximum wall-clock time to wait for the Unix socket to become
   * connectable, in milliseconds. Default 10000.
   */
  connectTimeoutMs?: number;

  /**
   * Poll interval for connect retries in milliseconds. Default 100.
   */
  connectPollMs?: number;

  /**
   * Additional environment variables to pass to the Tug.app
   * subprocess. Merged on top of the current `process.env`.
   */
  env?: Record<string, string>;

  /**
   * Test name; used for the `logs/<test-name>.log` capture path when
   * stdout/stderr redirection is enabled. Optional. When set, the
   * harness opens `tests/in-app/logs/<testName>.log` and pipes the
   * subprocess's stdout/stderr into it; `app.logPath` is populated so
   * tests can call `app.tailLog()` on failure.
   */
  testName?: string;

  /**
   * Override the harness-expected surface version for the handshake.
   * Defaults to `EXPECTED_SURFACE_VERSION` (the compile-time constant
   * in `_harness/index.ts`). Tests that want to exercise the
   * version-skew code path pass a deliberately-wrong value here; in
   * production test code this is never set.
   */
  expectedSurfaceVersion?: string;

  /**
   * Skip the `checkAccessibilityPermission` preflight during launch.
   * Defaults to false (strict) so native-gesture tests get a crisp
   * failure when the grant is missing. Tests that use only `evalJS` /
   * `waitForCondition` — e.g. the existing version-handshake /
   * double-connect / wait-for-condition harness tests — pass `true`
   * to avoid coupling those suites to the AX grant state.
   */
  skipAccessibilityPreflight?: boolean;
}
