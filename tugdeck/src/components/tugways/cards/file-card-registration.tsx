/**
 * File card registration — split from `file-card.tsx` so the card body
 * stays a component-only Fast-Refresh boundary (mirrors the
 * `dev-card.tsx` / `dev-card-registration.tsx` split).
 *
 * `engineKind: "em"` — the card content owns its own focus lifecycle:
 * activation routes to the body's `onCardActivated` (which lands focus
 * on the CM6 editing surface) instead of the generic default-focus
 * walk.
 *
 * No `confirmClose`: under live autosave there is nothing unsaved to
 * lose — closing a File card is always safe.
 *
 * @module components/tugways/cards/file-card-registration
 */

import React from "react";
import { registerCard } from "@/card-registry";
import { FileCardContent } from "./file-card";

export function registerFileCard(): void {
  registerCard({
    componentId: "file",
    contentFactory: (cardId) => <FileCardContent cardId={cardId} />,
    defaultMeta: { title: "File", icon: "FileText", closable: true },
    engineKind: "em",
    category: { label: "Files", icon: "FileText" },
    sizePolicy: {
      min: { width: 480, height: 300 },
      preferred: { width: 820, height: 620 },
    },
  });
}
