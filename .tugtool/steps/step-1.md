# Step 1: Shadcn Excision (Phase 8a)

## Plan Reference

Plan: `.tugtool/tugplan-tugways-phase-8-radix-redesign.md`
Step anchor: `#step-1`
Commit message: `refactor(tugdeck): remove shadcn layer, wrap Radix primitives directly`

## Files Deleted

- `tugdeck/components.json`
- `tugdeck/styles/shadcn-base.css` (~25KB, animation keyframes relocated to `tug-dropdown.css`)
- `tugdeck/styles/tug-comp-tokens.css` (84 `--tug-comp-*` token definitions, migrated to per-component CSS)
- `tugdeck/src/components/ui/button.tsx`
- `tugdeck/src/components/ui/card.tsx`
- `tugdeck/src/components/ui/checkbox.tsx`
- `tugdeck/src/components/ui/dialog.tsx`
- `tugdeck/src/components/ui/dropdown-menu.tsx`
- `tugdeck/src/components/ui/input.tsx`
- `tugdeck/src/components/ui/radio-group.tsx`
- `tugdeck/src/components/ui/scroll-area.tsx`
- `tugdeck/src/components/ui/select.tsx`
- `tugdeck/src/components/ui/switch.tsx`
- `tugdeck/src/components/ui/tabs.tsx`
- `tugdeck/src/components/ui/textarea.tsx`
- `tugdeck/src/components/ui/tooltip.tsx`

## Files Modified

- `tugdeck/package.json` — removed `class-variance-authority` dependency (no longer referenced)
- `tugdeck/src/css-imports.ts` — removed `shadcn-base.css` import
- `tugdeck/src/globals.css` — removed `@import "../styles/tug-comp-tokens.css"`
- `tugdeck/styles/tug-tokens.css` — updated comment (tier 3 now references component CSS files)
- `tugdeck/src/components/tugways/tug-button.tsx` — rewritten: imports `Slot` from `@radix-ui/react-slot` directly; removes shadcn `Button` wrapper; adds `asChild` prop; adds `tug-button` base class and `tug-button-size-{sm,md,lg}` size classes
- `tugdeck/src/components/tugways/tug-button.css` — rewritten: adds `.tug-button` base class and `.tug-button-size-*` size classes that were previously supplied by shadcn; retains all variant, hover, active, disabled, icon, three-state, and loading styles
- `tugdeck/src/components/tugways/tug-dropdown.tsx` — rewritten: imports `@radix-ui/react-dropdown-menu` directly; wraps `DropdownMenuPrimitive.*` instead of shadcn components; adds `.catch()` to `animate().finished` chain to prevent blinkingRef lockup on WAAPI rejection
- `tugdeck/src/components/tugways/tug-dropdown.css` — migrated `--tug-comp-dropdown-*` → `--tug-dropdown-*`; added animation keyframes relocated from `shadcn-base.css` (`tug-fade-in/out`, `tug-zoom-in/out`, `tug-slide-in/out`); added `body` block defining `--tug-dropdown-*` component tokens
- `tugdeck/src/components/tugways/tug-tab-bar.css` — migrated `--tug-comp-tab-*` → `--tug-tab-*`; added `body` block defining `--tug-tab-*` component tokens
- `tugdeck/src/components/tugways/tugcard.css` — migrated `--tug-comp-card-*` → `--tug-card-*`; added `body` block defining `--tug-card-*` component tokens
- `tugdeck/src/components/tugways/style-inspector-overlay.ts` — migrated `CLASS_TO_COMP_FAMILY` and `COMP_FAMILY_TOKENS` maps from `--tug-comp-*` to `--tug-{tab,card,dropdown}-*` names; updated `originLayer` detection logic to identify component tokens by `--tug-` prefix (excluding `--tug-base-*` and palette vars)
- `tugdeck/src/components/tugways/cards/gallery-cascade-inspector-content.tsx` — updated comments referencing `--tug-comp-dropdown-*` and `--tug-comp-button-*` to use new token names
- `tugdeck/scripts/check-legacy-tokens.sh` — added `run_grep` call for `--tug-comp-` as a banned legacy pattern; updated FAIL message to reference `--tug-<component>-*` naming
- `tugdeck/src/__tests__/scaffold.test.tsx` — replaced shadcn `Button` import with `TugButton`; updated test descriptions
- `tugdeck/src/__tests__/tug-button.test.tsx` — updated variant and size class assertions: `shadcn-button--default` → `tug-button-primary`; `shadcn-button--size-sm` → `tug-button-size-sm`; etc.
- `tugdeck/src/__tests__/style-inspector-overlay.test.ts` — updated `--tug-comp-tab-bar-bg` references to `--tug-tab-bar-bg` in PALETTE_VAR_REGEX test, afterEach cleanup, and resolveTokenChain chain-walk test

## Implementation Notes

- TugButton no longer wraps shadcn Button. It renders a plain `<button>` or uses Radix `Slot` when `asChild` is true. All shadcn class names (`shadcn-button`, `shadcn-button--default`, `shadcn-button--size-*`) are gone; replaced by `tug-button`, `tug-button-{variant}`, and `tug-button-size-{size}`.
- TugDropdown now imports `* as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"` and uses `DropdownMenuPrimitive.Root`, `.Trigger`, `.Portal`, `.Content`, and `.Item` directly. The shadcn `DropdownMenu*` re-exports in `components/ui/dropdown-menu.tsx` are gone.
- Animation keyframes (`shadcn-fade-in/out`, `shadcn-zoom-in/out`, `shadcn-slide-in/out`) have been relocated to `tug-dropdown.css` and renamed with `tug-` prefix (`tug-fade-in`, etc.). No keyframes were lost.
- The `--tug-comp-*` token layer (84 definitions in `tug-comp-tokens.css`) has been fully migrated. Each component now defines its own `--tug-<component>-*` tokens in a `body {}` block at the top of its CSS file. This is equivalent to the old centralized file, but co-located with the component it serves.
- `class-variance-authority` (CVA) was the only dependency removed from `package.json`; `clsx` and `@radix-ui/react-slot` are retained. `bun install` removed 1 package.
- `lib/utils.ts` (`cn()` utility) is retained unchanged — it depends only on `clsx`.
- The `check-legacy-tokens.sh` script now enforces that `--tug-comp-*` cannot reappear in source. The pre-existing `--td-*` violation in `gallery-card.css` is a known pre-existing issue unrelated to this step.

## Checkpoint 1: bun run build

**Command:** `cd tugdeck && bun run build`

```
$ vite build
vite v7.3.1 building client environment for production...
transforming...
✓ 1864 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.90 kB │ gzip:   0.51 kB
dist/assets/index-CHvWIL2Q.css   71.96 kB │ gzip:  11.97 kB
dist/assets/vendor-cl_uhV7R.js  204.53 kB │ gzip:  64.67 kB
dist/assets/index-CkEQL3DX.js   738.96 kB │ gzip: 203.73 kB
✓ built in 1.08s
```

**Result:** PASSED — zero warnings, zero errors

## Checkpoint 2: bun test

**Command:** `cd tugdeck && bun test`

```
 1332 pass
 0 fail
 4361 expect() calls
Ran 1332 tests across 59 files. [8.25s]
```

**Result:** PASSED — 1332 tests pass, 0 fail

## Checkpoint 3: No components/ui imports in production source

**Command:** `grep -r "components/ui" tugdeck/src/ --include="*.tsx" --include="*.ts" | grep -v _archive`

**Result:** PASSED — no import statements found (two comment-only matches in `tug-button.tsx` and `tug-dropdown.tsx` that say "never import from components/ui"; these are documentation, not code)

## Checkpoint 4: No --tug-comp-* tokens remain

**Command:** `grep -r "tug-comp-" tugdeck/src/ tugdeck/styles/ --include="*.css" --include="*.ts" --include="*.tsx"`

**Result:** PASSED — empty output
