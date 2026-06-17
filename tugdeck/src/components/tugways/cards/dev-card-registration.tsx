/**
 * registerDevCard — registers the "dev" card type with the card registry.
 *
 * Split out of `dev-card.tsx` so that file stays a component-only React Fast
 * Refresh boundary: a `.tsx` exporting a registration function alongside its
 * components is "mixed" and non-accepting. This shim is `.tsx` because the
 * content factory JSX-renders `<DevCardContent>`; it exports no component, so
 * it is transparent and does not itself need to be a boundary. `main.tsx`
 * imports `registerDevCard` from here.
 *
 * @module components/tugways/cards/dev-card-registration
 */

import { registerCard } from "@/card-registry";
import { FeedId } from "@/protocol";
import { DevCardContent } from "./dev-card";

export function registerDevCard(): void {
  registerCard({
    componentId: "dev",
    contentFactory: (cardId) => <DevCardContent cardId={cardId} />,
    defaultMeta: { title: "Dev", icon: "MessageSquareText", closable: true, confirmClose: true },
    defaultFeedIds: [
      FeedId.CODE_INPUT,
      FeedId.CODE_OUTPUT,
      FeedId.SESSION_SIDEBAND,
      FeedId.FILETREE,
    ],
    sizePolicy: {
      // The width floor is set by the Z2 status row, the card's
      // widest fixed-content surface: four 21ch instrument cells plus
      // inter-cell/edge gaps (≈ 674px) and a sash grip at each end
      // with its gaps + padding (≈ 96px) ≈ 770px, rounded to 800 for
      // breathing room. `getStackSizePolicy` lifts the hosting pane's
      // resize floor to this value (or higher, if a wider card shares
      // the pane), so the instrument readout never clips. The height
      // floor must fit the prompt entry (the fixed 200px text area + its
      // toolbar/indicator rows) AND leave the transcript its minimum
      // (`--dev-transcript-min`), so the entry never crowds the transcript
      // out even at the smallest card size.
      min: { width: 800, height: 500 },
      // Default size opens the card tall enough for an extended
      // transcript to read as a continuous column, not a porthole,
      // and wide enough to give the Choose Session sheet (caps at
      // 460px) room to breathe alongside the card body. Both
      // dimensions intentionally exceed many laptop canvases;
      // `addCard` clamps width AND height to 90% of the live canvas
      // at creation, so on a smaller screen the card opens at
      // canvas * 0.9 instead of pushing past the viewport.
      preferred: { width: 900, height: 1200 },
    },
    engineKind: "em",
  });
}
