/**
 * tug-setup-copy — pure copy helpers for TugSetup, split out from the component
 * so the wording rules are unit-testable without importing the CSS-bearing
 * `.tsx` (mirrors the `session-card-banner-spec` pattern). [D106]
 *
 * @module components/tugways/tug-setup-copy
 */

/**
 * Formal label for a Claude subscription tier (from `claude auth status`'s
 * `subscriptionType`), for the signed-in step's detail. Returns `undefined`
 * when unknown so the row simply omits the line — never a bare "subscription."
 * Unrecognized tiers are title-cased rather than leaked raw, so a future tier
 * still reads as a clean "Claude <Tier> plan".
 */
export function subscriptionLabel(
  type: string | null | undefined,
): string | undefined {
  const normalized = (type ?? "").trim().toLowerCase();
  switch (normalized) {
    case "":
      return undefined;
    case "max":
      return "Claude Max plan";
    case "pro":
      return "Claude Pro plan";
    case "team":
      return "Claude Team plan";
    case "enterprise":
      return "Claude Enterprise plan";
    case "free":
      return "Claude Free plan";
    default:
      return `Claude ${(type ?? "").trim().replace(/^\w/, (c) => c.toUpperCase())} plan`;
  }
}

/**
 * A model pack's size, for the on-device AI offer. Sizes here are always in the
 * gigabytes, so one decimal place is the honest resolution — "2.2 GB", not
 * "2315155948 bytes" and not a false-precision "2.16 GB".
 */
export function formatModelSize(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  if (!Number.isFinite(gb) || gb < 0) return "—";
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

/**
 * Detail line for the on-device AI offer: what the user would get and what it
 * costs them in disk. The catalog note, when present, carries the "what for".
 */
export function localAiOfferDetail(displayName: string, bytes: number, notes?: string): string {
  const head = `${displayName} • ${formatModelSize(bytes)} download`;
  const note = (notes ?? "").trim();
  return note ? `${head}. ${note}` : head;
}

/**
 * The readout carried alongside the download's progress bar. Aggregate bytes,
 * not per-file — the user cares that it is moving and how much is left, not
 * which shard is in flight. The bar itself says "downloading", so the words
 * only have to carry the numbers.
 */
export function localAiProgressValue(received: number, total: number): string {
  if (total <= 0) return "Downloading…";
  return `${formatModelSize(received)} of ${formatModelSize(total)}`;
}

/**
 * Copy for the third setup step while it is still *pending* (the user isn't
 * logged in yet). When the deck already has open cards — the logout-with-work
 * case — the step previews the return to that work ("Continue working") rather
 * than nudging a brand-new session; on re-login the wizard auto-closes back to
 * those cards. A zero-card deck keeps the first-run wording. [P04]/[D106]
 *
 * Pure so the branch is unit-testable without the CSS-bearing `.tsx`. Only the
 * pending (logged-out) copy varies here; the logged-in "Open a Session Card" active
 * step is owned by the component.
 */
export function pendingOpenStepCopy(cardCount: number): {
  label: string;
  detail?: string;
} {
  if (cardCount > 0) {
    const plural = cardCount === 1 ? "card" : "cards";
    return {
      label: "Continue working",
      detail: `You'll return to your ${cardCount} open ${plural}.`,
    };
  }
  return { label: "Start a Claude Code session" };
}
