/**
 * perf-monitor — dev/test-build main-thread health sentinel.
 *
 * Watches for the two symptoms every perf regression in the deck
 * eventually shows: LONG TASKS (main-thread stalls a keystroke or a
 * frame would queue behind) and MISSED IDLE (work happening when the
 * app should be doing nothing). Findings land in two places:
 *
 *  - counters, readable via {@link getPerfMonitorSnapshot} — a FRESH
 *    object per call (uptimeMs advances every read), for pull-cadence
 *    probes: app-tests via `window.tugPerfMonitor`, or a future
 *    DevPanel Telemetry tile polling on its own timer. NOT an [L02]
 *    `useSyncExternalStore` snapshot — wiring it into uSES as-is would
 *    loop; a React consumer needs a cached/versioned snapshot first;
 *  - the dev log (`tugDevLogStore`, source `"perf"`) — one entry per
 *    stall at `warn` for ≥{@link STALL_WARN_MS}, `debug` below it — so
 *    the Log section timeline correlates stalls with whatever else was
 *    happening.
 *
 * Detection is two-pronged:
 *
 *  1. A `PerformanceObserver` on `longtask` entries where the engine
 *     supports them (feature-detected via `supportedEntryTypes`).
 *  2. A 1 Hz heartbeat that measures timer drift: a `setTimeout(1000)`
 *     that fires at +1240ms implies ~240ms of continuous main-thread
 *     occupancy. This is deliberately coarse — it exists because WebKit
 *     has not historically exposed `longtask` — and its threshold
 *     ({@link DRIFT_STALL_MS}) sits above scheduler jitter.
 *
 * The monitor runs ONLY in dev builds and app-test mode
 * (`window.__tugTestMode`): a production deck must not carry a
 * perpetual 1 Hz wakeup — the idle-zero-burn budget below applies to
 * the product, and the monitor must never violate the thing it guards.
 *
 * ## Budgets (the no-perceivable-lag contract)
 *
 *  - IDLE: with sessions mounted and nothing streaming, the main
 *    thread does no long tasks — zero stalls per idle minute (pinned
 *    by app-test at0230's idle-quiet window).
 *  - INPUT: a keystroke's synchronous work fits in one display frame
 *    (≤16ms) even while other cards stream.
 *  - STREAMING: React notification cadence per store is bounded by
 *    LIVE_NOTIFY_MIN_MS (~one frame), never per-token.
 *  - MOTION: every long-running animation is compositor-resident —
 *    see {@link animationCensus}, which is that contract in executable
 *    form.
 *
 * @module lib/perf-monitor
 */

import { tugDevLogStore } from "./tug-dev-log-store/tug-dev-log-store";

/** Heartbeat period — also the drift-measurement baseline. */
const HEARTBEAT_MS = 1_000;
/** Drift below this is scheduler jitter, not a stall. */
const DRIFT_STALL_MS = 80;
/** Stalls at/above this log at `warn`; below, `debug`. */
const STALL_WARN_MS = 150;

export interface PerfMonitorSnapshot {
  /** `longtask` entries observed (0 forever when unsupported). */
  longTasks: number;
  /** Longest single `longtask`, ms. */
  worstLongTaskMs: number;
  /** Heartbeat drift stalls (≥ {@link DRIFT_STALL_MS}). */
  driftStalls: number;
  /** Worst heartbeat drift, ms. */
  worstDriftMs: number;
  /** Whether the engine exposes `longtask` entries. */
  longTaskSupported: boolean;
  /** ms since the monitor started. */
  uptimeMs: number;
}

let snapshot: PerfMonitorSnapshot = {
  longTasks: 0,
  worstLongTaskMs: 0,
  driftStalls: 0,
  worstDriftMs: 0,
  longTaskSupported: false,
  uptimeMs: 0,
};
let startedAt = 0;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let observer: PerformanceObserver | null = null;

/** Current counters. Fresh object per call is fine here — the reader is
 *  a probe (an app-test, a DevPanel tile pulling on its own cadence),
 *  not a `useSyncExternalStore` subscriber. */
export function getPerfMonitorSnapshot(): PerfMonitorSnapshot {
  return {
    ...snapshot,
    uptimeMs: startedAt === 0 ? 0 : performance.now() - startedAt,
  };
}

function recordStall(kind: "longtask" | "drift", ms: number): void {
  const level = ms >= STALL_WARN_MS ? "warn" : "debug";
  tugDevLogStore[level]("perf", `main-thread stall (${kind})`, {
    ms: Math.round(ms),
  });
}

/**
 * Start the monitor. Idempotent; safe to call from boot. The caller
 * gates on dev/test mode — see the module docstring for why production
 * never runs this.
 */
export function startPerfMonitor(): void {
  if (startedAt !== 0) return;
  startedAt = performance.now();

  const supported =
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false);
  snapshot = { ...snapshot, longTaskSupported: supported };
  if (supported) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        snapshot = {
          ...snapshot,
          longTasks: snapshot.longTasks + 1,
          worstLongTaskMs: Math.max(snapshot.worstLongTaskMs, entry.duration),
        };
        recordStall("longtask", entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  }

  let expectedAt = performance.now() + HEARTBEAT_MS;
  const beat = (): void => {
    const drift = performance.now() - expectedAt;
    if (drift >= DRIFT_STALL_MS) {
      snapshot = {
        ...snapshot,
        driftStalls: snapshot.driftStalls + 1,
        worstDriftMs: Math.max(snapshot.worstDriftMs, drift),
      };
      recordStall("drift", drift);
    }
    expectedAt = performance.now() + HEARTBEAT_MS;
    heartbeatTimer = setTimeout(beat, HEARTBEAT_MS);
  };
  heartbeatTimer = setTimeout(beat, HEARTBEAT_MS);
}

// MARK: - Animation census (the motion-residency detector)

/**
 * An animation is long-running once it outlasts this many milliseconds
 * of total playtime; infinite-iteration loops always qualify.
 */
const LONG_RUN_MS = 5_000;

/** The only two properties WebKit can hand to the compositor. */
const ACCELERATED_PROPERTIES = new Set(["transform", "opacity"]);

/** `getKeyframes()` keys that describe the keyframe, not a property. */
const KEYFRAME_METADATA_KEYS = new Set([
  "offset",
  "computedOffset",
  "easing",
  "composite",
]);

/** How many retained-transition targets the census names before eliding. */
const RETAINED_TARGET_LIMIT = 10;

export interface AnimationCensusEntry {
  /** `animation-name` for CSS loops; the WAAPI `id` (or `<waapi>`) otherwise. */
  name: string;
  /** `css` for `CSSAnimation`, `waapi` for a script-driven `Animation`. */
  kind: "css" | "waapi";
  /** `tag.class.class` of the effect target, plus any pseudo-element suffix. */
  target: string;
  /** Properties this animation's keyframes touch. */
  properties: string[];
  /** Properties every OTHER animation on the same box touches. */
  coAnimatedProperties: string[];
  playState: string;
  /** `Infinity` serializes as `null` through the app-test JSON bridge. */
  iterations: number | null;
  durationMs: number | null;
  /**
   * Every distinct timing function on the animation — the animation-level
   * easing plus each keyframe's — so a census reader never has to re-derive
   * what the compositor was asked to run.
   */
  timingFunctions: string[];
  /** Whether the effect target is an SVG element (never accelerable). */
  svgTarget: boolean;
  /** One line per broken rule of the residency contract; empty = compliant. */
  violations: string[];
}

export interface AnimationCensus {
  /** Every animation `document.getAnimations()` reported, in scope. */
  total: number;
  /** How many of those are long-running per the contract. */
  longRunning: number;
  /** Long-running animations, compliant and not. */
  entries: AnimationCensusEntry[];
  /**
   * The entries with a non-empty `violations` list — plus, when finished
   * transitions are retained at rest, one synthetic `<retained-transitions>`
   * entry, so a single `violations`-is-empty assertion gates hygiene too.
   */
  violations: AnimationCensusEntry[];
  /**
   * Finished `CSSTransition`s still present in `getAnimations()` at census
   * time. WebKit retains them, and the animation controller iterates the
   * retained list on every rendering update — so a population of these at
   * rest is a standing per-frame tax. A non-zero count means some component
   * wrote a transitioned property through a live `transition` outside a
   * designed crossing (the mount-write defect measured 2026-07-29: 415
   * retained transitions on one restored transcript card).
   */
  retainedTransitions: { count: number; targets: string[] };
}

function describeTarget(target: Element, pseudo: string | null): string {
  const tag = target.tagName.toLowerCase();
  const classes = Array.from(target.classList);
  const head = classes.length > 0 ? `${tag}.${classes.join(".")}` : tag;
  return pseudo !== null && pseudo !== "" ? `${head}${pseudo}` : head;
}

function keyframeProperties(effect: KeyframeEffect): string[] {
  const props = new Set<string>();
  for (const frame of effect.getKeyframes()) {
    for (const key of Object.keys(frame)) {
      if (!KEYFRAME_METADATA_KEYS.has(key)) props.add(key);
    }
  }
  return Array.from(props).sort();
}

function isLongRunning(effect: KeyframeEffect): boolean {
  const timing = effect.getTiming();
  const iterations = timing.iterations ?? 1;
  if (iterations === Infinity) return true;
  const duration = typeof timing.duration === "number" ? timing.duration : 0;
  return duration * iterations > LONG_RUN_MS;
}

/** Every distinct easing an effect carries: animation-level + per-keyframe. */
function effectTimingFunctions(effect: KeyframeEffect): string[] {
  const easings = new Set<string>();
  const animationEasing = effect.getTiming().easing;
  if (typeof animationEasing === "string") easings.add(animationEasing);
  for (const frame of effect.getKeyframes()) {
    if (typeof frame.easing === "string") easings.add(frame.easing);
  }
  return Array.from(easings).sort();
}

/**
 * The violation line for a timing function the compositor cannot express,
 * or `null` for one it can. Core Animation expresses a segment's easing as
 * a cubic Bézier; a `linear()` with more than two stops is not one, and
 * WebKit answers by declining to accelerate the whole animation — blending
 * it on the main thread, every element, every frame. A two-stop
 * `linear(0, 1)` IS the `linear` keyword and passes. `steps()` passes too:
 * measured 2026-07-29 (caret-blink A/B: 1.6% steps / 1.3% linear / 1.4%
 * none — noise), WebKit accelerates it, so the rule set needs no steps()
 * clause.
 */
function easingViolation(easing: string): string | null {
  const trimmed = easing.trim();
  if (!trimmed.startsWith("linear(")) return null;
  const inner = trimmed.slice("linear(".length, trimmed.lastIndexOf(")"));
  const stops = inner.split(",").map((stop) => stop.trim());
  if (stops.length <= 2) return null;
  const shown =
    stops.length > 4 ? `${stops.slice(0, 4).join(", ")}, …` : stops.join(", ");
  return (
    `blends on the main thread: \`linear(${shown})\` ` +
    `(${stops.length} stops) is not a cubic Bézier`
  );
}

/**
 * Inventory every long-running animation in the document and judge it
 * against the compositor-residency contract. The rules checked here ARE
 * that contract — there is no doctrine document yet, so this function and
 * the app-tests that assert on it (at0288, at0289) are where it lives:
 * only `transform`/`opacity`, only on an `HTMLElement`, no co-animated
 * property on the same box, and every timing function expressible as a
 * cubic Bézier (a multi-stop `linear()` demotes the whole animation to
 * main-thread blending; `steps()` does not — measured 2026-07-29, so the
 * rule set carries no steps() clause).
 *
 * This is the shared implementation behind the residency app-test and
 * any future DevPanel tile — a violation names itself, so a regression
 * fails with the offending animation and target in the message.
 *
 * `CSSTransition`s are excluded from the long-running entries: they are
 * finite by construction and so fall outside that contract. They are
 * enumerated for exactly one thing — `retainedTransitions`, the count of
 * FINISHED transitions still present in `getAnimations()` at census time,
 * which is a hygiene violation on its own (see the field's doc). Every
 * other `Animation` is in scope, WAAPI loops included — a script-driven
 * loop is no cheaper than a CSS one.
 *
 * @param options.within CSS selector; when given, only animations whose
 *   target sits inside a matching element are censused (the collapse-
 *   dormancy assertion scopes to one pane this way).
 */
export function animationCensus(options?: { within?: string }): AnimationCensus {
  const scope =
    options?.within !== undefined
      ? document.querySelector(options.within)
      : null;
  if (options?.within !== undefined && scope === null) {
    return {
      total: 0,
      longRunning: 0,
      entries: [],
      violations: [],
      retainedTransitions: { count: 0, targets: [] },
    };
  }

  const retained = { count: 0, targets: [] as string[] };
  const all = document.getAnimations().filter((animation) => {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || effect.target === null) {
      return false;
    }
    if (scope !== null && !scope.contains(effect.target)) return false;
    if (
      typeof CSSTransition !== "undefined" &&
      animation instanceof CSSTransition
    ) {
      if (animation.playState === "finished") {
        retained.count += 1;
        if (retained.targets.length < RETAINED_TARGET_LIMIT) {
          const label = describeTarget(effect.target, effect.pseudoElement);
          if (!retained.targets.includes(label)) retained.targets.push(label);
        }
      }
      return false;
    }
    return true;
  });

  // Every property animated on each (element, pseudo) box, across ALL
  // animations — WebKit evaluates acceleration over the whole keyframe
  // effect stack, so one stray property demotes its neighbours too.
  const boxProperties = new Map<Element, Map<string, Set<string>>>();
  const propertiesForBox = (
    target: Element,
    pseudo: string | null,
  ): Set<string> => {
    let byPseudo = boxProperties.get(target);
    if (byPseudo === undefined) {
      byPseudo = new Map<string, Set<string>>();
      boxProperties.set(target, byPseudo);
    }
    const key = pseudo ?? "";
    let props = byPseudo.get(key);
    if (props === undefined) {
      props = new Set<string>();
      byPseudo.set(key, props);
    }
    return props;
  };
  for (const animation of all) {
    const effect = animation.effect as KeyframeEffect;
    const props = propertiesForBox(
      effect.target as Element,
      effect.pseudoElement,
    );
    for (const prop of keyframeProperties(effect)) props.add(prop);
  }

  const entries: AnimationCensusEntry[] = [];
  for (const animation of all) {
    const effect = animation.effect as KeyframeEffect;
    if (!isLongRunning(effect)) continue;
    const target = effect.target as Element;
    const properties = keyframeProperties(effect);
    const box = propertiesForBox(target, effect.pseudoElement);
    const coAnimated = Array.from(box)
      .filter((prop) => !properties.includes(prop))
      .sort();
    const svgTarget = !(target instanceof HTMLElement);
    const timingFunctions = effectTimingFunctions(effect);
    const timing = effect.getTiming();
    const iterations = timing.iterations ?? 1;
    const duration = timing.duration;

    const violations: string[] = [];
    const offending = properties.filter(
      (prop) => !ACCELERATED_PROPERTIES.has(prop),
    );
    if (offending.length > 0) {
      violations.push(`animates ${offending.join(", ")}`);
    }
    if (svgTarget) {
      violations.push("targets an SVG element (never accelerated)");
    }
    const offendingNeighbours = coAnimated.filter(
      (prop) => !ACCELERATED_PROPERTIES.has(prop),
    );
    if (offendingNeighbours.length > 0) {
      violations.push(
        `shares its box with ${offendingNeighbours.join(", ")}`,
      );
    }
    for (const easing of timingFunctions) {
      const violation = easingViolation(easing);
      if (violation !== null) violations.push(violation);
    }

    entries.push({
      name:
        typeof CSSAnimation !== "undefined" && animation instanceof CSSAnimation
          ? animation.animationName
          : animation.id !== ""
            ? animation.id
            : "<waapi>",
      kind:
        typeof CSSAnimation !== "undefined" && animation instanceof CSSAnimation
          ? "css"
          : "waapi",
      target: describeTarget(target, effect.pseudoElement),
      properties,
      coAnimatedProperties: coAnimated,
      playState: animation.playState,
      iterations: iterations === Infinity ? null : iterations,
      durationMs: typeof duration === "number" ? duration : null,
      timingFunctions,
      svgTarget,
      violations,
    });
  }

  const violations = entries.filter((entry) => entry.violations.length > 0);
  if (retained.count > 0) {
    violations.push({
      name: "<retained-transitions>",
      kind: "css",
      target: retained.targets.join(", "),
      properties: [],
      coAnimatedProperties: [],
      playState: "finished",
      iterations: null,
      durationMs: null,
      timingFunctions: [],
      svgTarget: false,
      violations: [
        `${retained.count} finished transition(s) retained at rest — ` +
          `a transitioned property was written through a live transition ` +
          `outside a designed crossing`,
      ],
    });
  }

  return {
    total: all.length,
    longRunning: entries.length,
    entries,
    violations,
    retainedTransitions: retained,
  };
}

// MARK: - Layer-tree probe (what a dirty frame costs to walk)

/**
 * `contain` values that establish a containment boundary the compositing
 * walk can stop at. `size` alone does not.
 */
const CONTAINMENT_VALUES = ["paint", "layout", "strict", "content"];

/** Selector path segments are capped so the deepest chain stays readable. */
const CHAIN_PATH_LIMIT = 24;

/** How many stacking-context creator classes the histogram reports. */
const STACKING_HISTOGRAM_LIMIT = 15;

export interface LayerTreeProbe {
  /** Every element in the document, root included. */
  elements: number;
  /** Depth of the deepest element, counting the root as 1. */
  maxDepth: number;
  /** Mean element depth — the multiplier on every ancestor walk. */
  meanDepth: number;
  /** Elements at each depth, bucketed by tens (`"0-9"`, `"10-19"`, …). */
  depthHistogram: Record<string, number>;
  /** Elements that establish a stacking context. */
  stackingContexts: number;
  /**
   * The stacking-context creators bucketed by `tag.class.class` (first two
   * classes), most numerous first, capped at
   * {@link STACKING_HISTOGRAM_LIMIT} buckets. This is what names a breadth
   * regression: 438 dots × 3 contexts each reads as three buckets at 438,
   * not as an anonymous total.
   */
  stackingHistogram: [string, number][];
  /** Depth of the deepest stacking-context CHAIN (nested contexts). */
  maxStackingDepth: number;
  /** Selector path of that deepest chain, outermost first. */
  deepestStackingPath: string[];
  /** Elements carrying a standing (non-`auto`) `will-change`. */
  willChange: number;
  /** Elements carrying a paint/layout `contain`. */
  contained: number;
  /** Elements whose computed `transform` is a 3D one (forces a layer). */
  transform3d: number;
}

function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id !== "" ? `#${element.id}` : "";
  const classes = Array.from(element.classList).slice(0, 3);
  return `${tag}${id}${classes.length > 0 ? `.${classes.join(".")}` : ""}`;
}

/**
 * Whether an element establishes a stacking context. The list follows
 * the CSS spec's triggers, minus the ones that cannot occur in the deck
 * (`-webkit-overflow-scrolling`, SVG-only cases). A stacking context is
 * what makes `RenderLayerCompositor::computeCompositingRequirements`
 * recurse, so counting them counts the walk's branching.
 */
function establishesStackingContext(
  element: Element,
  style: CSSStyleDeclaration,
): boolean {
  // No box, no context: a display: none subtree contributes nothing to the
  // compositing walk regardless of what its computed style would trigger.
  if (style.display === "none") return false;
  if (element === document.documentElement) return true;
  const position = style.position;
  if (
    (position === "absolute" || position === "relative") &&
    style.zIndex !== "auto"
  ) {
    return true;
  }
  if (position === "fixed" || position === "sticky") return true;
  if (style.opacity !== "" && Number(style.opacity) < 1) return true;
  if (style.transform !== "none") return true;
  if (style.filter !== "none") return true;
  if (style.perspective !== "none") return true;
  if (style.mixBlendMode !== "normal") return true;
  if (style.isolation === "isolate") return true;
  if (style.willChange !== "auto" && style.willChange !== "") {
    const hinted = style.willChange.split(",").map((v) => v.trim());
    if (
      hinted.some((v) =>
        ["transform", "opacity", "filter", "perspective"].includes(v),
      )
    ) {
      return true;
    }
  }
  if (CONTAINMENT_VALUES.some((v) => style.contain.includes(v))) return true;
  return false;
}

/**
 * Inventory the structure a dirty frame has to walk.
 *
 * `animationCensus` measures the TRIGGER — what dirties style each
 * frame. This measures the BILL: WebKit's compositing-requirements pass
 * is recursive over the layer tree and re-derives clip rects and offsets
 * against every ancestor, so its cost is a function of how deep the tree
 * is and how many stacking contexts it branches through, not of how many
 * animations set it off. A tree that costs too much to walk janks on a
 * window resize with no animation running at all.
 *
 * Every read here is a `getComputedStyle` over the whole document, so
 * this is a probe to call from an app-test or the DevPanel on demand —
 * never on a frame path.
 */
export function layerTreeProbe(): LayerTreeProbe {
  const all = document.querySelectorAll("*");
  const depthHistogram: Record<string, number> = {};
  let maxDepth = 0;
  let depthSum = 0;
  let stackingContexts = 0;
  let willChange = 0;
  let contained = 0;
  let transform3d = 0;
  let maxStackingDepth = 0;
  let deepest: Element | null = null;

  // Stacking depth per element, memoized down the tree: an element's
  // chain length is its nearest stacking ancestor's plus its own.
  const stackingDepth = new Map<Element, number>();
  const stackingHistogram = new Map<string, number>();

  for (const element of all) {
    let depth = 1;
    for (let p = element.parentElement; p !== null; p = p.parentElement) {
      depth += 1;
    }
    depthSum += depth;
    if (depth > maxDepth) maxDepth = depth;
    const bucket = `${Math.floor(depth / 10) * 10}-${Math.floor(depth / 10) * 10 + 9}`;
    depthHistogram[bucket] = (depthHistogram[bucket] ?? 0) + 1;

    const style = getComputedStyle(element);
    if (style.willChange !== "auto" && style.willChange !== "") willChange += 1;
    if (CONTAINMENT_VALUES.some((v) => style.contain.includes(v))) contained += 1;
    if (style.transform.startsWith("matrix3d")) transform3d += 1;

    const parentChain =
      element.parentElement !== null
        ? (stackingDepth.get(element.parentElement) ?? 0)
        : 0;
    if (establishesStackingContext(element, style)) {
      stackingContexts += 1;
      const classes = Array.from(element.classList).slice(0, 2);
      const bucket =
        element.tagName.toLowerCase() +
        (classes.length > 0 ? `.${classes.join(".")}` : "");
      stackingHistogram.set(bucket, (stackingHistogram.get(bucket) ?? 0) + 1);
      const chain = parentChain + 1;
      stackingDepth.set(element, chain);
      if (chain > maxStackingDepth) {
        maxStackingDepth = chain;
        deepest = element;
      }
    } else {
      stackingDepth.set(element, parentChain);
    }
  }

  const deepestStackingPath: string[] = [];
  for (let e = deepest; e !== null; e = e.parentElement) {
    if (stackingDepth.get(e) !== (stackingDepth.get(e.parentElement as Element) ?? 0)) {
      deepestStackingPath.unshift(describeElement(e));
    }
    if (deepestStackingPath.length >= CHAIN_PATH_LIMIT) break;
  }

  return {
    elements: all.length,
    maxDepth,
    meanDepth: all.length > 0 ? Math.round((depthSum / all.length) * 10) / 10 : 0,
    depthHistogram,
    stackingContexts,
    stackingHistogram: Array.from(stackingHistogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, STACKING_HISTOGRAM_LIMIT),
    maxStackingDepth,
    deepestStackingPath,
    willChange,
    contained,
    transform3d,
  };
}

/** Stop and reset — test hygiene. */
export function stopPerfMonitor(): void {
  if (heartbeatTimer !== null) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  observer?.disconnect();
  observer = null;
  startedAt = 0;
  snapshot = {
    longTasks: 0,
    worstLongTaskMs: 0,
    driftStalls: 0,
    worstDriftMs: 0,
    longTaskSupported: false,
    uptimeMs: 0,
  };
}
