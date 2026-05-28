# Code Signing on macOS — Apple Developer ID + Inside-Out Signing

*The signing pipeline that gives `Tug.app` a stable designated requirement across rebuilds (so TCC Accessibility grants persist), why the app-test harness depends on it, and the procedures + failure modes you need to know. Read this before changing anything in `Justfile`'s `build-app` / `app-test` recipes, in `tugrust/scripts/sign-bundle.sh`, in `scripts/setup-dev-signing.sh`, or in the bundle's entitlements / signing settings.*

> **Platform scope.** This document is **macOS-only**. The whole pipeline is structured around Apple's TCC database, the `security` CLI, the `codesign` tool, Xcode's build settings, macOS Accessibility (AX) permissions, and `notarytool`. None of it has a meaningful analogue on Linux or Windows.

*Cross-references: `[D##]` → decisions in [`roadmap/tug-multi-instance.md`](../roadmap/tug-multi-instance.md). The plan close-out captures per-step implementation history; this document is the durable reference.*

---

## Why we sign at all

The app-test harness drives `Tug.app` through trusted hardware events — `CGEvent.post`-backed clicks, drags, key presses. WebKit's `isTrusted` paths only fire for trusted events, and posting trusted events requires the macOS **Accessibility (AX) grant**: System Settings → Privacy & Security → Accessibility, with `Tug.app` toggled on.

The AX grant is not a one-time global thing. macOS's TCC (Transparency, Consent, Control) database keys grants on the **bundle's designated requirement (DR)** — a string that includes the bundle identifier *and* fingerprints of the signing certificate chain. Two binaries with the same DR are interchangeable as far as TCC is concerned. Two with different DRs require a fresh user grant.

**The problem.** Xcode Debug builds default to **ad-hoc signing**, which produces a per-build `cdhash` DR. Different signature → different DR → AX grant invalidated → `CGEvent.post` silently no-ops → every app-test scenario fails with confusing attribution. In a tight test-edit-test loop, the developer would have to re-grant Accessibility every minute.

**The fix.** Sign the bundle with an **Apple Developer ID Application certificate** ([D11]). The DR for a Developer-ID-signed bundle has the shape:

```
identifier "<bundle-id>" and anchor apple generic and certificate 1[…] /* exists */ and certificate leaf[…] /* exists */ and certificate leaf[subject.OU] = <TEAMID>
```

This DR is **structural** — it references the Apple intermediate cert and the team ID rather than a single leaf hash. The team-issued cert can be re-issued (e.g., on annual renewal) and the DR's *shape* stays the same; only the leaf-cert-specific bytes change. TCC matches on the structural pattern, so the AX grant survives cert rotation. This is the architectural improvement over the prior self-signed `Tug Dev` model, where every cert regeneration produced a wholly new DR.

---

## The architecture (six moving parts)

| Component | Responsibility |
|---|---|
| `scripts/setup-dev-signing.sh` | One-shot per machine. **Verifies** that the Apple Developer ID Application cert is installed in the login keychain. Prints actionable instructions if it isn't. No openssl, no .p12, no provisioning — the cert is installed once via Xcode → Settings → Accounts → Manage Certificates → "+" → "Developer ID Application". |
| `Tug.xcodeproj`'s build settings | `CODE_SIGN_STYLE = Automatic`, `ENABLE_HARDENED_RUNTIME = YES`. xcodebuild signs ad-hoc by default. We deliberately do **not** override the project's signing identity at the pbxproj level. |
| `tugrust/scripts/sign-bundle.sh` | The canonical signer. Walks the bundle inside-out — signing Rust helpers (default hardened runtime, no custom entitlements), the Swift debug dylibs (Debug builds only — must share the loading binary's team ID under hardened runtime), `tugcode` (bun-compiled, permissive entitlements per [D16]), then sealing the outer `.app` with `Tug.entitlements`. Never uses `--deep` for signing; `--deep` remains valid for verification. |
| `tugapp/Tug.entitlements` | The outer Swift binary's entitlements. Minimal — currently just `com.apple.security.cs.allow-unsigned-executable-memory` (left over from pre-hardened-runtime WKWebView assumptions; can be re-evaluated). |
| `tugapp/tugcode.entitlements` | The five bun-required permissive entitlements applied to the bun-compiled `tugcode` binary only: `allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection`, `allow-dyld-environment-variables`, `disable-library-validation`. Per [D16]. |
| `Justfile` `build-app` / `app-test` recipes | Re-sign post-xcodebuild via `sign-bundle.sh`. Capture the bundle's DR into `.tugtool/code-sign-fingerprint`. `app-test` reads the sentinel before re-signing and skips when the bundle's current DR already matches (the steady-state case). |

The fingerprint sentinel at `.tugtool/code-sign-fingerprint` is now **belt-and-suspenders** ([D11]). Under Developer ID + hardened runtime, the DR is stable across rebuilds anyway, so the sentinel rarely fires. It still catches the case where the user re-issues their Developer ID cert (e.g., on renewal) and the new cert produces a different DR string.

---

## Inside-out signing (the order matters)

Per Apple's macOS 13+ guidance, any bundle with heterogeneous nested binaries must be signed **inside-out**. `sign-bundle.sh` enforces the order:

```
1. Rust helpers          (tugcast, tugutil, tugexec, tugrelaunch, tugbank)
                         — no custom entitlements

2. Swift debug dylibs    (Tug.debug.dylib, __preview.dylib — Debug builds only)
                         — no custom entitlements; must share the outer
                           binary's team ID or hardened runtime refuses
                           to load them

3. tugcode               (bun-compiled)
                         — entitlements: tugapp/tugcode.entitlements
                           (the 5 bun-permissive entitlements)

4. [reserved]            — future Sparkle.framework or other nested
                           frameworks slot in here

5. Outer Tug.app         (the Swift Tug binary + bundle wrapper)
                         — entitlements: tugapp/Tug.entitlements
                         — this is the final seal; records every
                           nested signature beneath it
```

Every step uses `--force --options runtime --timestamp`. `--options runtime` engages the hardened runtime; `--timestamp` requests a secure timestamp from Apple's timestamp server (needed for notarization). `--deep` is **banned for signing** in this codebase — it would apply the same entitlements file (or no entitlements) to every nested binary, which is exactly wrong for step (3).

`--deep` is allowed for *verification*: `codesign --verify --deep --strict` walks the whole bundle and confirms every nested signature checks out against the outer seal.

---

## Procedures

### First-time setup (per machine, ~5 minutes)

```sh
# 1. Install the Developer ID Application cert in Xcode (one-click flow):
#    Xcode → Settings → Accounts → (your Apple ID) → (team) → Manage
#    Certificates → "+" → "Developer ID Application".
#
# 2. Verify the install:
just setup-dev-signing

# 3. Build + smoke-test:
just build-app
just app-test-smoke         # first run pops the AX grant dialog
```

When the AX grant dialog appears, click "Open System Settings" and toggle `Tug.app` on under Privacy & Security → Accessibility. Subsequent runs work without prompting because every build signs with the same Developer ID identity → same DR → the grant persists.

### Day-to-day flow

```sh
just build-app    # when Swift / Rust / tugdeck-dist sources changed
just app-test     # full sweep, or `just app-test <files...>`
```

`just app-test` runs `bun run build` to refresh `tugdeck/dist` on every invocation. Swift changes still need `just build-app`.

### Decommissioning (rare)

```sh
just teardown-dev-signing
```

Clears the fingerprint sentinel. Does **not** touch the Developer ID cert in your login keychain — that's your Apple-issued identity, not project-scoped. To remove the cert, use Keychain Access manually.

### Onboarding without `setup-dev-signing`

A contributor who just wants to read or edit the source — without running the test harness — does **not** need a Developer ID cert. They can:

- Build via Xcode IDE or `xcodebuild` directly (ad-hoc signature; works fine for non-test runs). Hardened runtime stays on but ad-hoc signing produces a bundle that won't satisfy the recipe's DR sentinel check.
- Run `just app-test` with `APP_TEST_SKIP_RESIGN=1` to skip the re-sign step. CGEvent-dependent tests will fail (no AX grant against ad-hoc DR), but tests that don't need AX — `harness-smoke/smoke.test.ts`, `version-handshake.test.ts`, etc. — will pass.

---

## Spec: the fingerprint sentinel

**Path:** `.tugtool/code-sign-fingerprint` (gitignored).

**Format:** UTF-8 plain text, single line, the bundle's designated requirement string verbatim, as emitted by:

```sh
codesign -d -r- "$APP_DIR" 2>&1 \
    | sed -nE 's/^#?[[:space:]]*designated[[:space:]]+=>[[:space:]]+(.*)$/\1/p' \
    | head -1
```

The `sed` pattern tolerates two forms: `designated => identifier "…" and …` (Developer-ID-signed) and `# designated => cdhash H"…"` (ad-hoc). The leading `#?` makes the `#` optional.

A representative DR for a Developer-ID-signed bundle:

```
identifier "dev.tugtool.app.dev" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = Z67582R5Y8
```

**Lifecycle:**
- Captured at the end of `build-app`, after `codesign --verify --strict` confirms the bundle is valid. Atomic write: temp file in the same dir + `mv`.
- Compared at the start of `app-test`, before the per-invocation re-sign decision.
- `app-test` writes nothing to the sentinel — only `build-app` does.

**Decision matrix in `app-test`:**

| Sentinel exists? | Bundle DR == saved DR? | Action |
|---|---|---|
| Yes | Yes | Skip the re-sign entirely. Print `==> Re-sign skipped (bundle DR matches sentinel)`. |
| Yes | No | Fall through to the re-sign branch. After re-sign, re-extract DR; if still mismatched, print a 4-line `[warn]` block (drift). |
| No | (can't compare) | Fall through to the re-sign branch. No drift warn possible until the next `build-app` writes the sentinel. |

Under Developer ID signing the DR is stable, so the skip path is the common case. The skip-on-match optimization also avoids the unnecessary work of re-signing 5+ binaries every test invocation.

---

## What can break the AX grant (failure modes)

The AX grant survives across ordinary rebuilds because the DR stays stable under Developer ID. It breaks when something perturbs the DR shape or the TCC database itself.

1. **Developer ID cert re-issued.** A new cert produces a leaf-level different DR (though the structural shape stays). TCC grants are leaf-sensitive in some macOS versions; you may need to re-grant once. The fingerprint sentinel detects this on the next `build-app`.
2. **`Tug.app` bundle moved or renamed.** TCC also keys grants on bundle path / identifier; relocating the build product will invalidate the grant.
3. **`CFBundleIdentifier` changes** (e.g., a worktree on a non-main branch produces `dev.tugtool.app.development-<slug>` per [D10]). Each `(profile, branch)` identity is a distinct LaunchServices app with its own TCC entry. First launch of a new identity prompts; subsequent launches of the same identity don't.
4. **Bare `xcodebuild` between runs** (or an Xcode IDE Build click). Re-signs ad-hoc with a fresh `cdhash` → wholly different DR. `app-test`'s per-invocation re-sign restores Developer ID transparently — but only if the cert is still installed.
5. **macOS major upgrade.** A major version bump can occasionally wipe TCC entries. Diagnoses as a one-shot re-grant requirement.
6. **Manual revoke** in System Settings → Privacy & Security → Accessibility, untoggling `Tug.app`.

---

## Diagnosis checklist (when AX is broken)

When `just app-test` starts failing with `AccessibilityPermissionMissingError` or every CGEvent-backed test silently no-ops, walk these in order. (This list also lives in [`tests/app-test/README.md`](../tests/app-test/README.md) for the test-author audience.)

1. **Confirm the Developer ID cert is still installed:**
   ```sh
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```
   Empty → run `just setup-dev-signing` for instructions on installing via Xcode, then `just build-app`.

2. **Confirm the bundle's DR matches the sentinel:**
   ```sh
   APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
       -configuration Debug -destination 'platform=macOS,arch=arm64' \
       -showBuildSettings 2>/dev/null \
       | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/Tug.app"
   diff <(codesign -d -r- "$APP_DIR" 2>&1 \
       | sed -nE 's/^#?[[:space:]]*designated[[:space:]]+=>[[:space:]]+(.*)$/\1/p' \
       | head -1) \
        .tugtool/code-sign-fingerprint
   ```
   Empty diff → fingerprint is fresh. Non-empty → drift; the AX grant may be invalidated.

3. **Confirm Accessibility shows `Tug.app` and is enabled:** open System Settings → Privacy & Security → Accessibility. If `Tug.app` isn't listed, run `just app-test harness-smoke/smoke-native.test.ts` once to trigger the system grant dialog.

4. **If the grant is stale and re-toggling doesn't work, reset and re-grant:**
   ```sh
   tccutil reset Accessibility dev.tugtool.app.dev    # for development-main
   ```
   Then run `just app-test harness-smoke/smoke-native.test.ts` to trigger the dialog fresh. Substitute the actual `CFBundleIdentifier` from `Info.plist` if you're on a non-main branch.

5. **Last resort — bypass the re-sign entirely:**
   ```sh
   APP_TEST_SKIP_RESIGN=1 just app-test
   ```
   Useful when diagnosing whether the re-sign step itself is the culprit. CGEvent-dependent tests will fail; protocol-only smoke tests will pass.

---

## Design decisions

These live in [`roadmap/tug-multi-instance.md`](../roadmap/tug-multi-instance.md). The most relevant are:

- **[D11]** — Apple Developer ID + notarization + hardened runtime. All builds (debug and release) sign with the Developer ID Application certificate. Notarization is release-only.
- **[D16]** — Per-binary entitlements; inside-out signing replaces `--deep`. The bash-coded contract in `sign-bundle.sh` is the single source of signing truth.

Cross-cutting decisions worth knowing:

### `--force --options runtime --timestamp` on every codesign invocation

- `--force` — replaces existing signatures (xcodebuild's ad-hoc, or a prior Developer ID sig from a previous run).
- `--options runtime` — engages the hardened runtime sandbox. Without it, the bundle won't notarize and the platform's modern protections don't apply.
- `--timestamp` — requests a secure timestamp from Apple's TSA. Required for notarization; without it, notary submission fails.

### `--deep` is FORBIDDEN for signing; valid for verification

`--deep` applies the same entitlements (or no entitlements) to every nested binary. Wrong for our bundle shape — tugcode needs permissive JIT entitlements; the Rust helpers and outer Swift binary do not. The inside-out script in `sign-bundle.sh` enumerates each binary explicitly. Verification (`codesign --verify --deep --strict`) is fine; it walks the bundle and *checks* signatures, doesn't replace them.

### Do *not* set `CODE_SIGN_IDENTITY = "Developer ID Application: …"` in `project.pbxproj`

The Xcode project keeps `CODE_SIGN_STYLE = Automatic` (which produces ad-hoc signatures from xcodebuild). The "overwrite-after-xcodebuild" approach via `sign-bundle.sh` stays. Reasons:

- pbxproj edits are awkward — Xcode rewrites the file on its own schedule; manual edits can get reformatted, conflict on merge, or behave unpredictably across Xcode versions.
- The post-xcodebuild re-sign already works correctly and is the place where per-binary entitlements get applied.
- Putting a specific identity in pbxproj would force every contributor through the Xcode-Settings-Accounts setup for *any* build — including non-test debugging via Xcode IDE.

---

## Notarization (release builds only)

Release builds destined for distribution must be **notarized** by Apple before macOS Gatekeeper will accept them on a clean machine. A notarized bundle has Apple's notary ticket stapled into it; first launch on the user's Mac doesn't need an internet round-trip to Apple's servers.

The pipeline:

```
just notarize        →  build-app.sh           →  sign-bundle.sh    (inside-out signing)
                                                 ↓
                                                 notarize.sh       (submit + wait + staple)
                                                 ↓
                                                 hdiutil create    (DMG)
```

`tugrust/scripts/notarize.sh` is the canonical notarizer. It packs the bundle via `ditto -c -k --keepParent`, submits to Apple's notary service with `--wait --timeout 30m` (typical wait: 5-15 min; ceiling: 30 min), staples the ticket via `xcrun stapler staple`, validates via `xcrun stapler validate`, and confirms Gatekeeper acceptance via `spctl --assess --type execute --verbose`.

Auth uses the `tug-notary` keychain profile (see [#apple-prereqs](../roadmap/tug-multi-instance.md#apple-prereqs) step 5), not inline `APPLE_ID` / `TEAM_ID` / `NOTARY_PASSWORD` env vars. The profile stores the credentials in the user's login keychain once; the script references it by name. Never put the app-specific password in command history, env files, or CI logs.

### Failure modes

On notary failure, `notarize.sh` extracts the submission UUID from `notarytool`'s tee log and surfaces an actionable hint:

```
xcrun notarytool log <UUID> --keychain-profile tug-notary
```

It also attempts to fetch the log inline (best effort — fails silently if notary never recorded the submission). The most common rejection causes:

- **Missing hardened-runtime flag** on a nested binary. `sign-bundle.sh` always uses `--options runtime` so this shouldn't happen, but a regression there would surface as a notary rejection within a minute of submission.
- **Missing secure timestamp**. `--timestamp` is required; same as above, `sign-bundle.sh` always sets it.
- **Disallowed entitlement**. Apple's notary allows the five tugcode permissive entitlements ([D16]); future additions must be checked against Apple's hardened-runtime entitlement reference.

### Gatekeeper quarantine test (canonical end-user verification)

The most realistic test of "would a real user be able to launch this from a downloaded DMG?" is to apply the quarantine xattr to a fresh copy of the notarized bundle, then `open` it:

```sh
# Copy the notarized bundle to a clean location.
cp -R build/staging/Tug.app /tmp/Tug-quarantine-test.app

# Apply the quarantine xattr that Safari/Mail/AirDrop attach to
# downloaded files. The exact value doesn't matter much; the
# presence of the attribute triggers Gatekeeper's full assessment
# on first launch.
xattr -w com.apple.quarantine '0181;00000000;;' /tmp/Tug-quarantine-test.app

# Launch. Gatekeeper should accept silently; macOS should NOT show
# the "downloaded from internet, can't verify" dialog.
open /tmp/Tug-quarantine-test.app
```

The launch is the test. If macOS shows a security dialog ("you can't open this app because the developer cannot be verified" or similar), notarization didn't take or the staple wasn't applied. Inspect via:

```sh
xcrun stapler validate /tmp/Tug-quarantine-test.app
spctl --assess --type execute --verbose /tmp/Tug-quarantine-test.app
```

`spctl` should report `source=Notarized Developer ID` (NOT `source=Unnotarized Developer ID`).

## What we deliberately don't do (yet)

- **No notarization on debug builds.** Notarization is release-only ([D11]); debug builds skip the 5-30 minute notary round-trip. `build-app.sh --skip-notarize` opts out for fast iteration.
- **No App Sandbox.** Tug doesn't enable `com.apple.security.app-sandbox`. Required for Mac App Store distribution; optional for Developer ID. Out of scope; may be revisited if/when MAS becomes interesting.
- **No CI integration for app-test.** The AX grant requires an interactive macOS session; CI runners that don't have AX access can't run the AT-suite.
- **No multi-user keychain coordination.** Single-user-per-machine assumption.

---

## Files in scope

| File | Role |
|---|---|
| `scripts/setup-dev-signing.sh` | Verifies the Developer ID cert is installed; prints install instructions if not. |
| `tugrust/scripts/sign-bundle.sh` | Canonical inside-out signer. Single source of signing truth. |
| `tugrust/scripts/notarize.sh` | Submits to Apple notary, staples ticket, verifies Gatekeeper. Release path only. |
| `tugrust/scripts/build-app.sh` | Production / release build pipeline; calls `sign-bundle.sh` then `notarize.sh`. |
| `Justfile` `build-app` recipe | Dev build pipeline; calls `sign-bundle.sh`; captures sentinel. |
| `Justfile` `app-test` recipe | DR + sentinel comparison; defensive re-sign; `APP_TEST_SKIP_RESIGN=1` opt-out. |
| `Justfile` `teardown-dev-signing` recipe | Clears the sentinel. |
| `tugapp/Tug.entitlements` | Outer Swift binary entitlements (minimal). |
| `tugapp/tugcode.entitlements` | bun-permissive entitlements for the `tugcode` binary. |
| `.tugtool/code-sign-fingerprint` | Drift-detection sentinel. Gitignored. Written by `build-app`. |
| `tests/app-test/README.md` | Test-author-facing version of the diagnosis checklist. |

---

## Cross-references

- [`roadmap/tug-multi-instance.md`](../roadmap/tug-multi-instance.md) — `[D11]`, `[D16]`, `#signing-flow`, `#apple-prereqs`; full design rationale.
- [`tests/app-test/README.md`](../tests/app-test/README.md) — test-author-facing usage + failure-mode diagnosis.
- [`scripts/setup-dev-signing.sh`](../scripts/setup-dev-signing.sh) — the per-machine verifier.
- [`tugrust/scripts/sign-bundle.sh`](../tugrust/scripts/sign-bundle.sh) — heavy comments explaining each phase.
