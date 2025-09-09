#!/usr/bin/env python3
"""
Version information for Bongo Cat Application
Centralized version management
"""

# Application version - increment this for releases
VERSION = "2.2.0"

# Config format version for compatibility
CONFIG_VERSION = "1.0"

# Version info for display
VERSION_INFO = {
    "version": VERSION,
    "app_name": "Bongo Cat Typing Monitor",
    "description": "Monitors your typing and shows cute cat animations!",
}

def get_version():
    """Get the current application version"""
    return VERSION

def get_version_info():
    """Get detailed version information"""
    return VERSION_INFO

def get_app_title():
    """Get the application title with version"""
    return f"{VERSION_INFO['app_name']} v{VERSION}"
