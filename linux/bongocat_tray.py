#!/usr/bin/env python3
"""
Bongo Cat – Tray-App fuer Linux (GTK3 + AyatanaAppIndicator)

Fenster mit Live-Werten (Port, CPU, RAM, WPM) und Tray-Icon mit Menue.
Die eigentliche Arbeit macht bongocat_core.Engine.

Start:
    ./bongocat_tray.py            # Fenster + Tray
    ./bongocat_tray.py --hidden   # nur Tray (fuer Autostart)
"""

from __future__ import annotations

import json
import os
import signal
import sys

import gi

gi.require_version("Gtk", "3.0")
try:
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3 as AppIndicator
except (ValueError, ImportError):
    AppIndicator = None

from gi.repository import GLib, Gtk

from bongocat_core import Engine

APP_ID = "bongocat-tray"
ICON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bongocat.png")
AUTOSTART_FILE = os.path.expanduser("~/.config/autostart/bongocat-tray.desktop")
COLOR_PRESETS = [
    ("Schwarz",         "000000", "FFFFFF"),
    ("Weiß (Original)", "FFFFFF", "000000"),
    ("Dunkel",          "101418", "FFFFFF"),
    ("Blau",            "0B1F3A", "FFFFFF"),
    ("Amber",           "1A1206", "FFB000"),
    ("Grün",            "071F12", "7CFFB2"),
]
COLOR_FILE = os.path.expanduser("~/.config/bongocat-tray.json")

AUTOSTART_ENTRY = """[Desktop Entry]
Type=Application
Name=Bongo Cat (Tray)
Comment=CPU/RAM/WPM an das ESP32-Display senden
Exec=python3 {script} --hidden
Icon=input-keyboard
Terminal=false
X-GNOME-Autostart-enabled=true
"""


class BongoCatApp:
    def __init__(self, hidden: bool = False) -> None:
        self.engine = Engine(log=self.on_engine_log)
        self.engine.start()

        self.visible = not hidden
        self._was_connected = False
        self._color = self._load_color()
        self._build_window()

        self.indicator = None
        self._build_indicator()

        GLib.timeout_add(500, self.refresh)

    # ------------------------------------------------------------------ UI
    def _build_window(self) -> None:
        self.win = Gtk.Window(title="Bongo Cat")
        self.win.set_border_width(16)
        self.win.set_default_size(320, 220)
        self.win.set_icon_from_file(ICON)
        self.win.connect("delete-event", self._on_close)
        self.win.connect("destroy", lambda *_: Gtk.main_quit())

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.win.add(box)

        self.lbl_status = Gtk.Label(label="…")
        self.lbl_status.set_xalign(0)
        box.pack_start(self.lbl_status, False, False, 0)

        self.bars: dict[str, Gtk.ProgressBar] = {}
        for key, title in (("cpu", "CPU"), ("ram", "RAM"), ("wpm", "WPM")):
            row = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            lbl = Gtk.Label(label=f"{title}")
            lbl.set_xalign(0)
            bar = Gtk.ProgressBar()
            bar.set_show_text(True)
            row.pack_start(lbl, False, False, 0)
            row.pack_start(bar, False, False, 0)
            box.pack_start(row, False, False, 0)
            self.bars[key] = bar

        btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.btn_pause = Gtk.Button(label="Pause")
        self.btn_pause.connect("clicked", self.toggle_pause)
        btns.pack_start(self.btn_pause, True, True, 0)

        self.chk_autostart = Gtk.CheckButton(label="Autostart")
        self.chk_autostart.set_active(os.path.exists(AUTOSTART_FILE))
        self.chk_autostart.connect("toggled", self.on_autostart_toggled)
        btns.pack_start(self.chk_autostart, False, False, 0)

        btn_quit = Gtk.Button(label="Beenden")
        btn_quit.connect("clicked", lambda *_: self.quit())
        btns.pack_start(btn_quit, False, False, 0)

        box.pack_start(btns, False, False, 0)

        self.win.show_all()
        if not self.visible:
            self.win.hide()

    # ------------------------------------------------------------- Farben
    def _load_color(self):
        try:
            with open(COLOR_FILE, encoding="utf-8") as fh:
                data = json.load(fh)
            if data.get("bg") and data.get("fg"):
                return (data["bg"], data["fg"])
        except (OSError, ValueError):
            pass
        return None

    def apply_color(self, bg: str, fg: str, persist: bool = True) -> None:
        self.engine.send_command(f"BG:{bg}")
        self.engine.send_command(f"FG:{fg}")
        self._color = (bg, fg)
        if persist:
            try:
                os.makedirs(os.path.dirname(COLOR_FILE), exist_ok=True)
                with open(COLOR_FILE, "w", encoding="utf-8") as fh:
                    json.dump({"bg": bg, "fg": fg}, fh)
            except OSError as exc:
                print(f"Farbe konnte nicht gespeichert werden: {exc}", file=sys.stderr)

    def _build_indicator(self) -> None:
        if AppIndicator is None:
            return
        self.indicator = AppIndicator.Indicator.new(
            APP_ID, ICON, AppIndicator.IndicatorCategory.APPLICATION_STATUS
        )
        self.indicator.set_icon_full(ICON, "Bongo Cat")
        self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.indicator.set_title("Bongo Cat")

        menu = Gtk.Menu()

        item_show = Gtk.MenuItem(label="Fenster anzeigen")
        item_show.connect("activate", self.show_window)
        menu.append(item_show)

        self.item_pause = Gtk.MenuItem(label="Pause")
        self.item_pause.connect("activate", self.toggle_pause)
        menu.append(self.item_pause)

        self.item_auto = Gtk.CheckMenuItem(label="Autostart")
        self.item_auto.set_active(os.path.exists(AUTOSTART_FILE))
        self.item_auto.connect("activate", self.on_menu_autostart)
        menu.append(self.item_auto)

        item_color = Gtk.MenuItem(label="Farbe")
        sub = Gtk.Menu()
        for name, bg, fg in COLOR_PRESETS:
            it = Gtk.MenuItem(label=name)
            it.connect("activate", lambda _w, b=bg, f=fg: self.apply_color(b, f))
            sub.append(it)
        item_color.set_submenu(sub)
        menu.append(item_color)

        menu.append(Gtk.SeparatorMenuItem())

        item_quit = Gtk.MenuItem(label="Beenden")
        item_quit.connect("activate", lambda *_: self.quit())
        menu.append(item_quit)

        menu.show_all()
        self.indicator.set_menu(menu)

    # ------------------------------------------------------------- Aktionen
    def show_window(self, *_args) -> None:
        self.win.show_all()
        self.win.present()

    def _on_close(self, *_args) -> bool:
        # Fenster schliessen = nur verstecken, Tray bleibt
        self.win.hide()
        return True

    def toggle_pause(self, *_args) -> None:
        self.engine.set_paused(not self.engine.paused)
        label = "Weiter" if self.engine.paused else "Pause"
        self.btn_pause.set_label(label)
        if self.indicator is not None:
            self.item_pause.set_label(label)

    def on_autostart_toggled(self, widget) -> None:
        self._set_autostart(widget.get_active())
        if self.indicator is not None:
            self.item_auto.set_active(widget.get_active())

    def on_menu_autostart(self, widget) -> None:
        self._set_autostart(widget.get_active())
        self.chk_autostart.set_active(widget.get_active())

    def _set_autostart(self, enabled: bool) -> None:
        try:
            if enabled:
                os.makedirs(os.path.dirname(AUTOSTART_FILE), exist_ok=True)
                with open(AUTOSTART_FILE, "w", encoding="utf-8") as fh:
                    fh.write(AUTOSTART_ENTRY.format(script=os.path.abspath(__file__)))
            elif os.path.exists(AUTOSTART_FILE):
                os.remove(AUTOSTART_FILE)
        except OSError as exc:
            print(f"Autostart konnte nicht geaendert werden: {exc}", file=sys.stderr)

    def quit(self) -> None:
        self.engine.stop()
        Gtk.main_quit()

    # --------------------------------------------------------------- Update
    def on_engine_log(self, msg: str) -> None:
        print(msg, flush=True)

    def refresh(self) -> bool:
        eng = self.engine
        if eng.connected and not self._was_connected:
            self._was_connected = True
            if self._color:
                self.apply_color(*self._color, persist=False)
        elif not eng.connected:
            self._was_connected = False

        if eng.connected:
            state = "verbunden" if not eng.paused else "pausiert"
            self.lbl_status.set_markup(
                f"<span color='#2e9e4f'>●</span> {state} – <tt>{eng.port}</tt>"
            )
        else:
            self.lbl_status.set_markup("<span color='#c0392b'>●</span> kein Display gefunden")

        self.bars["cpu"].set_fraction(min(eng.cpu, 100) / 100)
        self.bars["cpu"].set_text(f"{eng.cpu} %")
        self.bars["ram"].set_fraction(min(eng.ram, 100) / 100)
        self.bars["ram"].set_text(f"{eng.ram} %")
        self.bars["wpm"].set_fraction(min(eng.wpm, 200) / 200)
        self.bars["wpm"].set_text(f"{eng.wpm}")

        return True  # weiter aktualisieren


def main() -> int:
    hidden = "--hidden" in sys.argv
    if not os.environ.get("DISPLAY"):
        print("Kein DISPLAY gesetzt – die Tray-App braucht die grafische Sitzung.", file=sys.stderr)
        return 1

    signal.signal(signal.SIGINT, signal.SIG_DFL)  # Strg+C im Terminal
    app = BongoCatApp(hidden=hidden)
    signal.signal(signal.SIGTERM, lambda *_: app.quit())
    Gtk.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
