#!/usr/bin/env python3
"""
Bongo Cat Application - Main Entry Point
Fixed threading model - Engine ALWAYS runs on main thread for proper keyboard timing
"""

import sys
import signal
import argparse
import time
import os
import pyuac
from config import ConfigManager
from engine import BongoCatEngine
from tray import BongoCatSystemTray
from version import VERSION


class BongoCatApplication:
    """Main Bongo Cat application with FIXED thread-safe GUI"""
    
    def __init__(self):
        """Initialize the application"""
        self.config = None
        self.engine = None
        self.tray = None
        self.tk_root = None
        self.running = False
        
        # Setup signal handlers
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
    
    def signal_handler(self, sig, frame):
        """Handle shutdown signals gracefully"""
        print('\n🛑 Shutting down gracefully...')
        self.shutdown()
    
    def initialize_components(self):
        """Initialize all application components"""
        try:
            # Initialize configuration manager
            print("📂 Loading configuration...")
            self.config = ConfigManager()        
            
            # Initialize engine with configuration
            print("🔧 Initializing Bongo Cat Engine...")
            self.engine = BongoCatEngine(config_manager=self.config)
            
            # Initialize system tray (but don't start it yet)
            print("📱 Setting up system tray...")
            self.tray = BongoCatSystemTray(
                config_manager=self.config,
                engine=self.engine,
                on_exit_callback=self.shutdown,
                app_instance=self
            )
            
            # Connect engine to tray for status updates
            self.engine.set_tray_reference(self.tray)
            
            # Connect tray to config for settings refresh
            self.config.add_change_callback(self.tray.on_config_change)
            
            return True
            
        except Exception as e:
            print(f"❌ Initialization error: {e}")
            return False
    
    def run(self):
        """Run the main application"""
        print(f"🐱 Bongo Cat Application v{VERSION}")
        print("=" * 60)
        
        # Initialize components
        if not self.initialize_components():
            return 1
        
        self.running = True
        
        try:
            # CRITICAL FIX: Use pystray run_detached() method for proper GUI/tray coexistence
            print("📱 Starting system tray with run_detached()...")
            self.tray.start_detached()
            
            # Update initial connection status
            print("🔄 Checking initial connection status...")
            
            
            print("🔕 Running in background mode...")
            print("📱 Look for the cat icon in your system tray")
            print("🖱️ Right-click the tray icon for options")
            print("⌨️ Keyboard monitoring active on main thread")

            
            print("✅ System tray started with run_detached()")
            print("💡 Settings window available from tray menu")
            print("🎯 Starting animation engine on MAIN THREAD for optimal responsiveness...")
            
            # CRITICAL FIX: Engine ALWAYS runs on main thread (like original script)  
            # This ensures proper keyboard listener timing regardless of start mode
            self.engine.start_monitoring()
                
        except KeyboardInterrupt:
            print("\n🛑 Interrupted by user")
        except Exception as e:
            print(f"❌ Runtime error: {e}")
            return 1
        finally:
            self.shutdown()
        
        return 0
    

    
    def shutdown(self):
        """Shutdown the application gracefully"""
        print("🛑 Shutting down components...")
        
        self.running = False
        
        # Stop engine first
        if self.engine:
            try:
                self.engine.stop_monitoring()
            except Exception as e:
                print(f"⚠️ Engine shutdown error: {e}")
        
        # Stop system tray
        if self.tray:
            try:
                self.tray.stop()
            except Exception as e:
                print(f"⚠️ Tray shutdown error: {e}")
        
        # Clean up tkinter root if it exists
        if hasattr(self, 'tk_root') and self.tk_root:
            try:
                self.tk_root.quit()
                self.tk_root.destroy()
            except Exception as e:
                print(f"⚠️ Tkinter cleanup error: {e}")
        
        print("👋 Goodbye!")
        
        # Force terminate any remaining threads and exit
        try:
            # Give threads a moment to clean up
            time.sleep(0.5)
            
            # Force exit - this will terminate all threads
            print("🔄 Force exiting application...")
            os._exit(0)
        except Exception as e:
            print(f"⚠️ Force exit error: {e}")
            # Last resort - use system exit
            sys.exit(1)
            

def main():
    """Main application entry point"""
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Bongo Cat Typing Monitor")
    parser.add_argument("--version", action="version", 
                       version=f"Bongo Cat Typing Monitor v{VERSION}")
    
    args = parser.parse_args()

    
    # Create and run application
    app = BongoCatApplication()
    return app.run()

if __name__ == "__main__":
    if not pyuac.isUserAdmin():
         print("Re-launching as admin!")
         pyuac.runAsAdmin(wait=False)
    else:     
        sys.exit(main())
