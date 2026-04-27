#!/usr/bin/env bash
#
# setup-dev-signing.sh — Create the per-machine self-signed code-
# signing identity used by `just build-app` to re-sign Tug.app
# with a stable signature hash.
#
# ## Why this exists
#
# macOS TCC (the Accessibility-permissions database) keys on the
# binary's code-signature hash. Xcode Debug builds default to ad-hoc
# signing, which produces a fresh random hash on every rebuild — so
# the Accessibility grant gets invalidated on every `xcodebuild`
# pass. The app-test harness's native-event verbs (CGEvent-backed
# clicks, drags, key events) use `CGEvent.post`, which silently no-ops
# without Accessibility permission. A stable signature hash is the
# only tractable fix.
#
# Signing with a stable identity (self-signed is sufficient for
# local dev) produces the same hash every build; the grant persists.
# This script creates one named `Tug Dev` in the login keychain if
# one doesn't exist.
#
# ## What gets created vs. shared
#
# Each dev gets their own private key (kept local, never checked in).
# The shared piece across devs is the identity NAME (`Tug Dev`), so
# `codesign --sign "Tug Dev"` in the Justfile works the same on every
# machine. Each dev grants Accessibility permission once on their
# own machine; grant persists forever for their builds.
#
# ## Idempotency
#
# Re-runs are safe. If `Tug Dev` already exists in the login keychain,
# the script exits 0 immediately.

set -euo pipefail

IDENTITY_NAME="Tug Dev"
LOGIN_KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
VALIDITY_DAYS=3650  # ~10 years; long enough to outlast this project.

# --- 1. Bail out if the identity already exists ------------------------------
#
# Note: we DON'T use `find-identity -v` (valid-only). A self-signed
# cert registers as CSSMERR_TP_NOT_TRUSTED because its root isn't in
# the system trust store; that's fine — we gave `codesign` direct
# access to the private key via `-T /usr/bin/codesign` on import, so
# codesign doesn't need root trust. The `-v` filter would hide our
# identity and make the check fire re-create on every run.

if security find-identity -p codesigning 2>/dev/null \
    | grep -q "\"${IDENTITY_NAME}\""; then
    echo "✓ '${IDENTITY_NAME}' already installed in login keychain."
    exit 0
fi

# --- 2. Sanity-check prerequisites ------------------------------------------

command -v openssl >/dev/null || {
    echo "error: openssl not on PATH. Install via: brew install openssl" >&2
    exit 1
}
command -v security >/dev/null || {
    echo "error: security(1) not on PATH. This script requires macOS." >&2
    exit 1
}
[ -f "${LOGIN_KEYCHAIN}" ] || {
    echo "error: login keychain not found at ${LOGIN_KEYCHAIN}" >&2
    exit 1
}

# --- 3. Generate the cert + key in a scratch dir ----------------------------

TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TMPDIR}"' EXIT

echo "Generating self-signed '${IDENTITY_NAME}' certificate..."
openssl req -x509 -newkey rsa:2048 \
    -keyout "${TMPDIR}/key.pem" \
    -out "${TMPDIR}/cert.pem" \
    -days "${VALIDITY_DAYS}" \
    -nodes \
    -subj "/CN=${IDENTITY_NAME}" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" \
    -addext "basicConstraints=critical,CA:FALSE" \
    >/dev/null 2>&1

# Package as .p12 for `security import`.
#
# Two OpenSSL quirks forced by Apple's Security framework:
#   1. `-legacy` — OpenSSL 3.x defaults to modern PKCS#12 MAC
#      algorithms that macOS Security doesn't support. Without
#      `-legacy` we'd get "MAC verification failed during PKCS12
#      import" from `security import`.
#   2. Non-empty password — Apple's `security import` rejects
#      empty-password .p12 files ("MAC verification failed"). We
#      use a throwaway password; the .p12 lives in a scratch dir
#      for ~200ms and the login keychain itself already requires
#      the user's keychain password to unlock on first use.
openssl pkcs12 -export \
    -out "${TMPDIR}/bundle.p12" \
    -inkey "${TMPDIR}/key.pem" \
    -in "${TMPDIR}/cert.pem" \
    -password pass:tug-dev-p12 \
    -legacy \
    >/dev/null 2>&1

# --- 4. Import into login keychain ------------------------------------------
#
# `-T /usr/bin/codesign` whitelists codesign to use the private key
# without a keychain-access prompt on every build. Without this, the
# first `just build-app` call would pop a keychain prompt.

echo "Importing '${IDENTITY_NAME}' into login keychain..."
security import "${TMPDIR}/bundle.p12" \
    -k "${LOGIN_KEYCHAIN}" \
    -P "tug-dev-p12" \
    -T /usr/bin/codesign \
    >/dev/null 2>&1

# --- 5. Verify install ------------------------------------------------------

if ! security find-identity -p codesigning 2>/dev/null \
    | grep -q "\"${IDENTITY_NAME}\""; then
    echo "error: '${IDENTITY_NAME}' import appeared to succeed but the" >&2
    echo "       identity is not visible to codesign. Check Keychain Access;" >&2
    echo "       the certificate may have landed in a non-login keychain." >&2
    exit 1
fi

echo "✓ '${IDENTITY_NAME}' installed in login keychain."
echo
echo "Next steps:"
echo "  1. Run 'just build-app' to build + sign Tug.app, then 'just"
echo "     app-test' — first app-test run triggers the Accessibility-"
echo "     permission system dialog."
echo "  2. Grant permission to Tug.app when the dialog appears."
echo "  3. Subsequent runs work without prompt; grant persists across"
echo "     rebuilds because every build signs with the same '${IDENTITY_NAME}'"
echo "     identity and produces the same signature hash."
