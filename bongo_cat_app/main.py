#!/usr/bin/env python3
"""
Bongo Cat Application - Main Entry Point
Fixed threading model - Engine ALWAYS runs on main thread for proper keyboard timing
"""

import sys
import signal
import argparse
import threading
import time
import ctypes
import os
import subprocess
from typing import Any
from config import ConfigManager
from engine import BongoCatEngine
from tray import BongoCatSystemTray
from version import VERSION

def is_admin():
    """Check if the current process has administrator privileges"""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

def restart_as_admin(app_instance=None):
    """Restart the application with administrator privileges"""
    try:
        # Get executable and args
        if getattr(sys, 'frozen', False):
            executable = sys.executable
            args = sys.argv[1:]
        else:
            executable = sys.executable
            args = [os.path.abspath(sys.argv[0])] + sys.argv[1:]
        
        # Restart as admin
        args_str = " ".join(f'"{arg}"' if " " in arg else arg for arg in args)
        ctypes.windll.shell32.ShellExecuteW(None, "runas", executable, args_str, None, 1)
        
        # Use app shutdown method if available, otherwise direct exit
        if app_instance and hasattr(app_instance, 'shutdown'):
            app_instance.shutdown()
        else:
            os._exit(0)
        
    except Exception as e:
        print(f"❌ Failed to restart as admin: {e}")
        if app_instance and hasattr(app_instance, 'shutdown'):
            app_instance.shutdown()
        else:
            os._exit(1)

class BongoCatApplication:
    """Main Bongo Cat application with FIXED thread-safe GUI"""
    
    def __init__(self, start_minimized=False):
        """Initialize the application"""
        self.start_minimized = start_minimized
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
            
            # Check if CPU temperature monitoring is enabled and if we need admin privileges
            display_settings = self.config.get_display_settings()
            
            # Check if we need admin privileges for CPU temperature monitoring
            needs_admin = display_settings.get('show_cpu_temp', False)
            
            if needs_admin and not is_admin():
                print("🔒 CPU temperature monitoring requires administrator privileges")
                print("🔄 Restarting application as administrator...")
                restart_as_admin(self)
                return False
            elif needs_admin:
                print("✅ Running with administrator privileges for CPU temperature monitoring")
            
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
            
            if self.start_minimized:
                print("🔕 Running in background mode...")
                print("📱 Look for the cat icon in your system tray")
                print("🖱️ Right-click the tray icon for options")
                print("⌨️ Keyboard monitoring active on main thread")
            else:
                print("🖥️ Running in normal mode...")
                print("📝 Start typing to see your cat react!")
                print("🔄 System tray available in background")
                print("🛑 Press Ctrl+C to stop")
            
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
    parser.add_argument("--minimized", action="store_true", 
                       help="Start minimized to system tray")
    parser.add_argument("--startup", action="store_true",
                       help="Started automatically with Windows")
    parser.add_argument("--version", action="version", 
                       version=f"Bongo Cat Typing Monitor v{VERSION}")
    
    args = parser.parse_args()
    
    # Determine start mode
    start_minimized = args.minimized or args.startup
    
    # Create and run application
    app = BongoCatApplication(start_minimized=start_minimized)
    return app.run()

if __name__ == "__main__":
    sys.exit(main())
