import AppKit
import Foundation
import Sparkle

/// Sparkle wrapper. Owns the `SPUStandardUpdaterController` and decides
/// whether this bundle is allowed to update itself at all.
///
/// Only the stable release identity (`dev.tugtool.app`) self-updates.
/// Debug and branch builds get rewritten bundle identifiers from
/// `assign-bundle-id.sh` and run out of DerivedData, and the nightly
/// identity has no feed of its own yet. `TUG_SPARKLE_FEED` overrides
/// both the gate and the feed URL so the update path can be exercised
/// against a locally served appcast.
///
/// References: roadmap/self-update.md [P01] [P06] [P07].
final class UpdateController: NSObject {
    /// Environment variable that both enables the updater and supplies
    /// the appcast URL, bypassing the bundle-identity gate.
    static let feedOverrideEnvVar = "TUG_SPARKLE_FEED"

    private static let stableBundleIdentifier = "dev.tugtool.app"

    private var updaterController: SPUStandardUpdaterController?

    /// Called with an update's `(displayVersion, build)` when a scheduled
    /// check finds one and the delegate — not Sparkle — is showing it.
    var onScheduledUpdateFound: ((String, String) -> Void)?

    /// True once Sparkle has been started. The "Check for Updates…" menu
    /// item is hidden while this is false.
    var isActive: Bool { updaterController != nil }

    private var feedOverride: String? {
        guard
            let value = ProcessInfo.processInfo.environment[Self.feedOverrideEnvVar],
            !value.isEmpty
        else { return nil }
        return value
    }

    /// Start Sparkle if this bundle is eligible, otherwise do nothing.
    func startIfEligible() {
        guard updaterController == nil else { return }

        if let feed = feedOverride {
            NSLog("UpdateController: starting with feed override \(feed)")
        } else {
            guard Bundle.main.bundleIdentifier == Self.stableBundleIdentifier else {
                NSLog(
                    "UpdateController: inactive — bundle identifier "
                        + "'\(Bundle.main.bundleIdentifier ?? "nil")' is not the stable release identity"
                )
                return
            }
            guard hasFeedConfiguration else {
                NSLog("UpdateController: inactive — SUFeedURL / SUPublicEDKey are not both set in Info.plist")
                return
            }
        }

        updaterController = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: self,
            userDriverDelegate: self
        )
    }

    /// Bring Sparkle's standard update flow into focus. Safe to call when
    /// the updater never started.
    func checkForUpdates() {
        guard let updaterController else {
            NSLog("UpdateController: check requested while inactive; ignoring")
            return
        }
        updaterController.checkForUpdates(nil)
    }

    /// Both keys must be present for Sparkle to have a feed to fetch and a
    /// key to verify signatures against. A bundle built before the feed was
    /// configured stays inactive rather than starting a half-configured
    /// updater.
    private var hasFeedConfiguration: Bool {
        func nonEmptyString(_ key: String) -> Bool {
            let value = Bundle.main.object(forInfoDictionaryKey: key) as? String
            return !(value ?? "").isEmpty
        }
        return nonEmptyString("SUFeedURL") && nonEmptyString("SUPublicEDKey")
    }
}

// MARK: - SPUUpdaterDelegate

extension UpdateController: SPUUpdaterDelegate {
    /// Returning nil lets the Info.plist `SUFeedURL` rule, which is the
    /// sanctioned way to override the feed (`setFeedURL` is discouraged).
    func feedURLString(for updater: SPUUpdater) -> String? {
        feedOverride
    }
}

// MARK: - SPUStandardUserDriverDelegate

extension UpdateController: SPUStandardUserDriverDelegate {
    var supportsGentleScheduledUpdateReminders: Bool { true }

    /// User-initiated checks never reach here — Sparkle always handles those.
    /// Scheduled finds are handed to the deck instead of Sparkle's alert,
    /// unless nothing is listening, in which case Sparkle's own alert is
    /// still better than a silently swallowed update.
    func standardUserDriverShouldHandleShowingScheduledUpdate(
        _ update: SUAppcastItem,
        andInImmediateFocus immediateFocus: Bool
    ) -> Bool {
        let handled = onScheduledUpdateFound == nil
        NSLog(
            "UpdateController: scheduled update %@ — sparkle shows it: %@",
            update.displayVersionString,
            handled ? "yes" : "no"
        )
        return handled
    }

    func standardUserDriverWillHandleShowingUpdate(
        _ handleShowingUpdate: Bool,
        forUpdate update: SUAppcastItem,
        state: SPUUserUpdateState
    ) {
        NSLog(
            "UpdateController: will show update %@ (sparkle handles: %@, userInitiated: %@)",
            update.displayVersionString,
            handleShowingUpdate ? "yes" : "no",
            state.userInitiated ? "yes" : "no"
        )
        guard !handleShowingUpdate else { return }
        onScheduledUpdateFound?(update.displayVersionString, update.versionString)
    }
}
