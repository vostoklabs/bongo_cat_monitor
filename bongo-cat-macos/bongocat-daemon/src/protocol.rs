//! ESP32 Serial Protocol Commands
//!
//! The ESP32 firmware expects newline-terminated ASCII commands at 115200 baud.

/// Generate SPEED command (animation speed in ms, 30-500)
pub fn speed_command(speed_ms: u16) -> String {
    format!("SPEED:{}\n", speed_ms.clamp(30, 500))
}

/// Generate STOP command (stop typing animation, return to idle)
pub fn stop_command() -> &'static str {
    "STOP\n"
}

/// Generate IDLE_START command (begin sleep progression)
pub fn idle_start_command() -> &'static str {
    "IDLE_START\n"
}

/// Generate STREAK_ON command (enable happy face for high WPM)
pub fn streak_on_command() -> &'static str {
    "STREAK_ON\n"
}

/// Generate STREAK_OFF command (disable happy face)
pub fn streak_off_command() -> &'static str {
    "STREAK_OFF\n"
}

/// Generate STATS command with CPU, RAM, and WPM values
pub fn stats_command(cpu: u8, ram: u8, wpm: u8) -> String {
    format!("STATS:CPU:{},RAM:{},WPM:{}\n", cpu, ram, wpm)
}

/// Generate TIME command (24h format HH:MM)
pub fn time_command(time: &str) -> String {
    format!("TIME:{}\n", time)
}

/// Generate PING command for connection testing
pub fn ping_command() -> &'static str {
    "PING\n"
}

/// Generate HEARTBEAT command for keepalive
pub fn heartbeat_command() -> &'static str {
    "HEARTBEAT\n"
}

/// Convert WPM to animation speed in milliseconds
///
/// Uses linear interpolation: higher WPM = lower ms (faster animation)
/// Range: 500ms (0 WPM) to 30ms (200 WPM)
pub fn wpm_to_speed(wpm: f64) -> u16 {
    const MIN_SPEED: f64 = 30.0;
    const MAX_SPEED: f64 = 500.0;
    const MAX_WPM: f64 = 200.0;

    let speed = MAX_SPEED - (wpm / MAX_WPM) * (MAX_SPEED - MIN_SPEED);
    speed.clamp(MIN_SPEED, MAX_SPEED) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_speed_command() {
        assert_eq!(speed_command(150), "SPEED:150\n");
        assert_eq!(speed_command(0), "SPEED:30\n"); // Clamped to min
        assert_eq!(speed_command(1000), "SPEED:500\n"); // Clamped to max
    }

    #[test]
    fn test_stats_command() {
        assert_eq!(stats_command(45, 67, 23), "STATS:CPU:45,RAM:67,WPM:23\n");
    }

    #[test]
    fn test_time_command() {
        assert_eq!(time_command("14:30"), "TIME:14:30\n");
    }

    #[test]
    fn test_wpm_to_speed() {
        assert_eq!(wpm_to_speed(0.0), 500);
        assert_eq!(wpm_to_speed(200.0), 30);
        assert_eq!(wpm_to_speed(100.0), 265); // Midpoint
        assert_eq!(wpm_to_speed(300.0), 30); // Clamped
    }
}
