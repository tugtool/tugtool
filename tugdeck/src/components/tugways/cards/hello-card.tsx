/**
 * Hello test card -- the first registered card type in Phase 5.
 *
 * Demonstrates the full Tugcard registration pipeline:
 *   registerHelloCard() -> registerCard() -> factory() -> <Tugcard> -> <HelloCardContent>
 *
 * **Authoritative references:**
 * - [D09] Hello test card, Spec S01 TugcardProps, Spec S02 CardRegistration
 * - [D04] Single-call registration
 *
 * @module components/tugways/cards/hello-card
 */

import React from "react";
import { registerCard } from "@/card-registry";
import { Tugcard } from "@/components/tugways/tugcard";

// ---------------------------------------------------------------------------
// HelloCardContent
// ---------------------------------------------------------------------------

/**
 * Card-specific content for the Hello test card.
 *
 * Renders a centered title and a short message using `--td-*` semantic tokens.
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
        color: "var(--td-text)",
        fontFamily: "var(--td-font-sans)",
      }}
    >
      <p
        data-testid="hello-card-title"
        style={{
          margin: 0,
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--td-text)",
        }}
      >
        Hello
      </p>
      <p
        data-testid="hello-card-message"
        style={{
          margin: 0,
          fontSize: "0.875rem",
          color: "var(--td-text-muted, var(--td-text))",
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
    factory: (cardId, injected) => (
      <Tugcard
        cardId={cardId}
        meta={{ title: "Hello", closable: true }}
        feedIds={[]}
        onDragStart={injected.onDragStart}
        onMinSizeChange={injected.onMinSizeChange}
      >
        <HelloCardContent />
      </Tugcard>
    ),
    defaultMeta: { title: "Hello", closable: true },
  });
}
