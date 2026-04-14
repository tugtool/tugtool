# Third-Party Notices

This file documents copyright notices for third-party code and patterns adopted
in this repository, per [L21](tuglaws/tuglaws.md). Each entry identifies
the source, what was adopted, and the required copyright notice.

---

## fzf

**Source:** https://github.com/junegunn/fzf
**What was adopted:** Scoring constants and two-phase matching architecture from fzf's FuzzyMatchV2 algorithm — boundary bonus (+8 after word separators), consecutive match bonus (+8), camelCase transition bonus (+7), first character bonus (+8), gap penalties (−3 first, −1 extension), base match score (+16). Also adopted the pre-filter + DP scorer two-phase design (cheap subsequence check eliminates non-matches before expensive dynamic programming). The path-aware structural layer (basename-first scoring with tier bonus) was informed by VS Code and Sublime Text rather than fzf.
**Used in:** `tugrust/crates/tugcast/src/feeds/fuzzy_scorer.rs` (file completion scoring)

```
MIT License

Copyright (c) 2013-2025 Junegunn Choi

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

## Excalidraw

**Source:** https://github.com/excalidraw/excalidraw
**What was adopted:** Architectural patterns that informed the Tuglaws and the tug framework architecture: single-render-root discipline (L01), external-state-via-subscription pattern (L02), appearance-changes-via-DOM-not-state separation (L06), bypass-React-during-gesture-and-sync-on-commit pattern (L08, `MutationTransaction` snapshot/commit model), narrow-per-domain React contexts, typed-action dispatch vocabulary, and component authoring conventions (L19). Excalidraw's canvas-based rendering architecture, state management approach, and component organization were studied extensively during the initial design of the tug framework. The three-zone architecture (appearance / local data / structure) is an adaptation of Excalidraw's separation of gesture-zone work from React-state commits into a form that fits the tug framework's design target.
**Used in:** `tuglaws/framework-architecture.md` (zone architecture, subscribable stores, gesture bypass, narrow contexts, typed-action dispatch), `tuglaws/tuglaws.md` (design principles), tugdeck component architecture

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

## WebKit

**Source:** https://github.com/WebKit/WebKit
**What was adopted:** Visible units architecture from `Source/WebCore/editing/visible_units.h` — the separation of position boundary queries (startOfWord, endOfWord, startOfLine, endOfLine, startOfParagraph, endOfParagraph, startOfDocument, endOfDocument) from editing operations, so that deletion, movement, and selection extension at any granularity reduce to "find boundary, act on range." Also informed by `document.execCommand` architecture (the mapping of command names to editing operations through a unified dispatch surface). Both originated in the same 2004-era Apple contributions to KHTML/WebKit.
**Used in:** `tugdeck/src/lib/tug-text-editing-operations.ts` (TEOI operation taxonomy and visible units layer design), `tugdeck/src/lib/tug-text-engine.ts` (editing engine)

```
Copyright (C) 2004 Apple Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Lexical

**Source:** https://github.com/facebook/lexical
**What was adopted:** "Let the browser mutate, diff afterward" architecture — using MutationObserver as the primary input path for typing rather than intercepting beforeinput events. DOM reconciler pattern: model is source of truth, reconciler syncs model → DOM, skips composing nodes during IME to avoid disrupting browser composition UI.
**Used in:** `tugdeck/src/lib/tug-text-engine.ts` (MutationObserver input path, DOM reconciler)

```
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

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

## CodeMirror 6

**Source:** https://github.com/codemirror/dev
**What was adopted:** Flat document model with offset-based positions as the universal coordinate system (flat offsets map 1:1 to document positions, all operations expressed in terms of offset ranges). Own undo stack with immutable snapshots and time-based merge heuristic for consecutive edits.
**Used in:** `tugdeck/src/lib/tug-text-engine.ts` (flat offset position model, undo stack with merge window)

```
MIT License

Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin>,
Adrian Heine <mail@adrianheine.de>, and others

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

## ProseMirror

**Source:** https://github.com/ProseMirror/prosemirror
**What was adopted:** Schema-constrained document model concept — the idea that the document enforces structural invariants (our text-atom-text invariant: segments always alternate, atoms always separated by text nodes, document always starts and ends with text). Normalization as a model-level guarantee rather than ad-hoc fixup.
**Used in:** `tugdeck/src/lib/tug-text-engine.ts` (text-atom-text invariant, `normalizeSegments`)

```
MIT License

Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

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
**Used in:** `tugdeck/src/lib/smart-scroll.ts` (ResizeObserver-driven auto-scroll with user-intent detection)

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
