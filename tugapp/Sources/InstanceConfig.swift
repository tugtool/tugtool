import Foundation

/// Per-instance identity and path helpers — Swift mirror of
/// `tugcore::instance` on the Rust side.
///
/// Every long-lived per-instance resource (tugbank DB, session
/// ledger, notify socket, log directory, bundle-path marker) derives
/// its path from a single identifier — `instanceId`. At runtime Swift
/// owns the computation: it resolves the identity from `BuildInfo`
/// (which read it from Info.plist at first access) and propagates it
/// to every spawned child via the `TUG_INSTANCE_ID` environment
/// variable (per [D12]).
///
/// A harness override is supported: setting `TUG_INSTANCE_ID` in the
/// app's environment before launch makes `InstanceConfig` use that
/// value instead of `BuildInfo.instanceId`. The override exists so
/// test rigs can construct synthetic identities pointing at temp
/// data dirs without rebuilding the bundle.
///
/// References: roadmap/tug-multi-instance.md [D04] [D05] [D12].
enum InstanceConfig {
    /// Environment variable name carrying the runtime instance ID.
    /// Kept in sync with `tugcore::instance::ENV_INSTANCE_ID`.
    static let envInstanceID = "TUG_INSTANCE_ID"

    /// Environment variable name carrying the absolute path of the
    /// running app bundle. Swift sets this when spawning tugcast so
    /// tugcast can write the per-instance bundle-path marker. Kept
    /// in sync with `tugcore::instance::ENV_BUNDLE_PATH`.
    static let envBundlePath = "TUG_BUNDLE_PATH"

    /// File name of the per-instance bundle-path marker. Kept in
    /// sync with `tugcore::instance::BUNDLE_PATH_MARKER`.
    static let bundlePathMarkerName = "bundle-path"

    /// Canonical per-instance identifier for this process. Reads
    /// `TUG_INSTANCE_ID` from the environment first (harness
    /// override) and falls back to `BuildInfo.instanceId`. Frozen
    /// on first access.
    static let instanceId: String = {
        if let override = ProcessInfo.processInfo.environment[envInstanceID],
           !override.isEmpty {
            return override
        }
        return BuildInfo.instanceId
    }()

    /// Per-instance data directory: `<base>/Tug/instances/<id>/`.
    /// On macOS `<base>` is `~/Library/Application Support`.
    static var dataDir: URL {
        baseDataDir
            .appendingPathComponent("instances", isDirectory: true)
            .appendingPathComponent(instanceId, isDirectory: true)
    }

    /// Per-instance log directory: `<data-dir>/Logs/`.
    static var logDir: URL {
        dataDir.appendingPathComponent("Logs", isDirectory: true)
    }

    /// Per-instance tugbank SQLite path: `<data-dir>/tugbank.db`.
    static var tugbankDbPath: URL {
        dataDir.appendingPathComponent("tugbank.db")
    }

    /// Per-instance session ledger SQLite path: `<data-dir>/sessions.db`.
    static var sessionsDbPath: URL {
        dataDir.appendingPathComponent("sessions.db")
    }

    /// Per-instance tugbank notify socket: `$TMPDIR/tugbank-notify-<id>.sock`.
    static var notifySocketPath: URL {
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        return tmp.appendingPathComponent("tugbank-notify-\(instanceId).sock")
    }

    /// Per-instance bundle-path marker: `<data-dir>/bundle-path`.
    static var bundlePathMarker: URL {
        dataDir.appendingPathComponent(bundlePathMarkerName)
    }

    /// Absolute path of the running app bundle. Used as the value
    /// passed via `TUG_BUNDLE_PATH` to spawned children.
    static var bundlePath: String {
        Bundle.main.bundlePath
    }

    // MARK: - Port allocation

    /// Tugcast HTTP port window base.
    /// Mirrors `tugcore::ports::TUGCAST_PORT_BASE`.
    static let tugcastPortBase: Int = 55300
    /// Tugcast HTTP port window size.
    static let tugcastPortWindow: Int = 100

    /// Vite dev-server port window base.
    /// Mirrors `tugcore::ports::VITE_PORT_BASE`.
    static let vitePortBase: Int = 55200
    /// Vite dev-server port window size.
    static let vitePortWindow: Int = 100

    /// Deterministic tugcast HTTP port for this instance.
    /// Tugcast may still bind a different port if the derived one is
    /// taken — consult the registry for the authoritative value.
    static var tugcastPort: Int {
        derivePort(base: tugcastPortBase, window: tugcastPortWindow)
    }

    /// Deterministic Vite dev-server port for this instance.
    static var vitePort: Int {
        derivePort(base: vitePortBase, window: vitePortWindow)
    }

    /// FNV-1a 32-bit hash mirroring `tugcore::ports::fnv1a_32`.
    private static func fnv1a32(_ bytes: [UInt8]) -> UInt32 {
        var hash: UInt32 = 0x811c_9dc5
        for byte in bytes {
            hash ^= UInt32(byte)
            hash = hash &* 0x0100_0193
        }
        return hash
    }

    private static func derivePort(base: Int, window: Int) -> Int {
        let bytes = Array(instanceId.utf8)
        let offset = Int(fnv1a32(bytes) % UInt32(max(window, 1)))
        return base + offset
    }

    // MARK: - Internals

    private static var baseDataDir: URL {
        // Application Support directory. On macOS this resolves to
        // `~/Library/Application Support`; this matches what the
        // Rust `dirs::data_dir()` crate returns on macOS, keeping
        // the two sides agreeing on the same root path.
        let appSupport = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first
            ?? URL(fileURLWithPath: NSHomeDirectory())
                .appendingPathComponent("Library/Application Support")
        return appSupport.appendingPathComponent("Tug", isDirectory: true)
    }
}
