/**
 * Formula Reverse Map
 *
 * Builds a bidirectional mapping between DerivationFormulas fields and CSS token
 * names, using JavaScript Proxy to intercept property accesses on a dummy
 * DerivationFormulas object when calling each rule's expression functions.
 *
 * Design decision [D01]: Proxy-based reverse map, not source parsing.
 * - Runtime introspection is simpler and more accurate than static analysis.
 * - Catches computed references that regex would miss.
 * - Expression functions are pure with no side effects — safe to call with dummy values.
 *
 * Spec S01, Spec S02.
 *
 * @module components/tugways/formula-reverse-map
 */

import type {
  DerivationFormulas,
  DerivationRule,
  ResolvedHueSlots,
} from "./theme-engine";

// ---------------------------------------------------------------------------
// Public types — Spec S01
// ---------------------------------------------------------------------------

/**
 * A single entry in the fieldToTokens map: one token and the property
 * of that token controlled by the associated formula field.
 */
export interface FormulaTokenMapping {
  /** CSS token name, e.g. "surface-app-bg" */
  token: string;
  /** Which property this field controls: "intensity" | "tone" | "alpha" | "hueSlot" */
  property: "intensity" | "tone" | "alpha" | "hueSlot";
}

/**
 * A single entry in the tokenToFields map: one formula field and the property
 * it controls for the associated token.
 */
export interface TokenFormulaMapping {
  /** DerivationFormulas field name, e.g. "surfaceAppTone" */
  field: string;
  /** Which property this field controls: "intensity" | "tone" | "alpha" | "hueSlot" */
  property: "intensity" | "tone" | "alpha" | "hueSlot";
}

/**
 * Bidirectional mapping between formula fields and CSS tokens.
 *
 * fieldToTokens: for each formula field, which tokens does it affect?
 * tokenToFields: for each token, which formula fields affect it?
 */
export interface ReverseMap {
  fieldToTokens: Map<string, FormulaTokenMapping[]>;
  tokenToFields: Map<string, TokenFormulaMapping[]>;
}

// ---------------------------------------------------------------------------
// Direct ResolvedHueSlots keys — used to distinguish mediated vs direct hue slots
// ---------------------------------------------------------------------------

/**
 * All direct keys of ResolvedHueSlots. If a ChromaticRule.hueSlot is one of
 * these, it does NOT require formulas mediation. All other non-sentinel hueSlot
 * values are formulas-mediated (accessed as formulas[hueSlot + "HueSlot"]).
 *
 * Sentinel values (white, highlight, shadow, highlightVerbose) are handled
 * specially by evaluateRules and do not access formulas at all.
 */
const RESOLVED_HUE_SLOT_KEYS = new Set<string>([
  // Recipe hues
  "text",
  "canvas",
  "frame",
  "card",
  "borderTint",
  "action",
  "accent",
  // Element hues
  "control",
  "display",
  "informational",
  "decorative",
  // Semantic hues
  "destructive",
  "success",
  "caution",
  "agent",
  "data",
  // Per-tier derived hues
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
 * Sentinel hueSlot values that bypass formula evaluation entirely.
 * These produce fixed white/black/transparent colors.
 */
const SENTINEL_HUE_SLOTS = new Set<string>([
  "white",
  "highlight",
  "shadow",
  "highlightVerbose",
]);

// ---------------------------------------------------------------------------
// Proxy factory — intercepts property access on a dummy DerivationFormulas object
// ---------------------------------------------------------------------------

/**
 * Creates a Proxy around a dummy DerivationFormulas object that records which
 * fields are accessed. Returns the proxy and an accessor for the accessed fields set.
 */
function makeTrackingProxy(): {
  proxy: DerivationFormulas;
  getAccessed: () => Set<string>;
} {
  const accessed = new Set<string>();
  const proxy = new Proxy({} as DerivationFormulas, {
    get(_target, prop: string | symbol) {
      if (typeof prop === "string") {
        accessed.add(prop);
      }
      // Return 0 for all accesses — a safe dummy value for numeric fields.
      // String fields (hueSlot dispatch) also get 0, which is fine since we
      // only care about WHICH fields were accessed, not the values.
      return 0;
    },
  });
  return { proxy, getAccessed: () => accessed };
}

// ---------------------------------------------------------------------------
// Helper: record a mapping in both directions
// ---------------------------------------------------------------------------

function recordMapping(
  token: string,
  field: string,
  property: "intensity" | "tone" | "alpha" | "hueSlot",
  fieldToTokens: Map<string, FormulaTokenMapping[]>,
  tokenToFields: Map<string, TokenFormulaMapping[]>,
): void {
  // fieldToTokens
  if (!fieldToTokens.has(field)) {
    fieldToTokens.set(field, []);
  }
  fieldToTokens.get(field)!.push({ token, property });

  // tokenToFields
  if (!tokenToFields.has(token)) {
    tokenToFields.set(token, []);
  }
  tokenToFields.get(token)!.push({ field, property });
}

// ---------------------------------------------------------------------------
// buildReverseMap — Spec S02
// ---------------------------------------------------------------------------

/**
 * Builds the bidirectional reverse map from DerivationFormulas fields to CSS tokens.
 *
 * Dispatches on each rule's `type` to determine which expression functions to probe:
 * - ChromaticRule: intensityExpr, toneExpr, alphaExpr (if present), hueSlot mediation
 * - ShadowRule: alphaExpr only (base color is fixed black)
 * - HighlightRule: alphaExpr only (base color is fixed white)
 * - StructuralRule: valueExpr and resolvedExpr (if present)
 * - WhiteRule, InvariantRule: skip (no formula expressions)
 *
 * For each probed expression, wraps a Proxy around a dummy DerivationFormulas object
 * and records which fields were accessed via the get trap.
 *
 * Spec S02.
 */
export function buildReverseMap(
  rules: Record<string, DerivationRule>,
): ReverseMap {
  const fieldToTokens = new Map<string, FormulaTokenMapping[]>();
  const tokenToFields = new Map<string, TokenFormulaMapping[]>();

  for (const [token, rule] of Object.entries(rules)) {
    switch (rule.type) {
      case "chromatic": {
        // Probe intensityExpr
        try {
          const { proxy, getAccessed } = makeTrackingProxy();
          rule.intensityExpr(proxy);
          for (const field of getAccessed()) {
            recordMapping(token, field, "intensity", fieldToTokens, tokenToFields);
          }
        } catch {
          // Expression threw with dummy values — skip these fields
        }

        // Probe toneExpr
        try {
          const { proxy, getAccessed } = makeTrackingProxy();
          rule.toneExpr(proxy);
          for (const field of getAccessed()) {
            recordMapping(token, field, "tone", fieldToTokens, tokenToFields);
          }
        } catch {
          // Expression threw with dummy values — skip
        }

        // Probe alphaExpr (optional)
        if (rule.alphaExpr) {
          try {
            const { proxy, getAccessed } = makeTrackingProxy();
            rule.alphaExpr(proxy);
            for (const field of getAccessed()) {
              recordMapping(token, field, "alpha", fieldToTokens, tokenToFields);
            }
          } catch {
            // Expression threw with dummy values — skip
          }
        }

        // Handle hueSlot mediation:
        // If hueSlot is not a direct ResolvedHueSlots key and not a sentinel,
        // then the rule reads formulas[hueSlot + "HueSlot"] to get the actual slot.
        // Record that hueSlot formula field.
        if (
          !RESOLVED_HUE_SLOT_KEYS.has(rule.hueSlot) &&
          !SENTINEL_HUE_SLOTS.has(rule.hueSlot)
        ) {
          const hueSlotField = rule.hueSlot + "HueSlot";
          recordMapping(token, hueSlotField, "hueSlot", fieldToTokens, tokenToFields);
        }
        break;
      }

      case "shadow": {
        // Shadow: alphaExpr only (base color is fixed black)
        try {
          const { proxy, getAccessed } = makeTrackingProxy();
          rule.alphaExpr(proxy);
          for (const field of getAccessed()) {
            recordMapping(token, field, "alpha", fieldToTokens, tokenToFields);
          }
        } catch {
          // Expression threw with dummy values — skip
        }
        break;
      }

      case "highlight": {
        // Highlight: alphaExpr only (base color is fixed white)
        try {
          const { proxy, getAccessed } = makeTrackingProxy();
          rule.alphaExpr(proxy);
          for (const field of getAccessed()) {
            recordMapping(token, field, "alpha", fieldToTokens, tokenToFields);
          }
        } catch {
          // Expression threw with dummy values — skip
        }
        break;
      }

      case "structural": {
        // Probe valueExpr — pass empty object cast to ResolvedHueSlots as second param (OF3)
        try {
          const { proxy, getAccessed } = makeTrackingProxy();
          rule.valueExpr(proxy, {} as ResolvedHueSlots);
          for (const field of getAccessed()) {
            // StructuralRule fields can control any property; we use "tone" as a
            // generic label for structural value fields (they are non-color values
            // and cannot do drag preview during drag, only on release).
            recordMapping(token, field, "tone", fieldToTokens, tokenToFields);
          }
        } catch {
          // Expression threw with dummy values — skip
        }

        // Probe resolvedExpr (optional)
        if (rule.resolvedExpr) {
          try {
            const { proxy, getAccessed } = makeTrackingProxy();
            rule.resolvedExpr(proxy);
            for (const field of getAccessed()) {
              recordMapping(token, field, "tone", fieldToTokens, tokenToFields);
            }
          } catch {
            // Expression threw with dummy values — skip
          }
        }
        break;
      }

      case "white":
      case "invariant":
        // No formula expressions — skip
        break;
    }
  }

  return { fieldToTokens, tokenToFields };
}
