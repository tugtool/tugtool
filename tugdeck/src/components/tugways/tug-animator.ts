/**
 * tug-animator.ts -- Programmatic animation engine for Tugways.
 *
 * Wraps the Web Animations API (WAAPI) with:
 *   - Named animation slots (WeakMap-based, GC-safe)
 *   - Three cancellation modes: snap-to-end, hold-at-current, reverse-from-current
 *   - Duration token resolution from tug-tokens.css base values, scaled by getTugTiming()
 *   - Reduced-motion awareness via isTugMotionEnabled()
 *   - Animation groups via group()
 *
 * Singleton module export pattern matching scale-timing.ts convention.
 * Callers: import { animate, group } from './tug-animator'
 *
 * Cross-reference: DURATION_TOKEN_MAP values must stay in sync with
 * tug-tokens.css --tug-base-motion-duration-* definitions.
 *
 * Re-exports physics solvers for convenience.
 */

import { getTugTiming, isTugMotionEnabled } from "./scale-timing";
export { SpringSolver, GravitySolver, FrictionSolver } from "./physics";

// ---------------------------------------------------------------------------
// Duration token lookup map
// ---------------------------------------------------------------------------

/**
 * Maps --tug-base-motion-duration-* token names to their unscaled base ms values.
 * Mirrors tug-tokens.css. Must be updated if new duration tokens are added there.
 *
 * These are base (unscaled) values. getTugTiming() is applied at call time to
 * get the final scaled duration, so runtime timing changes propagate to new
 * animations without double-scaling.
 */
export const DURATION_TOKEN_MAP: Record<string, number> = {
  "--tug-base-motion-duration-instant": 0,
  "--tug-base-motion-duration-fast": 100,
  "--tug-base-motion-duration-moderate": 200,
  "--tug-base-motion-duration-slow": 350,
  "--tug-base-motion-duration-glacial": 500,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CancelMode = "snap-to-end" | "hold-at-current" | "reverse-from-current";

/** Options for animate(). */
export interface AnimateOptions {
  /** Duration token name (e.g. '--tug-base-motion-duration-moderate') or raw ms. Default: 200ms. */
  duration?: string | number;
  /** Raw CSS easing string. Passed directly to WAAPI. Default: 'ease'. */
  easing?: string;
  /** Named slot key. If provided, a previous animation with the same key on the same element is cancelled. */
  key?: string;
  /** How to cancel the previous animation when reusing a named slot. Default: 'snap-to-end'. */
  slotCancelMode?: "snap-to-end" | "hold-at-current";
  /** WAAPI composite operation. Default: 'replace'. */
  composite?: CompositeOperation;
  /** WAAPI fill mode. Default: 'forwards'. */
  fill?: FillMode;
}

/**
 * A handle to a running animation. Wraps a WAAPI Animation object with
 * a stable .finished promise and structured cancellation modes.
 */
export interface TugAnimation {
  /**
   * Resolves when the animation completes visually.
   * - Natural completion: resolves.
   * - snap-to-end cancel: resolves (finish() resolves the WAAPI promise).
   * - hold-at-current cancel: rejects (animation is cancelled mid-flight).
   * - reverse-from-current cancel: re-wired to resolve when the reversal completes.
   */
  finished: Promise<void>;
  /**
   * Cancel with the specified mode. Defaults to 'snap-to-end'.
   * opts.reverseEasing: CSS easing for the reverse animation (reverse-from-current only).
   */
  cancel(
    mode?: CancelMode,
    opts?: { reverseEasing?: string }
  ): void;
  /** The underlying WAAPI Animation object (escape hatch). */
  raw: Animation;
}

/**
 * A coordinated group of animations. All animations share default duration/easing
 * but can be individually overridden. group.finished resolves when ALL complete.
 */
export interface TugAnimationGroup {
  /** Add an animation to this group. Returns TugAnimation for individual control. */
  animate(
    el: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    options?: AnimateOptions
  ): TugAnimation;
  /** Resolves when ALL animations in the group complete (Promise.all semantics). */
  finished: Promise<void>;
  /** Cancel all animations in the group. */
  cancel(mode?: CancelMode): void;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * Tracks named animation slots per element.
 * WeakMap keys are held weakly -- GC'd elements don't leak slot maps.
 * Declared with `let` so _resetSlots() can replace it (WeakMap has no .clear()).
 */
let _slots: WeakMap<Element, Map<string, TugAnimation>> = new WeakMap();

/** Spatial CSS properties that trigger reduced-motion replacement. */
const SPATIAL_PROPERTIES = new Set([
  "transform",
  "translate",
  "translateX",
  "translateY",
  "scale",
  "scaleX",
  "scaleY",
  "rotate",
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a duration option (token string or raw ms) to a scaled ms value.
 * Applies getTugTiming() exactly once.
 */
function resolveDuration(duration: string | number | undefined): number {
  const timing = getTugTiming();
  if (duration === undefined) {
    return 200 * timing; // default: moderate
  }
  if (typeof duration === "string") {
    if (!(duration in DURATION_TOKEN_MAP)) {
      throw new Error(
        `TugAnimator: unrecognized duration token "${duration}". ` +
          `Valid tokens: ${Object.keys(DURATION_TOKEN_MAP).join(", ")}`
      );
    }
    return DURATION_TOKEN_MAP[duration] * timing;
  }
  return duration * timing;
}

/**
 * Check whether a keyframes argument contains any spatial properties.
 * Handles both Keyframe[] and PropertyIndexedKeyframes formats.
 */
function hasSpatialProperties(
  keyframes: Keyframe[] | PropertyIndexedKeyframes
): boolean {
  if (Array.isArray(keyframes)) {
    return keyframes.some((kf) =>
      Object.keys(kf).some((k) => SPATIAL_PROPERTIES.has(k))
    );
  }
  return Object.keys(keyframes).some((k) => SPATIAL_PROPERTIES.has(k));
}

/**
 * Extract the "start values" snapshot from keyframes for reverse-from-current support.
 * Returns a Record<string, string> with the first value of each animated property.
 */
function extractStartValues(
  keyframes: Keyframe[] | PropertyIndexedKeyframes
): Record<string, string> {
  const result: Record<string, string> = {};
  if (Array.isArray(keyframes)) {
    if (keyframes.length === 0) return result;
    const first = keyframes[0];
    for (const [k, v] of Object.entries(first)) {
      if (k !== "offset" && k !== "easing" && k !== "composite") {
        result[k] = String(v);
      }
    }
  } else {
    for (const [k, v] of Object.entries(keyframes)) {
      if (k !== "offset" && k !== "easing" && k !== "composite") {
        const arr = Array.isArray(v) ? v : [v];
        if (arr.length > 0) {
          result[k] = String(arr[0]);
        }
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core animate() implementation
// ---------------------------------------------------------------------------

/**
 * Animate an element using WAAPI, with named slots, cancellation modes,
 * token-aware duration, and reduced-motion awareness.
 */
export function animate(
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options?: AnimateOptions
): TugAnimation {
  const {
    duration,
    easing,
    key,
    slotCancelMode = "snap-to-end",
    composite = "replace",
    fill = "forwards",
  } = options ?? {};

  // Reduced-motion: replace spatial keyframes with opacity fade.
  let resolvedKeyframes = keyframes;
  let resolvedDuration: number;

  if (!isTugMotionEnabled() && hasSpatialProperties(keyframes)) {
    resolvedKeyframes = [{ opacity: 0 }, { opacity: 1 }];
    resolvedDuration = resolveDuration("--tug-base-motion-duration-fast");
  } else {
    resolvedDuration = resolveDuration(duration);
  }

  // Named slot: cancel existing animation for this key on this element.
  if (key !== undefined) {
    const slotMap = _slots.get(el);
    if (slotMap !== undefined) {
      const existing = slotMap.get(key);
      if (existing !== undefined) {
        if (slotCancelMode === "hold-at-current") {
          // Absorb the expected rejection before cancelling.
          existing.finished.catch(() => {
            /* intentional no-op: rejection is expected on hold-at-current */
          });
          existing.cancel("hold-at-current");
        } else {
          existing.cancel("snap-to-end");
        }
      }
    }
  }

  // Store start values for reverse-from-current support.
  const startValues = extractStartValues(resolvedKeyframes);

  // Create the WAAPI animation.
  const wapiAnim = el.animate(resolvedKeyframes, {
    duration: resolvedDuration,
    easing: easing ?? "ease",
    composite,
    fill,
  });

  // Build a stable .finished promise that the TugAnimation owns.
  // We wrap the WAAPI .finished so we can re-wire it for reverse-from-current.
  let resolveFinished!: () => void;
  let rejectFinished!: (reason?: unknown) => void;
  let finishedPromise = new Promise<void>((res, rej) => {
    resolveFinished = res;
    rejectFinished = rej;
  });

  // Wire the WAAPI animation's .finished to our promise.
  wapiAnim.finished.then(
    () => resolveFinished(),
    (err) => rejectFinished(err)
  );

  // Build the TugAnimation wrapper.
  const tugAnim: TugAnimation = {
    get finished() {
      return finishedPromise;
    },
    raw: wapiAnim,
    cancel(mode: CancelMode = "snap-to-end", opts?: { reverseEasing?: string }) {
      switch (mode) {
        case "snap-to-end":
          wapiAnim.finish();
          break;

        case "hold-at-current":
          wapiAnim.commitStyles();
          wapiAnim.cancel();
          break;

        case "reverse-from-current": {
          // Bake current interpolated values into inline styles.
          wapiAnim.commitStyles();
          // Read current computed values for each animated property.
          const computed = getComputedStyle(el);
          const currentValues: Record<string, string> = {};
          for (const prop of Object.keys(startValues)) {
            currentValues[prop] = computed.getPropertyValue(prop) || (computed as unknown as Record<string, string>)[prop] || "";
          }

          // Silence the original finishedPromise (P1) before cancelling the
          // underlying WAAPI animation. wapiAnim.cancel() synchronously rejects
          // P1 via the wired .then() handler; without this guard P1 would be an
          // orphaned rejected promise and bun/Node would surface an unhandled
          // rejection error. Analogous to the .catch() guard used for
          // slotCancelMode 'hold-at-current'. [D05]
          finishedPromise.catch(() => {
            /* intentional no-op: rejection is expected and handled below */
          });
          // Null out the callbacks so they cannot fire into the stale P1 after
          // we replace finishedPromise with the re-wired promise below.
          resolveFinished = () => { /* no-op: P1 abandoned */ };
          rejectFinished = () => { /* no-op: P1 abandoned */ };

          // Cancel the original animation.
          wapiAnim.cancel();

          // Start a new reversal animation: from current values back to start values.
          const reverseKeyframes: Keyframe[] = [
            { ...currentValues },
            { ...startValues },
          ];
          const reversalWapi = el.animate(reverseKeyframes, {
            duration: resolvedDuration,
            easing: opts?.reverseEasing ?? "ease",
            composite,
            fill,
          });

          // Re-wire .finished to resolve when the reversal completes.
          finishedPromise = new Promise<void>((res, rej) => {
            reversalWapi.finished.then(
              () => res(),
              (err) => rej(err)
            );
          });
          break;
        }
      }
    },
  };

  // Register in named slot map.
  if (key !== undefined) {
    let slotMap = _slots.get(el);
    if (slotMap === undefined) {
      slotMap = new Map();
      _slots.set(el, slotMap);
    }
    slotMap.set(key, tugAnim);
  }

  // On natural completion, remove from slot map.
  if (key !== undefined) {
    wapiAnim.finished.then(
      () => {
        const slotMap = _slots.get(el);
        if (slotMap !== undefined) {
          slotMap.delete(key);
          if (slotMap.size === 0) {
            _slots.delete(el);
          }
        }
      },
      () => {
        /* cancelled -- slot may have already been replaced; do not remove */
      }
    );
  }

  return tugAnim;
}

// ---------------------------------------------------------------------------
// group() implementation
// ---------------------------------------------------------------------------

/**
 * Create an animation group. All animations added via group.animate() share
 * the group's default duration and easing, with per-animation overrides supported.
 * group.finished resolves when ALL constituent animations complete.
 */
export function group(options?: {
  duration?: string | number;
  easing?: string;
}): TugAnimationGroup {
  const groupDuration = options?.duration;
  const groupEasing = options?.easing;
  const animations: TugAnimation[] = [];
  let finishedPromise: Promise<void> = Promise.resolve();

  const g: TugAnimationGroup = {
    animate(
      el: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes,
      animOptions?: AnimateOptions
    ): TugAnimation {
      const merged: AnimateOptions = {
        duration: groupDuration,
        easing: groupEasing,
        ...animOptions,
      };
      const tugAnim = animate(el, keyframes, merged);
      animations.push(tugAnim);
      // Rebuild finished as Promise.all over all accumulated .finished promises.
      finishedPromise = Promise.all(
        animations.map((a) => a.finished)
      ).then(() => undefined);
      return tugAnim;
    },

    get finished(): Promise<void> {
      return finishedPromise;
    },

    cancel(mode: CancelMode = "snap-to-end"): void {
      for (const anim of animations) {
        anim.cancel(mode);
      }
    },
  };

  return g;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset the module-level named slot WeakMap. Call in afterEach to prevent
 * cross-test pollution. Test-only -- do not call in production code.
 */
export function _resetSlots(): void {
  _slots = new WeakMap();
}
