# Step 3: Rewrite settings-api.ts for tugbank endpoints

## Files Modified

- `tugdeck/src/settings-api.ts` — complete rewrite: removed `ServerSettings`, `fetchSettingsWithRetry`, `postSettings`; added `fetchLayoutWithRetry`, `fetchThemeWithRetry`, `putLayout`, `putTheme`
- `tugdeck/package.json` — added `"check": "bunx tsc --noEmit"` script
- `tugdeck/src/main.tsx` — updated to use `fetchLayoutWithRetry` / `fetchThemeWithRetry` with `Promise.all`
- `tugdeck/src/deck-manager.ts` — updated to use `putLayout`; removed `readCurrentThemeFromDOM`
- `tugdeck/src/contexts/theme-provider.tsx` — updated to use `putTheme`

## Implementation Notes

- `fetchLayoutWithRetry()` GETs `/api/defaults/dev.tugtool.deck.layout/layout`, unwraps `{"kind":"json","value":{...}}`, returns `null` on 404 (no-data case, not an error).
- `fetchThemeWithRetry()` GETs `/api/defaults/dev.tugtool.app/theme`, unwraps `{"kind":"string","value":"..."}`, returns `null` on 404.
- Both fetch functions retry indefinitely on network errors or 5xx; 404 exits immediately with `null`.
- `putLayout(layout)` PUTs `{"kind":"json","value":...}` fire-and-forget with `.catch()` logging.
- `putTheme(theme)` PUTs `{"kind":"string","value":"..."}` fire-and-forget with `.catch()` logging.
- `sleep` helper retained.
- Callers updated in the same step to satisfy the `bun run check` zero-errors checkpoint (node_modules was missing in the worktree; after `bun install` the only remaining errors were the caller imports).
- `main.tsx` uses `Promise.all([fetchLayoutWithRetry(), fetchThemeWithRetry()])` for parallel startup fetch per [D02] / Spec S02.
- `DeckManager.saveLayout()` now calls only `putLayout(serialized)` — no theme write per [D06].
- `readCurrentThemeFromDOM()` removed from `DeckManager` (dead code after [D06]).

## Checkpoint: bun run check

**Command:** `cd tugdeck && bun run check`

```
$ bunx tsc --noEmit
(no output — zero TypeScript errors)
```

**Result:** PASSED — zero TypeScript errors
