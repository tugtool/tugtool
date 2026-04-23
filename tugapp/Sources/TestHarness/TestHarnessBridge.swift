#if DEBUG
import Foundation
import WebKit

// MARK: - TestHarnessBridge
//
// Top-level coordinator for the DEBUG-only in-app test harness. Owns
// the listener + connection lifecycle and binds them to a live
// `WKWebView` once MainWindow is up.
//
// Usage:
//   let bridge = TestHarnessBridge(socketPath: path)
//   bridge.start()                        // binds listener, starts accept loop
//   bridge.attach(webView: myWebView)     // hands the webView to connections
//   bridge.close()                        // closes listener + active conn
//
// The `attach` call is deferred until MainWindow exists; the listener
// itself is up earlier so clients can connect and sit idle until the
// webView is ready. Requests arriving before `attach` are held on the
// connection's read queue (we start the read handler only after attach).

final class TestHarnessBridge {
    private let socketPath: String
    private var listener: TestHarnessListener?
    private weak var pendingWebView: WKWebView?
    private var activeConnection: TestHarnessConnection?

    init(socketPath: String) {
        self.socketPath = socketPath
    }

    /// Bind the Unix socket listener. Idempotent. Logs a distinctive
    /// line on security failure and does NOT throw — the app keeps
    /// booting without test mode.
    func start() {
        guard listener == nil else { return }
        let listener = TestHarnessListener(path: socketPath)
        listener.onConnection = { [weak self] connection in
            guard let self = self else { return }
            self.activeConnection = connection
            connection.onDisconnect = { [weak self] in
                guard let self = self else { return }
                if self.activeConnection === connection {
                    self.activeConnection = nil
                }
                connection.close()
            }
            if let webView = self.pendingWebView {
                connection.attach(webView: webView)
            }
        }
        do {
            try listener.start()
            self.listener = listener
            NSLog("tughost.test-harness.started: socket=%@", socketPath)
        } catch {
            NSLog("tughost.test-harness.start-failed: %@", String(describing: error))
            self.listener = nil
        }
    }

    /// Provide the live WKWebView to the harness. If a connection is
    /// already waiting, it starts reading immediately.
    func attach(webView: WKWebView) {
        pendingWebView = webView
        activeConnection?.attach(webView: webView)
    }

    /// Shut down the listener and any active connection. Unlinks the
    /// socket file.
    func close() {
        activeConnection?.close()
        activeConnection = nil
        listener?.close()
        listener = nil
    }

    // MARK: - Environment probe

    /// Returns the socket path from `TUGAPP_TEST_SOCKET` if set and
    /// non-empty; nil otherwise. Used by `main.swift` / `AppDelegate`
    /// to decide whether to activate the harness.
    static func envSocketPath() -> String? {
        let env = ProcessInfo.processInfo.environment["TUGAPP_TEST_SOCKET"]
        guard let env = env, !env.isEmpty else { return nil }
        return env
    }
}
#endif
