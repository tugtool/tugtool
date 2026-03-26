/**
 * Hello World card -- the first registered card type in Phase 5.
 *
 * **Authoritative references:**
 * - [D09] Hello World card, Spec S01 TugcardProps, Spec S02 CardRegistration
 * - [D04] Single-call registration
 *
 * @module components/tugways/cards/hello-world-card
 */

import React from "react";
import { registerCard } from "@/card-registry";

// ---------------------------------------------------------------------------
// HelloWorldCardContent
// ---------------------------------------------------------------------------

/**
 * Card-specific content for the Hello World card.
 *
 * Renders a centered title using `--tug-*` semantic tokens.
 */
export function HelloWorldCardContent() {
  return (
    <div
      data-testid="hello-world-card-content"
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
        data-testid="hello-world-card-title"
        style={{
          margin: 0,
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--tug7-element-global-text-normal-default-rest)",
        }}
      >
        Hello, World!
      </p>
      <p>
      A test card.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerHelloWorldCard
// ---------------------------------------------------------------------------

/**
 * Register the Hello World card in the global card registry.
 *
 * Must be called before `DeckManager.addCard("hello")` is invoked.
 * In `main.tsx`, call this before constructing the DeckManager.
 */
export function registerHelloWorldCard(): void {
  registerCard({
    componentId: "hello",
    contentFactory: () => <HelloWorldCardContent />,
    defaultMeta: { title: "Hello, World!", icon: "Star", closable: true },
  });
}
