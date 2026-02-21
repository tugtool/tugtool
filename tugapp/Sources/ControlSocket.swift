import Foundation

/// Parsed control socket message
struct ControlMessage {
    let type: String
    let data: [String: Any]

    init?(json: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let type = obj["type"] as? String else { return nil }
        self.type = type
        self.data = obj
    }
}

/// UDS server: creates socket, listens for connections
class ControlSocketListener {
    let path: String
    private var socketFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?

    /// Callback when a new client connects
    var onConnection: ((ControlSocketConnection) -> Void)?

    init(path: String) throws {
        self.path = path
        // Delete stale socket file
        unlink(path)
        // Create Unix domain socket
        socketFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard socketFD >= 0 else { throw POSIXError(.init(rawValue: errno)!) }
        // Bind
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        _ = withUnsafeMutableBytes(of: &addr.sun_path.0) { dst in
            path.withCString { src in
                strlcpy(dst.baseAddress!.assumingMemoryBound(to: CChar.self), src, dst.count)
            }
        }
        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(socketFD, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else { Darwin.close(socketFD); throw POSIXError(.init(rawValue: errno)!) }
        // Listen
        guard Darwin.listen(socketFD, 5) == 0 else { Darwin.close(socketFD); throw POSIXError(.init(rawValue: errno)!) }
        // Set up dispatch source for async accept
        let source = DispatchSource.makeReadSource(fileDescriptor: socketFD, queue: .global())
        source.setEventHandler { [weak self] in
            self?.handleAccept()
        }
        source.resume()
        self.acceptSource = source
    }

    private func handleAccept() {
        let clientFD = Darwin.accept(socketFD, nil, nil)
        guard clientFD >= 0 else { return }
        let connection = ControlSocketConnection(fd: clientFD)
        onConnection?(connection)
    }

    func close() {
        acceptSource?.cancel()
        acceptSource = nil
        if socketFD >= 0 {
            Darwin.close(socketFD)
            socketFD = -1
        }
        unlink(path)
    }

    deinit { close() }
}

/// Single UDS connection: read/write newline-delimited JSON messages
class ControlSocketConnection {
    private let fileHandle: FileHandle
    private var buffer = Data()

    /// Callback for each complete message received
    var onMessage: ((ControlMessage) -> Void)?

    /// Callback when connection closes (EOF or error)
    var onDisconnect: (() -> Void)?

    init(fd: Int32) {
        self.fileHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        // Start reading
        fileHandle.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                // EOF
                DispatchQueue.main.async { self?.onDisconnect?() }
                handle.readabilityHandler = nil
                return
            }
            self?.processData(data)
        }
    }

    private func processData(_ data: Data) {
        buffer.append(data)
        // Split on newlines to extract complete JSON messages
        while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let lineData = buffer[buffer.startIndex..<newlineIndex]
            buffer = Data(buffer[(newlineIndex + 1)...])  // +1 to skip the newline
            if let msg = ControlMessage(json: Data(lineData)) {
                DispatchQueue.main.async { [weak self] in
                    self?.onMessage?(msg)
                }
            }
        }
    }

    /// Send a JSON message (newline-terminated)
    func send(_ dict: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: dict),
              var payload = String(data: jsonData, encoding: .utf8) else { return }
        payload.append("\n")
        if let data = payload.data(using: .utf8) {
            fileHandle.write(data)
        }
    }

    func close() {
        fileHandle.readabilityHandler = nil
        fileHandle.closeFile()
    }
}
