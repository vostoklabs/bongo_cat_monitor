const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

/**
 * ESP32 Serial Communication Manager
 * Handles connection, data transmission, and protocol implementation
 */
class ESP32SerialManager {
    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter;
        this.port = null;
        this.parser = null;
        this.isConnected = false;
        this.currentPortPath = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.reconnectTimer = null;
        
        // Command queue for reliable transmission
        this.commandQueue = [];
        this.isProcessingQueue = false;
        this.lastCommandTime = 0;
        this.minCommandInterval = 50; // 50ms between commands to prevent ESP32 overload
        
        // Animation state tracking
        this.streakModeActive = false;
        this.idleModeActive = false;
        
        console.log('ESP32 Serial Manager initialized');
    }

    /**
     * Get list of available serial ports
     */
    async getAvailablePorts() {
        try {
            const ports = await SerialPort.list();
            
            // Filter for likely ESP32 ports
            const esp32Ports = ports.filter(port => {
                const manufacturer = (port.manufacturer || '').toLowerCase();
                const productId = (port.productId || '').toLowerCase();
                const vendorId = (port.vendorId || '').toLowerCase();
                
                return manufacturer.includes('espressif') || 
                       manufacturer.includes('silicon labs') ||
                       manufacturer.includes('ftdi') ||
                       productId.includes('2303') ||
                       vendorId.includes('10c4') ||
                       vendorId.includes('0403');
            });
            
            console.log(`Found ${ports.length} total ports, ${esp32Ports.length} likely ESP32 ports`);
            return ports.map(port => ({
                path: port.path,
                manufacturer: port.manufacturer || 'Unknown',
                productId: port.productId || '',
                vendorId: port.vendorId || '',
                isESP32Likely: esp32Ports.includes(port)
            }));
        } catch (error) {
            console.error('Failed to list serial ports:', error);
            throw new Error(`Port scanning failed: ${error.message}`);
        }
    }

    /**
     * Connect to ESP32 device
     */
    async connectToDevice(portPath, options = {}) {
        try {
            if (this.isConnected) {
                await this.disconnect();
            }

            const config = {
                baudRate: options.baudRate || 115200,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                ...options
            };

            console.log(`Connecting to ESP32 on ${portPath} with config:`, config);

            // Create serial port connection
            this.port = new SerialPort({
                path: portPath,
                ...config
            });

            // Set up parser for reading lines
            this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));

            // Set up event handlers
            this.setupEventHandlers();

            // Wait for port to open
            await new Promise((resolve, reject) => {
                this.port.on('open', () => {
                    console.log(`Serial port ${portPath} opened successfully`);
                    resolve();
                });
                
                this.port.on('error', (error) => {
                    console.error('Serial port open error:', error);
                    reject(error);
                });
            });

            this.currentPortPath = portPath;
            this.isConnected = true;
            this.reconnectAttempts = 0;

            // Wait for ESP32 to restart (critical for proper communication)
            console.log('Waiting 2 seconds for ESP32 restart...');
            await this.sleep(2000);

            // Test connection with PING
            await this.sendTestPing();

            // Send initial sync
            await this.sendInitialSync();

            // Emit connection event
            this.eventEmitter.emit('connection-change', {
                connected: true,
                port: portPath
            });

            console.log(`Successfully connected to ESP32 on ${portPath}`);
            return { success: true, port: portPath };

        } catch (error) {
            console.error('ESP32 connection failed:', error);
            await this.cleanup();
            
            throw new Error(`Connection failed: ${error.message}`);
        }
    }

    /**
     * Disconnect from ESP32
     */
    async disconnect() {
        try {
            console.log('Disconnecting from ESP32...');
            
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            await this.cleanup();

            this.eventEmitter.emit('connection-change', {
                connected: false,
                port: null
            });

            console.log('ESP32 disconnected successfully');
            return { success: true };

        } catch (error) {
            console.error('Disconnect error:', error);
            throw new Error(`Disconnect failed: ${error.message}`);
        }
    }

    /**
     * Send test PING to verify connection
     */
    async sendTestPing() {
        try {
            console.log('Sending PING test...');
            await this.sendCommand('PING');
            await this.sleep(100);
            
            // Note: ESP32 might not respond to PING, that's normal
            console.log('PING sent (response not required)');
        } catch (error) {
            console.warn('PING test failed:', error);
            // Don't throw error, PING response is optional
        }
    }

    /**
     * Send initial synchronization data
     */
    async sendInitialSync() {
        try {
            console.log('Sending initial sync...');
            
            // Send current time
            const currentTime = new Date().toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            await this.sendCommand(`TIME:${currentTime}`);
            await this.sleep(50);
            
            // Send initial stats (will be updated by monitoring systems)
            await this.sendCommand('CPU:0');
            await this.sleep(50);
            await this.sendCommand('RAM:0');
            await this.sleep(50);
            await this.sendCommand('WPM:0');
            
            console.log('Initial sync completed');
        } catch (error) {
            console.error('Initial sync failed:', error);
            // Don't throw error, sync can be retried
        }
    }

    /**
     * Send command to ESP32
     */
    async sendCommand(command) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.port) {
                reject(new Error('Not connected to ESP32'));
                return;
            }

            // Add to command queue
            this.commandQueue.push({ command, resolve, reject });
            this.processCommandQueue();
        });
    }

    /**
     * Process command queue with rate limiting
     */
    async processCommandQueue() {
        if (this.isProcessingQueue || this.commandQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.commandQueue.length > 0) {
            const { command, resolve, reject } = this.commandQueue.shift();

            try {
                // Rate limiting
                const now = Date.now();
                const timeSinceLastCommand = now - this.lastCommandTime;
                if (timeSinceLastCommand < this.minCommandInterval) {
                    await this.sleep(this.minCommandInterval - timeSinceLastCommand);
                }

                // Send command
                const fullCommand = `${command}\n`;
                await new Promise((writeResolve, writeReject) => {
                    this.port.write(fullCommand, (error) => {
                        if (error) {
                            writeReject(error);
                        } else {
                            writeResolve();
                        }
                    });
                });

                this.lastCommandTime = Date.now();
                // Reduced logging - only log important commands
        if (command.includes('PING') || command.includes('TIME:') || command.startsWith('DISPLAY:')) {
            console.log(`Sent to ESP32: ${command}`);
        }
                resolve();

            } catch (error) {
                console.error(`Failed to send command ${command}:`, error);
                reject(error);
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Send combined stats to ESP32 using original engine.py protocol
     */
    async sendCombinedStats(systemStats, typingStats) {
        try {
            const cpu = Math.round(systemStats.cpu || 0);
            const ram = Math.round(systemStats.memory || 0);
            const wpm = Math.round(typingStats.wpm || 0);

            // Use original engine.py format: STATS:CPU:X,RAM:Y,WPM:Z
            const statsCommand = `STATS:CPU:${cpu},RAM:${ram},WPM:${wpm}`;
            await this.sendCommand(statsCommand);
            
            // Send animation commands based on WPM
            await this.sendAnimationCommands(wpm, typingStats.isActive || false);
            
        } catch (error) {
            console.error('Failed to send combined stats:', error);
        }
    }

    /**
     * Send animation commands based on WPM (matching original engine.py)
     */
    async sendAnimationCommands(wpm, isTyping) {
        try {
            if (isTyping && wpm > 0) {
                // Convert WPM to animation speed like original engine.py
                const animationSpeed = this.wpmToAnimationSpeed(wpm);
                await this.sendCommand(`SPEED:${animationSpeed}`);
                
                // Handle streak mode (65+ WPM like original)
                if (wpm >= 65) {
                    if (!this.streakModeActive) {
                        await this.sendCommand('STREAK_ON');
                        this.streakModeActive = true;
                    }
                } else {
                    if (this.streakModeActive) {
                        await this.sendCommand('STREAK_OFF');
                        this.streakModeActive = false;
                    }
                }
                
                // Reset idle mode when typing starts
                if (this.idleModeActive) {
                    this.idleModeActive = false;
                }
                
            } else {
                // No typing - send STOP command like original engine.py
                if (!this.idleModeActive) {
                    await this.sendCommand('STOP');
                    
                    // Turn off streak when stopping
                    if (this.streakModeActive) {
                        await this.sendCommand('STREAK_OFF');
                        this.streakModeActive = false;
                    }
                    
                    this.idleModeActive = true;
                }
            }
            
        } catch (error) {
            console.error('Failed to send animation commands:', error);
        }
    }

    /**
     * Convert WPM to animation speed (matching original engine.py algorithm)
     */
    wpmToAnimationSpeed(wpm) {
        if (wpm <= 0) return 500; // Slow animation for no typing
        
        // Original engine.py thresholds:
        // Slow: < 20 WPM -> speed 80+
        // Normal: 20-40 WPM -> speed 80-150  
        // Fast: 40+ WPM -> speed 150+
        
        const maxWpm = 200; // Max WPM cap
        const minSpeed = 30; // Fastest animation (30ms)
        const maxSpeed = 500; // Slowest animation (500ms)
        
        // Clamp WPM and calculate speed
        const clampedWpm = Math.min(wpm, maxWpm);
        const normalized = clampedWpm / maxWpm;
        const speed = maxSpeed - (normalized * (maxSpeed - minSpeed));
        
        return Math.max(Math.min(Math.round(speed), maxSpeed), minSpeed);
    }

    /**
     * Send system stats to ESP32 (legacy method)
     */
    async sendSystemStats(stats) {
        // This is now handled by sendCombinedStats
        console.log('Legacy sendSystemStats called - use sendCombinedStats instead');
    }

    /**
     * Send typing stats to ESP32 (legacy method)
     */
    async sendTypingStats(stats) {
        // This is now handled by sendCombinedStats
        console.log('Legacy sendTypingStats called - use sendCombinedStats instead');
    }

    /**
     * Send current time to ESP32
     */
    async sendTimeUpdate() {
        try {
            const currentTime = new Date().toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            await this.sendCommand(`TIME:${currentTime}`);
        } catch (error) {
            console.error('Failed to send time update:', error);
        }
    }

    /**
     * Send display settings to ESP32
     */
    async sendDisplaySettings(settings) {
        try {
            console.log('Sending display settings to ESP32:', settings);
            
            // Send individual display setting commands using Arduino expected format
            await this.sendCommand(`DISPLAY_CPU:${settings.showCpu ? 'ON' : 'OFF'}`);
            await this.sleep(50);
            
            await this.sendCommand(`DISPLAY_RAM:${settings.showRam ? 'ON' : 'OFF'}`);
            await this.sleep(50);
            
            await this.sendCommand(`DISPLAY_WPM:${settings.showWpm ? 'ON' : 'OFF'}`);
            await this.sleep(50);
            
            await this.sendCommand(`DISPLAY_TIME:${settings.showTime ? 'ON' : 'OFF'}`);
            await this.sleep(50);
            
            if (settings.timeFormat) {
                await this.sendCommand(`TIME_FORMAT:${settings.timeFormat}`);
                await this.sleep(50);
            }
            
            if (settings.sleepTimeout) {
                await this.sendCommand(`SLEEP_TIMEOUT:${settings.sleepTimeout}`);
                await this.sleep(50);
            }
            
            // Save settings to ESP32 EEPROM for persistence
            await this.sendCommand('SAVE_SETTINGS');
            await this.sleep(50);
            
            console.log('Display settings sent and saved to ESP32 successfully');
        } catch (error) {
            console.error('Failed to send display settings:', error);
            // Don't throw error - settings were applied locally successfully
            // ESP32 communication failure shouldn't prevent local settings application
        }
    }

    /**
     * Setup event handlers for serial port
     */
    setupEventHandlers() {
        // Handle incoming data
        this.parser.on('data', (data) => {
            const cleanData = data.trim();
            if (cleanData) {
                console.log(`ESP32 Response: ${cleanData}`);
                this.eventEmitter.emit('serial-data', cleanData);
            }
        });

        // Handle port errors
        this.port.on('error', (error) => {
            console.error('Serial port error:', error);
            this.handleConnectionError(error);
        });

        // Handle port close
        this.port.on('close', () => {
            console.log('Serial port closed');
            if (this.isConnected) {
                this.handleConnectionError(new Error('Port closed unexpectedly'));
            }
        });
    }

    /**
     * Handle connection errors and attempt reconnection
     */
    async handleConnectionError(error) {
        console.error('Connection error occurred:', error);
        
        this.isConnected = false;
        this.eventEmitter.emit('connection-change', {
            connected: false,
            port: null,
            error: error.message
        });

        // Attempt reconnection if configured
        if (this.reconnectAttempts < this.maxReconnectAttempts && this.currentPortPath) {
            this.reconnectAttempts++;
            console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
            
            this.reconnectTimer = setTimeout(async () => {
                try {
                    await this.connectToDevice(this.currentPortPath);
                } catch (reconnectError) {
                    console.error('Reconnection failed:', reconnectError);
                }
            }, 3000);
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.isConnected = false;
        this.commandQueue = [];
        this.isProcessingQueue = false;
        
        if (this.parser) {
            this.parser.removeAllListeners();
            this.parser = null;
        }
        
        if (this.port && this.port.isOpen) {
            await new Promise((resolve) => {
                this.port.close((error) => {
                    if (error) {
                        console.error('Error closing port:', error);
                    }
                    resolve();
                });
            });
        }
        
        this.port = null;
        this.currentPortPath = null;
    }

    /**
     * Utility sleep function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get connection status
     */
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            port: this.currentPortPath,
            queueLength: this.commandQueue.length
        };
    }
}

module.exports = ESP32SerialManager;