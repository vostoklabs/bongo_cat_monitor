# Bongo Cat Native macOS Client

A lightweight native macOS companion app for the Bongo Cat ESP32 display, built with Rust and Swift.

## Features

- Native menu bar app (~628KB total)
- Real-time WPM calculation with adaptive smoothing
- Automatic ESP32 detection (CP210x, CH340, FTDI)
- Minimal resource usage (designed for <20MB RAM)
- Accessibility permission handling

## Building

### Prerequisites

- Rust (install via [rustup](https://rustup.rs/))
- Xcode Command Line Tools (`xcode-select --install`)
- macOS 12.0 or later

### Build

```bash
cd bongo-cat-macos
make
```

This will:
1. Build the Rust daemon (`bongocat-daemon`)
2. Build the Swift menu bar app
3. Bundle everything into `build/BongoCat.app`
4. Code sign the app (ad-hoc)

### Run

```bash
make run
```

Or double-click `build/BongoCat.app`.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Swift Menu Bar App                                     │
│  - NSStatusItem (menu bar icon)                         │
│  - Start/Stop/Reconnect menu                            │
│  - Manages Rust daemon lifecycle                        │
│  - Handles Accessibility permission prompts             │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Spawns as subprocess
                           │ Communicates via stdout
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Rust Daemon (bongocat-daemon)                          │
│  - Global keyboard monitoring (rdev crate)              │
│  - WPM calculation with smoothing                       │
│  - CPU/RAM stats (sysinfo crate)                        │
│  - Serial communication (serialport crate)              │
└─────────────────────────────────────────────────────────┘
                           │
                           │ USB Serial @ 115200 baud
                           ▼
                    ┌─────────────┐
                    │   ESP32     │
                    └─────────────┘
```

## Permissions

The app requires **Accessibility permission** to monitor keyboard input for WPM calculation. On first launch, you'll be prompted to grant this permission in System Settings.

## Development

### Run Tests

```bash
make test-rust
```

### Clean Build

```bash
make clean
```

### Project Structure

```
bongo-cat-macos/
├── Makefile                    # Build orchestration
├── bongocat-daemon/            # Rust daemon
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs             # Entry point, update loop
│       ├── keyboard.rs         # Global keyboard monitoring
│       ├── wpm.rs              # WPM calculation
│       ├── serial.rs           # ESP32 serial communication
│       ├── system_stats.rs     # CPU/RAM monitoring
│       ├── state_machine.rs    # Animation state
│       └── protocol.rs         # ESP32 command builders
└── BongoCatApp/                # Swift menu bar app
    └── BongoCat/
        ├── BongoCatApp.swift
        ├── AppDelegate.swift
        ├── DaemonManager.swift
        ├── PermissionHelper.swift
        └── Info.plist
```

## Serial Protocol

The daemon communicates with the ESP32 using the same protocol as the Electron app:

| Command | Example | Description |
|---------|---------|-------------|
| `SPEED:<ms>` | `SPEED:150\n` | Animation speed (30-500ms) |
| `STOP` | `STOP\n` | Stop typing animation |
| `IDLE_START` | `IDLE_START\n` | Begin sleep progression |
| `STREAK_ON` | `STREAK_ON\n` | Enable happy face (≥65 WPM) |
| `STATS:CPU:n,RAM:n,WPM:n` | `STATS:CPU:45,RAM:67,WPM:23\n` | System stats |
| `TIME:<HH:MM>` | `TIME:14:30\n` | Current time |
