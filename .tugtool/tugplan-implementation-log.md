# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-4
date: 2025-04-10T16:25:06Z
---

## step-4: Verification-only step: bun run check clean, 2003 tests pass, no import cycles, all three adapters satisfy TextSelectionAdapter interface

**Files changed:**
- text-selection-adapter-ff24688-8

---

---
step: step-3
date: 2025-04-10T16:20:55Z
---

## step-3: Added createEngineAdapter to tug-prompt-input.tsx with DOM geometry classifyRightClick, engine-delegated selectWordAtPoint with collapse guard, and Selection.modify expandToWord

**Files changed:**
- text-selection-adapter-ff24688-8

---

---
step: step-2
date: 2025-04-10T16:15:55Z
---

## step-2: Added createNativeInputAdapter to use-text-input-responder.tsx with offset-based classifyRightClick, capturePreRightClick, and findWordBoundaries integration

**Files changed:**
- text-selection-adapter-ff24688-8

---

---
step: step-1
date: 2025-04-10T16:08:23Z
---

## step-1: Created text-selection-adapter.ts with TextSelectionAdapter interface, RightClickClassification type, NativeInputSelectionAdapterExtras, findWordBoundaries utility, and HighlightSelectionAdapter stub

**Files changed:**
- text-selection-adapter-ff24688-8

---

---
step: step-3
date: 2025-04-06T22:06:52Z
---

## step-3: Refactored FilesystemFeed to thin broadcast consumer. Removed all watcher/gitignore logic (now in file_watcher.rs). Updated main.rs with broadcast wiring. 229 tugcast tests pass.

**Files changed:**
- .tugtool/tugplan-live-file-completion.md

---

---
step: step-2
date: 2025-04-06T21:59:40Z
---

## step-2: Created FileWatcher in file_watcher.rs with walk() (WalkBuilder, nested gitignore, 50k cap), run() (notify watcher, broadcast fan-out, gitignore rebuild on change). 14 unit tests. 927 tests pass.

**Files changed:**
- .tugtool/tugplan-live-file-completion.md

---

---
step: step-1
date: 2025-04-06T21:23:16Z
---

## step-1: Added FeedId::FILETREE (0x11) to protocol.rs, FileTreeSnapshot struct to types.rs, lib.rs re-export, and FILETREE constant to tugdeck protocol.ts. 64 tests pass.

**Files changed:**
- .tugtool/tugplan-live-file-completion.md

---

---
step: step-6
date: 2025-04-06T18:00:50Z
---

## step-6: Integration checkpoint: verified all store files exist with correct exports, gallery card imports from store modules, tsc clean, 1823 tests pass.

**Files changed:**
- .tugtool/tugplan-t3-stores.md

---

---
step: step-5
date: 2025-04-06T17:57:05Z
---

## step-5: Refactored gallery-prompt-input.tsx to use SessionMetadataStore, PromptHistoryStore, and createFileCompletionProvider. Removed GalleryHistoryProvider class and inline provider functions. tsc clean, 1823 tests pass.

**Files changed:**
- .tugtool/tugplan-t3-stores.md

---

---
step: step-4
date: 2025-04-06T17:51:31Z
---

## step-4: Created createFileCompletionProvider(files) factory in file-completion-provider.ts, extracting gallery logic into a standalone module. tsc clean.

**Files changed:**
- .tugtool/tugplan-t3-stores.md

---

---
step: step-3
date: 2025-04-06T17:46:01Z
---

## step-3: Added PromptHistoryStore class with push/loadSession/createProvider, L02 subscribe/getSnapshot, 200-entry cap per session, and Tugbank persistence. 14 tests pass.

**Files changed:**
- t3-stores-944c9ca-1

---

---
step: step-2
date: 2025-04-06T17:39:06Z
---

## step-2: Created HistoryEntry/SerializedAtom types in prompt-history-store.ts, added putPromptHistory() and getPromptHistory() to settings-api.ts with Tugbank persistence. 12 tests pass.

**Files changed:**
- t3-stores-944c9ca-1

---

---
step: step-1
date: 2025-04-06T17:34:37Z
---

## step-1: Created SessionMetadataStore class that subscribes to FeedStore, parses system_metadata payloads, and exposes L02-compliant subscribe/getSnapshot plus getCommandCompletionProvider(). 13 tests pass.

**Files changed:**
- t3-stores-944c9ca-1

---

---
step: step-7
date: 2025-04-01T23:32:57Z
---

## step-7: Final integration checkpoint: verified all 7 steps. 2 lexParseAndRender call sites (cold-start, removeRegion). pinToBottom wired in doSetRegion. shiftFrom for non-tail P!=Q. Content shrink scroll recovery. CSS containment. 1966 tests pass.

**Files changed:**
- markdown-scroll-fixes-f492c4c-1

---

---
step: step-6
date: 2025-04-01T23:26:17Z
---

## step-6: Generalized incrementalTailUpdate for non-tail regions via shiftFrom + key remapping. Removed !isLast gate in doSetRegion. lexParseAndRender now only on cold-start and removeRegion. Content shrink scroll recovery via getBlockAtOffset. Replaced fallback lexParseAndRender calls with console.warn + early return.

**Files changed:**
- markdown-scroll-fixes-f492c4c-1

---

---
step: step-5
date: 2025-04-01T23:13:49Z
---

## step-5: Added shiftFrom(startIndex, delta) to BlockHeightIndex. Uses Float64Array.copyWithin for in-place shift, invalidates prefix sum watermark. Handles capacity growth for large positive deltas. 10 tests added.

**Files changed:**
- markdown-scroll-fixes-f492c4c-1

---

---
step: step-4
date: 2025-04-01T23:08:45Z
---

## step-4: Integration checkpoint: verified steps 1-3 integration. pinToBottom wired in doSetRegion, MAX_SAFE_INTEGER in both scroll methods, ResizeObserver safety net, CSS containment. No code changes — verification only.

**Files changed:**
- markdown-scroll-fixes-f492c4c-1

---

---
step: step-3
date: 2025-04-01T23:04:41Z
---

## step-3: Wired synchronous offsetHeight measurement in incrementalTailUpdate after applyWindowUpdate. Replaced scrollToBottom with pinToBottom in doSetRegion. Added ResizeObserver safety-net slam when following bottom. Added contain:content to .tugx-md-block.

**Files changed:**
- markdown-scroll-fixes-f492c4c-1

---

---
step: step-2
date: 2025-04-01T22:58:17Z
---

## step-2: Added pinToBottom() to SmartScroll: sets scrollTop=MAX_SAFE_INTEGER without entering programmatic phase. Stays in idle per D93 state machine. Two tests added.

**Files changed:**
- markdown-scroll-fixes-f492c4c-1

---

---
step: step-1
date: 2025-04-01T22:51:08Z
---

## step-1: Replaced scrollHeight-clientHeight computation in scrollToBottom() with Number.MAX_SAFE_INTEGER. Browser clamps to actual max. Updated test mock to mimic browser clamping.

**Files changed:**
- markdown-scroll-fixes-f492c4c-1

---

---
step: step-5
date: 2025-04-01T21:06:26Z
---

## step-5: Integration test suite: 5000-chunk streaming throughput (<2ms/chunk at 1MB), regionBlockRanges consistency across full-rebuild and incremental paths, middle-region full rebuild correctness, mixed emoji/CJK/fence content, interleaved streaming and imperative updates. 1768 tests pass.

**Files changed:**
- incremental-tail-lex-6474254-1

---

---
step: step-4
date: 2025-04-01T20:48:58Z
---

## step-4: Extended regionBlockRanges with types array for block type tracking. Enhanced lazy fence propagation to detect block type changes (not just count/offset). Recursive propagation stops when types stabilize. Test suite added.

**Files changed:**
- incremental-tail-lex-6474254-1

---

---
step: step-3
date: 2025-04-01T20:39:33Z
---

## step-3: Replaced incrementalUpdate with incrementalTailUpdate in doSetRegion's isLast branch. Deleted old incrementalUpdate function (-69 lines). wasEmpty and !isLast branches unchanged (lexParseAndRender). Wiring test suite added.

**Files changed:**
- incremental-tail-lex-6474254-1

---

---
step: step-2
date: 2025-04-01T20:32:11Z
---

## step-2: Implemented incrementalTailUpdate function: region-scoped lex with \n\n prefix for context, byte offset translation via buildByteToCharMap, block splice for count changes, lazy fence propagation, and timing reporting. Added truncate() to BlockHeightIndex. Test suites added for both.

**Files changed:**
- incremental-tail-lex-6474254-1

---

---
step: step-1
date: 2025-04-01T20:21:37Z
---

## step-1: Added regionBlockRanges Map to MarkdownEngineState, populated after lex-parse cycle via regionKeyAtOffset. Cleared in doClear and lexParseAndRender reset. Test suite added.

**Files changed:**
- incremental-tail-lex-6474254-1

---

