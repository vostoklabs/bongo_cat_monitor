// Using uiohook-napi for global keyboard monitoring
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { execSync } = require('child_process');

/**
 * Keyboard Monitor for WPM Calculation
 * Tracks typing activity and calculates words per minute
 */
class KeyboardMonitor {
    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter;
        this.isMonitoring = false;
        
        // WPM calculation data - FAST RESPONSE LIKE PYTHON APP
        this.keystrokes = [];
        this.maxKeystrokeAge = 60000; // 60 seconds for WPM calculation
        this.wpmUpdateInterval = 80; // 12 FPS like Python app (was 1000ms)
        this.wpmTimer = null;
        
        // Typing session data
        this.currentSession = {
            startTime: null,
            totalKeystrokes: 0,
            currentWPM: 0,
            lastKeystrokeTime: 0
        };
        
        // FAST ANIMATION TIMING - Like Python app
        this.lastWPMUpdate = 0;
        this.wpmUpdateThrottle = 50; // Very fast updates during typing (was 500ms)
        this.idleTimeout = 1000; // 1 second idle timeout like Python app
        this.typingActive = false; // Track active typing state
        
        // Fallback mode flag
        this.fallbackMode = false;

        
        console.log('Keyboard Monitor initialized');
    }

    /**
     * Check if we have accessibility permissions on macOS
     */
    checkAccessibilityPermissions() {
        if (process.platform !== 'darwin') {
            return true; // Not macOS, assume we have permissions
        }

        try {
            // On macOS, try to check if Electron has accessibility permissions
            // This uses a native check that won't crash
            const { systemPreferences } = require('electron');

            if (systemPreferences && typeof systemPreferences.isTrustedAccessibilityClient === 'function') {
                const isTrusted = systemPreferences.isTrustedAccessibilityClient(false);
                console.log('🔍 Accessibility permissions check:', isTrusted ? 'GRANTED ✅' : 'DENIED ❌');
                return isTrusted;
            }

            // Fallback: assume no permissions if we can't check
            console.log('⚠️  Unable to check accessibility permissions');
            return false;
        } catch (error) {
            console.log('⚠️  Error checking accessibility permissions:', error.message);
            return false;
        }
    }

    /**
     * Start keyboard monitoring
     */
    async startMonitoring() {
        try {
            if (this.isMonitoring) {
                console.log('Keyboard monitoring already active');
                return { success: true };
            }

            console.log('Starting keyboard monitoring...');
            console.log('⚠️ Note: Keyboard monitoring requires accessibility permissions on macOS');
            console.log('💡 If prompted, grant accessibility permissions in System Settings > Privacy & Security > Accessibility');

            // Check for accessibility permissions on macOS
            if (!this.checkAccessibilityPermissions()) {
                console.error('❌ Accessibility permissions not granted!');
                console.error('');
                console.error('📋 To grant permissions on macOS:');
                console.error('   1. Open System Settings');
                console.error('   2. Go to Privacy & Security > Accessibility');
                console.error('   3. Click the lock to make changes');
                console.error('   4. Add Electron (or this app) to the allowed list');
                console.error('   5. Restart this app');
                console.error('');

                this.handlePermissionError(new Error('Accessibility permissions required'));

                return {
                    success: false,
                    error: 'Accessibility permissions not granted',
                    needsPermissions: true,
                    fallbackMode: true
                };
            }

            try {
                // Set up keyboard event listener
                let eventCount = 0;
                uIOhook.on('keydown', (event) => {
                    eventCount++;
                    console.log(`🔍 [${eventCount}] Keydown event:`, JSON.stringify(event));
                    this.handleKeyPress(event);
                });

                // Add error handler for the hook
                uIOhook.on('error', (error) => {
                    console.error('❌ uIOhook error:', error);
                    this.handlePermissionError(error);
                });

                // Start the hook - this may fail if we don't have accessibility permissions
                console.log('🔍 Attempting to start uIOhook...');
                uIOhook.start();
                console.log('✅ uIOhook.start() called successfully');
                console.log('👀 Waiting for keypress events... (try typing now)');

            } catch (error) {
                console.error('Failed to start uIOhook:', error);
                this.handlePermissionError(error);

                // Enable fallback mode but don't throw - allow app to continue
                this.isMonitoring = false;
                return {
                    success: false,
                    error: 'Accessibility permissions required',
                    fallbackMode: true
                };
            }

            // Set up key event handlers
            this.setupKeyEventHandlers();

            // Start WPM calculation timer
            this.startWPMCalculation();

            // Reset session data
            this.resetSession();

            this.isMonitoring = true;
            console.log('✅ Keyboard monitoring started successfully');
            console.log('🧪 Test: Type something to see if WPM detection works...');

            return { success: true };

        } catch (error) {
            console.error('❌ Failed to start keyboard monitoring:', error);
            console.error('💡 Possible solutions:');
            console.error('   1. Run Electron app as administrator');
            console.error('   2. Check Windows permissions for global key listening');
            console.error('   3. Ensure antivirus is not blocking the app');
            throw new Error(`Keyboard monitoring failed: ${error.message}`);
        }
    }

    /**
     * Stop keyboard monitoring
     */
    async stopMonitoring() {
        try {
            if (!this.isMonitoring) {
                console.log('Keyboard monitoring not active');
                return { success: true };
            }

            console.log('Stopping keyboard monitoring...');

            // Stop global keyboard listener
            try {
                uIOhook.stop();
            } catch (error) {
                console.warn('Error stopping uIOhook:', error);
            }

            // Stop WPM timer
            if (this.wpmTimer) {
                clearInterval(this.wpmTimer);
                this.wpmTimer = null;
            }
        


            this.isMonitoring = false;
            console.log('Keyboard monitoring stopped');

            return { success: true };

        } catch (error) {
            console.error('Failed to stop keyboard monitoring:', error);
            throw new Error(`Keyboard monitoring stop failed: ${error.message}`);
        }
    }

    /**
     * Setup keyboard event handlers - now using global keyboard listener
     */
    setupKeyEventHandlers() {
        
        // Event handlers are set up in the keyboardListener.addListener() call
    }

    /**
     * Enhanced error handling and permission guidance
     */
    handlePermissionError(error) {
        console.error('🚫 Keyboard monitoring permission error:', error.message);
        console.error('');
        console.error('💡 Solutions for Windows:');
        console.error('   1. Close the app completely');
        console.error('   2. Right-click the app and select "Run as Administrator"');
        console.error('   3. If using antivirus, add the app to exclusions');
        console.error('   4. Check Windows Defender settings');
        console.error('');
        console.error('💡 Alternative: Use the "Test WPM" button for manual testing');
        
        this.enableFallbackMode();
    }

    /**
     * Trigger manual activity for testing
     */
    triggerActivity() {
        console.log('🎯 Manual activity triggered');
        this.manualActivityTrigger = true;
    }

    /**
     * Simulate typing activity when triggered manually
     */
    simulateTypingActivity() {
        console.log('⌨️ Typing activity detected');
        const now = Date.now();
        
        // Add a keystroke to the buffer
        this.keystrokes.push({
            timestamp: now,
            key: 'MANUAL_INPUT'
        });
        
        // Update session data
        this.currentSession.totalKeystrokes++;
        this.currentSession.lastKeystrokeTime = now;
        
        if (!this.currentSession.startTime) {
            this.currentSession.startTime = now;

        }
        
        // Calculate and emit WPM
        this.calculateAndEmitWPM();
    }

    /**
     * Handle individual key press - IMMEDIATE RESPONSE LIKE PYTHON APP
     */
    handleKeyPress(keyEvent) {
        try {
            const now = Date.now();
            console.log('🔍 handleKeyPress called with event:', keyEvent);

            // Filter out non-typing keys (modifiers, function keys, etc.)
            const typingKeyResult = this.getTypingKey(keyEvent);
            console.log('🔍 getTypingKey returned:', typingKeyResult);

            if (!typingKeyResult) {
                console.log('⏭️  Key filtered out (not a typing key)');
                return;
            }

            console.log('✅ Valid typing key! Adding to keystroke buffer');

            // Record keystroke with the actual key name or keycode
            this.keystrokes.push({
                timestamp: now,
                key: typingKeyResult
            });

            // Update session data
            this.currentSession.totalKeystrokes++;
            this.currentSession.lastKeystrokeTime = now;
            
            // IMMEDIATE TYPING ACTIVATION - Like Python app
            if (!this.typingActive) {
                this.typingActive = true;
    
            }

            // Set session start time if this is the first keystroke
            if (!this.currentSession.startTime) {
                this.currentSession.startTime = now;
    
            }

            // FAST WPM UPDATES during active typing - No throttling like Python app
            this.calculateAndEmitWPM();

            // Clean old keystrokes to prevent memory buildup
            this.cleanOldKeystrokes();

        } catch (error) {
            console.error('Error handling key press:', error);
        }
    }

    /**
     * Get the typing key name if it's a valid typing key, otherwise return null
     */
    getTypingKey(keyEvent) {
        // Handle case where keyEvent might be missing
        if (!keyEvent || typeof keyEvent !== 'object') {
            return false;
        }

        const keycode = keyEvent.keycode;

        // Check if this is a valid typing key based on keycode
        if (!this.isValidTypingKeycode(keycode)) {
            return null;
        }

        // Return the keycode as the key identifier
        return keycode;
    }

    /**
     * Check if key is a typing key (not modifier, function, or mouse key)
     */
    isTypingKey(keyEvent) {
        return this.getTypingKey(keyEvent) !== null;
    }

    /**
     * Check if a keycode is a valid typing key
     * Based on uiohook-napi keycodes
     */
    isValidTypingKeycode(keycode) {
        if (typeof keycode !== 'number') {
            return false;
        }

        // Modifier keys - exclude these
        const modifierKeycodes = [
            29,    // Ctrl
            3613,  // CtrlRight
            56,    // Alt
            3640,  // AltRight
            42,    // Shift
            54,    // ShiftRight
            3675,  // Meta (Cmd)
            3676   // MetaRight
        ];

        // Function keys F1-F24 - exclude these
        const functionKeycodes = [
            59, 60, 61, 62, 63, 64, 65, 66, 67, 68, // F1-F10
            87, 88, // F11-F12
            91, 92, 93, 99, 100, 101, 102, 103, 104, 105, 106, 107 // F13-F24
        ];

        // Arrow keys - exclude these
        const arrowKeycodes = [57419, 57416, 57421, 57424]; // Left, Up, Right, Down

        // Special keys to exclude
        const specialKeycodes = [
            1,     // Escape
            58,    // CapsLock
            3657,  // PageUp
            3665,  // PageDown
            3663,  // End
            3655,  // Home
            3666,  // Insert
            3667,  // Delete
            69,    // NumLock
            70     // ScrollLock
        ];

        // Check if keycode should be excluded
        if (modifierKeycodes.includes(keycode) ||
            functionKeycodes.includes(keycode) ||
            arrowKeycodes.includes(keycode) ||
            specialKeycodes.includes(keycode)) {
            return false;
        }

        // Valid typing keys based on uiohook-napi mappings:
        // Numbers: 2-11 (1-0)
        // Letters Q-P: 16-25
        // Letters A-L: 30-38
        // Letters Z-M: 44-50
        // Punctuation and special chars: 12, 13, 26, 27, 39, 40, 41, 43, 51, 52, 53
        // Space: 57
        // Enter: 28
        // Backspace: 14
        // Tab: 15
        // Numpad: 71-83, 55, 74, 78

        const typingKeycodes = [
            // Number row (top of keyboard): 1-0, -, =
            2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
            // Tab and Backspace
            14, 15,
            // QWERTY rows
            16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, // Q-P, [, ], Enter
            30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, // A-L, ;, '
            41, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, // `, \, Z-M, ,, ., /
            // Space
            57,
            // Numpad
            71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, // 7-9, -, 4-6, +, 1-3, 0, .
            55 // NumpadMultiply
        ];

        return typingKeycodes.includes(keycode);
    }

    /**
     * Start WPM calculation timer - FAST UPDATES LIKE PYTHON APP
     */
    startWPMCalculation() {
        if (this.wpmTimer) {
            clearInterval(this.wpmTimer);
        }
        
        this.wpmTimer = setInterval(() => {
            this.checkIdleTimeout(); // Check for idle state like Python app
            this.calculateAndEmitWPM();
            this.cleanOldKeystrokes();
        }, this.wpmUpdateInterval);
    }
    
    /**
     * Check for idle timeout - IMMEDIATE ANIMATION STOP LIKE PYTHON APP
     */
    checkIdleTimeout() {
        const now = Date.now();
        const timeSinceLastKey = now - this.currentSession.lastKeystrokeTime;
        
        // If typing was active but now idle (1 second timeout like Python app)
        if (this.typingActive && timeSinceLastKey > this.idleTimeout) {
            this.typingActive = false;
            this.currentSession.currentWPM = 0;

            
            // Emit immediate idle state
            this.calculateAndEmitWPM();
        }
    }

    /**
     * Calculate current WPM and emit update - RESPONSIVE LIKE PYTHON APP
     */
    calculateAndEmitWPM() {
        try {
            const now = Date.now();
            const wpm = this.typingActive ? this.calculateWPM(now) : 0; // Force 0 WPM when idle
            
            this.currentSession.currentWPM = wpm;

            // Emit typing stats with proper active state like Python app
            const statsData = {
                wpm: wpm,
                totalKeystrokes: this.currentSession.totalKeystrokes,
                sessionDuration: this.currentSession.startTime ? 
                    Math.round((now - this.currentSession.startTime) / 1000) : 0,
                lastKeystroke: this.currentSession.lastKeystrokeTime,
                isActive: this.typingActive // Use actual typing state like Python app
            };
            
            // Enhanced debug logging for WPM troubleshooting
            if (this.typingActive || wpm > 0) {
                const recentCount = Math.min(this.keystrokes.length, 8);
    
            }
            
            this.eventEmitter.emit('typing-stats', statsData);

        } catch (error) {
            console.error('❌ Error calculating WPM:', error);
        }
    }

    /**
     * Calculate Words Per Minute - EXACT PYTHON APP ALGORITHM
     */
    calculateWPM(currentTime = Date.now()) {
        // Clean old keystrokes first
        this.cleanOldKeystrokes(currentTime);

        // Need at least 2 keystrokes like Python app
        if (this.keystrokes.length < 2) {
            return 0;
        }

        // PYTHON APP METHOD: Only use last 8 keystrokes for responsive calculation
        const recentKeystrokes = this.keystrokes.slice(-8);
        
        if (recentKeystrokes.length < 2) {
            return 0;
        }

        // Calculate time span from oldest to newest of recent keystrokes
        const oldestTime = recentKeystrokes[0].timestamp;
        const timeSpanMs = currentTime - oldestTime;
        const timeSpanSeconds = timeSpanMs / 1000;
        
        // Minimum time span like Python app (0.4 seconds)
        if (timeSpanSeconds < 0.4) {
            return 0;
        }

        // Industry standard WPM calculation: (keystrokes ÷ 5) ÷ time_in_minutes
        const keystrokeCount = recentKeystrokes.length;
        const charsPerWord = 5.0; // Standard definition
        const timeInMinutes = timeSpanSeconds / 60;
        const rawWPM = (keystrokeCount / charsPerWord) / timeInMinutes;
        
        // PYTHON APP SMOOTHING: Weighted average with previous WPM
        if (!this.previousWPM) {
            this.previousWPM = 0;
        }
        
        let smoothedWPM;
        if (this.previousWPM > 0) {
            // 60% previous + 40% new (like Python app)
            smoothedWPM = (this.previousWPM * 0.6) + (rawWPM * 0.4);
        } else {
            smoothedWPM = rawWPM;
        }
        
        // Cache for next calculation
        this.previousWPM = smoothedWPM;
        
        // Cap at maximum realistic WPM
        return Math.min(Math.round(smoothedWPM * 10) / 10, 200);
    }

    /**
     * Clean old keystrokes to maintain performance
     */
    cleanOldKeystrokes(currentTime = Date.now()) {
        const cutoffTime = currentTime - this.maxKeystrokeAge;
        this.keystrokes = this.keystrokes.filter(keystroke => 
            keystroke.timestamp > cutoffTime
        );
    }

    /**
     * Reset typing session
     */
    resetSession() {
        this.currentSession = {
            startTime: null,
            totalKeystrokes: 0,
            currentWPM: 0,
            lastKeystrokeTime: 0
        };
        this.keystrokes = [];
        this.typingActive = false; // Reset typing state
        this.previousWPM = 0; // Reset WPM smoothing cache
        console.log('Typing session reset');
    }

    /**
     * Get current typing statistics
     */
    getCurrentStats() {
        const now = Date.now();
        const wpm = this.calculateWPM(now);
        
        return {
            wpm: wpm,
            totalKeystrokes: this.currentSession.totalKeystrokes,
            sessionDuration: this.currentSession.startTime ? 
                Math.round((now - this.currentSession.startTime) / 1000) : 0,
            lastKeystroke: this.currentSession.lastKeystrokeTime,
            isActive: this.isRecentlyActive(now),
            keystrokesInLastMinute: this.keystrokes.length
        };
    }

    /**
     * Check if user has typed recently
     */
    isRecentlyActive(currentTime = Date.now(), threshold = 5000) {
        return (currentTime - this.currentSession.lastKeystrokeTime) < threshold;
    }

    /**
     * Get detailed session analytics
     */
    getSessionAnalytics() {
        const now = Date.now();
        const stats = this.getCurrentStats();
        
        // Calculate typing rhythm (keystrokes per 10-second intervals)
        const rhythm = this.calculateTypingRhythm(now);
        
        // Calculate average WPM over session
        const sessionDuration = stats.sessionDuration;
        const averageWPM = sessionDuration > 0 ? 
            (stats.totalKeystrokes / sessionDuration) * 12 : 0; // 60 seconds / 5 chars per word

        return {
            ...stats,
            averageWPM: Math.round(averageWPM * 10) / 10,
            peakWPM: this.getPeakWPM(),
            typingRhythm: rhythm,
            accuracy: this.calculateTypingAccuracy()
        };
    }

    /**
     * Calculate typing rhythm (keystrokes in 10-second intervals)
     */
    calculateTypingRhythm(currentTime) {
        const intervals = [];
        const intervalDuration = 10000; // 10 seconds
        const maxIntervals = 6; // Last 60 seconds
        
        for (let i = 0; i < maxIntervals; i++) {
            const intervalEnd = currentTime - (i * intervalDuration);
            const intervalStart = intervalEnd - intervalDuration;
            
            const keystrokesInInterval = this.keystrokes.filter(keystroke =>
                keystroke.timestamp >= intervalStart && keystroke.timestamp < intervalEnd
            ).length;
            
            intervals.unshift(keystrokesInInterval);
        }
        
        return intervals;
    }

    /**
     * Get peak WPM in current session
     */
    getPeakWPM() {
        // This is a simplified implementation
        // In a more advanced version, you'd track WPM over time
        return this.currentSession.currentWPM;
    }

    /**
     * Calculate typing accuracy (simplified)
     */
    calculateTypingAccuracy() {
        // This is a placeholder - real accuracy would require
        // tracking actual text input vs intended text
        return 100; // Default to 100% for now
    }

    /**
     * Check if monitoring is active
     */
    isActive() {
        return this.isMonitoring;
    }

    /**
     * Enable fallback mode when global keyboard listener fails
     */
    enableFallbackMode() {
        console.log('🔄 Enabling fallback mode - manual WPM testing available');
        console.log('💡 Use the "Test WPM" button in the UI to simulate typing for testing');
        console.log('💡 Or type in the built-in typing test area for real WPM detection');
        
        // Set a flag to indicate fallback mode
        this.fallbackMode = true;
        
        // Emit a special event to notify the UI
        this.eventEmitter.emit('keyboard-fallback', {
            mode: 'fallback',
            message: 'Global keyboard monitoring failed. Admin rights required for global keystroke detection.',
            solutions: [
                'Close app and run as Administrator',
                'Check antivirus/Windows Defender settings',
                'Use Test WPM button for manual testing',
                'Use built-in typing area for real WPM detection'
            ]
        });
    }







    /**
     * Get monitoring status
     */
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            fallbackMode: this.fallbackMode,
            sessionActive: this.currentSession.startTime !== null,
            currentWPM: this.currentSession.currentWPM,
            totalKeystrokes: this.currentSession.totalKeystrokes
        };
    }
}

module.exports = KeyboardMonitor;