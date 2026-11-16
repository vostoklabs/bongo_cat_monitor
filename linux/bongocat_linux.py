#!/usr/bin/env python3
"""
Bongo Cat – Linux-Begleiter fuer die ESP32-Firmware (vostoklabs/bongo_cat_monitor)

Die offizielle Desktop-App gibt es nur fuer Windows und macOS. Dieses Script
macht dasselbe unter Linux: es liest CPU/RAM, misst die Tippgeschwindigkeit
(WPM) und schickt beides ueber USB-Serial an das Display.

Protokoll (aus Firmware bongo_cat.ino + Electron-App src/serial.js, per REA
verifiziert):

    STATS:CPU:<0-100>,RAM:<0-100>,WPM:<n>     jede Sekunde
    SPEED:<ms>                                Animationstempo beim Tippen
    STREAK_ON / STREAK_OFF                    ab 65 WPM
    STOP                                      wenn nicht getippt wird
    TIME:HH:MM                                bei Minutenwechsel
    HEARTBEAT                                 Keepalive

    Antworten der Firmware: "PONG", "🔄 Animation state refreshed", ...

Serial: 115200 8N1, Zeilen mit '\\n' abgeschlossen.

Aufruf:
    ./bongocat_linux.py                 # Port automatisch finden
    ./bongocat_linux.py --port /dev/ttyUSB0
    ./bongocat_linux.py --verbose       # Antworten des Displays mitloggen
    ./bongocat_linux.py --list          # nur Ports anzeigen
"""

from __future__ import annotations

import argparse
import glob
import os
import select
import sys
import termios
import threading
import time
import tty

try:
    import psutil
except ImportError:  # pragma: no cover
    print("psutil fehlt:  sudo apt install python3-psutil", file=sys.stderr)
    raise SystemExit(1)

BAUD = 115200
WPM_WINDOW_KEYS = 8
WPM_MIN_SPAN_S = 0.4
TYPING_TIMEOUT_S = 1.5
STREAK_WPM = 65


# --------------------------------------------------------------------------
# Serielle Verbindung (ohne pyserial, nur termios)
# --------------------------------------------------------------------------
class Esp32:
    def __init__(self, port: str, verbose: bool = False) -> None:
        self.port = port
        self.verbose = verbose
        self.fd: int | None = None

    def open(self) -> bool:
        try:
            fd = os.open(self.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        except OSError as exc:
            self._log(f"kann {self.port} nicht oeffnen: {exc}")
            return False

        try:
            tty.setraw(fd)
            attrs = termios.tcgetattr(fd)
            # 115200 8N1, kein Handshake
            attrs[4] = termios.B115200
            attrs[5] = termios.B115200
            attrs[2] |= termios.CLOCAL | termios.CREAD
            attrs[2] &= ~(termios.CRTSCTS | termios.PARENB | termios.CSTOPB)
            attrs[0] &= ~(termios.IXON | termios.IXOFF | termios.IXANY)
            termios.tcsetattr(fd, termios.TCSANOW, attrs)
        except termios.error as exc:
            os.close(fd)
            self._log(f"Port-Konfiguration fehlgeschlagen: {exc}")
            return False

        self.fd = fd
        self._log(f"verbunden mit {self.port} @ {BAUD}")
        return True

    def close(self) -> None:
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None

    def send(self, line: str) -> bool:
        if self.fd is None:
            return False
        try:
            os.write(self.fd, (line + "\n").encode())
            return True
        except OSError as exc:
            self._log(f"Senden fehlgeschlagen ({exc}) – Verbindung weg")
            self.close()
            return False

    def poll(self) -> None:
        """Antworten des Displays lesen und (optional) loggen."""
        if self.fd is None:
            return
        try:
            ready, _, _ = select.select([self.fd], [], [], 0)
            if not ready:
                return
            data = os.read(self.fd, 4096)
        except OSError:
            self.close()
            return
        if data and self.verbose:
            for line in data.decode("utf-8", "replace").splitlines():
                line = line.strip()
                if line:
                    self._log(f"<- {line}")

    def _log(self, text: str) -> None:
        if self.verbose:
            print(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)


def find_port() -> str | None:
    """Bevorzugt den CH340 (1a86:7523), sonst den ersten USB-Seriellen."""
    candidates = sorted(glob.glob("/dev/ttyUSB*")) + sorted(glob.glob("/dev/ttyACM*"))
    for dev in candidates:
        name = os.path.basename(dev)
        try:
            with open(f"/sys/class/tty/{name}/device/../idVendor") as fh:
                vendor = fh.read().strip()
        except OSError:
            continue
        if vendor == "1a86":  # QinHeng CH340
            return dev
    return candidates[0] if candidates else None


# --------------------------------------------------------------------------
# Tastatur (X11/XRecord ueber python-xlib)
# --------------------------------------------------------------------------
class KeyCounter:
    def __init__(self, verbose: bool = False) -> None:
        self.times: list[float] = []
        self.lock = threading.Lock()
        self.verbose = verbose
        self.available = False

    def start(self) -> None:
        try:
            from Xlib import display
            from Xlib.ext import record
        except ImportError:
            print("python-xlib fehlt:  sudo apt install python3-xlib", file=sys.stderr)
            return

        try:
            local = display.Display()
        except Exception as exc:  # kein DISPLAY / kein X
            print(f"X11 nicht verfuegbar ({exc}) – WPM bleibt 0", file=sys.stderr)
            return

        ctx = local.record_create_context(
            0,
            [record.AllClients],
            [
                {
                    "core_requests": (0, 0),
                    "core_replies": (0, 0),
                    "ext_requests": (0, 0, 0, 0),
                    "ext_replies": (0, 0, 0, 0),
                    "delivered_events": (0, 0),
                    "device_events": (2, 3),  # KeyPress=2, KeyRelease=3
                    "errors": (0, 0),
                    "client_started": False,
                    "client_died": False,
                }
            ],
        )

        def handler(reply) -> None:
            try:
                if reply.category != record.FromServer or reply.client_swapped:
                    return
                data = reply.data
                if not data:
                    return
                # Erstes Byte = Event-Code (2 = KeyPress, 3 = KeyRelease)
                if data[0] == 2:
                    with self.lock:
                        self.times.append(time.monotonic())
                        del self.times[:-64]
            except Exception:
                return

        self.available = True
        threading.Thread(
            target=local.record_enable_context,
            args=(ctx, handler),
            daemon=True,
            name="xrecord",
        ).start()
        if self.verbose:
            print("Tastatur-Erkennung aktiv (XRecord)")

    def wpm(self) -> tuple[int, bool]:
        """(wpm, tippt_gerade) – Formel wie in der Electron-App."""
        now = time.monotonic()
        with self.lock:
            self.times = [t for t in self.times if now - t <= 3.0]
            recent = self.times[-WPM_WINDOW_KEYS:]
            if not recent:
                return 0, False
            active = (now - recent[-1]) <= TYPING_TIMEOUT_S
        if len(recent) < 2:
            return (0, active)
        span = recent[-1] - recent[0]
        if span < WPM_MIN_SPAN_S:
            return (0, active)
        raw = (len(recent) / 5.0) / (span / 60.0)
        return (min(int(round(raw)), 250), active)


# --------------------------------------------------------------------------
# Hauptschleife
# --------------------------------------------------------------------------
def wpm_to_speed(wpm: int) -> int:
    if wpm <= 0:
        return 500
    normalized = min(wpm, 200) / 200.0
    return max(min(round(500 - normalized * (500 - 30)), 500), 30)


def main() -> int:
    ap = argparse.ArgumentParser(description="Bongo Cat Linux-Begleiter")
    ap.add_argument("--port", help="serieller Port (Standard: automatisch)")
    ap.add_argument("--verbose", action="store_true", help="Details + Antworten loggen")
    ap.add_argument("--list", action="store_true", help="nur Ports anzeigen")
    args = ap.parse_args()

    if args.list:
        for dev in sorted(glob.glob("/dev/ttyUSB*")) + sorted(glob.glob("/dev/ttyACM*")):
            print(dev)
        return 0

    port = args.port or find_port()
    if not port:
        print("Kein serieller Port gefunden (Display per USB verbunden?)", file=sys.stderr)
        return 1

    esp = Esp32(port, verbose=args.verbose)
    keys = KeyCounter(verbose=args.verbose)
    keys.start()

    psutil.cpu_percent(interval=None)  # erste Messung ist immer 0
    last_minute = None
    idle_sent = False
    streak_on = False
    last_reconnect = 0.0

    print(f"Bongo Cat Linux laeuft auf {port} – Strg+C beendet.")

    while True:
        if esp.fd is None:
            if time.monotonic() - last_reconnect < 5:
                time.sleep(0.5)
                continue
            last_reconnect = time.monotonic()
            esp.open()
            if esp.fd is None:
                time.sleep(1)
                continue

        cpu = int(round(psutil.cpu_percent(interval=None)))
        ram = int(round(psutil.virtual_memory().percent))
        wpm, typing = keys.wpm()

        esp.send(f"STATS:CPU:{cpu},RAM:{ram},WPM:{wpm}")

        if typing and wpm > 0:
            esp.send(f"SPEED:{wpm_to_speed(wpm)}")
            if wpm >= STREAK_WPM and not streak_on:
                esp.send("STREAK_ON")
                streak_on = True
            elif wpm < STREAK_WPM and streak_on:
                esp.send("STREAK_OFF")
                streak_on = False
            idle_sent = False
        elif not idle_sent:
            esp.send("STOP")
            if streak_on:
                esp.send("STREAK_OFF")
                streak_on = False
            idle_sent = True

        minute = time.strftime("%H:%M")
        if minute != last_minute:
            esp.send(f"TIME:{minute}")
            last_minute = minute

        esp.poll()
        time.sleep(1.0)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nbeendet.")
