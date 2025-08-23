# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['bongo_cat_app/main.py'],
    pathex=[],
    binaries=[('bongo_cat_app/libs/LibreHardwareMonitorLib.dll', 'HardwareMonitor/lib')],
    datas=[
        ('bongo_cat_app/assets/tray_icon.png', 'assets'),
        ('bongo_cat_app/default_config.json', '.'),
    ],
    hiddenimports=[
        'PIL',
        'PIL._tkinter_finder',
        'pystray._win32',
        'pynput.keyboard._win32',
        'pynput.mouse._win32',
        'serial.tools.list_ports_windows',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'numpy',
        'scipy',
        'pandas',
        'tensorflow',
        'torch',
        'cv2',
        'sklearn',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='BongoCat',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Set to True for debugging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='bongo_cat_app/assets/tray_icon.png',
)