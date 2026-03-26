# Design Decisions

*Each decision records a non-obvious choice and its rationale. Decisions are referenced from [laws-of-tug.md](laws-of-tug.md) as `[D##]` and laws are referenced here as `[L##]`.*

---

## Theme & Token Architecture

**D01.** Theme definitions (color choices + recipe reference) are stored as `.json` files in `tugdeck/themes/` (shipped) and `~/.tugtool/themes/` (authored), not as TypeScript constants. Enables runtime loading without rebuilding and the Prototype pattern for new theme authoring. [L06]

**D02.** Two-directory storage with unique names. Shipped themes in `tugdeck/themes/` (version-controlled, read-only). Authored themes in `~/.tugtool/themes/` (user data, not in repo). Names are unique across both directories — middleware checks authored first, then shipped, but uniqueness means no shadowing.

**D03.** Every theme is a peer — no base layer, no override cascade. Switching themes copies the selected theme's complete CSS file into `styles/tug-active-theme.css`. For brio, the source is `styles/themes/brio.css`. For harmony, the source is `styles/themes/harmony.css`. The active theme file is always complete; it is never empty. [L06]

**D04.** `contrastSearch()`, `darkRecipe()`, `lightRecipe()`, and `RECIPE_REGISTRY` are defined in `theme-engine.ts`. `RECIPE_REGISTRY` is the only derivation dispatch path — all `deriveTheme()` calls route through it.

**D86.** The `formulas?: DerivationFormulas` escape hatch is removed from `ThemeRecipe`. The recipe function is the only derivation path. `RECIPE_REGISTRY` is the extension point for new recipe variants.

**D87.** The theme generator card follows Mac document conventions: New (Prototype pattern, copy existing theme), Open (load from available themes), auto-save (500ms debounce to disk), Apply (inject CSS app-wide). Shipped themes open read-only. No explicit Save button.

**D88.** All theme loading goes through the Vite dev middleware. `ThemeName` is a plain `string` (not a hardcoded union). `themeCSSMap` is populated dynamically at startup via `GET /__themes/list`. Supports arbitrary authored themes without code changes.

**D89.** `canvasColorHex()` accepts derived canvas surface params (`hue`, `tone`, `intensity`) extracted from `ThemeOutput.formulas` after running `deriveTheme()`. The raw JSON `surface.canvas.intensity` differs from the derived `surfaceCanvasIntensity`; callers must use the derived value. The `CANVAS_COLORS` lookup table is removed.

**D90.** A theme's `recipe` field (`"dark"` or `"light"`) is set once at theme creation (copied from the prototype) and is immutable. The generator card displays recipe as a read-only label, not a toggle.

**D91.** The Swift Theme submenu uses `NSMenuDelegate.menuNeedsUpdate(_:)` to populate items dynamically from a cached theme list. The web view pushes updated theme lists to Swift via the `themeListUpdated` bridge message. Eliminates hardcoded menu items and per-theme `@objc` handlers.

**D92.** Bluenote is removed from the entire codebase — Swift menu, action dispatch, theme provider, and any CSS files.

**D70.** Color palette is OKLCH-based. 24 hue families with intensity/tone axes, 5 convenience presets per hue, neutral ramp, P3 gamut support, pure CSS formulas. [L15]

**D71.** Four-prefix token naming: `--tugc-{hue}[-preset]` (palette), `--tug7-*` (seven-slot semantic surface and element tokens), `--tugx-<component>-*` (component alias), `--tug-*` (scale/dimension). [L17, L18]

**D72.** Global dimension scale via `--tug-zoom` multiplier on `:root`.

**D73.** Global timing via `--tug-timing` (duration multiplier) and `--tug-motion` (binary on/off toggle) on `:root`.

**D75.** Achromatic neutral ramp (`--tug-neutral-*`). Alpha via CSS relative color syntax, not separate opacity tokens.

**D80.** `--tug-color()` notation expands to `oklch()` at build time via PostCSS plugin (`postcss-tug-color.ts`). Theme files use the notation; browsers never see it.

**D81.** Token pairings are machine-auditable. Every foreground-on-background relationship is extractable from CSS — either via same-rule `background-color` or via `@tug-renders-on` annotation. `audit-tokens lint` enforces zero violations. [L16]

**D82.** Four semantic contrast roles govern text legibility: `content` (75), `control` (60), `display` (60), `informational` (60). Each role maps to a hue slot derived from the recipe's text and display specs. The pairing map assigns every foreground token a contrast role for threshold enforcement. [L15, L18]

**D83.** Five contrast roles with minimum thresholds: `content` (75), `control` (60), `display` (60), `informational` (60), `decorative` (15). All readable text >= 60. [L16]

**D84.** Theme application uses stylesheet injection (`<style id="tug-theme-override">`), not body class toggling. [L06]

**D85.** Optional palette entries use `var()` fallbacks so themes can omit slots gracefully. [L15]

---

## Component Model

**D05.** Three component kinds: *wrappers* (thin Radix adapters), *compositions* (assemble multiple primitives), *originals* (built from scratch).

**D06.** `components/tugways/` is the public component API surface.

**D07.** Components are module-scope functions composed via JSX nesting, not class hierarchies or render props.

**D08.** TugButton has two modes: *direct-action* (`onClick` prop) and *chain-action* (`action` prop dispatches into responder chain). [L11]

**D15.** Tugcard is composition, not inheritance. It assembles chrome (header, icon, accessory, content) around card content provided by the caller. [L09]

**D16.** Card data access via `useTugcardData()` hook, not render props.

**D17.** Cards compute dynamic min-size from content and report via `onMinSizeChange`.

**D22.** Component Gallery card serves as living inventory — 21 tabbed demos covering all tugways components. [L10]

**D39.** Default button: responder chain designates one button per scope. Enter key routes to it. [L11]

**D43.** Component Gallery is a proper card with tabs, not a floating panel. [L10]

---

## Responder Chain & Actions

**D09.** Responder chain operates entirely outside React state. `ResponderChainManager` is a plain TypeScript class. [L01, L02, L07]

**D10.** Four-stage key processing pipeline: keybinding resolution, responder dispatch, default handling, browser passthrough.

**D11.** Two-level action validation: `canHandle` (fast routing check) + `validateAction` (semantic validation with current state). [L07]

**D61.** `ActionEvent` carries typed payload, sender identity, and phase. [L11]

**D62.** Two dispatch modes: *nil-target* (chain walks until a responder handles it) and *explicit-target* (dispatched to a specific responder). [L11]

**D63.** Controls (buttons, sliders, pickers) dispatch ActionEvents into the chain but never register as responder nodes. [L11]

---

## State & Mutation Zones

**D12.** Three-zone mutation model: *appearance* (CSS/DOM, zero re-renders), *local data* (targeted React state), *structure* (subtree changes via store). [L06, L08]

**D13.** DOM utility hooks for appearance zone: `useCSSVar`, `useDOMClass`, `useDOMStyle`. All bypass React state. [L06]

**D40.** DeckManager is a subscribable store. Implements `subscribe()`/`getSnapshot()` for `useSyncExternalStore`. Exactly one `root.render()` call, at construction. [L01, L02]

**D41.** `useResponder` uses `useLayoutEffect` for registration so responder nodes are wired before any events fire. [L03]

**D42.** No repeated `root.render()` from external code. All state changes flow through `notify()` and `useSyncExternalStore`. [L01]

**D64.** Mutation transactions: `begin` (snapshot CSS inline styles) → `preview` (live CSS mutations) → `commit`/`cancel`. [L08]

**D65.** Transaction previews operate in appearance zone only. Commit handler may cross into store/React state. [L06, L08]

**D66.** Style cascade reader (`StyleCascadeReader`) provides `getDeclared()` with four source layers: `token`, `class`, `inline`, `preview`.

---

## Cards & Layout

**D27.** Window-shade collapse: double-click title bar toggles card between full and title-bar-only. State stored in `CardState.collapsed`.

**D30.** Tab bar visible only when card has multiple tabs.

**D31.** Tabs are a Tugcard composition feature (chrome layer), not a CardFrame feature (geometry layer). [L09, L10]

**D44.** Progressive tab overflow: three stages — all visible, inactive tabs collapse to icon-only, overflow into dropdown.

**D45.** Card-as-tab merge: dropping a card onto another card's tab bar merges it as a new tab. `detachTab()` reverses.

**D49.** Per-tab state bag preserves `scroll`, `selection`, and `content` across tab switches and reloads.

**D50.** `useTugcardPersistence` hook: card content registers `onSave`/`onRestore` callbacks. Uses `useLayoutEffect` for registration. [L03]

**D51.** Focused card ID persisted in `DeckState.focusedCardId` for reload restoration.

**D52.** Collapsed state persisted in `CardState.collapsed`.

---

## Snap Sets

**D32.** Snap requires Option/Alt modifier during drag (`altKey`).

**D33.** Set-move is always active once a snap set is formed — dragging one member moves all.

**D53.** Set members get squared corners via CSS `data-in-set` attribute.

**D54.** Set perimeter flash via SVG hull polygon (`computeSetHullPolygon()`).

**D55.** Break-out restores rounded corners (CSS-driven) and flashes individual card perimeter.

**D56.** Border collapse: snap positions offset by border width so adjacent cards share a single visual line.

**D57.** Interior set shadows hidden via `clip-path: inset()` on `.tugcard`. Exterior edges extend by `SHADOW_EXTEND_PX`.

**D58.** Active/inactive shadow tokens: `--tug-card-shadow-active` (focused) and `--tug-card-shadow-inactive` (unfocused).

**D59.** Command-key (`metaKey`) suppresses card activation on click, allowing multi-card operations.

**D60.** Resize click activates the card (brings to front).

---

## Selection

**D34.** Three-layer selection containment: CSS `user-select: none` baseline, `SelectionGuard` runtime clipping, `data-td-select` developer API. [L12]

**D35.** `SelectionGuard` is a module-level singleton, not React state. [L01, L12]

**D36.** Pointer-clamped selection uses `caretPositionFromPoint` (with `caretRangeFromPoint` fallback). [L12]

**D37.** Four select modes via `data-td-select` attribute: `default`, `none`, `all`, `custom`. [L12]

**D38.** Cmd+A scoped to focused card via responder chain `selectAll` action. [L12]

---

## Motion & Animation

**D23.** Motion tokens are CSS custom properties: `--tug-timing` (duration scalar), `--tug-motion` (binary toggle).

**D24.** Reduced motion via `--tug-motion: 0` and `data-tug-motion` attribute. Durations scale; motion doesn't simply disappear. [L13]

**D76.** TugAnimator wraps WAAPI. Named animation slots (WeakMap-based), three cancellation modes (snap-to-end, hold-at-current, reverse), animation groups, reduced-motion awareness. [L13, L14]

**D77.** Inactive selection uses CSS Custom Highlight API for dimmed highlight in unfocused cards.

**D78.** Child-driven ready callback: parent triggers child `setState`, child signals DOM commit via its own `useLayoutEffect`. No inline measurement of child DOM from parent. [L04]

**D79.** `requestAnimationFrame` is never used for operations depending on React state commits. RAF timing relative to React's commit cycle is not a contract. [L05]

---

## Feed & Transport

**D19.** Transport is tugcast binary frame protocol, not a separate HTTP server. `FeedId` enum routes frames.

**D21.** Interface-first development: define TypeScript interfaces, mock backend, then implement frontend.

---

## Tugbank

**D46.** Tugbank is a SQLite-backed typed defaults store. `DefaultsStore` wraps `rusqlite::Connection`. Typed `Value` enum: `Null`, `Bool`, `I64`, `F64`, `String`, `Bytes`, `Json`.

**D47.** Per-domain key-value storage with CAS (compare-and-swap) concurrency via monotonic generation counters. `set_if_generation()` returns `Written` or `Conflict`.

**D48.** Frontend reads/writes tugbank via HTTP bridge endpoints.

---

## Observable Properties & Inspector

**D67.** `PropertyStore`: typed key-path property store per card. Schema defined via `PropertyDescriptor[]`.

**D68.** `PropertyStore.observe()` is directly compatible with `useSyncExternalStore`'s subscribe contract. [L02]

**D69.** Inspector panels participate in the responder chain.

**D74.** Dev cascade inspector: `Ctrl+Option + hover` shows token resolution chain for any element.

