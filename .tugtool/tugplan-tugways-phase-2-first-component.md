## Tugways Phase 2: First Component and Gallery {#tugways-phase-2}

**Purpose:** Ship TugButton (all four subtypes, direct-action only) as the first tugways component and a Component Gallery panel to visually prove the design system works end-to-end in the running app.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-2-first-component |
| Last updated | 2026-03-02 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 1 (Theme Foundation) is complete. Tokens are renamed to `--tways-` prefix, the theme-as-CSS-stylesheet injection pattern is operational, motion tokens exist in `tokens.css`, the `components/tugways/` directory is created (currently empty with `.gitkeep`), and `TugThemeProvider` handles theme state and Mac menu switching. The canvas is an empty dark grid after Phase 0 demolition.

Phase 2 creates the first tugways component (TugButton) and a lightweight Component Gallery panel to display it. This proves the component system pattern before any card infrastructure exists. TugButton wraps shadcn's `Button`, adds tugways variant tokens, four subtypes (push, icon, icon-text, three-state), and loading state. The gallery is a simple absolute-positioned div on the canvas, toggled by a Mac Developer menu item via the existing `sendControl` and `action-dispatch` pattern.

#### Strategy {#strategy}

- Build TugButton first as a standalone module in `components/tugways/tug-button.tsx`, wrapping shadcn `Button` with the tugways API surface.
- Implement only direct-action mode (`onClick`); chain-action mode (`action` prop) deferred to Phase 3 when the responder chain exists.
- Style TugButton with `var(--td-*)` semantic tokens so theme switches are zero-re-render CSS variable updates.
- Build the Component Gallery as a simple React component rendered in an absolute-positioned div directly inside DeckCanvas, toggled by React state.
- Wire the gallery toggle via a new `show-component-gallery` action in `action-dispatch.ts`, triggered from the Mac Developer menu.
- Add the "Show Component Gallery" menu item to the existing Developer menu in AppDelegate, only visible when dev mode is enabled.
- Write unit tests for TugButton (render, props, subtypes, states) and integration tests for the `show-component-gallery` action handler.

#### Success Criteria (Measurable) {#success-criteria}

- TugButton renders all four subtypes (push, icon, icon-text, three-state) with all four variants (primary, secondary, ghost, destructive) and three sizes (sm, md, lg) (`bun test` passes for render matrix)
- Three-state button toggles between on and off states on click, with correct `aria-pressed` values (`bun test` assertion)
- Loading state shows spinner overlay and disables interaction (`bun test` assertion)
- Component Gallery panel appears when "Show Component Gallery" is selected from the Developer menu (manual: Mac menu sends control frame, gallery div appears on canvas)
- Component Gallery panel shows TugButton in all subtype/variant/size combinations (visual: gallery renders complete matrix)
- Theme switching updates all TugButton instances in the gallery in real time without re-mount (visual: switch theme via the Tug app menu > Theme submenu, gallery colors update)
- `bun test` passes with zero failures for all new and existing tests

#### Scope {#scope}

1. `TugButton` component with four subtypes, four variants, three sizes, loading state, and direct-action mode
2. Component Gallery panel as an absolute-positioned div in DeckCanvas
3. `show-component-gallery` action handler in `action-dispatch.ts`
4. "Show Component Gallery" Mac Developer menu item in AppDelegate
5. Unit tests for TugButton and action-dispatch integration tests for the gallery toggle

#### Non-goals (Explicitly out of scope) {#non-goals}

- Chain-action mode (`action` prop, responder chain integration) -- deferred to Phase 3
- DeckManager card infrastructure (the gallery is not a card, not managed by DeckManager)
- Gallery position persistence (position is hardcoded, not saved to localStorage)
- Drag/resize of the gallery panel
- Any components beyond TugButton (later phases add components to the gallery)

#### Dependencies / Prerequisites {#dependencies}

- Phase 0 (Demolition) complete: empty canvas, no cards, connection working
- Phase 1 (Theme Foundation) complete: `--tways-` tokens, `--td-*` semantic tokens, stylesheet injection, `TugThemeProvider`, `components/tugways/` directory exists
- shadcn `Button` primitive available at `components/ui/button.tsx`
- `action-dispatch.ts` with `registerAction` / `dispatchAction` pattern operational
- Mac `AppDelegate` with Developer menu and `sendControl` pattern operational

#### Constraints {#constraints}

- TugButton must use `var(--td-*)` semantic tokens for all colors -- no hardcoded Tailwind color classes
- Gallery panel must not use DeckManager or any card infrastructure
- Gallery must render in the same React tree as DeckCanvas (inside `TugThemeProvider`)
- All new code must pass `bun test` with zero warnings

#### Assumptions {#assumptions}

- The `show-component-gallery` action is a new distinct action name (not reusing `show-card`), consistent with Phase 0 demolition that removed `show-card` handling
- The gallery panel does not participate in DeckManager layout persistence -- its position is hardcoded, not saved to localStorage
- No Swift changes are needed beyond adding the "Show Component Gallery" menu item to AppDelegate -- the `sendControl` pattern used for `set-theme` applies directly
- Lucide React icons are available for icon and icon-text button subtypes (already a project dependency via shadcn)

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor-name}` anchors on all referenceable headings. Execution steps cite decisions by `[DNN]` ID, specs by `Spec SNN`, and sections by `#anchor` references. No line-number citations.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarifying questions were resolved during planning:

- Chain-action mode: skip entirely in Phase 2, add in Phase 3 (user answer)
- Gallery frame: absolute-positioned div in DeckCanvas, fixed position/size, toggled by React state (user answer)
- Menu item placement: inside existing Developer menu, dev-mode gated (user answer)
- TugButton subtypes: all four (push, icon, icon-text, three-state) including loading state (user answer)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| TugButton CSS conflicts with shadcn defaults | med | low | Override shadcn classes via tugways-specific CSS; use `var(--td-*)` tokens exclusively | Visual glitches after theme switch |
| Gallery z-index conflicts with DisconnectBanner | low | low | Gallery uses a known z-index below the banner; banner already uses a high z-index | Gallery hidden behind banner |

**Risk R01: TugButton CSS conflicts with shadcn defaults** {#r01-css-conflicts}

- **Risk:** shadcn's `Button` uses hardcoded Tailwind classes (`bg-primary`, `bg-destructive`, etc.) which resolve through the Tailwind bridge in `globals.css`. TugButton's tugways-specific styling could conflict.
- **Mitigation:** TugButton applies its own CSS classes that use `var(--td-*)` tokens directly, overriding shadcn's defaults via higher-specificity selectors. The shadcn bridge aliases (`--primary`, `--secondary`, etc.) already map to `--td-*` tokens, so the two systems are compatible. Test all variant/theme combinations in the gallery.
- **Residual risk:** Future shadcn upgrades may introduce new class patterns that need updating.

---

### Design Decisions {#design-decisions}

#### [D01] TugButton wraps shadcn Button as a private implementation detail (DECIDED) {#d01-wrap-shadcn}

**Decision:** TugButton imports and wraps `components/ui/button.tsx` (shadcn's `Button`). The shadcn component is the implementation; TugButton is the public API. App code never imports from `components/ui/button` directly.

**Rationale:**
- shadcn provides solid Radix integration, CVA variant management, ref forwarding, and accessible defaults
- Wrapping gives us control over the API surface -- we expose only what tugdeck needs
- Matches the design doc's component-kinds pattern: TugButton is a "wrapper" component ([D05] from design-system-concepts.md)

**Implications:**
- `components/ui/button.tsx` remains unchanged -- it is the private layer
- TugButton re-exports no shadcn-specific props (`asChild`, shadcn `variant` names)
- TugButton maps its own variant/size props to shadcn equivalents internally

#### [D02] Direct-action only in Phase 2 (DECIDED) {#d02-direct-action-only}

**Decision:** TugButton in Phase 2 supports only direct-action mode (`onClick` handler). The `action` prop and chain-action mode are deferred to Phase 3 when the responder chain exists.

**Rationale:**
- The responder chain (Phase 3) does not exist yet -- chain-action requires `validateAction` and chain dispatch
- Direct-action covers all Phase 2 use cases (gallery variant toggles, standalone buttons)
- Adding the `action` prop type now but leaving it unimplemented would create a misleading API

**Implications:**
- The `action` prop is not present in the Phase 2 `TugButtonProps` interface
- `aria-disabled` chain-validation behavior is also deferred
- Phase 3 will extend `TugButtonProps` to add `action` and chain-action behavior

#### [D03] Gallery as absolute-positioned div in DeckCanvas (DECIDED) {#d03-gallery-div}

**Decision:** The Component Gallery renders as an absolute-positioned `<div>` directly in DeckCanvas, toggled by React state driven by `action-dispatch`. It does not use DeckManager, card infrastructure, or layout persistence.

**Rationale:**
- No card infrastructure exists (demolished in Phase 0, rebuilt in Phase 5)
- The gallery is a development/testing tool, not a user-facing card
- A simple div with fixed position and size is the minimal viable approach
- React state toggle driven by action-dispatch matches the existing `set-theme` pattern

**Implications:**
- Gallery position is not persisted -- it resets on page reload
- Gallery does not participate in snap/dock/set geometry
- Gallery will be migrated to a proper card in Phase 5 or later when Tugcard infrastructure exists

#### [D04] TugButton CSS uses semantic tokens exclusively (DECIDED) {#d04-semantic-tokens}

**Decision:** TugButton's variant colors reference `var(--td-*)` semantic tokens. No hardcoded hex, no raw Tailwind color classes. Theme switches update CSS variables at the DOM level -- TugButton re-paints without React re-renders.

**Rationale:**
- Matches the design doc's appearance-zone specification (zero re-renders for theme changes)
- Semantic tokens (`--td-accent`, `--td-bg`, `--td-text`, `--td-danger`, etc.) are already mapped from `--tways-*` palette via `tokens.css`
- The shadcn bridge aliases (`--primary`, `--secondary`, `--destructive`) already resolve to `--td-*` tokens, so shadcn's own classes are compatible

**Implications:**
- TugButton's custom CSS file uses only `var(--td-*)` references, never literal colors
- Theme switching is verified in the gallery by observing real-time color updates

#### [D05] All four subtypes implemented in Phase 2 (DECIDED) {#d05-all-subtypes}

**Decision:** Phase 2 implements all four TugButton subtypes: push (standard click button), icon (icon-only, square aspect ratio), icon-text (icon + label), and three-state (on/off/mixed toggle). Loading state is implemented for all subtypes.

**Rationale:**
- The full subtype matrix is needed to prove the component pattern handles variant complexity
- Each subtype exercises different accessibility requirements (`aria-pressed`, `aria-label`)
- The Component Gallery needs a rich set of variants to be a useful visual testing tool

**Implications:**
- Three-state subtype needs `state` and `onStateChange` props
- Icon subtype needs `icon` prop and dev-mode warning when `aria-label` is missing
- Loading state needs spinner overlay component and `aria-busy` attribute

---

### Specification {#specification}

#### TugButton Props Interface {#tugbutton-props}

**Spec S01: TugButtonProps** {#s01-tugbutton-props}

```typescript
interface TugButtonProps {
  subtype?: "push" | "icon" | "icon-text" | "three-state";  // default: "push"
  variant?: "primary" | "secondary" | "ghost" | "destructive";  // default: "secondary"
  size?: "sm" | "md" | "lg";  // default: "md"

  // Direct-action mode
  onClick?: () => void;

  // Standard
  disabled?: boolean;
  loading?: boolean;   // shows spinner, disables interaction
  children?: React.ReactNode;

  // Icon support
  icon?: React.ReactNode;  // Lucide icon for "icon" and "icon-text" subtypes

  // Three-state support
  state?: "on" | "off" | "mixed";  // for "three-state" subtype
  onStateChange?: (state: "on" | "off") => void;

  // Accessibility
  "aria-label"?: string;

  // HTML pass-through
  className?: string;
}
```

Note: The `action` prop for chain-action mode is omitted in Phase 2 per [D02].

#### Subtype Behavior Matrix {#subtype-matrix}

**Table T01: TugButton Subtype Behaviors** {#t01-subtype-behaviors}

| Subtype | Layout | Icon Required | Children Required | aria-pressed | Click Behavior |
|---------|--------|--------------|-------------------|-------------|----------------|
| `push` | Standard button | No | Yes | No | Calls `onClick` |
| `icon` | Square, icon-only | Yes | No | No | Calls `onClick` |
| `icon-text` | Icon + label | Yes | Yes | No | Calls `onClick` |
| `three-state` | Standard button + state indicator | No | Yes | Yes (`true`/`false`/`mixed`) | Toggles on/off, calls `onStateChange` |

#### Variant-to-Token Mapping {#variant-tokens}

**Table T02: TugButton Variant Token Mapping** {#t02-variant-tokens}

| Variant | Background Token | Text Token | Hover Treatment |
|---------|-----------------|------------|-----------------|
| `primary` | `var(--td-accent)` | `var(--td-text-inverse)` | opacity 0.9 via CSS |
| `secondary` | `var(--td-surface-control)` | `var(--td-text)` | opacity 0.8 via CSS |
| `ghost` | transparent | `var(--td-text)` | `var(--td-surface-control)` on hover (requires CSS override -- see below) |
| `destructive` | `var(--td-danger)` | `var(--td-text-inverse)` | opacity 0.9 via CSS |

These map through the shadcn bridge aliases: `--primary` resolves to `var(--td-accent)`, `--secondary` to `var(--td-surface-control)`, etc. For primary, secondary, and destructive variants, shadcn's classes are compatible because the bridge aliases map to the correct `--td-*` tokens. However, the **ghost variant requires an explicit CSS override** in `tug-button.css`: shadcn's ghost uses `hover:bg-accent` which resolves to `var(--td-accent-cool)` (cyan) via the bridge, not `var(--td-surface-control)` as designed. The override in `tug-button.css` must set the ghost hover background to `var(--td-surface-control)`. TugButton also applies tugways-specific classes for the `icon` subtype's square aspect ratio and the `three-state` subtype's state indicator.

#### Size-to-Class Mapping {#size-classes}

**Table T03: TugButton Size Mapping** {#t03-size-mapping}

| TugButton Size | shadcn Size | Dimensions |
|---------------|-------------|------------|
| `sm` | `sm` | h-9, px-3 |
| `md` | `default` | h-10, px-4 |
| `lg` | `lg` | h-11, px-8 |

For `icon` subtype, all sizes use square aspect ratio: `sm` = h-9 w-9, `md` = h-10 w-10, `lg` = h-11 w-11.

#### Loading State Spec {#loading-state}

**Spec S02: TugButton Loading State** {#s02-loading-state}

When `loading={true}`:
1. A spinner overlay (CSS animation using `--td-duration-moderate` and `--td-easing-standard`) covers the button content
2. The button is visually dimmed (opacity via CSS)
3. Click events are suppressed (pointer-events: none)
4. `aria-busy="true"` is set on the button element
5. Screen readers announce the loading state

The spinner is a simple CSS-only rotating border animation -- no external spinner library.

#### Accessibility Spec {#accessibility-spec}

**Spec S03: TugButton Accessibility** {#s03-accessibility}

| Concern | Subtype | Implementation |
|---------|---------|----------------|
| `aria-pressed` | `three-state` | `"true"`, `"false"`, or `"mixed"` matching `state` prop |
| `aria-label` | `icon` (no visible text) | Required; dev-mode console warning if missing |
| `aria-busy` | all (when `loading`) | Set to `"true"` when loading |
| `disabled` | all | HTML `disabled` attribute when `disabled={true}` |
| Focus ring | all | Via shadcn's `:focus-visible` ring styling (uses `--ring` token) |
| Keyboard | `three-state` | Space toggles on/off (mixed is programmatic only) |

#### Gallery Panel Spec {#gallery-spec}

**Spec S04: Component Gallery Panel** {#s04-gallery-panel}

The Component Gallery is a floating panel rendered as an absolute-positioned `<div>` in DeckCanvas.

**Layout:**
- Position: `position: absolute; top: 64px; left: 64px`
- Size: `width: 640px; max-height: calc(100vh - 128px)`
- Background: `var(--td-bg)` with `var(--td-border)` border
- Overflow: vertical scroll
- Z-index: above canvas grid, below DisconnectBanner
- Border radius: `var(--radius)` (shadcn token)

**Content:**
- Title bar with "Component Gallery" label and close button (TugButton, icon subtype, X icon)
- Sections for each component (Phase 2: TugButton only)
- Each section shows all subtype/variant/size combinations in a grid layout
- Interactive toggles for: variant selector, size selector, disabled state, loading state

**Toggle mechanism:**
- Action name: `show-component-gallery`
- Payload: `{ action: "show-component-gallery" }` (no additional params)
- Behavior: toggles visibility -- if hidden, show; if shown, hide

#### Action Registration Spec {#action-spec}

**Spec S05: show-component-gallery Action** {#s05-gallery-action}

```typescript
registerAction("show-component-gallery", () => {
  gallerySetterRef?.((prev: boolean) => !prev);
});
```

The gallery visibility state is owned by DeckCanvas via `useState<boolean>(false)`. A module-level `gallerySetterRef` typed as `React.Dispatch<React.SetStateAction<boolean>> | null` connects the action handler to the React state. The registration pattern mirrors `themeSetterRef`, but the type differs: `themeSetterRef` accepts a direct value (`(theme: string) => void`) while `gallerySetterRef` accepts a React state dispatch (`(value: SetStateAction<boolean>) => void`) to support the toggle-via-callback pattern shown above.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tug-button.tsx` | TugButton component -- wraps shadcn Button with tugways API |
| `tugdeck/src/components/tugways/tug-button.css` | TugButton styles -- tugways-specific CSS using `var(--td-*)` tokens |
| `tugdeck/src/components/tugways/component-gallery.tsx` | Component Gallery panel -- renders all tugways components with variant toggles |
| `tugdeck/src/components/tugways/component-gallery.css` | Component Gallery styles -- panel layout, sections, grid |
| `tugdeck/src/__tests__/tug-button.test.tsx` | Unit tests for TugButton |
| `tugdeck/src/__tests__/component-gallery-action.test.ts` | Integration test for show-component-gallery action |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugButton` | function component | `components/tugways/tug-button.tsx` | Public API for buttons |
| `TugButtonProps` | interface | `components/tugways/tug-button.tsx` | Props contract per Spec S01 |
| `ComponentGallery` | function component | `components/tugways/component-gallery.tsx` | Gallery panel |
| `registerGallerySetter` | function | `action-dispatch.ts` | Register gallery toggle setter (same pattern as `registerThemeSetter`) |
| `show-component-gallery` | action handler | `action-dispatch.ts` | Registered in `initActionDispatch` |
| `DeckCanvas` | modified component | `components/chrome/deck-canvas.tsx` | Add gallery state, render ComponentGallery conditionally |
| `showComponentGallery` | @objc method | `AppDelegate.swift` | Mac menu action handler |

---

### Documentation Plan {#documentation-plan}

- [ ] TugButton props documented via TypeScript interface comments in `tug-button.tsx`
- [ ] Component Gallery usage documented in inline code comments
- [ ] No external docs needed -- the gallery itself is the visual documentation

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test TugButton rendering, props, subtypes, accessibility attributes | Core component logic |
| **Integration** | Test `show-component-gallery` action dispatches correctly and toggles state | Action-dispatch wiring |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Create TugButton component {#step-1}

**Commit:** `feat(tugdeck): add TugButton component wrapping shadcn Button with tugways API`

**References:** [D01] TugButton wraps shadcn Button, [D02] Direct-action only, [D04] Semantic tokens, [D05] All four subtypes, Spec S01, Spec S02, Spec S03, Table T01, Table T02, Table T03, (#tugbutton-props, #subtype-matrix, #variant-tokens, #size-classes, #loading-state, #accessibility-spec)

**Artifacts:**
- `tugdeck/src/components/tugways/tug-button.tsx` -- TugButton component
- `tugdeck/src/components/tugways/tug-button.css` -- TugButton styles

**Tasks:**
- [ ] Create `tug-button.tsx` in `components/tugways/` with `TugButtonProps` interface per Spec S01
- [ ] Import shadcn `Button` from `components/ui/button` and wrap it
- [ ] Map TugButton `variant` prop to shadcn variants: `primary` -> `default`, `secondary` -> `secondary`, `ghost` -> `ghost`, `destructive` -> `destructive`
- [ ] Map TugButton `size` prop to shadcn sizes: `sm` -> `sm`, `md` -> `default`, `lg` -> `lg`
- [ ] Implement `push` subtype: standard button with `onClick`, `children`
- [ ] Implement `icon` subtype: square aspect ratio, `icon` prop required, `aria-label` dev warning
- [ ] Implement `icon-text` subtype: icon + label layout, both `icon` and `children`
- [ ] Implement `three-state` subtype: `aria-pressed` attribute, Space toggles on/off, `onStateChange` callback
- [ ] Implement loading state: spinner overlay, `aria-busy`, pointer-events disabled
- [ ] Create `tug-button.css` with tugways-specific classes using `var(--td-*)` tokens
- [ ] Override ghost variant hover style in `tug-button.css`: shadcn's ghost uses `hover:bg-accent` which resolves to `var(--td-accent-cool)` (cyan) via the bridge; override to use `var(--td-surface-control)` per Table T02
- [ ] Spinner animation uses `--td-duration-moderate` and `--td-easing-standard` motion tokens
- [ ] Remove `.gitkeep` from `components/tugways/` (no longer needed once real files exist)

**Tests:**

Note: `tug-button.test.tsx` must import `"./setup-rtl"` as the first import line (required for all `.tsx` test files using React Testing Library).

- [ ] TugButton renders with default props (push, secondary, md)
- [ ] Each subtype renders correctly: push, icon, icon-text, three-state
- [ ] Each variant applies correct CSS classes: primary, secondary, ghost, destructive
- [ ] Each size applies correct CSS classes: sm, md, lg
- [ ] Icon subtype renders with square aspect ratio class
- [ ] Three-state subtype sets `aria-pressed` to match `state` prop
- [ ] Three-state click toggles between on and off, calls `onStateChange`
- [ ] Loading state sets `aria-busy="true"` and shows spinner
- [ ] Disabled state sets `disabled` attribute
- [ ] Icon subtype without `aria-label` or `children` logs dev warning (console.warn mock)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tug-button.test.tsx`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` (all tests pass)

---

#### Step 2: Register show-component-gallery action {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add show-component-gallery action to action-dispatch`

**References:** [D03] Gallery as absolute-positioned div, Spec S05, (#action-spec, #s05-gallery-action)

**Artifacts:**
- `tugdeck/src/action-dispatch.ts` -- add `registerGallerySetter` and `show-component-gallery` handler
- `tugdeck/src/__tests__/component-gallery-action.test.ts` -- action integration tests

**Tasks:**
- [ ] Add module-level `gallerySetterRef` to `action-dispatch.ts` typed as `React.Dispatch<React.SetStateAction<boolean>> | null` (registration pattern mirrors `themeSetterRef` but type differs -- see Spec S05)
- [ ] Add `registerGallerySetter(setter)` export function
- [ ] Register `show-component-gallery` action in `initActionDispatch` that toggles via `gallerySetterRef`
- [ ] Clear `gallerySetterRef` in `_resetForTest()`
- [ ] Write integration tests matching existing `action-dispatch.test.ts` patterns

**Tests:**
- [ ] `show-component-gallery` action calls registered gallery setter
- [ ] `show-component-gallery` does not throw when setter is not registered
- [ ] `registerGallerySetter` replaces previous setter (last-registration-wins)
- [ ] `_resetForTest` clears gallery setter

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/component-gallery-action.test.ts`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/action-dispatch.test.ts`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` (all tests pass)

---

#### Step 3: Create Component Gallery panel {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add Component Gallery panel with TugButton showcase`

**References:** [D03] Gallery as absolute-positioned div, [D05] All four subtypes, Spec S04, Table T01, Table T02, (#gallery-spec, #s04-gallery-panel, #subtype-matrix)

**Artifacts:**
- `tugdeck/src/components/tugways/component-gallery.tsx` -- gallery panel component
- `tugdeck/src/components/tugways/component-gallery.css` -- gallery panel styles

**Tasks:**
- [ ] Create `component-gallery.tsx` with `ComponentGallery` component
- [ ] Props: `onClose: () => void` callback for the close button
- [ ] Title bar: "Component Gallery" label with TugButton close button (icon subtype, X icon)
- [ ] TugButton section: render all subtypes in a grid
- [ ] For each subtype, show all four variants in a row
- [ ] For each variant, show all three sizes
- [ ] Add interactive controls: variant selector dropdown, size selector, disabled toggle, loading toggle
- [ ] Create `component-gallery.css` with panel positioning, layout grid, section styles
- [ ] Panel uses `var(--td-*)` tokens for background, border, text colors
- [ ] Vertical scroll for content overflow

**Tests:**
- [ ] ComponentGallery renders without errors (basic render test in tug-button test file or separate)
- [ ] Close button calls `onClose` callback

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` (all tests pass)

---

#### Step 4: Wire gallery into DeckCanvas {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat(tugdeck): wire Component Gallery toggle into DeckCanvas via action-dispatch`

**References:** [D03] Gallery as absolute-positioned div, Spec S04, Spec S05, (#gallery-spec, #action-spec)

**Artifacts:**
- `tugdeck/src/components/chrome/deck-canvas.tsx` -- add gallery state and conditional rendering

**Tasks:**
- [ ] Add `useState<boolean>(false)` for gallery visibility in DeckCanvas
- [ ] Register the gallery setter with `registerGallerySetter` on mount (via `useEffect`)
- [ ] Conditionally render `<ComponentGallery onClose={...} />` when state is true
- [ ] Close callback sets gallery state to false
- [ ] Gallery div is absolute-positioned per Spec S04 layout values
- [ ] Import `component-gallery.css` in the component

**Tests:**
- [ ] Existing DeckCanvas tests continue to pass (DisconnectBanner still renders)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` (all tests pass)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` (production build succeeds with no errors)

---

#### Step 5: Add Mac Developer menu item {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugapp): add Show Component Gallery menu item to Developer menu`

**References:** [D03] Gallery as absolute-positioned div, Spec S05, (#action-spec)

**Artifacts:**
- `tugapp/Sources/AppDelegate.swift` -- add menu item and action handler

**Tasks:**
- [ ] Add `@objc func showComponentGallery(_ sender: Any?)` method that calls `sendControl("show-component-gallery")`
- [ ] Add the "Show Component Gallery" item between the existing post-Web-Inspector separator and the source tree display section in the Developer menu (no additional separator needed -- the existing separator after "Open Web Inspector" already provides visual separation)
- [ ] Add `NSMenuItem(title: "Show Component Gallery", action: #selector(showComponentGallery(_:)), keyEquivalent: "")` to `devMenu`
- [ ] Menu item inherits Developer menu visibility (only visible when dev mode is enabled)

**Tests:**
- [ ] Manual: enable dev mode, open Developer menu, verify "Show Component Gallery" appears
- [ ] Manual: click "Show Component Gallery", verify gallery panel appears on canvas
- [ ] Manual: click again, verify gallery panel hides (toggle behavior)

**Checkpoint:**
- [ ] Xcode builds `tugapp` without errors
- [ ] Manual verification: Developer menu shows "Show Component Gallery" item when dev mode is on

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] TugButton wraps shadcn Button, [D03] Gallery as absolute-positioned div, [D04] Semantic tokens, [D05] All four subtypes, Spec S01, Spec S04, (#success-criteria)

**Tasks:**
- [ ] Verify Steps 1-5 work together end-to-end
- [ ] Verify TugButton renders correctly in all subtype/variant/size combinations in the gallery
- [ ] Verify theme switching updates gallery buttons in real time (switch via Developer > Settings > Theme submenu)
- [ ] Verify gallery toggle works from Mac Developer menu
- [ ] Verify gallery close button dismisses the panel
- [ ] Verify three-state button toggles correctly in the gallery
- [ ] Verify loading state spinner animation uses motion tokens

**Tests:**
- [ ] All `bun test` tests pass: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` (zero failures)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` (production build succeeds)
- [ ] Manual: full end-to-end flow -- Mac menu toggle, gallery appears, buttons render, theme switch updates colors, close button works

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** TugButton component (all four subtypes, direct-action mode, theme-responsive) and Component Gallery panel visible in the running app via the Mac Developer menu.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] TugButton component exists at `components/tugways/tug-button.tsx` with full TypeScript props interface (verify: file exists and exports `TugButton`)
- [ ] All four subtypes render correctly with correct accessibility attributes (verify: `bun test` passes)
- [ ] Component Gallery panel toggles from Mac Developer menu (verify: manual test)
- [ ] Theme switching updates gallery buttons without re-mount (verify: manual visual test)
- [ ] All existing and new tests pass (verify: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`)
- [ ] Production build succeeds (verify: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`)

**Acceptance tests:**
- [ ] `bun test src/__tests__/tug-button.test.tsx` -- all TugButton unit tests pass
- [ ] `bun test src/__tests__/component-gallery-action.test.ts` -- gallery action tests pass
- [ ] `bun test` -- full test suite passes with zero failures

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 3: Add chain-action mode (`action` prop) to TugButton when responder chain exists
- [ ] Phase 3+: Add `aria-disabled` (vs `disabled`) for chain-validation-disabled buttons
- [ ] Phase 5+: Migrate Component Gallery from absolute-positioned div to proper Tugcard
- [ ] Future: Add new components to the gallery as they are built (TugSwitch, TugInput, TugSelect, etc.)
- [ ] Future: Add gallery section for each new component showing full variant matrix

| Checkpoint | Verification |
|------------|--------------|
| TugButton renders | `bun test src/__tests__/tug-button.test.tsx` |
| Gallery action wired | `bun test src/__tests__/component-gallery-action.test.ts` |
| Full test suite | `cd tugdeck && bun test` |
| Production build | `cd tugdeck && bun run build` |
| End-to-end visual | Manual: Mac menu toggle, gallery visible, theme switch, close |
