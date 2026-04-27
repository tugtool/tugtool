# Code Signing on macOS — `Tug Dev` Self-Signed Identity

*The signing pipeline that gives `Tug.app` a stable signature hash across rebuilds, why the app-test harness depends on it, and the procedures + failure modes you need to know. Read this before changing anything in `Justfile`'s `build-app` or `app-test` recipes, in `scripts/setup-dev-signing.sh`, or in the bundle's signing settings inside Xcode.*

> **Platform scope.** This document is **macOS-only**. The whole pipeline is structured around Apple's TCC database, the `security` CLI, the `codesign` tool, Xcode's build settings, and macOS Accessibility (AX) permissions. None of it has a meaningful analogue on Linux or Windows. When tugtool grows non-Mac dev hosts — a Linux build agent, a Windows port, anything that produces a runnable artifact — each platform will need its own signing-and-trust story documented as a sibling file (`code-signing-linux.md`, `code-signing-windows.md`, etc.); the file is named `code-signing-mac.md` to leave that namespace open. Everything below is "the Mac dev workflow."

*Cross-references: `[D##]` → decisions in [`roadmap/tugplan-signing-hardening.md`](../roadmap/tugplan-signing-hardening.md). Plan close-out captures the per-step implementation history; this document is the durable reference.*

---

## Why we sign at all

The app-test harness drives `Tug.app` through trusted hardware events — `CGEvent.post`-backed clicks, drags, key presses. WebKit's `isTrusted` paths (default-focus on click, drag selection, double-click word-select, modifier-key accelerators) only fire for trusted events, and posting trusted events requires the macOS **Accessibility (AX) grant**: System Settings → Privacy & Security → Accessibility, with `Tug.app` toggled on.

The AX grant is not a one-time global thing. macOS's TCC (Transparency, Consent, Control) database keys grants on the **bundle's designated requirement (DR)** — a string that includes the bundle identifier *and* the leaf hash of the certificate that signed it. Two binaries with the same DR are interchangeable as far as TCC is concerned. Two with different DRs require a fresh user grant.

**The problem.** Xcode Debug builds default to **ad-hoc signing**, which produces a fresh random signature every time `xcodebuild` runs. Different signature → different DR → AX grant invalidated → `CGEvent.post` silently no-ops → every app-test scenario fails with confusing attribution. In a tight test-edit-test loop, the developer would have to re-grant Accessibility every minute.

**The fix.** Sign the bundle with a **stable, self-signed identity** — same private key on every build, same DR, same TCC grant. The grant survives rebuilds. CGEvent works. Tests pass.

We picked self-signed because it's free, doesn't require an Apple Developer account ($99/year), and is keychain-local: each developer generates their own private key, never shared. The shared piece across developers is the **identity name** (`Tug Dev`), so `codesign --sign "Tug Dev"` works on every machine — even though each machine's `Tug Dev` cert has a different keypair.

---

## The architecture (five moving parts)

| Component | Responsibility |
|---|---|
| `scripts/setup-dev-signing.sh` | One-shot per machine. Generates a self-signed cert + RSA-2048 key, packages as PKCS#12, imports into the login keychain with `codesign` whitelisted on the private key. Idempotent. |
| `Tug.xcodeproj`'s build settings | `CODE_SIGN_STYLE = Automatic`. xcodebuild signs ad-hoc by default. We deliberately do **not** override the project's signing identity at the pbxproj level. ([D-not-pbxproj](#dec-not-pbxproj).) |
| `just build-app` step [5/5] | After `xcodebuild`, **overwrite** the ad-hoc signature with `codesign --sign "Tug Dev" --force --deep --preserve-metadata=entitlements,requirements`. Then `codesign --verify --strict` to confirm the bundle is valid. Then capture the bundle's DR into `.tugtool/code-sign-fingerprint`. |
| `just app-test` per-invocation re-sign | Defensive — protects against the case where someone ran a bare `xcodebuild` (or clicked Build in Xcode IDE) between test runs and ad-hoc-re-signed the bundle. Skipped when the bundle's current DR already matches the sentinel (the steady-state case — saves ~100ms). |
| `Tug.entitlements` | One entry: `com.apple.security.cs.allow-unsigned-executable-memory` (for WKWebView's JIT). Preserved by the re-sign via `--preserve-metadata=entitlements,requirements`. |

The fingerprint sentinel at `.tugtool/code-sign-fingerprint` is the keystone of drift detection. It records the bundle's DR after the last successful `build-app`. Subsequent `app-test` invocations compare the bundle's current DR to it; mismatch surfaces a `[warn]` block before any tests run.

---

## Procedures

### First-time setup (per machine, ~2 minutes)

```sh
just setup-dev-signing      # creates 'Tug Dev' identity in login keychain
just build-app              # builds Tug.app + signs with 'Tug Dev'
just app-test-smoke         # first run pops the AX grant dialog
```

When the AX grant dialog appears, click "Open System Settings" and toggle `Tug.app` on under Privacy & Security → Accessibility. Subsequent runs work without prompting because every build signs with the same `Tug Dev` identity → same DR → the grant persists.

### Day-to-day flow

After the one-time setup, the loop is:

```sh
just build-app    # only when Swift / Rust / tugdeck-dist sources changed
just app-test     # full sweep, or just app-test <files...>
```

`just app-test` is HMR-friendly for tugdeck (it runs `bun run build` to refresh `tugdeck/dist` on every invocation). Swift changes still need `just build-app`.

### Decommissioning (rarely needed)

```sh
just teardown-dev-signing
```

Removes the `Tug Dev` identity from the login keychain (`security delete-identity -c "Tug Dev"`) and clears the sentinel. Idempotent: re-running after teardown reports "nothing to remove."

To restore working signing afterward: `just setup-dev-signing && just build-app`.

### Onboarding without `setup-dev-signing`

A contributor who just wants to read or edit the source — without running the test harness — does **not** need to run `just setup-dev-signing`. They can:

- Build via Xcode IDE or `xcodebuild` directly (ad-hoc signature; works fine for non-test runs).
- Run `just app-test` with `APP_TEST_SKIP_RESIGN=1` to skip the re-sign step (tests requiring AX-granted CGEvent.post will fail, but tests that don't need AX — `harness-smoke/smoke.test.ts`, `version-handshake.test.ts`, `wait-for-condition.test.ts`, `double-connect.test.ts`, `smoke-em.test.ts` — will pass).

This is the **escape hatch**, deliberately preserved. ([D03](#dec-skip-resign-env).)

---

## Spec: the fingerprint sentinel

**Path:** `.tugtool/code-sign-fingerprint` (gitignored).

**Format:** UTF-8 plain text, single line, the bundle's designated requirement string verbatim, as emitted by:

```sh
codesign -d -r- "$APP_DIR" 2>&1 | awk -F'=> ' '/^designated/{print $2; exit}'
```

A representative DR for a `Tug Dev`-signed bundle:

```
identifier "dev.tugtool.app" and certificate leaf = H"3398c0ec53f6200eeb44e30d38a90741fd984791"
```

The DR captures **two** identity-relevant pieces: the bundle identifier (`dev.tugtool.app`) and the cert's SHA-1 leaf hash (`H"…"`). Either changing forces a new TCC grant.

**Lifecycle:**
- Captured at the end of `build-app`, after `codesign --verify --strict` confirms the bundle is valid. Atomic write: temp file in the same dir + `mv`.
- Compared at the start of `app-test`, before the per-invocation re-sign decision.
- `app-test` writes nothing to the sentinel — only `build-app` does. ([D02](#dec-sentinel-path).)

**Decision matrix in `app-test`:**

| Sentinel exists? | Bundle DR == saved DR? | Action |
|---|---|---|
| Yes | Yes | Skip the re-sign entirely. Print `==> Re-sign skipped (bundle DR matches sentinel)`. |
| Yes | No | Fall through to the re-sign branch. After re-sign, re-extract DR; if still mismatched, print a 4-line `[warn]` block (drift). |
| No | (can't compare) | Fall through to the re-sign branch. No drift warn possible until the next `build-app` writes the sentinel. |

The skip-on-match optimization isn't *just* a perf win — it's slightly more correct. If the `Tug Dev` cert has been re-created since the last `build-app`, re-signing the bundle would replace the OLD cert's signature with the NEW cert's signature, *invalidating* the still-valid AX grant for the old DR. Skip-on-match preserves the grant.

---

## What can break the AX grant (failure modes)

The AX grant survives across ordinary rebuilds because the DR stays stable. It breaks when something perturbs the DR or the TCC database itself.

1. **`Tug Dev` cert deleted and re-created** without rebuilding. A new self-signed cert has a different private key → different leaf hash → different DR. The old bundle still has the OLD signature, so AX may still work *until* something re-signs it (a `build-app` or `app-test` re-sign with the new cert). The fingerprint sentinel detects this on the next `build-app`.
2. **`Tug.app` bundle moved or renamed.** TCC also keys grants on bundle path / identifier; relocating the build product or editing the bundle id in `project.pbxproj` will invalidate the grant.
3. **Bare `xcodebuild` between runs** (or an Xcode IDE Build click). Re-signs ad-hoc with a fresh random hash → wholly different DR. `app-test`'s per-invocation re-sign restores `Tug Dev` transparently — but only if the cert is still installed.
4. **macOS major upgrade.** A major version bump can occasionally wipe TCC entries. Diagnoses as a one-shot re-grant requirement.
5. **Manual revoke** in System Settings → Privacy & Security → Accessibility, untoggling `Tug.app`.

---

## Diagnosis checklist (when AX is broken)

When `just app-test` starts failing with `AccessibilityPermissionMissingError` or every CGEvent-backed test silently no-ops, walk these in order. (This list also lives in [`tests/app-test/README.md`](../tests/app-test/README.md) under "Accessibility grant failure modes" for the test-author audience.)

1. **Confirm the identity is still installed:**
   ```sh
   security find-identity -p codesigning | grep "Tug Dev"
   ```
   Empty → run `just setup-dev-signing` to recreate, then `just build-app`.

2. **Confirm the bundle's DR matches the sentinel:**
   ```sh
   APP_DIR="$(xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug \
       -configuration Debug -destination 'platform=macOS,arch=arm64' \
       -showBuildSettings 2>/dev/null \
       | awk '/ BUILT_PRODUCTS_DIR /{print $3}')/Tug.app"
   diff <(codesign -d -r- "$APP_DIR" 2>&1 | awk -F'=> ' '/^designated/{print $2; exit}') \
        .tugtool/code-sign-fingerprint
   ```
   Empty diff → fingerprint is fresh. Non-empty → drift; the AX grant is almost certainly invalidated.

3. **Confirm Accessibility shows `Tug.app` and is enabled:** open System Settings → Privacy & Security → Accessibility. If `Tug.app` isn't listed, run `just app-test harness-smoke/smoke-native.test.ts` once to trigger the system grant dialog.

4. **If the grant is stale and re-toggling doesn't work, reset and re-grant:**
   ```sh
   tccutil reset Accessibility dev.tugtool.app
   ```
   Then run `just app-test harness-smoke/smoke-native.test.ts` to trigger the dialog fresh.

5. **Last resort — bypass the re-sign entirely:**
   ```sh
   APP_TEST_SKIP_RESIGN=1 just app-test
   ```
   Useful when diagnosing whether the re-sign step itself is the culprit. CGEvent-dependent tests will fail; protocol-only smoke tests will pass.

---

## Design decisions

The signing pipeline lives at the intersection of macOS TCC, OpenSSL `pkcs12`, the Apple `security` CLI, `codesign`, and Xcode's build system. Decisions are recorded here to prevent accidentally undoing them.

### `[D01]` Identity is self-signed and per-machine {#dec-self-signed}

**Decision:** Each developer generates their own self-signed `Tug Dev` cert. We do **not** distribute a shared cert.

**Why:**
- No Apple Developer account / Team ID / paid membership required.
- Private keys never leave the developer's machine.
- The shared piece (the identity name) is enough — `codesign --sign "Tug Dev"` works on any machine that has run `setup-dev-signing.sh`.

**Implication:** Two developers' `Tug Dev` certs have *different* DR strings (different leaf hashes). Their AX grants are independent.

### `[D02]` Cert validity 10 years {#dec-cert-validity}

**Decision:** `setup-dev-signing.sh` generates the cert with `-days 3650`.

**Why:** Outlasts any reasonable project horizon. No rotation rituals; no expiry-related grant invalidation.

### `[D03]` `-T /usr/bin/codesign` whitelist on import {#dec-codesign-whitelist}

**Decision:** `security import` is invoked with `-T /usr/bin/codesign`, granting `codesign` access to the private key without a per-build keychain prompt.

**Why:** Without this flag, every `just build-app` invocation would pop a "let codesign access this key?" dialog. UX death by a thousand prompts. The whitelist is scoped to `codesign` specifically, not "all apps".

### `[D04]` `find-identity -p codesigning` *without* `-v` {#dec-find-identity-flags}

**Decision:** Both `setup-dev-signing.sh` and the recipes use `find-identity -p codesigning` (policy = code-signing) **without** the `-v` (valid-only) flag.

**Why:** A self-signed cert registers as `CSSMERR_TP_NOT_TRUSTED` because its root isn't in the system trust store. The `-v` filter would hide our identity. `codesign` itself doesn't require root trust — the `-T` whitelist is what matters.

### `[D05]` `--force --deep --preserve-metadata=entitlements,requirements` {#dec-codesign-flags}

**Decision:** The re-sign uses these flags and these alone.

**Why each flag:**
- `--force` — replaces the existing signature (xcodebuild's ad-hoc, or a previous `Tug Dev` sig). Without it, `codesign` refuses to re-sign.
- `--deep` — covers nested frameworks and bundles. Apple discourages `--deep` as of macOS 11+ in favor of explicit per-framework signing, but `Tug.app` has no embedded frameworks today, so the discouragement doesn't bite. If frameworks are ever added, this needs revisiting.
- `--preserve-metadata=entitlements,requirements` — keeps the `Tug.entitlements` file's contents (notably `allow-unsigned-executable-memory` for WKWebView JIT) and the designated requirement string. Without it, the re-sign would strip entitlements and the WebView would crash.

### `[D06]` Two re-sign sites: `build-app` and `app-test` (with skip optimization) {#dec-two-resign-sites}

**Decision:** `build-app` re-signs once (always); `app-test` re-signs only when the bundle's DR doesn't match the sentinel.

**Why:**
- `build-app`'s re-sign is the canonical one — it's what produces the sentinel and the AX-grant-keyed signature.
- `app-test`'s defensive re-sign protects against between-run perturbations (Xcode IDE Build, bare `xcodebuild`).
- The sentinel-driven skip avoids the corner case where re-signing with a re-created `Tug Dev` cert would silently replace the still-valid signature (and invalidate the still-valid AX grant). Skip-on-match preserves correctness.

### `[D07]` Fingerprint = full DR string, not a hash {#dec-fingerprint-shape}

**Decision:** `.tugtool/code-sign-fingerprint` stores the bundle's DR verbatim (~200 bytes, one line).

**Why:** Diagnostic value. A future debugger can `cat` the file and `diff` against `codesign -d -r-` output directly. A SHA-256 of the DR would save bytes but lose all signal.

### `[D08]` Drift = warning, not fatal {#dec-drift-warning}

**Decision:** When `app-test` detects fingerprint drift, it prints a `[warn]` block to stderr and continues.

**Why:** Drift means the AX grant is *probably* invalidated, but the user might have re-granted manually. A warning lets the test sweep run; if AX is actually broken the harness's per-spawn `AccessibilityPermissionMissingError` preflight will throw with full context. Treating drift as fatal would block legitimate "I just re-granted, let me run the tests" flows.

### `[D09]` `APP_TEST_SKIP_RESIGN=1` escape hatch {#dec-skip-resign-env}

**Decision:** `app-test` exits non-zero when `Tug Dev` is missing **unless** `APP_TEST_SKIP_RESIGN=1` is set; in which case it prints a notice and skips the re-sign.

**Why:** Onboarding flows ("I just cloned the repo and want to see the harness skip cleanly") and CI scenarios benefit from a documented skip path. Explicit opt-out is safer than silent fallthrough.

### `[D-not-pbxproj]` Do *not* set `CODE_SIGN_IDENTITY = "Tug Dev"` in `project.pbxproj` {#dec-not-pbxproj}

**Decision:** The Xcode project keeps `CODE_SIGN_STYLE = Automatic` and does not name `Tug Dev` directly. The "overwrite-after-xcodebuild" approach stays.

**Why:**
- Putting `Tug Dev` in pbxproj would force every contributor through `setup-dev-signing.sh` for *any* build — including non-test debugging via Xcode IDE. The audit and post-Phase-1 review concluded the friction-on-onboarding cost outweighed the ~50ms saved by signing once instead of twice.
- pbxproj edits are awkward — Xcode rewrites the file on its own schedule; manual edits can get reformatted, conflict on merge, or behave unpredictably across Xcode versions.
- A command-line `CODE_SIGN_IDENTITY="Tug Dev" CODE_SIGN_STYLE=Manual` override on `xcodebuild` was identified as a less-disruptive alternative if anyone ever revisits this — but it's also deferred since the post-resign overwrite already works correctly.

---

## What we deliberately don't do

- **No notarization.** Local-dev signing only. Not distributing the bundle.
- **No hardened-runtime entitlement.** Would require notarization for CGEvent paths to work with system-level integrity checks.
- **No CI integration.** The AX grant requires an interactive macOS session; CI runners that don't have AX access can't run the AT-suite. (Tracked as `tugplan-harness-extensions.md` `[Q01]`.)
- **No multi-user keychain coordination.** Single-user-per-machine assumption. Each user gets their own login keychain, their own `Tug Dev`, their own grant.
- **No certificate rotation.** 10-year validity outlasts the project; rotation would force every user to re-grant AX.

---

## Files in scope

| File | Role |
|---|---|
| `scripts/setup-dev-signing.sh` | Cert + key generation; PKCS#12 packaging; `security import` with `-T /usr/bin/codesign`. |
| `Justfile` `build-app` recipe | Build pipeline; re-sign; `codesign --verify --strict`; sentinel capture. |
| `Justfile` `app-test` recipe | DR + sentinel comparison; skip-on-match; defensive re-sign; drift warn; `APP_TEST_SKIP_RESIGN=1` opt-out. |
| `Justfile` `teardown-dev-signing` recipe | Removes the cert and clears the sentinel. |
| `Tug.entitlements` | Single entry — preserved by the re-sign's `--preserve-metadata`. |
| `.tugtool/code-sign-fingerprint` | Drift-detection sentinel. Gitignored. Written by `build-app`. |
| `tests/app-test/README.md` § "Accessibility grant failure modes" | Test-author-facing version of the diagnosis checklist. |

---

## Cross-references

- [`roadmap/tugplan-signing-hardening.md`](../roadmap/tugplan-signing-hardening.md) — Phase 1 + Phase 2 implementation history; per-step commit map; explicit deferrals.
- [`tests/app-test/README.md`](../tests/app-test/README.md) — test-author-facing usage guidance + failure-mode diagnosis checklist.
- [`scripts/setup-dev-signing.sh`](../scripts/setup-dev-signing.sh) — the one-shot setup script (heavy comments explaining why each step exists).
- [`roadmap/tugplan-harness-extensions.md`](../roadmap/tugplan-harness-extensions.md) `[D14]` — the original "stable code-signing required" decision that motivated this whole pipeline.
- [`tuglaws/app-test-inventory.md`](app-test-inventory.md) — the AT-tag scenario catalog the signing pipeline ultimately serves.
