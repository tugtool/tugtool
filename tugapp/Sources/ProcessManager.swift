import Foundation

/// Manages the tugcast server process lifecycle with supervisor loop
class ProcessManager {
    private var process: Process?
    private var devPath: String?
    private let authURLPattern = try! NSRegularExpression(pattern: "tugcast:\\s+(http://\\S+)")

    /// Callback for auth URL extraction
    var onAuthURL: ((String) -> Void)?

    /// Check if tmux is available in PATH
    static func checkTmux() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        process.arguments = ["tmux"]
        process.standardOutput = Pipe()
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    /// Resolve tugcast binary path from bundle
    private func resolveTugcastPath() -> URL? {
        guard let executableURL = Bundle.main.executableURL else { return nil }
        let tugcastURL = executableURL.deletingLastPathComponent().appendingPathComponent("tugcast")
        return FileManager.default.fileExists(atPath: tugcastURL.path) ? tugcastURL : nil
    }

    /// Start tugcast with optional dev mode
    func start(devMode: Bool, sourceTree: String?) {
        self.devPath = devMode ? sourceTree?.appending("/tugdeck/dist") : nil
        startProcess()
    }

    /// Stop the tugcast process
    func stop() {
        if let proc = process, proc.isRunning {
            proc.terminate()
            proc.waitUntilExit()
        }
        process = nil
    }

    /// Restart tugcast with current settings
    func restart() {
        stop()
        startProcess()
    }

    /// Internal: Start the process and supervise
    private func startProcess() {
        guard let tugcastURL = resolveTugcastPath() else {
            NSLog("ProcessManager: tugcast binary not found")
            return
        }

        let proc = Process()
        proc.executableURL = tugcastURL

        var args: [String] = []
        if let devPath = devPath {
            args.append(contentsOf: ["--dev", devPath])
        }
        proc.arguments = args

        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = FileHandle.standardError

        // Read stdout for auth URL
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }

            if let line = String(data: data, encoding: .utf8) {
                // Forward to stdout
                print(line, terminator: "")

                // Check for auth URL
                if let match = self?.authURLPattern.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
                   let urlRange = Range(match.range(at: 1), in: line) {
                    let url = String(line[urlRange])
                    DispatchQueue.main.async {
                        self?.onAuthURL?(url)
                    }
                }
            }
        }

        do {
            try proc.run()
            self.process = proc

            // Supervisor loop in background
            DispatchQueue.global(qos: .background).async { [weak self] in
                proc.waitUntilExit()
                let exitCode = proc.terminationStatus

                DispatchQueue.main.async {
                    guard let self = self else { return }

                    if exitCode == 42 {
                        // Restart requested
                        NSLog("ProcessManager: restart requested (exit 42)")
                        self.restart()
                    } else if exitCode == 43 {
                        // Reset requested
                        NSLog("ProcessManager: reset requested (exit 43)")
                        // TODO: clear caches
                        self.restart()
                    } else {
                        // Real exit
                        NSLog("ProcessManager: tugcast exited with code %d", exitCode)
                        self.process = nil
                    }
                }
            }
        } catch {
            NSLog("ProcessManager: failed to start tugcast: %@", error.localizedDescription)
        }
    }
}
