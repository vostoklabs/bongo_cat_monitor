#!/usr/bin/env python3
"""
Configuration Management for Bongo Cat Application
Handles JSON-based settings persistence and validation
"""

import json
import os
import shutil
from pathlib import Path
from typing import Dict, Any, Callable, List


class ConfigManager:
    """Manages application configuration with JSON persistence and validation"""

    def __init__(self, config_path: str = None):
        """Initialize configuration manager"""
        if config_path is None:
            # Default: Local folder + default_config.json
            self.config_file = Path(__file__).parent / "default_config.json"
            self.config_dir = self.config_file.parent
        else:
            path = Path(config_path)
            if path.is_dir():
                self.config_dir = path
                self.config_file = self.config_dir / "config.json"
            else:
                self.config_file = path
                self.config_dir = self.config_file.parent

        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.backup_file = self.config_file.with_name(
            f"{self.config_file.stem}_backup{self.config_file.suffix}")

        # Default configuration
        self.default_config = {
            "version": "1.0",
            "display": {
                "show_cpu": True,
                "show_ram": True,
                "show_wpm": True,
                "show_time": True,
                "time_format_24h": True
            },
            "behavior": {
                "sleep_timeout_minutes": 1,
                "idle_timeout_seconds": 1.0
            },
            "connection": {
                "com_port": "AUTO",
                "baudrate": 115200,
                "auto_reconnect": True,
                "timeout_seconds": 5
            },
            "startup": {
                "start_with_windows": True,
                "start_minimized": True,
                "show_notifications": True
            }
        }

        # Current configuration
        self.config = self.default_config.copy()

        # Change callbacks
        self.change_callbacks: List[Callable[[str, Any], None]] = []

        # Load configuration on initialization
        self.load_config()

    def add_change_callback(self, callback: Callable[[str, Any], None]):
        """Add a callback to be called when configuration changes"""
        self.change_callbacks.append(callback)

    def _notify_change(self, key: str, value: Any):
        """Notify all callbacks of a configuration change"""
        for callback in self.change_callbacks:
            try:
                callback(key, value)
            except Exception as e:
                print(f"❌ Configuration callback error: {e}")

    def validate_config(self, config: Dict[str, Any]) -> bool:
        """Validate configuration structure and values"""
        try:
            # Check required sections
            required_sections = [
                "version", "display", "behavior", "connection", "startup"
            ]
            for section in required_sections:
                if section not in config:
                    print(f"❌ Missing config section: {section}")
                    return False

            # Validate display settings
            display = config["display"]
            for key in [
                    "show_cpu", "show_ram", "show_wpm", "show_time",
                    "time_format_24h"
            ]:
                if key not in display or not isinstance(display[key], bool):
                    print(f"❌ Invalid display setting: {key}")
                    return False

            # Validate behavior settings
            behavior = config["behavior"]
            if not (1 <= behavior.get("sleep_timeout_minutes", 0) <= 60):
                print("❌ Invalid sleep_timeout_minutes (1-60)")
                return False

            if not (0.1 <= behavior.get("idle_timeout_seconds", 0) <= 10.0):
                print("❌ Invalid idle_timeout_seconds (0.1-10.0)")
                return False

            # Validate connection settings
            connection = config["connection"]
            if not (9600 <= connection.get("baudrate", 0) <= 115200):
                print("❌ Invalid baudrate")
                return False
            if not (1 <= connection.get("timeout_seconds", 0) <= 30):
                print("❌ Invalid timeout_seconds (1-30)")
                return False

            return True

        except Exception as e:
            print(f"❌ Config validation error: {e}")
            return False

    def load_config(self) -> bool:
        """Load configuration from file"""
        try:
            if self.config_file.exists():
                with open(self.config_file, 'r') as f:
                    loaded_config = json.load(f)

                if self.validate_config(loaded_config):
                    self.config = loaded_config
                    print(f"📂 Configuration loaded from {self.config_file}")
                    return True
                else:
                    print("⚠️ Invalid configuration file, using defaults")
                    self.reset_to_defaults()
                    return False
            else:
                print("📝 No configuration file found, creating default")
                self.reset_to_defaults()
                self.save_config()
                return True

        except Exception as e:
            print(f"❌ Error loading config: {e}")
            print("🔄 Using default configuration")
            self.reset_to_defaults()
            return False

    def save_config(self) -> bool:
        """Save current configuration to file"""
        try:
            # Create backup of existing config
            if self.config_file.exists():
                shutil.copy2(self.config_file, self.backup_file)

            # Save current configuration
            with open(self.config_file, 'w') as f:
                json.dump(self.config, f, indent=2)

            print(f"💾 Configuration saved to {self.config_file}")
            return True

        except Exception as e:
            print(f"❌ Error saving config: {e}")
            return False

    def reset_to_defaults(self):
        """Reset configuration to defaults"""
        self.config = self.default_config.copy()
        print("🔄 Configuration reset to defaults")

    def get_setting(self, section: str, key: str = None):
        """Get a configuration setting"""
        try:
            if key is None:
                return self.config.get(section, {})
            else:
                return self.config.get(section, {}).get(key)
        except Exception as e:
            print(f"❌ Error getting setting {section}.{key}: {e}")
            return None

    def set_setting(self, section: str, key: str, value: Any) -> bool:
        """Set a configuration setting"""
        try:
            if section not in self.config:
                self.config[section] = {}

            old_value = self.config[section].get(key)
            self.config[section][key] = value

            # Validate the entire config after change
            if self.validate_config(self.config):
                if old_value != value:
                    self._notify_change(f"{section}.{key}", value)
                    print(f"🔧 Setting changed: {section}.{key} = {value}")
                return True
            else:
                # Revert change if validation fails
                if old_value is not None:
                    self.config[section][key] = old_value
                else:
                    del self.config[section][key]
                print(f"❌ Invalid setting: {section}.{key} = {value}")
                return False

        except Exception as e:
            print(f"❌ Error setting {section}.{key}: {e}")
            return False

    def get_display_settings(self) -> Dict[str, bool]:
        """Get all display settings"""
        return self.get_setting("display")

    def get_behavior_settings(self) -> Dict[str, Any]:
        """Get all behavior settings"""
        return self.get_setting("behavior")

    def get_connection_settings(self) -> Dict[str, Any]:
        """Get all connection settings"""
        return self.get_setting("connection")

    def get_startup_settings(self) -> Dict[str, bool]:
        """Get all startup settings"""
        return self.get_setting("startup")


if __name__ == "__main__":
    # Test the configuration manager
    print("🧪 Testing ConfigManager...")

    config = ConfigManager()

    # Test getting settings
    print("Display settings:", config.get_display_settings())
    print("CPU display:", config.get_setting("display", "show_cpu"))

    # Test setting values
    config.set_setting("display", "show_cpu", False)
    config.set_setting("behavior", "sleep_timeout_minutes", 10)

    # Test validation (should fail)
    config.set_setting("behavior", "sleep_timeout_minutes", 100)  # Invalid

    # Save configuration
    config.save_config()

    print("✅ ConfigManager test completed")
