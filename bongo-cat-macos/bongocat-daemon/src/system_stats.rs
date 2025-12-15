//! System Statistics Monitoring
//!
//! CPU and RAM usage monitoring with smoothing.

use std::collections::VecDeque;
use sysinfo::System;

/// Number of samples to average for CPU smoothing
const CPU_SAMPLE_COUNT: usize = 5;

/// System monitor for CPU and RAM statistics
pub struct SystemMonitor {
    sys: System,
    cpu_samples: VecDeque<f32>,
}

impl SystemMonitor {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        // Initial CPU refresh to populate values
        sys.refresh_cpu_usage();

        Self {
            sys,
            cpu_samples: VecDeque::with_capacity(CPU_SAMPLE_COUNT),
        }
    }

    /// Refresh system statistics
    pub fn refresh(&mut self) {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();

        // Record CPU sample for smoothing - average across all CPUs
        let cpus = self.sys.cpus();
        let cpu = if cpus.is_empty() {
            0.0
        } else {
            cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
        };
        while self.cpu_samples.len() >= CPU_SAMPLE_COUNT {
            self.cpu_samples.pop_front();
        }
        self.cpu_samples.push_back(cpu);
    }

    /// Get smoothed CPU usage percentage (0-100)
    pub fn cpu_percent(&self) -> u8 {
        if self.cpu_samples.is_empty() {
            return 0;
        }

        let sum: f32 = self.cpu_samples.iter().sum();
        let avg = sum / self.cpu_samples.len() as f32;
        avg.clamp(0.0, 100.0) as u8
    }

    /// Get RAM usage percentage (0-100)
    pub fn ram_percent(&self) -> u8 {
        let total = self.sys.total_memory();
        let used = self.sys.used_memory();

        if total == 0 {
            return 0;
        }

        let percent = (used as f64 / total as f64) * 100.0;
        percent.clamp(0.0, 100.0) as u8
    }
}

impl Default for SystemMonitor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_monitor() {
        let mut monitor = SystemMonitor::new();
        monitor.refresh();

        let cpu = monitor.cpu_percent();
        let ram = monitor.ram_percent();

        // Just verify we get valid percentages
        assert!(cpu <= 100);
        assert!(ram <= 100);
        assert!(ram > 0); // Some RAM should always be in use
    }

    #[test]
    fn test_cpu_smoothing() {
        let mut monitor = SystemMonitor::new();

        // Refresh multiple times to fill the smoothing buffer
        for _ in 0..10 {
            monitor.refresh();
        }

        assert!(monitor.cpu_samples.len() <= CPU_SAMPLE_COUNT);
    }
}
