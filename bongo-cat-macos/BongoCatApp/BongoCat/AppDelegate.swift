import AppKit
import SwiftUI

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var daemonManager: DaemonManager!
    private var statusMenuItem: NSMenuItem!
    private var startStopMenuItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Create status bar item
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            // Load custom bongo cat icon from bundle resources
            if let iconPath = Bundle.main.path(forResource: "tray", ofType: "png"),
               let icon = NSImage(contentsOfFile: iconPath) {
                icon.size = NSSize(width: 18, height: 18)
                icon.isTemplate = false  // Keep original colors (pink cheeks!)
                button.image = icon
            } else {
                // Fallback to SF Symbol if custom icon not found
                button.image = NSImage(systemSymbolName: "cat.fill", accessibilityDescription: "Bongo Cat")
            }
        }

        // Create menu
        let menu = NSMenu()

        statusMenuItem = NSMenuItem(title: "Stopped", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        menu.addItem(NSMenuItem.separator())

        startStopMenuItem = NSMenuItem(title: "Start", action: #selector(toggleDaemon), keyEquivalent: "s")
        startStopMenuItem.target = self
        menu.addItem(startStopMenuItem)

        let reconnectItem = NSMenuItem(title: "Reconnect ESP32", action: #selector(reconnect), keyEquivalent: "r")
        reconnectItem.target = self
        menu.addItem(reconnectItem)

        menu.addItem(NSMenuItem.separator())

        let aboutItem = NSMenuItem(title: "About Bongo Cat", action: #selector(showAbout), keyEquivalent: "")
        aboutItem.target = self
        menu.addItem(aboutItem)

        let quitItem = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu

        // Initialize daemon manager
        daemonManager = DaemonManager()
        daemonManager.delegate = self

        // Check accessibility permission
        checkAccessibilityPermission()
    }

    func applicationWillTerminate(_ notification: Notification) {
        daemonManager.stop()
    }

    private func checkAccessibilityPermission() {
        if !PermissionHelper.isAccessibilityEnabled() {
            PermissionHelper.showPermissionDialog { [weak self] in
                self?.startDaemon()
            }
        } else {
            startDaemon()
        }
    }

    private func startDaemon() {
        do {
            try daemonManager.start()
            startStopMenuItem.title = "Stop"
            updateStatus("Starting...")
        } catch {
            updateStatus("Error: \(error.localizedDescription)")
        }
    }

    @objc private func toggleDaemon() {
        if daemonManager.isRunning {
            daemonManager.stop()
            startStopMenuItem.title = "Start"
            updateStatus("Stopped")
        } else {
            if PermissionHelper.isAccessibilityEnabled() {
                startDaemon()
            } else {
                checkAccessibilityPermission()
            }
        }
    }

    @objc private func reconnect() {
        if daemonManager.isRunning {
            daemonManager.stop()
        }
        startDaemon()
    }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Bongo Cat Monitor"
        alert.informativeText = "A lightweight native macOS companion for the Bongo Cat ESP32 display.\n\nVersion 1.0.0"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    @objc private func quit() {
        daemonManager.stop()
        NSApplication.shared.terminate(self)
    }

    private func updateStatus(_ status: String) {
        DispatchQueue.main.async { [weak self] in
            self?.statusMenuItem.title = status
        }
    }
}

extension AppDelegate: DaemonManagerDelegate {
    func daemonDidConnect(port: String) {
        updateStatus("Connected: \(port)")
    }

    func daemonDidDisconnect() {
        updateStatus("Disconnected")
    }

    func daemonDidUpdateWPM(_ wpm: Int, streak: Bool) {
        let streakIndicator = streak ? " [STREAK]" : ""
        updateStatus("\(wpm) WPM\(streakIndicator)")
    }

    func daemonDidIdle() {
        updateStatus("Idle")
    }

    func daemonDidError(_ message: String) {
        updateStatus("Error: \(message)")
    }

    func daemonDidStop() {
        DispatchQueue.main.async { [weak self] in
            self?.startStopMenuItem.title = "Start"
            self?.updateStatus("Stopped")
        }
    }
}
