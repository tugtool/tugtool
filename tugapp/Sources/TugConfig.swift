import Foundation

/// Centralized configuration constants for the Tug app.
/// Tugcast CLI flags have their own defaults (session=cc0, port=55255, dir=.).
/// ProcessManager only passes flags it has explicit values for, so tugcast's
/// defaults are never duplicated here.
enum TugConfig {
    // MARK: - Port constants

    /// Default port for the Vite dev server.
    ///
    /// This is the single source of truth for the Vite dev server port in Swift code.
    /// The actual port is communicated at runtime via the `vite_port` field of the
    /// `DevMode` control message; this constant serves as the default when no override
    /// is provided.
    static let defaultVitePort: Int = 55155

    // MARK: - UserDefaults keys

    static let keySourceTreePath = "SourceTreePath"
    static let keyDevModeEnabled = "DevModeEnabled"
    static let keyWindowBackground = "TugWindowBackground"

    /// Persisted mirror of the `tugdeck-layout` localStorage key.
    /// Used to carry card layout settings across origin switches (dev/prod ports).
    static let keyTugdeckLayout = "TugdeckLayout"

    /// Persisted mirror of the `td-theme` localStorage key.
    /// Used to carry theme settings across origin switches (dev/prod ports).
    static let keyTugdeckTheme = "TugdeckTheme"

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
