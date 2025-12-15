//! WPM (Words Per Minute) Calculation
//!
//! Industry-standard calculation using adaptive smoothing.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Maximum keystrokes to track in the buffer
const BUFFER_SIZE: usize = 50;

/// Number of recent keystrokes to use for WPM calculation
const CALC_WINDOW: usize = 8;

/// Minimum time span required for calculation (prevents unrealistic spikes)
const MIN_TIME_SPAN: Duration = Duration::from_millis(400);

/// Maximum WPM cap (professional typist range)
const MAX_WPM: f64 = 200.0;

/// Standard word length (characters per word)
const CHARS_PER_WORD: f64 = 5.0;

/// WPM calculator with adaptive smoothing
pub struct WpmCalculator {
    keystroke_buffer: VecDeque<Instant>,
    smoothed_wpm: f64,
    last_calc_time: Instant,
}

impl WpmCalculator {
    pub fn new() -> Self {
        Self {
            keystroke_buffer: VecDeque::with_capacity(BUFFER_SIZE),
            smoothed_wpm: 0.0,
            last_calc_time: Instant::now(),
        }
    }

    /// Record a new keystroke
    pub fn record_keystroke(&mut self, timestamp: Instant) {
        // Maintain buffer size
        while self.keystroke_buffer.len() >= BUFFER_SIZE {
            self.keystroke_buffer.pop_front();
        }
        self.keystroke_buffer.push_back(timestamp);
    }

    /// Get the timestamp of the last keystroke
    pub fn last_keystroke_time(&self) -> Option<Instant> {
        self.keystroke_buffer.back().copied()
    }

    /// Clear the keystroke buffer (called on idle timeout)
    pub fn clear(&mut self) {
        self.keystroke_buffer.clear();
        self.smoothed_wpm = 0.0;
    }

    /// Calculate current WPM with adaptive smoothing
    pub fn calculate(&mut self) -> f64 {
        let now = Instant::now();

        // Get recent keystrokes for calculation
        let recent: Vec<Instant> = self
            .keystroke_buffer
            .iter()
            .rev()
            .take(CALC_WINDOW)
            .copied()
            .collect();

        // Need at least 2 keystrokes to calculate
        if recent.len() < 2 {
            self.smoothed_wpm = 0.0;
            return 0.0;
        }

        // Calculate time span between oldest and newest in window
        let oldest = recent.last().unwrap();
        let newest = recent.first().unwrap();
        let time_span = newest.duration_since(*oldest);

        // Require minimum time span
        if time_span < MIN_TIME_SPAN {
            return self.smoothed_wpm;
        }

        // Industry standard: (keystrokes / chars_per_word) * (60 / time_in_seconds)
        let keystroke_count = recent.len() as f64;
        let time_span_secs = time_span.as_secs_f64();
        let raw_wpm = (keystroke_count / CHARS_PER_WORD) * (60.0 / time_span_secs);
        let raw_wpm = raw_wpm.min(MAX_WPM);

        // Apply adaptive smoothing
        let smoothed = self.apply_adaptive_smoothing(raw_wpm);
        self.smoothed_wpm = smoothed;
        self.last_calc_time = now;

        smoothed
    }

    /// Get the current smoothed WPM without recalculating
    pub fn current_wpm(&self) -> f64 {
        self.smoothed_wpm
    }

    /// Apply adaptive smoothing based on change magnitude
    fn apply_adaptive_smoothing(&self, raw_wpm: f64) -> f64 {
        let diff = (raw_wpm - self.smoothed_wpm).abs();

        // Adaptive weights: respond faster to large changes, smooth small fluctuations
        let new_weight = if diff > 15.0 {
            0.7 // Large change: 70% new value (responsive)
        } else if diff > 5.0 {
            0.4 // Medium change: 40% new value
        } else {
            0.2 // Small change: 20% new value (stable)
        };

        let old_weight = 1.0 - new_weight;
        self.smoothed_wpm * old_weight + raw_wpm * new_weight
    }
}

impl Default for WpmCalculator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_empty_buffer() {
        let mut calc = WpmCalculator::new();
        assert_eq!(calc.calculate(), 0.0);
    }

    #[test]
    fn test_single_keystroke() {
        let mut calc = WpmCalculator::new();
        calc.record_keystroke(Instant::now());
        assert_eq!(calc.calculate(), 0.0);
    }

    #[test]
    fn test_wpm_calculation() {
        let mut calc = WpmCalculator::new();
        let now = Instant::now();

        // Simulate 10 keystrokes over 1 second (600 chars/min = 120 WPM)
        for i in 0..10 {
            calc.record_keystroke(now + Duration::from_millis(i * 100));
        }

        // Manually set the smoothed value to get accurate calculation
        calc.smoothed_wpm = 0.0;

        let wpm = calc.calculate();
        // 10 keystrokes / 5 chars per word = 2 words
        // 2 words in ~0.9 seconds = ~133 WPM raw, smoothed will be lower
        assert!(wpm > 0.0 && wpm < MAX_WPM);
    }

    #[test]
    fn test_buffer_overflow() {
        let mut calc = WpmCalculator::new();
        let now = Instant::now();

        // Add more than BUFFER_SIZE keystrokes
        for i in 0..100 {
            calc.record_keystroke(now + Duration::from_millis(i * 50));
        }

        assert!(calc.keystroke_buffer.len() <= BUFFER_SIZE);
    }

    #[test]
    fn test_clear() {
        let mut calc = WpmCalculator::new();
        calc.record_keystroke(Instant::now());
        calc.smoothed_wpm = 50.0;

        calc.clear();

        assert!(calc.keystroke_buffer.is_empty());
        assert_eq!(calc.smoothed_wpm, 0.0);
    }
}
