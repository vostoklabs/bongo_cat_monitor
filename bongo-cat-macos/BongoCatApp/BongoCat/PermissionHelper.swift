import AppKit
import ApplicationServices

struct PermissionHelper {
    /// Check if the app has Accessibility permission
    static func isAccessibilityEnabled() -> Bool {
        AXIsProcessTrusted()
    }

    /// Show permission dialog and request access
    static func showPermissionDialog(completion: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Accessibility Permission Required"
        alert.informativeText = """
        Bongo Cat needs Accessibility permission to monitor your typing speed.

        Click "Open System Settings" to grant permission, then restart Bongo Cat.
        """
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Cancel")

        let response = alert.runModal()

        if response == .alertFirstButtonReturn {
            // Request permission (will open System Settings)
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
            AXIsProcessTrustedWithOptions(options as CFDictionary)

            // Start polling for permission grant
            pollForPermission(completion: completion)
        }
    }

    /// Poll periodically to check if permission was granted
    private static func pollForPermission(completion: @escaping () -> Void) {
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
            if AXIsProcessTrusted() {
                timer.invalidate()
                completion()
            }
        }
    }
}
