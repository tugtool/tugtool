/**
 * lens-followed-card.tsx — the "last non-lens key card" the Lens is
 * contextually about, tracked once by `LensContent` and shared with any
 * section via context.
 *
 * Because focusing the Lens itself makes *it* the key card, a section
 * that wants "the card I'm working in" must remember the previous key
 * card that is not the Lens ([P11]). Tracking it per-section is wrong:
 * each body/collapsed-summary mounts and unmounts independently (on
 * collapse), so a fresh tracker misses history. `LensContent` — mounted
 * for the whole time the Lens pane is open — runs the single tracker and
 * publishes the result through this context, so the body and its
 * collapsed-summary always agree and survive collapse toggles.
 *
 * @module components/lens/lens-followed-card
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useFocusManager } from "@/components/tugways/use-focusable";

/** The last non-lens key card id, or `null` when none has been focused. */
export const LensFollowedCardContext = createContext<string | null>(null);

/** Track the last key card that is not the Lens ([P11]). Runs once, in
 *  `LensContent`. */
export function useTrackLastNonLensKeyCard(lensCardId: string): string | null {
  const focusManager = useFocusManager();
  const currentKey = useSyncExternalStore(
    useCallback(
      (cb: () => void) => focusManager?.subscribe(cb) ?? (() => {}),
      [focusManager],
    ),
    useCallback(() => focusManager?.keyCard() ?? null, [focusManager]),
  );
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    if (currentKey !== null && currentKey !== lensCardId) setLast(currentKey);
  }, [currentKey, lensCardId]);
  return last;
}

/** Read the Lens's followed card id from context (for section bodies). */
export function useLensFollowedCard(): string | null {
  return useContext(LensFollowedCardContext);
}
