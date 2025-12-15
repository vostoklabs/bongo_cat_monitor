//! ESP32 Serial Communication
//!
//! Auto-detection and communication with ESP32 over USB serial.

use serialport::{SerialPort, SerialPortInfo, SerialPortType};
use std::io::{BufRead, BufReader, Write};
use std::time::{Duration, Instant};

/// Serial baud rate (matches ESP32 firmware)
const BAUD_RATE: u32 = 115200;

/// Serial read timeout
const TIMEOUT: Duration = Duration::from_secs(1);

/// Minimum interval between commands to prevent buffer overflow
const MIN_COMMAND_INTERVAL: Duration = Duration::from_millis(50);

/// Known USB vendor/product IDs for ESP32 USB-serial chips
const KNOWN_VENDORS: &[&str] = &[
    "10c4",  // Silicon Labs CP210x
    "1a86",  // CH340/CH341
    "0403",  // FTDI
    "303a",  // Espressif
];

const KNOWN_MANUFACTURERS: &[&str] = &[
    "Silicon Labs",
    "wch.cn",
    "FTDI",
    "Espressif",
];

/// Serial manager for ESP32 communication
pub struct SerialManager {
    port: Option<Box<dyn SerialPort>>,
    port_path: String,
    last_command_time: Instant,
}

impl SerialManager {
    pub fn new() -> Self {
        Self {
            port: None,
            port_path: String::new(),
            last_command_time: Instant::now() - MIN_COMMAND_INTERVAL,
        }
    }

    /// Detect ESP32 by scanning available serial ports
    pub fn detect_esp32() -> Option<String> {
        let ports = serialport::available_ports().ok()?;

        for port in ports {
            if Self::is_likely_esp32(&port) {
                return Some(port.port_name);
            }
        }

        // Fallback: look for common macOS patterns
        for port in serialport::available_ports().ok()? {
            let name = &port.port_name;
            if name.contains("cu.usbserial") || name.contains("cu.wchusbserial") || name.contains("cu.SLAB") {
                return Some(port.port_name);
            }
        }

        None
    }

    /// Check if a port is likely an ESP32
    fn is_likely_esp32(port: &SerialPortInfo) -> bool {
        if let SerialPortType::UsbPort(usb_info) = &port.port_type {
            // Check vendor ID
            let vid = format!("{:04x}", usb_info.vid);
            if KNOWN_VENDORS.contains(&vid.as_str()) {
                return true;
            }

            // Check manufacturer string
            if let Some(ref mfr) = usb_info.manufacturer {
                for known in KNOWN_MANUFACTURERS {
                    if mfr.to_lowercase().contains(&known.to_lowercase()) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Connect to ESP32 at the specified port
    pub fn connect(&mut self, port_path: &str) -> Result<(), String> {
        let port = serialport::new(port_path, BAUD_RATE)
            .timeout(TIMEOUT)
            .open()
            .map_err(|e| format!("Failed to open {}: {}", port_path, e))?;

        self.port = Some(port);
        self.port_path = port_path.to_string();

        // Give the ESP32 time to reset after connection
        std::thread::sleep(Duration::from_millis(100));

        Ok(())
    }

    /// Verify connection with ping/pong handshake
    pub fn verify_connection(&mut self) -> Result<(), String> {
        self.send_command("PING\n")?;

        // Read response
        if let Some(ref mut port) = self.port {
            let mut reader = BufReader::new(port.try_clone().map_err(|e| e.to_string())?);
            let mut response = String::new();

            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(2) {
                response.clear();
                if reader.read_line(&mut response).is_ok() && response.contains("PONG") {
                    return Ok(());
                }
            }
        }

        Err("No PONG response from ESP32".to_string())
    }

    /// Disconnect from ESP32
    pub fn disconnect(&mut self) {
        self.port = None;
        self.port_path.clear();
    }

    /// Check if connected
    pub fn is_connected(&self) -> bool {
        self.port.is_some()
    }

    /// Get the connected port path
    pub fn port_path(&self) -> &str {
        &self.port_path
    }

    /// Send a command to ESP32 (with rate limiting)
    pub fn send_command(&mut self, cmd: &str) -> Result<(), String> {
        let port = self.port.as_mut().ok_or("Not connected")?;

        // Rate limiting
        let elapsed = self.last_command_time.elapsed();
        if elapsed < MIN_COMMAND_INTERVAL {
            std::thread::sleep(MIN_COMMAND_INTERVAL - elapsed);
        }

        port.write_all(cmd.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;

        port.flush().map_err(|e| format!("Flush failed: {}", e))?;

        self.last_command_time = Instant::now();
        Ok(())
    }

    /// Send a command only if enough time has passed (non-blocking rate limit)
    pub fn try_send_command(&mut self, cmd: &str) -> Result<bool, String> {
        if self.last_command_time.elapsed() < MIN_COMMAND_INTERVAL {
            return Ok(false);
        }

        self.send_command(cmd)?;
        Ok(true)
    }
}

impl Default for SerialManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_returns_option() {
        // This test just verifies the function doesn't panic
        let _ = SerialManager::detect_esp32();
    }

    #[test]
    fn test_serial_manager_new() {
        let manager = SerialManager::new();
        assert!(!manager.is_connected());
        assert!(manager.port_path().is_empty());
    }
}
