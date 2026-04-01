import Foundation

// MARK: - TugbankValue

/// A tugbank value, matching the Rust `Value` enum variants.
enum TugbankValue {
    case null
    case bool(Bool)
    case i64(Int64)
    case f64(Double)
    case string(String)
    case json(Any)

    /// Returns the string payload if this is a .string case, otherwise nil.
    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    /// Returns the bool payload if this is a .bool case, otherwise nil.
    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    /// Encode the value as a plain JSON string for tugbank_set.
    /// The FFI expects a raw JSON literal: "\"hello\"" for strings, "true" for bools, etc.
    func encodeForFFI() -> String? {
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
            // Wrap in array to leverage JSONSerialization for proper escaping,
            // then strip the surrounding brackets.
            guard let data = try? JSONSerialization.data(withJSONObject: [s]),
                  let arrayStr = String(data: data, encoding: .utf8) else { return nil }
            let start = arrayStr.index(after: arrayStr.startIndex)
            let end = arrayStr.index(before: arrayStr.endIndex)
            return String(arrayStr[start..<end])
        case .json(let v):
            guard JSONSerialization.isValidJSONObject(v),
                  let data = try? JSONSerialization.data(withJSONObject: v),
                  let encoded = String(data: data, encoding: .utf8) else { return nil }
            return encoded
        }
    }
}

// MARK: - DomainSnapshot

/// An in-memory snapshot of a single tugbank domain.
private struct DomainSnapshot {
    var generation: UInt64
    var entries: [String: TugbankValue]
}

// MARK: - TugbankClient

/// In-process tugbank client wrapping the tugbank-ffi C library.
///
/// Provides the same interface as the Rust and TypeScript TugbankClients:
/// - In-memory domain snapshot cache
/// - PRAGMA data_version polling for external change detection
/// - Domain change callbacks
/// - get/set/readDomain/listDomains
final class TugbankClient {

    /// Shared singleton. Call `configure(path:)` once before accessing.
    private(set) static var shared: TugbankClient?

    /// Configure the shared instance. Returns the client, or nil on failure.
    @discardableResult
    static func configure(path: String) -> TugbankClient? {
        guard shared == nil else { return shared }
        guard let client = TugbankClient(path: path) else { return nil }
        shared = client
        return client
    }

    // MARK: Private state

    private let handle: UnsafeMutableRawPointer
    private var cache: [String: DomainSnapshot] = [:]
    private var lastDataVersion: UInt64 = 0
    private var pollTimer: Timer?
    private var callbacks: [(String, [String: TugbankValue]) -> Void] = []

    // MARK: Init / Deinit

    private init?(path: String) {
        guard let h = path.withCString({ tugbank_open($0) }) else {
            return nil
        }
        handle = h
        lastDataVersion = tugbank_data_version(handle)
        startPolling()
    }

    deinit {
        stopPolling()
        tugbank_close(handle)
    }

    // MARK: Public API

    /// Read a single value from the cache. Loads the domain on first access.
    func get(domain: String, key: String) -> TugbankValue? {
        ensureDomainLoaded(domain)
        return cache[domain]?.entries[key]
    }

    /// Write a value to the database and update the cache.
    @discardableResult
    func set(domain: String, key: String, value: TugbankValue) -> Bool {
        guard let json = value.encodeForFFI() else { return false }
        let rc: Int32 = domain.withCString { domainPtr in
            key.withCString { keyPtr in
                json.withCString { jsonPtr in
                    tugbank_set(handle, domainPtr, keyPtr, jsonPtr)
                }
            }
        }
        guard rc == 0 else { return false }

        // Update cache optimistically
        ensureDomainLoaded(domain)
        cache[domain]?.entries[key] = value
        return true
    }

    /// Read all entries for a domain from the cache.
    func readDomain(domain: String) -> [String: TugbankValue]? {
        ensureDomainLoaded(domain)
        return cache[domain]?.entries
    }

    /// List all domains via the FFI.
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

    /// Return the current PRAGMA data_version.
    func dataVersion() -> UInt64 {
        return tugbank_data_version(handle)
    }

    /// Register a callback for domain changes. Fires when polling detects external writes.
    func onDomainChanged(_ callback: @escaping (String, [String: TugbankValue]) -> Void) {
        callbacks.append(callback)
    }

    // MARK: Convenience

    /// Read a String value.
    func getString(domain: String, key: String) -> String? {
        return get(domain: domain, key: key)?.stringValue
    }

    /// Read a Bool value. Returns false if not found or not a bool.
    /// Also handles legacy string "true" values written by the CLI.
    func getBool(domain: String, key: String) -> Bool {
        guard let value = get(domain: domain, key: key) else { return false }
        switch value {
        case .bool(let b): return b
        case .string(let s): return s.caseInsensitiveCompare("true") == .orderedSame
        default: return false
        }
    }

    /// Write a String value.
    @discardableResult
    func setString(domain: String, key: String, value: String) -> Bool {
        return set(domain: domain, key: key, value: .string(value))
    }

    /// Write a Bool value.
    @discardableResult
    func setBool(domain: String, key: String, value: Bool) -> Bool {
        return set(domain: domain, key: key, value: .bool(value))
    }

    // MARK: Cache management

    private func ensureDomainLoaded(_ domain: String) {
        guard cache[domain] == nil else { return }
        let entries = fetchDomainFromDB(domain) ?? [:]
        let version = tugbank_data_version(handle)
        cache[domain] = DomainSnapshot(generation: version, entries: entries)
    }

    /// Fetch all entries for a domain via the FFI.
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
            if let parsed = parseTaggedValue(rawValue) {
                result[key] = parsed
            }
        }
        return result
    }

    /// Parse a tagged value object {"type": "string", "value": "..."} into a TugbankValue.
    private func parseTaggedValue(_ raw: Any) -> TugbankValue? {
        guard let tagged = raw as? [String: Any],
              let typeStr = tagged["type"] as? String else { return nil }
        let payload = tagged["value"]

        switch typeStr {
        case "null":
            return .null
        case "bool":
            guard let b = payload as? Bool else { return nil }
            return .bool(b)
        case "i64":
            guard let n = payload as? NSNumber else { return nil }
            return .i64(n.int64Value)
        case "f64":
            guard let n = payload as? NSNumber else { return nil }
            return .f64(n.doubleValue)
        case "string":
            guard let s = payload as? String else { return nil }
            return .string(s)
        case "json":
            if let v = payload { return .json(v) } else { return .null }
        case "bytes":
            // Bytes are hex-encoded in the FFI; treat as string for now
            if let s = payload as? String { return .string(s) } else { return .null }
        default:
            return nil
        }
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
        guard currentVersion != lastDataVersion else { return }
        lastDataVersion = currentVersion

        // Reload all cached domains and fire callbacks for changed ones
        var changedDomains: [(String, [String: TugbankValue])] = []

        for domain in cache.keys {
            if let newEntries = fetchDomainFromDB(domain) {
                let oldEntries = cache[domain]?.entries ?? [:]
                cache[domain] = DomainSnapshot(generation: currentVersion, entries: newEntries)

                // Simple change detection: if entry count differs or any value changed
                if !entriesEqual(oldEntries, newEntries) {
                    changedDomains.append((domain, newEntries))
                }
            }
        }

        for (domain, entries) in changedDomains {
            for callback in callbacks {
                callback(domain, entries)
            }
        }
    }

    /// Simple equality check for domain entries (by string representation).
    private func entriesEqual(_ a: [String: TugbankValue], _ b: [String: TugbankValue]) -> Bool {
        guard a.count == b.count else { return false }
        for (key, aVal) in a {
            guard let bVal = b[key] else { return false }
            // Compare by FFI encoding — not perfect but sufficient for change detection
            if aVal.encodeForFFI() != bVal.encodeForFFI() { return false }
        }
        return true
    }
}
