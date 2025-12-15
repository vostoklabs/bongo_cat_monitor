import Foundation

protocol DaemonManagerDelegate: AnyObject {
    func daemonDidConnect(port: String)
    func daemonDidDisconnect()
    func daemonDidUpdateWPM(_ wpm: Int, streak: Bool)
    func daemonDidIdle()
    func daemonDidError(_ message: String)
    func daemonDidStop()
}

class DaemonManager {
    weak var delegate: DaemonManagerDelegate?

    private var process: Process?
    private var outputPipe: Pipe?
    private var isStreakActive = false

    var isRunning: Bool {
        process?.isRunning ?? false
    }

    func start() throws {
        guard !isRunning else { return }

        // Find daemon binary in app bundle
        guard let daemonPath = Bundle.main.path(forResource: "bongocat-daemon", ofType: nil) else {
            throw DaemonError.daemonNotFound
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: daemonPath)
        process.arguments = []

        // Set up stdout capture
        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = outputPipe

        // Handle output asynchronously
        outputPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if !data.isEmpty, let line = String(data: data, encoding: .utf8) {
                self?.processOutput(line)
            }
        }

        // Handle termination
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.delegate?.daemonDidStop()
            }
        }

        try process.run()

        self.process = process
        self.outputPipe = outputPipe
    }

    func stop() {
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        process?.terminate()
        process = nil
        outputPipe = nil
        isStreakActive = false
    }

    private func processOutput(_ output: String) {
        // Process each line (output may contain multiple lines)
        for line in output.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }

            if trimmed.hasPrefix("STATUS:") {
                let status = String(trimmed.dropFirst(7))
                handleStatus(status)
            } else if trimmed.hasPrefix("ERROR:") {
                let error = String(trimmed.dropFirst(6))
                DispatchQueue.main.async { [weak self] in
                    self?.delegate?.daemonDidError(error)
                }
            }
        }
    }

    private func handleStatus(_ status: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            if status.hasPrefix("connected:") {
                let port = String(status.dropFirst(10))
                self.delegate?.daemonDidConnect(port: port)
            } else if status == "disconnected" {
                self.delegate?.daemonDidDisconnect()
            } else if status.hasPrefix("typing:") {
                if let wpm = Int(status.dropFirst(7)) {
                    self.delegate?.daemonDidUpdateWPM(wpm, streak: self.isStreakActive)
                }
            } else if status == "idle" {
                self.delegate?.daemonDidIdle()
            } else if status == "streak" {
                self.isStreakActive = true
            } else if status == "streak_off" {
                self.isStreakActive = false
            }
        }
    }
}

enum DaemonError: LocalizedError {
    case daemonNotFound

    var errorDescription: String? {
        switch self {
        case .daemonNotFound:
            return "Daemon binary not found in app bundle"
        }
    }
}
