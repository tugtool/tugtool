## Phase 1.0: Retronow Style System Redesign {#phase-retronow-style}

**Purpose:** Replace tugdeck's ad-hoc VS Code Monokai aesthetic with the retronow design language (Brio theme default), build a complete three-tier semantic token system, add a dock rail on the right viewport edge, and eliminate all raw colors from component CSS.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | -- |
| Last updated | 2025-02-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tugdeck currently has a two-tier CSS token system in tokens.css with a VS Code Monokai-derived palette and semantic layer, plus three component CSS files (panels.css, cards.css, deck.css). The visual language is generic dark editor chrome with system fonts (-apple-system, BlinkMacSystemFont). Hardcoded colors -- raw hex values and rgba() literals -- are scattered throughout component styles. There is no theme switching, no dock, and no design system coherence.

The retronow project has a fully-developed design language with three themes (Harmony/Default light, Bluenote dark, Brio deep graphite), eight named accent colors, IBM Plex Sans + Hack font stack, comprehensive spacing/radius scales, and an instrument-panel aesthetic. Theme switching works via body class. This design language should be ported to tugdeck to replace the ad-hoc styling with a proper system.

#### Strategy {#strategy}

- Rewrite tokens.css as a three-tier system: palette (raw retronow --rn-* values) -> semantic (--td-* purpose-driven tokens) -> component (per-component tokens derived from semantic in their own files)
- Embed all three themes (Brio default, Bluenote, Harmony) as body-class selectors inside tokens.css -- no separate theme files, no build.rs changes for themes
- Download IBM Plex Sans and Hack font files to tugdeck/styles/fonts/ for local serving -- no CDN imports, no CSP changes needed
- Rewrite panels.css and cards.css to reference only --td-* semantic tokens, eliminating every raw hex/rgba value
- Replace TugMenu with a Dock rail component on the right viewport edge; canvas container shrinks by 48px to accommodate
- Delete deck.css (dead code since floating panel system) and its build.rs copy step
- Preserve all TypeScript logic unchanged except: (a) dock.ts replaces tug-menu.ts, (b) main.ts wires Dock, (c) terminal-card.ts gains theme reactivity (re-reads CSS tokens on theme change, uses --td-font-mono instead of hardcoded Menlo stack)

#### Stakeholders / Primary Customers {#stakeholders}

1. tugdeck end users (visual quality, theme choice)
2. tugdeck developers (maintainable token system, no raw colors to manage)

#### Success Criteria (Measurable) {#success-criteria}

- Zero hardcoded hex colors or raw rgba() values in panels.css or cards.css (verified by grep)
- All three themes (Brio, Bluenote, Harmony) switchable via body class with correct palette values from retronow-tokens.css
- Dock rail renders at 48px on the right edge with icon buttons for all five card types plus a settings dropdown
- IBM Plex Sans and Hack fonts load from local files (no external requests)
- `bun test` passes with dock.test.ts providing superset coverage of tug-menu.test.ts (24 scenarios per List L01)
- `bun build` succeeds with no errors
- Theme switching updates all mounted terminal cards immediately (xterm theme colors react to body class change)

#### Scope {#scope}

1. Complete rewrite of tokens.css with three-tier token architecture and three embedded themes
2. Complete rewrite of panels.css replacing all raw colors/fonts with --td-* tokens
3. Complete rewrite of cards.css replacing all raw colors/fonts with --td-* tokens
4. New dock.ts + dock.css replacing TugMenu with right-edge dock rail
5. Deletion of deck.css and its build.rs copy step
6. Updated index.html (CSS imports, font loading, body class, deck-container width)
7. Updated main.ts (dock wiring instead of TugMenu)
8. Updated build.rs (remove deck.css copy, add dock.css copy)
9. New dock.test.ts as superset of tug-menu.test.ts (24 scenarios)
10. Local font files in tugdeck/styles/fonts/
11. Runtime theme reactivity in terminal-card.ts (re-read CSS tokens on theme change, use --td-font-mono)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing TypeScript logic in panel-manager.ts, floating-panel.ts, snap.ts, tab-bar.ts, card-header.ts, or card content implementations (git-card.ts, files-card.ts, stats-card.ts, conversation-card.ts) beyond what is required for theme reactivity
- Adding new card types or changing card content structure
- Modifying the binary protocol, connection, or serialization format
- Supporting runtime theme file loading or dynamic CSS injection
- Responsive/mobile layout changes
- Dock accessibility features (tooltips, aria-labels, keyboard navigation for icon buttons) -- deferred to a follow-on; see Roadmap

#### Dependencies / Prerequisites {#dependencies}

- Retronow source CSS at /u/src/retronow/styles/ (retronow-tokens.css, retronow-components.css, retronow-deck.css) for exact palette values and component style reference
- IBM Plex Sans and Hack font files downloadable for local serving
- Lucide icons (already a dependency in tugdeck)

#### Constraints {#constraints}

- CSP policy in index.html restricts styles to 'self' and 'unsafe-inline' -- local font files satisfy this; CDN imports would not
- Bun bundles only JS; CSS files are copied separately by build.rs
- All existing panel drag/resize/snap/set behavior must continue working -- CSS changes must not break layout geometry

#### Assumptions {#assumptions}

- deck.css is dead code and will be deleted along with its build.rs copy step
- TypeScript logic in panel-manager.ts, floating-panel.ts, snap.ts, tab-bar.ts, card-header.ts, and card content implementations (git-card.ts, files-card.ts, stats-card.ts, conversation-card.ts) stays unchanged except for terminal-card.ts which gains theme reactivity per [D09]
- The canvas container width adjustment (calc(100% - 48px)) will be applied in CSS or index.html, not in TypeScript
- The set-flash-overlay animation colors will be replaced with semantic tokens
- The Shiki CSS variable bridge tokens will be updated to map through the new --td-syntax-* tokens. Note: Shiki is currently hardcoded to 'github-dark' theme in code-block.ts, so the bridge tokens are preparatory for a future switch to css-variables theme. They are defined for forward compatibility but are not actively consumed by Shiki today.
- The --rn-* palette values come from the retronow project at /u/src/retronow/styles/retronow-tokens.css
- Several retronow tokens are intentionally not mapped to --td-* equivalents because tugdeck does not use them: --rn-bg-line, --rn-panel-ink, --rn-surface-screen, --rn-surface-screen-ink, --rn-accent-strong, --rn-glow, --rn-line-ui, --rn-shadow-hard, --rn-shadow-mid, --rn-track-bg. They are still defined in Tier 1 (palette) for completeness but have no Tier 2 semantic mapping. --rn-depth-inset and --rn-depth-screen could be useful for future enhancements (e.g., inset fields, screen-style readouts) and are noted in Roadmap.
- **Brio is the canonical default theme.** No body class = Brio. The :root selector in tokens.css defines Brio palette values. body.td-theme-bluenote and body.td-theme-Harmony override those values. There is no body.td-theme-brio class -- absence of a theme class IS Brio.

**Runtime Token Contracts (hard constraint):** {#runtime-token-contracts}

Any CSS custom property that is read by JavaScript at runtime via getComputedStyle/getPropertyValue MUST have a working definition in the rewritten tokens.css. These are not just CSS styling tokens -- they are runtime API contracts. Known consumers:

| Consumer | Token(s) Read | Method |
|----------|---------------|--------|
| stats-card.ts | --chart-1, --chart-2, --chart-3 | getCSSToken() at SubCard construction |
| terminal-card.ts | --background, --foreground | getComputedStyle at mount() |

The token rewrite must define legacy aliases (--chart-1 through --chart-5, --background, --foreground) or update the TypeScript to read the new --td-* names. This plan uses both strategies: legacy --chart-* aliases (no TS change for stats-card), and updated token names in terminal-card.ts (--td-bg, --td-text, --td-font-mono) combined with theme change listener per [D09].

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Three-tier token architecture with --td-* namespace (DECIDED) {#d01-token-architecture}

**Decision:** Adopt a three-tier token system: Tier 1 palette (--rn-* raw retronow values), Tier 2 semantic (--td-* purpose-driven), Tier 3 component (--td-panel-*, --td-tab-* etc. derived from Tier 2). Components reference only --td-* tokens. The --td- prefix distinguishes tugdeck tokens from retronow's --rn- prefix.

**Rationale:**
- Retronow palette values are the source of truth for the design language; redefining them under a different prefix would create drift
- The semantic layer gives tugdeck its own vocabulary (--td-bg, --td-panel, --td-text) mapped to retronow values
- The component tier is optional per-component and keeps complex overrides (e.g. header gradients) out of the global namespace

**Implications:**
- tokens.css defines all three tiers in a single file
- No component CSS file may use raw hex, rgb(), rgba(), or --rn-* tokens -- only --td-* tokens
- color-mix() with --td-* tokens is allowed for hover/transparency effects

---

#### [D02] Brio theme as canonical default -- no body class = Brio (DECIDED) {#d02-brio-default}

**Decision:** Brio palette values are the :root defaults. There is no body.td-theme-brio class. The absence of any theme class on the body element IS the Brio theme. Bluenote and Harmony are activated by adding body.td-theme-bluenote or body.td-theme-Harmony respectively. Switching back to Brio means removing any theme class from the body. All three themes are defined within tokens.css via :root and body-class selectors.

**Rationale:**
- Brio's deep graphite aesthetic matches tugdeck's dark-mode-first design
- "No class = default" is the simplest and most robust pattern -- no risk of a missing class breaking the default theme
- Single-file approach (all themes in tokens.css) avoids dynamic CSS loading and build.rs complexity
- Body class switching is the standard pattern used by retronow itself

**Implications:**
- :root defines --rn-* values matching body.rn-theme-brio from retronow-tokens.css
- Theme switching stores selection in localStorage ("td-theme" key: "brio" | "bluenote" | "Harmony") and applies/removes the body class. For "brio", all td-theme-* classes are removed.
- The dock settings dropdown provides the theme switcher UI

---

#### [D03] Local font files instead of CDN imports (DECIDED) {#d03-local-fonts}

**Decision:** Download IBM Plex Sans (wght 400,500,600,700) and Hack font files to tugdeck/styles/fonts/ and declare @font-face rules in tokens.css. No Google Fonts or cdnjs imports.

**Rationale:**
- The existing CSP restricts style-src to 'self' and 'unsafe-inline' -- CDN font imports would require CSP changes
- Local files eliminate external network dependencies and load-time variance
- Self-contained deployment is simpler

**Implications:**
- @font-face declarations in tokens.css point to relative paths in fonts/
- build.rs must copy the fonts/ directory to the output
- --td-font-sans and --td-font-mono reference the @font-face family names

---

#### [D04] Dock rail replaces TugMenu on right viewport edge (DECIDED) {#d04-dock-rail}

**Decision:** Replace the TugMenu floating button with a 48px-wide vertical dock rail fixed to the right edge of the viewport. The dock contains lucide icon buttons for each card type (Conversation, Terminal, Git, Files, Stats), a settings gear icon with dropdown (Reset Layout, theme switcher, version info), and the Tug logo at the bottom.

**Rationale:**
- A dock rail provides persistent, discoverable access to card creation and settings
- Right edge placement keeps the left side clear for content-focused panels
- The TugMenu button is small and easy to miss; the dock is always visible

**Implications:**
- New dock.ts class replacing TugMenu, new dock.css for styling
- Canvas container width: calc(100% - 48px) to make room for the dock
- main.ts wires Dock instead of TugMenu
- tug-menu.test.ts is deleted and replaced by dock.test.ts

---

#### [D05] Delete deck.css as dead code (DECIDED) {#d05-delete-deck-css}

**Decision:** Remove deck.css and its build.rs copy step. The disconnect banner styles move into panels.css.

**Rationale:**
- The CSS Grid layout in deck.css was replaced by the floating panel system; it is dead code
- The only live style in deck.css is the disconnect banner, which belongs with panel chrome in panels.css

**Implications:**
- deck.css file deleted from tugdeck/styles/
- build.rs deck.css copy block removed
- index.html no longer references deck.css (it was already not referenced)
- Disconnect banner styles added to panels.css

---

#### [D06] Single-file themes with body-class selectors (DECIDED) {#d06-single-file-themes}

**Decision:** All three theme definitions (Brio :root default, Bluenote body class, Harmony body class) live inside tokens.css. No separate theme-*.css files.

**Rationale:**
- Simpler than managing three extra files and their build.rs copy steps
- Matches the user's explicit preference ("Single file -- all three themes as body-class selectors inside tokens.css. No build.rs changes for theme files.")
- Retronow itself uses this pattern in retronow-tokens.css

**Implications:**
- tokens.css is the single source of truth for all palette values across all themes
- No dynamic stylesheet loading needed -- just toggle body class
- File size increase is minimal (theme overrides are just custom property reassignments)

---

#### [D07] Replace tug-menu.test.ts with dock.test.ts as superset (DECIDED) {#d07-replace-tests}

**Decision:** Delete tug-menu.test.ts and create dock.test.ts that covers ALL behavioral tests currently in tug-menu.test.ts PLUS new dock-specific tests. This is a superset, not a rename -- tug-menu.test.ts tests PanelManager behaviors (addNewCard, feed fan-out, resetLayout, orphan cleanup, layout persistence, serialization) that must be preserved, plus TugMenu-specific tests that are replaced by dock equivalents.

**Rationale:**
- TugMenu class is being deleted; its tests become invalid
- tug-menu.test.ts contains critical PanelManager behavioral tests (not just TugMenu UI tests) that must survive the migration
- The dock introduces new behavior (theme switching, settings dropdown) that needs additional test coverage

**Implications:**
- dock.test.ts is strictly larger than tug-menu.test.ts in test count
- All PanelManager behavioral tests from tug-menu.test.ts are ported verbatim (with TugMenu references updated to Dock)
- New dock-specific tests are added on top
- See List L01 in the Dock Component Specification for the exhaustive test scenario list

---

#### [D08] Settings icon in dock with full menu (DECIDED) {#d08-dock-settings}

**Decision:** Add a gear/settings icon button to the dock that opens a dropdown menu containing: Add Conversation, Add Terminal, Add Git, Add Files, Add Stats (separator), Reset Layout (separator), Theme submenu with Brio/Bluenote/Harmony select (separator), About tugdeck. This is the TugMenu item set plus theme switching, consolidated into the dock settings gear.

**Rationale:**
- User explicitly requested "Settings icon -- add a gear/settings icon button to dock that opens dropdown with Reset Layout and version info"
- The dock icon buttons provide quick single-click card creation; the settings menu provides the same actions in a discoverable list alongside utility actions
- Theme switching belongs in settings since it is a persistent preference

**Implications:**
- The settings dropdown reuses the existing DropdownMenu component from card-menu.ts
- Theme selection is a "select" menu item type with three options
- localStorage key for theme: "td-theme"
- Menu item order mirrors TugMenu for familiarity, with theme and about appended

---

#### [D09] Runtime theme application to all mounted cards (DECIDED) {#d09-runtime-theme}

**Decision:** When the user switches themes via the dock settings, all mounted cards must update to reflect the new theme immediately. This requires a theme change notification mechanism. A MutationObserver on document.body watches for class attribute changes. When a theme class change is detected, the Dock dispatches a custom "td-theme-change" event on document. Cards that read CSS tokens at mount time (specifically TerminalCard, which passes --background/--foreground to xterm's Terminal constructor, and fontFamily from a hardcoded Menlo stack) must listen for this event and re-read the tokens to update their internal state.

**Rationale:**
- Theme switching that only updates CSS custom properties will update all CSS-driven styling automatically, but JavaScript-captured values (like xterm theme colors passed at construction time) become stale
- TerminalCard reads --background and --foreground via getComputedStyle at mount time and passes them to xterm Terminal options.theme -- these are frozen values that do not track CSS changes
- TerminalCard also hardcodes fontFamily to "'Menlo', 'Monaco', 'Courier New', monospace" instead of reading the semantic font token

**Implications:**
- Dock.ts sets up a MutationObserver on document.body for class changes and dispatches "td-theme-change" custom event on document
- TerminalCard.mount() reads --td-bg and --td-text (replacing --background/--foreground) for xterm theme, and reads --td-font-mono resolved value for fontFamily
- TerminalCard listens for "td-theme-change" on document, re-reads CSS tokens, and calls terminal.options to update theme and fontFamily
- StatsCard sparkline colors are read once from CSS tokens via getCSSToken(); sparklines will pick up new colors on next data render cycle since getCSSToken() reads live computed values. No explicit listener needed for StatsCard.
- This is a targeted TypeScript change to terminal-card.ts, scoped to theme reactivity -- it does not change card content structure or logic

---

#### [D10] Zero raw colors in component CSS -- hard rule (DECIDED) {#d10-zero-raw-colors}

**Decision:** Panels.css and cards.css must contain zero raw hex colors (#xxxxxx), zero raw rgb()/rgba() values, and zero raw hsl()/hsla() values. Every color, shadow, and transparency effect must go through --td-* tokens or color-mix() with --td-* tokens. This is a hard rule enforced by grep in step checkpoints, not a guideline.

**Rationale:**
- Raw colors break theme switching because they do not respond to CSS custom property changes
- A hard rule is easier to enforce than a soft guideline -- grep catches violations mechanically
- color-mix(in srgb, var(--td-text) 8%, transparent) is the approved pattern for hover/transparency effects that need computed opacity

**Implications:**
- Any hover background, box-shadow, or subtle effect that currently uses rgba() must be rewritten using color-mix() with semantic tokens
- Gradients in component CSS must use --td-* tokens as color stops (e.g., linear-gradient(180deg, var(--td-surface) 0%, var(--td-surface-tab) 100%))
- The grep checkpoint `grep -rn 'rgba\|#[0-9a-fA-F]' tugdeck/styles/panels.css tugdeck/styles/cards.css` must return zero matches

---

### 1.0.1 Token Mapping Specification {#token-mapping}

**Table T01: Surface Token Mapping** {#t01-surface-tokens}

| Semantic Token (--td-*) | Retronow Source (--rn-*) | Purpose |
|--------------------------|--------------------------|---------|
| --td-bg | --rn-bg | Canvas background |
| --td-bg-soft | --rn-bg-soft | Elevated canvas areas |
| --td-panel | --rn-panel | Panel chrome |
| --td-panel-soft | --rn-panel-soft | Panel recessed areas |
| --td-surface | --rn-surface-1 | Window chrome |
| --td-surface-tab | --rn-surface-2 | Tab bar background |
| --td-surface-control | --rn-surface-3 | Control rails |
| --td-surface-content | --rn-surface-4 | Card content areas |

**Table T02: Text Token Mapping** {#t02-text-tokens}

| Semantic Token | Retronow Source | Purpose |
|----------------|-----------------|---------|
| --td-text | --rn-text | Primary text |
| --td-text-soft | --rn-text-soft | Secondary/muted text |
| --td-text-inverse | --rn-text-inverse | Text on accent backgrounds |

**Table T03: Accent and Status Token Mapping** {#t03-accent-tokens}

| Semantic Token | Retronow Source | Purpose |
|----------------|-----------------|---------|
| --td-accent | --rn-accent | Primary accent (orange) |
| --td-accent-cool | --rn-accent-cool | Secondary accent (cyan) |
| --td-accent-1 through --td-accent-8 | --rn-accent-1 through --rn-accent-8 | Full 8-color palette |
| --td-success | --rn-accent-5 | Green status |
| --td-warning | --rn-accent-6 | Yellow status |
| --td-danger | --rn-accent-4 | Red status |
| --td-info | --rn-accent-2 | Cyan info |
| --td-chart-1 | --td-accent-5 | Sparkline color: CPU/Memory (green) |
| --td-chart-2 | --td-accent-2 | Sparkline color: Token Usage (cyan) |
| --td-chart-3 | --td-accent-6 | Sparkline color: Build Status (yellow) |
| --td-chart-4 | --td-accent-4 | Sparkline color: reserved (red) |
| --td-chart-5 | --td-accent-3 | Sparkline color: reserved (purple) |

**Table T04: Border, Depth, Spacing, Radius, Typography Tokens** {#t04-utility-tokens}

| Semantic Token | Retronow Source | Purpose |
|----------------|-----------------|---------|
| --td-border | --rn-border | Primary border |
| --td-border-soft | --rn-border-soft | Soft border |
| --td-shadow-soft | --rn-shadow-soft | Soft shadow |
| --td-depth-raise | --rn-depth-raise | Raised element shadow |
| --td-space-1 through --td-space-6 | --rn-space-1 through --rn-space-6 | 2/4/6/8/12/16px |
| --td-radius-xs/sm/md/lg | --rn-radius-xs/sm/md/lg | 2/4/6/8px |
| --td-font-sans | --rn-font-sans | IBM Plex Sans stack |
| --td-font-mono | --rn-font-mono | Hack stack |
| --td-line-tight | --rn-line-tight | 1.2 line-height |
| --td-line-normal | --rn-line-normal | 1.45 line-height |

**Table T05: Syntax Highlighting Token Mapping** {#t05-syntax-tokens}

| Semantic Token | Retronow Source | Purpose |
|----------------|-----------------|---------|
| --td-syntax-keyword | --rn-accent-2 | Cyan keywords |
| --td-syntax-string | --rn-accent-8 | Coral strings |
| --td-syntax-number | --rn-accent-5 | Green numbers |
| --td-syntax-function | --rn-accent-6 | Yellow functions |
| --td-syntax-type | --rn-accent-5 | Green types |
| --td-syntax-variable | --rn-accent-2 | Cyan variables |
| --td-syntax-comment | --rn-text-soft | Muted comments |
| --td-syntax-operator | --td-text | Operator punctuation (inherits text color) |
| --td-syntax-punctuation | --td-text | Brackets, parens, etc. (inherits text color) |
| --td-syntax-constant | --rn-accent-2 | Cyan constants |
| --td-syntax-decorator | --rn-accent-3 | Purple decorators |
| --td-syntax-tag | --rn-accent-2 | Cyan HTML/XML tags |
| --td-syntax-attribute | --rn-accent-2 | Cyan attributes |

**Table T06: Old Token to New Token Migration** {#t06-migration-map}

| Old Token (--*) | New Token (--td-*) | Notes |
|------------------|--------------------|-------|
| --background | --td-bg | Canvas background |
| --foreground | --td-text | Primary text |
| --card | --td-panel | Panel chrome (was misnamed "card") |
| --card-foreground | --td-text | Panel text |
| --muted | --td-surface-control | Control/recessed areas |
| --muted-foreground | --td-text-soft | Secondary text |
| --popover | --td-surface-control | Popup background |
| --popover-foreground | --td-text | Popup text |
| --border | --td-border | Primary border |
| --border-muted | --td-border-soft | Soft border |
| --input | --td-border | Input border |
| --primary | --td-accent | Primary action color |
| --primary-foreground | --td-text-inverse | Text on accent |
| --accent | --td-accent-cool | Accent highlights (was blue, now cyan) |
| --accent-foreground | --td-bg | Text on accent |
| --success | --td-success | Green status |
| --warning | --td-warning | Yellow status |
| --destructive | --td-danger | Red status |
| --info | --td-info | Cyan info |
| --ring | --td-accent-cool | Focus ring |
| --radius | --td-radius-md | Default radius |
| --radius-sm | --td-radius-sm | Small radius |
| --radius-lg | --td-radius-lg | Large radius |
| --chart-1 | --td-chart-1 | Sparkline color 1 (stats-card.ts getCSSToken reads at runtime) |
| --chart-2 | --td-chart-2 | Sparkline color 2 (stats-card.ts getCSSToken reads at runtime) |
| --chart-3 | --td-chart-3 | Sparkline color 3 (stats-card.ts getCSSToken reads at runtime) |
| --chart-4 | --td-chart-4 | Sparkline color 4 (reserved) |
| --chart-5 | --td-chart-5 | Sparkline color 5 (reserved) |
| --syntax-keyword | --td-syntax-keyword | Syntax: keywords |
| --syntax-string | --td-syntax-string | Syntax: strings |
| --syntax-number | --td-syntax-number | Syntax: numbers |
| --syntax-function | --td-syntax-function | Syntax: functions |
| --syntax-type | --td-syntax-type | Syntax: types |
| --syntax-variable | --td-syntax-variable | Syntax: variables |
| --syntax-comment | --td-syntax-comment | Syntax: comments |
| --syntax-operator | --td-syntax-operator | Syntax: operators |
| --syntax-punctuation | --td-syntax-punctuation | Syntax: punctuation |
| --syntax-constant | --td-syntax-constant | Syntax: constants |
| --syntax-decorator | --td-syntax-decorator | Syntax: decorators |
| --syntax-tag | --td-syntax-tag | Syntax: HTML/XML tags |
| --syntax-attribute | --td-syntax-attribute | Syntax: attributes |

---

### 1.0.2 Retronow Visual Mapping {#visual-mapping}

**Table T07: Component Visual Mapping** {#t07-visual-mapping}

| Tugdeck Element | Retronow Source | Styling Notes |
|-----------------|-----------------|---------------|
| Panel header bar | .rn-titlebar gradient | Gradient from dark to slightly lighter, mono uppercase label |
| Panel header title | .rn-titlebar-label | Mono, 0.67rem, uppercase, 0.08em tracking |
| Tab bar | .rn-tabstrip + .rn-tab | Dark bg with tabs that have rounded top corners |
| Panel border | .rn-border-soft | 1px solid, --td-border-soft |
| Panel body | .rn-surface-1 / .rn-surface-4 | Surface-1 for chrome, surface-4 for content |
| Buttons (send, allow) | .rn-button gradient | Yellow-to-orange gradient for primary actions |
| Input fields | .rn-field | Surface-4 bg, soft border, mono font |
| Dropdown menus | .rn-popup | Surface-1 bg, mono uppercase |
| Tool cards | .rn-screen | Bordered readout with tone-based border color |
| Code blocks | .rn-scrollbox | Surface-4 content bg |
| Branch badge | .rn-chip | Mono, small, uppercase |
| Status colors | 8-accent system | Green=success, yellow=warning, red=danger, cyan=info |
| Key panel tint | .rn-accent | Orange accent tint instead of blue |
| Dock buttons | .rn-icon-btn | 24x24, border, gradient bg, accent color icon |
| Set flash overlay | .rn-accent-1 | Orange accent border and glow instead of blue |

---

### 1.0.3 Dock Component Specification {#dock-spec}

**Spec S01: Dock Layout and Behavior** {#s01-dock-layout}

The dock is a 48px-wide vertical rail fixed to the right edge of the viewport, outside the panel canvas.

```
+--------------------------------------+------+
|                                      |      |
|         Panel Canvas                 | Dock |
|    (calc(100% - 48px) wide)          | 48px |
|                                      |      |
+--------------------------------------+------+
```

**Dock contents (top to bottom):**
1. Card-type icon buttons (one per type): Conversation (message-square), Terminal (terminal), Git (git-branch), Files (folder), Stats (bar-chart-2)
2. Spacer (flex-grow)
3. Settings gear icon button (opens dropdown -- see menu spec below)
4. Tug logo at bottom

**Settings dropdown menu items (in order):**
1. Add Conversation (action -> PanelManager.addNewCard("conversation"))
2. Add Terminal (action -> PanelManager.addNewCard("terminal"))
3. Add Git (action -> PanelManager.addNewCard("git"))
4. Add Files (action -> PanelManager.addNewCard("files"))
5. Add Stats (action -> PanelManager.addNewCard("stats"))
6. -- separator --
7. Reset Layout (action -> PanelManager.resetLayout())
8. -- separator --
9. Theme (select: Brio / Bluenote / Harmony)
10. -- separator --
11. About tugdeck (action -> alert version info)

**Behavior:**
- Clicking a dock card icon calls PanelManager.addNewCard(type) -- quick single-click card creation
- Clicking the settings gear opens a DropdownMenu (reusing card-menu.ts DropdownMenu) with the full menu above
- Theme selection: stores to localStorage key "td-theme" ("brio" | "bluenote" | "Harmony"), applies/removes body class (no class for Brio, body.td-theme-bluenote for Bluenote, body.td-theme-Harmony for Harmony), and dispatches "td-theme-change" custom event on document for runtime listeners
- Dock sets up a MutationObserver on document.body to detect class changes and dispatch "td-theme-change" event
- Dock is z-index 9980 (same as old TugMenu button)
- Dock has no drag/resize interaction -- it is a fixed chrome element
- Dock icon buttons have no tooltips or aria-labels in this phase (accessibility deferred -- see Roadmap)

**List L01: dock.test.ts Required Test Scenarios** {#l01-dock-test-scenarios}

Tests ported from tug-menu.test.ts (PanelManager behavioral tests):
1. addNewCard with registered factory adds a panel to canvasState
2. addNewCard creates panel with correct componentId
3. addNewCard positions panel at canvas center (400x300)
4. addNewCard adds the card to the correct feed dispatch set
5. Two terminal cards simultaneously receive terminal feed frames
6. Frame for feedId not subscribed to by a card is not delivered
7. resetLayout produces exactly 5 panels
8. resetLayout destroys old cards
9. resetLayout clears feed dispatch sets of old cards
10. Layout is saved to localStorage as v4 format
11. serialize produces version:4 format
12. v3 layout in localStorage falls back to buildDefaultLayout

Tests replacing TugMenu-specific tests:
13. Dock element is appended to document.body
14. Dock settings menu does not include Save Layout or preset items
15. Dock settings menu includes Add Conversation, Add Terminal, Add Git, Add Files, Add Stats, Reset Layout, Theme, and About tugdeck items

New dock-specific tests:
16. Dock renders with 5 card-type icon buttons + settings gear + logo
17. Clicking each card icon calls PanelManager.addNewCard with correct type string
18. Settings gear click opens DropdownMenu
19. Theme select updates body class: Bluenote adds body.td-theme-bluenote
20. Theme select updates body class: Harmony adds body.td-theme-Harmony
21. Theme select updates body class: Brio removes all td-theme-* classes
22. Theme selection persists to localStorage "td-theme"
23. Dock reads theme from localStorage on construction and applies body class
24. Dock.destroy() removes dock element and cleans up MutationObserver

---

### 1.0.4 File Inventory {#file-inventory}

**Table T08: Files Created** {#t08-files-created}

| File | Purpose |
|------|---------|
| tugdeck/styles/dock.css | Dock rail styles following retronow .rn-icon-btn aesthetic |
| tugdeck/src/dock.ts | Dock class replacing TugMenu -- icon buttons + settings dropdown |
| tugdeck/src/__tests__/dock.test.ts | Tests for Dock component (replaces tug-menu.test.ts) |
| tugdeck/styles/fonts/*.woff2 | IBM Plex Sans (400,500,600,700) and Hack font files |

**Table T09: Files Modified** {#t09-files-modified}

| File | Changes |
|------|---------|
| tugdeck/styles/tokens.css | Complete rewrite: three-tier tokens, three themes, @font-face rules |
| tugdeck/styles/panels.css | Rewrite: replace all raw colors/fonts with --td-* tokens, add disconnect banner styles, retronow panel aesthetic |
| tugdeck/styles/cards.css | Rewrite: replace all raw colors/fonts with --td-* tokens |
| tugdeck/src/main.ts | Wire Dock instead of TugMenu, import dock.ts |
| tugdeck/src/cards/terminal-card.ts | Read --td-bg, --td-text, --td-font-mono instead of hardcoded values; add theme change listener per [D09] |
| tugdeck/index.html | Update CSS imports (remove deck.css if referenced, add dock.css), inline style updates, set default body class |
| crates/tugcast/build.rs | Remove deck.css copy, add dock.css copy, add fonts/ directory copy |

**Table T10: Files Deleted** {#t10-files-deleted}

| File | Reason |
|------|--------|
| tugdeck/styles/deck.css | Dead code (CSS Grid layout replaced by floating panels) |
| tugdeck/src/tug-menu.ts | Replaced by dock.ts |
| tugdeck/src/__tests__/tug-menu.test.ts | Replaced by dock.test.ts |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Token system rewrite and font setup {#step-0}

**Commit:** `feat(tugdeck): rewrite token system with retronow design language and local fonts`

**References:** [D01] Three-tier token architecture, [D02] Brio default, [D03] Local fonts, [D06] Single-file themes, [D10] Zero raw colors, Tables T01-T06, (#token-mapping, #t01-surface-tokens, #t02-text-tokens, #t03-accent-tokens, #t04-utility-tokens, #t05-syntax-tokens, #t06-migration-map, #runtime-token-contracts)

**Artifacts:**
- Rewritten tugdeck/styles/tokens.css with full three-tier architecture
- New tugdeck/styles/fonts/ directory with IBM Plex Sans and Hack .woff2 files
- @font-face declarations in tokens.css

**Tasks:**
- [ ] Download IBM Plex Sans v1.1.0 woff2 files from https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-sans%401.1.0 -- extract the Web/woff2/ directory and copy these files to tugdeck/styles/fonts/: IBMPlexSans-Regular.woff2 (weight 400), IBMPlexSans-Medium.woff2 (weight 500), IBMPlexSans-SemiBold.woff2 (weight 600), IBMPlexSans-Bold.woff2 (weight 700)
- [ ] Download Hack v3.003 woff2 file from https://github.com/source-foundry/Hack/releases/tag/v3.003 -- extract hack-v3.003-webfonts/hack-regular.woff2 and copy to tugdeck/styles/fonts/hack-regular.woff2
- [ ] Rewrite tokens.css: Tier 1 -- define all --rn-* palette tokens with Brio values as :root defaults (copy exact values from /u/src/retronow/styles/retronow-tokens.css body.rn-theme-brio section)
- [ ] Add body.td-theme-bluenote selector overriding --rn-* with Bluenote values (from retronow-tokens.css body.rn-theme-dark / body.rn-theme-bluenote)
- [ ] Add body.td-theme-Harmony selector overriding --rn-* with Harmony/Default values (from retronow-tokens.css :root)
- [ ] Define Tier 2 -- all --td-* semantic tokens mapping to --rn-* as specified in Tables T01-T04
- [ ] Define syntax highlighting tokens as specified in Table T05
- [ ] Define Shiki CSS variable bridge tokens (--syntax-token-keyword, --syntax-token-string, etc.) mapping through the new --td-syntax-* tokens. Note: Shiki is currently hardcoded to the 'github-dark' theme in code-block.ts, so these bridge tokens are preparatory -- they will enable a future switch to Shiki's css-variables theme but are not consumed by Shiki today. Define them for forward compatibility and to maintain the existing token contract.
- [ ] Define --td-chart-1 through --td-chart-5 tokens mapping to accent colors (Table T03). These are read at runtime by stats-card.ts via getCSSToken("--chart-N") for sparkline rendering. Also define legacy aliases --chart-1 through --chart-5 pointing to --td-chart-1 through --td-chart-5 so that getCSSToken calls continue to resolve without TypeScript changes.
- [ ] Add @font-face declarations for IBM Plex Sans (regular, medium, semibold, bold) and Hack
- [ ] Verify --td-font-sans and --td-font-mono variables reference the correct @font-face family names

**Tests:**
- [ ] Manual: open tugdeck in browser, verify Brio theme renders with correct dark graphite background (#1c1e22)
- [ ] Manual: add body class td-theme-bluenote via devtools, verify background changes to #2a3136
- [ ] Manual: add body class td-theme-Harmony via devtools, verify background changes to #3f474c

**Checkpoint:**
- [ ] `grep -rn 'palette-gray\|palette-blue\|palette-green\|palette-yellow\|palette-red\|palette-orange\|palette-purple' tugdeck/styles/tokens.css` returns zero matches (old palette removed)
- [ ] tokens.css contains all --rn-* palette tokens, all --td-* semantic tokens, --td-chart-1 through --td-chart-5, legacy --chart-1 through --chart-5 aliases, three theme body-class selectors, @font-face declarations
- [ ] Font files exist in tugdeck/styles/fonts/

**Rollback:**
- Revert commit; restore original tokens.css; delete fonts/ directory

**Commit after all checkpoints pass.**

---

#### Step 1: Panels.css rewrite with retronow aesthetic {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): rewrite panels.css with retronow design language and semantic tokens`

**References:** [D01] Token architecture, [D05] Delete deck.css, [D10] Zero raw colors, Table T06, Table T07, (#visual-mapping, #t06-migration-map, #t07-visual-mapping, #d10-zero-raw-colors)

**Artifacts:**
- Rewritten tugdeck/styles/panels.css using only --td-* tokens
- Disconnect banner styles moved from deck.css into panels.css

**Tasks:**
- [ ] Replace all var(--card) with var(--td-panel)
- [ ] Replace all var(--foreground) with var(--td-text)
- [ ] Replace all var(--muted) with var(--td-surface-control)
- [ ] Replace all var(--muted-foreground) with var(--td-text-soft)
- [ ] Replace all var(--border) with var(--td-border)
- [ ] Replace all var(--accent) with var(--td-accent) or var(--td-accent-cool) as contextually appropriate
- [ ] Replace all var(--popover) / var(--popover-foreground) with var(--td-surface-control) / var(--td-text)
- [ ] Replace all var(--destructive) with var(--td-danger)
- [ ] Replace all hardcoded rgba(255, 255, 255, 0.1) hover backgrounds with color-mix(in srgb, var(--td-text) 8%, transparent)
- [ ] Replace box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4) with var(--td-depth-raise)
- [ ] Replace all font-family: -apple-system... with var(--td-font-sans) or var(--td-font-mono) as appropriate
- [ ] Apply retronow titlebar gradient to .panel-header: background gradient from dark to slightly lighter
- [ ] Apply retronow tab styling to .panel-tab-bar and .panel-tab: rounded top corners, --td-surface-tab bg
- [ ] Update .panel-header-key to use orange accent tint: color-mix(in srgb, var(--td-accent) 12%, var(--td-surface-control))
- [ ] Update .set-flash-overlay to use --td-accent for border and orange-tinted glow instead of blue
- [ ] Update .virtual-sash:hover to use color-mix with --td-text
- [ ] Move disconnect banner styles from deck.css into panels.css, replacing raw values with tokens
- [ ] Update .card-dropdown-menu and related styles to use --td-* tokens with retronow .rn-popup aesthetic (mono uppercase)
- [ ] Remove .tug-menu-button and .tug-menu-button:hover CSS rules from panels.css (lines 302-325 in current file) -- these become dead code after TugMenu is replaced by Dock in Step 3. Removing them now during the full rewrite avoids carrying dead rules forward.

**Tests:**
- [ ] Manual: verify panel headers render with gradient background and uppercase mono title
- [ ] Manual: verify tab bar has dark bg with rounded-top-corner tabs
- [ ] Manual: verify set-flash shows orange accent glow instead of blue

**Checkpoint:**
- [ ] `grep -rn 'rgba\|#[0-9a-fA-F]' tugdeck/styles/panels.css` returns zero matches (no raw colors)
- [ ] `grep -rn '\-\-card\b\|\-\-foreground\b\|\-\-muted\b\|\-\-border\b\|\-\-accent\b\|\-\-popover\b\|\-\-destructive\b\|\-\-primary\b' tugdeck/styles/panels.css` returns zero matches (no old tokens)
- [ ] `bun build tugdeck/src/main.ts --outfile=/dev/null` succeeds

**Rollback:**
- Revert commit; restore original panels.css

**Commit after all checkpoints pass.**

---

#### Step 2: Cards.css rewrite with semantic tokens {#step-2}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): rewrite cards.css with semantic tokens and retronow aesthetic`

**References:** [D01] Token architecture, [D10] Zero raw colors, Table T06, Table T07, (#t06-migration-map, #t07-visual-mapping, #d10-zero-raw-colors)

**Artifacts:**
- Rewritten tugdeck/styles/cards.css using only --td-* tokens
- Git and Files card content layout preserved exactly; only colors and fonts changed

**Tasks:**
- [ ] Replace all var(--background) with var(--td-bg)
- [ ] Replace all var(--foreground) with var(--td-text)
- [ ] Replace all var(--card) with var(--td-panel)
- [ ] Replace all var(--card-foreground) with var(--td-text)
- [ ] Replace all var(--muted) with var(--td-surface-control)
- [ ] Replace all var(--muted-foreground) with var(--td-text-soft)
- [ ] Replace all var(--border) with var(--td-border)
- [ ] Replace all var(--accent) with var(--td-accent-cool) (accent highlights)
- [ ] Replace all var(--accent-foreground) with var(--td-bg)
- [ ] Replace all var(--primary) with var(--td-accent) and var(--primary-foreground) with var(--td-text-inverse)
- [ ] Replace all var(--success), var(--warning), var(--destructive), var(--info) with --td-success, --td-warning, --td-danger, --td-info
- [ ] Replace all var(--success-foreground), var(--warning-foreground), var(--destructive-foreground), var(--info-foreground) with var(--td-bg)
- [ ] Replace all var(--ring) with var(--td-accent-cool)
- [ ] Replace all var(--radius), var(--radius-sm), var(--radius-lg) with --td-radius-md, --td-radius-sm, --td-radius-lg
- [ ] Replace all font-family: "Menlo"... with var(--td-font-mono)
- [ ] Replace all font-family: -apple-system... with var(--td-font-sans)
- [ ] Replace all var(--input) with var(--td-border)
- [ ] Apply retronow .rn-chip style to .branch-badge: mono, small, uppercase
- [ ] Apply retronow .rn-button gradient to .send-btn and .approval-prompt-allow: yellow-to-orange gradient
- [ ] Apply retronow .rn-field style to .conversation-input: surface-4 bg, soft border, mono font
- [ ] Apply retronow .rn-screen style to .tool-card: bordered readout aesthetic
- [ ] Preserve all Git card content structure (branch-badge, file-entry, event-entry, etc.) -- only change colors and fonts

**Tests:**
- [ ] Manual: verify Git card renders with correct status colors (green staged, yellow unstaged, cyan info)
- [ ] Manual: verify Files card event icons use correct semantic colors
- [ ] Manual: verify conversation input has surface-4 background and mono font
- [ ] Manual: verify branch badge has retronow chip style (mono uppercase)

**Checkpoint:**
- [ ] `grep -rn 'rgba\|#[0-9a-fA-F]' tugdeck/styles/cards.css` returns zero matches
- [ ] `grep -rn '\-\-background\b\|\-\-foreground\b\|\-\-card\b\|\-\-muted\b\|\-\-border\b\|\-\-accent\b\|\-\-popover\b\|\-\-destructive\b\|\-\-primary\b\|\-\-success\b\|\-\-warning\b\|\-\-info\b\|\-\-ring\b\|\-\-input\b\|\-\-radius\b' tugdeck/styles/cards.css` returns zero matches (no old tokens)
- [ ] `bun build tugdeck/src/main.ts --outfile=/dev/null` succeeds

**Rollback:**
- Revert commit; restore original cards.css

**Commit after all checkpoints pass.**

---

#### Step 3: Dock component, TugMenu replacement, and runtime theme switching {#step-3}

**Depends on:** #step-0, #step-1

**Commit:** `feat(tugdeck): add dock rail with theme switching, replacing TugMenu`

**References:** [D04] Dock rail, [D07] Replace tests (superset), [D08] Dock settings (full menu), [D09] Runtime theme application, Spec S01, List L01, Tables T08-T10, (#dock-spec, #s01-dock-layout, #l01-dock-test-scenarios, #t08-files-created, #t09-files-modified, #t10-files-deleted, #runtime-token-contracts)

**Artifacts:**
- New tugdeck/src/dock.ts (Dock class with theme switching and MutationObserver)
- New tugdeck/styles/dock.css (dock rail styles)
- New tugdeck/src/__tests__/dock.test.ts (superset of tug-menu.test.ts)
- Modified tugdeck/src/cards/terminal-card.ts (theme reactivity, --td-* token reads)
- Deleted tugdeck/src/tug-menu.ts
- Deleted tugdeck/src/__tests__/tug-menu.test.ts

**Tasks:**
- [ ] Create dock.css with styles for the dock rail: 48px width, fixed right edge, flex-column layout, retronow .rn-icon-btn aesthetic for buttons, z-index 9980
- [ ] Create dock.ts with Dock class:
  - Constructor takes PanelManager, creates dock element, appends to document.body (not canvas container)
  - Icon buttons for each card type using lucide icon SVGs (message-square, terminal, git-branch, folder, bar-chart-2)
  - Settings gear button that opens DropdownMenu with full menu: Add Conversation, Add Terminal, Add Git, Add Files, Add Stats, separator, Reset Layout, separator, Theme select (Brio/Bluenote/Harmony), separator, About tugdeck
  - On construction: read localStorage "td-theme" and apply body class (no class for "brio", body.td-theme-bluenote for "bluenote", body.td-theme-Harmony for "Harmony")
  - Theme switching: update localStorage, apply/remove body class, dispatch "td-theme-change" CustomEvent on document
  - MutationObserver on document.body watching for class attribute changes, dispatching "td-theme-change" event
  - Tug logo element at bottom of dock
  - destroy() method: remove dock element, disconnect MutationObserver, clean up event listeners
- [ ] Update tugdeck/src/cards/terminal-card.ts for theme reactivity:
  - In mount(): read --td-bg and --td-text (instead of --background and --foreground) for xterm theme colors
  - In mount(): read resolved value of --td-font-mono for fontFamily (instead of hardcoded "'Menlo', 'Monaco', 'Courier New', monospace")
  - Add "td-theme-change" event listener on document that re-reads --td-bg, --td-text, --td-font-mono and calls terminal.options.theme = { background, foreground } and terminal.options.fontFamily = fontFamily
  - In destroy(): remove the "td-theme-change" event listener
- [ ] Delete tugdeck/src/tug-menu.ts
- [ ] Delete tugdeck/src/__tests__/tug-menu.test.ts
- [ ] Create tugdeck/src/__tests__/dock.test.ts covering all 24 scenarios in List L01:
  - Port all PanelManager behavioral tests from tug-menu.test.ts (scenarios 1-12): addNewCard, feed fan-out, resetLayout, layout persistence, serialization
  - Replace TugMenu-specific tests (scenarios 13-15): dock element appended, no preset items, full settings menu items present
  - Add new dock-specific tests (scenarios 16-24): icon button rendering, card creation via icons, settings gear opens menu, theme class switching (all three themes), localStorage persistence, theme read on construction, destroy cleanup
- [ ] Update tugdeck/src/main.ts: import Dock instead of TugMenu, construct Dock(deck) instead of new TugMenu(deck)

**Tests:**
- [ ] Unit: dock.test.ts -- all 24 scenarios pass
- [ ] Manual: verify dock renders as 48px rail on right edge with all expected icons
- [ ] Manual: switch theme via dock settings, verify terminal card colors update immediately

**Checkpoint:**
- [ ] `bun test` passes with dock.test.ts included and tug-menu.test.ts removed
- [ ] `bun build tugdeck/src/main.ts --outfile=/dev/null` succeeds
- [ ] tugdeck/src/tug-menu.ts no longer exists
- [ ] tugdeck/src/__tests__/tug-menu.test.ts no longer exists
- [ ] Terminal card reads --td-bg and --td-text (not --background/--foreground) -- verify with grep

**Rollback:**
- Revert commit; restore tug-menu.ts, tug-menu.test.ts, original terminal-card.ts; delete dock.ts, dock.css, dock.test.ts

**Commit after all checkpoints pass.**

---

#### Step 4: Build system and HTML integration {#step-4}

**Depends on:** #step-0, #step-1, #step-2, #step-3

**Commit:** `chore(tugdeck): update build system and index.html for style system redesign`

**References:** [D03] Local fonts, [D05] Delete deck.css, [D06] Single-file themes, Tables T08-T10, (#t08-files-created, #t09-files-modified, #t10-files-deleted)

**Artifacts:**
- Modified crates/tugcast/build.rs (remove deck.css copy, add dock.css and fonts/ copy)
- Modified tugdeck/index.html (CSS imports, inline style updates)
- Deleted tugdeck/styles/deck.css

**Tasks:**
- [ ] Delete tugdeck/styles/deck.css
- [ ] Update crates/tugcast/build.rs:
  - Remove the deck.css copy block (lines that copy deck.css to output)
  - Add dock.css copy: copy tugdeck/styles/dock.css to output
  - Add fonts/ directory copy: iterate tugdeck/styles/fonts/*.woff2 and copy each to tugdeck output fonts/ directory
- [ ] Update tugdeck/index.html:
  - Add `<link rel="stylesheet" href="dock.css">` after panels.css link
  - Update inline `<style>` for body: replace var(--background) with var(--td-bg) for background
  - Update #deck-container width to calc(100% - 48px) to accommodate dock
  - Verify CSS link order: tokens.css, app.css, cards.css, panels.css, dock.css

**Tests:**
- [ ] Integration: `cargo build` succeeds (build.rs copies all required files)
- [ ] Manual: verify all CSS files are present in build output directory

**Checkpoint:**
- [ ] `cargo build 2>&1` completes without error
- [ ] tugdeck/styles/deck.css does not exist
- [ ] `grep -rn 'deck\.css' crates/tugcast/build.rs` returns zero matches
- [ ] build output contains: tokens.css, app.css, cards.css, panels.css, dock.css, fonts/*.woff2

**Rollback:**
- Revert commit; restore deck.css; restore original build.rs and index.html

**Commit after all checkpoints pass.**

---

#### Step 5: Integration testing and polish {#step-5}

**Depends on:** #step-4

**Commit:** `test(tugdeck): integration verification for retronow style system`

**References:** [D01] Token architecture, [D02] Brio default, [D04] Dock rail, [D09] Runtime theme, [D10] Zero raw colors, (#success-criteria, #runtime-token-contracts)

**Artifacts:**
- Any final CSS tweaks discovered during integration testing
- Verified end-to-end: all three themes, dock, panels, cards, fonts

**Tasks:**
- [ ] Run full test suite: `cd tugdeck && bun test`
- [ ] Run full build: `cargo build`
- [ ] Manual integration test: launch tugdeck, verify Brio theme renders correctly
- [ ] Manual integration test: switch to Bluenote via dock settings, verify all panels/cards update
- [ ] Manual integration test: switch to Harmony via dock settings, verify light theme renders
- [ ] Manual integration test: refresh page, verify theme persists from localStorage
- [ ] Manual integration test: click each dock icon, verify new panel of correct type is created
- [ ] Manual integration test: verify dock settings Reset Layout works
- [ ] Manual integration test: verify Git card content renders correctly with new tokens
- [ ] Manual integration test: verify Files card content renders correctly with new tokens
- [ ] Manual integration test: verify conversation card input, messages, tool cards, code blocks render correctly
- [ ] Manual integration test: verify set-flash overlay shows orange accent
- [ ] Manual integration test: verify panel drag, resize, snap, and shared-edge resize still work
- [ ] Manual integration test: open a Terminal panel, switch theme to Bluenote, verify terminal background/foreground update immediately without remounting
- [ ] Manual integration test: verify terminal font is Hack (from --td-font-mono) not Menlo
- [ ] Manual integration test: verify Stats card sparklines render with colored lines (--chart-1/2/3 aliases work)
- [ ] Fix any visual issues discovered during integration testing

**Tests:**
- [ ] Unit: `bun test` -- all tests pass
- [ ] Integration: `cargo build` succeeds

**Checkpoint:**
- [ ] `bun test` passes with zero failures
- [ ] `cargo build` succeeds
- [ ] `grep -rn 'rgba\|#[0-9a-fA-F]' tugdeck/styles/panels.css tugdeck/styles/cards.css` returns zero matches (no raw colors in component CSS)
- [ ] All three themes render correctly when toggled via dock settings

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tugdeck renders with the retronow design language (Brio default), a complete semantic token system, three switchable themes, a dock rail on the right viewport edge, local fonts, and zero raw colors in component CSS.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero hardcoded hex colors or raw rgba() values in panels.css or cards.css (grep verification)
- [ ] All three themes (Brio, Bluenote, Harmony) switch correctly via dock settings with palette values matching retronow-tokens.css
- [ ] Dock rail renders at 48px on right edge with 5 card-type icons + settings gear + logo
- [ ] IBM Plex Sans and Hack fonts load from local .woff2 files
- [ ] `bun test` passes (dock.test.ts replaces tug-menu.test.ts)
- [ ] `cargo build` succeeds
- [ ] deck.css and tug-menu.ts are deleted
- [ ] All panel operations (drag, resize, snap, set, tab, close) work unchanged
- [ ] Theme switching updates all mounted cards including terminal (xterm theme colors change immediately)
- [ ] Stats card sparklines render with colored lines (runtime token aliases work)

**Acceptance tests:**
- [ ] Unit: `bun test` -- all tests pass including dock.test.ts (24 scenarios per List L01)
- [ ] Integration: `cargo build` succeeds with no warnings
- [ ] Manual: visual inspection of all three themes
- [ ] Manual: dock interaction (card creation via icons and settings menu, theme switching)
- [ ] Manual: terminal theme reactivity (switch theme with terminal open, verify immediate color update)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Animated theme transitions (crossfade when switching)
- [ ] Additional themes beyond the three retronow defaults
- [ ] Per-panel theme overrides (e.g. light theme for conversation, dark for terminal)
- [ ] Responsive dock (collapse to icons-only at narrow viewports)
- [ ] Custom scrollbar styling matching retronow .rn-scrollbox
- [ ] Dock accessibility: add tooltips, aria-labels, and keyboard navigation for icon-only dock buttons (explicitly deferred from this phase)
- [ ] Map --rn-depth-inset and --rn-depth-screen to --td-* semantic tokens for inset fields and screen-style readouts
- [ ] Switch Shiki from hardcoded 'github-dark' to css-variables theme to activate the bridge tokens
- [ ] Theme-reactive sparkline colors in StatsCard (re-read getCSSToken on theme change for live color updates)

| Checkpoint | Verification |
|------------|--------------|
| Token system complete | tokens.css has three tiers, three themes, @font-face, runtime aliases |
| Component CSS clean | grep for raw colors returns zero matches in panels.css and cards.css |
| Dock operational | 5 card icons + settings menu + theme switching + card creation all work |
| Runtime theme | Terminal card colors update immediately on theme switch |
| Build green | `cargo build` and `bun test` (24 dock scenarios) both pass |
| Visual fidelity | All three themes match retronow palette values |

**Commit after all checkpoints pass.**
