/**
 * formula-reverse-map.ts -- Proxy-based reverse map for DerivationFormulas.
 *
 * Builds a bidirectional mapping between DerivationFormulas fields and CSS token
 * names by probing each rule's expression functions with a tracking Proxy.
 *
 * Produced maps:
 *   fieldToTokens — formula field name -> Set<tokenName>
 *   tokenToFields — tokenName -> Array<TokenFormulaMapping>
 *
 * Used by the style inspector to show which formula fields control each CSS token.
 *
 * @module components/tugways/formula-reverse-map
 */

import type {
  DerivationFormulas,
  DerivationRule,
  ResolvedHueSlots,
} from "./theme-engine";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One field->token relationship entry. */
export interface FormulaTokenMapping {
  /** CSS token name (already includes --tug- prefix). */
  token: string;
  /** Which field on the rule triggered this mapping. */
  property: "intensity" | "tone" | "alpha" | "hueSlot";
}

/** One token->field relationship entry. */
export interface TokenFormulaMapping {
  /** DerivationFormulas field name (e.g. "contentTextIntensity"). */
  field: string;
  /** Which property category this field controls for the token. */
  property: "intensity" | "tone" | "alpha" | "hueSlot";
}

/** Bidirectional map between formula fields and token names. */
export interface ReverseMap {
  /** Maps DerivationFormulas field name -> array of token mappings. */
  fieldToTokens: Map<string, FormulaTokenMapping[]>;
  /** Maps CSS token name -> array of formula mappings. */
  tokenToFields: Map<string, TokenFormulaMapping[]>;
}

// ---------------------------------------------------------------------------
// Resolved hue slot keys — direct keys in ResolvedHueSlots
// ---------------------------------------------------------------------------

/**
 * All direct keys of the ResolvedHueSlots interface.
 * These are resolved without going through formulas-mediation.
 * Exported so the style inspector client can populate hue slot dropdown options. [D08]
 */
export const RESOLVED_HUE_SLOT_KEYS = new Set([
  "text",
  "canvas",
  "frame",
  "card",
  "borderTint",
  "action",
  "accent",
  "control",
  "display",
  "informational",
  "decorative",
  "destructive",
  "success",
  "caution",
  "agent",
  "data",
  "canvasBase",
  "canvasScreen",
  "textMuted",
  "textSubtle",
  "textDisabled",
  "textInverse",
  "textPlaceholder",
  "selectionInactive",
  "borderBase",
  "borderStrong",
]);

/**
 * Sentinel hue slot names per [D07].
 * These bypass normal chromatic dispatch and are NOT formulas-mediated.
 */
const SENTINEL_HUE_SLOTS = new Set(["white", "highlight", "shadow", "highlightVerbose"]);

// ---------------------------------------------------------------------------
// Tracking proxy
// ---------------------------------------------------------------------------

/**
 * Create a Proxy over DerivationFormulas that records every property access.
 * Returns 0 for all numeric reads; records the field name in the `accessed` set.
 */
function makeTrackingProxy(accessed: Set<string>): DerivationFormulas {
  return new Proxy({} as DerivationFormulas, {
    get(_target, prop: string) {
      accessed.add(prop);
      return 0;
    },
  });
}

/**
 * Empty ResolvedHueSlots used when probing structural rules.
 * Returns an empty object placeholder via Proxy.
 */
const DUMMY_RESOLVED_HUE_SLOTS = new Proxy({} as ResolvedHueSlots, {
  get() {
    return { angle: 0, name: "", ref: "", primaryName: "" };
  },
});

// ---------------------------------------------------------------------------
// buildReverseMap
// ---------------------------------------------------------------------------

/**
 * Build a bidirectional map between DerivationFormulas fields and CSS token names.
 *
 * @param rules - The RULES table from theme-rules.ts (Record<tokenName, DerivationRule>)
 * @returns ReverseMap with fieldToTokens and tokenToFields
 */
export function buildReverseMap(rules: Record<string, DerivationRule>): ReverseMap {
  const fieldToTokens = new Map<string, FormulaTokenMapping[]>();
  const tokenToFields = new Map<string, TokenFormulaMapping[]>();

  function record(token: string, field: string, property: FormulaTokenMapping["property"]) {
    // fieldToTokens
    let ftList = fieldToTokens.get(field);
    if (!ftList) {
      ftList = [];
      fieldToTokens.set(field, ftList);
    }
    ftList.push({ token, property });

    // tokenToFields
    let tfList = tokenToFields.get(token);
    if (!tfList) {
      tfList = [];
      tokenToFields.set(token, tfList);
    }
    tfList.push({ field, property });
  }

  for (const [tokenName, rule] of Object.entries(rules)) {
    switch (rule.type) {
      case "chromatic": {
        // Probe intensityExpr
        {
          const accessed = new Set<string>();
          const proxy = makeTrackingProxy(accessed);
          try {
            rule.intensityExpr(proxy);
          } catch {
            // ignore — expression may throw with dummy proxy values
          }
          for (const field of accessed) {
            record(tokenName, field, "intensity");
          }
        }

        // Probe toneExpr
        {
          const accessed = new Set<string>();
          const proxy = makeTrackingProxy(accessed);
          try {
            rule.toneExpr(proxy);
          } catch {
            // ignore
          }
          for (const field of accessed) {
            record(tokenName, field, "tone");
          }
        }

        // Probe alphaExpr (if present)
        if (rule.alphaExpr) {
          const accessed = new Set<string>();
          const proxy = makeTrackingProxy(accessed);
          try {
            rule.alphaExpr(proxy);
          } catch {
            // ignore
          }
          for (const field of accessed) {
            record(tokenName, field, "alpha");
          }
        }

        // Hue slot mediation: if hueSlot is NOT a direct resolved key and NOT a sentinel,
        // the rule reads formulas[hueSlot + "HueSlot"] to determine the actual hue.
        // Record this as a "hueSlot" property mapping.
        if (
          !RESOLVED_HUE_SLOT_KEYS.has(rule.hueSlot) &&
          !SENTINEL_HUE_SLOTS.has(rule.hueSlot)
        ) {
          const hueSlotField = rule.hueSlot + "HueSlot";
          record(tokenName, hueSlotField, "hueSlot");
        }
        break;
      }

      case "shadow":
      case "highlight": {
        // Only alphaExpr is meaningful
        const accessed = new Set<string>();
        const proxy = makeTrackingProxy(accessed);
        try {
          rule.alphaExpr(proxy);
        } catch {
          // ignore
        }
        for (const field of accessed) {
          record(tokenName, field, "alpha");
        }
        break;
      }

      case "structural": {
        // Probe valueExpr with dummy formulas and dummy ResolvedHueSlots
        {
          const accessed = new Set<string>();
          const proxy = makeTrackingProxy(accessed);
          try {
            rule.valueExpr(proxy, DUMMY_RESOLVED_HUE_SLOTS);
          } catch {
            // ignore
          }
          for (const field of accessed) {
            record(tokenName, field, "intensity");
          }
        }

        // Probe resolvedExpr if present
        if (rule.resolvedExpr) {
          const accessed = new Set<string>();
          const proxy = makeTrackingProxy(accessed);
          try {
            rule.resolvedExpr(proxy);
          } catch {
            // ignore
          }
          for (const field of accessed) {
            record(tokenName, field, "intensity");
          }
        }
        break;
      }

      case "white":
      case "invariant":
        // No formula fields involved
        break;
    }
  }

  return { fieldToTokens, tokenToFields };
}
