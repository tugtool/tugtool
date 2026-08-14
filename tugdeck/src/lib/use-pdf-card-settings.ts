/**
 * use-pdf-card-settings.ts — one viewer card's PDF preferences.
 *
 * `useCardSettings` bound to the PDF kind's two domains and its parser; the
 * contract lives there. What these preferences are — and why the live mode
 * and zoom are NOT among them — is in `pdf-card-settings.ts`.
 *
 * @module lib/use-pdf-card-settings
 */

import {
  PDF_CARD_DEFAULTS_DOMAIN,
  PDF_CARD_DEFAULTS_KEY,
  PDF_CARD_DOMAIN,
  parsePdfCardSettings,
  resolvePdfCardSettings,
  type PdfCardSettings,
} from "./pdf-card-settings";
import {
  useCardSettings,
  type CardSettingsSpec,
  type UseCardSettingsResult,
} from "./use-card-settings";

/** The PDF kind's settings surfaces. Module-level for a stable identity. */
export const PDF_CARD_SETTINGS_SPEC: CardSettingsSpec<PdfCardSettings> = {
  domain: PDF_CARD_DOMAIN,
  defaultsDomain: PDF_CARD_DEFAULTS_DOMAIN,
  defaultsKey: PDF_CARD_DEFAULTS_KEY,
  parse: parsePdfCardSettings,
  resolve: resolvePdfCardSettings,
};

export function usePdfCardSettings(
  cardId: string,
): UseCardSettingsResult<PdfCardSettings> {
  return useCardSettings(PDF_CARD_SETTINGS_SPEC, cardId);
}
