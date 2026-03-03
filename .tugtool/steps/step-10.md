# Step 10 Checkpoint Output

## bun test (all unit tests)

```
359 pass
0 fail
726 expect() calls
Ran 359 tests across 28 files. [7.85s]
```

## Phase 5 acceptance tests (T01-T35 + supporting tests)

```
bun test card-registry tugcard card-frame use-tugcard deck-canvas deck-manager hello-card action-dispatch layout-tree

117 pass
0 fail
280 expect() calls
Ran 117 tests across 9 files. [187ms]
```

Coverage map:
- T01-T05: card-registry.test.ts -- PASS
- T06-T09: use-tugcard-data.test.tsx -- PASS
- T09-T15: tugcard.test.tsx -- PASS
- T16-T20: card-frame.test.tsx -- PASS
- T21-T22: hello-card.test.tsx -- PASS
- T23-T24: action-dispatch.test.ts -- PASS
- T25-T27: deck-canvas.test.tsx -- PASS
- T28-T29: layout-tree.test.ts -- PASS
- T30-T35: deck-manager.test.ts -- PASS

## bun run build

```
vite v7.3.1 building client environment for production...
transforming...
✓ 1764 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.73 kB │ gzip:  0.41 kB
dist/assets/index-_nfjjLul.css   44.57 kB │ gzip:  9.15 kB
dist/assets/index-DDEePugX.js    68.42 kB │ gzip: 22.28 kB
dist/assets/vendor-BvKEF7s2.js  192.88 kB │ gzip: 60.48 kB
✓ built in 708ms
```

## Manual tests

The following require running the app and are deferred to human verification:
- Show Test Card from Developer menu creates a Hello card on the canvas
- Card can be dragged freely
- Card can be resized; min-size clamping prevents shrinking below header + content minimum
- Close button removes card from canvas
- Two cards cascade with offset positions
- Clicking a background card brings it to front
- Card position/size persists across page reload
- Component Gallery coexists alongside a card
