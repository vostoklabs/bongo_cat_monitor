//! Animation State Machine
//!
//! Manages typing states with hysteresis to prevent oscillation.

use std::time::{Duration, Instant};

/// Idle timeout before stopping typing animation
const IDLE_TIMEOUT: Duration = Duration::from_secs(1);

/// Sleep timeout before starting sleep progression
const SLEEP_TIMEOUT: Duration = Duration::from_secs(60);

/// Hysteresis buffer to prevent state oscillation (±2 WPM)
const HYSTERESIS: f64 = 2.0;

/// WPM threshold for streak/happy mode
const STREAK_THRESHOLD: f64 = 65.0;

/// Animation states based on typing speed
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimationState {
    Idle,
    Slow,   // < 20 WPM
    Normal, // 20-39 WPM
    Fast,   // >= 40 WPM
}

impl AnimationState {
    /// Get the base WPM threshold for this state (without hysteresis)
    fn threshold(&self) -> f64 {
        match self {
            AnimationState::Idle => 0.0,
            AnimationState::Slow => 3.0,   // Minimum detection threshold
            AnimationState::Normal => 20.0,
            AnimationState::Fast => 40.0,
        }
    }
}

/// State change event
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StateChange {
    EnteredIdle,
    EnteredTyping(AnimationState),
    StreakStarted,
    StreakEnded,
    SleepStarted,
}

/// State machine managing animation states
pub struct StateMachine {
    current_state: AnimationState,
    last_transition: Instant,
    streak_active: bool,
    idle_start_time: Option<Instant>,
    sleep_triggered: bool,
}

impl StateMachine {
    pub fn new() -> Self {
        Self {
            current_state: AnimationState::Idle,
            last_transition: Instant::now(),
            streak_active: false,
            idle_start_time: Some(Instant::now()),
            sleep_triggered: false,
        }
    }

    /// Get the current animation state
    pub fn current_state(&self) -> AnimationState {
        self.current_state
    }

    /// Check if streak (happy) mode is active
    pub fn is_streak_active(&self) -> bool {
        self.streak_active
    }

    /// Update state based on current WPM and typing activity
    ///
    /// Returns state changes that occurred (if any)
    pub fn update(
        &mut self,
        wpm: f64,
        last_keystroke: Option<Instant>,
    ) -> Vec<StateChange> {
        let mut changes = Vec::new();
        let now = Instant::now();

        // Check for idle timeout
        let is_typing = if let Some(last_key) = last_keystroke {
            now.duration_since(last_key) < IDLE_TIMEOUT
        } else {
            false
        };

        // Handle idle state transitions
        if !is_typing && self.current_state != AnimationState::Idle {
            self.current_state = AnimationState::Idle;
            self.idle_start_time = Some(now);
            self.last_transition = now;
            changes.push(StateChange::EnteredIdle);

            // End streak if active
            if self.streak_active {
                self.streak_active = false;
                changes.push(StateChange::StreakEnded);
            }
        } else if is_typing && self.current_state == AnimationState::Idle {
            // Transitioning from idle to typing
            self.idle_start_time = None;
            self.sleep_triggered = false;
        }

        // Check for sleep trigger
        if let Some(idle_start) = self.idle_start_time {
            if !self.sleep_triggered && now.duration_since(idle_start) >= SLEEP_TIMEOUT {
                self.sleep_triggered = true;
                changes.push(StateChange::SleepStarted);
            }
        }

        // Update typing state with hysteresis
        if is_typing {
            let new_state = self.determine_state_with_hysteresis(wpm);
            if new_state != self.current_state {
                self.current_state = new_state;
                self.last_transition = now;
                changes.push(StateChange::EnteredTyping(new_state));
            }

            // Check streak mode
            let should_streak = wpm >= STREAK_THRESHOLD;
            if should_streak && !self.streak_active {
                self.streak_active = true;
                changes.push(StateChange::StreakStarted);
            } else if !should_streak && self.streak_active {
                // Add hysteresis for streak mode too
                if wpm < STREAK_THRESHOLD - HYSTERESIS {
                    self.streak_active = false;
                    changes.push(StateChange::StreakEnded);
                }
            }
        }

        changes
    }

    /// Determine state with hysteresis to prevent oscillation
    fn determine_state_with_hysteresis(&self, wpm: f64) -> AnimationState {
        // Apply hysteresis based on current state
        let effective_wpm = match self.current_state {
            AnimationState::Idle => wpm,
            AnimationState::Slow => {
                // Need to exceed Normal threshold + hysteresis to transition up
                // But only need to drop below Slow threshold - hysteresis to drop
                wpm
            }
            AnimationState::Normal => wpm,
            AnimationState::Fast => wpm,
        };

        // Determine target state
        let target = if effective_wpm < 3.0 {
            AnimationState::Idle
        } else if effective_wpm < 20.0 {
            AnimationState::Slow
        } else if effective_wpm < 40.0 {
            AnimationState::Normal
        } else {
            AnimationState::Fast
        };

        // Apply hysteresis: require exceeding threshold by HYSTERESIS amount to transition
        match (self.current_state, target) {
            // Transitions up require exceeding by hysteresis
            (AnimationState::Slow, AnimationState::Normal) if wpm < 20.0 + HYSTERESIS => {
                AnimationState::Slow
            }
            (AnimationState::Normal, AnimationState::Fast) if wpm < 40.0 + HYSTERESIS => {
                AnimationState::Normal
            }
            // Transitions down require dropping below by hysteresis
            (AnimationState::Normal, AnimationState::Slow) if wpm > 20.0 - HYSTERESIS => {
                AnimationState::Normal
            }
            (AnimationState::Fast, AnimationState::Normal) if wpm > 40.0 - HYSTERESIS => {
                AnimationState::Fast
            }
            // Default to target state
            _ => target,
        }
    }

    /// Check if sleep mode should be triggered
    pub fn should_sleep(&self) -> bool {
        self.sleep_triggered
    }

    /// Reset sleep trigger (called when sleep command is sent)
    pub fn acknowledge_sleep(&mut self) {
        self.sleep_triggered = false;
    }
}

impl Default for StateMachine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state() {
        let sm = StateMachine::new();
        assert_eq!(sm.current_state(), AnimationState::Idle);
        assert!(!sm.is_streak_active());
    }

    #[test]
    fn test_state_transitions() {
        let mut sm = StateMachine::new();
        let now = Instant::now();

        // Should transition to Slow when typing
        let changes = sm.update(10.0, Some(now));
        assert_eq!(sm.current_state(), AnimationState::Slow);
        assert!(changes.contains(&StateChange::EnteredTyping(AnimationState::Slow)));

        // Should transition to Normal at 22 WPM (above threshold + hysteresis)
        let changes = sm.update(22.0, Some(now));
        assert_eq!(sm.current_state(), AnimationState::Normal);
        assert!(changes.contains(&StateChange::EnteredTyping(AnimationState::Normal)));

        // Should stay Normal at 42 WPM (need >= 42 to go to Fast)
        sm.update(41.0, Some(now));
        assert_eq!(sm.current_state(), AnimationState::Normal);

        // Should transition to Fast at 42+ WPM
        let changes = sm.update(42.0, Some(now));
        assert_eq!(sm.current_state(), AnimationState::Fast);
        assert!(changes.contains(&StateChange::EnteredTyping(AnimationState::Fast)));
    }

    #[test]
    fn test_streak_mode() {
        let mut sm = StateMachine::new();
        let now = Instant::now();

        // Start typing fast
        sm.update(70.0, Some(now));
        assert!(sm.is_streak_active());

        // Drop below streak threshold with hysteresis
        sm.update(64.0, Some(now)); // Still above 65-2=63
        assert!(sm.is_streak_active());

        // Drop significantly below
        sm.update(60.0, Some(now));
        assert!(!sm.is_streak_active());
    }

    #[test]
    fn test_idle_transition() {
        let mut sm = StateMachine::new();
        let now = Instant::now();
        let past = now - Duration::from_secs(2);

        // First, start typing (recent keystroke)
        sm.update(30.0, Some(now));
        assert_eq!(sm.current_state(), AnimationState::Normal);

        // Now simulate idle timeout (keystroke in the past)
        let changes = sm.update(30.0, Some(past));
        assert_eq!(sm.current_state(), AnimationState::Idle);
        assert!(changes.contains(&StateChange::EnteredIdle));
    }
}
