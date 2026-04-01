import Foundation

// MARK: - TugbankValue

/// A typed value stored in tugbank.
///
/// The Rust library serialises every stored value as a tagged JSON object of
/// the form {"type": "<kind>", "value": <payload>}.  TugbankValue mirrors
/// the six concrete Value variants exposed by that serialisation.
enum TugbankValue: Equatable {
    case null
    case bool(Bool)
    case i64(Int64)
    case f64(Double)
    case string(String)
    case json(Any)

    // Equatable for .json cases compares JSON-encoded strings.
    static func == (lhs: TugbankValue, rhs: TugbankValue) -> Bool {
        switch (lhs, rhs) {
        case (.null, .null): return true
        case (.bool(let a), .bool(let b)): return a == b
        case (.i64(let a), .i64(let b)): return a == b
        case (.f64(let a), .f64(let b)): return a == b
        case (.string(let a), .string(let b)): return a == b
        case (.json(let a), .json(let b)):
            // Best-effort: compare via JSON serialisation
            let encode: (Any) -> String? = { value in
                (try? JSONSerialization.data(withJSONObject: value)).flatMap {
                    String(data: $0, encoding: .utf8)
                }
            }
            return encode(a) == encode(b)
        default: return false
        }
    }

    // MARK: Convenience accessors

    /// Returns the string payload if the value is a .string case, otherwise nil.
    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    /// Returns the bool payload if the value is a .bool case, otherwise nil.
    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    /// Returns the Int64 payload if the value is an .i64 case, otherwise nil.
    var intValue: Int64? {
        if case .i64(let n) = self { return n }
        return nil
    }

    // MARK: Encode for storage

    /// Encode the value into a plain JSON string suitable for tugbank_set.
    ///
    /// For example, .string("hello") encodes as "\"hello\"", .i64(42) as "42".
    func encodeForSet() -> String? {
        switch self {
        case .null:
            return "null"
        case .bool(let b):
            return b ? "true" : "false"
        case .i64(let n):
            return "\(n)"
        case .f64(let f):
            return "\(f)"
        case .string(let s):
            // JSON-encode so the string is properly quoted and escaped.
            guard let data = try? JSONSerialization.data(withJSONObject: s),
                  let encoded = String(data: data, encoding: .utf8) else { return nil }
            return encoded
        case .json(let v):
            guard let data = try? JSONSerialization.data(withJSONObject: v),
                  let encoded = String(data: data, encoding: .utf8) else { return nil }
            return encoded
        }
    }
}

// MARK: - DomainSnapshot

/// An in-memory snapshot of a single tugbank domain.
private struct DomainSnapshot {
    /// The data_version at which this snapshot was loaded.
    var generation: UInt64
    /// The key-value pairs in the domain at `generation`.
    var entries: [String: TugbankValue]
}

// MARK: - TugbankClient

/// A Swift wrapper around the tugbank-ffi C library.
///
/// TugbankClient maintains an in-memory cache of domain snapshots and polls
/// the SQLite data_version pragma at 500 ms intervals to detect external
/// writes.  When a domain's snapshot changes (due to a local write or an
/// externally detected change) all registered onDomainChanged callbacks are
/// fired.
///
/// Usage:
///
///     let client = TugbankClient(path: "/path/to/tugbank.db")
///     let value = client.get(domain: "com.example", key: "foo")
///     client.set(domain: "com.example", key: "foo", value: .string("bar"))
///
/// The client must be kept alive for as long as it is needed.  Deallocation
/// closes the underlying SQLite database.
final class TugbankClient {

    // MARK: Shared instance

    /// Application-wide shared TugbankClient.
    ///
    /// Call configure(path:) once at startup before accessing shared.
    static private(set) var shared: TugbankClient?

    /// Configure the shared instance with the database path.  Must be called
    /// once before any code accesses TugbankClient.shared.  Calling a second
    /// time replaces the previous instance (closing its database).
    ///
    /// Returns the newly created client, or nil if the database cannot be
    /// opened.
    @discardableResult
    static func configure(path: String) -> TugbankClient? {
        guard let client = TugbankClient(path: path) else { return nil }
        shared = client
        return client
    }

    // MARK: Private state

    private let handle: UnsafeMutableRawPointer
    private var cache: [String: DomainSnapshot] = [:]
    private var pollTimer: Timer?
    private var lastSeenVersion: UInt64 = 0

    /// Registered callbacks: domain name -> list of closures to call on change.
    private var changeCallbacks: [String: [([String: TugbankValue]) -> Void]] = [:]

    // MARK: Init / deinit

    /// Open the database at `path`.
    ///
    /// Starts a 500 ms polling timer on the main run loop to detect external
    /// writes via PRAGMA data_version.  Returns nil if the database cannot be
    /// opened.
    init?(path: String) {
        guard let h = path.withCString({ tugbank_open($0) }) else { return nil }
        self.handle = h
        lastSeenVersion = tugbank_data_version(handle)
        startPolling()
    }

    deinit {
        stopPolling()
        tugbank_close(handle)
    }

    // MARK: Public API

    /// Return the value for `key` in `domain`, or nil if the key does not exist.
    ///
    /// On the first access for a given domain the full domain snapshot is
    /// loaded from SQLite via tugbank_read_domain() and stored in cache.
    /// Subsequent accesses for the same domain are served from cache.
    func get(domain: String, key: String) -> TugbankValue? {
        ensureDomainLoaded(domain)
        return cache[domain]?.entries[key]
    }

    /// Write `value` to `key` in `domain` and update the in-memory cache.
    ///
    /// Returns true on success.  The cache is updated optimistically before
    /// the write returns so that the next get() call reflects the new value
    /// immediately.
    @discardableResult
    func set(domain: String, key: String, value: TugbankValue) -> Bool {
        guard let json = value.encodeForSet() else { return false }
        let rc: Int32 = domain.withCString { domainPtr in
            key.withCString { keyPtr in
                json.withCString { jsonPtr in
                    tugbank_set(handle, domainPtr, keyPtr, jsonPtr)
                }
            }
        }
        guard rc == 0 else { return false }

        // Update cache optimistically
        if cache[domain] == nil {
            cache[domain] = DomainSnapshot(generation: lastSeenVersion, entries: [:])
        }
        cache[domain]?.entries[key] = value
        return true
    }

    /// Load and return all entries for `domain` from SQLite.
    ///
    /// Also refreshes the cached snapshot for `domain`.  Returns nil on error.
    func readDomain(domain: String) -> [String: TugbankValue]? {
        let entries = fetchDomainFromDB(domain)
        let version = tugbank_data_version(handle)
        cache[domain] = DomainSnapshot(generation: version, entries: entries ?? [:])
        return entries
    }

    /// Return the list of all domain names in the database.
    func listDomains() -> [String] {
        guard let ptr = tugbank_list_domains(handle) else { return [] }
        defer { tugbank_free_string(ptr) }
        let jsonStr = String(cString: ptr)
        guard let data = jsonStr.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [String] else {
            return []
        }
        return arr
    }

    /// Register a callback that fires whenever the snapshot for `domain`
    /// changes.  The callback receives the full new entry map.
    ///
    /// Multiple callbacks may be registered for the same domain; they are
    /// called in registration order.
    func onDomainChanged(domain: String, callback: @escaping ([String: TugbankValue]) -> Void) {
        if changeCallbacks[domain] == nil {
            changeCallbacks[domain] = []
        }
        changeCallbacks[domain]?.append(callback)
    }

    // MARK: Convenience helpers for string values

    /// Read a string value from `domain`/`key`.  Returns nil if the key does
    /// not exist or its value is not a .string.
    func getString(domain: String, key: String) -> String? {
        return get(domain: domain, key: key)?.stringValue
    }

    /// Read a Bool from `domain`/`key`.  Returns false if the key does not
    /// exist or its value is not a .bool.
    func getBool(domain: String, key: String) -> Bool {
        return get(domain: domain, key: key)?.boolValue ?? false
    }

    /// Write a String value to `domain`/`key`.
    @discardableResult
    func setString(domain: String, key: String, value: String) -> Bool {
        return set(domain: domain, key: key, value: .string(value))
    }

    // MARK: Private helpers

    /// Load `domain` into cache if it has not been loaded yet.
    private func ensureDomainLoaded(_ domain: String) {
        guard cache[domain] == nil else { return }
        let entries = fetchDomainFromDB(domain) ?? [:]
        let version = tugbank_data_version(handle)
        cache[domain] = DomainSnapshot(generation: version, entries: entries)
    }

    /// Fetch all entries for `domain` from SQLite.  Returns nil on error.
    private func fetchDomainFromDB(_ domain: String) -> [String: TugbankValue]? {
        guard let ptr = domain.withCString({ tugbank_read_domain(handle, $0) }) else { return nil }
        defer { tugbank_free_string(ptr) }
        let jsonStr = String(cString: ptr)
        guard let data = jsonStr.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        var result: [String: TugbankValue] = [:]
        for (key, rawValue) in obj {
            // Each value is a tagged object {"type": ..., "value": ...}
            guard let taggedObj = rawValue as? [String: Any],
                  let typeStr = taggedObj["type"] as? String else { continue }
            let payload = taggedObj["value"]
            let value: TugbankValue
            switch typeStr {
            case "null":
                value = .null
            case "bool":
                guard let b = payload as? Bool else { continue }
                value = .bool(b)
            case "i64":
                guard let n = payload as? NSNumber else { continue }
                value = .i64(n.int64Value)
            case "f64":
                guard let n = payload as? NSNumber else { continue }
                value = .f64(n.doubleValue)
            case "string":
                guard let s = payload as? String else { continue }
                value = .string(s)
            case "json":
                if let v = payload { value = .json(v) } else { value = .null }
            default:
                continue
            }
            result[key] = value
        }
        return result
    }

    // MARK: Polling

    private func startPolling() {
        let timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.pollDataVersion()
        }
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func pollDataVersion() {
        let currentVersion = tugbank_data_version(handle)
        guard currentVersion != lastSeenVersion else { return }
        lastSeenVersion = currentVersion

        // Reload all cached domains and fire callbacks for any that changed.
        var changed: [String: [String: TugbankValue]] = [:]
        for domain in cache.keys {
            let fresh = fetchDomainFromDB(domain) ?? [:]
            let old = cache[domain]?.entries ?? [:]
            if fresh != old {
                cache[domain] = DomainSnapshot(generation: currentVersion, entries: fresh)
                changed[domain] = fresh
            }
        }

        // Fire registered callbacks.
        for (domain, entries) in changed {
            if let callbacks = changeCallbacks[domain] {
                for cb in callbacks {
                    cb(entries)
                }
            }
        }
    }
}
