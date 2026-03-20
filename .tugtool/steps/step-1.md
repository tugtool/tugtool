# Step 1: Update ContrastRole type, CONTRAST_THRESHOLDS, and pairing map roles

## Plan Reference

Plan: `.tugtool/tugplan-design-vocabulary.md`
Step anchor: `#step-1`
Commit message: `feat(theme): replace contrast role vocabulary and reassign pairing map entries`

## Files Modified

- `tugdeck/src/components/tugways/element-surface-pairing-map.ts` — `ContrastRole` type and all `role` fields in `ELEMENT_SURFACE_PAIRING_MAP`
- `tugdeck/src/components/tugways/theme-accessibility.ts` — `CONTRAST_THRESHOLDS`, `WCAG_CONTRAST_THRESHOLDS`, JSDoc
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — `ContrastResult.role` type; JSDoc comments updated to use new role vocabulary (lines 549, 556, 2301)

## Implementation Notes

- `ContrastRole` type in `element-surface-pairing-map.ts`: removed `body-text`, `subdued-text`, `large-text`, `ui-component`; added `content`, `control`, `display`, `informational`; kept `decorative` unchanged.
- `CONTRAST_THRESHOLDS` in `theme-accessibility.ts`: `content: 75`, `control: 60`, `display: 60`, `informational: 60`, `decorative: 15`.
- `WCAG_CONTRAST_THRESHOLDS` updated to use new role keys.
- `ContrastResult.role` type in `theme-derivation-engine.ts` updated to the new `ContrastRole` union.
- All `role: "body-text"` entries in the pairing map replaced with `role: "content"`.
- All `role: "subdued-text"` entries replaced with `role: "informational"`.
- All `role: "large-text"` entries replaced with `role: "control"`.
- `role: "ui-component"` pairings classified by semantic intent per Table T04: interactive control elements (icons on buttons/tabs/menus, field borders, outlined control borders, toggle/checkbox/radio parts, tabClose text) assigned `role: "control"`; structural/informational elements (global borders, badge borders/text, tone fills/icons, accent fills, muted/subtle/onAccent/inverse text tokens) assigned `role: "informational"`.
- All `role: "decorative"` entries left unchanged.
- JSDoc comments in `theme-derivation-engine.ts` at lines 549, 556, and 2301 updated from `body-text` to the new role vocabulary (`content` role at threshold 75).

## Risk R02 Contrast Test Results

Per plan Risk R02, `bun test -- --grep "contrast"` was run after reassignment:

- **13 pass, 1 fail**
- The single failure is in `contrast-dashboard.test.tsx` at line 101: `results.filter((r) => r.role === "body-text")` returns empty because `body-text` no longer exists as a role. This test file references the old role name and is explicitly scheduled for update in Step 2. This failure is expected and documented per Risk R02.
- No new contrast threshold failures were introduced by the role reassignment itself — the failing test is a test-assertion mismatch, not a contrast check failure.

## Checkpoint 1: TypeScript compilation

**Command:** `cd tugdeck && npx tsc --noEmit`

**Result:** PASSED — zero errors, zero warnings

## Checkpoint 2: audit:tokens lint

**Command:** `cd tugdeck && bun run audit:tokens lint`

```
=== Lint Token Annotations ===

✓ Zero violations. All annotation, alias, and pairing checks pass.
```

**Result:** PASSED — zero violations
