/**
 * Internal building block — measures whether an element's content wraps
 * past a single visual line.
 *
 * Returns `true` once the element's rendered height exceeds ~1.5×
 * line-height (i.e. it occupies two or more lines, whether from soft
 * wrapping or hard newlines). Re-measures on size / content changes via a
 * `ResizeObserver`, so the verdict tracks the live wrap point rather than a
 * guess from the string. Consumers use it to switch presentation between
 * the one-line case and the wrapped case (e.g. center a single line,
 * left-align a wrapped block).
 *
 * @module components/tugways/internal/use-is-multiline
 */

import React from "react";

import { resolveLineHeightPx } from "./use-clamp-overflow";

/** Whether `ref`'s content occupies more than one visual line. */
export function useIsMultiline(
  ref: React.RefObject<HTMLElement | null>,
): boolean {
  const [multiline, setMultiline] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;

    const measure = (): void => {
      const lineHeight = resolveLineHeightPx(el);
      // 1.5× absorbs sub-pixel rounding on a single line while still
      // tripping cleanly once a second line is present.
      const next = lineHeight > 0 && el.scrollHeight > lineHeight * 1.5;
      setMultiline((prev) => (prev === next ? prev : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return multiline;
}
