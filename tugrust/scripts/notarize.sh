#!/bin/bash
set -euo pipefail

# notarize.sh — submit a signed Tug.app bundle to Apple's notary
# service, wait for the ticket, staple it, and verify Gatekeeper
# acceptance.
#
# Usage:
#   notarize.sh <APP_PATH>
#
# Preconditions:
#   - The bundle has been signed inside-out via sign-bundle.sh (Step 3
#     of the multi-instance plan; #signing-flow). Notary submission
#     enforces hardened-runtime + secure timestamp signing, which is
#     exactly what sign-bundle.sh produces.
#   - A notarytool keychain profile named `tug-notary` is installed in
#     the user's login keychain (#apple-prereqs step 5). Verify via
#     `xcrun notarytool history --keychain-profile tug-notary` — it
#     should print "No submission history." (or a prior history),
#     not an authentication error.
#
# Postcondition (on success):
#   - The bundle has Apple's notarization ticket stapled to it (so
#     end users can launch without an internet round-trip).
#   - `xcrun stapler validate` and `spctl --assess --type execute`
#     both succeed.
#   - A distribution-ready zip sits at <APP_PATH minus .app>.zip,
#     re-created from the stapled bundle (the submission zip is
#     pre-staple and unsuitable for distribution).
#
# Round-trip cost: typically 5-15 minutes; ceiling at 30 minutes via
# notarytool's --timeout. If notary stalls past 30 minutes the script
# fails non-zero with the submission UUID and a hint for fetching the
# detailed log:
#   xcrun notarytool log <UUID> --keychain-profile tug-notary

if [ "$#" -ne 1 ]; then
    echo "usage: $(basename "$0") <APP_PATH>" >&2
    exit 2
fi

APP="$1"
if [ ! -d "$APP" ] || [ ! -d "$APP/Contents/MacOS" ]; then
    echo "error: $APP does not look like a .app bundle" >&2
    exit 1
fi

KEYCHAIN_PROFILE="tug-notary"
TIMEOUT="30m"
ZIP="${APP%.app}.zip"

# Sanity-check the keychain profile up front. `notarytool history`
# is the lightest auth-only call; a hard failure here means the
# profile is missing or the underlying app-specific password was
# rotated. Surfacing it before the (potentially long) submit avoids
# burning Apple's rate-limit on a misconfigured run.
if ! xcrun notarytool history --keychain-profile "$KEYCHAIN_PROFILE" >/dev/null 2>&1; then
    echo "error: notarytool keychain profile '$KEYCHAIN_PROFILE' is missing or invalid" >&2
    echo "       restore via #apple-prereqs step 5:" >&2
    echo "         xcrun notarytool store-credentials $KEYCHAIN_PROFILE \\" >&2
    echo "             --apple-id <apple-id> --team-id <team-id> --password <app-specific-password>" >&2
    exit 1
fi

cleanup() {
    rm -f "$SUBMIT_LOG"
}
SUBMIT_LOG="$(mktemp -t notarize-submit.XXXXXX.log)"
trap cleanup EXIT INT TERM

# `ditto -c -k --keepParent` zips a directory while preserving extended
# attributes and resource forks — the only safe way to pack a .app for
# notary submission. Plain `zip` strips xattrs and breaks the bundle.
echo "==> Packing $APP for submission"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> Submitting to Apple notary service (typical wait: 5-15 min, ceiling: $TIMEOUT)"
if ! xcrun notarytool submit "$ZIP" \
        --keychain-profile "$KEYCHAIN_PROFILE" \
        --wait \
        --timeout "$TIMEOUT" 2>&1 | tee "$SUBMIT_LOG"; then
    echo "==> Notarization FAILED" >&2
    # notarytool's --wait output includes a line like `id: <uuid>` near
    # the start; grab it for the log-fetch hint regardless of why the
    # submission failed (timeout, rejection, transient infra blip).
    UUID="$(awk '/^[[:space:]]*id:[[:space:]]+/ {print $2; exit}' "$SUBMIT_LOG")"
    if [ -n "$UUID" ]; then
        echo "==> Submission UUID: $UUID" >&2
        echo "==> Fetch the detailed log via:" >&2
        echo "      xcrun notarytool log $UUID --keychain-profile $KEYCHAIN_PROFILE" >&2
        # Best-effort: print the log inline. If this fails (e.g. notary
        # never recorded the submission), the user still has the UUID.
        echo "==> Inline log (best effort):" >&2
        xcrun notarytool log "$UUID" --keychain-profile "$KEYCHAIN_PROFILE" >&2 || true
    else
        echo "==> No submission UUID found in tee log; check $SUBMIT_LOG" >&2
        cat "$SUBMIT_LOG" >&2
    fi
    rm -f "$ZIP"
    exit 1
fi

# Notary returns success; staple the ticket into the bundle so end
# users don't need to round-trip to Apple's server on first launch.
echo "==> Stapling ticket to bundle"
xcrun stapler staple "$APP"

echo "==> Validating staple"
xcrun stapler validate "$APP"

echo "==> Gatekeeper assessment"
# `--type execute` matches the policy class Gatekeeper applies to
# .app bundles launched via LaunchServices. `--verbose` makes the
# `source=Notarized Developer ID` line visible (this is the magic
# string we want).
spctl --assess --type execute --verbose "$APP"

# The submission zip is pre-staple — it doesn't contain the ticket
# and won't pass Gatekeeper if someone downloads it as-is. Replace
# it with a fresh zip of the stapled bundle for distribution.
echo "==> Repacking stapled bundle for distribution"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> Notarized + stapled: $APP"
echo "    Distribution zip:   $ZIP"
