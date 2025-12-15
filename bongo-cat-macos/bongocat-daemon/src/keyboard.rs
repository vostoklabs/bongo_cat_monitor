//! Global Keyboard Monitoring
//!
//! Uses rdev for cross-platform keyboard event capture.
//! On macOS, this requires Accessibility permission.

use rdev::{listen, Event, EventType, Key};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Instant;

/// Keyboard event sent from the listener thread
#[derive(Debug, Clone)]
pub struct KeystrokeEvent {
    pub timestamp: Instant,
}

/// Start global keyboard monitoring in a background thread
///
/// Returns a receiver for keystroke events. The listener runs until
/// the receiver is dropped or an error occurs.
pub fn start_listener() -> Result<Receiver<KeystrokeEvent>, String> {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let tx_clone = tx.clone();
        let callback = move |event: Event| {
            if should_count_key(&event) {
                let _ = tx_clone.send(KeystrokeEvent {
                    timestamp: Instant::now(),
                });
            }
        };

        if let Err(e) = listen(callback) {
            eprintln!("ERROR:keyboard:{:?}", e);
        }
    });

    Ok(rx)
}

/// Determine if a key event should be counted for WPM calculation
fn should_count_key(event: &Event) -> bool {
    // Only count key press events (not release)
    let EventType::KeyPress(key) = event.event_type else {
        return false;
    };

    // Filter out keys that shouldn't count towards typing speed
    !is_modifier_key(&key) && !is_function_key(&key) && !is_navigation_key(&key)
}

/// Check if key is a modifier (Ctrl, Shift, Alt, Cmd)
fn is_modifier_key(key: &Key) -> bool {
    matches!(
        key,
        Key::Alt
            | Key::AltGr
            | Key::ControlLeft
            | Key::ControlRight
            | Key::MetaLeft
            | Key::MetaRight
            | Key::ShiftLeft
            | Key::ShiftRight
            | Key::CapsLock
    )
}

/// Check if key is a function key (F1-F12, etc)
fn is_function_key(key: &Key) -> bool {
    matches!(
        key,
        Key::F1
            | Key::F2
            | Key::F3
            | Key::F4
            | Key::F5
            | Key::F6
            | Key::F7
            | Key::F8
            | Key::F9
            | Key::F10
            | Key::F11
            | Key::F12
            | Key::PrintScreen
            | Key::ScrollLock
            | Key::Pause
    )
}

/// Check if key is a navigation key (arrows, home, end, etc)
fn is_navigation_key(key: &Key) -> bool {
    matches!(
        key,
        Key::UpArrow
            | Key::DownArrow
            | Key::LeftArrow
            | Key::RightArrow
            | Key::Home
            | Key::End
            | Key::PageUp
            | Key::PageDown
            | Key::Insert
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_modifier_keys() {
        assert!(is_modifier_key(&Key::ShiftLeft));
        assert!(is_modifier_key(&Key::ControlLeft));
        assert!(is_modifier_key(&Key::MetaLeft)); // Cmd on macOS
        assert!(!is_modifier_key(&Key::KeyA));
    }

    #[test]
    fn test_function_keys() {
        assert!(is_function_key(&Key::F1));
        assert!(is_function_key(&Key::F12));
        assert!(!is_function_key(&Key::KeyA));
    }

    #[test]
    fn test_navigation_keys() {
        assert!(is_navigation_key(&Key::UpArrow));
        assert!(is_navigation_key(&Key::PageDown));
        assert!(!is_navigation_key(&Key::Space));
    }
}
