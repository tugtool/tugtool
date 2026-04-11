/**
 * GalleryMutation -- mutation model demo wrapped for gallery card tab.
 *
 * Also exports MutationModelDemo for use in tests and other contexts.
 *
 * **Authoritative reference:** [D01] gallery-mutation componentId.
 *
 * @module components/tugways/cards/gallery-mutation
 */

import React, { useState, useRef } from "react";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useCSSVar, useDOMClass, useDOMStyle } from "@/components/tugways/hooks";
import { TugLabel } from "@/components/tugways/tug-label";

// ---------------------------------------------------------------------------
// MutationModelDemo
// ---------------------------------------------------------------------------

/**
 * MutationModelDemo -- Phase 4 proof-of-concept for the three-zone mutation model.
 *
 * Renders a colored box and three toggle buttons. Each button uses useState for
 * a boolean toggle (causing a local re-render), then passes the new value into
 * one of the three appearance-zone hooks, which applies the DOM mutation directly
 * without further React reconciliation.
 *
 * Hooks used:
 * - useCSSVar: swaps --demo-bg between two --tug-* color tokens
 * - useDOMClass: adds/removes the "demo-highlighted" class
 * - useDOMStyle: swaps border-width between "1px" and "3px"
 *
 * [D01] Three mutation zones
 * Spec S01, S02, S03 (#public-api)
 */
export function MutationModelDemo() {
  const boxRef = useRef<HTMLDivElement>(null);

  const [varOn, setVarOn] = useState(false);
  const [classOn, setClassOn] = useState(false);
  const [styleOn, setStyleOn] = useState(false);

  useCSSVar(boxRef, "--demo-bg", varOn ? "var(--tug7-element-global-fill-normal-accent-rest)" : "var(--tug7-surface-global-primary-normal-default-rest)");
  useDOMClass(boxRef, "demo-highlighted", classOn);
  useDOMStyle(boxRef, "border-width", styleOn ? "3px" : "1px");

  return (
    <div className="cg-mutation-demo">
      <div
        ref={boxRef}
        className="cg-mutation-box"
        data-testid="mutation-demo-box"
        aria-label="Mutation model demo box"
      />
      <div className="cg-variant-row">
        <TugPushButton
          size="sm"
          onClick={() => setVarOn((v) => !v)}
        >
          Toggle CSS Var
        </TugPushButton>
        <TugPushButton
          size="sm"
          onClick={() => setClassOn((v) => !v)}
        >
          Toggle Class
        </TugPushButton>
        <TugPushButton
          size="sm"
          onClick={() => setStyleOn((v) => !v)}
        >
          Toggle Style
        </TugPushButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryMutation
// ---------------------------------------------------------------------------

/**
 * GalleryMutation -- mutation model demo wrapped for gallery card tab.
 *
 * **Authoritative reference:** [D01] gallery-mutation componentId.
 */
export function GalleryMutation() {
  return (
    <div className="cg-content" data-testid="gallery-mutation">
      <div className="cg-section">
        <TugLabel className="cg-section-title">Mutation Model</TugLabel>
        <MutationModelDemo />
      </div>
    </div>
  );
}
