/**
 * tug-menu-item-blink.ts — shared double-blink feedback animation for
 * menu item activation. Used by both TugContextMenu and
 * TugEditorContextMenu so every menu in the suite flashes identically.
 *
 * The animation is a four-keyframe "double-blink": highlight, off,
 * highlight, highlight. Colors are read from the filled-action token
 * pair at runtime — WAAPI cannot interpolate CSS variable references,
 * so we resolve to concrete values before calling animate().
 *
 * Laws: [L06] appearance via CSS/DOM, never React state,
 *       [L13] motion — duration resolved from --tug-motion-duration-slow
 */

import { animate } from "./tug-animator";

/**
 * Play the tug-standard double-blink feedback animation on a menu item
 * and return a Promise that resolves when the animation finishes
 * (successfully or otherwise — the caller should not branch on success
 * vs. rejection; both outcomes mean "the animation is done, proceed").
 *
 * Resolves to the completed animation's finish state. Rejection from
 * WAAPI (element detached, interrupted, etc.) is caught and converted
 * to a normal resolution so callers can always chain a close step.
 */
export function playMenuItemBlink(target: HTMLElement): Promise<void> {
  // Resolve CSS variables to concrete colors — WAAPI can't interpolate
  // var() references directly. getPropertyValue returns a string with
  // leading whitespace per spec, hence the trim().
  const computed = getComputedStyle(target);
  const blinkBg =
    computed.getPropertyValue("--tug7-surface-control-primary-filled-action-active").trim() ||
    "transparent";
  const blinkFg =
    computed.getPropertyValue("--tug7-element-control-text-filled-action-active").trim() ||
    "inherit";
  const easing =
    computed.getPropertyValue("--tug-motion-easing-standard").trim() ||
    "cubic-bezier(0.2, 0, 0, 1)";

  // Double-blink: highlight → transparent → highlight → highlight.
  const blinkKeyframes: Keyframe[] = [
    { backgroundColor: blinkBg, color: blinkFg },
    { backgroundColor: "transparent", color: "inherit" },
    { backgroundColor: blinkBg, color: blinkFg },
    { backgroundColor: blinkBg, color: blinkFg },
  ];

  const handle = animate(target, blinkKeyframes, {
    duration: "--tug-motion-duration-slow",
    easing,
  });

  // Always resolve — callers use this as "when the blink is done,
  // close the menu", and should proceed whether the animation ran to
  // completion or was interrupted.
  return handle.finished.then(
    () => undefined,
    () => undefined,
  );
}
