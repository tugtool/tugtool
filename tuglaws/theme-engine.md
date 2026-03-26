# Theme System (CSS-First)

*The theme runtime is CSS-first and file-based.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md).*

---

## Source Of Truth

Theme data lives in checked-in CSS files:

| File | Role |
|---|---|
| `tugdeck/styles/themes/brio.css` | Brio theme source (complete token declarations) |
| `tugdeck/styles/themes/harmony.css` | Harmony theme source (complete token declarations) |
| `tugdeck/styles/tug-active-theme.css` | Active theme copy (complete theme, never empty) |

Shipped themes: `brio` and `harmony`. Every theme is a peer — neither depends on the other.

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
