const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const { EventEmitter } = require('events');

// Import our custom modules
const SettingsManager = require('./src/settings');
const ESP32SerialManager = require('./src/serial');
const SystemMonitor = require('./src/system-monitor');
const KeyboardMonitor = require('./src/keyboard-monitor');

const isDev = process.argv.includes('--dev');

// Keep a global reference of the window object
let mainWindow;
let tray;
let isQuitting = false;

// Initialize global instances
let eventEmitter;
let settingsManager;
let esp32SerialManager;
let systemMonitor;
let keyboardMonitor;

// Monitoring state
let monitoringActive = false;

// Development mode indicator
if (isDev) {
  console.log('Running in development mode');
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 350,
    minHeight: 500,
    webPreferences: {
      nodeIntegration: false, // Security: disable node integration
      contextIsolation: true, // Security: enable context isolation
      preload: path.join(__dirname, 'preload.js'), // Use preload script
      enableRemoteModule: false // Security: disable remote module
    },
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
    show: false, // Don't show until ready
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  });

  // Load the app
  mainWindow.loadFile('renderer/index.html');

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    // Start minimized - don't show window on startup
    // User can open from tray icon

    // Open DevTools in development (only if showing window)
    if (isDev) {
      mainWindow.show();
      mainWindow.webContents.openDevTools();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle window close (minimize to tray instead of quit)
  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Handle window minimize (hide on Mac)
  mainWindow.on('minimize', (event) => {
    if (process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Create tray icon
  const iconPath = path.join(__dirname, 'assets', 'icons', 'tray.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Bongo Cat',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('show-settings');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Bongo Cat',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('Bongo Cat - ESP32 Desktop Companion');

  // Handle tray click
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

// Initialize application modules
function initializeModules() {
  try {
    // Create event emitter for inter-module communication
    eventEmitter = new EventEmitter();
    
    // Initialize managers
    settingsManager = new SettingsManager();
    esp32SerialManager = new ESP32SerialManager(eventEmitter);
    systemMonitor = new SystemMonitor(eventEmitter);
    keyboardMonitor = new KeyboardMonitor(eventEmitter);
    
    // Set up event forwarding to renderer
    setupEventForwarding();
    
    console.log('All modules initialized successfully');
  } catch (error) {
    console.error('Failed to initialize modules:', error);
  }
}

// Setup event forwarding from modules to renderer
function setupEventForwarding() {
  eventEmitter.on('connection-change', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-change', data);
    }
  });
  
  // Combined stats handler for ESP32 protocol
  let lastSystemStats = { cpu: 0, memory: 0 };
  let lastTypingStats = { wpm: 0, isActive: false };
  
  eventEmitter.on('system-stats', (stats) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system-stats', stats);
    }
    
    // Cache system stats for combined sending
    lastSystemStats = stats;
  });
  
  eventEmitter.on('typing-stats', (stats) => {
    // Only log when there's actual WPM activity to reduce spam

    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('typing-stats', stats);
    }
    
    // Cache typing stats for combined sending
    lastTypingStats = stats;
  });
  
  // Handle keyboard fallback notifications
  eventEmitter.on('keyboard-fallback', (data) => {
    console.log('⚠️ Keyboard monitoring fallback mode enabled');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('keyboard-fallback', data);
    }
  });
  
  // FAST STATS SENDING - Responsive like Python app
  setInterval(() => {
    if (esp32SerialManager && esp32SerialManager.getConnectionStatus().isConnected) {
      // Send stats more frequently during active typing (like Python app)
      const isTypingActive = lastTypingStats && lastTypingStats.isActive;
      esp32SerialManager.sendCombinedStats(lastSystemStats, lastTypingStats);
    }
  }, 1000); // 1 second for responsive animations (was 2000ms)
  
  // Auto-start monitoring when app is ready
  setTimeout(async () => {
    try {
      // Auto-connect to serial device
      console.log('🔌 Checking for ESP32 serial device...');
      if (esp32SerialManager && settingsManager) {
        try {
          const ports = await esp32SerialManager.getAvailablePorts();
          const lastUsedPort = settingsManager.getLastUsedPort();

          // Try to find a /dev/tty.usbserial* port
          let targetPort = null;

          // First, try the last used port if it matches the pattern
          if (lastUsedPort && lastUsedPort.includes('/dev/tty.usbserial')) {
            const portExists = ports.find(p => p.path === lastUsedPort);
            if (portExists) {
              targetPort = lastUsedPort;
              console.log(`✅ Found last used port: ${lastUsedPort}`);
            } else {
              console.log(`⚠️  Last used port ${lastUsedPort} not available`);
            }
          }

          // If last used port not available, find first /dev/tty.usbserial* port
          if (!targetPort) {
            const usbSerialPort = ports.find(p => p.path && p.path.includes('/dev/tty.usbserial'));
            if (usbSerialPort) {
              targetPort = usbSerialPort.path;
              console.log(`✅ Found USB serial port: ${targetPort}`);
            }
          }

          // Connect to the port if found
          if (targetPort) {
            console.log(`🔌 Auto-connecting to ${targetPort}...`);
            const esp32Settings = settingsManager.getESP32Settings();
            const result = await esp32SerialManager.connectToDevice(targetPort, esp32Settings);

            if (result.success) {
              console.log(`✅ Successfully connected to ${targetPort}`);
              settingsManager.saveLastUsedPort(targetPort);
            } else {
              console.log(`⚠️  Failed to connect to ${targetPort}`);
            }
          } else {
            console.log('ℹ️  No USB serial device found (this is normal if device is not connected)');
          }
        } catch (error) {
          console.error('❌ Auto-connect failed:', error.message);
          console.log('💡 You can manually connect from the app UI');
        }
      }

      console.log('🚀 Auto-starting system monitoring...');
      if (systemMonitor) {
        await systemMonitor.startMonitoring(2000); // 2-second intervals
        console.log('✅ System monitoring started automatically');
      }

      // Auto-start keyboard monitoring
      console.log('🚀 Auto-starting keyboard monitoring...');
      if (keyboardMonitor) {
        try {
          const result = await keyboardMonitor.startMonitoring();
          if (result.success) {
            console.log('✅ Keyboard monitoring started automatically');
            console.log('🧪 Type something now to test if keyboard monitoring works...');
          } else {
            console.log('⚠️ Keyboard monitoring failed to start (likely permission issue)');
            console.log('💡 On macOS: Grant accessibility permissions in System Settings > Privacy & Security > Accessibility');
          }
        } catch (error) {
          console.error('❌ Keyboard monitoring auto-start failed:', error.message);
          console.log('💡 You can manually start it from the app UI after granting permissions');
        }
      }

      // Auto-start as monitoring state
      monitoringActive = true;

    } catch (error) {
      console.error('Failed to auto-start monitoring:', error);
    }
  }, 1000); // Start after 1 second delay
  
  eventEmitter.on('serial-data', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('serial-data', data);
    }
  });
}

// App event handlers
app.whenReady().then(() => {
  // Initialize modules first
  initializeModules();
  
  // Create UI
  createWindow();
  createTray();

  // Handle app activation (macOS)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app quit - cleanup will be done in the handler below

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
  });
});

// =============================================================================
// IPC HANDLERS - Bridge between renderer and backend modules
// =============================================================================

// App Info Handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

// Serial Communication Handlers
ipcMain.handle('get-serial-ports', async () => {
  try {
    if (!esp32SerialManager) {
      throw new Error('Serial manager not initialized');
    }
    return await esp32SerialManager.getAvailablePorts();
  } catch (error) {
    console.error('Get serial ports error:', error);
    throw error;
  }
});

ipcMain.handle('connect-to-device', async (event, port) => {
  try {
    if (!esp32SerialManager) {
      throw new Error('Serial manager not initialized');
    }
    
    const esp32Settings = settingsManager.getESP32Settings();
    const result = await esp32SerialManager.connectToDevice(port, esp32Settings);
    
    // Save successful port for auto-connect
    if (result.success) {
      settingsManager.saveLastUsedPort(port);
    }
    
    return result;
  } catch (error) {
    console.error('Connect to device error:', error);
    throw error;
  }
});

ipcMain.handle('disconnect-device', async () => {
  try {
    if (!esp32SerialManager) {
      throw new Error('Serial manager not initialized');
    }
    return await esp32SerialManager.disconnect();
  } catch (error) {
    console.error('Disconnect device error:', error);
    throw error;
  }
});

ipcMain.handle('send-serial-data', async (event, data) => {
  try {
    if (!esp32SerialManager) {
      throw new Error('Serial manager not initialized');
    }
    await esp32SerialManager.sendCommand(data);
    return { success: true };
  } catch (error) {
    console.error('Send serial data error:', error);
    throw error;
  }
});

// System Monitoring Handlers
ipcMain.handle('get-system-stats', async () => {
  try {
    if (!systemMonitor) {
      throw new Error('System monitor not initialized');
    }
    return await systemMonitor.getCurrentStats();
  } catch (error) {
    console.error('Get system stats error:', error);
    throw error;
  }
});

ipcMain.handle('start-monitoring', async () => {
  try {
    if (!systemMonitor) {
      throw new Error('System monitor not initialized');
    }
    
    const updateInterval = settingsManager.getUpdateInterval();
    const result = await systemMonitor.startMonitoring(updateInterval);
    
    if (result.success) {
      monitoringActive = true;
      
      // Send time updates every minute
      setInterval(async () => {
        if (esp32SerialManager && esp32SerialManager.getConnectionStatus().isConnected) {
          await esp32SerialManager.sendTimeUpdate();
        }
      }, 60000);
    }
    
    return result;
  } catch (error) {
    console.error('Start monitoring error:', error);
    throw error;
  }
});

ipcMain.handle('stop-monitoring', async () => {
  try {
    if (!systemMonitor) {
      throw new Error('System monitor not initialized');
    }
    
    const result = systemMonitor.stopMonitoring();
    monitoringActive = false;
    
    return result;
  } catch (error) {
    console.error('Stop monitoring error:', error);
    throw error;
  }
});

// Keyboard Monitoring Handlers
ipcMain.handle('start-keyboard-monitoring', async () => {
  try {
    if (!keyboardMonitor) {
      throw new Error('Keyboard monitor not initialized');
    }
    return await keyboardMonitor.startMonitoring();
  } catch (error) {
    console.error('Start keyboard monitoring error:', error);
    throw error;
  }
});

ipcMain.handle('stop-keyboard-monitoring', async () => {
  try {
    if (!keyboardMonitor) {
      throw new Error('Keyboard monitor not initialized');
    }
    return await keyboardMonitor.stopMonitoring();
  } catch (error) {
    console.error('Stop keyboard monitoring error:', error);
    throw error;
  }
});

ipcMain.handle('get-typing-stats', async () => {
  try {
    if (!keyboardMonitor) {
      throw new Error('Keyboard monitor not initialized');
    }
    return keyboardMonitor.getCurrentStats();
  } catch (error) {
    console.error('Get typing stats error:', error);
    throw error;
  }
});

// Settings Management Handlers
ipcMain.handle('get-settings', async () => {
  try {
    if (!settingsManager) {
      throw new Error('Settings manager not initialized');
    }
    return settingsManager.getAllSettings();
  } catch (error) {
    console.error('Get settings error:', error);
    throw error;
  }
});

ipcMain.handle('apply-settings', async (event, settings) => {
  try {
    console.log('Applying settings temporarily (not saving to disk):', settings);
    
    // Validate settings object
    if (!settings || typeof settings !== 'object') {
      throw new Error('Invalid settings object provided');
    }
    
    // Check if core modules are initialized
    console.log('Module status:', {
      systemMonitor: !!systemMonitor,
      esp32SerialManager: !!esp32SerialManager,
      settingsManager: !!settingsManager
    });
    
    // Apply settings that affect monitoring without saving to disk
    if (settings.updateInterval && systemMonitor && systemMonitor.isActive()) {
      try {
        systemMonitor.updateInterval(settings.updateInterval);
      } catch (error) {
        console.error('Failed to update monitoring interval:', error);
        // Don't throw - this shouldn't prevent other settings from applying
      }
    }
    
    // Send settings to ESP32 device if connected
    if (esp32SerialManager && esp32SerialManager.isConnected) {
      try {
        await esp32SerialManager.sendDisplaySettings(settings);
        console.log('Settings sent to ESP32 device successfully');
      } catch (error) {
        console.error('Failed to send settings to ESP32:', error);
        // Don't throw here, as the settings were applied locally successfully
      }
    }
    
    console.log('Settings applied successfully');
    return { success: true };
  } catch (error) {
    console.error('Apply settings error:', error);
    console.error('Error stack:', error.stack);
    throw new Error(`Failed to apply settings: ${error.message}`);
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    if (!settingsManager) {
      throw new Error('Settings manager not initialized');
    }
    
    const success = settingsManager.updateSettings(settings);
    
    // Apply settings that affect monitoring
    if (settings.updateInterval && systemMonitor && systemMonitor.isActive()) {
      try {
        systemMonitor.updateInterval(settings.updateInterval);
      } catch (error) {
        console.error('Failed to update monitoring interval:', error);
        // Don't throw - this shouldn't prevent other settings from applying
      }
    }
    
    // Send settings to ESP32 device if connected
    if (esp32SerialManager && esp32SerialManager.isConnected) {
      try {
        await esp32SerialManager.sendDisplaySettings(settings);
        console.log('Settings saved and sent to ESP32 device successfully');
      } catch (error) {
        console.error('Failed to send settings to ESP32:', error);
        // Don't throw here, as the settings were saved locally successfully
      }
    }
    
    return { success };
  } catch (error) {
    console.error('Save settings error:', error);
    throw error;
  }
});

ipcMain.handle('reset-settings', async () => {
  try {
    if (!settingsManager) {
      throw new Error('Settings manager not initialized');
    }
    
    const success = settingsManager.resetToDefaults();
    return { success };
  } catch (error) {
    console.error('Reset settings error:', error);
    throw error;
  }
});



// Cleanup on app quit
let isCleaningUp = false;

app.on('before-quit', async (event) => {
  if (isCleaningUp) {
    // Cleanup already in progress or complete, allow quit
    return;
  }

  // Prevent quit until cleanup is complete
  event.preventDefault();
  isQuitting = true;
  isCleaningUp = true;

  try {
    console.log('Starting app cleanup...');

    // Stop all monitoring
    if (systemMonitor && systemMonitor.isActive()) {
      systemMonitor.stopMonitoring();
      console.log('System monitoring stopped');
    }

    if (keyboardMonitor && keyboardMonitor.isActive()) {
      await keyboardMonitor.stopMonitoring();
      console.log('Keyboard monitoring stopped');
    }

    // Disconnect ESP32
    if (esp32SerialManager && esp32SerialManager.getConnectionStatus().isConnected) {
      await esp32SerialManager.disconnect();
      console.log('ESP32 disconnected');
    }

    console.log('App cleanup completed successfully');
  } catch (error) {
    console.error('Error during app cleanup:', error);
  } finally {
    // Allow quit after cleanup
    app.quit();
  }
});