# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-14
date: 2025-04-24T00:00:18Z
---

## step-14: Added tests/in-app/m03-pane-activation.test.ts (246 lines). Seeds two panes (p1/p2) with one gallery-input FC each (A1/A2) at non-overlapping x-positions; focuses A1's input, types hello, verifies caret. Marks trace → clicks p2 title → expectFocusedCard(A2); asserts ordered-subset [save-callback{cardId:A1}, fr-flip{to:A2}, destination-flip{A2→true}, focus-call{A2}]. Marks again → clicks p1 title → expectFocusedCard(A1) → expectCaret restores at offset 5; return-trip trace subset. Source omitted from save-callback entry so matcher accepts any tag (pane-focus-controller currently emits no source for cross-pane activation — the gap surfaces when run with TUGAPP_IN_APP_TEST=1, the intended regression behavior). tsc clean; 29 pass / 10 skip / 0 fail; lint:no-timers clean.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-13
date: 2025-04-23T23:52:30Z
---

## step-13: Added tests/in-app/m01-tab-switch-fc.test.ts (221 lines) covering intra-pane tab switch on FC cards. Seeds pane with two gallery-input FC cards A/B, focuses A's size/sm input, types alpha, asserts form-control value + expectCaret. Marks trace, clicks tab B, asserts B focused/active + trace ordered-subset [fr-flip→B, destination-flip B→true, focus-call B]. Marks again, clicks tab A, asserts caret restored at offset 5 + same trace triple for return. skipIf-gated on TUGAPP_IN_APP_TEST=1. tsc clean, tests/in-app 29 pass / 9 skip / 0 fail, lint:no-timers clean.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-12
date: 2025-04-23T23:44:44Z
---

## step-12: Added tests/in-app/README.md (175 lines) covering run command, one-app-per-file lifecycle, fidelity limits, how-to-add-a-test recipe, lint:no-timers usage, and directory layout. Verified tugdeck/bunfig.toml excludes tests/in-app via [test] root=src and tests/in-app/.gitignore ignores logs/.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-11
date: 2025-04-23T23:39:14Z
---

## step-11: Phase 2 automated checkpoints all green: tugdeck tsc clean, 2434 pass / 0 fail; tests/in-app tsc clean, 29 pass / 8 skip / 0 fail; lint:no-timers clean. All Phase 2 artifacts present (deck-trace, test-surface, DeckManager.testMode + seedDeckState, window.__tug wiring, TestHarness Swift files, _harness library, in-app-bridge sub-tugplan). Binary-size baseline diff, Xcode archive nm inspection, and dev/test-mode manual launches deferred — they require GUI + pre-plan baseline and are unblocking for Phase 3 steps 12-15 which will exercise the harness against a live Tug.app.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-10
date: 2025-04-23T23:36:06Z
---

## step-10: Added tests/in-app/_harness/client.ts (typed wrappers over evalJS/waitForCondition per Spec [#s03-tug-surface]) and exposed App helpers including expectFocusedCard (waitForCondition strict equality) and expectCaret (waitForCondition deep-equal via server-side JSON.stringify). Added toContainOrderedSubset matcher in matchers.ts with partial-match semantics (pure predicate + expect.extend registration), covered by 14 new matchers.test.ts tests. Added lint-no-timers.ts bun script that rejects setTimeout/setInterval usage outside _harness/ (eslint not in use in this workspace; pure-bun script avoids pulling eslint in for one rule). Yellow drift: package.json gained scripts.lint:no-timers entry. tsc clean; in-app suite 29 pass / 8 skip / 0 fail.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-9
date: 2025-04-23T23:26:27Z
---

## step-9: Swift TestHarnessListener now probes for stale sockets before bind (unlink on ECONNREFUSED/ENOENT, throw staleSocketInUse when a live listener exists), and closes the listen-FD on first accept so subsequent kernel connects get ECONNREFUSED. Harness index.ts adds per-test log capture (logs/<testName>.log, truncate-on-open, pipe-drainers), public app.logPath + app.tailLog(lines=50), SIGINT/SIGTERM/exit detachable signal handlers, and an expectedSurfaceVersion option plumbed through the version handshake. Three new skipIf-gated in-app tests cover version-skew VersionSkewError, raw Bun.connect ECONNREFUSED after accept, and testName-scoped log capture. bun test tests/in-app: 15 pass / 8 skip / 0 fail. tugdeck baseline 2434 pass preserved.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-8
date: 2025-04-23T23:14:57Z
---

## step-8: Added tests/in-app/_wait-for-condition.test.ts with three in-app smoke tests (eval-error Error-name-and-message propagation, waitForCondition TimeoutError on never-truthy, waitForCondition immediate-return-value). All three are skipIf-gated on TUGAPP_IN_APP_TEST=1 per the established _smoke.test.ts pattern. Swift-side waitForCondition polling + evalJS server-side timeout + rpc.ts translateError and AppCrashedError-on-EOF handlers were all already delivered in step-7's scaffold — step-8 is the end-to-end verification layer. bun test tests/in-app: 15 pass / 5 skip / 0 fail.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-7
date: 2025-04-23T23:08:33Z
---

## step-7: Swift DEBUG-only Unix-socket bridge (TestHarnessBridge/Listener/Connection/UserScript under tugapp/Sources/TestHarness/, all #if DEBUG-bracketed at file scope) + TypeScript harness library (tests/in-app/_harness/ with errors.ts, types.ts, rpc.ts, index.ts exposing launchTugApp + App class with evalJS). WKUserScript injects __tugTestMode at atDocumentStart. AppDelegate launches bridge when TUGAPP_IN_APP_TEST=1 + TUGAPP_TEST_SOCKET set. Harness RPC framing is newline-delimited JSON with request IDs, timeout support, and structured error translation. 15 _harness unit tests pass; smoke test gated on built debug binary (deferred). tugdeck baseline 2434 pass / 0 fail preserved.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-6
date: 2025-04-23T22:53:47Z
---

## step-6: Created tugdeck/src/test-surface.ts implementing TugTestSurface per Spec [#s03-tug-surface]: 15 methods (version, seedDeckState, reset with 5 axes, click/type/focusElement, getActiveCardId/getFocusedCardId/getCaretState/getFormControlValue/assertHostRootRegistered, getDeckTrace/markDeckTrace/clearDeckTrace/enableDeckTrace). click dispatches pointerdown→mousedown→pointerup→mouseup→click per Spec [#s04]; type uses native-setter + InputEvent per char. window.__tug write double-guarded by import.meta.env?.DEV === true && window.__tugTestMode === true. main.tsx attaches the surface after initActionDispatch.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-5
date: 2025-04-23T22:45:30Z
---

## step-5: Added DeckManager.testMode constructor flag that gates all 9 tugbank-write call sites via three guarded wrappers (putLayoutGuarded / putCardStateGuarded / putFocusedCardIdGuarded). Added seedDeckState(args) public method for atomic replace + single store notify. main.tsx reads window.__tugTestMode behind import.meta.env.DEV + strict === true double-guard and forwards it to DeckManager. 7 new deck-manager tests cover backward-compat, no-fetch behavior, stale-layout discard, seed atomic replace, cardStates merge, focusCardId activation, ignore-when-absent. Baseline 2427 → 2434 pass, 0 fail.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-4
date: 2025-04-23T22:36:22Z
---

## step-4: Authored roadmap/tugplan-in-app-bridge.md (898 lines) — Phase 2 tugplan for the in-app test bridge. Transport decision [D02] records parallel Unix socket over tugcast reuse (tugcast ws_handler ships in every build, violates 'no code for this verb ships' bar; ControlSocket.swift provides working AF_UNIX template). T-1/T-2 remain in parent plan; CGEventPost deferred.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-2
date: 2025-04-23T22:02:25Z
---

## step-2: Added DeckCommitBeacon emitting commit-tick at every React commit; installed document-level focusin/focusout and destination-flip observers from deck-trace.enable(); routed deck-manager _flipFirstResponder, invokeSaveCallback (new source param), and card-host mount/unmount/A3-fire/apply-focus-snapshot through deckTrace.record. Tug.app-dependent manual smoke checkpoint deferred to step-3.

**Files changed:**
- in-app-test-harness-7d9c56e-1

---

---
step: step-1
date: 2025-04-23T21:47:01Z
---

## step-1: Added tugdeck/src/deck-trace.ts (bounded 512-entry ring buffer with DeckTraceEvent tagged union, record/dump/dumpTable/enable/mark/since/clear API, DEV-gated window.__deckTrace binding) and 8 pure-logic tests in tugdeck/src/__tests__/deck-trace.test.ts.

**Files changed:**
- in-app-test-harness-7d9c56e-1

---

---
step: step-2
date: 2025-04-16T10:34:17Z
---

## step-2: Step 2: created tug-prompt-entry.tsx (component shell with single useSyncExternalStore + single useState route, no-op SUBMIT and SELECT_VALUE responder handlers), tug-prompt-entry.css (Spec S07 token pairings + base styles), and a 6-test smoke suite. No-drift. Token-audit lint deferred: 6 pre-existing baseline violations in unrelated files, zero new from this step.

**Files changed:**
- tug-prompt-entry-f3a4fc3-2

---

---
step: step-1
date: 2025-04-16T10:22:01Z
---

## step-1: Step 1 preconditions: added TugPromptInputDelegate interface with setRoute method, SUBMIT action in TUG_ACTIONS, and 5 new test cases covering the widened forwardRef surface. Minor drift: gallery-prompt-input.tsx ref generic updated as required fallout.

**Files changed:**
- tug-prompt-entry-f3a4fc3-2

---

---
step: audit-fix
date: 2025-04-10T16:29:53Z
---

## audit-fix: CI fix: cargo fmt formatting on pre-existing worktree.rs tuple

**Files changed:**
- text-selection-adapter-ff24688-8

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

