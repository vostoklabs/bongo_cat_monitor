//! Bongo Cat Daemon
//!
//! Native macOS daemon for keyboard monitoring, WPM calculation,
//! and ESP32 serial communication.

mod keyboard;
mod protocol;
mod serial;
mod state_machine;
mod system_stats;
mod wpm;

use chrono::Local;
use serial::SerialManager;
use state_machine::{AnimationState, StateChange, StateMachine};
use std::io::{self, Write};
use std::sync::mpsc::TryRecvError;
use std::time::{Duration, Instant};
use system_stats::SystemMonitor;
use wpm::WpmCalculator;

/// Main update loop interval (80ms = 12.5 FPS)
const UPDATE_INTERVAL: Duration = Duration::from_millis(80);

/// Interval for sending system stats to ESP32
const STATS_INTERVAL: Duration = Duration::from_secs(2);

/// Interval for syncing time with ESP32
const TIME_SYNC_INTERVAL: Duration = Duration::from_secs(30);

/// Minimum speed change to send update (prevents micro-adjustments)
const SPEED_CHANGE_THRESHOLD: u16 = 25;

/// Reconnection attempt interval
const RECONNECT_INTERVAL: Duration = Duration::from_secs(3);

/// Maximum reconnection attempts before giving up
const MAX_RECONNECT_ATTEMPTS: u32 = 3;

/// Application context holding all state
struct AppContext {
    wpm_calc: WpmCalculator,
    state_machine: StateMachine,
    system_monitor: SystemMonitor,
    serial: SerialManager,
    last_stats_time: Instant,
    last_time_sync: Instant,
    last_speed_sent: u16,
    reconnect_attempts: u32,
    last_reconnect_attempt: Instant,
}

impl AppContext {
    fn new() -> Self {
        Self {
            wpm_calc: WpmCalculator::new(),
            state_machine: StateMachine::new(),
            system_monitor: SystemMonitor::new(),
            serial: SerialManager::new(),
            last_stats_time: Instant::now(),
            last_time_sync: Instant::now() - TIME_SYNC_INTERVAL, // Force immediate sync
            last_speed_sent: 500,
            reconnect_attempts: 0,
            last_reconnect_attempt: Instant::now() - RECONNECT_INTERVAL,
        }
    }
}

fn main() {
    // Output status for Swift app
    output_status("starting");

    // Start keyboard listener
    let key_rx = match keyboard::start_listener() {
        Ok(rx) => rx,
        Err(e) => {
            output_error(&format!("Failed to start keyboard listener: {}", e));
            output_error("fatal:Accessibility permission required");
            std::process::exit(1);
        }
    };

    let mut ctx = AppContext::new();

    // Initial ESP32 detection and connection
    attempt_connection(&mut ctx);

    // Main update loop
    let mut last_update = Instant::now();

    loop {
        let now = Instant::now();

        // Process keyboard events (non-blocking)
        loop {
            match key_rx.try_recv() {
                Ok(event) => {
                    ctx.wpm_calc.record_keystroke(event.timestamp);
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    output_error("fatal:Keyboard listener disconnected");
                    std::process::exit(1);
                }
            }
        }

        // Run update at fixed interval
        if now.duration_since(last_update) >= UPDATE_INTERVAL {
            update(&mut ctx);
            last_update = now;
        }

        // Handle reconnection if disconnected
        if !ctx.serial.is_connected() && ctx.reconnect_attempts < MAX_RECONNECT_ATTEMPTS {
            if now.duration_since(ctx.last_reconnect_attempt) >= RECONNECT_INTERVAL {
                attempt_connection(&mut ctx);
            }
        }

        // Small sleep to prevent busy-waiting
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Attempt to connect to ESP32
fn attempt_connection(ctx: &mut AppContext) {
    ctx.last_reconnect_attempt = Instant::now();

    if let Some(port) = SerialManager::detect_esp32() {
        match ctx.serial.connect(&port) {
            Ok(()) => {
                // Verify connection
                match ctx.serial.verify_connection() {
                    Ok(()) => {
                        output_status(&format!("connected:{}", port));
                        ctx.reconnect_attempts = 0;

                        // Send initial time sync
                        send_time_sync(ctx);
                    }
                    Err(e) => {
                        output_error(&format!("Connection verification failed: {}", e));
                        ctx.serial.disconnect();
                        ctx.reconnect_attempts += 1;
                    }
                }
            }
            Err(e) => {
                output_error(&format!("Connection failed: {}", e));
                ctx.reconnect_attempts += 1;
            }
        }
    } else {
        if ctx.reconnect_attempts == 0 {
            output_error("No ESP32 found");
        }
        ctx.reconnect_attempts += 1;
    }
}

/// Main update function (called at UPDATE_INTERVAL)
fn update(ctx: &mut AppContext) {
    let now = Instant::now();

    // Calculate WPM
    let wpm = ctx.wpm_calc.calculate();
    let last_keystroke = ctx.wpm_calc.last_keystroke_time();

    // Update state machine
    let state_changes = ctx.state_machine.update(wpm, last_keystroke);

    // Process state changes
    for change in &state_changes {
        handle_state_change(ctx, change, wpm);
    }

    // Send speed updates during active typing
    if ctx.state_machine.current_state() != AnimationState::Idle {
        send_speed_update(ctx, wpm);

        // Output typing status
        output_status(&format!("typing:{}", wpm as u32));
    }

    // Send periodic stats
    if now.duration_since(ctx.last_stats_time) >= STATS_INTERVAL {
        send_stats(ctx, wpm);
        ctx.last_stats_time = now;
    }

    // Send periodic time sync
    if now.duration_since(ctx.last_time_sync) >= TIME_SYNC_INTERVAL {
        send_time_sync(ctx);
        ctx.last_time_sync = now;
    }
}

/// Handle state machine state changes
fn handle_state_change(ctx: &mut AppContext, change: &StateChange, _wpm: f64) {
    if !ctx.serial.is_connected() {
        return;
    }

    match change {
        StateChange::EnteredIdle => {
            output_status("idle");
            let _ = ctx.serial.send_command(protocol::stop_command());
            ctx.wpm_calc.clear();
        }
        StateChange::EnteredTyping(_state) => {
            // Speed update will be sent in the regular update cycle
        }
        StateChange::StreakStarted => {
            output_status("streak");
            let _ = ctx.serial.send_command(protocol::streak_on_command());
        }
        StateChange::StreakEnded => {
            let _ = ctx.serial.send_command(protocol::streak_off_command());
        }
        StateChange::SleepStarted => {
            let _ = ctx.serial.send_command(protocol::idle_start_command());
            ctx.state_machine.acknowledge_sleep();
        }
    }
}

/// Send speed update to ESP32 (with threshold filtering)
fn send_speed_update(ctx: &mut AppContext, wpm: f64) {
    if !ctx.serial.is_connected() {
        return;
    }

    let speed = protocol::wpm_to_speed(wpm);

    // Only send if change exceeds threshold
    let diff = (speed as i32 - ctx.last_speed_sent as i32).unsigned_abs() as u16;
    if diff >= SPEED_CHANGE_THRESHOLD {
        let cmd = protocol::speed_command(speed);
        if ctx.serial.try_send_command(&cmd).unwrap_or(false) {
            ctx.last_speed_sent = speed;
        }
    }
}

/// Send system stats to ESP32
fn send_stats(ctx: &mut AppContext, wpm: f64) {
    ctx.system_monitor.refresh();

    if !ctx.serial.is_connected() {
        return;
    }

    let cpu = ctx.system_monitor.cpu_percent();
    let ram = ctx.system_monitor.ram_percent();
    let wpm_int = wpm.clamp(0.0, 255.0) as u8;

    let cmd = protocol::stats_command(cpu, ram, wpm_int);
    let _ = ctx.serial.send_command(&cmd);
}

/// Send time sync to ESP32
fn send_time_sync(ctx: &mut AppContext) {
    if !ctx.serial.is_connected() {
        return;
    }

    let time = Local::now().format("%H:%M").to_string();
    let cmd = protocol::time_command(&time);
    let _ = ctx.serial.send_command(&cmd);
}

/// Output status message for Swift app to parse
fn output_status(status: &str) {
    println!("STATUS:{}", status);
    let _ = io::stdout().flush();
}

/// Output error message for Swift app to parse
fn output_error(msg: &str) {
    println!("ERROR:{}", msg);
    let _ = io::stdout().flush();
}
