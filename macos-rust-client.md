# Feature: Native macOS Companion App (Rust + Swift)

## Summary

Replace the Electron-based Mac companion app with a lightweight native implementation using Rust for the core daemon and Swift for the menu bar UI. This addresses user complaints about permissions, performance, and resource usage.

## Motivation

The existing Electron app has several issues on macOS:
- Heavy resource footprint (~100MB+ RAM for what should be a simple background task)
- Confusing permission prompts (Electron's Accessibility permission flow is opaque)
- Reports of performance issues and freezing
- Requires Node.js ecosystem for what is fundamentally a simple serial + input monitoring task

A native implementation should:
- Use <10MB RAM
- Provide clear, native permission dialogs
- Be a single binary with no runtime dependencies
- Feel like a proper Mac app

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Swift Menu Bar App                                     │
│  - NSStatusItem (menu bar icon)                         │
│  - Start/Stop/Reconnect menu                            │
│  - Manages Rust daemon lifecycle                        │
│  - Handles Accessibility permission prompts             │
│  - Displays connection status                           │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Spawns as subprocess
                           │ Communicates via stdout/stderr
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Rust Daemon (bongocat-daemon)                          │
│  - Global keyboard monitoring (rdev crate)              │
│  - WPM calculation with smoothing                       │
│  - CPU/RAM stats (sysinfo crate)                        │
│  - Serial communication (serialport crate)              │
│  - Outputs status to stdout for Swift app to display    │
└─────────────────────────────────────────────────────────┘
                           │
                           │ USB Serial @ 115200 baud
                           │ Newline-terminated ASCII commands
                           ▼
                    ┌─────────────┐
                    │   ESP32     │
                    │  (existing  │
                    │  firmware)  │
                    └─────────────┘
```

---

## ESP32 Serial Protocol

The ESP32 firmware expects newline-terminated ASCII commands at 115200 baud. The protocol is already defined in the existing firmware (`bongo_cat.ino`):

### Commands to Send

| Command | Example | Description |
|---------|---------|-------------|
| `SPEED:<ms>` | `SPEED:150\n` | Animation speed in ms (30-500, lower = faster typing) |
| `STOP` | `STOP\n` | Stop typing animation, return to idle |
| `IDLE_START` | `IDLE_START\n` | Begin sleep progression after idle timeout |
| `STREAK_ON` | `STREAK_ON\n` | Enable happy face (≥65 WPM) |
| `STREAK_OFF` | `STREAK_OFF\n` | Disable happy face |
| `STATS:CPU:<n>,RAM:<n>,WPM:<n>` | `STATS:CPU:45,RAM:67,WPM:23\n` | System stats |
| `TIME:<HH:MM>` | `TIME:14:30\n` | Current time (24h format) |
| `PING` | `PING\n` | Connection test |

### Responses from ESP32

| Response | Meaning |
|----------|---------|
| `PONG` | Response to `PING` |

### Animation Speed Mapping

The firmware interprets `SPEED` values as follows:
- `speed < 80` → Slow typing state
- `80 ≤ speed < 150` → Normal typing state  
- `speed ≥ 150` → Fast typing state

Speed is calculated from WPM using linear interpolation:
```
speed_ms = 500 - (wpm / 200) * (500 - 40)
```

---

## Rust Daemon Specification

### Dependencies

```toml
[dependencies]
serialport = "4.3"      # Serial port communication
sysinfo = "0.30"        # CPU/RAM monitoring
rdev = "0.5"            # Global keyboard input (cross-platform)
chrono = "0.4"          # Time formatting
```

### Core Logic

1. **ESP32 Detection**: Scan `/dev/cu.*` for common ESP32 USB-serial chips (CP210x, CH340, CH341, FTDI)

2. **Keyboard Monitoring**: Use `rdev` crate to listen for global `KeyPress` events
   - Requires Accessibility permission on macOS
   - Store last 50 keystroke timestamps in a ring buffer

3. **WPM Calculation** (industry standard):
   - Use last 8 keystrokes for responsive calculation
   - Formula: `(keystroke_count / 5) * (60 / time_span_seconds)`
   - Apply adaptive smoothing (heavier smoothing for small changes)
   - Cap at 200 WPM

4. **State Machine**:
   ```
   IDLE ──(≥3 WPM)──► SLOW/NORMAL/FAST
     ▲                      │
     └──(no input 1s)───────┘
   ```
   - Use hysteresis (±2 WPM) to prevent state oscillation
   - After 60s idle, send `IDLE_START` for sleep animation

5. **Update Loop** (~12 FPS):
   - Check for new keystrokes
   - Calculate smoothed WPM
   - Send `SPEED:` command if changed significantly (>25ms difference)
   - Send `STATS:` every 2 seconds
   - Send `TIME:` every 30 seconds
   - Send keepalive during active typing every 1 second

### Output Format

The daemon should output structured status to stdout for the Swift wrapper:
```
STATUS:connected
STATUS:disconnected
STATUS:typing:45  (WPM)
STATUS:idle
ERROR:No ESP32 found
```

---

## Swift Menu Bar App Specification

### Features

- **Menu Bar Icon**: SF Symbol `cat.fill` (template image for dark/light mode)
- **Status Indicator**: Green dot = running, red = stopped/error
- **Menu Items**:
  - Status text (e.g., "● Connected - 45 WPM")
  - Start / Stop
  - Reconnect ESP32
  - About
  - Quit

### Daemon Management

- Bundle the Rust binary in `Contents/Resources/`
- Spawn as `Process()` subprocess on app launch
- Capture stdout to update status display
- Terminate on app quit or Stop action

### Permissions

- Check `AXIsProcessTrustedWithOptions` on launch
- If not trusted, prompt user with explanation dialog before attempting to start daemon
- The Rust daemon (not Swift app) is what needs Accessibility permission

### Info.plist Keys

```xml
<key>LSUIElement</key>
<true/>  <!-- Hide from Dock -->

<key>NSAppleEventsUsageDescription</key>
<string>Bongo Cat needs Accessibility access to monitor typing speed.</string>
```

---

## File Structure

```
BongoCat/
├── BongoCatApp/                    # Swift menu bar app
│   ├── BongoCatApp.swift           # @main entry point
│   ├── AppDelegate.swift           # Menu bar + daemon management
│   ├── Assets.xcassets/
│   └── Info.plist
├── bongocat-daemon/                # Rust daemon
│   ├── Cargo.toml
│   └── src/
│       └── main.rs
├── Makefile                        # Build orchestration
└── README.md
```

---

## Build & Distribution

### Makefile Targets

```makefile
all: build-rust build-swift bundle

build-rust:
    cd bongocat-daemon && cargo build --release
    
build-swift:
    xcodebuild -project BongoCatApp/BongoCat.xcodeproj -scheme BongoCat -configuration Release
    
bundle:
    # Copy Rust binary into .app bundle
    cp bongocat-daemon/target/release/bongocat-daemon \
       BongoCatApp/build/Release/BongoCat.app/Contents/Resources/
    
codesign:
    codesign --force --deep --sign - BongoCatApp/build/Release/BongoCat.app
```

### Distribution

For personal use: ad-hoc signing is sufficient.
For distribution: would need Developer ID signing + notarization.

---

## Acceptance Criteria

- [ ] Rust daemon compiles on macOS (arm64 + x86_64)
- [ ] Daemon auto-detects ESP32 on common USB-serial chips
- [ ] Keyboard monitoring works with Accessibility permission granted
- [ ] WPM calculation matches existing Python implementation (±5 WPM tolerance)
- [ ] All serial commands from protocol table are implemented
- [ ] Swift app displays in menu bar with working Start/Stop
- [ ] Swift app prompts for Accessibility permission if not granted
- [ ] App correctly spawns and terminates Rust daemon
- [ ] Total RAM usage <20MB when running
- [ ] App builds with single `make` command

---

## Testing

1. **Unit Tests (Rust)**:
   - WPM calculation with mock keystroke data
   - Animation speed mapping
   - State machine transitions

2. **Integration Tests**:
   - Serial loopback test (if no ESP32 available)
   - Full end-to-end with actual ESP32 hardware

3. **Manual Testing**:
   - Fresh macOS install (no prior permissions)
   - Permission grant/deny flows
   - USB disconnect/reconnect handling
   - Sleep/wake behavior

---

## References

- [Original Bongo Cat Monitor repo](https://github.com/vostoklabs/bongo_cat_monitor)
- ESP32 firmware: `bongo_cat.ino` in repo root
- Python reference implementation: `bongo_cat_app/engine.py`
- [rdev crate docs](https://docs.rs/rdev)
- [serialport crate docs](https://docs.rs/serialport)

---

## Notes

- The ESP32 firmware remains unchanged - this only replaces the desktop companion app
- The `rdev` crate handles the cross-platform keyboard monitoring; on macOS it uses the Accessibility API under the hood
- Consider adding a "Launch at Login" option in future iteration
