# Tugways Design System — Concepts and Roadmap {#top}

## Table of Contents {#toc}

### Concept Areas

| # | Concept | Status | Anchor |
|---|---------|--------|--------|
| 1 | Theme Architecture: Loadable Resources | DESIGNED | [#c01-theme](#c01-theme) |
| 2 | Tugways Design System Definition | DESIGNED | [#c02-tugways](#c02-tugways) |
| 3 | TugButton: The Test Case | DESIGNED | [#c03-tugbutton](#c03-tugbutton) |
| 4 | The Responder Chain | DESIGNED | [#c04-responder](#c04-responder) |
| 5 | Controlled Mutation vs. React State | DESIGNED | [#c05-mutation](#c05-mutation) |
| 6 | Tugcard: The Common Base Component | DESIGNED | [#c06-tugcard](#c06-tugcard) |
| 7 | Feed Abstraction | DESIGNED | [#c07-feed](#c07-feed) |
| 8 | Motion and Visual Continuity | DESIGNED | [#c08-motion](#c08-motion) |
| 9 | Alert and Dialog System | DESIGNED | [#c09-dialog](#c09-dialog) |
| 10 | Card Title Bar Enhancements | DESIGNED | [#c10-titlebar](#c10-titlebar) |
| 11 | Dock Redesign | DESIGNED | [#c11-dock](#c11-dock) |
| 12 | Card Tabs | DESIGNED | [#c12-tabs](#c12-tabs) |
| 13 | Card Snap Sets | DESIGNED | [#c13-snap-sets](#c13-snap-sets) |
| 14 | Selection Model | DESIGNED | [#c14-selection](#c14-selection) |
| 15 | Keybindings View | DEFERRED | [#c15-keybindings](#c15-keybindings) |
| 16 | Brio Theme Revision | DEFERRED | [#c16-brio](#c16-brio) |

### Cross-Cutting Design Decisions

| ID | Decision | Defined In | Anchor |
|----|----------|------------|--------|
| [D01] | Theme format is CSS, not JSON | Concept 1 | [#d01-css-format](#d01-css-format) |
| [D02] | Prefix rename `--tl-` → `--tways-` | Concept 1 | [#d02-tways-prefix](#d02-tways-prefix) |
| [D03] | Stylesheet injection replaces body classes | Concept 1 | [#d03-stylesheet-injection](#d03-stylesheet-injection) |
| [D04] | Optional palette entries with `var()` fallbacks | Concept 1 | [#d04-optional-palette](#d04-optional-palette) |
| [D05] | Three component kinds: wrappers, compositions, originals | Concept 2 | [#d05-component-kinds](#d05-component-kinds) |
| [D06] | `components/tugways/` is public, `components/ui/` is private | Concept 2 | [#d06-file-org](#d06-file-org) |
| [D07] | Module-scope components, compose via JSX nesting | Concept 3 | [#d07-composition-model](#d07-composition-model) |
| [D08] | Two button modes: direct-action and chain-action | Concept 3 | [#d08-button-modes](#d08-button-modes) |
| [D09] | Responder chain operates outside React state | Concept 4 | [#d09-chain-outside-react](#d09-chain-outside-react) |
| [D10] | Four-stage key processing pipeline | Concept 4 | [#d10-key-pipeline](#d10-key-pipeline) |
| [D11] | Two-level action validation (`canHandle` + `validateAction`) | Concept 4 | [#d11-action-validation](#d11-action-validation) |
| [D12] | Three-zone mutation model (appearance, local data, structure) | Concept 5 | [#d12-three-zones](#d12-three-zones) |
| [D13] | DOM utility hooks for appearance zone | Concept 5 | [#d13-dom-hooks](#d13-dom-hooks) |
| [D14] | Five structure-zone rules | Concept 5 | [#d14-structure-rules](#d14-structure-rules) |
| [D15] | Tugcard is composition, not inheritance | Concept 6 | [#d15-tugcard-composition](#d15-tugcard-composition) |
| [D16] | Hooks for data (`useTugcardData`), not render props | Concept 6 | [#d16-hooks-not-render-props](#d16-hooks-not-render-props) |
| [D17] | Dynamic min-size based on content | Concept 6 | [#d17-dynamic-minsize](#d17-dynamic-minsize) |
| [D18] | Clean cutover migration for all 8 cards | Concept 6 | [#d18-clean-cutover](#d18-clean-cutover) |
| [D19] | Transport is tugcast, not a separate server | Concept 7 | [#d19-tugcast-transport](#d19-tugcast-transport) |
| [D20] | Three accumulation patterns (snapshot, append-stream, raw stream) | Concept 7 | [#d20-accumulation-patterns](#d20-accumulation-patterns) |
| [D21] | Interface-first: define types, mock backend, implement frontend | Concept 7 | [#d21-interface-first](#d21-interface-first) |
| [D22] | Component inventory: TS interfaces, gallery card, design doc | Concept 3 | [#d22-component-inventory](#d22-component-inventory) |
| [D23] | Motion tokens as CSS custom properties (`--td-duration-*`, `--td-easing-*`) | Concept 8 | [#d23-motion-tokens](#d23-motion-tokens) |
| [D24] | Reduced motion via duration scalar, not removal | Concept 8 | [#d24-reduced-motion](#d24-reduced-motion) |
| [D25] | Four modal categories: alert, sheet, confirm-popover, toast | Concept 9 | [#d25-four-modal-categories](#d25-four-modal-categories) |
| [D26] | Button-confirmation via popover, not sheet or alert | Concept 9 | [#d26-confirm-popover](#d26-confirm-popover) |
| [D27] | Window-shade collapse to title bar, state in CardState | Concept 10 | [#d27-window-shade](#d27-window-shade) |
| [D28] | Three dock button types: card toggle, command, popout menu | Concept 11 | [#d28-dock-button-types](#d28-dock-button-types) |
| [D29] | Dock placement on any edge (right default) | Concept 11 | [#d29-dock-placement](#d29-dock-placement) |
| [D30] | Tab bar visible only when card has multiple tabs | Concept 12 | [#d30-tab-visibility](#d30-tab-visibility) |
| [D31] | Tabs are a Tugcard composition feature, not a frame feature | Concept 12 | [#d31-tabs-in-tugcard](#d31-tabs-in-tugcard) |
| [D32] | Snap requires Option (Alt) modifier during drag | Concept 13 | [#d32-modifier-snap](#d32-modifier-snap) |
| [D33] | Set-move is always active once a set is formed | Concept 13 | [#d33-set-move-always](#d33-set-move-always) |
| [D34] | Three-layer selection containment (CSS + SelectionGuard + developer API) | Concept 14 | [#d34-three-layer-selection](#d34-three-layer-selection) |
| [D35] | SelectionGuard is a singleton, not React state | Concept 14 | [#d35-guard-singleton](#d35-guard-singleton) |
| [D36] | Pointer-clamped selection clipping via caretPositionFromPoint | Concept 14 | [#d36-pointer-clamping](#d36-pointer-clamping) |
| [D37] | Four select modes for card content regions | Concept 14 | [#d37-select-modes](#d37-select-modes) |
| [D38] | Cmd+A scoped to focused card via responder chain | Concept 14 | [#d38-scoped-selectall](#d38-scoped-selectall) |

### Key Architectural Patterns

| Pattern | Description | Anchor |
|---------|-------------|--------|
| Component containment hierarchy | How components nest: CardFrame → Tugcard → content → leaf components | [#containment-hierarchy](#containment-hierarchy) |
| The three-zone model | Appearance (CSS, zero re-renders), Local data (targeted), Structure (subtree) | [#d12-three-zones](#d12-three-zones) |
| Responder chain structure | Component → card content → Tugcard → DeckCanvas → TugApp | [#chain-structure](#chain-structure) |
| Action vocabulary | ~25 standard actions across 8 categories | [#action-vocabulary](#action-vocabulary) |
| Feed accumulation helpers | `useFeedBuffer` (ring buffer) and `useFeedStore` (indexed store) | [#accumulation-helpers](#accumulation-helpers) |
| DOM utility hooks | `useCSSVar`, `useDOMClass`, `useDOMStyle` for appearance-zone mutations | [#d13-dom-hooks](#d13-dom-hooks) |
| Accessibility layering | Inherit native element baseline, extend with ARIA for non-standard states | [#tugbutton-a11y](#tugbutton-a11y) |
| Enter/exit via Radix data-state | CSS `@keyframes` triggered by `data-state="open"/"closed"`, Presence delays unmount | [#enter-exit-transitions](#enter-exit-transitions) |
| Skeleton shimmer | Per-card shapes, synchronized via `background-attachment: fixed`, theme-aware colors | [#skeleton-loading](#skeleton-loading) |
| Startup three-layer continuity | Inline body styles → startup overlay → CSS HMR boundary | [#startup-continuity](#startup-continuity) |
| Imperative-over-declarative alerts | `tugAlert()` returns Promise; host component renders AlertDialog | [#alert-architecture](#alert-architecture) |
| Selection containment | CSS prevention + JS SelectionGuard + `data-td-select` developer API | [#d34-three-layer-selection](#d34-three-layer-selection) |

### External References

| Document | Purpose |
|----------|---------|
| `roadmap/tug-feed.md` | Tug-feed backend architecture (hooks, correlation, schema) |
| `roadmap/eliminate-frontend-flash.md` | UI-flash root cause analysis and three-layer fix (referenced from [#startup-continuity](#startup-continuity)) |
| `roadmap/tuglook-style-system-redesign.txt` | Prior art for theme system |
| `roadmap/react-shadcn-adoption.md` | React/shadcn adoption decisions |

### Discussion Log

| Entry | Topic | Date | Anchor |
|-------|-------|------|--------|
| 1 | Project Kickoff | 2026-03-01 | [#log-1](#log-1) |
| 2 | Theme Architecture — Initial Design | 2026-03-01 | [#log-2](#log-2) |
| 3 | Theme Architecture — Format Revised to CSS | 2026-03-01 | [#log-3](#log-3) |
| 4 | Tugways Design System Designed | 2026-03-01 | [#log-4](#log-4) |
| 5 | Responder Chain Drafted | 2026-03-01 | [#log-5](#log-5) |
| 6 | Controlled Mutation Designed | 2026-03-01 | [#log-6](#log-6) |
| 7 | Concept 5 Deepened — Specific Machinery | 2026-03-01 | [#log-7](#log-7) |
| 8 | Excalidraw Deep Study | 2026-03-01 | [#log-8](#log-8) |
| 9 | Tugcard Base Component Designed | 2026-03-01 | [#log-9](#log-9) |
| 10 | Feed Abstraction + UI-Flash Prevention | 2026-03-01 | [#log-10](#log-10) |
| 11 | TugButton Designed — Composition Model | 2026-03-02 | [#log-11](#log-11) |
| 12 | Concepts 12-13: Card Tabs and Snap Sets | 2026-03-02 | [#log-12](#log-12) |
| 13 | Concept 14: Selection Model | 2026-03-03 | [#log-13](#log-13) |

---

## Kickoff

Themes need to be "separate" loadable resources; not hard-coded tailwind/CSS.

However, if we think through all the implications of what changing a theme does in an app, we wind up needing to tackle quite a few complex questions like event flow, state management, rendering, component systems, and more. We have recently fixed on React as a core technology and added on shadcn as an aid to achieve quality and consistency. However, these alone are not enough. We also want a "tugcard" abstraction to encapsulate the look and feel of a single window-like component in the app, and we want all tugcards to be customizable based on a set of common behaviors. We need to specify what those behaviors are, how to store them, how to customize them, how to render them, and how to respond when they change.

There is also apprehension about React, since simple uses of it tend to accrete state changes that all too easily cause uncontrolled cascades of updates that ripple through an app, causing all sorts of undesirable effects, including brittleness and rigidness in the face of new changes, and poor performance when seemingly trivial updates occur. There are also difficult invariants like the "rule of hooks", which are like ticking time bombs that can go off at any time. We should probably lean away from states as much as possible and lean toward a model where component mutation is safe, controlled, and easy to understand.

## Feature List

- Themes need to be "separate" loadable resources; not hard-coded tailwind/CSS
- Need a settings view for adjusting themes
- Rethink themes as a precursor to the design system; build in support for revising and extending
- Custom shadcn-based components for *everything*; never use "raw" shadcn
- Tugways: the name of the tug design system for components used in tugcards and tugdeck
- Rename tuglook (the previous/tentative name for the design system) to tugways
- All UI components get a `Tug` prefix to give namespacing and allow us to inventory what we have and what we don't
- Start with `TugButton` as the first test-case component for how to design a tugways component
- Follow on with all components: selects, sliders, input, badges, etc. (ref: https://ui.shadcn.com/docs/components)
- The responder chain is key; it will determine how all components are wired up; look at Apple docs for this
- Tugcard abstraction that serves as the common base component for all cards, offering standard API for what a card is and does
- API to return calculated minsize of a tugcard, so that we can ensure content stays visible
- Accessory views in cards; find window in any text card
- A proper skeleton model to cover moments when we can't display a fully ready-to-use UI
- Full alert/dialog system; app-modal/card-modal/modeless-informational
- Examine how Terminal, Filesystem, Git, Status, and Code cards handle their datafeeds — do we actually have a TugFeed abstraction to cover these uniformly, or is each one ad-hoc? What is the state of how they provide data to tugcast?
- The task-feed: multiplexed output from skills and agents
- Change Brio style to be dark greenish
- Need a keybindings view
- Add minimize/window-shade control to the card title bar (up/down chevron icon)
- Add confirmation dropdown to x/close box for cards
- Turn hamburger menu in the card title bar 90 degrees
- Fix the dock; giving it command buttons and popout menu buttons

---

## Current State (as of March 2026)

### What Exists

**Theme system.** Three themes (Brio, Bluenote, Harmony) defined entirely in `tugdeck/styles/tokens.css` as CSS custom properties. Theme switching works via body class (`td-theme-bluenote`, `td-theme-harmony`; Brio is the `:root` default). The `use-theme.ts` hook reads/sets the current theme, persists to localStorage, dispatches a `td-theme-change` CustomEvent, and syncs to the Swift bridge. All theme data is hardcoded in that one CSS file — no separate loadable resources.

**Token architecture.** Three tiers already in place: Tier 1 palette (`--tl-*`), Tier 2 semantic (`--td-*`), Tier 3 component-specific. Shadcn bridge aliases (`--background`, `--foreground`, etc.) map from the `--td-*` layer. This architecture is sound but the values are baked in.

**Card system.** `TugCard` interface in `cards/card.ts` defines: `feedIds`, `collapsible`, `meta` (title, icon, closable, menuItems), and lifecycle methods (`mount`, `onFrame`, `onResize`, `focus`, `destroy`). `ReactCardAdapter` wraps React components to implement this interface. Eight card types are registered. Each card is a standalone React functional component with no shared base beyond what `CardContext` provides.

**shadcn components.** 13 components in `components/ui/`: Button, Card, Checkbox, Dialog, DropdownMenu, Input, RadioGroup, ScrollArea, Select, Switch, Tabs, Textarea, Tooltip. All are stock shadcn — used raw except `CardDropdownMenu` which wraps `DropdownMenu` for the card menu item model.

**Feed system.** `CardContext` provides `feedData: Map<FeedIdValue, Uint8Array>`, and the `useFeed()` hook gives individual cards access to their subscribed feed data. Each card decodes and renders its own feed data independently — there is no uniform `TugFeed` abstraction.

**Dock.** React component, 48px vertical rail on the right edge. Icon buttons for each card type, a settings dropdown menu with theme selector, dev notifications badge, and tug logo.

**Settings card.** Theme selection (RadioGroup), source tree path picker, and developer mode toggle. Minimal.

### What Doesn't Exist

- Loadable/external theme resources
- Tugways naming or namespace
- `Tug`-prefixed component wrappers
- Responder chain or structured event flow
- Common tugcard base component with shared behaviors
- Card min-size calculation API
- Accessory view system for cards
- Skeleton/loading model
- Alert/dialog system beyond raw shadcn Dialog
- Keybindings view
- Card minimize/window-shade control
- Close confirmation for cards
- Task-feed for multiplexed agent output
- Dock command buttons or popout menus

---

## Concept Areas

The work breaks down into several interconnected concept areas. Each needs discussion and design before implementation. They are listed here roughly in dependency order — later items build on earlier ones.

### 1. Theme Architecture: Loadable Resources {#c01-theme}

**Status: DESIGNED** (2026-03-01)

**The problem.** All three themes live in `tokens.css` as hardcoded CSS. Adding or modifying a theme means editing that file. Themes cannot be loaded at runtime, bundled separately, or provided by users. Worse, the three-tier architecture is only actually working for Brio — Bluenote and Harmony each duplicate all ~80 values (both `--tl-*` palette AND `--td-*` semantic) with hardcoded hex, bypassing the `var()` chain that should make semantic tokens derive automatically from palette values.

#### Decisions

**Prefix rename: `--tl-` → `--tways-`.** {#d02-tways-prefix} The old `--tl-` prefix (from "tuglook") is renamed to `--tways-` (for "tugways"). This avoids any potential conflict with Tailwind's `--tw-` internal prefix, and there's no reason the prefix needs to be two letters. `--tways-` is distinctive and self-documenting. The semantic tier keeps its `--td-` prefix (for "tugdeck" — the application's purpose-driven mappings, distinct from the design system's palette).

**Format: CSS.** {#d01-css-format} A theme file is a CSS file containing custom property declarations — because that's literally what theme values are. CSS custom properties can hold any CSS value natively: colors, shadows, gradients, complex expressions. No translation, no escaping, no special cases. A structured comment header provides metadata (name, description).

Example theme file (`bluenote.css`):
```css
/**
 * @theme-name Bluenote
 * @theme-description Cool dark theme
 */
body {
  --tways-bg: #2a3136;
  --tways-bg-soft: #363e43;
  --tways-bg-line: rgba(255, 255, 255, 0.018);
  --tways-panel: #3a454c;
  --tways-panel-soft: #313b43;
  --tways-panel-ink: #d9e0e4;
  --tways-surface-1: #3b4348;
  --tways-surface-2: #343c41;
  --tways-surface-3: #30373c;
  --tways-surface-4: #2a3237;
  --tways-surface-screen: #5c6871;
  --tways-surface-screen-ink: #edf2f5;
  --tways-text: #dde4e8;
  --tways-text-soft: #a8b6bf;
  --tways-text-inverse: #edf1f3;
  --tways-accent: #ff8434;
  --tways-accent-strong: #f27024;
  --tways-accent-cool: #4bbde8;
  --tways-accent-1: #ff8434;
  --tways-accent-2: #4bbde8;
  --tways-accent-3: #ab7ee4;
  --tways-accent-4: #ff5162;
  --tways-accent-5: #73c382;
  --tways-accent-6: #ffe465;
  --tways-accent-7: #ec76c9;
  --tways-accent-8: #ff9a72;
  --tways-border: #5b6871;
  --tways-border-soft: #79858d;
  --tways-shadow-hard: #11191f;
  --tways-shadow-mid: #11191f;
  --tways-shadow-soft: rgba(0, 0, 0, 0.44);
  --tways-glow: rgba(142, 183, 190, 0.24);
  /* Complex values work naturally in CSS — no escaping or special handling */
  --tways-depth-raise:
    0 1px 0 0 rgba(255, 255, 255, 0.18),
    0 1px 2px -1px rgba(0, 0, 0, 0.44);
  --tways-track-bg: repeating-linear-gradient(
    to bottom, #6c7b85 0px, #6c7b85 1px, #84939c 2px, #84939c 4px
  );
  /* Optional overrides — omit to use Brio's default derivation */
  --tways-canvas: #2a3136;
  --tways-header-active: #344f5e;
  --tways-header-inactive: #2a3a44;
}
```

Theme files contain palette values (including complex CSS values like shadows and gradients) plus optional override tokens. Any token not specified falls back to Brio's CSS default.

**Where themes live: bundled now, loadable later.** The three current themes (Brio, Bluenote, Harmony) are bundled as separate CSS files in the app. The architecture supports loading external theme files from the filesystem via `fetch()` in the future, but implementing that is not an immediate priority.

**Themes specify palette only.** Theme files contain only Tier 1 palette values (`--tways-*`). The Tier 2 semantic layer (`--td-*: var(--tways-*)`) and the Tier 3 component layer remain in `tokens.css` as permanent `var()` references — they derive automatically when palette values change. This eliminates the current duplication where Bluenote and Harmony each redundantly specify ~80 values.

**Optional palette entries for per-theme semantic overrides.** {#d04-optional-palette} Some tokens like `canvas`, `header-active`, `header-inactive`, `icon-active`, and `grid-color` currently vary per theme but are semantic-tier, not palette. The solution: make them optional palette entries (`--tways-canvas`, `--tways-header-active`, etc.) that themes can specify if they want to diverge from the default derivation. The semantic tier derives them from other palette values by default (e.g., `--td-canvas: var(--tways-canvas, var(--tways-bg))`). No special mechanism — just CSS `var()` with fallback.

**Brio is the blessed default.** Brio's palette values are defined in `tokens.css` as CSS defaults on `body`. When applying a different theme, the theme's CSS overrides palette properties. Missing keys automatically fall back to Brio because the CSS defaults were never overridden.

**Tailwind interaction: works unchanged.** The full chain is: Tailwind utility class (e.g. `bg-primary`) → `@theme` var in `globals.css` (`--color-primary: var(--primary)`) → legacy alias in `tokens.css` (`--primary: var(--td-accent)`) → semantic token (`--td-accent: var(--tways-accent)`) → palette value. Changing palette values at runtime cascades through the entire chain. Tailwind generates utility classes at build time referencing CSS variables; the variables resolve at runtime. No Tailwind involvement in theme switching.

#### Theme Application Mechanism {#d03-stylesheet-injection}

Replace the current body-class approach with stylesheet injection:

1. **Startup:** Brio's values are already in CSS (the `body { --tways-*: ... }` block in `tokens.css`). No injection needed.
2. **Apply theme:** Load the theme CSS file (bundled import or `fetch()` for external). Inject it as a `<style>` element in the document head. Because it appears after `tokens.css` in the cascade, its `body { --tways-*: ... }` declarations override Brio's defaults.
3. **Revert to Brio:** Remove the injected `<style>` element. Brio's CSS defaults in `tokens.css` take over.
4. **Swift bridge:** After applying, read the resolved `background-color` from `document.body` and post it to the Swift bridge (same as today).
5. **Persist:** Store the theme name in localStorage (or shared settings). On next load, re-inject the theme stylesheet.

**What this eliminates:**
- The `body.td-theme-bluenote` and `body.td-theme-harmony` CSS blocks (~190 lines of duplicated values in `tokens.css`)
- The body class toggling mechanism
- The `td-theme-change` CustomEvent (CSS cascade handles visual updates; no React re-render needed)
- The need for any component to "listen" for theme changes — CSS variables just work

**What stays in `tokens.css`:**
- Font declarations
- Brio's palette values as `body { --tways-*: ... }` defaults
- The entire Tier 2 semantic layer (`body { --td-*: var(--tways-*) }`)
- The legacy/shadcn bridge aliases (`--background: var(--td-bg)`, etc.)
- Shared tokens that don't vary per theme (radius, spacing, fonts, line-height)
- Scrollbar styling

**What stays in `globals.css`:**
- The `@theme` registration that maps CSS variables into Tailwind's namespace

#### Validation

When loading a theme (bundled or external), validate against Brio's palette as the canonical key set. For each key in Brio that is missing from the loaded theme, the Brio CSS default persists — no explicit fallback code needed. For external themes in the future, we may want to log warnings for missing keys.

### 2. Tugways: The Design System {#c02-tugways}

**Status: DESIGNED** (2026-03-01)

**The problem.** "Tuglook" was the working name for the visual language (tokens, themes, aesthetics). We're renaming to "tugways" and expanding the scope: tugways is the complete design system — tokens, components, patterns, and conventions.

**What tugways encompasses:**
- **Tokens:** the three-tier variable system (palette, semantic, component)
- **Components:** `Tug`-prefixed components that wrap, compose, or extend shadcn primitives
- **Patterns:** how components compose (cards, accessory views, dialogs, skeletons)
- **Conventions:** naming, file organization, how new components are added
- **Behaviors:** responder chain, event flow, focus management

#### Decisions

**The `Tug` wrapper's job: cosmetic + behavioral + contractual.** Tugways components are not thin cosmetic wrappers. They encapsulate:
- **Semantic color mapping** — enforce and map tugways semantic colors to concrete elements
- **Component subtypes** — a single tugways component can represent a family of related controls (e.g., TugButton encompasses push button, icon button, icon+text button, three-state button)
- **State management** — states beyond what shadcn provides (disabled, loading, active, focused, selected), with consistent visual treatment across the design system
- **Theme-awareness** — components respond to theme changes via CSS variable cascade (no React re-render needed, per concept 1)
- **Responder chain integration** — components participate in the responder chain (concept 4)

**Tugways components carry strong opinions.** shadcn's variant model (primary/secondary/danger/ghost) is a starting point, not the final vocabulary. Tugways components define their own variant sets that reflect the actual needs of the app — including subtypes, states, and semantic color mappings. The variants should cover the full range of what the component needs to express, not just what shadcn happens to offer.

**Three kinds of tugways components:** {#d05-component-kinds}

1. **Wrappers** — a shadcn primitive wrapped with tugways opinions. The shadcn component is the internal implementation; the Tug component is the public API. Examples: TugButton (wraps Button), TugInput (wraps Input), TugSelect (wraps Select).

2. **Compositions** — multiple shadcn primitives assembled into a higher-level component that doesn't exist in shadcn. Examples: a search bar (Input + Button), a toolbar (multiple Buttons in a group), a labeled control (Label + Input + helper text).

3. **Originals** — components that shadcn doesn't offer at all, built from scratch or from lower-level Radix primitives. Examples: card title bar, responder-chain-aware containers, skeleton placeholders, accessory view frames.

**File organization:**

```
components/
  ui/           # raw shadcn components (private implementation detail)
  tugways/      # Tug-prefixed components (public API)
    TugButton.tsx
    TugInput.tsx
    TugSelect.tsx
    TugDialog.tsx
    ...
```

**The rule: app code imports from `components/tugways/`, never from `components/ui/`.** {#d06-file-org} The `ui/` directory is kept as-is (for easy shadcn updates) but is consumed only by tugways wrappers. This gives us the best of both worlds: shadcn's accessible primitives and Radix behavior under the hood, with our own opinions, subtypes, and conventions on top. We don't reinvent — we customize. And when we need something shadcn doesn't offer, we build it as an original.

#### Component Library Inventory {#d34-component-library}

The full tugways component library, organized by tier. TugButton (concept 3) is
already built. Alerts, sheets, toasts, and confirm popovers are covered by
concept 9 (Phase 8a). Everything below ships in Phases 8b–8d.

**Tier 1 — Form Controls** (8 wrappers)

| Component | Kind | Wraps | What it adds |
|-----------|------|-------|-------------|
| TugInput | Wrapper | Input | Validation states, error styling, `--td-*` tokens |
| TugTextarea | Wrapper | Textarea | Auto-resize option, char count, error state |
| TugSelect | Wrapper | Select | Tugways variants, token-based styling |
| TugCheckbox | Wrapper | Checkbox | Label integration, mixed state, `--td-accent` |
| TugRadioGroup | Wrapper | RadioGroup | Group label, horizontal/vertical layout |
| TugSwitch | Wrapper | Switch | Label position, size variants |
| TugSlider | Wrapper | Slider | Value display, range labels, tick marks |
| TugLabel | Wrapper | Label | Required indicator, helper text slot |

**Tier 2 — Display & Feedback** (7 components)

| Component | Kind | Wraps | Notes |
|-----------|------|-------|-------|
| TugBadge | Original | — | Tone variants (good/warn/alert/info), pill shape, count mode |
| TugSpinner | Original | — | Size variants, replaces loading prop visuals |
| TugProgress | Original | — | Horizontal bar, percentage, indeterminate mode |
| TugSkeleton | Original | — | Shimmer placeholder, `background-attachment: fixed` sync |
| TugSeparator | Wrapper | Separator | Horizontal/vertical, label slot |
| TugKbd | Original | — | Keyboard shortcut chip display |
| TugAvatar | Original | — | Image + fallback initials, size variants |

**Tier 3 — Navigation & Overlay** (4 wrappers)

| Component | Kind | Wraps | Notes |
|-----------|------|-------|-------|
| TugTooltip | Wrapper | Tooltip | Hover labels, kbd shortcut display |
| TugDropdownMenu | Wrapper | DropdownMenu | Kbd shortcuts in items, tone icons |
| TugScrollArea | Wrapper | ScrollArea | Themed scrollbar, autohide |
| TugContextMenu | Wrapper | ContextMenu | Right-click menus for cards |

**Tier 4 — Data Display** (4 components)

| Component | Kind | Wraps | Notes |
|-----------|------|-------|-------|
| TugTable | Wrapper | Table | Header/row/cell, sortable columns, stripe option |
| TugStatCard | Original | — | Key-value metric display (label + number + trend) |
| TugStatusIndicator | Original | — | Tone-colored dot + text (good/warn/alert/info) |
| TugDialog | Wrapper | Dialog | General-purpose dialog (not alert/sheet) |

**Tier 5 — Data Visualization** (3 originals)

| Component | Kind | Notes |
|-----------|------|-------|
| TugSparkline | Original | SVG inline chart; area, line, column, bar variants |
| TugLinearGauge | Original | Horizontal gauge with needle, thresholds, tick marks |
| TugArcGauge | Original | Radial gauge with needle, center readout |

**Tier 6 — Compound Components** (2 compositions)

| Component | Kind | Composes | Notes |
|-----------|------|----------|-------|
| TugButtonGroup | Composition | TugButton × N | Connected button row, shared border radius |
| TugChatInput | Composition | TugTextarea + TugButton × 2 | Submit + attachment buttons, Enter to submit |

**Total: 28 components** (12 wrappers, 13 originals, 3 compositions) across
three phases (8b–8d).

**What Phase 9 cards need from this library:**

| Card | Key components required |
|------|----------------------|
| Terminal | TugScrollArea, TugSpinner |
| Conversation | TugScrollArea, TugChatInput, TugBadge, TugSpinner |
| Git | TugTable, TugBadge, TugStatusIndicator, TugScrollArea |
| Files | TugTable, TugScrollArea, TugContextMenu |
| Stats | TugProgress, TugSparkline, TugLinearGauge, TugArcGauge, TugStatCard, TugBadge |
| Settings | TugSelect, TugInput, TugCheckbox, TugRadioGroup, TugSwitch, TugSlider, TugLabel, TugSeparator |
| Developer | TugCheckbox, TugSwitch, TugBadge, TugKbd |
| About | TugAvatar, TugSeparator |

**Excluded:** TugAlertDialog (= TugAlert, Phase 8a), TugPopover (internal to
TugConfirmPopover), TugTabBar (Phase 5b), TugCollapsible (Tugcard handles
collapse), TugCommand (post-Phase 9), calendar/date picker/carousel/pagination/
breadcrumb/sidebar/menubar/navigation menu (not needed for tugdeck's card UI).

**Design references:** The retronow mockups (`retronow-unified-review.html`,
`RetronowComponentPackPage.tsx`, `retronow-components.css`) are the visual
models for all components. Sparklines, linear gauges, and arc gauges are drawn
directly from retronow's custom instruments. See
[Retronow Design Reference](tugways-implementation-strategy.md#retronow-design-reference).

#### Subtype Naming

Single component with a subtype prop is the default approach. For example, `<TugButton subtype="icon">` rather than a separate `TugIconButton`. If a subtype diverges enough that the single-component API becomes awkward, break it out into a separate component on a case-by-case basis.

#### Inventory Tracking

The `components/tugways/` directory is the inventory. If a `Tug`-prefixed component file exists, it's wrapped. If it doesn't, it's still raw. No manifest file needed.

### 3. TugButton: The Test Case {#c03-tugbutton}

**Status: DESIGNED** (2026-03-02)

**The problem.** We need a concrete first component to establish the pattern for all tugways components. But a button never exists in isolation — it's always inside a card, a toolbar, a dialog, a section. Before we can design TugButton, we need to answer: **how does the component containment hierarchy work?**

#### The Composition Model {#d07-composition-model}

The rule from concept 5 ([#d14-structure-rules](#d14-structure-rules)) says "never define components inside components." This means:

```tsx
// WRONG — defines a new component function inside another component.
// Creates a brand-new component identity on every render.
// React unmounts and remounts it each time. State is lost. DOM is rebuilt.
function SettingsContent() {
  const ThemeRow = () => <div>...</div>;
  return <ThemeRow />;
}
```

This does **not** mean you can't *use* components inside other components. That's literally what React is — composition through nesting. Every tugways component is a standalone function defined at module scope (in its own file). You compose them by importing and nesting JSX:

```tsx
// RIGHT — every component is a module-scope definition

// tug-button.tsx
export function TugButton({ subtype, onClick, children }) { ... }

// theme-section.tsx
import { TugButton } from "../tugways/tug-button";
export function ThemeSection() {
  return (
    <div>
      <TugButton subtype="push" onClick={applyBrio}>Brio</TugButton>
      <TugButton subtype="push" onClick={applyBluenote}>Bluenote</TugButton>
    </div>
  );
}

// settings-content.tsx
import { ThemeSection } from "./theme-section";
import { SourceTreeSection } from "./source-tree-section";
export function SettingsContent() {
  return (
    <div>
      <ThemeSection />
      <SourceTreeSection />
    </div>
  );
}
```

#### The Containment Hierarchy {#containment-hierarchy}

The full component tree for a card with buttons, showing how concepts 3, 4, 5, and 6 connect:

```
CardFrame                          ← pixel position, size, drag, resize (concept 6)
  └─ Tugcard                       ← chrome, responder node, feed, loading/error (concept 6)
       ├─ CardHeader               ← title bar — internal to Tugcard
       ├─ Accessory slot           ← find bar, etc.
       └─ SettingsContent          ← the unique card content
            ├─ ThemeSection
            │    ├─ TugButton "Brio"
            │    ├─ TugButton "Bluenote"
            │    └─ TugButton "Harmony"
            ├─ SourceTreeSection
            │    └─ TugButton "Choose..."
            └─ DeveloperSection
                 └─ TugSwitch
```

Every box in that tree is a separate module-level component. There is no tight coupling between layers. They connect through three ambient mechanisms:

1. **CSS custom properties** — theme flows through the DOM, not through React props. TugButton's colors come from `var(--td-*)` tokens. Theme changes update the tokens via stylesheet injection ([#c01-theme](#c01-theme)); TugButton picks up the new values at paint time. Zero re-renders.

2. **React context** — the responder chain ([#c04-responder](#c04-responder)) is provided via nested context. Any component anywhere in the tree can participate by calling `useResponder`. TugButton doesn't need to know it's inside a Tugcard — it finds the nearest chain node automatically.

3. **Props and callbacks** — standard React data flow. `onClick`, `subtype`, `disabled`, `children`. Nothing exotic.

The principle: **components are standalone pieces defined at module scope. You snap them together by nesting JSX. The responder chain, theme system, and mutation model are ambient infrastructure that any component can tap into without knowing the specific tree it lives in.**

#### Two Button Modes {#d08-button-modes}

TugButton has two modes of operation:

**Direct-action buttons** — they have an `onClick` handler and just do their thing. The responder chain is not involved. Most buttons are this type:

```tsx
// Direct-action — no chain involvement
<TugButton subtype="push" onClick={() => clearScrollback()}>
  Clear
</TugButton>
```

**Chain-action buttons** — they dispatch an action into the responder chain ([#action-vocabulary](#action-vocabulary)). The button doesn't know *who* handles the action — it dispatches, and the chain routes. These buttons need the chain for two things: *validation* (should I be enabled?) and *dispatch* (fire the action when clicked).

```tsx
// Chain-action — queries the chain for validation, dispatches on click
<TugButton subtype="push" action="find">
  Find
</TugButton>
```

For chain-action buttons, TugButton internally calls `validateAction("find")` from the responder chain to determine if it should be enabled or disabled. This mirrors Apple's `NSMenuItem` — menu items validate themselves against the responder chain before drawing ([#d11-action-validation](#d11-action-validation)). When clicked, TugButton dispatches `"find"` into the chain, and whoever handles it (the focused card's text content, presumably) responds.

A chain-action button is *visible* if someone in the chain can handle the action (`canHandle`), and *enabled* if that handler says it's currently valid (`validateAction`). For example, a "Copy" button is visible whenever a text-bearing card is focused, but only enabled when text is selected.

#### Mutation Zone Assignment {#tugbutton-zones}

TugButton maps to all three zones from concept 5 ([#d12-three-zones](#d12-three-zones)):

**Appearance zone (zero re-renders):**
- Hover, focus ring, active/pressed states — all CSS pseudo-classes (`:hover`, `:focus-visible`, `:active`). No React state.
- Theme colors from `var(--td-*)` tokens. Theme changes flow through CSS variables — zero re-renders.
- Disabled visual state (opacity, cursor) — CSS class toggled based on the `disabled` prop or chain validation.

**Local data zone (targeted re-renders):**
- For chain-action buttons, the enabled/disabled state comes from responder chain validation. The chain is an external store; TugButton subscribes to its validation result for the specific action via `useSyncExternalStore`. Only this button re-renders when its validation state changes — not the entire toolbar, not the card, not the deck.

**Structure zone (subtree re-renders):**
- Whether the button exists at all is determined by its parent's React state. The parent conditionally renders `<TugButton>` or not.

#### TugButton API

```tsx
interface TugButtonProps {
  subtype?: "push" | "icon" | "icon-text" | "three-state";  // default: "push"
  variant?: "primary" | "secondary" | "ghost" | "destructive";  // default: "secondary"
  size?: "sm" | "md" | "lg";  // default: "md"

  // Direct-action mode
  onClick?: () => void;

  // Chain-action mode (mutually exclusive with onClick)
  action?: string;  // action name from the vocabulary (#action-vocabulary)

  // Standard
  disabled?: boolean;  // overrides chain validation if set explicitly
  loading?: boolean;   // shows spinner, disables interaction
  children?: React.ReactNode;

  // Icon support
  icon?: React.ReactNode;  // Lucide icon for "icon" and "icon-text" subtypes

  // Three-state support
  state?: "on" | "off" | "mixed";  // for "three-state" subtype
  onStateChange?: (state: "on" | "off") => void;
}
```

#### What the Wrapper Adds Over shadcn Button

shadcn's `Button` provides: Radix slot support, CVA variant management (`variant`, `size`), basic styles, `asChild` prop, `ref` forwarding.

TugButton adds:

1. **Subtypes** — `push`, `icon`, `icon-text`, `three-state`. shadcn has no concept of button subtypes. Each subtype adjusts layout (icon-only has square aspect ratio, icon-text has icon + label layout, three-state toggles through on/off/mixed).
2. **Chain-action mode** — the `action` prop connects the button to the responder chain for validation and dispatch. shadcn has no event system integration.
3. **Loading state** — a `loading` prop that shows a spinner overlay and disables interaction. shadcn has no loading state.
4. **Theme-responsive colors** — variant colors reference `var(--td-*)` semantic tokens, not hardcoded Tailwind classes. Theme switches are free.
5. **Restricted API** — shadcn's `asChild` and some variants are not exposed. TugButton's API is opinionated — it expresses what tugdeck needs, not every possible button variation.

#### Focus, Keyboard, and Accessibility {#tugbutton-a11y}

TugButton renders a native `<button>` element (via shadcn's `Button`). This gives us the browser's built-in accessibility baseline for free: focusable via Tab, activates on Enter and Space, announced as "button" by screen readers, and participates in the accessibility tree without extra work. TugButton's job is to *not break* any of that, and to extend it for the subtypes and modes that go beyond a plain button.

**What the native `<button>` provides (inherited, not reimplemented):**
- Tab/Shift+Tab focus navigation
- Enter and Space to activate
- `role="button"` implicit in the element
- `disabled` attribute prevents focus and interaction
- Focus ring via `:focus-visible` (styled by shadcn's `focus-visible:ring-2`)

**What TugButton adds:**

| Concern | Subtype / Mode | Implementation |
|---------|---------------|----------------|
| `aria-pressed` | `three-state` | Set to `"true"`, `"false"`, or `"mixed"` matching the `state` prop. Screen readers announce "toggle button, pressed/not pressed/mixed." |
| `aria-label` | `icon` (no visible text) | Required when `children` is absent. Icon-only buttons have no visible label; `aria-label` provides the accessible name. TugButton warns in dev mode if an `icon` subtype has neither `children` nor `aria-label`. |
| `aria-disabled` vs `disabled` | chain-action | When a chain-action button is disabled by validation (not by an explicit `disabled` prop), use `aria-disabled="true"` instead of the HTML `disabled` attribute. This keeps the button in the tab order so keyboard users can discover it, while preventing activation. The visual disabled treatment (opacity, cursor) is applied via CSS class, not the attribute. |
| Loading announcement | all (when `loading`) | When `loading` is true, add `aria-busy="true"` and an `aria-label` suffix like "Loading" so screen readers don't just see a spinner. |

**Keyboard interaction beyond activation:**
- **Three-state buttons** — Space toggles between on and off (skipping mixed — mixed is a programmatic state, not a user-toggled one). This matches the WAI-ARIA tri-state checkbox pattern.
- **Chain-action buttons** — Enter/Space dispatches the action into the responder chain, same as `onClick` for direct-action buttons. No additional keyboard behavior.
- **Icon-text and push** — standard button behavior. No custom key handling.

**Focus and the responder chain:**
A TugButton does not register itself as a responder node. Buttons are leaf controls — they activate actions but don't *handle* routed actions. The responder chain operates at a higher level (card content, Tugcard, DeckCanvas). When a TugButton has DOM focus and the user presses a key that isn't Enter/Space, the key event bubbles up through the DOM and reaches the responder chain's key listener, which routes it through the chain as usual. TugButton doesn't intercept or consume arbitrary keys.

#### Component Inventory and Documentation {#d22-component-inventory}

Every tugways component must be discoverable, visually demonstrable, and API-documented. Without a catalog, components get reinvented, variants drift, and the design system exists only in the heads of whoever wrote it.

**The inventory approach — three layers:**

1. **TypeScript interfaces are the API reference.** The `TugButtonProps` interface (and its equivalents for every tugways component) is the canonical documentation of what a component accepts. Type comments document semantics — e.g., "mutually exclusive with onClick" for the `action` prop. No separate API doc is generated; the types *are* the docs. IDE tooling (hover, autocomplete) makes these instantly accessible to developers writing card content.

2. **A component gallery card in tugdeck.** Tugdeck is a card-based dashboard — the natural place to showcase components is a card. A `ComponentGalleryCard` renders every tugways component in all its subtype/variant/state combinations, live, inside the running app. This is the visual inventory: you open the card and see every button subtype, every variant, every size, in both enabled and disabled states, in the current theme. Theme switches update the gallery in real time. This dogfoods the theme system and composition model — the gallery card is itself built from tugways components.

3. **A components manifest in the design document.** This document (design-system-concepts.md) serves as the architectural inventory. Each concept section that defines a component includes: the props interface, subtype/variant matrix, mutation zone assignment, accessibility notes, and the pattern it demonstrates. The TOC's concept list ([#concepts](#concepts)) is the master index.

**What we explicitly skip:** Storybook. It's a heavyweight tool designed for teams sharing a component library across multiple apps. Tugdeck is one app with one frontend. The component gallery card gives us the same visual browsing experience without the build infrastructure, and it runs in the actual app context (themes, responder chain, WebSocket connection) rather than an isolated sandbox.

#### What TugButton Demonstrates for All Tugways Components

TugButton establishes the pattern every tugways component follows:

1. **Module-scope definition** in `components/tugways/tug-button.tsx`. Imported by app code. Never defined inline.
2. **Wraps shadcn** internally — the `<Button>` from `components/ui/button` is the implementation. TugButton is the public API.
3. **Theme via CSS variables** — appearance-zone only. No React state for visual theming.
4. **Responder chain via context** — chain-action mode for components that dispatch or validate actions. Most components will have a direct-action mode only; chain-action is for toolbar/menu scenarios.
5. **Mutation zones are explicit** — appearance (CSS), local data (chain validation subscription), structure (conditional rendering by parent). Documented for each component.
6. **Subtypes via prop** — a single component handles a family of related controls. Break into separate components only when the single-component API becomes unwieldy.
7. **Accessibility layered on the native element** — inherit the browser baseline, add ARIA attributes for non-standard states (`aria-pressed`, `aria-disabled`, `aria-busy`), warn in dev when accessible names are missing ([#tugbutton-a11y](#tugbutton-a11y)).
8. **Inventoried in three places** — TypeScript interface (API), component gallery card (visual), design document (architectural). Every tugways component gets the same treatment ([#d22-component-inventory](#d22-component-inventory)).

### 4. The Responder Chain {#c04-responder}

**This is the architectural keystone.** Get this right and everything else — keyboard handling, focus management, action dispatch, theme response — falls into place. Get it wrong and we build the same ad-hoc wiring mess we're trying to escape.

**The problem.** Components need a structured way to handle events — particularly keyboard events, focus management, and action dispatch. Without this, every component wires up its own event listeners in ad-hoc ways, leading to conflicts, missed events, and unpredictable behavior.

#### Apple's Responder Chain: What We're Drawing From

The macOS/iOS responder chain (NSResponder/UIResponder) provides the architectural model. Key mechanics:

**The chain is a linked list.** Each responder has a `nextResponder` pointer. Events and actions propagate from the most specific responder (the focused control) up toward the most general (the application). The chain is constructed automatically from the view hierarchy.

**Typical macOS chain structure:**
```
Focused view → superview → ... → content view → NSWindow → NSWindowController → NSApplication
```

**Three things flow through the chain:**
1. **Key events** — delivered to the first responder, propagated up if unhandled
2. **Actions** — semantic commands like `copy:`, `paste:`, `close:` dispatched with nil target; the chain finds the first responder that implements the action
3. **Validation queries** — "can anyone in the chain handle `paste:` right now?" — used to enable/disable menu items and toolbar buttons

**Four-stage key processing pipeline** (in priority order):
1. **Key equivalents** — global shortcuts (Cmd+S, Cmd+W) checked top-down through the view hierarchy before the chain
2. **Keyboard navigation** — Tab, Enter, Escape handled at the system level for focus management
3. **Key bindings → semantic actions** — keystroke mapped to a named action (e.g., Ctrl+E → `moveToEndOfLine:`), then the action walks up the chain
4. **Text insertion** — if no binding matches, the character is inserted into the first responder

This separation into stages is crucial. Global shortcuts take priority over card-level actions. Keyboard navigation takes priority over text editing. Each stage has clear ownership.

**First responder** — one per window. The starting point for key events and nil-targeted actions. Acquired via `makeFirstResponder:` with a negotiation protocol: the current first responder can refuse to resign (e.g., a text field with invalid input), and the new responder can refuse to accept.

**Modal boundaries** — modality works by constraining which chain is active. A modal dialog confines events to its own chain. No special-case modal logic in individual components — the constraint is at the chain-selection level.

**Menu/action validation** — the chain is queried lazily (when a menu opens, not continuously). Each responder answers "can I handle this action?" and "should it be enabled right now?" This decouples controls from handlers completely.

#### How This Maps to Tugdeck {#chain-structure}

**The chain structure for tugdeck:**
```
Focused tugways component (TugButton, TugInput, etc.)
  → Card content area
  → TugCard
  → DeckCanvas
  → TugApp (application level)
```

Each level in the chain corresponds to a real architectural boundary:
- **Tugways component** — handles component-level actions (e.g., a text input handles `selectAll`)
- **Card content** — handles content-specific actions (e.g., conversation card handles `sendMessage`)
- **TugCard** — handles card-level actions (e.g., `close`, `minimize`, `toggleMenu`)
- **DeckCanvas** — handles deck-level actions (e.g., `cycleCards`, `resetLayout`)
- **TugApp** — handles app-level actions (e.g., `showSettings`, `changeTheme`, `quit`)

**First responder = focused card.** Tugdeck has one focused card at a time. That card's chain is the active chain for key events and actions. The card's internal components form the bottom of the chain; the card itself is in the middle; the app is at the top.

**Key processing pipeline for tugdeck** {#d10-key-pipeline} (adapted from Apple's four stages):

| Stage | Scope | Examples | Direction |
|-------|-------|----------|-----------|
| 1. Global shortcuts | App-wide, always active | Cmd+N (new card), Cmd+W (close card), Cmd+, (settings) | Top-down: checked before the chain |
| 2. Keyboard navigation | Focus management | Tab (next control), Shift+Tab (prev), Escape (dismiss), Enter (confirm) | System-level |
| 3. Action dispatch | Semantic actions via chain | Copy, paste, find, card-specific commands | Bottom-up: chain walks from first responder to app |
| 4. Text input | First responder only | Typing into an input field | Delivered to first responder |

**Modal boundaries in tugdeck:**
- **App-modal dialog** — chain is confined to the dialog. No card receives events. Deck shortcuts disabled.
- **Card-modal** — chain within the card is confined to the modal (e.g., close confirmation). Other cards unaffected. Global shortcuts still work.
- **Modeless notification** — does not affect the chain at all.

**Action validation for tugdeck:**
- Dock buttons, card menu items, and keyboard shortcuts can query the chain: "can anyone handle `find` right now?"
- A card with searchable text would say yes; a terminal card might say no.
- This drives enabling/disabling of dock buttons and menu items dynamically.

#### Implementation Approach {#d09-chain-outside-react}

**The chain operates outside React state.** This is the critical design decision. The responder chain is an imperative system — components register and unregister, actions are dispatched and handled, first responder status is acquired and resigned — all without triggering React re-renders.

**A `ResponderChain` manager** — a stable, mutable object provided via React context. The context value (the manager reference) never changes, so providing it does not cause re-renders. Components interact with the manager imperatively.

**Components register via a `useResponder` hook:**
```
useResponder({
  actions: {
    copy: () => { ... },
    paste: () => { ... },
    find: () => { ... },
  },
  canHandle: (action) => { ... },   // for validation queries
})
```

The hook registers the component as a responder on mount and unregisters on unmount. Internally it uses refs, not state. The `nextResponder` link is determined automatically from the React component tree (the nearest ancestor that also called `useResponder`).

**Action dispatch is a function call:**
```
responderChain.dispatch('copy')     // walks the chain, finds a handler, calls it
responderChain.canHandle('paste')   // validation query — returns true/false
```

**First responder management:**
```
responderChain.makeFirstResponder(cardId)   // sets the focused card
responderChain.resignFirstResponder()       // current first responder gives up focus
```

The manager tracks which card is first responder and starts chain traversal from that card's deepest registered responder.

**Global shortcuts are handled separately** — a top-level `keydown` listener that checks a keybinding map before the chain is consulted. If a global shortcut matches, it's handled immediately and the event doesn't reach the chain.

#### Resolved Questions

**Parent discovery: nested context (option b).** Each responder provides a context to its children containing itself as the parent. Children automatically know their parent responder without walking the fiber tree or explicit IDs.

**Mouse/pointer events: no.** The chain handles keyboard events, actions, and validation only. Mouse events go via hit-testing (DOM event bubbling), following Apple's model.

**Focus model: the responder chain is the focus model.** The deck-manager informs the responder chain when card focus changes (via `makeFirstResponder`), but the responder chain is the single authority on focus. There is no separate focus system.

#### Action Vocabulary {#action-vocabulary}

The action vocabulary is a defined set of action names, organized by category. Actions are strings (not an enum) to allow card-specific extensions, but the standard set is documented here. Modeled on Apple's NSResponder/UIResponder standard actions, filtered to what tugdeck actually needs.

**Clipboard actions** (handled by focused component or card):
| Action | Description |
|--------|-------------|
| `copy` | Copy selection to clipboard |
| `cut` | Cut selection to clipboard |
| `paste` | Paste from clipboard |
| `pasteAsPlainText` | Paste without formatting |

**Selection actions:**
| Action | Description |
|--------|-------------|
| `selectAll` | Select all content in the focused component |

**Find actions** (walk up the chain; text-bearing cards handle these):
| Action | Description |
|--------|-------------|
| `find` | Open find bar / focus find input |
| `findNext` | Find next occurrence |
| `findPrevious` | Find previous occurrence |
| `useSelectionForFind` | Use current selection as find query |

**Undo/Redo:**
| Action | Description |
|--------|-------------|
| `undo` | Undo last action |
| `redo` | Redo last undone action |

**Cancellation:**
| Action | Description |
|--------|-------------|
| `cancel` | Cancel current operation / dismiss modal / deselect (Escape) |

**Scrolling/Navigation:**
| Action | Description |
|--------|-------------|
| `scrollUp` | Scroll up one page |
| `scrollDown` | Scroll down one page |
| `scrollToTop` | Scroll to beginning of content |
| `scrollToBottom` | Scroll to end of content |

**Card actions** (handled at the TugCard level):
| Action | Description |
|--------|-------------|
| `closeCard` | Close the focused card (with confirmation if applicable) |
| `minimizeCard` | Minimize/window-shade the focused card |
| `restoreCard` | Restore a minimized card |
| `focusNextCard` | Move focus to the next card |
| `focusPreviousCard` | Move focus to the previous card |

**App actions** (handled at the TugApp level — end of the chain):
| Action | Description |
|--------|-------------|
| `showSettings` | Open settings card |
| `showAbout` | Open about card |
| `showKeybindings` | Open keybindings view |
| `resetLayout` | Reset card layout to default |
| `changeTheme` | Open theme picker |

**Card-specific actions** (each card type can register its own):
| Action | Card | Description |
|--------|------|-------------|
| `sendMessage` | Conversation | Send the current input |
| `clearTerminal` | Terminal | Clear terminal buffer |
| `refreshStatus` | Git | Refresh git status |
| `refreshFiles` | Files | Refresh file listing |

This vocabulary will grow as we build out the app. The key principle from Apple: actions are **semantic** (what to do), not **mechanical** (how to do it). `copy` means "copy the current selection" — the chain figures out *whose* selection and *how* to copy it.

#### Resolved Items

**Keybinding map: deferred to concept 12.** The responder chain only knows about actions, not keys. Adding keybindings later that dispatch actions into the chain can be done without changing the chain architecture.

**Action validation: two-level, following Apple's model.** {#d11-action-validation} Adopt Apple's battle-tested two-level validation:
1. **`canHandle(action)`** — capability query. "Does any responder in the chain implement this action?" Returns boolean. Analogous to `responds(to:)`.
2. **`validateAction(action)`** — enabled-state query. "I implement this action, but is it currently available?" Returns boolean (or could return metadata). Analogous to `validateMenuItem:`. Called on the responder that `canHandle` found.

This drives dynamic UI: a dock button or menu item is *visible* if someone in the chain can handle the action, and *enabled* if that handler says it's currently valid. For example, `copy` is visible whenever a text-bearing card is focused, but only enabled when text is selected.

### 5. Controlled Mutation vs. React State {#c05-mutation}

**Status: DESIGNED** (2026-03-01)

**The problem.** React's core model is: state changes → re-render → DOM update. This is elegant for small components but becomes a liability at scale. A single state change in a high-level component triggers a re-render cascade through its entire subtree. Performance suffers. Reasoning about what re-renders when becomes difficult. Hooks like `useMemo` and `useCallback` are band-aids that add complexity without solving the fundamental issue.

The real question: how do we get *precise* control over event firing in React in a way that respects its model, allows us to manipulate *data* that belongs to components, get *targeted re-renders* when display information changes, and do *both* without one tripping over the other?

#### The Key Insight: We're Not Fighting React — We're Scoping It

The mistake most React apps make is putting *everything* in React state. Theme? State. Focus? State. Card position? State. Scroll position? State. Then every change triggers a re-render cascade and you're drowning in `useMemo`/`useCallback` band-aids.

But we've already been designing systems that operate outside React state:
- **Theme changes** (concept 1): CSS variable swap on the document element. Zero re-renders.
- **Responder chain and focus** (concept 4): imperative manager with refs. Zero re-renders.
- **Card positions and layout**: deck-manager manipulates DOM directly. Zero re-renders.

The pattern is already clear. The principle is: use React for what it's good at (rendering UI from data), and use the DOM directly for what React isn't needed for (visual state that the browser handles natively via CSS).

#### Three Zones of Change {#d12-three-zones}

Every change in the app falls into one of three zones. Each zone has a different mechanism and a different re-render profile:

| Zone | What Changes | Mechanism | Re-renders? |
|------|-------------|-----------|-------------|
| **Appearance** | Theme, focus indicators, animations, card position/size, scroll position, selection highlight | CSS custom properties, CSS classes, DOM `style` manipulation, data attributes | **No.** The browser handles it via CSS cascade or direct DOM mutation. React never knows it happened. |
| **Local data** | Card content (feed data), form input values, component-internal state | React state **local to the component that displays it** | **Yes, but only that component.** The re-render is targeted because the state lives at the leaf, not at the root. |
| **Structure** | Show/hide a section, add/remove a card, open/close a modal, switch tabs | React state at the **appropriate level** — the nearest common ancestor of the affected subtree | **Yes, the affected subtree.** This is what React is designed for. |

The rules:

1. **Never put appearance state in React state.** Theme tokens are CSS variables. Focus indicators are CSS classes toggled by the responder chain. Card dimensions are set by the layout engine via `element.style`. Animations are CSS transitions or `requestAnimationFrame`. None of these need React's diffing — the browser handles them natively and efficiently.

2. **Keep data state as local as possible.** A card's feed data belongs in that card's component, not in a shared parent. A form value belongs in the input component, not in the form's parent. The further down the tree state lives, the smaller the re-render blast radius.

3. **When you must share state, use selective subscriptions.** React 18+ provides `useSyncExternalStore` for this exact purpose: an external mutable store that components subscribe to selectively. Each component subscribes to a *slice* of the store. Only components whose slice changed re-render.

4. **The responder chain, theme system, and layout engine are imperative systems.** They operate outside React's state model. They touch the DOM directly or via CSS. React components can *read* from them (to render initial state), but ongoing changes flow through imperative channels, not state updates.

#### `useSyncExternalStore`: The Key React Pattern

This is the React-sanctioned escape hatch for external mutable data. It lets data live outside React (in a plain object, a WebSocket handler, a feed processor) while components subscribe to exactly the slice they need:

```
// External store — mutated imperatively (e.g., by WebSocket handler)
const feedStore = {
  data: new Map<string, Uint8Array>(),
  listeners: new Set<() => void>(),

  subscribe(callback) { ... },
  getFeed(feedId) { return this.data.get(feedId); },

  // Called by WebSocket — NOT a React action
  updateFeed(feedId, payload) {
    this.data.set(feedId, payload);
    this.listeners.forEach(l => l());
  }
};

// In a card component — subscribes to ONE feed
function GitCard() {
  const feedData = useSyncExternalStore(
    feedStore.subscribe,
    () => feedStore.getFeed('git')  // only re-renders when THIS feed changes
  );
  // render from feedData...
}
```

Data mutates freely outside React. The WebSocket handler updates the store. Only the card that subscribes to the changed feed re-renders. No cascade. No context propagation. No `useMemo`.

This pattern applies to:
- **Feed data per card** — each card subscribes to its own feed(s)
- **Responder chain state** — dock buttons subscribe to `canHandle`/`validateAction` for their action, re-rendering only when the focused card changes
- **Connection status** — components that display connection state subscribe to connection store

#### How Each Existing System Maps to the Zones

| System | Zone | Mechanism | Why |
|--------|------|-----------|-----|
| Theme switching | Appearance | CSS variable injection on `<html>` (concept 1) | Colors are CSS — the browser cascades them instantly |
| Card focus change | Appearance | Responder chain sets CSS class on focused card (concept 4) | Focus ring is visual — no component content changes |
| Card position/resize | Appearance | Deck-manager sets `element.style.transform/width/height` | Layout is geometry — React doesn't need to know |
| Feed data arrival | Local data | `useSyncExternalStore` per card per feed | Each card re-renders independently when its data changes |
| Form input typing | Local data | React `useState` in the input component | The input re-renders; nothing else does |
| Card metadata (title, icon) | Local data | State in the card header component, not above it | Only the header re-renders when title/icon changes |
| Open/close a card | Structure | React state in deck canvas | The card mounts/unmounts; other cards unaffected |
| Open a modal dialog | Structure | React state in the modal system | The modal mounts; the rest of the app doesn't re-render |
| Dock button enabled state | Local data | Dock subscribes to responder chain validation | Only affected dock buttons re-render when focus changes |

#### What This Means in Practice

When a developer adds a new feature to tugdeck, the question is never "should I use React state?" in the abstract. The question is: **which zone does this change belong to?**

- "I need to highlight the focused card" → **Appearance.** Toggle a CSS class. Don't touch state.
- "I received new git status data" → **Local data.** `useSyncExternalStore` in the git card. Only the git card re-renders.
- "The user clicked the settings dock button" → **Structure.** The settings card mounts. State change at the deck level. Other cards don't re-render.
- "The theme changed" → **Appearance.** Inject a stylesheet. Zero re-renders. Every component picks up the new colors via CSS variables instantly.
- "The user typed in the message input" → **Local data.** `useState` in the input. Only the input re-renders.

The three-zone model makes the answer mechanical, not a judgment call. And critically: **the appearance zone — the biggest source of cascade re-renders in typical React apps — never touches React at all.**

#### Specific Machinery for Each Zone {#d13-dom-hooks}

**Appearance Zone — the DOM utility layer.** We need a small set of hooks that make it ergonomic to do CSS/DOM mutations from React components without reaching for `useState`. These are thin wrappers around `ref.current.style.setProperty()` and `ref.current.classList.toggle()`, but having them as *named patterns* prevents developers from accidentally using React state instead:

```
// Set a CSS custom property on a ref'd element — no re-render
function useCSSVar(ref, name, value) {
  useEffect(() => {
    ref.current?.style.setProperty(name, value);
  }, [name, value]);
}

// Toggle a CSS class on a ref'd element — no re-render
function useDOMClass(ref, className, condition) {
  useEffect(() => {
    ref.current?.classList.toggle(className, condition);
  }, [className, condition]);
}

// Apply a style object imperatively — for layout engine, drag, resize
function useDOMStyle(ref, styles) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const [prop, value] of Object.entries(styles)) {
      el.style[prop] = value;
    }
  }, [styles]);
}
```

These live in a `tugways/hooks/` directory alongside `useResponder`. They are the sanctioned way to make appearance changes. The rule: **if you're changing how something looks (not what it shows), use one of these hooks, not `useState`.**

For high-frequency updates (drag, resize, scroll, animation), bypass even these hooks — use `requestAnimationFrame` with a ref directly:

```
// During drag — 60fps, zero React involvement
function onPointerMove(e) {
  requestAnimationFrame(() => {
    panelRef.current.style.transform = `translate(${x}px, ${y}px)`;
  });
}
// On drag end — sync final position to React state (structure zone)
function onPointerUp(e) {
  setCardPosition({ x: finalX, y: finalY });
}
```

The principle: **bypass React during the gesture, sync on commit.** This is how Excalidraw handles canvas interaction — imperative during drag, state update on completion.

**Local Data Zone — `useSyncExternalStore` with gotcha prevention.** The core mechanism is `useSyncExternalStore`, but it has specific traps that will bite us if we're not careful:

*Gotcha 1: Snapshot reference instability.* If `getSnapshot` returns a new object every call, the component re-renders on every store notification even if the data hasn't changed. React will warn: "The result of getSnapshot should be cached."

```
// WRONG — new object every call, re-renders every time
() => ({ feed: store.getFeed('git') })

// RIGHT — return the same reference
() => store.getFeed('git')
```

*Gotcha 2: Subscribe function identity.* If `subscribe` is defined inside the component, it creates a new function reference every render, causing unsubscribe/resubscribe loops:

```
// WRONG — defined inside component
function GitCard() {
  const data = useSyncExternalStore(
    (cb) => store.subscribe(cb),  // new function every render!
    ...
  );
}

// RIGHT — stable reference, defined outside or as store method
const data = useSyncExternalStore(
  store.subscribe,  // same function reference always
  ...
);
```

*Gotcha 3: Selective subscription.* Vanilla `useSyncExternalStore` notifies on *any* store change. To re-render only when a specific feed changes, the store can use per-feed listener sets, or we can use `useSyncExternalStoreWithSelector` (a React shim) which takes a selector and equality function:

```
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector';

function useFeed(feedId) {
  return useSyncExternalStoreWithSelector(
    feedStore.subscribe,
    feedStore.getSnapshot,
    null, // no server snapshot
    (snapshot) => snapshot.get(feedId),  // select this feed only
    Object.is  // re-render only if the Uint8Array reference changed
  );
}
```

**Whether to use a library (Zustand, Jotai) or raw `useSyncExternalStore`:** For the feed store, raw `useSyncExternalStore` is sufficient — the pattern is simple (per-card subscription by feed ID). If we find ourselves building more complex shared state (undo/redo stacks, multi-card coordination), Zustand or Jotai would reduce boilerplate. Jotai's atomic model (each atom is its own store) is particularly clean for per-card independence. Decision: **start raw, adopt a library if/when the complexity warrants it.**

**Structure Zone — React state with discipline.** {#d14-structure-rules} This is standard React, but with rules to prevent cascade:

*Rule 1: State lives at the lowest common ancestor, not higher.* The deck canvas owns "which cards are open" state. A card owns its own tab state. A form owns its input values. Never lift state to a parent that doesn't need it for rendering.

*Rule 2: Split contexts by domain and frequency.* Never put unrelated state in one context. A connection-status context (changes rarely) must be separate from a feed-data context (changes constantly). Otherwise every connection-status consumer re-renders on every feed update.

*Rule 3: Never derive state in `useEffect`.* If a value can be computed from props or other state, compute it during render (or use `useMemo`). Don't set it in an effect — that triggers a double render.

```
// WRONG — extra render from effect
const [filtered, setFiltered] = useState([]);
useEffect(() => {
  setFiltered(items.filter(i => i.active));
}, [items]);

// RIGHT — derive during render
const filtered = items.filter(i => i.active);
```

*Rule 4: Never define components inside components.* The inner component is recreated every render, destroying all its internal state and DOM:

```
// WRONG — CardContent is a new component type every render
function Card() {
  const CardContent = () => <div>...</div>;
  return <CardContent />;
}

// RIGHT — defined outside
const CardContent = () => <div>...</div>;
function Card() {
  return <CardContent />;
}
```

*Rule 5: Never create objects/arrays/functions inline in JSX props* (unless the React Compiler handles it — and it doesn't always, especially with third-party libraries):

```
// RISKY — new object every render
<Child style={{ color: 'red' }} />

// SAFE — stable reference
const style = { color: 'red' };  // module-level constant
<Child style={style} />
```

#### React Compiler v1.0 — What It Helps and What It Doesn't

React Compiler (shipped October 2025) automatically memoizes components and hooks at build time. This means:

**We can stop writing** `useMemo`, `useCallback`, and `memo` in most cases. The compiler inserts memoization at the correct granularity automatically. At Meta, this yielded up to 12% improvement on initial loads and >2.5x faster specific interactions.

**The compiler does NOT solve:**
- State placement problems (state too high in the tree still causes cascades)
- Context value instability (new object every render still re-renders all consumers)
- External store integration (third-party libraries may still need manual memoization)
- Side effects during render (the compiler bails out entirely on Rules-of-React violations)
- The appearance zone problem (CSS-driven state is always better than React state for visual changes, regardless of memoization)

The compiler is a safety net, not a substitute for the three-zone model. It makes the structure zone cheaper but doesn't eliminate the need to keep appearance out of React and data state local.

#### Architectural Precedent: Excalidraw

Excalidraw is the closest open-source precedent to tugdeck's architecture — a desktop-like React app with imperative rendering alongside React UI chrome:

- **React** renders the toolbar, dialogs, panels, context menus, and property inspector
- **Imperative canvas** (`<canvas>` element) handles all drawing, selection handles, collaborative cursors, and snap lines at 60fps via `requestAnimationFrame`
- **Scene class** is the single source of truth for canvas elements — a plain mutable object, not React state
- **Jotai atoms** manage UI-level state (dialog open/closed, sidebar visibility) independently from the canvas state
- **Action system** mediates user input → element mutations — actions are "entry points" for interactions, dispatched imperatively

The parallel to tugdeck: React renders card content and chrome. The deck-manager (imperative) handles card positioning and layout. The responder chain (imperative) handles focus and action dispatch. Feed data lives in an external store. Theme lives in CSS. React only re-renders when *content* changes — never for appearance, focus, layout, or theme.

#### Diagnostic Tools

When something re-renders that shouldn't:
1. **React DevTools Profiler** — enable "Highlight updates when components render" to visually see cascade re-renders
2. **`why-did-you-render` library** — patches React to log unnecessary re-renders with specific reasons
3. **React Compiler ESLint rule `react-hooks/todo`** — surfaces files where the compiler bailed out (silently skipping optimization)

#### Summary: The Complete Machinery

| Zone | Mechanism | Hooks/Tools | Re-renders |
|------|-----------|-------------|------------|
| **Appearance** | CSS custom properties, CSS classes, DOM style | `useCSSVar`, `useDOMClass`, `useDOMStyle`, `requestAnimationFrame` + refs | **Never** |
| **Local data** | External mutable store + selective subscriptions | `useSyncExternalStore` (raw or with selector), or Jotai atoms if complexity grows | **Only the subscribing component** |
| **Structure** | React state at the right ancestor level | `useState`, `useReducer`, split contexts | **The affected subtree** |

The DOM utility hooks (`useCSSVar`, `useDOMClass`, `useDOMStyle`) are our answer to "do we need a CSS-targeted API to help with mutations?" — yes, a small, lightweight set of hooks that make appearance-zone changes ergonomic and explicit. They don't do anything complex; they just make the right thing easy and the wrong thing (using `useState` for appearance) unnecessary.

#### Lessons from Excalidraw (Architectural Study)

Excalidraw (MIT licensed, github.com/excalidraw/excalidraw) is the closest open-source precedent to what we're building. It's a desktop-like React app with imperative rendering, an action system, and multiple interactive surfaces. A deep architectural study of the codebase reveals patterns to adopt, patterns to learn from, and gotchas to avoid.

**Patterns to adopt:**

1. **The action system is the best part of their architecture.** Every user operation — keyboard shortcut, toolbar button, context menu item, command palette entry — is a registered `Action` with a `perform` function, a `keyTest` for keyboard matching, a `predicate` for enable/disable, and an optional `PanelComponent` for property UI. This unifies all input paths into a single abstraction. Our responder chain action vocabulary (concept 4) maps directly to this: `perform` → our action handlers, `keyTest` → our keybinding map, `predicate` → our `canHandle`/`validateAction`.

2. **CSS variables for theming, not React context.** Confirmed — they use `--icon-fill-color`, `--color-selection`, `--color-surface-lowest`, etc. Theme switches are nearly free in performance terms. Same as our concept 1 approach.

3. **AppState subset types as render firewalls.** They define narrow type projections (`StaticCanvasAppState` with ~5 fields, `InteractiveCanvasAppState`, `UIAppState`) so that components receive only the state they need. A change to `openDialog` does not invalidate the static canvas. This is the manual version of selective subscriptions — and it works. For tugdeck, `useSyncExternalStore` with selectors gives us this automatically, but the *principle* is the same: never pass more state than a component needs.

4. **Separate contexts by domain (8 contexts, not 1).** They provide `useApp()`, `useAppProps()`, `useExcalidrawElements()`, `useExcalidrawAppState()`, `useExcalidrawSetAppState()`, `useExcalidrawActionManager()`, `useExcalidrawContainer()`, `useEditorInterface()` — each returning a narrow slice. Components subscribe only to what they use.

5. **Imperative for high-frequency, React for structure.** Their dual-canvas approach separates interactive feedback (selection handles, snap lines — redrawn every frame via `requestAnimationFrame`) from content rendering (scene elements — throttled to ~60fps). During drag, they call `this.setState()` directly and sometimes use `flushSync()` for low-latency. Our parallel: deck-manager handles card positioning imperatively; React handles card content.

**Patterns to learn from (but adapt):**

1. **The giant class component (395KB App.tsx) is intentional.** It centralizes all state coordination, gives direct `this` access for imperative state, and avoids distributed-state bugs. But it's an acknowledged lock-in. We should use functional components with our responder chain as the coordination mechanism instead — the chain provides the same centralized coordination without a god component.

2. **Scene class as mutable source of truth.** Their `Scene` class holds all drawable elements in a plain mutable object, not React state. It notifies subscribers via a `sceneNonce` (random integer regenerated on every mutation). Components check `sceneNonce` in their memo comparisons. For tugdeck, `useSyncExternalStore` gives us this subscription pattern automatically — the store mutates freely, components subscribe to slices.

3. **In-place element mutation for hot paths.** During drag/draw, they call `mutateElement()` which mutates the element object directly (preserving reference stability, incrementing version). For history/undo, they use `newElementWith()` which returns an immutable copy. The lesson: sometimes you need both mutable and immutable patterns for the same data, depending on the context.

**Gotchas we must avoid:**

1. **Focus management between imperative and React surfaces is fragile.** Their text editing system uses a deferred blur strategy, `setTimeout(0)` for DOM synchronization, and a dedicated `useTextEditorFocus` hook — all because browsers don't have good primitives for "this textarea belongs to that canvas." Every new panel or popover that appears during text editing must integrate with this system. We will face similar issues when text inputs inside cards need to coexist with the responder chain's keyboard handling. Plan for this from the start.

2. **State subset types require discipline.** Every new AppState field requires deciding which subset it belongs to. Put it in too many subsets → unnecessary re-renders. Miss it from a needed subset → stale renders. For tugdeck, our three-zone model provides the first-level classification (appearance/local/structure), but within the local and structure zones, we need similar discipline about what data flows where.

3. **Soft-delete, don't remove.** Excalidraw never removes elements from arrays — deletion sets `isDeleted: true`. This simplifies undo/redo and prevents array index invalidation during iteration. We should consider similar patterns for card state and feed data.

4. **Don't underutilize your atomic state library.** Excalidraw's Jotai integration is minimal (two tiny files). Most state lives in the class component's `this.state`. They acknowledged this should expand. We should be intentional from the start about what goes in external stores vs. React state, rather than defaulting everything to React and migrating later.

### 6. Tugcard: The Common Base Component {#c06-tugcard}

**The problem.** Each card is a standalone React component that implements `TugCard` via `ReactCardAdapter`. There is no shared behavior beyond what `CardContext` provides. Every card independently handles its own layout, loading state, error state, feed data decoding, and metadata management. Eight cards, eight ad-hoc implementations of the same concerns.

**What tugcard should provide:**
- Standard card chrome (title bar, menu, close/minimize controls)
- Min-size calculation API — returns the minimum dimensions needed for content to remain visible
- Accessory view slots (e.g., find-in-text bar that any text-bearing card can use)
- Loading/skeleton state for moments before data is available
- Error state handling
- Theme-responsive behavior (reacts to theme changes without re-rendering via the mechanism from concept 5)
- Responder chain integration (concept 4) — the card is a responder that manages its child responders
- Feed subscription and data decoding (standardized, not per-card ad-hoc)

#### Composition, Not Inheritance {#d15-tugcard-composition}

React idiom strongly favors composition, and so do we. Tugcard is a wrapper component. Card authors compose their content into it:

```tsx
<Tugcard meta={meta} feedIds={[FeedId.GIT]}>
  <GitCardContent />
</Tugcard>
```

Tugcard owns the chrome, the responder chain node, the feed subscription, and the loading/error states. The child component receives feed data via a `useTugcardData()` hook — not a render prop. {#d16-hooks-not-render-props} Tugcard gates the child's mount: children don't render until feed data arrives, so the hook always returns populated data, never null. This follows the Excalidraw precedent — hooks for data access, parent handles gating logic.

```tsx
// Inside GitCardContent — useTugcardData() is always populated because
// Tugcard only mounts children after the first feed frame arrives.
function GitCardContent() {
  const data = useTugcardData<GitStatus>();
  return <div>{data.branch}</div>;
}
```

For feedless cards (AboutCard, SettingsCard), `feedIds={[]}` means the gate is always open — children mount immediately, `useTugcardData()` returns null, and the child simply never calls it.

#### Relationship to CardFrame

CardFrame stays. It is the positioning/sizing/drag/resize shell — it knows about pixels, z-index, pointer capture, and canvas bounds. Tugcard lives *inside* CardFrame and replaces the current pattern where each card component independently manages its own header, feed subscription, and state. Clean separation:

```
CardFrame (position, size, drag, resize, z-index)
  └─ Tugcard (chrome, responder, feed, loading/error, accessories)
       └─ card content (the part unique to each card type)
```

CardFrame doesn't know what a feed is or what a responder chain is. Tugcard doesn't know about pixel positions or drag handles.

The existing CardHeader stays conceptually — Tugcard renders the title bar internally using the same visual design (28px height, icon, title, menu, close/minimize controls). But the header gets its metadata directly from Tugcard's props rather than going through the `useCardMeta` → context → DeckCanvas → props round-trip. The header is an implementation detail of Tugcard, not something card authors interact with.

This is a new component, a clean break from the previous card-frame/card-header pattern. When implementation begins, all 8 existing cards migrate at once. None of them do important work yet — they're sketches. We eliminate old patterns immediately rather than maintaining two systems.

#### Dynamic Min-Size {#d17-dynamic-minsize}

All card controls must be visible. Cards only ever scroll for content, and even then the scroll container's frame must be visible — just not its full content bounds. The min-size is dynamic, content-based:

1. **Tugcard measures its non-scrollable regions**: header height (28px) + accessory slot heights (variable) + any fixed controls the child declares.
2. **The child declares a `minContentSize`**: the minimum dimensions the scroll container needs to be usable — not to show all content, just to have a visible frame (typically 60–80px).
3. **Tugcard's total min-size** = header + accessories + child's minContentSize.
4. **Dynamic recalculation**: when a find bar opens, min-size grows by the bar's height. When the child adds or removes fixed controls, min-size adjusts.
5. **CardFrame reads the min-size**: Tugcard exposes its computed minimum via a ref or callback. CardFrame already clamps resize — it just reads Tugcard's computed minimum instead of its current hardcoded `MIN_SIZE_PX = 100`.

```tsx
// Card author declares minimum content area size
<Tugcard meta={meta} feedIds={[FeedId.GIT]} minContentSize={{ width: 200, height: 80 }}>
  <GitCardContent />
</Tugcard>
```

#### Accessory View Slot

One slot: a top accessory that sits between the header and the content area. Find-in-text lives here.

```tsx
<Tugcard
  meta={meta}
  feedIds={[FeedId.CODE_OUTPUT]}
  accessory={showFind ? <FindBar onClose={() => setShowFind(false)} /> : null}
>
  <ConversationContent />
</Tugcard>
```

When the accessory is null, the slot collapses to zero height and the min-size shrinks accordingly. One slot is enough. If we need a bottom accessory later, we add it then.

The visual stack inside Tugcard:

```
┌─────────────────────────────┐
│  CardHeader (28px)          │  ← title, icon, menu, close/minimize
├─────────────────────────────┤
│  Accessory slot (0px–Npx)   │  ← find bar, or collapsed to nothing
├─────────────────────────────┤
│                             │
│  Content area               │  ← child component renders here
│  (scrollable if needed)     │
│                             │
└─────────────────────────────┘
```

#### Loading and Error States

**Loading.** Before any feed frame arrives, Tugcard renders a skeleton state in the content area (below the header). The child component is not mounted until data exists. The skeleton is a standard Tugcard visual — card authors don't design their own loading states.

**Error.** Tugcard wraps the child in an error boundary. If the child throws during render, Tugcard catches it and shows an error state in the content area. The header stays functional — close button works, card is still draggable. Card authors get error handling for free.

#### Responder Chain Integration

Tugcard is a responder node (concept 4). It sits between DeckCanvas and the card content in the chain:

```
DeckCanvas (app-level responder)
  └─ Tugcard (card-level responder)
       └─ card content responder (card-specific actions)
```

Tugcard handles standard card actions: `close`, `minimize`, `toggleMenu`, `find`. It delegates everything else down to the child content's responder. When a Tugcard becomes the "key" card (focused), it becomes the active node in the responder chain, and its children become eligible first responders.

#### Theme-Responsive Behavior

Per concept 5, appearance-zone only. Tugcard does not re-render on theme change. Its chrome uses CSS custom properties (`var(--td-header-active)`, `var(--td-panel)`, etc.) that resolve at paint time. The stylesheet injection mechanism from concept 1 updates the underlying `--tways-*` palette values; Tugcard's semantic tokens derive from those; everything updates for free. Zero re-renders.

#### Feed Subscription

Tugcard subscribes to the declared `feedIds` and holds the latest payload per feed. It decodes the raw `Uint8Array` via a `decode` prop (defaulting to JSON parse). The decoded data is what `useTugcardData()` returns to the child. This standardizes the subscription pattern and eliminates the per-card `useFeed` + `useEffect` decode boilerplate.

```tsx
// For cards that need custom decoding (e.g., terminal receives raw bytes):
<Tugcard
  meta={meta}
  feedIds={[FeedId.TERMINAL_OUTPUT]}
  decode={(feedId, bytes) => bytes}  // pass through raw
>
  <TerminalContent />
</Tugcard>
```

#### Tugcard Props Summary

```tsx
interface TugcardProps {
  meta: TugCardMeta;                           // title, icon, closable, menuItems
  feedIds: readonly FeedIdValue[];             // feeds to subscribe to
  decode?: (feedId: FeedIdValue, bytes: Uint8Array) => unknown;  // default: JSON parse
  minContentSize?: { width: number; height: number };            // default: { width: 100, height: 60 }
  accessory?: React.ReactNode | null;          // top accessory slot (find bar, etc.)
  children: React.ReactNode;                   // card content
}
```

#### Migration: Clean Cutover {#d18-clean-cutover}

All 8 existing cards (Conversation, Terminal, Git, Files, Stats, Settings, Developer, About) migrate to Tugcard at once. These cards are sketches, not production features. We eliminate `ReactCardAdapter`, `CardContextProvider`, `useCardMeta`, and the per-card `useFeed` + decode pattern in a single pass. One system, not two.

### 7. Feed Abstraction {#c07-feed}

**The problem.** Two distinct feed systems need design: (a) the **per-card data feed** — each card receives raw `Uint8Array` data via `useFeed()` and decodes it independently with no shared model; and (b) the **tug-feed** — a structured, real-time progress stream reporting what skills and agents are doing as they run.

**Backend architecture:** `roadmap/tug-feed.md` contains the complete tug-feed design — hooks-first event capture, correlation chain, feed event schema, four-phase implementation strategy, and risk analysis. This concept covers the **frontend rendering side**: how tug-feed events become visible UI through the design system's machinery, and how per-card data feeds relate to Tugcard.

#### Per-Card Data Feeds

Each card handles its own feed subscription ad-hoc:
- Terminal card: passes raw bytes to xterm.js
- Git card: decodes binary to text, parses as structured data
- Files card: same pattern, different structure
- Stats card: subscribes to four different feeds, decodes each differently
- Conversation card: complex message protocol with streaming

Tugcard (concept 6) standardizes the subscription and decode pattern: `feedIds` declares subscriptions, `decode` handles deserialization, `useTugcardData()` provides typed access. But the per-card feeds are genuinely different — raw bytes vs. structured JSON vs. streaming messages. A uniform `TugFeed` abstraction may not be desirable beyond what Tugcard already provides.

#### Tug-Feed: The Frontend Rendering Story

The tug-feed backend (designed in `tug-feed.md`) produces a stream of semantically-enriched events. Four architectural layers handle capture and correlation:

- **Layer 1 (Event Capture):** Async plugin hooks on `PreToolUse(Task)`, `SubagentStart`, `SubagentStop`, `PostToolUse(Task)` — pure observation, no orchestrator changes. Agent-scoped hooks on `PostToolUse(Edit|Write|Bash)` for file and command detail within agents.
- **Layer 2 (Feed-Capture Process):** Shell handlers that correlate hook events into semantic records. A `PreToolUse(Task)` stashes orchestrator context (step_anchor, plan_path, agent_role) keyed by `(session_id, agent_type)`. `SubagentStart` associates that context with `agent_id`. `SubagentStop` enriches with agent results. Correlation state lives in `.tugtool/feed/.pending-agents.json`.
- **Layer 3 (Feed Event Schema):** Typed JSON events written to `.tugtool/feed/feed.jsonl`. Each event carries `version`, `timestamp`, `session_id`, `event_type`, `plan_path`, `step_anchor`, `agent_role`, `workflow_phase`, and type-specific `data`. Thirteen event types: `agent_started`, `agent_completed`, `phase_changed`, `step_started`, `step_completed`, `file_modified`, `command_ran`, `build_result`, `test_result`, `review_verdict`, `drift_detected`, `commit_created`, `error`.
- **Layer 4 (Consumers):** CLI viewer (`tugcode feed tail`), **web dashboard card** (tugdeck — this is where the design system concepts apply), post-hoc report generator, notification sink.

The web dashboard consumer is a feed-progress card in tugdeck. This is where the design system intersects:

#### Event-to-Visual Mapping

Each of the 13 tug-feed event types needs a rendering strategy in the dashboard card:

| Event Type | Visual Representation |
|-----------|----------------------|
| `agent_started` | Animated spinner with agent role label (architect, coder, reviewer) |
| `agent_completed` | Spinner → checkmark/X with duration badge |
| `phase_changed` | Phase indicator updates (architect → code → review) |
| `step_started` | New step row appears in progress list with title and index (e.g., "Step 3 of 5") |
| `step_completed` | Progress bar segment fills, duration shown |
| `file_modified` | File path appended to a collapsible change list under the active step |
| `command_ran` | Command description with exit-code indicator (green check / red X) |
| `build_result` | Build status badge: passing (green) / failing (red with error count) |
| `test_result` | Test summary: "12 passed, 0 failed, 2 skipped" |
| `review_verdict` | APPROVE (green badge) / REVISE (amber badge with finding count) |
| `drift_detected` | Warning indicator with severity and unexpected file list |
| `commit_created` | Short SHA + message, linked to the step it belongs to |
| `error` | Red error banner with tool name and message |

These visual representations are Tugways components (concept 2) — badges, progress bars, spinners, status indicators. They follow the tugways naming convention and theme-responsive behavior.

#### Mutation Zone Assignment

The three-zone model (concept 5) applied to the feed-progress card:

- **Appearance zone (zero re-renders):** Animated spinners, progress bar fills, elapsed-time counters, phase indicator transitions. These are CSS transitions and `requestAnimationFrame` updates. A new `agent_started` event triggers a CSS class toggle on the step row — the spinner appears via CSS animation, no React state change. Progress bar width is set via `useDOMStyle` (concept 5 DOM utility hook). Elapsed time ticks via `requestAnimationFrame` updating a ref'd element's text content.
- **Local data zone (targeted re-renders):** The feed event stream itself. A `FeedEventStore` (external mutable store, subscribed via `useSyncExternalStore`) accumulates events and exposes them by step. When a new `step_started` event arrives, only the step-list component re-renders to add the new row. When a `file_modified` event arrives, only the file-list component for that step re-renders.
- **Structure zone (subtree re-renders):** Card mount/unmount, expanding/collapsing step detail sections, switching between summary and detail views.

#### Transport: Tugcast {#d19-tugcast-transport}

Tug-feed events reach the browser through **tugcast** — the existing WebSocket server that already bridges all data feeds to tugdeck. No new transport infrastructure.

Tugcast's binary framing protocol (`[1-byte FeedId][4-byte length][payload]`) carries every feed over a single WebSocket connection. Terminal I/O, git status, filesystem events, stats, agent messages — all flow through this same pipe. The tug-feed is just another feed.

**How it works:**
1. The feed-capture process (tug-feed.md Layer 2) writes enriched events to `.tugtool/feed/feed.jsonl`.
2. A new tugcast feed implementation (a `StreamFeed` using `broadcast`, since events are append-only and consumers need the full sequence) tails that JSONL file using `notify` (same pattern as `FilesystemFeed`) and publishes each new event as a frame with `FeedId::TugFeed` (`0x50`).
3. Register the new feed ID in `tugcast-core/src/protocol.rs` (Rust) and `tugdeck/src/protocol.ts` (TypeScript).
4. The feed-progress card subscribes via `TugConnection.onFrame(FeedId.TUG_FEED, cb)` — the standard mechanism every card already uses.

This makes the feed-progress card "just another Tugcard with a feedId." It benefits from tugcast's existing authentication, heartbeat, reconnection with bootstrap, and per-client state management. The tugcast `StreamFeed` trait's `broadcast` channel ensures every connected client receives every event in order, with the `BOOTSTRAP` state machine handling reconnection (re-sending recent events if a client lags).

#### The Live-Tail Pattern and Accumulation {#d20-accumulation-patterns}

The feed-progress card is a live-tail viewer — events append, the view updates in place. This differs from snapshot cards (Git, Stats) that receive a latest-state replacement on each frame.

Looking at the existing cards, three accumulation patterns emerge:

**Pattern 1: Snapshot (latest value wins).** Git card, stats cards. Each frame replaces the previous. No accumulation. `useTugcardData()` returns the current snapshot directly.

**Pattern 2: Append-stream (events accumulate into a buffer).** Files card (capped event list), conversation card (message history), and the new feed-progress card. Each frame adds to a growing data structure. The card manages its own buffer — this is inherently card-specific because the buffer structure, cap, and indexing vary (files card caps at 50/100/200 entries; conversation card has complex message ordering and streaming; feed-progress card indexes by step/phase).

**Pattern 3: Raw stream (pass-through to an external renderer).** Terminal card. Raw bytes go directly to xterm.js, which manages its own scroll buffer. The card doesn't accumulate — xterm does.

Accumulation is card-specific, but we should provide common support for the append-stream pattern since multiple cards use it. Two helpers:

**`useFeedBuffer<T>(options)`** {#accumulation-helpers} — a hook that maintains a capped ring buffer of decoded events. Cards that just need "recent N events in order" use this directly:

```tsx
function FilesCardContent() {
  const events = useFeedBuffer<FsEvent>({ maxSize: 200 });
  return <EventList items={events} />;
}
```

**`useFeedStore<T, S>(store)`** — a hook that feeds each decoded event into an external mutable store (the `FeedEventStore` pattern from the mutation zone discussion). Cards that need structured indexing — grouping events by step, tracking phase transitions, maintaining running totals — build a custom store and subscribe to slices via `useSyncExternalStore`:

```tsx
// Feed-progress card uses a custom store that indexes events by step
const feedStore = createFeedEventStore();

function FeedProgressContent() {
  const latestEvent = useTugcardData<FeedEvent>();
  // Each new event feeds into the store
  useFeedStore(feedStore, latestEvent);
  // Components subscribe to store slices
  const steps = useSyncExternalStore(feedStore.subscribe, feedStore.getSteps);
  return <StepList steps={steps} />;
}
```

Both helpers live in `tugways/hooks/` alongside the DOM utility hooks from concept 5.

#### Per-Card Data Feeds: Is Tugcard Enough?

Looking at all 8 existing cards through the lens of Tugcard's `feedIds`/`decode`/`useTugcardData()`:

- **Git, Files, Stats (snapshot cards):** `decode` parses JSON, `useTugcardData()` returns the latest snapshot. Tugcard is sufficient.
- **Terminal (raw stream):** `decode` passes bytes through, the child hands them to xterm.js. Tugcard is sufficient.
- **Conversation (append-stream with complex protocol):** `decode` parses each JSON-line message. Accumulation into message history is card-specific (ordering buffer, streaming chunks, tool-use/result pairing). Tugcard + `useFeedStore` covers this.
- **Stats (multi-feed):** Subscribes to 4 feed IDs (`Stats`, `StatsProcessInfo`, `StatsTokenUsage`, `StatsBuildStatus`). Tugcard already supports multiple `feedIds` — `useTugcardData()` keyed by feed ID.
- **Feed-progress (new, append-stream):** `decode` parses each event. `useFeedStore` with a step-indexed store. Tugcard + `useFeedStore` covers this.

**Conclusion: Tugcard's mechanism is sufficient.** The `feedIds`/`decode`/`useTugcardData()` pattern handles subscription and deserialization for all card types. The two accumulation helpers (`useFeedBuffer` for simple cases, `useFeedStore` for structured indexing) handle the append-stream pattern. No additional `TugFeed` abstraction is needed.

#### Interface-First, Mock the Backend {#d21-interface-first}

Define the interfaces clearly: the `FeedEvent` TypeScript types mirroring the 13 event types from tug-feed.md Layer 3, the `FeedId.TUG_FEED` constant, and the `FeedEventStore` that indexes events by step/phase. Implement the frontend feed-progress card against these interfaces with mock data. The backend (hooks, correlation, tugcast feed implementation) comes online later at a time of our choosing.

```tsx
// The feed-progress card — same pattern as every other card
<Tugcard
  meta={{ title: "Progress", icon: "Activity", closable: true, menuItems: [] }}
  feedIds={[FeedId.TUG_FEED]}
  decode={(feedId, bytes) => JSON.parse(new TextDecoder().decode(bytes)) as FeedEvent}
>
  <FeedProgressContent />
</Tugcard>
```

#### Questions to Resolve

- **Tugcast feed type:** `StreamFeed` (broadcast, every event in order) seems right for append-only events. But should the feed also provide a bootstrap snapshot (recent event history) on reconnection, like the terminal feed does via `tmux capture-pane`? If so, the implementation needs to read the tail of `feed.jsonl` on client connect.
- **Event batching:** Should tugcast batch multiple tug-feed events into a single WebSocket frame (JSON array), or send one frame per event? One-per-frame is simpler and matches the existing pattern. Batching reduces frame count during bursts but adds parsing complexity.
- **`useFeedBuffer` cap policy:** When the buffer is full, drop oldest (ring buffer)? Or stop accepting? Ring buffer is the obvious default, but the conversation card may want different behavior (keep all messages, paginate).

### 8. Motion and Visual Continuity {#c08-motion}

**Status: DESIGNED** (2026-03-02)

**The problem.** Tugdeck has no coherent story for how things move, appear, disappear, or transition between states. This shows up everywhere: dialogs pop into existence with no visual cue that they're modal. Cards have no skeleton or loading state. CSS edits in dev mode flash the entire UI. If we ever add card minimization, there's no way to animate the state change. These are all symptoms of one missing piece: **a motion and visual continuity system.**

This concept unifies what were previously three separate concerns — skeleton/loading states (old concept 8), UI-flash prevention (old concept 14), and the new transitions/animations story — into a single design that answers: **how does tugdeck manage visual state changes over time?**

#### Motion Tokens {#d23-motion-tokens}

Motion tokens are CSS custom properties, following the same `var(--td-*)` convention as theme tokens. They live in the appearance zone ([#d12-three-zones](#d12-three-zones)) — animations and transitions are visual presentation, not React state. Theme files can override motion tokens (e.g., a "calm" theme could use longer durations), but the defaults are global.

**Duration tokens** — four tiers, named by magnitude:

| Token | Value | Usage |
|-------|-------|-------|
| `--td-duration-fast` | 100ms | Micro-interactions: hover feedback, toggle state, focus ring |
| `--td-duration-moderate` | 200ms | Standard transitions: button press, panel expand/collapse |
| `--td-duration-slow` | 350ms | Major transitions: dialog appear/dismiss, card state change |
| `--td-duration-glacial` | 500ms | Dramatic transitions: startup overlay fade, first-paint reveal |

Four durations, not sixteen. Tugdeck is a developer tool, not a consumer app. Animations should feel crisp and purposeful, never decorative. If you're reaching for `glacial`, question whether the animation is needed at all.

**Easing tokens** — three curves, named by behavior:

| Token | Value | Usage |
|-------|-------|-------|
| `--td-easing-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Elements already on screen changing state. Fast start, gentle land. |
| `--td-easing-enter` | `cubic-bezier(0, 0, 0, 1)` | Elements appearing. Starts slow (from nothing), decelerates into place. |
| `--td-easing-exit` | `cubic-bezier(0.2, 0, 1, 1)` | Elements leaving. Accelerates away, doesn't waste time at the start. |

These are MD3's standard/decelerate/accelerate curves. They feel natural because they model physical objects — things at rest accelerate smoothly; things arriving decelerate.

**Duration scalar** — the reduced-motion kill switch: {#d24-reduced-motion}

```css
:root {
  --td-duration-scalar: 1;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --td-duration-scalar: 0.001;
  }
}
```

Every transition and animation duration is wrapped: `calc(var(--td-duration-scalar) * var(--td-duration-moderate))`. When the user prefers reduced motion, the scalar drops to near-zero (not zero — `0.001` ensures `animationend` and `transitionend` events still fire, which Radix's Presence component depends on for unmount timing).

**Apple's "replace, don't remove" principle:** When reduced motion is active, spatial animations (translate, scale) should be replaced with opacity fades, not eliminated entirely. The UI still needs to communicate state changes — a dialog should still fade in to signal modality, even if it doesn't scale up. This means components that animate `transform` should have a reduced-motion alternative that animates `opacity` instead.

**Where tokens live:** In `tokens.css` alongside the theme tokens, within a `/* Motion */` section. They are not theme-specific by default — all themes share the same motion timing. A theme *can* override them (e.g., `--td-duration-moderate: 300ms` for a more relaxed feel), but this is the exception, not the norm.

#### Enter/Exit Transitions {#enter-exit-transitions}

Enter/exit is the hardest animation problem in React: when a component unmounts, its DOM node vanishes instantly, leaving no time for an exit animation. Tugdeck's approach uses **Radix's data-state mechanism + CSS `@keyframes`**, which is already in our stack via shadcn.

**How it works:**

1. Radix components (Dialog, Popover, etc.) set `data-state="open"` when visible and `data-state="closed"` just before unmounting.
2. Radix's `Presence` component delays DOM removal — it keeps the node alive in an `unmountSuspended` state and listens for the `animationend` event.
3. CSS `@keyframes` drive the actual animation, triggered by `data-state` selectors.
4. When `animationend` fires, Radix removes the node.

**The CSS pattern** (using `tw-animate-css` utilities already in the project):

```css
/* Dialog overlay — fade */
[data-state="open"]  { animation: enter var(--td-duration-slow) var(--td-easing-enter); }
[data-state="closed"] { animation: exit var(--td-duration-slow) var(--td-easing-exit); }

/* Dialog content — fade + scale */
[data-state="open"]  { --tw-enter-opacity: 0; --tw-enter-scale: 0.95; }
[data-state="closed"] { --tw-exit-opacity: 0; --tw-exit-scale: 0.95; }
```

The `tw-animate-css` package provides the `enter` and `exit` keyframes that read from `--tw-enter-*` / `--tw-exit-*` CSS variables. We set those variables to define what the animation does; the keyframes do the interpolation.

**Critical constraint: CSS `@keyframes` only.** Radix's Presence listens for `animationend`, not `transitionend`. CSS `transition` properties will not delay unmount. This is a known Radix limitation (issue #996, closed as wont-fix). All enter/exit animations must use `@keyframes`, which the `tw-animate-css` pattern already provides.

**What uses enter/exit transitions:**

| Component | Enter | Exit | Notes |
|-----------|-------|------|-------|
| Dialog overlay | Fade in | Fade out | Communicates modality |
| Dialog content | Fade + scale up from 95% | Fade + scale down to 95% | Focuses attention |
| Popover / dropdown | Fade + slide from anchor edge | Fade + slide back | Direction depends on placement |
| Toast / notification | Slide in from edge | Slide out + fade | Non-blocking, so exit can be faster |
| Card minimize (future) | Scale down to icon size | Scale up from icon | FLIP technique — see below |

**Card state transitions (minimize/iconify):** This is a layout animation, not a simple enter/exit. The card changes size and position. The FLIP technique (First, Last, Invert, Play) handles this: measure the card's current bounds, apply the layout change instantly, compute the delta, then animate only `transform` (compositor-friendly) to bridge the visual gap. If we add card minimization, we'd implement a `useFlipAnimation` hook that wraps `getBoundingClientRect` + `requestAnimationFrame` + transform animation. No JS animation library needed — the browser's Web Animations API can handle the interpolation.

**Reduced motion for enter/exit:** Replace scale+fade with fade-only. The dialog still signals modality (it fades in over a dimmed backdrop), but the spatial movement is removed:

```css
@media (prefers-reduced-motion: reduce) {
  [data-state="open"]  { --tw-enter-scale: 1; }  /* no scale, fade only */
  [data-state="closed"] { --tw-exit-scale: 1; }
}
```

#### Skeleton and Loading States {#skeleton-loading}

When a card first appears or loses its data connection, it needs a visual language for "data is arriving" that is smooth, theme-aware, and consistent across all cards.

**Skeleton shimmer — pure CSS, synchronized:**

```css
.td-skeleton {
  background: linear-gradient(90deg,
    var(--td-skeleton-base) 25%,
    var(--td-skeleton-highlight) 50%,
    var(--td-skeleton-base) 75%);
  background-size: 200% 100%;
  background-attachment: fixed;  /* all skeletons shimmer in sync */
  animation: td-shimmer calc(var(--td-duration-scalar) * 1.5s) ease-in-out infinite;
  border-radius: var(--td-radius-sm);
}

@keyframes td-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Key details:
- **`background-attachment: fixed`** — all skeleton elements on screen shimmer in unison, not independently. This looks intentional rather than chaotic.
- **Theme-aware colors** — `--td-skeleton-base` and `--td-skeleton-highlight` are semantic tokens derived from the theme's background. Brio: dark gray → slightly lighter gray. Harmony: warm tan → slightly lighter tan. The shimmer is always subtle.
- **Duration scalar applies** — when reduced motion is active, shimmer duration drops to near-instant (effectively a static placeholder with no movement).

**Per-card skeleton shapes:**

Each card type defines its own skeleton layout — a terminal skeleton has rectangular text-line placeholders; a git-status skeleton has a tree-like structure with branch lines. Skeletons are not generic gray boxes. They preview the card's actual content structure so the transition to real content feels like "filling in" rather than "replacing."

Tugcard ([#c06-tugcard](#c06-tugcard)) already gates child mounting: when feed data hasn't arrived, the card renders its skeleton. Card content components provide a static `skeleton` property (a React component) that Tugcard renders in place of the content:

```tsx
function TerminalCardContent() { /* ... actual content ... */ }
TerminalCardContent.skeleton = () => (
  <div className="td-skeleton-group">
    <div className="td-skeleton" style={{ width: "60%", height: 14 }} />
    <div className="td-skeleton" style={{ width: "80%", height: 14 }} />
    <div className="td-skeleton" style={{ width: "45%", height: 14 }} />
  </div>
);
```

**Skeleton → content transition:**

When data arrives, the skeleton crossfades to the actual content. This is an appearance-zone animation — no React state for the animation itself:

1. Tugcard renders the real content alongside the skeleton (both in the DOM).
2. The skeleton has `opacity: 1`; the content has `opacity: 0`.
3. On data arrival, a CSS class swap triggers: skeleton fades out (`opacity: 0`, duration `--td-duration-moderate`), content fades in (`opacity: 1`, same duration).
4. After `transitionend`, the skeleton is removed from the DOM.

This crossfade is subtle and fast — the user barely notices it. What they *do* notice is that the card was never blank.

**Error and disconnected states:**

- **"No data yet"** — the skeleton keeps shimmering. No timeout. The skeleton *is* the "waiting" indicator.
- **"Disconnected"** — the `DisconnectBanner` (already implemented) renders a yellow bar at the top of the deck. Cards retain their last data (from `DeckManager.lastPayload`). Skeletons don't reappear — showing stale data is better than showing a loading state for a temporary disconnection.
- **"Failed to load"** — Tugcard renders an error state (icon + message) in place of content. This is a structure-zone change (conditional rendering), not an animation. The error state appears immediately — no transition, because errors should not be softened.

#### Startup Continuity {#startup-continuity}

Startup continuity prevents the visible flash during full page reloads (browser refresh, `reload_frontend` control frame, backend restart + reload). The three-layer approach from `roadmap/eliminate-frontend-flash.md`:

**Layer A — Inline body styles** (eliminates the white flash):

```html
<body style="margin:0;padding:0;overflow:hidden;background-color:#1c1e22">
```

The value `#1c1e22` is Brio's canvas color. Applied during HTML parse, before any CSS loads. For non-Brio users, there's a brief shift from Brio's dark to the actual theme color when CSS loads — far less jarring than white → dark. The pragmatic default.

**Layer B — Startup overlay** (hides the mount transition):

```html
<div id="deck-startup-overlay"
     style="position:fixed;inset:0;background:#1c1e22;z-index:99999;
            transition:opacity var(--td-duration-glacial, 500ms) var(--td-easing-standard, ease-out);
            pointer-events:none"></div>
```

The overlay covers the viewport from first paint. It hides the empty `deck-container` during settings-fetch and React-mount phases. After first React paint, the overlay fades out using motion tokens (with hardcoded fallbacks since tokens aren't loaded yet during startup). The double `requestAnimationFrame` pattern ensures React has committed at least one paint before the fade begins.

Note: the overlay and Tugcard skeletons operate at different levels. The overlay covers the *entire viewport* during app bootstrap. Skeletons cover *individual cards* once mounted. The sequence is: overlay fades out → deck with skeleton cards is revealed → cards crossfade to real content as data arrives.

**Layer C — CSS HMR boundary** (dev mode only — prevents full reloads for CSS changes):

A dedicated `css-imports.ts` module that imports all CSS files and has `import.meta.hot.accept()`. CSS invalidations stop at this boundary instead of propagating to `main.tsx`. CSS edits hot-swap `<style>` tags without full page reload. This is a Vite dev-server concern — `import.meta.hot` is tree-shaken in production builds.

**Relationship to theme system:** When themes become loadable resources ([#c01-theme](#c01-theme)), the stylesheet injection mechanism bypasses Vite's module graph entirely — injected `<style>` elements are runtime DOM mutations, not module imports. Layer C is only needed for base `tokens.css` and `globals.css` changes that go through Vite's build pipeline.

**See:** `roadmap/eliminate-frontend-flash.md` for the full root cause analysis, module graph walkthrough, and implementation plan.

#### What Concept 8 Demonstrates {#c08-demonstrates}

This concept establishes the pattern for all visual continuity in tugdeck:

1. **Motion is tokenized** — durations and easings are CSS custom properties, not magic numbers scattered across components. Change `--td-duration-moderate` once, every transition in the app updates. ([#d23-motion-tokens](#d23-motion-tokens))
2. **Motion lives in the appearance zone** — animations are CSS `@keyframes` and `transition` properties, not React state. Theme changes, reduced motion, and timing adjustments are free — zero re-renders. ([#d12-three-zones](#d12-three-zones))
3. **Reduced motion is a scalar, not a kill switch** — spatial animations become opacity fades, not nothing. The UI still communicates state changes. ([#d24-reduced-motion](#d24-reduced-motion))
4. **Enter/exit uses Radix's data-state + CSS keyframes** — no JS animation library for standard component transitions. The stack we already have (Radix + tw-animate-css) handles it. ([#enter-exit-transitions](#enter-exit-transitions))
5. **Skeletons are per-card, synchronized, and theme-aware** — each card defines its skeleton shape. All skeletons shimmer in unison. Colors come from theme tokens. ([#skeleton-loading](#skeleton-loading))
6. **Startup is a special case with its own three-layer solution** — inline styles, overlay, HMR boundary. Operates at the viewport level, above the component system. ([#startup-continuity](#startup-continuity))

### 9. Alert and Dialog System {#c09-dialog}

**Status: DESIGNED** (2026-03-02)

**The problem.** Tugdeck needs structured modal interaction at multiple scopes — app-wide, card-scoped, button-local, and non-blocking — with each level having clear rules for how it interacts with the responder chain, focus management, and the rest of the UI.

#### Apple's Modal Model: What We're Drawing From {#apple-modal-model}

Apple's AppKit provides the architectural reference. Three mechanisms, each with different scope and event handling:

**`NSApplication.runModal(for:)`** — app-modal. Starts a nested run loop. The calling code *blocks* at the call site. Only the modal window receives events. All other windows are inert. When the user clicks a button, `stopModal(withCode:)` breaks the loop and control returns to the caller with a `ModalResponse` value.

**`NSWindow.beginSheet(_:completionHandler:)`** — document-modal. A sheet slides down from the parent window's title bar. Only the parent window is blocked; other windows remain interactive. The completion handler fires asynchronously when the sheet is dismissed. Sheets queue — if one is already showing, the next one waits.

**`NSAlert`** — the alert primitive. Configurable: `messageText`, `informativeText`, `alertStyle` (informational/warning/critical), up to 3+ buttons via `addButton(withTitle:)`. Can be presented as either app-modal (`runModal()`) or document-modal (`beginSheetModal(for:completionHandler:)`).

**`NSPopover`** — not modal. Auxiliary content anchored to a view. Three behaviors: `.transient` (closes on outside click), `.semitransient` (closes on parent window interaction), `.applicationDefined` (manual). Does not trap focus. Not used for confirmations in Apple's own apps — but SwiftUI's `confirmationDialog` renders as a popover on iPad, establishing precedent for button-anchored confirmations.

#### How This Maps to Tugdeck {#d25-four-modal-categories}

JavaScript cannot block the event loop like AppKit's `runModal(for:)`. But we can block the *responder chain*. When an app-modal alert is showing, the chain manager sets a `modalScope` flag. `dispatch()` checks this flag and refuses to route actions to the main chain. The dialog's own buttons use direct `onClick` handlers — they bypass the chain entirely. This gives the *behavioral* equivalent of Apple's nested run loop without blocking the thread.

**Four categories, mapped from Apple:**

| Category | Apple equivalent | Scope | Chain impact | Focus |
|----------|-----------------|-------|-------------|-------|
| **TugAlert** | `NSAlert.runModal()` | Entire app | Chain blocked | Trapped in dialog |
| **TugSheet** | `NSWindow.beginSheet()` | Single card | Card's node suspended | Trapped in sheet |
| **TugConfirmPopover** | iPad `confirmationDialog` | Button-local | None | Moves to popover |
| **TugToast** | Notification center | None | None | Never steals focus |

#### TugAlert — App-Modal Alert {#tugalert}

Blocks the entire application. The user must respond before doing anything else.

**When to use:** Critical errors, unsaved-changes warnings, destructive actions that affect multiple cards or the whole app, first-run setup confirmations.

**Responder chain:** The chain manager enters `modalScope: "app"`. All `dispatch()` calls to the main chain are refused. Global shortcuts (Cmd+Q) are blocked. Escape dismisses the alert (matching Apple's behavior). The alert's buttons have direct `onClick` handlers — they do not participate in the responder chain.

**Focus:** Radix AlertDialog handles focus trapping. Tab/Shift+Tab cycle within the dialog. On dismiss, focus returns to the element that triggered the alert. Background content gets the `inert` attribute (applied automatically by Radix).

**Visual treatment:** Full-viewport overlay (semi-transparent dark backdrop using motion tokens from [#c08-motion](#c08-motion)). Alert content fades in + scales from 95% using the enter/exit pattern from [#enter-exit-transitions](#enter-exit-transitions). Overlay click does *not* dismiss (this is AlertDialog, not Dialog — the user must click a button).

**Why AlertDialog, not Dialog:** Radix's `AlertDialog` sets `role="alertdialog"` and prevents overlay-click dismissal. `Dialog` allows dismissal by clicking outside, which is wrong for confirmations. The behavioral difference maps exactly to Apple's distinction between sheets (can cancel by clicking elsewhere on some platforms) and alerts (must respond explicitly).

**API — imperative, Promise-based:**

```tsx
const response = await tugAlert({
  title: "Delete project?",
  message: "This action cannot be undone.",
  style: "warning",                              // "informational" | "warning" | "critical"
  buttons: [
    { label: "Delete", role: "destructive" },    // red text, not the default
    { label: "Cancel", role: "cancel" },          // bold, default (Enter key)
  ],
});
// response === "Delete" | "Cancel"
```

The imperative API wraps a declarative React component internally. A `TugAlertHost` component (rendered once, at the app root) listens for alert requests and manages the AlertDialog state. The `tugAlert()` function posts a request and returns a Promise that resolves when the user clicks a button.

**Button roles** (modeled on `UIAlertAction.Style` and Apple HIG):
- `"destructive"` — red text. Signals danger. Never the default button.
- `"cancel"` — bold text. The safe choice. Responds to Enter key and Escape. There is exactly one cancel button.
- `"default"` — standard text. For non-destructive, non-cancel actions.

Apple's HIG guidance: when the alert confirms a destructive action that the user explicitly initiated, make Cancel the default (bold) button so Enter cancels rather than confirms. `tugAlert` follows this — `"cancel"` is always the default when a `"destructive"` button is present.

**Alert styles** (modeled on `NSAlert.Style`):
- `"informational"` — app icon. Notice about a current or impending event.
- `"warning"` — caution badge. User should be aware of consequences.
- `"critical"` — caution icon. Potential data loss or system damage.

In practice, the visual difference between styles is minimal (icon changes). The semantic distinction matters for screen readers and for establishing the gravity of the alert.

#### TugSheet — Card-Modal Dialog {#tugsheet}

Blocks a single card. Other cards remain interactive.

**When to use:** Card close confirmation ("you have unsaved changes"), card-specific settings that require acknowledgment, card-specific destructive actions.

**Responder chain:** The card's responder node is marked `suspended`. Actions dispatched from within the card's subtree are blocked. Other cards' chains are unaffected. Deck-level actions (switching focus to another card) still work. Global shortcuts still work — this matches Apple's behavior where sheets don't disable the menu bar.

**Focus:** Focus is trapped within the card's sheet content. Tab/Shift+Tab cycle within the sheet. On dismiss, focus returns to the card's previously focused element. The card's content area (outside the sheet) receives a visual dimming overlay but other cards do not.

**Visual treatment:** The sheet renders *within the card's bounds*, not as a full-viewport overlay. A semi-transparent backdrop covers only the card's content area. The sheet content slides down from the card's header (matching Apple's sheet animation) or fades in, using motion tokens. Other cards are visually unaffected — they remain bright and interactive.

**Implementation — Radix Dialog with scoped rendering:**

Radix's `Dialog.Portal` accepts a `container` prop to render inside a specific DOM element. For card-modal sheets:

1. The sheet portal targets the card's content container.
2. The overlay is scoped to the card (CSS `position: absolute` within the card, not `position: fixed` on the viewport).
3. `inert` is applied to the card's content area only — not to the whole document. This is manual (Radix applies `inert` globally for its portals); we override by removing `inert` from non-card elements after Radix applies it, or by not using Radix's `modal` mode and implementing card-scoped inertness ourselves.

This is the one place where we diverge from Radix's defaults. Radix doesn't natively support subtree-scoped modality. We accept the extra implementation work because card-modal is a core interaction pattern — cards are independent workspaces, and blocking the entire app for a card-level concern violates that model.

**API — imperative, same shape as TugAlert:**

```tsx
const response = await tugSheet(cardId, {
  title: "Close this card?",
  message: "You have unsaved changes.",
  buttons: [
    { label: "Close Without Saving", role: "destructive" },
    { label: "Cancel", role: "cancel" },
  ],
});
```

A `TugSheetHost` is rendered inside each Tugcard. It listens for sheet requests scoped to its card ID.

#### TugConfirmPopover — Button-Anchored Confirmation {#d26-confirm-popover}

A small popover graphically tied to a button that compels the user to move their mouse and click again to confirm. Not modal in the responder chain sense — it's a lightweight UI gate on a single action.

**When to use:** Close-button confirmation on cards, delete-item buttons, any single-button destructive action where a full alert is too heavy but accidental clicks need prevention.

**Responder chain:** No impact. The chain is unaffected. The popover is just UI — the underlying button enters a "pending confirmation" visual state while the popover is open, but no chain nodes are suspended or blocked.

**Focus:** Focus moves to the popover on open (the confirm button receives focus, so Enter confirms). Escape closes the popover and returns focus to the trigger. The popover does not trap focus — Tab can move out of it, which closes it (matching `NSPopover.Behavior.transient`). This is intentional: the popover is lightweight. Moving focus away is equivalent to clicking away — a soft cancel.

**Visual treatment:** Radix Popover anchored to the trigger button. Arrow pointing to the trigger. Positioned via `side`/`align` props with collision avoidance. Enter/exit animation using the `data-state` + CSS `@keyframes` pattern from [#enter-exit-transitions](#enter-exit-transitions). Fast timing — `--td-duration-fast` — because this is a micro-interaction, not a major state change.

**API — declarative component (not imperative):**

```tsx
<TugConfirmPopover
  onConfirm={() => closeCard(cardId)}
  message="Close this card?"
  confirmLabel="Close"
  confirmVariant="destructive"
>
  <TugButton subtype="icon" icon={<X />} aria-label="Close card" />
</TugConfirmPopover>
```

`TugConfirmPopover` wraps its children as the trigger. When clicked, instead of immediately firing `onConfirm`, it opens a small popover with the message and two buttons: the confirm button (label and variant configurable) and a Cancel button. The user must click confirm (or press Enter, since confirm is focused) to execute the action. Clicking away, pressing Escape, or clicking Cancel dismisses without confirming.

**Why this is a separate category from TugSheet:** The user's response was clear — button confirmation is its own thing. It's not modal to the card or the app. It doesn't block the responder chain. It doesn't trap focus. It's a lightweight "are you sure?" tied to a specific button. A TugSheet for every close button would be too heavy — it dims the card, traps focus, suspends the chain. The confirm popover is snappy: click, see a small popover, click again or press Enter to confirm. Done.

**Close-button integration:** The card title bar's close button ([#c10-titlebar](#c10-titlebar)) wraps in `TugConfirmPopover`. Click the X → popover appears anchored to the X → click "Close" or press Enter → card closes. Click away → nothing happens. This is the standard pattern for all destructive button actions.

#### TugToast — Non-Blocking Notification {#tugtoast}

Fire-and-forget notifications that don't interrupt the user's workflow.

**When to use:** Build succeeded/failed, agent completed a step, connection restored, settings saved, any status update the user should see but doesn't need to act on.

**Responder chain:** No impact whatsoever. Toasts don't participate in the chain. They don't receive focus. They don't block actions. They are pure informational.

**Focus:** Toasts never steal focus. They appear in a corner of the viewport and auto-dismiss after a configurable duration. A global hotkey (Alt+T, configurable) moves focus to the toast region for keyboard interaction. This matches macOS's notification behavior — notifications are announced by VoiceOver but don't take key focus.

**Accessibility:** Sonner renders a persistent `<section role="region" aria-label="Notifications">` with `aria-relevant="additions text"`. Screen readers announce new toasts via the live region without interrupting the user's current interaction. The region element exists in the DOM even when no toasts are showing — required for ARIA live regions to work.

**Implementation — Sonner (already in the shadcn ecosystem):**

```tsx
// App root — render once
<TugToaster position="bottom-right" theme="system" duration={4000} />

// Anywhere in the app — fire and forget
tugToast.success("Build succeeded");
tugToast.error("Connection lost");
tugToast.info("Agent completed step 3");

// With action button
tugToast("Settings saved", {
  action: { label: "Undo", onClick: () => revertSettings() },
});

// Promise-based (loading → success/error)
tugToast.promise(deployBuild(), {
  loading: "Deploying...",
  success: "Deployed successfully",
  error: (err) => `Deploy failed: ${err.message}`,
});
```

`TugToaster` is a thin wrapper around Sonner's `Toaster` that applies tugways theming (colors from `var(--td-*)` tokens, border radius from `--td-radius-*`, enter/exit animation from [#enter-exit-transitions](#enter-exit-transitions)). `tugToast` is a thin wrapper around Sonner's `toast` function.

**Toast variants:**
- `success` — green accent (token: `--td-toast-success`)
- `error` — red accent (token: `--td-toast-error`)
- `warning` — yellow accent (token: `--td-toast-warning`)
- `info` — blue accent (token: `--td-toast-info`)
- Default — no accent color, neutral background

**Auto-dismiss:** 4 seconds default. Configurable per-toast via `duration`. Hovering pauses the timer (Sonner default behavior). Error toasts use a longer duration (8 seconds) because they're more important.

#### Alert System Architecture {#alert-architecture}

**Host components:** Two host components render at fixed points in the tree:

```
TugApp
  ├─ TugAlertHost          ← listens for tugAlert() requests, renders AlertDialog
  ├─ TugToaster            ← Sonner toast container
  └─ DeckCanvas
       ├─ CardFrame
       │    └─ Tugcard
       │         ├─ TugSheetHost   ← listens for tugSheet(cardId) requests
       │         └─ card content
       └─ ...
```

`TugAlertHost` and `TugSheetHost` are thin React components that subscribe to an alert request store (a simple `useSyncExternalStore` pattern — matches [#d12-three-zones](#d12-three-zones)). When `tugAlert()` or `tugSheet()` is called, the request is posted to the store, the host component renders the dialog, and the Promise resolves when the user responds.

**The imperative-over-declarative bridge:** `tugAlert()` and `tugSheet()` are imperative functions that return Promises, but they drive declarative React components under the hood. The pattern:

1. Call `tugAlert({ title, message, buttons })`.
2. The function creates a Promise, posts a request object to a module-level store.
3. `TugAlertHost` re-renders, sees the pending request, renders `<AlertDialog>`.
4. User clicks a button. The `onClick` handler resolves the Promise with the button's label and clears the request from the store.
5. `TugAlertHost` re-renders, sees no pending request, unmounts the dialog.

This is the standard React pattern for imperative-over-declarative APIs (same pattern as `react-hot-toast`, Sonner, Chakra's `useToast`).

#### Mutation Zone Assignment {#dialog-zones}

| Zone | What changes | Mechanism |
|------|-------------|-----------|
| **Appearance** | Backdrop opacity, dialog scale/fade animation, dimming of blocked content | CSS transitions + `data-state` (zero re-renders) |
| **Local data** | Alert host's pending request state | `useSyncExternalStore` on the alert request store |
| **Structure** | Dialog component mount/unmount, `inert` attribute on background | React conditional rendering driven by request store |

#### What Concept 9 Establishes {#c09-demonstrates}

1. **Four modal categories with clear scope** — app-modal, card-modal, button-confirmation, toast. Each has defined responder chain impact, focus behavior, and visual treatment. ([#d25-four-modal-categories](#d25-four-modal-categories))
2. **Responder chain modality** — app-modal blocks the chain globally; card-modal suspends one node; confirm-popover and toast have zero chain impact. The chain is the modality mechanism, not the DOM. ([#apple-modal-model](#apple-modal-model))
3. **Imperative API for alerts, declarative for confirmations** — `tugAlert()` and `tugSheet()` return Promises (Apple-inspired, web-adapted). `TugConfirmPopover` is a component you wrap around a button. `tugToast` is fire-and-forget. ([#tugalert](#tugalert), [#d26-confirm-popover](#d26-confirm-popover), [#tugtoast](#tugtoast))
4. **Button-confirmation is its own category** — not a sheet, not an alert. A lightweight popover anchored to the trigger button. Snappy, not ceremonial. ([#d26-confirm-popover](#d26-confirm-popover))
5. **All animations use concept 8's motion system** — enter/exit via `data-state` + CSS keyframes, timing from motion tokens, reduced-motion scalar applies. ([#c08-motion](#c08-motion))

### 10. Card Title Bar Enhancements {#c10-titlebar}

**Status: DESIGNED** (2026-03-02)

**The problem.** The card title bar needs three changes: a window-shade collapse control, a close confirmation, and a menu icon rotation. These are small individually, but they establish patterns for how the title bar evolves.

The good news: the existing `CardHeader` component (`card-header.tsx`) already has the plumbing for all three — `showCollapse` prop with `onCollapse` callback, `onClose` callback, and the `EllipsisVertical` menu icon. The work is connecting these to the right behaviors.

#### Window-Shade Collapse {#d27-window-shade}

**What it is:** Collapse the card to its title bar only — the content area disappears, leaving just the 28px header strip. Click again (or click the same chevron) to expand back to full size. This is the classic Mac OS "window shade" from System 7 through Mac OS 9.

**State:** The collapsed/expanded state is stored in `CardState` (the layout tree's per-card state object). It persists across re-renders and is included in layout serialization so the deck remembers which cards are collapsed on reload.

```ts
// Addition to CardState in layout-tree.ts
interface CardState {
  position: { x: number; y: number };
  size: { width: number; height: number };
  collapsed: boolean;  // ← new
}
```

**Control:** A chevron button in the title bar (between the menu button and close button, replacing the current `Minus` icon). The chevron points down when expanded (indicating "collapse available") and up when collapsed (indicating "expand available"). The existing `showCollapse` prop and `onCollapse` callback on `CardHeader` already support this — `showCollapse` just needs to default to `true` instead of `false`.

```
Expanded:  [icon] TERMINAL    [☰] [▾] [✕]
Collapsed: [icon] TERMINAL    [☰] [▴] [✕]
```

Use `ChevronDown` / `ChevronUp` from lucide-react. The current `Minus` icon for collapse is ambiguous — it could mean minimize, close, or subtract. Chevrons clearly communicate directionality.

**CardFrame behavior when collapsed:**

1. Height animates from current `size.height` to `CARD_TITLE_BAR_HEIGHT` (28px) + border. Uses `--td-duration-moderate` and `--td-easing-standard` from concept 8's motion tokens ([#d23-motion-tokens](#d23-motion-tokens)).
2. Content area has `overflow: hidden` and its height goes to 0. No content is unmounted — it's hidden, not removed. This means the card's internal state (terminal session, scroll position, form values) is preserved.
3. Resize handles are hidden when collapsed — there's nothing to resize. Drag remains active (you can reposition a collapsed card).
4. The card's position doesn't change — it collapses downward in place (the top edge stays where it is, the bottom edge moves up).

**Mutation zone:** The collapse animation is appearance-zone (CSS `height` transition on the card frame, `overflow: hidden` on content). The collapsed state itself is local data (persisted in `CardState` via DeckManager). The chevron icon swap is a structure-zone change (conditional rendering of the icon based on `collapsed`).

**Double-click on header:** As a secondary gesture, double-clicking the title bar toggles collapse — matching macOS behavior (System Preferences → Dock → "Double-click a window's title bar to minimize"). This is a convenience, not the primary control.

#### Close Confirmation {#close-confirmation}

**Trigger: always.** Every closable card gets a confirmation popover when the close button is clicked. This uses the TugConfirmPopover pattern from concept 9 ([#d26-confirm-popover](#d26-confirm-popover)).

**Implementation:** Replace the current direct `onClose` call in `CardHeader`'s close button with a `TugConfirmPopover` wrapper:

```tsx
{meta.closable && (
  <TugConfirmPopover
    onConfirm={onClose}
    message={`Close ${meta.title}?`}
    confirmLabel="Close"
    confirmVariant="destructive"
  >
    <button className="card-header-btn ..." aria-label="Close card" type="button">
      <X width={14} height={14} />
    </button>
  </TugConfirmPopover>
)}
```

The popover anchors to the X button. Click X → popover appears below → click "Close" or press Enter → card closes. Click away or press Escape → nothing happens. This matches the pattern described in concept 9 — snappy, button-local, no responder chain impact.

**Future refinement:** The "always confirm" rule is a safe starting point. Later, we may differentiate — cards with unsaved state always confirm, cards without unsaved state close immediately. But that requires a notion of "unsaved state" in the card model, which doesn't exist yet. Always-confirm is the pragmatic default.

#### Menu Icon Rotation {#menu-icon-rotation}

**Change:** Rotate the hamburger menu icon 90 degrees so the three dots are horizontal (`EllipsisVertical` → stays vertical but the dots should read as a more standard vertical kebab menu icon). Actually, the current `EllipsisVertical` is already a vertical three-dot icon. The request is to rotate it to horizontal — use `Ellipsis` (horizontal three-dot) from lucide-react instead.

Wait — re-reading the original request: "Rotate hamburger menu icon 90 degrees." The current icon is `EllipsisVertical` (⋮). Rotating 90° would make it horizontal (⋯). This is a one-line change:

```tsx
// Before
import { EllipsisVertical } from "lucide-react";

// After
import { Ellipsis } from "lucide-react";
```

This is a purely cosmetic change. `Ellipsis` (⋯) reads as "more options" in the same way `EllipsisVertical` (⋮) does — both are standard menu trigger icons. The horizontal variant is arguably more common on the web.

#### Title Bar Button Order {#titlebar-button-order}

The current order is: `[menu] [collapse] [close]`, right-aligned. This matches macOS window button ordering convention (left-to-right: close, minimize, maximize on Mac — but our buttons are right-aligned, so the order inverts). For consistency with web conventions (where the close button is rightmost):

```
[icon] CARD TITLE    [⋯] [▾/▴] [✕]
         menu ─────────┘    │     └── close (always rightmost)
         collapse ──────────┘
```

This order is already correct in the existing `CardHeader` implementation. No change needed.

#### What Concept 10 Establishes {#c10-demonstrates}

1. **Window-shade collapse persists in CardState** — layout serialization remembers collapsed cards. Content is hidden (CSS), not unmounted (React). State preserved. ([#d27-window-shade](#d27-window-shade))
2. **Close confirmation uses TugConfirmPopover** — the title bar is the first real consumer of concept 9's button-confirmation pattern. Always-confirm for now; differentiable later. ([#close-confirmation](#close-confirmation))
3. **Title bar animations use motion tokens** — collapse/expand height transition uses `--td-duration-moderate` + `--td-easing-standard`. Appearance zone, zero unnecessary re-renders. ([#d23-motion-tokens](#d23-motion-tokens))

### 11. Dock Redesign {#c11-dock}

**Status: DESIGNED** (2026-03-02)

**The problem.** The dock currently has one kind of button: card-toggle buttons that show/focus a card. It needs two additional kinds: command buttons (that trigger an action directly) and popout menu buttons (that open a floating menu anchored to the dock). It also needs positional flexibility and hover tooltips.

The existing dock (`dock.tsx`) is a fixed 48px vertical rail on the right edge with six card buttons, a settings dropdown, and a logo. The redesign adds button types and flexibility without fundamentally changing the structure.

#### Three Button Types {#d28-dock-button-types}

The dock has three kinds of buttons, each rendered with the same visual treatment (32×32 icon button) but with different click behavior:

| Type | Click behavior | Visual indicator | Example |
|------|---------------|-----------------|---------|
| **Card toggle** | Show/focus/toggle a card | Badge count (existing) | Terminal, Git, Files |
| **Command** | Execute an action directly | None (or brief flash) | Future test-case buttons |
| **Popout menu** | Open a floating menu anchored to the button | Caret/chevron indicator | Settings (existing), future grouped commands |

**Card toggle buttons** — unchanged from current behavior. Click shows the card if hidden, focuses it if visible but not key, or toggles it off if already key. Badge counts display notification state. These are the top group in the dock.

**Command buttons** — direct-action buttons for the dock. Click fires a callback immediately. No popover, no menu, no confirmation (unless the command wraps in `TugConfirmPopover` from concept 9). These will be added as we implement tugways components and need test-case triggers. They live in the same button group as card toggles, below them.

**Popout menu buttons** — buttons that open a floating menu anchored to the dock. The settings gear icon is already this type (it uses `CardDropdownMenu`). The menu uses Radix DropdownMenu, positioned to the side of the dock opposite its edge (e.g., if dock is on the right, menus open to the left). The menu's `side` and `align` props adjust automatically based on dock placement.

#### Dock Placement {#d29-dock-placement}

The dock can be placed on any edge: **right** (default), left, top, or bottom. The placement is a setting stored in the settings API (same mechanism as theme).

| Placement | Layout | Menu direction |
|-----------|--------|---------------|
| Right | Vertical, 48px wide, fixed to right edge | Menus open left |
| Left | Vertical, 48px wide, fixed to left edge | Menus open right |
| Top | Horizontal, 48px tall, fixed to top edge | Menus open below |
| Bottom | Horizontal, 48px tall, fixed to bottom edge | Menus open above |

The dock is always a flexbox — `flex-col` for vertical placements (left/right), `flex-row` for horizontal (top/bottom). Icons rotate or stay the same — lucide icons are symmetrical, so no rotation needed. The canvas area (`DeckCanvas`) adjusts its inset to account for the dock's position and width/height.

**Implementation note:** The current dock is hardcoded as `fixed top-0 right-0 bottom-0 w-12 flex-col`. Placement support means parameterizing these: position props come from a `dockPlacement` setting, and the CSS classes are computed from it. The `side` prop on `CardDropdownMenu` flips based on placement.

#### Tooltips {#dock-tooltips}

Every dock button shows a tooltip on hover, displaying the button's label. The tooltip appears on the side opposite the dock edge (e.g., dock on the right → tooltips appear to the left). Radix Tooltip is already in the project (`components/ui/tooltip.tsx`) with enter/exit animations.

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <IconButton Icon={Terminal} label="Terminal" onClick={...} />
  </TooltipTrigger>
  <TooltipContent side={tooltipSide}>
    Terminal
  </TooltipContent>
</Tooltip>
```

The `tooltipSide` is derived from dock placement: right dock → `"left"`, left dock → `"right"`, top dock → `"bottom"`, bottom dock → `"top"`.

A `TooltipProvider` wraps the entire dock to configure shared delay settings — `delayDuration={400}` (standard hover delay before showing), `skipDelayDuration={100}` (after one tooltip shows, subsequent ones appear faster as the user scans).

#### Responder Chain: The Dock Is Not a Responder {#dock-chain}

The dock does not participate in the responder chain. It never receives keyboard events via the chain. It never handles routed actions. It is purely a direct-interaction surface — you click a button, it fires a callback.

This is intentional. The dock is chrome, not content. It doesn't need action validation (no `canHandle`/`validateAction`). It doesn't need to participate in focus management. Its buttons are always visible and always enabled (badge counts and button presence are controlled by the card registry, not the chain).

The dock *triggers* things that interact with the chain — clicking a card toggle may change which card is first responder, and a popout menu might fire an action that eventually reaches the chain — but the dock itself is outside the chain.

#### Dock Configuration Shape {#dock-config}

```ts
interface DockConfig {
  placement: "right" | "left" | "top" | "bottom";  // default: "right"
  buttons: DockButtonConfig[];  // ordered list of buttons
}

type DockButtonConfig =
  | { type: "card-toggle"; cardType: string; icon: string; label: string }
  | { type: "command"; icon: string; label: string; action: string }
  | { type: "popout-menu"; icon: string; label: string; menuId: string }
  | { type: "spacer" }
  | { type: "logo" };
```

The button list is declarative — the dock renders whatever buttons the config specifies, in order. The default config matches the current dock: six card toggles, a spacer, the settings popout menu, and the logo. Future changes (adding test-case command buttons, reordering) are config changes, not component changes.

The `menuId` on popout-menu buttons references a menu definition registered elsewhere (the settings menu is built in `Dock` today; in the redesign it would be registered by ID so other menus can be added without modifying the dock component).

#### What Concept 11 Establishes {#c11-demonstrates}

1. **Three dock button types** — card toggle, command, popout menu. Same visual, different click behavior. Declared in config, not hardcoded. ([#d28-dock-button-types](#d28-dock-button-types))
2. **Dock placement** — right/left/top/bottom. Canvas inset adjusts. Menu direction and tooltip side flip automatically. ([#d29-dock-placement](#d29-dock-placement))
3. **Dock is outside the responder chain** — pure direct-interaction chrome. No `useResponder`, no action validation, no focus management. ([#dock-chain](#dock-chain))
4. **Tooltips via Radix Tooltip** — already in the project. Consistent delay, auto-positioned opposite the dock edge. ([#dock-tooltips](#dock-tooltips))

### 12. Card Tabs {#c12-tabs}

**Status: DESIGNED** (2026-03-02)

**The problem.** Cards need to share a single frame. A terminal card and a code card should be able to coexist in one panel, switched via tabs at the top. The data model already has `TabItem[]` and `activeTabId` in `CardState`, and a `tab-bar.tsx` exists — but the current implementation is entangled with the old card infrastructure (`ReactCardAdapter`, `TugCard` interface) that gets demolished in Phase 0. Tabs need to be rebuilt as a first-class Tugcard composition feature.

#### When Tabs Appear {#d30-tab-visibility}

The tab bar is **hidden for single-tab cards**. Most cards are single-tab — terminal, git, files, stats, settings, developer, about. The tab bar only renders when `tabs.length > 1`. This keeps the common case clean: no visual overhead for cards that don't use tabs.

When a second tab is added to a card (via dock command, drag-onto-card gesture, or programmatic API), the tab bar appears between the title bar and the content area. When tabs are reduced back to one, the tab bar disappears.

```
┌─────────────────────────────┐
│ [≡] Terminal           [–][×]│  ← title bar (always present)
├─────────────────────────────┤
│ [Terminal 1] [Code ▾]  [+]  │  ← tab bar (only when tabs.length > 1)
├─────────────────────────────┤
│                             │
│         content area        │  ← active tab's Tugcard content
│                             │
└─────────────────────────────┘
```

The title bar displays the **active tab's title**. The card frame's identity follows the active tab.

#### Tabs Are a Tugcard Feature {#d31-tabs-in-tugcard}

Tabs live inside the Tugcard composition layer, not in CardFrame. CardFrame handles positioning, sizing, drag, resize, z-index — it doesn't know about tabs. Tugcard manages:

- The `tabs` array and `activeTabId` state
- Rendering the tab bar component (when `tabs.length > 1`)
- Mounting/unmounting tab content (active tab is mounted, inactive tabs are unmounted to save resources — terminal cards may opt into keeping their tab mounted to preserve session state)
- Reporting the active tab's minimum content size to CardFrame via the dynamic min-size mechanism ([D17])

This separation means CardFrame stays simple — it wraps one Tugcard, which internally manages however many tabs it has.

#### Tab Types

Tabs can be **same-type** (two terminal tabs in one frame) or **mixed-type** (a terminal tab and a code tab sharing a frame). Each tab is a `TabItem` with its own `componentId` and `id`:

```ts
interface TabItem {
  id: string;          // unique instance ID (crypto.randomUUID())
  componentId: string; // card type: "terminal", "code", "git", etc.
  title: string;       // display title in tab bar
  closable: boolean;   // whether the tab shows a close button
}
```

This is the existing `TabItem` interface from `layout-tree.ts` — unchanged. The data model is already correct.

#### Tab Gestures

| Gesture | Action |
|---------|--------|
| Click tab | Switch to that tab |
| Click tab close (×) | Close that tab (with confirmation if configured) |
| Click [+] button | Add a new tab (same type as active tab by default) |
| Drag tab within bar | Reorder tabs |
| Drag tab out of bar | Detach into a new card frame |
| Drag card onto another card's tab bar | Merge as a new tab |

The drag-to-merge and drag-to-detach gestures are the primary way users create and break apart tabbed cards. These are stretch goals — click-based tab management is the initial implementation.

#### Responder Chain Integration

The active tab's content is the active responder node within the card's position in the chain. Switching tabs changes which content view receives actions:

```
DeckCanvas
  └── Tugcard (card-level responder)
        └── [active tab's content responder]  ← switches when tab changes
```

Inactive tabs have no responder registration. When a tab switch occurs, the old tab's content responder is unregistered and the new tab's content responder is registered in its place. This is automatic via `useResponder` — when the inactive tab's content unmounts, its responder deregisters; when the new tab's content mounts, it registers.

#### Tab Bar Component

The tab bar is a simple horizontal strip:

```tsx
<TugTabBar
  tabs={tabs}
  activeTabId={activeTabId}
  onTabSelect={(tabId) => setActiveTabId(tabId)}
  onTabClose={(tabId) => removeTab(tabId)}
  onTabAdd={() => addTab()}
  onTabReorder={(fromIndex, toIndex) => reorderTabs(fromIndex, toIndex)}
/>
```

Styled with `--td-*` tokens. Active tab has a bottom border accent. Inactive tabs are muted. Close buttons appear on hover. The [+] button is at the end. Overflow scrolls horizontally (no wrapping — tabs are a horizontal rail).

#### Persistence

Tab state is already persisted in `CardState.tabs` and `CardState.activeTabId`. The serialization format (v5) already handles this. No changes to `serialization.ts` are needed for the basic tab feature.

#### What Concept 12 Establishes {#c12-demonstrates}

1. **Tab bar visibility gated on count** — hidden for single-tab cards, visible for multi-tab. No visual overhead in the common case. ([#d30-tab-visibility](#d30-tab-visibility))
2. **Tabs are a Tugcard composition feature** — CardFrame is unaware. Tugcard manages tab state, tab bar rendering, and content switching internally. ([#d31-tabs-in-tugcard](#d31-tabs-in-tugcard))
3. **Same data model** — `TabItem`, `CardState.tabs`, `CardState.activeTabId` are unchanged from the existing `layout-tree.ts`. The infrastructure was designed for tabs from the start; only the UI layer needs rebuilding.
4. **Responder chain follows the active tab** — tab switching is a chain reconfiguration, handled automatically by mount/unmount of content responders.

### 13. Card Snap Sets {#c13-snap-sets}

**Status: DESIGNED** (2026-03-02)

**The problem.** The current card snap system is always-on: every drag operation shows snap guides and snaps cards to edges. This is useful for organizing layouts but gets in the way of quick, casual card repositioning. The snap behavior should be opt-in via a modifier key, so users can freely drag cards without unintended snapping.

The geometric engine (`snap.ts`) is solid — ~500 lines of spatial math for shared-edge detection, set computation, sash groups, and docked corner rendering. The behavior change is in **when** that engine is consulted, not in **how** it works.

#### Modifier-Gated Snapping {#d32-modifier-snap}

Snap guides and snap-to-edge behavior activate **only when the user holds Option (Alt) during drag**. Without the modifier:

| Modifier held? | During drag | On drop |
|----------------|------------|---------|
| **No** | Free movement, no guides, no snap | Card lands at cursor position, no set formed |
| **Yes (Option)** | Snap guides appear, card snaps to nearby edges | If snapped, a set is formed with the adjacent card(s) |

The modifier is checked continuously during drag — the user can press Option mid-drag to activate snapping, or release it to return to free movement. This provides a fluid, discoverable experience:

1. Start dragging a card (free movement)
2. Move near another card — nothing happens
3. Press Option — snap guides appear, card snaps to the nearby edge
4. Release Option — card unsnaps, returns to cursor position
5. Press Option again, release mouse — card snaps and a set is formed

The visual feedback is immediate: guides appear/disappear as the modifier is pressed/released. There is no latency or mode-switch delay.

#### Implementation: Where the Gate Lives

The modifier gate is in `DeckManager`'s drag handler, not in `snap.ts`. The snap module remains a pure geometry library — it computes snap positions given rectangles. The caller decides whether to use those positions:

```ts
// In DeckManager drag handler (simplified)
function onDragMove(cardId: string, cursorX: number, cursorY: number, event: MouseEvent) {
  if (event.altKey) {
    // Option held: compute snap and apply
    const snapResult = computeSnap(dragRect, otherRects, SNAP_THRESHOLD_PX);
    applyPosition(cardId, snapResult.x ?? cursorX, snapResult.y ?? cursorY);
    showGuides(snapResult.guides);
  } else {
    // No modifier: free movement
    applyPosition(cardId, cursorX, cursorY);
    hideGuides();
  }
}
```

The existing `computeSnap`, `findSharedEdges`, `computeSets` functions in `snap.ts` are untouched. The only change is the conditional call site.

#### Set-Move Is Always Active {#d33-set-move-always}

Once a set is formed (cards are snapped together), **set-move is always active**. Dragging any member of a set moves the entire group — no modifier needed. This is the current behavior and it stays.

The rationale: sets are intentional structures. The user opted into the set by holding Option during snap. Once formed, the set should behave as a unit. Requiring Option for every set-move would be tedious.

| Scenario | Behavior |
|----------|----------|
| Drag a card that's in a set (no modifier) | Entire set moves together |
| Drag a card that's in a set (with Option) | Entire set moves together (same behavior) |
| Drag a card far enough from its set (no modifier) | Card breaks out of the set, moves freely |
| Option+drag a breakaway card near another card | Snap guides appear, card can join a new set |

#### Break-Out Behavior

Breaking a card out of a set works as it does today: drag a set member far enough away from the group (beyond the snap threshold) and it detaches. The card becomes a free-floating panel again.

The existing break-out detection in `DeckManager` (measuring drag distance from the set's bounding box) remains unchanged. The only addition: after break-out, if Option is held, the detached card can immediately snap to a different card to form a new set.

#### Visual Feedback

| State | Visual |
|-------|--------|
| Free drag (no Option) | Card follows cursor, no guides, no highlighting |
| Option held during drag | Snap guides appear (existing blue/accent lines), target edges highlight |
| Card snaps to edge | 1px overlap applied, docked corners computed (square at shared edge, rounded elsewhere) |
| Set formed | Sash handles appear at shared edges (existing behavior) |

The snap guides, docked corner computation, 1px overlap, and sash rendering are all existing visual features. The only change is their activation condition.

#### What Concept 13 Establishes {#c13-demonstrates}

1. **Snap is modifier-gated** — Option (Alt) activates snap guides and snap-to-edge during drag. Free drag is the default. ([#d32-modifier-snap](#d32-modifier-snap))
2. **Set-move is always active** — once a set is formed, dragging any member moves the group. No modifier needed for set operations. ([#d33-set-move-always](#d33-set-move-always))
3. **Geometric engine untouched** — `snap.ts` remains a pure geometry library. The modifier gate lives in the drag handler, not the math.
4. **Fluid modifier interaction** — Option can be pressed/released mid-drag with immediate visual feedback. No mode switches, no state machines.

### 14. Selection Model {#c14-selection}

**Status: DESIGNED** (2026-03-03)

**The problem.** The browser treats all card content as a single document flow. A user can start selecting text in one card's content area and drag the selection into another card, across the canvas background, and even through card title bars — producing a meaningless cross-card selection that spans chrome, gaps, and unrelated content. Title bar text (card titles, button labels) is selectable. There are no selection boundaries between cards or between chrome and content. This is the default DOM behavior and it will not do for a card-based workspace.

Cards are independent workspaces. Selection must respect that independence: it must never cross card boundaries, never include chrome elements, and must be controllable at a fine-grained level by card content authors. Additionally, content areas with `overflow: auto` must provide excellent autoscrolling when the user drags to select near the scroll edges.

#### Platform Assessment {#selection-platform}

The web platform's selection containment capabilities were thoroughly researched. The findings:

| Technology | Selection Containment? | Status |
|------------|----------------------|--------|
| `user-select: contain` (CSS) | Designed for exactly this purpose | **Not implemented in any modern browser.** Only ever worked in IE as `-ms-user-select: element`. No WebKit/Safari/Chrome/Firefox support. GitHub's polyfill was archived with the conclusion that the behavior "cannot currently be polyfilled due to technical limitations." |
| Shadow DOM | Prevents selection crossing in Firefox only | **Not reliable in WebKit/Safari.** Selection visually crosses shadow boundaries in our target platform (macOS WKWebView). |
| iframes | True selection isolation | **Too heavyweight.** Each iframe is a separate document with its own JavaScript context, styling, and memory overhead. Not viable for card content. |
| `overflow: hidden/auto` | No effect on selection | Content clips visually but **selection passes right through** overflow boundaries. |
| CSS `contain` property | No effect on selection | Purely a **rendering optimization**. `contain: content`, `contain: strict`, etc. do not create selection boundaries. |
| `contenteditable` containers | Implicit `user-select: contain` behavior | **Unusable as a containment mechanism.** Brings unwanted side effects: input events, cursor blinking, editing capabilities, IME activation. The spec says editing hosts implicitly behave as `user-select: contain`, but we cannot use `contenteditable` just for selection containment. |
| JavaScript Selection API | Full programmatic control | **The viable approach.** `window.getSelection()`, `Selection.setBaseAndExtent()`, `document.caretPositionFromPoint()`, `selectstart`/`selectionchange` events provide the primitives needed to build selection containment in JavaScript. |

**Conclusion:** Since `user-select: contain` does not exist in WebKit, we must build selection containment ourselves using CSS prevention for the passive layer and the JavaScript Selection API for the active layer. This is the same approach used by VS Code panels, ProseMirror, and other serious editor frameworks.

#### Three-Layer Selection Containment {#d34-three-layer-selection}

The selection model uses three complementary layers:

**Layer 1: CSS Prevention (passive).** Prevent selection from *starting* in non-content areas via `user-select: none`. This is the first line of defense — it eliminates ~60% of the problem by making it impossible to start a selection from chrome or gap areas.

| Element | `user-select` | Rationale |
|---------|--------------|-----------|
| Canvas background (`.deck-canvas`) | `none` | Gap between cards is not content |
| Card frame border/resize handles | `none` | Structural chrome |
| Card header (`.tugcard-header`) | `none` | Already implemented in Phase 5 |
| Accessory slot (`.tugcard-accessory`) | `none` | Chrome controls (find bar inputs get explicit `text`) |
| Card content area (`.tugcard-content`) | `text` | Explicitly opt-in to selection |
| Resize handles (`.card-frame-resize-*`) | `none` | Hit areas only, no text |

CSS prevention alone does not stop a selection that *starts* in a content area from *extending* out of the card. Layer 2 handles that.

**Layer 2: SelectionGuard (active JS containment).** A singleton JavaScript object that monitors and clips selection at runtime. It enforces the rule: **a selection that starts in a card's content area cannot extend beyond that card's content area.**

**Layer 3: Developer API for card content.** Data attributes that card content authors use to control selectability within their content areas. This provides the fine-grained control needed for different card types (terminal, code editor, form controls, etc.).

#### SelectionGuard: The Runtime Containment Engine {#d35-guard-singleton}

SelectionGuard is a plain TypeScript singleton (not React state, not a hook — follows the same pattern as ResponderChainManager from concept 4). It operates entirely outside React's render cycle.

**Why a singleton, not React state:**
- Selection events fire at very high frequency during drag selection (every few milliseconds)
- Clipping must happen synchronously, without waiting for React re-renders
- Selection tracking state (which card owns the current selection) is ephemeral and interaction-scoped — not application state
- Follows the three-zone model ([D12]): selection containment is appearance-zone behavior (DOM manipulation, zero re-renders)

**Architecture:**

```typescript
class SelectionGuard {
  private boundaries: Map<string, HTMLElement>;  // cardId → content area element
  private activeBoundary: HTMLElement | null;    // card that owns the current selection
  private isSelecting: boolean;                  // pointer is down and dragging
  private savedSelections: Map<string, SavedSelection>; // per-card saved selections

  // Called by useSelectionBoundary hook in Tugcard
  register(cardId: string, element: HTMLElement): void;
  unregister(cardId: string): void;

  // Selection persistence (used by Phase 5b tab switching)
  saveSelection(cardId: string): SavedSelection | null;
  restoreSelection(cardId: string, saved: SavedSelection): void;

  // Internal — attached to document
  private handleSelectStart(event: Event): void;
  private handleSelectionChange(): void;
  private handlePointerMove(event: PointerEvent): void;
  private handlePointerUp(event: PointerEvent): void;
  private autoScrollTick(boundary: HTMLElement, pointerY: number): void;
}
```

**Hook for Tugcard integration:**

```typescript
// Used once inside Tugcard, on the content area div
function useSelectionBoundary(cardId: string, contentRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    selectionGuard.register(cardId, el);
    return () => selectionGuard.unregister(cardId);
  }, [cardId, contentRef]);
}
```

Tugcard automatically calls `useSelectionBoundary` on its content area element. Card authors never interact with SelectionGuard directly.

#### Pointer-Clamped Selection Clipping {#d36-pointer-clamping}

The clipping algorithm uses pointer tracking during drag selection to provide smooth, continuous containment with no visual flash:

**Phase 1: `selectstart` event.** When a selection begins, identify which registered boundary element contains the `event.target`. Store it as `activeBoundary`. If no boundary contains the target (selection started in chrome or canvas gap), the CSS prevention layer should have already blocked it — but as a safety net, cancel the selection.

**Phase 2: `pointermove` during selection.** While the pointer is down and a selection is active:
1. Check if the pointer coordinates are inside the `activeBoundary`'s bounding rect.
2. If the pointer is inside, do nothing — the browser's native selection behavior is correct.
3. If the pointer has exited the boundary:
   a. Clamp the pointer coordinates to the boundary's rect edges.
   b. Call `document.caretPositionFromPoint(clampedX, clampedY)` to find the nearest valid text position at the boundary edge.
   c. Call `selection.extend(node, offset)` to pin the selection's focus endpoint to that boundary-edge position.

This produces smooth, continuous selection clamping — the selection grows to the edge of the card content area and stops, just as it would with native `user-select: contain`. There is no visual flash because the clamping happens on every pointer move, before the browser has a chance to render the unconstrained selection.

**Phase 3: `selectionchange` safety net.** As a fallback (for cases where the selection changes without pointer movement, e.g., keyboard-driven selection extension via Shift+arrow), monitor `selectionchange`:
1. Get the selection's `Range` via `selection.getRangeAt(0)`.
2. Check if `range.commonAncestorContainer` is within the `activeBoundary`.
3. If not, clip the selection:
   - Determine direction (forward or backward) by comparing anchor and focus positions.
   - For forward escape: set focus to the last text node in the boundary.
   - For backward escape: set focus to the first text node in the boundary.
   - Use `Selection.setBaseAndExtent()` to rewrite the selection.

**Phase 4: `pointerup`.** Clear `activeBoundary` and `isSelecting` state.

**Cross-browser note:** `document.caretPositionFromPoint()` reached Baseline status in December 2025 and is available in all modern browsers. For WKWebView specifically, `document.caretRangeFromPoint()` (WebKit's older API) is also available as a fallback. The implementation should try `caretPositionFromPoint` first and fall back to `caretRangeFromPoint`.

#### Four Select Modes for Card Content {#d37-select-modes}

Card content authors control selectability within their content areas using a `data-td-select` attribute on any element inside the content area:

| `data-td-select` value | Behavior | Use case |
|------------------------|----------|----------|
| (not set / default) | `text` — standard browser text selection | Most card content |
| `none` | Not selectable — equivalent to `user-select: none` on this subtree | UI controls, buttons, labels within content |
| `all` | Atomic selection — clicking anywhere in the element selects its entire text content | Code snippets, copy-ready output blocks |
| `custom` | SelectionGuard does not clip selection within this subtree; the region manages its own selection entirely | Terminal emulator (xterm.js), code editor (CodeMirror/Monaco) |

**How `data-td-select` works with SelectionGuard:**

- **`none`**: Applied via CSS rule `[data-td-select="none"] { user-select: none; }`. Pure CSS, no JS involvement.
- **`all`**: Applied via CSS rule `[data-td-select="all"] { user-select: all; }`. The browser handles atomic selection natively.
- **`custom`**: SelectionGuard checks whether the selection anchor is within a `data-td-select="custom"` element. If so, the guard does not clip — the embedded component (xterm.js, CodeMirror, contenteditable) manages selection independently. The containment boundary effectively shrinks to the custom region: selection still cannot escape the card, but within the custom region, the embedded component has full control. This includes contenteditable regions — a `<div contenteditable data-td-select="custom">` receives full selection autonomy, with the guard verifying that selection cannot escape the card even when contenteditable's native behavior tries to extend it.

**Example usage in a code card:**

```tsx
function CodeCardContent() {
  const data = useTugcardData<CodePayload>();
  return (
    <div>
      <div data-td-select="none" className="toolbar">
        <TugButton>Run</TugButton>
        <TugButton>Copy</TugButton>
      </div>
      <div data-td-select="custom" className="editor-container">
        <CodeMirrorEditor value={data.source} />
      </div>
      <div data-td-select="all" className="output-block">
        <pre>{data.output}</pre>
      </div>
    </div>
  );
}
```

#### Cmd+A Scoped to Focused Card {#d38-scoped-selectall}

Cmd+A (Select All) must select all content in the *focused card only*, not the entire page.

**Integration with the responder chain:**

1. Cmd+A enters the key pipeline (concept 4, [D10]).
2. Stage 3 (action dispatch) routes the `selectAll` action through the responder chain.
3. The focused Tugcard's responder handles `selectAll`:
   - Get the card's content area element (the selection boundary element).
   - Call `window.getSelection().selectAllChildren(contentElement)`.
   - This selects all text within the content area, respecting `data-td-select="none"` regions (the browser skips `user-select: none` elements during `selectAllChildren`).

4. If a `data-td-select="custom"` region is focused (e.g., the user is working in a CodeMirror editor), the `selectAll` action is delegated to the custom component's responder, which handles it internally (e.g., CodeMirror's own select-all).

This integrates with the existing action vocabulary: `selectAll` is already defined in the responder chain's action table (concept 4), and `copy`, `cut`, `pasteAsPlainText`, and `useSelectionForFind` all depend on the selection being correctly scoped to a card.

#### Autoscroll During Selection Drag {#selection-autoscroll}

When a card's content area has `overflow: auto` and the user drags to select text near the scroll edge, the content must autoscroll smoothly.

**Native behavior:** The browser provides autoscrolling for `overflow: auto` containers natively — when the user drags to select near the top or bottom edge, the container scrolls automatically. This works in WebKit/Safari and is the preferred mechanism.

**Required implementation:**

1. **`overscroll-behavior: contain`** on the card content area — prevents scroll from chaining to the parent (canvas), which would cause the entire canvas to scroll when the user drags past the bottom of a card's content.

2. **RAF-based autoscroll in SelectionGuard.** Pointer-clamped clipping actively breaks native browser autoscroll: when SelectionGuard clamps the pointer to the card boundary and calls `selection.extend()`, the browser never sees the pointer leave the scrollable area, so it never triggers its native autoscroll. Since we break it, we must replace it. SelectionGuard implements a `requestAnimationFrame`-based autoscroll during clamped selection drag:

```typescript
// SelectionGuard autoscroll — required because pointer clamping breaks native autoscroll
const EDGE_SIZE_PX = 40;
const MAX_SCROLL_SPEED = 20;

function autoScrollTick(boundary: HTMLElement, pointerY: number) {
  const rect = boundary.getBoundingClientRect();
  const topEdge = rect.top + EDGE_SIZE_PX;
  const bottomEdge = rect.bottom - EDGE_SIZE_PX;

  if (pointerY < topEdge) {
    const speed = Math.round(MAX_SCROLL_SPEED * (1 - (pointerY - rect.top) / EDGE_SIZE_PX));
    boundary.scrollTop -= speed;
  } else if (pointerY > bottomEdge) {
    const speed = Math.round(MAX_SCROLL_SPEED * (1 - (rect.bottom - pointerY) / EDGE_SIZE_PX));
    boundary.scrollTop += speed;
  }
}
```

The autoscroll uses distance-based acceleration: scroll speed increases as the pointer gets closer to the edge. The RAF loop continues as long as the pointer stays in the edge zone, even if the pointer stops moving. After each scroll tick, SelectionGuard re-clamps and re-extends the selection to track the newly visible content.

#### Selection Styling {#selection-styling}

Selection highlight colors are theme-aware via CSS custom properties:

```css
.tugcard-content ::selection {
  background: var(--td-selection-bg);
  color: var(--td-selection-text);
}
```

New tokens added to the semantic tier:

| Token | Purpose | Default derivation |
|-------|---------|-------------------|
| `--td-selection-bg` | Selection highlight background | `color-mix(in srgb, var(--td-accent) 40%, transparent)` |
| `--td-selection-text` | Selected text foreground | `var(--td-text)` |

These are appearance-zone tokens — theme switches update them for free via the CSS cascade, with zero re-renders.

#### Selection State in the Three-Zone Model {#selection-zones}

| Aspect | Zone | Mechanism |
|--------|------|-----------|
| Selection highlight rendering | Appearance | CSS `::selection` pseudo-element, `--td-*` tokens |
| Active boundary tracking | Appearance | SelectionGuard singleton, refs, event handlers |
| Selection range clipping | Appearance | `Selection.setBaseAndExtent()`, `selection.extend()` |
| Autoscroll during drag | Appearance | `requestAnimationFrame` + `scrollTop` mutation |
| `selectAll` action routing | Local data | Responder chain action dispatch |
| Clipboard operations | Local data | Responder chain `copy`/`cut` actions + Clipboard API |

No React state is involved in any selection operation. Selection is entirely an appearance-zone concern, managed imperatively by SelectionGuard and the browser's CSS cascade.

#### What Each Card Type Needs {#card-type-selection}

| Card Type | Content Selection | `data-td-select` Usage |
|-----------|------------------|----------------------|
| Hello (static text) | Default (`text`) | None needed — standard text selection |
| Terminal | `custom` on xterm.js container | xterm.js manages its own selection model |
| Code/Conversation | `text` default, `all` on code output blocks | `none` on toolbar buttons, `custom` on CodeMirror editor, `all` on output pre blocks |
| Git | `text` on branch/commit info | `none` on action buttons and status icons |
| Files | `text` on file names/paths | `none` on action buttons and tree expand/collapse controls |
| Settings | `none` on most | `text` on labels and descriptions |
| Stats | `text` on metric values | `none` on gauge/sparkline visualizations |
| About | Default (`text`) | Standard text selection |

#### What Concept 14 Establishes {#c14-demonstrates}

1. **Three-layer selection containment** — CSS prevention for non-content areas, JavaScript SelectionGuard for runtime clipping, developer API for fine-grained content control. No single web platform feature solves selection containment; the three layers together provide complete coverage. ([#d34-three-layer-selection](#d34-three-layer-selection))
2. **SelectionGuard is a singleton outside React** — follows the same imperative pattern as ResponderChainManager. High-frequency selection events are handled synchronously without React re-renders. Selection is purely an appearance-zone concern. ([#d35-guard-singleton](#d35-guard-singleton))
3. **Pointer-clamped clipping for zero-flash containment** — during drag selection, pointer coordinates are clamped to the card boundary and `caretPositionFromPoint` finds the nearest text position at the edge. This provides smooth, continuous containment without visual flash. RAF-based autoscroll replaces the native autoscroll that pointer-clamping breaks. ([#d36-pointer-clamping](#d36-pointer-clamping))
4. **Four select modes** — `text` (default), `none` (non-selectable), `all` (atomic), `custom` (embedded component manages selection, including contenteditable). Card authors declare intent via `data-td-select` attributes. The `custom` mode is explicitly verified with contenteditable regions. ([#d37-select-modes](#d37-select-modes))
5. **Cmd+A scoped via responder chain** — `selectAll` routes through the key pipeline to the focused card's responder, which calls `selectAllChildren` on the card's content area. Integrated with existing copy/cut/find actions. ([#d38-scoped-selectall](#d38-scoped-selectall))
6. **Selection persistence infrastructure** — `saveSelection` and `restoreSelection` methods on SelectionGuard serialize and restore selection state per card via DOM tree paths and offsets. Phase 5b tab switching uses this to retain selection across tab changes. ([#d35-guard-singleton](#d35-guard-singleton))

### 15. Keybindings View {#c15-keybindings}

**Status: DEFERRED**

**The problem.** Currently the only keyboard shortcut is `Control+\` for panel cycling. We need a view to display and configure keybindings.

**Questions to resolve (when revisited):**
- Is this a card (like settings) or a modal dialog?
- Can users customize keybindings, or is this display-only?
- How do keybindings interact with the responder chain? The responder chain should be the mechanism that routes keyboard events to the correct handler.
- What keybindings do we need beyond panel cycling? Card-specific shortcuts? Global shortcuts? Command palette?

### 16. Brio Theme Revision {#c16-brio}

**Status: DEFERRED**

**The problem.** Brio's current palette is deep graphite. The request is to shift it to dark greenish.

**Depends on:** Theme architecture (concept 1). If themes become loadable resources, this is just a new theme file. If themes remain in CSS, it's a token value change.

---

## Dependency Map

```
                    ┌──────────────────────┐
                    │  1. Theme Architecture│
                    │  (loadable resources) │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  2. Tugways Design   │
                    │  System Definition   │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
   ┌──────────▼──────┐  ┌──────▼──────┐  ┌──────▼──────────┐
   │ 4. Responder    │  │ 5. Mutation │  │ 3. TugButton    │
   │    Chain        │  │    Model    │  │    (test case)  │
   └──────────┬──────┘  └─────┬───────┘  └─────────────────┘
              │               │
              └───────┬───────┘
                      │
           ┌──────────▼───────────┐
           │  6. Tugcard Base     │
           │  Component           │
           └──────────┬───────────┘
                      │
        ┌─────────────┼─────────────┬─────────────┐
        │             │             │             │
   ┌────▼────┐  ┌─────▼─────┐  ┌───▼───┐  ┌─────▼─────┐
   │ 7. Feed │  │ 8. Motion │  │ 9. Di-│  │10. Title  │
   │ Abstrac.│  │ & Visual  │  │ alogs │  │    Bar    │
   └─────────┘  │ Continuity│  └───────┘  └───────────┘
                └───────────┘

   ┌─────────┐  ┌───────────┐  ┌─────────────┐
   │11. Dock │  │12. Card   │  │14. Selection│
   │ Redesign│  │    Tabs   │  │    Model    │
   └─────────┘  └───────────┘  └─────────────┘

   ┌─────────────┐  ┌───────────┐  ┌─────────────┐
   │13. Card Snap│  │15. Key-   │  │16. Brio     │
   │    Sets     │  │  bindings │  │  Revision   │
   └─────────────┘  └───────────┘  └─────────────┘
```

Concepts 12 (Card Tabs) depends on concept 6 (Tugcard). Concept 13 (Card Snap Sets) is
independent — it modifies the geometric engine's activation, not the design system stack.
Concept 14 (Selection Model) depends on concepts 4 (Responder Chain), 5 (Mutation Model),
and 6 (Tugcard) — the selection guard uses appearance-zone mutation patterns, integrates with
the responder chain for `selectAll`/`copy`/`cut` actions, and is wired into Tugcard via a hook.
Concepts 15–16 can proceed independently once the core stack (1-6) is designed.

---

## Discussion Log

*This section will capture key decisions, alternatives considered, and rationale as we work through the concept areas above.*

### Entry 1: Project Kickoff {#log-1} (2026-03-01)

Opened with the full feature list above. Identified 13 concept areas (later expanded to 14) that need design work before implementation. The core architectural challenge is the responder chain + mutation model (concepts 4-5), which determines how everything else gets wired together. The theme architecture (concept 1) is the stated starting point, but it pulls in the component system (concepts 2-3) and the card abstraction (concept 6) because theme changes must flow through all of those layers.

### Entry 2: Theme Architecture — Initial Design {#log-2} (2026-03-01)

Worked through all six original questions for concept 1. Initially proposed JSON as the theme format with direct property injection via `style.setProperty()`. Identified three open items: complex CSS tokens (shadows, gradients) that don't fit cleanly in flat JSON; per-theme semantic overrides (`--td-header-active`, `--td-canvas`); and the Harmony canvas color special case.

### Entry 3: Theme Architecture — Format Revised to CSS {#log-3} (2026-03-01)

The three open items from entry 2 exposed a flaw in the JSON recommendation. Complex CSS values (multi-part shadows, gradients) are native CSS — putting them in JSON means round-tripping CSS through JSON for no benefit. Revised to **CSS as the theme format**: a theme file is a CSS file with `body { --tways-*: ... }` declarations plus a structured comment header for metadata.

Additional decisions in this revision:

- **Prefix rename: `--tl-` → `--tways-`.** The old "tuglook" prefix is renamed to avoid any potential conflict with Tailwind's `--tw-` prefix. Four letters is fine — clarity beats brevity.
- **CSS format resolves the complex token problem.** Shadows, gradients, and any other complex CSS values work natively. No escaping, no special cases.
- **Optional palette entries resolve the semantic override problem.** Tokens like `canvas`, `header-active`, `header-inactive` become optional `--tways-*` entries. The semantic tier derives them from other palette values by default using `var()` with fallback (e.g., `--td-canvas: var(--tways-canvas, var(--tways-bg))`). Themes that want to diverge just specify the value; themes that don't, omit it.
- **Canvas color: no special mechanism.** Harmony just specifies `--tways-canvas` in its theme file. The semantic tier uses it if present, falls back to `--tways-bg` if not. Same pattern for all optional overrides.
- **Stylesheet injection replaces both body classes and property injection.** Load theme CSS, inject as `<style>` element. Remove it to revert to Brio. Simpler than iterating keys.

Next: move to concept 2 (Tugways design system definition).

### Entry 4: Tugways Design System Designed {#log-4} (2026-03-01)

Worked through all four questions for concept 2. Key decisions:

- **Tug wrappers are substantial.** Not cosmetic — they encapsulate subtypes (push, icon, icon+text, three-state for buttons), additional states (disabled, loading, active), semantic color mapping, theme-awareness, and responder chain integration.
- **Strong opinions.** shadcn's variant set is a starting point. Tugways components define their own variants that cover the actual needs of the app.
- **Three component kinds:** wrappers (shadcn + opinions), compositions (multiple shadcn → higher-level), and originals (no shadcn equivalent).
- **File organization:** `components/tugways/` is the public API; `components/ui/` is private implementation. App code never imports from `ui/` directly.
- **Don't reinvent — customize.** shadcn provides accessible primitives and Radix behavior; tugways adds opinions, subtypes, and conventions on top.

Open items resolved in follow-up: priority list of 15 components after TugButton; single-component-with-subtype-prop as default naming (break out on a case-by-case basis); the `tugways/` directory itself is the inventory — no manifest.

Next: concept 3 (TugButton test case).

### Entry 5: Responder Chain Drafted {#log-5} (2026-03-01)

Skipped concept 3 (TugButton) to design concept 4 (Responder Chain) first — TugButton's behavior depends on how the chain works. Researched Apple's NSResponder/UIResponder chain in depth. Key design decisions:

- **Chain structure:** focused tugways component → card content → TugCard → DeckCanvas → TugApp. Each level corresponds to a real architectural boundary.
- **Four-stage key processing pipeline** (adapted from Apple): global shortcuts (top-down, pre-chain) → keyboard navigation (system-level) → action dispatch via chain (bottom-up) → text input (first responder only). Stages have clear priority ordering.
- **First responder = focused card.** One at a time. Key events and nil-targeted actions start from the focused card's deepest registered responder.
- **Modal boundaries constrain the chain.** App-modal confines to dialog chain. Card-modal confines within card. No per-component modal logic.
- **Action validation** — chain is queried lazily ("can anyone handle `find`?") to enable/disable dock buttons and menu items.
- **Operates outside React state.** The chain is an imperative system: stable manager object provided via context (reference never changes, no re-renders), components register via `useResponder` hook using refs, action dispatch is function calls. This is the key to avoiding React state cascades.

Open questions resolved in follow-up: `useResponder` finds parent via nested context; mouse events excluded (hit-testing only, per Apple's model); the responder chain IS the focus model (deck-manager informs it, doesn't compete with it); action vocabulary designed from Apple's standard actions, filtered to tugdeck needs (~25 standard actions across 8 categories, plus extensibility for card-specific actions).

Remaining open items resolved: keybinding map deferred to concept 14 (chain only knows actions, not keys); action validation adopts Apple's two-level model (`canHandle` for capability, `validateAction` for enabled state) — decades of battle-tested usage.

Concept 4 is fully designed. No open items.

### Entry 7: Concept 5 Deepened {#log-7} — Specific Machinery (2026-03-01)

Requested more specifics on the exact mechanisms for the three-zone model. Researched `useSyncExternalStore` gotchas, CSS custom property patterns, refs best practices, signals landscape, React Compiler v1.0, common anti-patterns, and real-world precedents (Excalidraw, Dockview, Figma).

Key additions to concept 5:

- **DOM utility hooks** (`useCSSVar`, `useDOMClass`, `useDOMStyle`): a small set of hooks that make appearance-zone mutations ergonomic. These are the sanctioned way to change how something looks without React state. For high-frequency updates (drag, resize), bypass even these — use `requestAnimationFrame` + refs directly, sync to React state only on gesture completion.
- **`useSyncExternalStore` gotchas codified**: snapshot reference instability (must return same reference if data unchanged), subscribe function identity (must be stable, defined outside component), and selective subscription (use `useSyncExternalStoreWithSelector` or per-feed listener sets).
- **Store decision: start raw, adopt library if needed.** Raw `useSyncExternalStore` is sufficient for feed data. Jotai's atomic model is the fallback if complexity grows.
- **Five structure-zone rules codified**: state at lowest common ancestor; split contexts by domain; never derive state in effects; never define components inside components; avoid inline object creation in JSX props.
- **React Compiler v1.0**: removes need for manual `useMemo`/`useCallback`/`memo`, but doesn't solve state placement, context instability, or the appearance-zone problem. Safety net, not substitute.
- **Excalidraw as architectural precedent**: React for UI chrome, imperative canvas for rendering, Scene class as mutable source of truth, Jotai for UI state, action system for user input mediation. Directly parallel to tugdeck's architecture.

### Entry 8: Excalidraw Deep Study {#log-8} (2026-03-01)

Conducted a thorough architectural study of Excalidraw (MIT, open source). Key findings for tugdeck:

**Adopt:** Their action system (unifies keyboard, toolbar, context menu, command palette into one `Action` interface with `perform`/`keyTest`/`predicate` — maps directly to our responder chain actions). CSS variables for theming. AppState subset types as render firewalls. 8 separate contexts instead of 1. Imperative for high-frequency, React for structure.

**Adapt:** The giant 395KB class component centralizes state but is a lock-in — we use functional components with the responder chain for coordination instead. Scene class as mutable source of truth — we use `useSyncExternalStore` for the same subscription pattern. In-place mutation for hot paths + immutable copies for history.

**Avoid:** Focus management between imperative and React surfaces is fragile (deferred blur hacks, `setTimeout(0)`). State subset discipline is essential — every field must go in the right subset. Don't underutilize your external store library — be intentional from the start about what goes where.

The action system is the pattern most directly applicable to our responder chain design. Excalidraw's `perform`/`keyTest`/`predicate`/`PanelComponent` maps to our `actions`/keybinding map/`canHandle`+`validateAction`/tugways component.

### Entry 6: Controlled Mutation vs. React State Designed {#log-6} (2026-03-01)

The fear: we're fighting an opinionated framework. The realization: we're not fighting it — we're scoping it. React is good at rendering UI from data. The DOM and CSS are good at visual state. The mistake is putting visual state in React state.

The design distills to a **three-zone model**:

1. **Appearance zone** (theme, focus, animations, layout, scroll) — CSS variables, CSS classes, DOM style manipulation. **Zero re-renders.** This is the biggest win: the entire category of changes that causes cascade re-renders in typical React apps never touches React at all.
2. **Local data zone** (feed data, form values, component-internal state) — React state local to the component that displays it, or `useSyncExternalStore` for external data with selective subscriptions. **Targeted re-renders** — only the affected component.
3. **Structure zone** (show/hide sections, mount/unmount cards, open/close modals) — React state at the appropriate ancestor level. **Subtree re-renders** — this is what React is designed for.

The three-zone model makes the answer to "should I use React state?" mechanical, not a judgment call. Each change maps to exactly one zone based on what it affects. The existing systems (theme/concept 1, responder chain/concept 4, deck-manager layout engine) are all already in the appearance zone — operating outside React state by design.

`useSyncExternalStore` is the key React-sanctioned pattern for the local data zone: external mutable stores with selective subscriptions. Feed data, responder chain validation, connection status — all fit this pattern. Each consumer subscribes to its slice. Only affected components re-render.

No open items.

### Entry 9: Tugcard Base Component Designed {#log-9} (2026-03-01)

Designed concept 6 after studying all 8 existing card implementations, the CardFrame/CardHeader chrome, CardContext, ReactCardAdapter, and DeckCanvas rendering hub.

Key decisions:

- **Composition pattern.** Tugcard is a wrapper component, not a base class. Card authors compose their content into `<Tugcard>` as children.
- **Hooks for data, not render props.** The Excalidraw study confirmed hooks over render props. Tugcard gates the child mount — children only render after feed data arrives, so `useTugcardData()` always returns populated data, never null. Feedless cards (`feedIds={[]}`) mount immediately; `useTugcardData()` returns null but those cards never call it.
- **CardFrame stays.** It handles positioning, sizing, drag, resize, z-index. Tugcard lives inside CardFrame and handles chrome, responder chain, feed, loading/error, accessories. Clean separation — neither knows about the other's domain.
- **Dynamic min-size.** Header + accessories + child's declared `minContentSize`. Recalculates when accessories appear/disappear. CardFrame reads Tugcard's computed minimum instead of its hardcoded `MIN_SIZE_PX = 100`.
- **One accessory slot.** Top, between header and content area. Find-in-text is the first use case. Collapses to zero height when null.
- **Tugcard is a responder node.** Handles standard card actions (close, minimize, toggleMenu, find). Delegates card-specific actions to the child's responder.
- **Loading and error handled by Tugcard.** Skeleton until first feed frame; error boundary wraps child. Card authors get both for free.
- **Clean cutover migration.** All 8 existing cards are sketches. Migrate all at once, eliminate `ReactCardAdapter`, `CardContextProvider`, `useCardMeta`, and per-card `useFeed` + decode boilerplate in a single pass.

No open items.

### Entry 10: Feed Abstraction Reframed {#log-10} + UI-Flash Prevention Added (2026-03-01)

**Concept 7 rewritten three times.** First pass: thin summary of tug-feed.md, "see the other doc." Second pass: proper frontend rendering story with event-to-visual mapping, mutation zone assignment, and transport options. Third pass incorporated critical corrections:

- **Transport: tugcast, not a new server.** The second pass proposed `tugcode feed serve` or a "separate WebSocket/SSE channel" — both nonsensical given that tugcast already exists as the single WebSocket server bridging all feeds to tugdeck. Tugcast's binary framing protocol, authentication, heartbeat, reconnection, and per-client state management are all in place. The tug-feed is just another `FeedId` (`0x50`) registered in the protocol, with a `StreamFeed` implementation that tails `feed.jsonl`. Fixed in both `design-system-concepts.md` and `tug-feed.md` (Phase 4 rewritten to reference tugcast).
- **Three accumulation patterns identified.** Snapshot (latest value wins — Git, Stats), append-stream (events accumulate — Files, Conversation, feed-progress), and raw stream (pass-through — Terminal). Accumulation is card-specific, but two helpers support the append-stream pattern: `useFeedBuffer` (capped ring buffer for simple cases) and `useFeedStore` (external mutable store with structured indexing for complex cases like the feed-progress card).
- **Per-card data feeds: Tugcard is sufficient.** Reviewed all 8 existing cards through Tugcard's `feedIds`/`decode`/`useTugcardData()` lens. Every card type is covered — no additional `TugFeed` abstraction needed.
- **Interface-first implementation.** Define TypeScript types for the 13 event types, implement the frontend card with mock data, bring the backend online later.

**Concept 14 added: UI-Flash Prevention.** Three scenarios cause visual flash (CSS edit, frontend reload, backend restart). Root cause analysis and three-layer fix detailed in `roadmap/eliminate-frontend-flash.md`. Layers: inline body styles (eliminate white flash), startup overlay (hide mount transition), CSS HMR boundary (prevent full reloads for CSS changes). Concept 14 is nearly independent of the core stack — it's infrastructure-level work that can be implemented at any time. The only connection to the design system is that Layer C (HMR boundary) affects how base CSS changes propagate during development; runtime theme injection (concept 1) bypasses the Vite module graph entirely.

### Entry 11: TugButton Designed — Composition Model {#log-11} (2026-03-02)

Designed concept 3 after a key clarification: the "never define components inside components" rule from concept 5 was causing confusion about how buttons (which are always children of larger compositions) could work. The clarification: `define` ≠ `use`. Components are standalone module-scope definitions. You compose them by importing and nesting JSX — the fundamental React pattern.

Key decisions:

- **[D07] Module-scope components, compose via JSX nesting.** Every component is defined at module scope (in its own file). No component functions defined inside other component functions. Composition happens through JSX nesting — `<ThemeSection>` renders `<TugButton>` elements, `<SettingsContent>` renders `<ThemeSection>`, `<Tugcard>` renders `<SettingsContent>`. The containment hierarchy is just nested imports.
- **[D08] Two button modes: direct-action and chain-action.** Direct-action buttons have an `onClick` handler — no responder chain involvement. Chain-action buttons have an `action` prop — they dispatch into the responder chain and auto-validate via `canHandle`/`validateAction`. Most buttons are direct-action; chain-action is for toolbar and menu scenarios.
- **Three ambient connection mechanisms.** Components connect to the system through (1) CSS custom properties for theme, (2) React context for the responder chain, (3) props and callbacks for data. No tight coupling between layers. TugButton doesn't know it's inside a Tugcard.
- **Mutation zone assignment explicit for TugButton** — appearance (CSS pseudo-classes for hover/focus/active, theme colors from `var(--td-*)`), local data (chain validation via `useSyncExternalStore`), structure (conditional rendering by parent). This pattern will be documented for every tugways component.
- **TugButton API designed** — subtypes (push, icon, icon-text, three-state), variants (primary, secondary, ghost, destructive), chain-action mode, loading state. Wraps shadcn's `Button` internally but exposes a restricted, opinionated API.
- **Pattern established for all tugways components** — module-scope definition, wraps shadcn internally, theme via CSS variables, responder chain via context, mutation zones documented, subtypes via prop.

No open items. Concept 3 is fully designed.

### Entry 12: Concept 8 Unified — Motion and Visual Continuity {#log-12} (2026-03-02)

Merged three previously separate concerns — skeleton/loading states (old concept 8), UI-flash prevention (old concept 14), and a new transitions/animations story — into a single unified concept. The unifying insight: these are all aspects of **how tugdeck manages visual state changes over time.**

Researched motion systems across Material Design 3, Carbon (IBM), Norton DS, Cloudscape (AWS), Apple HIG, Radix, and shadcn/ui. Key findings that shaped the design:

- **MD3 and Carbon publish motion tokens as structured values** (duration tiers, easing curves by behavior type). We adopted this as CSS custom properties following our `--td-*` convention.
- **Norton DS's duration scalar pattern** — a single `--td-duration-scalar` multiplier that zeros out all durations for `prefers-reduced-motion`. Elegant: one variable swap, all motion stops. We use `0.001` instead of `0` so Radix's `animationend` events still fire.
- **Radix's `data-state` + CSS `@keyframes`** is already in our stack via shadcn. No need for Framer Motion or React Spring for standard component transitions. Critical constraint: Radix's Presence component listens for `animationend`, not `transitionend` — exit animations must use `@keyframes`.
- **Apple's "replace, don't remove" principle** for reduced motion — spatial animations become opacity fades, not nothing.

Key decisions:
- **[D23] Motion tokens as CSS custom properties.** Four durations (fast/moderate/slow/glacial) and three easings (standard/enter/exit). Intentionally minimal — tugdeck is a dev tool, not a consumer app.
- **[D24] Reduced motion via scalar, not removal.** `calc(var(--td-duration-scalar) * var(--td-duration-*))` pattern. Spatial animations replaced with opacity fades when scalar is active.
- **Skeleton shimmer uses `background-attachment: fixed`** so all skeleton elements shimmer in unison across the viewport.
- **Skeleton → content crossfade** is an appearance-zone animation (CSS class swap, opacity transition). No React state for the animation itself.
- **Old concept 14 absorbed** — the three-layer startup continuity approach (inline body styles, startup overlay, CSS HMR boundary) is now a subsection of concept 8 rather than a standalone concept.

Concept count reduced from 14 to 13. No open items in concept 8.

### Entry 13: Concept 9 Designed — Alert and Dialog System {#log-13} (2026-03-02)

Designed concept 9 after researching Apple's AppKit/UIKit modal APIs in depth. The core challenge: AppKit's `runModal(for:)` blocks the calling code via a nested run loop. JavaScript can't do this. The solution: block the *responder chain*, not the thread.

Researched `NSApplication.runModal(for:)`, `NSWindow.beginSheet()`, `NSAlert` (styles, buttons, presentation modes), `UIAlertController` (action styles, preferred action), `NSPopover`, SwiftUI `confirmationDialog`, Radix Dialog/AlertDialog/Popover, the native `<dialog>` element with `showModal()`, the `inert` attribute, and Sonner for toasts.

Key decisions:

- **[D25] Four modal categories.** TugAlert (app-modal, chain blocked), TugSheet (card-modal, card node suspended), TugConfirmPopover (button-local, no chain impact), TugToast (non-blocking, no chain impact). Each maps to a specific Apple mechanism.
- **[D26] Button-confirmation is a popover, not a sheet or alert.** The user specified: "a simple popup graphically tied to a button that compels the user to move their mouse and click again." This is lighter than a card-modal sheet — no chain suspension, no focus trapping, no backdrop dimming. Snappy micro-interaction.
- **Imperative API for alerts and sheets.** `tugAlert()` and `tugSheet()` return Promises, inspired by `NSAlert.runModal()` returning `ModalResponse`. The imperative API wraps declarative React components (host pattern: `TugAlertHost` at app root, `TugSheetHost` inside each Tugcard).
- **Radix AlertDialog for app-modal** (prevents overlay-click dismissal), **scoped Dialog for card-modal** (portal targets card container, manual `inert` scoping), **Radix Popover for button confirmation** (anchored, collision-aware, transient dismiss).
- **Button roles from `UIAlertAction.Style`**: destructive (red, never default), cancel (bold, responds to Enter/Escape), default (standard). When destructive is present, cancel is always the default — matching Apple HIG.
- **Sonner for toasts** — already in the shadcn ecosystem. Live region accessibility, never steals focus, theme-aware via `--td-*` tokens.

Card-modal scoping (TugSheet) is the most complex implementation: Radix doesn't support subtree-scoped modality natively. We diverge from Radix defaults here, applying `inert` to the card's content area only and rendering the portal inside the card container. This is justified because cards are independent workspaces — blocking the entire app for a card-level concern violates the model.

No open items. Concept 9 is fully designed.

### Entry 14: Concept 10 Designed — Card Title Bar Enhancements {#log-14} (2026-03-02)

Three small, well-scoped changes with straightforward designs. Read the existing `card-header.tsx` and `card-frame.tsx` to confirm the plumbing is already in place — `showCollapse`, `onCollapse`, `collapsible` all exist but are currently inactive.

Key decisions:

- **[D27] Window-shade collapse to title bar.** Content hidden via CSS (`overflow: hidden`, height transition to 0), not unmounted. Card internal state (terminal session, scroll position, form values) preserved. `collapsed: boolean` added to `CardState` for persistence. Chevron icon (ChevronDown/ChevronUp) replaces the ambiguous Minus icon. Double-click on header as secondary gesture.
- **Close confirmation uses TugConfirmPopover** from concept 9 — first real consumer of the button-confirmation pattern. Always-confirm for now; can differentiate by unsaved-state later.
- **Menu icon: `EllipsisVertical` → `Ellipsis`** — one-line import change. Horizontal three-dot is more standard on web.

Collapse animation uses concept 8's motion tokens (`--td-duration-moderate`, `--td-easing-standard`). Title bar button order confirmed: [menu] [collapse] [close] — already correct in existing code.

No open items. Concept 10 is fully designed.

### Entry 15: Concept 11 Designed — Dock Redesign {#log-15} (2026-03-02)

Read the existing `dock.tsx` to understand the current structure. The dock is already well-structured — six card toggle buttons, a settings dropdown (which is already a popout menu), a spacer, and a logo. The redesign formalizes what's there and adds flexibility.

Key decisions:

- **[D28] Three button types: card toggle, command, popout menu.** Same 32×32 visual treatment, different click behavior. Declared in a config array, not hardcoded. Command buttons are for future test-case triggers.
- **[D29] Dock placement on any edge.** Right (default), left, top, bottom. Canvas inset adjusts. Menu direction and tooltip side auto-flip based on placement. Flexbox direction switches between `flex-col` (vertical) and `flex-row` (horizontal).
- **Dock is not a responder.** Never participates in the chain. No `useResponder`, no action validation. Pure direct-interaction chrome. Triggers chain-affecting actions indirectly (e.g., card toggle changes first responder).
- **Tooltips on every button.** Radix Tooltip already in project. `delayDuration={400}`, `skipDelayDuration={100}`. Side opposite dock edge.
- **Commands stay in settings dropdown.** Reset layout, restart server, reload frontend remain where they are. No dedicated dock buttons for these.

No open items. Concept 11 is fully designed.

### Entry 16: Concepts 12-13 Designed — Card Tabs and Snap Sets {#log-12} (2026-03-02)

Two missing concepts identified and designed:

**Concept 12: Card Tabs.** The data model (`TabItem`, `CardState.tabs`, `CardState.activeTabId`) already exists in `layout-tree.ts` and a `tab-bar.tsx` already renders tabs — but both are entangled with the old `ReactCardAdapter`/`TugCard` infrastructure demolished in Phase 0. The redesign makes tabs a Tugcard composition feature:

- **[D30] Tab bar hidden for single-tab cards.** Most cards are single-tab. The tab bar only appears when `tabs.length > 1`. No visual overhead in the common case.
- **[D31] Tabs are a Tugcard feature, not a CardFrame feature.** Tugcard manages tab state, renders the tab bar, and switches content. CardFrame is unaware — it wraps one Tugcard that internally manages however many tabs it has.
- **Responder chain follows active tab.** Tab switching is automatic via mount/unmount — old tab's content responder deregisters, new tab's content responder registers.
- **Same-type and mixed-type tabs supported.** Two terminals in one frame, or a terminal + code card sharing a frame. Each tab is a `TabItem` with its own `componentId`.

**Concept 13: Card Snap Sets.** The geometric engine (`snap.ts`) is solid. The behavioral change: snapping is no longer always-on.

- **[D32] Snap requires Option (Alt) modifier during drag.** Without the modifier: free drag, no guides, no snapping. With the modifier: snap guides appear, cards snap to edges, sets form on drop. The modifier can be pressed/released mid-drag with immediate visual feedback.
- **[D33] Set-move is always active once formed.** Sets are intentional structures — requiring Option for every set-move would be tedious. The modifier is only for *forming* sets.
- **Geometric engine untouched.** The modifier gate lives in `DeckManager`'s drag handler, not in `snap.ts`. Pure geometry library stays pure.

Deferred concepts renumbered: Keybindings View → 14, Brio Theme Revision → 15. Concept count is now 15.

### Entry 17: Concept 14 Designed — Selection Model {#log-13} (2026-03-03)

Phase 5 implementation revealed a critical selection problem: the browser treats all card content as a single document flow, allowing text selection to span across cards, through title bars, and across the canvas background. Visible in manual testing — dragging from one card's content area into another produces a cross-card selection spanning unrelated content and chrome elements.

Thorough web platform research revealed that the CSS property designed for this (`user-select: contain`) was never implemented in any modern browser (only old IE supported it as `-ms-user-select: element`). Shadow DOM does not prevent selection crossing in WebKit/Safari. iframes provide true isolation but are too heavyweight. CSS `overflow` and `contain` have no effect on selection boundaries.

The viable approach is a three-layer system built on the JavaScript Selection API:

- **[D34] Three-layer selection containment.** CSS `user-select: none` on all non-content areas prevents selection from starting in the wrong place. JavaScript SelectionGuard clips selection at runtime when it tries to escape a card boundary. A `data-td-select` attribute API gives card authors fine-grained control within content areas.
- **[D35] SelectionGuard is a singleton, not React state.** Follows the same imperative pattern as ResponderChainManager. Selection events fire at very high frequency during drag; synchronous handling is essential. Selection containment is purely an appearance-zone concern with zero React re-renders.
- **[D36] Pointer-clamped clipping via caretPositionFromPoint.** During drag selection, when the pointer exits the card boundary, coordinates are clamped to the boundary edge and `document.caretPositionFromPoint()` finds the nearest text position. This produces smooth, continuous containment with no visual flash — the selection never visually escapes the card.
- **[D37] Four select modes.** `data-td-select` attribute with values: default (text), `none` (non-selectable controls), `all` (atomic selection for code blocks), `custom` (embedded component like xterm.js or CodeMirror manages its own selection). The guard respects these modes.
- **[D38] Cmd+A scoped to focused card.** The `selectAll` responder action calls `selectAllChildren` on the focused card's content area. Integrated with existing copy/cut/find actions in the responder chain action vocabulary.

Also designed: theme-aware selection styling via `--td-selection-bg` and `--td-selection-text` tokens, RAF-based autoscroll (required because pointer-clamping breaks native autoscroll), `overscroll-behavior: contain` to prevent scroll chaining, and `saveSelection`/`restoreSelection` methods on SelectionGuard for tab switch persistence (Phase 5b). The `custom` select mode explicitly covers contenteditable regions. Multi-card clipboard coordination is a non-issue — the platform clipboard handles cross-card copy/paste natively.

Deferred concepts renumbered: Keybindings View → 15, Brio Theme Revision → 16. Concept count is now 16.
