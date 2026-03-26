/**
 * Hello test card -- the first registered card type in Phase 5.
 *
 * **Authoritative references:**
 * - [D09] Hello test card, Spec S01 TugcardProps, Spec S02 CardRegistration
 * - [D04] Single-call registration
 *
 * @module components/tugways/cards/hello-card
 */

import React from "react";
import { registerCard } from "@/card-registry";

// ---------------------------------------------------------------------------
// HelloCardContent
// ---------------------------------------------------------------------------

/**
 * Card-specific content for the Hello test card.
 *
 * Renders a centered title and a short message using `--tug-*` semantic tokens.
 */
export function HelloCardContent() {
  return (
    <div
      data-testid="hello-card-content"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "8px",
        padding: "16px",
        color: "var(--tug7-element-global-text-normal-default-rest)",
        fontFamily: "var(--tug-font-family-sans)",
      }}
    >
      <p
        data-testid="hello-card-title"
        style={{
          margin: 0,
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--tug7-element-global-text-normal-default-rest)",
        }}
      >
        Hello
      </p>
      <p
        data-testid="hello-card-message"
        style={{
          margin: 0,
          fontSize: "0.875rem",
          color: "var(--tug7-element-global-text-normal-muted-rest, var(--tug7-element-global-text-normal-default-rest))",
        }}
      >
        This is a test card.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerHelloCard
// ---------------------------------------------------------------------------

/**
 * Register the Hello test card in the global card registry.
 *
 * Must be called before `DeckManager.addCard("hello")` is invoked.
 * In `main.tsx`, call this before constructing the DeckManager.
 */
export function registerHelloCard(): void {
  registerCard({
    componentId: "hello",
    contentFactory: () => <HelloCardContent />,
    defaultMeta: { title: "Hello", icon: "Star", closable: true },
  });
}
