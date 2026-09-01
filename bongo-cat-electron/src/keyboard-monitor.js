// Using node-global-key-listener for global keyboard monitoring
const { GlobalKeyboardListener } = require('node-global-key-listener');
const path = require('path');
const fs = require('fs');

/**
 * Resolve the real, executable location of MacKeyServer when the app is
 * running packaged inside an .asar archive.
 *
 * node-global-key-listener computes its server path as
 * path.join(__dirname, '../../bin/MacKeyServer'), and __dirname always
 * resolves *inside* app.asar - even though electron-builder actually
 * extracts this binary to app.asar.unpacked (a file can be executed only
 * from a real path on disk, never from inside the .asar archive itself).
 * That mismatch is what causes "spawn ENOENT" / permission errors on
 * packaged macOS builds even though the file exists and is +x.
 *
 * We only need this override when packaged; in dev mode (running via
 * `electron .`) __dirname already points at a real path, so the library's
 * own default resolution works fine and we return undefined.
 */
function resolveMacKeyServerPath() {
    if (process.platform !== 'darwin') return undefined;

    try {
        const relative = path.join(
            'node_modules', 'node-global-key-listener', 'bin', 'MacKeyServer'
        );

        // Only relevant when running from inside app.asar
        const isPackaged = __dirname.includes(`${path.sep}app.asar${path.sep}`) ||
            __dirname.endsWith(`${path.sep}app.asar`);
        if (!isPackaged || !process.resourcesPath) return undefined;

        const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', relative);

        if (fs.existsSync(unpackedPath)) {
            // Make sure the executable bit survived packaging/signing/notarizing
            try {
                fs.chmodSync(unpackedPath, 0o755);
            } catch (chmodErr) {
                console.warn('⚠️ Could not chmod MacKeyServer (non-fatal):', chmodErr.message);
            }
            console.log('✅ Resolved unpacked MacKeyServer path:', unpackedPath);
            return unpackedPath;
        }

        console.warn('⚠️ Expected unpacked MacKeyServer not found at:', unpackedPath);
        return undefined;
    } catch (error) {
        console.warn('⚠️ Failed to resolve MacKeyServer path, using library default:', error.message);
        return undefined;
    }
}

/**
 * Keyboard Monitor for WPM Calculation
 * Tracks typing activity and calculates words per minute
 */
class KeyboardMonitor {
    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter;
        this.keyboardListener = null;
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
     * Start keyboard monitoring
     */
    async startMonitoring() {
        try {
            if (this.isMonitoring) {
                console.log('Keyboard monitoring already active');
                return { success: true };
            }

            console.log('Starting keyboard monitoring...');
            console.log('⚠️ Note: Keyboard monitoring may require elevated permissions on Windows');

            // Use global keyboard listener for real keystroke detection
    
            
            try {
                // Initialize the global keyboard listener.
                // On macOS, when packaged, explicitly point it at the real
                // (unpacked) MacKeyServer binary - see resolveMacKeyServerPath()
                // for why this is necessary.
                const listenerConfig = {};
                const macServerPath = resolveMacKeyServerPath();
                if (macServerPath) {
                    listenerConfig.mac = { serverPath: macServerPath };
                }
                this.keyboardListener = new GlobalKeyboardListener(listenerConfig);
                
                // Add event listener for key down events
                this.keyboardListener.addListener((event, name) => {
                    if (event.state === 'DOWN') {
                        this.handleKeyPress({ name });
                    }
                });
                

                
            } catch (error) {
                this.handlePermissionError(error);
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
            if (this.keyboardListener && this.keyboardListener.kill) {
                this.keyboardListener.kill();
                this.keyboardListener = null;
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
            

            
            // Filter out non-typing keys (modifiers, function keys, etc.)
            const typingKeyResult = this.getTypingKey(keyEvent);
            if (!typingKeyResult) {
                return;
            }

            // Record keystroke with the actual key name
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
        // Handle case where keyEvent might be an object without a name property
        if (!keyEvent || typeof keyEvent !== 'object') {

            return false;
        }
        
        const nameObj = keyEvent.name;
        
        // Handle different name formats
        let key = null;
        
        if (typeof nameObj === 'string') {
            // Old format - simple string
            key = nameObj;
        } else if (typeof nameObj === 'object' && nameObj !== null) {
            // New format - object with key states
            // Find the key that is currently pressed (true value)
            const pressedKeys = Object.entries(nameObj)
                .filter(([keyName, isPressed]) => isPressed === true)
                .map(([keyName]) => keyName);
            
            if (pressedKeys.length === 1) {
                key = pressedKeys[0];
            } else if (pressedKeys.length > 1) {
                // Multiple keys pressed - could be valid (like Shift+A)
                // For typing detection, we'll focus on the non-modifier key
                const nonModifierKeys = pressedKeys.filter(k => !this.isModifierKey(k));
                if (nonModifierKeys.length === 1) {
                    key = nonModifierKeys[0];
                } else {
                    // Multiple non-modifier keys or complex combination - skip
                    return false;
                }
            } else {
                // No keys pressed (all false) - likely a release event
                return false;
            }
        } else {

            return false;
        }
        
        // If no valid key found
        if (!key || typeof key !== 'string') {
            return false;
        }
        
        const isTyping = this.isValidTypingKey(key);
        
        if (!isTyping) {
            return null;
        } else {
            return key;
        }
    }

    /**
     * Check if key is a typing key (not modifier, function, or mouse key)
     */
    isTypingKey(keyEvent) {
        return this.getTypingKey(keyEvent) !== null;
    }

    /**
     * Helper method to check if a key is a modifier key
     */
    isModifierKey(key) {
        const modifierKeys = [
            'LEFT CTRL', 'RIGHT CTRL', 'LEFT ALT', 'RIGHT ALT',
            'LEFT SHIFT', 'RIGHT SHIFT', 'LEFT META', 'RIGHT META',
            'CTRL', 'ALT', 'SHIFT', 'META', 'CMD', 'COMMAND'
        ];
        return modifierKeys.includes(key);
    }

    /**
     * Check if a key is a valid typing key
     */
    isValidTypingKey(key) {
        // Exclude modifier keys
        const modifierKeys = [
            'LEFT CTRL', 'RIGHT CTRL', 'LEFT ALT', 'RIGHT ALT',
            'LEFT SHIFT', 'RIGHT SHIFT', 'LEFT META', 'RIGHT META',
            'CAPS LOCK', 'TAB', 'ESC', 'INSERT', 'DELETE',
            'HOME', 'END', 'PAGE UP', 'PAGE DOWN',
            'CTRL', 'ALT', 'SHIFT', 'META', 'CMD', 'COMMAND'
        ];

        // Exclude function keys
        const functionKeys = [
            'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
            'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
        ];

        // Exclude arrow keys
        const arrowKeys = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        
        // EXCLUDE MOUSE CLICKS - Enhanced detection
        const mouseKeys = [
            'MOUSE LEFT', 'MOUSE RIGHT', 'MOUSE MIDDLE',
            'MOUSE 4', 'MOUSE 5', 'MOUSE WHEEL UP', 'MOUSE WHEEL DOWN',
            'LEFT MOUSE', 'RIGHT MOUSE', 'MIDDLE MOUSE',
            'MOUSE_LEFT', 'MOUSE_RIGHT', 'MOUSE_MIDDLE',
            'LEFT BUTTON', 'RIGHT BUTTON', 'MIDDLE BUTTON',
            'BUTTON 1', 'BUTTON 2', 'BUTTON 3', 'BUTTON 4', 'BUTTON 5'
        ];

        // Check if key should be excluded
        const isModifier = modifierKeys.includes(key);
        const isFunction = functionKeys.includes(key);
        const isArrow = arrowKeys.includes(key);
        const isMouse = mouseKeys.includes(key) || 
                       (key.includes('MOUSE') || key.includes('BUTTON') || 
                        key.includes('CLICK') || key.includes('SCROLL'));

        // Additional safety check for numeric keys that might be mouse buttons
        if (/^[0-9]+$/.test(key)) {
            return false;
        }

        return !isModifier && !isFunction && !isArrow && !isMouse;
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
            hasListener: this.keyboardListener !== null,
            isGlobalListener: this.keyboardListener && this.keyboardListener.kill !== undefined,
            fallbackMode: this.fallbackMode,
            sessionActive: this.currentSession.startTime !== null,
            currentWPM: this.currentSession.currentWPM,
            totalKeystrokes: this.currentSession.totalKeystrokes
        };
    }
}

module.exports = KeyboardMonitor;