# Third-Party Notices

This file documents copyright notices for third-party code and patterns adopted
in this repository, per [L21](tuglaws/laws-of-tug.md). Each entry identifies
the source, what was adopted, and the required copyright notice.

---

## Excalidraw

**Source:** https://github.com/excalidraw/excalidraw
**What was adopted:** Architectural patterns that informed the Laws of Tug: single-render-root discipline (L01), external-state-via-subscription pattern (L02), appearance-changes-via-DOM-not-state separation (L06), component authoring conventions (L19). Excalidraw's canvas-based rendering architecture, state management approach, and component organization were studied extensively during the initial design of the tugways system.
**Used in:** `tuglaws/laws-of-tug.md` (design principles), tugdeck component architecture

```
MIT License

Copyright (c) 2020 Excalidraw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Monaco Editor

**Source:** https://github.com/microsoft/monaco-editor
**What was adopted:** PrefixSumComputer architecture (Float64Array prefix sum with lazy recomputation and validity watermark, binary search for offset-to-index mapping); RenderedLinesCollection sliding window pattern (contiguous range of DOM nodes mapped to document positions, enter/exit diffing on scroll, overscan for smooth scrolling); viewport-first rendering discipline (never compute what isn't visible, progressive background processing).
**Used in:** `tugdeck/src/lib/block-height-index.ts`, `tugdeck/src/lib/rendered-block-window.ts`, `tugdeck/src/components/tugways/tug-markdown-view.tsx`

```
The MIT License (MIT)

Copyright (c) 2016 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## threads.js

**Source:** https://github.com/andywer/threads.js
**What was adopted:** Thenable task handle pattern (`QueuedTask` with `.cancel()` + `.then()`); discriminated union pool event protocol; worker init handshake with timeout.
**Used in:** `tugdeck/src/lib/tug-worker-pool.ts` (Phase 3A.1)

```
The MIT License (MIT)

Copyright (c) 2019 Andy Wermke

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## poolifier-web-worker

**Source:** https://github.com/poolifier/poolifier-web-worker
**What was adopted:** Priority queue with aging to prevent starvation; least-used worker selection strategy; promise-response-map RPC pattern with AbortSignal integration; back-pressure signaling via queue depth thresholds.
**Used in:** `tugdeck/src/lib/tug-worker-pool.ts` (Phase 3A.1)

```
MIT License

Copyright (c) 2023-2024 Jerome Benoit

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## greenlet

**Source:** https://github.com/developit/greenlet
**What was adopted:** Promise-per-call RPC mechanism using counter-based task IDs with resolve/reject stashed in a Map; automatic transferable detection by filtering for ArrayBuffer/MessagePort/ImageBitmap.
**Used in:** `tugdeck/src/lib/tug-worker-pool.ts` (Phase 3A.1)

```
MIT License

Copyright (c) Jason Miller <jason@developit.ca>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## use-stick-to-bottom

**Source:** https://github.com/stackblitz-labs/use-stick-to-bottom
**What was adopted:** ResizeObserver-driven auto-scroll architecture; `ignoreScrollToTop` pattern for filtering programmatic scroll events; `wheel` event `deltaY < 0` for detecting user scroll-up intent; `resizeDifference` flag for ignoring scroll events caused by content resize; near-bottom threshold concept (50-70px) for re-engagement detection.
**Used in:** `tugdeck/src/components/tugways/tug-markdown-view.tsx` (Phase 3A.6 smart auto-scroll)

```
MIT License

Copyright (c) 2024 StackBlitz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
