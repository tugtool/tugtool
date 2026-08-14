/**
 * use-image-card-settings.ts — one viewer card's image settings.
 *
 * The whole hook is `useCardSettings` bound to the image kind's two domains
 * and its parser; the contract (per-card wins, deck defaults until the first
 * change, no mount-time write) is stated there and shared with every other
 * card kind rather than restated per kind.
 *
 * @module lib/use-image-card-settings
 */

import {
  IMAGE_CARD_DEFAULTS_DOMAIN,
  IMAGE_CARD_DEFAULTS_KEY,
  IMAGE_CARD_DOMAIN,
  parseImageCardSettings,
  resolveImageCardSettings,
  type ImageCardSettings,
} from "./image-card-settings";
import {
  useCardSettings,
  type CardSettingsSpec,
  type UseCardSettingsResult,
} from "./use-card-settings";

/** The image kind's settings surfaces. Module-level so the spec identity is
 *  stable — the hook memoizes on it. */
export const IMAGE_CARD_SETTINGS_SPEC: CardSettingsSpec<ImageCardSettings> = {
  domain: IMAGE_CARD_DOMAIN,
  defaultsDomain: IMAGE_CARD_DEFAULTS_DOMAIN,
  defaultsKey: IMAGE_CARD_DEFAULTS_KEY,
  parse: parseImageCardSettings,
  resolve: resolveImageCardSettings,
};

export function useImageCardSettings(
  cardId: string,
): UseCardSettingsResult<ImageCardSettings> {
  return useCardSettings(IMAGE_CARD_SETTINGS_SPEC, cardId);
}
