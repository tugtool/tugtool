# Cross-Platform Engine Strategy

Date written: 2026-04-27
Status: Exploration — captures current thinking; no decision committed.

## Summary

Tug today is a SwiftUI/AppKit shell hosting a `WKWebView` that loads tugdeck. Cross-platform shipping (Linux, Windows) raises two distinct questions that are easy to conflate:

- **WKWebView dependence** — the macOS-specific embedding API.
- **WebKit (engine) dependence** — the renderer + JS engine itself.

The first is shallow in this codebase. The second is deeper but already partially paid for. A decision is not urgent, but the cost of *delaying* the decision (more WebKit-only escape hatches added over time) is real and should be capped now.

## Where the codebase actually is today

### Native bridge surface is small

`tugapp/Sources/MainWindow.swift` exposes 8 `WKScriptMessageHandler` endpoints:

- `sourceTree`, `setDevMode`, `getSettings`, `frontendReady`, `setTheme`, `devBadge`, `clipboardRead`, `cardList`

On the JS side, `window.webkit.messageHandlers` is referenced from:

- `src/main.tsx`
- `src/action-dispatch.ts`
- `src/deck-manager.ts`
- `src/contexts/theme-provider.tsx`
- `src/lib/tug-native-clipboard.ts` (and `isInsideWKWebView()`)

Porting this surface to WebView2's `chrome.webview.postMessage` or Tauri's `invoke()` is largely mechanical. The bridge is **not** the lock-in.

### Engine-specific code already exists

We have already eaten the cost of WebKit's quirks in several places:

- `src/components/tugways/internal/safari-focus-shift.ts` — explicit Safari/WebKit selection-focus shim.
- `src/lib/tug-native-clipboard.ts` — exists because Safari pops a permission UI on every `navigator.clipboard.readText` and `execCommand("paste")` in 16.4+.
- `MainWindow.swift` blob-download workaround in `decidePolicyFor navigationResponse`.

These are WebKit-engine consequences, not WKWebView consequences. They follow the engine, not the embedding API.

### CSS prefixes are not a portability blocker

`-webkit-line-clamp`, `-webkit-user-select`, `-webkit-appearance`, etc. are all supported by Blink because Blink forked from WebKit in 2013 and kept the prefixed names. Not a porting issue.

## Question-by-question

### Can Apple WebKit be hosted on Linux/Windows the way WKWebView is on macOS?

Practically, no.

- **WebKitGTK / WPE WebKit** are *the* upstream Linux ports of WebKit. Same JSC + WebCore, but a different platform layer (Cairo/Skia/GStreamer/libsoup vs CoreGraphics/CFNetwork). Feature parity lags Apple WebKit and stability complaints are frequent. Tauri uses WebKitGTK on Linux for this reason.
- **WebKit on Windows (WinCairo / Apple-port)** is largely abandoned for product use. iCloud for Windows has migrated off it to WebView2; only iTunes still ships it. WinCairo provides nightly "MiniBrowser" builds, but it is an embedding harness, not a production-shippable webview. As of Nov 2025 the Windows port team is still working on cross-compilation from Linux via WINE/Proton.

Net: WebKitGTK on Linux is feasible but introduces a third engine variant to test against. Production WebKit on Windows is not a credible option.

### Can we require WSL on Windows and ship Linux?

Technically yes. WSLg (Windows 11 22000+) ships out of the box, achieves ~80–90% native perf, and supports GPU acceleration. WSLg renders Wayland frames over RDP into Windows windows.

Why this is a stopgap, not a strategy:

- Requires Windows 11.
- Requires user to install WSL + a distro before our installer is even relevant.
- Tug.app is positioned as a polished native shell. Telling Windows users "install WSL first" is a credibility hit that will dog the product.
- It does not solve the engine question — we'd still be running WebKitGTK, just over RDP.

Use it as an internal "we got something running" milestone if needed; do not use it as a public Windows product story.

### Was building on WebKit a poor decision?

For the macOS-first phase, no. WKWebView gave us:

- Zero engine bundle (small distribution).
- Native trackpad/scroll/IME behavior, system text-selection menus.
- Immediate Apple-platform integration.
- Lower memory footprint than Electron-on-mac would have given us.

Those were the right things to optimize for in this phase.

For cross-platform inevitability, however, it's a bet against the dominant engine, with two specific costs:

1. **contenteditable.** Both engines have ugly contenteditable behavior, but Blink's is more battle-tested and more permissive. Safari has stricter selection validation, the caret-jumps-to-start-on-React-rerender bug, and divergent focus-on-Selection-API behavior. Every serious rich-text effort (ProseMirror, Slate, Lexical, etc.) talks about WebKit-specific workarounds. `safari-focus-shift.ts` is the canary.
2. **Engine fragmentation when going cross-platform.** WebKit-everywhere gives WebKitGTK divergence on Linux and nothing on Windows. Chromium-everywhere gives one engine to test against on every platform.

Conclusion: not a poor decision *yet*, but it's a decision with an expiration date if cross-platform is a real goal.

## Three credible architectures going forward

### Option A — Tauri 2 + system webview per platform

Tauri 2's default model: WKWebView on macOS, WebView2 (Chromium-based) on Windows, WebKitGTK on Linux.

- Pros: Preserves WKWebView investment on macOS. Chromium on Windows for free. Tiny binaries (~10MB vs Electron's 100MB+). Rust backend fits the existing tugrust ecosystem. Mature in 2026.
- Cons: Three-engine test matrix. Linux gets the worst engine of the three. WebKit-quirk territory is not escaped on Apple platforms.

### Option B — Electron (Chromium everywhere, including macOS)

Ship one engine on every OS.

- Pros: contenteditable surface dramatically simpler. Single engine to test. Largest ecosystem and most documentation.
- Cons: macOS native feel suffers (no native scroll inertia, ~150–200MB extra RAM, ~100MB installer). Less aligned with Rust-first instincts.

For a dev tool whose audience runs many Electron apps already (VSCode, Slack, Discord, Figma desktop), this is not the dealbreaker it would be for a consumer app.

### Option C — Hybrid: WKWebView on macOS, bundled Chromium on Linux/Windows

Tauri's Wry doesn't directly support bundling Chromium, but Tauri-on-mac combined with Electron-on-Windows/Linux sharing the same React frontend is doable.

- Pros: Best of both — Apple polish on Apple platforms, engine consistency on the other two.
- Cons: Two host shells to maintain. Worth it only if Apple-platform polish is a brand commitment.

## Current lean

**Option A is the path of least regret if a decision happens in the next few months.** Existing investment carries forward, cross-platform works, and the three-engine matrix is the same matrix every Tauri app already deals with.

Option B becomes the right call if contenteditable pain compounds further — specifically, if Safari shim #4, #5, or #6 gets written. That's the trigger condition to reopen this doc.

## Concrete actions for the next few weeks

These are cheap, do not commit to any framework, and buy optionality.

1. **Build an engine-portability scorecard.** For each major UI surface (prompt entry, tug-editor, tug-pane, gallery cards, contenteditable areas), note: WebKit-only behaviors? Safari shims? Treat the shim files as a first inventory. This becomes the migration risk doc.
2. **Sanity-check the frontend in Chrome and Edge today.** tugdeck is just a Vite app — point a browser at the dev server and capture regressions. That list is the "what would Tauri-on-Linux/Windows actually break" delta. Cheap, decisive data.
3. **Draw a hard line around the bridge.** Make all `window.webkit.messageHandlers` references go through one `nativeBridge.ts` module so a future Tauri/Electron port has exactly one file to swap. Right now it leaks into 4–5 files.
4. **No new WebKit-only escape hatches.** Anything added that is WebKit-engine-only (CSS feature with no Blink equivalent, an Apple-only API) gets called out and paid down or replaced. Prevents lock-in from deepening while the framework decision is open.
5. **Defer actual port work** until the component library is stable. Trying to chase two moving targets in parallel makes both worse. One more cycle of macOS feature-completeness, *then* port.

## Decisions that are not on the table right now

- Which framework to port to (Tauri vs Electron vs Hybrid).
- Whether to drop macOS-native polish in favor of Chromium consistency.
- Linux distribution model (Flatpak / AppImage / native packages).
- Windows installer / signing strategy.

These can all be decided 3–6 months from now with much better information than is available today. The point of this doc is to keep that future decision *cheap* by capping current lock-in.

## References

- [Tauri Webview Versions](https://v2.tauri.app/reference/webview-versions/)
- [Wry — Tauri's webview library](https://github.com/tauri-apps/wry)
- [Tauri vs Electron 2026](https://tech-insider.org/tauri-vs-electron-2026/)
- [DoltHub: Electron vs Tauri](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)
- [WebKit Windows port update — Nov 2025](https://iangrunert.com/2025/11/06/webkit-windows-port-update-november-2025)
- [WebKit Windows Port docs](https://docs.webkit.org/Ports/WindowsPort.html)
- [WebKit Ports overview](https://docs.webkit.org/Ports/Introduction.html)
- [WebKitGTK stability concerns (Tauri discussion #8524)](https://github.com/orgs/tauri-apps/discussions/8524)
- [WSLg 2.0 performance benchmarks](https://markaicode.com/wslg-2-ubuntu-gui-app-performance-benchmarks/)
- [Run Linux GUI apps with WSL — Microsoft Learn](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)
- [contenteditable in Safari/WebKit — caret bug](https://www.codegenes.net/blog/caret-position-reverts-to-start-of-contenteditable-span-on-re-render-in-react-in-safari-and-firefox/)
- [ContentEditable — The Good, the Bad and the Ugly](https://medium.com/content-uneditable/contenteditable-the-good-the-bad-and-the-ugly-261a38555e9c)
- [Browser Engines 2025: Blink, Gecko, WebKit](https://digitechbytes.com/tech-basics-evergreen-fundamentals/browser-engines-2025/)
