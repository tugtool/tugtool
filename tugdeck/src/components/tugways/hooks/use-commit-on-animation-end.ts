/**
 * useCommitOnAnimationEnd -- defer a class swap until the current
 * keyframe iteration completes.
 *
 * Codifies [D97]: a pulse animation (or any state-coupled keyframe
 * animation) must finish its current iteration in the color it
 * started before any tone or visibility change is committed. The eye
 * sees a finished animation rather than an interrupted one.
 *
 * The hook lives in the **appearance zone** ([L24], [L06]): it owns
 * a DOM-class mutation on a consumer-supplied element and never
 * touches React state. It subscribes via `useLayoutEffect` ([L22],
 * [L03]) and reads/writes through refs. The completion signal is
 * CSS `animationend` ([L13], [L14]) -- never `requestAnimationFrame`
 * ([L05]). Correctness depends on stable mount identity for the
 * animating element across logical transitions ([L26]); consumers
 * must comply.
 *
 * ## Why not TugAnimator
 *
 * `component-authoring.md` warns against hand-rolling `animationend`
 * for enter/exit lifecycle work -- that is TugAnimator's job. The
 * pulse-handoff problem is different: the animating element never
 * mounts or unmounts during the transition (per [L26]); only the
 * *class* on a stable element is being deferred. The animation
 * itself is a continuous CSS `@keyframes` loop that [L13] explicitly
 * assigns to CSS ("CSS owns ... continuous animations"). The
 * `animationend` listener is used purely as a *completion signal*,
 * not as animation orchestration. TugAnimator's WAAPI `.finished`
 * promise has no analogue for "the current iteration of an infinite
 * animation," so it cannot express what the rule requires.
 *
 * ## API
 *
 * - `ref` -- the listener element. Stable across the lifetime of
 *   the consumer (per [L26]). The hook attaches `animationend` here;
 *   the event bubbles from descendants, so a parent ref works for
 *   multi-element pulses (see `animationName`).
 * - `commitTo` -- the element whose class the hook mutates on
 *   commit. Usually the same as `ref`; differs for compositions
 *   where the listener and the appearance element are distinct
 *   nodes. Stable per [L26].
 * - `targetClassName` -- the class the consumer wants applied to
 *   `commitTo.current` once the gating iteration ends. When the
 *   logical state changes to an unanimated target, the swap still
 *   defers (so the pulse finishes in its starting color before the
 *   ring disappears).
 * - `defaultClassName` -- applied on first mount before any
 *   animation has run. Subsequent transitions to it are deferred
 *   normally.
 * - `animationName` -- optional filter. When supplied, the hook
 *   only commits on `animationend` events whose `event.animationName`
 *   matches. Required when the listener element hosts multiple
 *   keyframe animations (e.g., a three-bar TugThinkingIndicator
 *   where each bar's `animationend` bubbles to the parent and only
 *   one should drive the gate -- conventionally the last bar in the
 *   stagger sequence). When omitted, the first `animationend` from
 *   any animation commits.
 *
 * ## Mount-identity requirement ([L26])
 *
 * The consumer must keep React's three reconciliation inputs (key,
 * component type, renderer reference) byte-stable for the listener
 * and commit elements across logical transitions. If either element
 * remounts mid-transition, the in-progress animation tears down and
 * the deferred commit is moot.
 *
 * ## Reduced motion ([D24])
 *
 * Under `--tug-motion: 0`, the project's global CSS forces
 * `animation-duration: 0s !important` on every element.
 * `commitTo.getAnimations({ subtree: true })` then returns no
 * running animations and the hook commits immediately. The
 * animation-handoff principle preserves the perceived rhythm of
 * motion the user expects to see; when motion is off, there is no
 * rhythm to preserve.
 *
 * @module hooks/use-commit-on-animation-end
 */

import { useLayoutEffect, useRef } from "react";

export type CommitOnTargetDecision = "commit-now" | "no-op" | "defer";

export interface DecideOnTargetChangeArgs {
  readonly target: string;
  readonly applied: string;
  readonly hasRunningAnimation: boolean;
}

/**
 * Pure decision for a target-class change. Exported for unit tests.
 *
 * - When the requested target already matches the applied class,
 *   nothing happens (avoids redundant DOM writes and spurious
 *   removal/add cycles).
 * - When no animation is currently running on the commit element's
 *   subtree, the hook commits immediately. This covers both the
 *   static-default state ("nothing to defer to") and reduced motion
 *   ("0s duration leaves no rhythm to preserve").
 * - Otherwise, the change defers -- the `animationend` listener
 *   reads the pending value from a ref and commits when the current
 *   iteration ends.
 */
export function decideOnTargetChange({
  target,
  applied,
  hasRunningAnimation,
}: DecideOnTargetChangeArgs): CommitOnTargetDecision {
  if (target === applied) return "no-op";
  if (!hasRunningAnimation) return "commit-now";
  return "defer";
}

export type AnimationEndDecision = "commit" | "ignore";

export interface DecideOnAnimationEndArgs {
  readonly pending: string;
  readonly applied: string;
  readonly eventAnimationName: string;
  readonly filterAnimationName: string | undefined;
}

/**
 * Pure decision for an `animationend` event. Exported for unit tests.
 *
 * - When the pending class already matches the applied class, no
 *   deferred commit is queued -- ignore the event.
 * - When a filter is configured, only events whose
 *   `event.animationName` matches the filter commit; other events
 *   are silently ignored. This lets a parent listener catch multiple
 *   bubbled `animationend` events and pick exactly one as the gate.
 * - Otherwise, commit the pending class.
 */
export function decideOnAnimationEnd({
  pending,
  applied,
  eventAnimationName,
  filterAnimationName,
}: DecideOnAnimationEndArgs): AnimationEndDecision {
  if (pending === applied) return "ignore";
  if (
    filterAnimationName !== undefined &&
    eventAnimationName !== filterAnimationName
  ) {
    return "ignore";
  }
  return "commit";
}

function hasRunningAnimationOn(el: HTMLElement): boolean {
  if (typeof el.getAnimations !== "function") return false;
  for (const anim of el.getAnimations({ subtree: true })) {
    if (anim.playState === "running") return true;
  }
  return false;
}

function swapClass(
  el: HTMLElement,
  oldClass: string,
  newClass: string,
): void {
  if (oldClass === newClass) return;
  if (oldClass) el.classList.remove(oldClass);
  if (newClass) el.classList.add(newClass);
}

/**
 * See the module docstring for the full contract.
 */
export function useCommitOnAnimationEnd(
  ref: React.RefObject<HTMLElement | null>,
  commitTo: React.RefObject<HTMLElement | null>,
  targetClassName: string,
  defaultClassName: string,
  animationName?: string,
): void {
  const appliedClassRef = useRef<string>(defaultClassName);
  const pendingClassRef = useRef<string>(targetClassName);

  // Mount-phase effect: anchor `defaultClassName` on the commit
  // element and register the `animationend` listener. Runs before
  // the target-change effect on first mount so that the target-change
  // effect can transition from a known applied state.
  useLayoutEffect(() => {
    const listener: HTMLElement | null = ref.current;
    const commit: HTMLElement | null = commitTo.current;
    if (!listener || !commit) return;

    swapClass(commit, "", defaultClassName);
    appliedClassRef.current = defaultClassName;

    const onAnimationEnd = (ev: AnimationEvent) => {
      const decision = decideOnAnimationEnd({
        pending: pendingClassRef.current,
        applied: appliedClassRef.current,
        eventAnimationName: ev.animationName,
        filterAnimationName: animationName,
      });
      if (decision === "commit") {
        swapClass(
          commit,
          appliedClassRef.current,
          pendingClassRef.current,
        );
        appliedClassRef.current = pendingClassRef.current;
      }
    };

    listener.addEventListener("animationend", onAnimationEnd);
    return () => {
      listener.removeEventListener("animationend", onAnimationEnd);
      if (appliedClassRef.current) {
        commit.classList.remove(appliedClassRef.current);
      }
    };
    // `ref` and `commitTo` are stable React refs (per the `useRef`
    // contract); identity changes do not occur during the component's
    // lifetime, so they are intentionally excluded from the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationName, defaultClassName]);

  // Target-change effect: stash the latest target in the pending
  // ref, then either commit now or defer to `animationend`.
  useLayoutEffect(() => {
    const commitEl = commitTo.current;
    if (!commitEl) return;
    pendingClassRef.current = targetClassName;

    const decision = decideOnTargetChange({
      target: targetClassName,
      applied: appliedClassRef.current,
      hasRunningAnimation: hasRunningAnimationOn(commitEl),
    });
    if (decision === "commit-now") {
      swapClass(commitEl, appliedClassRef.current, targetClassName);
      appliedClassRef.current = targetClassName;
    }
    // "defer" and "no-op" leave the DOM untouched; the listener
    // handles the deferred commit when `animationend` fires.
    // `commitTo` is a stable React ref, intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetClassName, defaultClassName]);
}
