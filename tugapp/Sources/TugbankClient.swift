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
/// - Darwin notification listeners for external change detection
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
    private var callbacks: [(String, [String: TugbankValue]) -> Void] = []
    /// Darwin notification tokens. Cancelling these stops the notifications.
    private var notifyTokens: [Int32] = []

    // MARK: Init / Deinit

    private init?(path: String) {
        guard let h = path.withCString({ tugbank_open($0) }) else {
            return nil
        }
        handle = h
    }

    deinit {
        // Cancel all Darwin notification registrations.
        notifyTokens.forEach { notify_cancel($0) }
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

    /// Register a callback for domain changes. Fires when a Darwin notification
    /// is received for a cached domain.
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

    /// Ensure the domain is loaded into the cache and a Darwin notification
    /// watcher is registered for it.
    private func ensureDomainLoaded(_ domain: String) {
        guard cache[domain] == nil else { return }
        let entries = fetchDomainFromDB(domain) ?? [:]
        let version = tugbank_data_version(handle)
        cache[domain] = DomainSnapshot(generation: version, entries: entries)

        // Register a Darwin notification watcher for this domain.
        registerDomainNotification(domain)
    }

    /// Register a Darwin notification listener for a domain.
    ///
    /// Uses `notify_register_dispatch` to deliver notifications on the main
    /// queue. When a notification fires, re-reads the domain from the database,
    /// updates the cache, and fires registered callbacks.
    private func registerDomainNotification(_ domain: String) {
        let notificationName = "dev.tugtool.tugbank.changed.\(domain)"
        var token: Int32 = 0

        notify_register_dispatch(
            notificationName,
            &token,
            DispatchQueue.main
        ) { [weak self] (_: Int32) in
            self?.onDomainNotification(domain)
        }

        notifyTokens.append(token)
    }

    /// Handle an incoming Darwin notification for a domain.
    ///
    /// Re-reads the domain from the database, updates the cache, and fires
    /// registered callbacks.
    private func onDomainNotification(_ domain: String) {
        guard let newEntries = fetchDomainFromDB(domain) else { return }
        cache[domain] = DomainSnapshot(generation: tugbank_data_version(handle), entries: newEntries)

        for callback in callbacks {
            callback(domain, newEntries)
        }
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
}
