import Foundation

/// Centralized configuration constants for the Tug app.
/// Tugcast CLI flags have their own defaults (session=cc0, port=55255, dir=.).
/// ProcessManager only passes flags it has explicit values for, so tugcast's
/// defaults are never duplicated here.
enum TugConfig {
    // MARK: - UserDefaults keys

    static let keySourceTreePath = "SourceTreePath"
    static let keyDevModeEnabled = "DevModeEnabled"

    // MARK: - Source tree validation

    /// Paths that must exist (relative to repo root) for a directory
    /// to be accepted as a valid tugtool source tree.
    static let sourceTreeMarkers = [
        "tugdeck/package.json",
        "tugcode/Cargo.toml",
    ]

    /// Check whether a directory looks like the tugtool repo root.
    static func isValidSourceTree(_ url: URL) -> Bool {
        sourceTreeMarkers.allSatisfy { marker in
            FileManager.default.fileExists(atPath: url.appendingPathComponent(marker).path)
        }
    }
}
