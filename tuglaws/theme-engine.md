# Theme System (CSS-First)

*The theme runtime is CSS-first and file-based.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [tuglaws.md](tuglaws.md).*

---

## Source Of Truth

Theme data lives in checked-in CSS files:

| File | Role |
|---|---|
| `tugdeck/styles/themes/<name>.css` | Theme source (complete token declarations) |
| `tugdeck/styles/tug-active-theme.css` | Active theme copy (complete theme, never empty) |

Shipped themes (registered in `SHIPPED_THEME_NAMES`, `tugdeck/src/action-dispatch.ts`):

| Theme | Mode | Tint | Accent |
|---|---|---|---|
| `brio` | dark | indigo-violet | orange |
| `nocturne` | dark | cobalt | cyan |
| `bravura` | dark | plum | magenta |
| `harmony` | light | indigo | orange |
| `aria` | light | rose | amber |
| `vivace` | light | teal | cyan |

Every theme is a peer — none depends on another at runtime. `brio` is special only as
`BASE_THEME_NAME` (the bundled base; see `tugdeck/src/theme-constants.ts`). Each theme is a
complete, hand-authored CSS file defining the full token vocabulary.

---

## Tinted-Neutral Authoring Doctrine

Every theme is **one tint hue over a shared tone skeleton** — the "predominant tint colors the
details without a redesign" model. The engine (`--tug-color(hue, i:, t:)`, OKLCH) makes a new theme
largely a hue swap: keep the *tone* ladder, change the *hue*.

1. **One tint hue per theme** for all `--tug7-surface-global-primary-*` neutrals (and the neutral
   text/icon/border/divider families). Surfaces differ by **tone only**; intensity stays in a tight
   low band (dark ≈ i:2–6, light ≈ i:3–8). Tone carries elevation, not hue.
2. **Monotonic elevation ladder.** Dark: deeper base, lighter raised/overlay. Light: lighter base
   (content/raised/overlay near white), darker recessed wells (sunken/inset). No hue jumps, no
   dark-surface-in-a-light-theme surprises. `screen` (tooltips, dev panel) is the lone exception in
   light themes — it stays light because tooltips render *default* text, not inverse.
3. **Signals are fixed across themes** by hue: `danger`=red, `success`=green, `caution`=yellow/gold,
   `data`=teal, `agent`=violet, plus the `active`/`link`/`selection` blue axis. Only the **tint** and
   the **accent/focus** hue change per theme. Choose an accent distinct from every signal hue (the
   orange→magenta warm arc is safe) and from the blue selection axis.
4. **Signal tuning is per-mode.** Dark: bright, mid-tone, saturated. Light: darker and more saturated
   so a mark holds contrast on near-white. Saturated light hues (orange/yellow/teal) can't reach 3:1
   on white without turning muddy — that is an accepted light-theme tension, the mirror of dark
   themes' dark-on-dark limits.
5. **Consistent authoring style** (uniform `i:`/`t:` usage) so themes diff cleanly and the next tint
   swap stays mechanical.

A new theme: copy the same-mode reference (brio for dark, harmony for light), remap the neutral-tint
family and the accent hue, set a literal-hex `--tugx-host-canvas-color` matching the app surface, and
validate with the contrast audit below.

---

## Contrast Audit (per theme)

`bun run audit:theme-contrast` (`tugdeck/scripts/audit-theme-contrast.ts`) resolves every token in
the authoritative pairing map for each `styles/themes/*.css` and runs the same WCAG / perceptual /
CVD checks as the in-app Theme Accessibility card — headlessly, reusing `resolveTugColorToOklch`
(the single source of truth shared with `postcss-tug-color`, so build and audit never drift).

WCAG is normative per role; perceptual is informational. The gate is **comparative**: the base theme
(`brio`) sets the accessibility budget, and no other theme may ship with *more* WCAG failures than
it. Run `audit:theme-contrast <name>` for one theme (with the full failure list), or `--list` for all.

---

## Activation Model

### Development

- `POST /__themes/activate` is the activation API.
- `brio` copies `styles/themes/brio.css` into `tug-active-theme.css`.
- `harmony` copies `styles/themes/harmony.css` into `tug-active-theme.css`.
- The endpoint returns `{ theme, hostCanvasColor }`.
- `tug-active-theme.css` is always a complete theme; it is never empty.

### Production

- Base theme is included by app CSS import.
- Non-base theme is activated via `<link id="tug-theme-override" href="/assets/themes/<name>.css">`.
- `activateProductionTheme()` inserts/updates/removes that link.
- On startup, if saved theme is non-`brio`, the link is applied before first visible paint.

---

## Host Canvas Color Contract

Each theme CSS file must define:

```css
body {
  --tugx-host-canvas-color: #rrggbb;
}
```

Rules:

- Must be literal 6-digit hex.
- Dev activation returns this value from source CSS metadata.
- Production activation reads the applied CSS value and normalizes to `#rrggbb`.
- Swift bridge receives only the normalized hex string.

---

## Accessibility Card Data Path

Theme Accessibility uses live CSS, not derivation:

1. Build-time token inventory: `TUG_TOKEN_NAMES`.
2. Runtime raw values: `getComputedStyle(...).getPropertyValue(name)`.
3. Runtime color resolution: hidden probe element for tokens needing computed color.
4. Contrast/CVD analysis from resolved runtime colors.

This card reports live findings only (failures, marginals, unresolved values, CVD warnings).

---

## Build Processing

PostCSS is used for CSS processing:

- Authoring syntax `--tug-color(...)` remains in source CSS.
- `postcss-tug-color` expands to regular CSS during Vite dev/build.

The system intentionally duplicates one value per theme (`--tugx-host-canvas-color`) to keep runtime simple and explicit.
