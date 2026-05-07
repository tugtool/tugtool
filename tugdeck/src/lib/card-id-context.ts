/**
 * card-id-context.ts — React context exposing the cardId of the
 * enclosing card host.
 *
 * Provided by `CardHost` alongside `TugPanePortalContext`. The two
 * contexts answer different questions and live in different modules
 * even though they're often consumed together:
 *
 *   - `TugPanePortalContext` — the *portal target element* for
 *     overlay-tier UI (sheets, alerts, popovers). "Where do I
 *     mount?"
 *   - `CardIdContext` — the *card identity* for per-card lifecycle
 *     emission and chain dispatch. "Whose lifecycle events am I
 *     emitting? For what cardId do I dispatch chain actions?"
 *
 * Currently consumed by `TugSheet` and `TugPaneBanner` to scope
 * sheet- and banner-lifecycle events to the card they're hosted in.
 *
 * `null` outside any card host (overlay-tier code that runs above
 * the card hierarchy, standalone harnesses). Consumers must
 * tolerate `null` and silently skip card-scoped behavior — the
 * non-card render path is a supported configuration.
 */

import { createContext } from "react";

export const CardIdContext = createContext<string | null>(null);
