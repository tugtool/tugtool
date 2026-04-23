#if DEBUG
import Foundation

// MARK: - TestHarnessListener
//
// DEBUG-only Unix-domain socket listener for the in-app test harness.
// Modeled on `ControlSocketListener` in `tugapp/Sources/ControlSocket.swift`,
// with the [D06] socket-path security contract layered on top:
//
//   1. Path parent must be one of /tmp, $HOME, /var/folders.
//   2. Parent dir `st_uid` must equal `geteuid()`.
//   3. Stale socket file is unlinked only if its `st_uid` matches.
//   4. After `bind`, `fchmod(fd, 0600)` and verify via `fstat`.
//   5. `listen(fd, 1)` — single-connection backlog.
//
// Any security-check failure logs a `tughost.test-harness.security:`
// line and throws `TestHarnessSecurityError`. The caller aborts the
// test-mode launch but keeps the app booting normally.
//
// Single-client model: while one connection is active, additional
// `accept()`d fds are closed immediately with a log line.

// MARK: - Error types

/// Thrown by the listener when the [D06] security contract fails.
/// Carries a distinctive reason string so log lines are greppable.
enum TestHarnessSecurityError: Error, CustomStringConvertible {
    case invalidParentDirectory(String)
    case parentDirOwnershipMismatch(String)
    case staleSocketOwnershipMismatch(String)
    case bindFailed(Int32)
    case chmodFailed(Int32)
    case chmodVerifyFailed(UInt16)
    case listenFailed(Int32)
    case socketCreationFailed(Int32)

    var description: String {
        switch self {
        case .invalidParentDirectory(let path):
            return "invalidParentDirectory(\(path))"
        case .parentDirOwnershipMismatch(let path):
            return "parentDirOwnershipMismatch(\(path))"
        case .staleSocketOwnershipMismatch(let path):
            return "staleSocketOwnershipMismatch(\(path))"
        case .bindFailed(let errno):
            return "bindFailed(errno=\(errno))"
        case .chmodFailed(let errno):
            return "chmodFailed(errno=\(errno))"
        case .chmodVerifyFailed(let mode):
            return "chmodVerifyFailed(mode=\(String(mode, radix: 8)))"
        case .listenFailed(let errno):
            return "listenFailed(errno=\(errno))"
        case .socketCreationFailed(let errno):
            return "socketCreationFailed(errno=\(errno))"
        }
    }
}

// MARK: - TestHarnessListener

final class TestHarnessListener {
    private let path: String
    private var socketFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?
    private var activeConnection: TestHarnessConnection?

    /// Callback invoked when the listener accepts its first connection.
    /// Second concurrent connections are closed with a log line.
    var onConnection: ((TestHarnessConnection) -> Void)?

    var isListening: Bool { socketFD >= 0 }

    init(path: String) {
        self.path = path
    }

    /// Bind, chmod, listen, install accept source. Throws on any
    /// [D06] security-contract violation.
    func start() throws {
        try verifyParentDirectorySafe(path: path)
        try handleStaleSocket(path: path)

        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw TestHarnessSecurityError.socketCreationFailed(errno)
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        _ = withUnsafeMutableBytes(of: &addr.sun_path) { dst in
            path.withCString { src in
                strlcpy(dst.baseAddress!.assumingMemoryBound(to: CChar.self), src, dst.count)
            }
        }

        let bindResult = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else {
            let bindErrno = errno
            Darwin.close(fd)
            throw TestHarnessSecurityError.bindFailed(bindErrno)
        }

        // fchmod(fd, 0600) immediately after bind so the window where
        // the socket inode is world-reachable is minimized.
        guard Darwin.fchmod(fd, 0o600) == 0 else {
            let chmodErrno = errno
            Darwin.close(fd)
            unlink(path)
            throw TestHarnessSecurityError.chmodFailed(chmodErrno)
        }

        // Verify mode via fstat.
        var st = stat()
        guard Darwin.fstat(fd, &st) == 0 else {
            let fstatErrno = errno
            Darwin.close(fd)
            unlink(path)
            throw TestHarnessSecurityError.chmodFailed(fstatErrno)
        }
        let actualMode = UInt16(st.st_mode & 0o777)
        guard actualMode == 0o600 else {
            Darwin.close(fd)
            unlink(path)
            throw TestHarnessSecurityError.chmodVerifyFailed(actualMode)
        }

        guard Darwin.listen(fd, 1) == 0 else {
            let listenErrno = errno
            Darwin.close(fd)
            unlink(path)
            throw TestHarnessSecurityError.listenFailed(listenErrno)
        }

        socketFD = fd
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .global())
        source.setEventHandler { [weak self] in
            self?.handleAccept()
        }
        source.resume()
        acceptSource = source

        NSLog("tughost.test-harness.listening: path=%@ fd=%d", path, fd)
    }

    private func handleAccept() {
        let clientFD = Darwin.accept(socketFD, nil, nil)
        guard clientFD >= 0 else { return }

        // Single-client model. Second connection is closed immediately.
        if activeConnection != nil {
            NSLog("tughost.test-harness.refused: already-active-connection fd=%d", clientFD)
            Darwin.close(clientFD)
            return
        }

        let connection = TestHarnessConnection(fd: clientFD)
        connection.onDisconnect = { [weak self] in
            self?.activeConnection = nil
        }
        activeConnection = connection
        onConnection?(connection)
    }

    func close() {
        acceptSource?.cancel()
        acceptSource = nil
        if socketFD >= 0 {
            Darwin.close(socketFD)
            socketFD = -1
        }
        activeConnection?.close()
        activeConnection = nil
        unlink(path)
    }

    deinit { close() }
}

// MARK: - [D06] security-contract helpers

/// Verify the socket's parent directory sits inside an allow-list AND
/// is owned by the current effective uid. Throws on any mismatch.
private func verifyParentDirectorySafe(path: String) throws {
    let parent = (path as NSString).deletingLastPathComponent
    // Normalize /tmp on macOS which is a symlink to /private/tmp.
    let allowedParents: [String] = ["/tmp", "/private/tmp", "/var/folders"]
    let homeDir = NSString(string: NSHomeDirectory()).standardizingPath
    let parentStd = NSString(string: parent).standardizingPath

    var isUnderAllowed = false
    for allowed in allowedParents {
        if parentStd == allowed || parentStd.hasPrefix(allowed + "/") {
            isUnderAllowed = true
            break
        }
    }
    if !isUnderAllowed {
        if parentStd == homeDir || parentStd.hasPrefix(homeDir + "/") {
            isUnderAllowed = true
        }
    }
    guard isUnderAllowed else {
        NSLog("tughost.test-harness.security: invalid-parent-dir path=%@", path)
        throw TestHarnessSecurityError.invalidParentDirectory(parentStd)
    }

    var st = stat()
    guard stat(parent, &st) == 0 else {
        NSLog("tughost.test-harness.security: parent-stat-failed parent=%@ errno=%d", parent, errno)
        throw TestHarnessSecurityError.parentDirOwnershipMismatch(parent)
    }
    let myUid = geteuid()
    guard st.st_uid == myUid else {
        NSLog("tughost.test-harness.security: parent-uid-mismatch parent=%@ owner=%d me=%d", parent, st.st_uid, myUid)
        throw TestHarnessSecurityError.parentDirOwnershipMismatch(parent)
    }
}

/// If the socket path already has a file at it, verify its `st_uid`
/// matches `geteuid()` before unlinking. Otherwise throw.
private func handleStaleSocket(path: String) throws {
    var st = stat()
    if stat(path, &st) == 0 {
        let myUid = geteuid()
        guard st.st_uid == myUid else {
            NSLog("tughost.test-harness.security: stale-socket-uid-mismatch path=%@ owner=%d me=%d", path, st.st_uid, myUid)
            throw TestHarnessSecurityError.staleSocketOwnershipMismatch(path)
        }
        unlink(path)
    }
    // If stat failed with ENOENT, path is clear — nothing to unlink.
}
#endif
