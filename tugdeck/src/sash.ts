/**
 * Sash resize element for splitting panel areas.
 *
 * Creates a thin 4px drag target between flex siblings that allows
 * proportional resizing with 100px minimum enforcement.
 */

/** Minimum panel dimension in pixels (L01.7) */
const MIN_SIZE_PX = 100;

/**
 * Callback invoked when the user finishes a sash drag with new weights.
 * @param weights - New normalized weights array for the parent split's children
 */
export type WeightChangeCallback = (weights: number[]) => void;

/**
 * Create a sash element to be inserted between two flex children.
 *
 * @param orientation - "horizontal" means siblings are laid out left-right
 *   (the sash is vertical, cursor: col-resize);
 *   "vertical" means siblings are laid out top-bottom (sash is horizontal,
 *   cursor: row-resize).
 * @param childIndex - The index of the child to the LEFT/ABOVE the sash.
 *   The sash sits between child[childIndex] and child[childIndex + 1].
 * @param getWeights - Getter for the current weights array.
 * @param getSiblingEls - Getter for the sibling flex-child elements (in order).
 * @param getParentEl - Getter for the flex parent element.
 * @param onDragStart - Called when the user begins dragging; allows PanelManager
 *   to set _isDragging = true.
 * @param onDragEnd - Called when the user releases; PanelManager clears
 *   _isDragging and may run normalizeTree + saveLayout.
 * @param onWeightChange - Called on each pointermove with the live weights (for
 *   real-time visual feedback). onDragEnd is called once on pointerup with the
 *   final weights for persistence.
 */
export function createSash(
  orientation: "horizontal" | "vertical",
  childIndex: number,
  getWeights: () => number[],
  getSiblingEls: () => HTMLElement[],
  getParentEl: () => HTMLElement,
  onDragStart: () => void,
  onDragEnd: (weights: number[]) => void,
  onWeightChange: (weights: number[]) => void
): HTMLElement {
  const sash = document.createElement("div");
  sash.className =
    orientation === "horizontal"
      ? "panel-sash panel-sash-horizontal"
      : "panel-sash panel-sash-vertical";

  sash.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    sash.setPointerCapture(e.pointerId);
    sash.classList.add("active");
    // Suppress text selection during drag
    document.body.style.userSelect = "none";
    onDragStart();

    const startPos = orientation === "horizontal" ? e.clientX : e.clientY;
    const initialWeights = [...getWeights()];
    const siblings = getSiblingEls();
    const parentEl = getParentEl();

    const onMove = (ev: PointerEvent) => {
      const currentPos = orientation === "horizontal" ? ev.clientX : ev.clientY;
      const delta = currentPos - startPos;

      const totalSize =
        orientation === "horizontal"
          ? parentEl.clientWidth
          : parentEl.clientHeight;

      if (totalSize === 0) return;

      // Compute how much weight delta corresponds to the pixel delta
      const weightDelta = delta / totalSize;

      // Compute new weights by shifting weight from childIndex+1 to childIndex
      const newWeights = [...initialWeights];
      newWeights[childIndex] = initialWeights[childIndex] + weightDelta;
      newWeights[childIndex + 1] = initialWeights[childIndex + 1] - weightDelta;

      // Enforce 100px minimum for the two affected children
      const minWeight = totalSize > 0 ? MIN_SIZE_PX / totalSize : 0;

      if (newWeights[childIndex] < minWeight) {
        const excess = minWeight - newWeights[childIndex];
        newWeights[childIndex] = minWeight;
        newWeights[childIndex + 1] -= excess;
      }
      if (newWeights[childIndex + 1] < minWeight) {
        const excess = minWeight - newWeights[childIndex + 1];
        newWeights[childIndex + 1] = minWeight;
        newWeights[childIndex] -= excess;
      }

      // Clamp both to [0, 1]
      newWeights[childIndex] = Math.max(0, Math.min(1, newWeights[childIndex]));
      newWeights[childIndex + 1] = Math.max(
        0,
        Math.min(1, newWeights[childIndex + 1])
      );

      // Apply flex values immediately for visual feedback
      for (let i = 0; i < siblings.length; i++) {
        siblings[i].style.flex = `${newWeights[i]} 1 0%`;
      }

      onWeightChange(newWeights);
    };

    const onUp = (ev: PointerEvent) => {
      sash.releasePointerCapture(ev.pointerId);
      sash.classList.remove("active");
      // Restore text selection
      document.body.style.userSelect = "";
      sash.removeEventListener("pointermove", onMove);
      sash.removeEventListener("pointerup", onUp);

      // Compute final weights from current sibling flex values
      // (same logic as onMove, but use the last computed state)
      const currentPos = orientation === "horizontal" ? ev.clientX : ev.clientY;
      const delta = currentPos - startPos;
      const totalSize =
        orientation === "horizontal"
          ? parentEl.clientWidth
          : parentEl.clientHeight;

      const weightDelta = totalSize > 0 ? delta / totalSize : 0;
      const finalWeights = [...initialWeights];
      finalWeights[childIndex] = initialWeights[childIndex] + weightDelta;
      finalWeights[childIndex + 1] =
        initialWeights[childIndex + 1] - weightDelta;

      const minWeight = totalSize > 0 ? MIN_SIZE_PX / totalSize : 0;
      if (finalWeights[childIndex] < minWeight) {
        const excess = minWeight - finalWeights[childIndex];
        finalWeights[childIndex] = minWeight;
        finalWeights[childIndex + 1] -= excess;
      }
      if (finalWeights[childIndex + 1] < minWeight) {
        const excess = minWeight - finalWeights[childIndex + 1];
        finalWeights[childIndex + 1] = minWeight;
        finalWeights[childIndex] -= excess;
      }
      finalWeights[childIndex] = Math.max(
        0,
        Math.min(1, finalWeights[childIndex])
      );
      finalWeights[childIndex + 1] = Math.max(
        0,
        Math.min(1, finalWeights[childIndex + 1])
      );

      onDragEnd(finalWeights);
    };

    sash.addEventListener("pointermove", onMove);
    sash.addEventListener("pointerup", onUp);
  });

  return sash;
}
