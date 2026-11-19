#!/usr/bin/env python3
"""
Bongo Cat – Kernlogik (Serial + Stats + WPM), ohne Oberflaeche.

Wird von bongocat_linux.py (CLI/Dienst) und bongocat_tray.py (GUI) benutzt.
Protokoll und Formeln: siehe README.md.
"""

from __future__ import annotations

import glob
import os
import select
import termios
import threading
import time
import tty

import psutil

BAUD = 115200
WPM_WINDOW_KEYS = 8
WPM_MIN_SPAN_S = 0.4
TYPING_TIMEOUT_S = 1.5
STREAK_WPM = 65


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
        if vendor == "1a86":
            return dev
    return candidates[0] if candidates else None


def wpm_to_speed(wpm: int) -> int:
    if wpm <= 0:
        return 500
    normalized = min(wpm, 200) / 200.0
    return max(min(round(500 - normalized * (500 - 30)), 500), 30)


class Esp32:
    def __init__(self, port: str, log=None) -> None:
        self.port = port
        self.fd: int | None = None
        self.log = log or (lambda _msg: None)

    def open(self) -> bool:
        try:
            fd = os.open(self.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        except OSError as exc:
            self.log(f"kann {self.port} nicht oeffnen: {exc}")
            return False
        try:
            tty.setraw(fd)
            attrs = termios.tcgetattr(fd)
            attrs[4] = termios.B115200
            attrs[5] = termios.B115200
            attrs[2] |= termios.CLOCAL | termios.CREAD
            attrs[2] &= ~(termios.CRTSCTS | termios.PARENB | termios.CSTOPB)
            attrs[0] &= ~(termios.IXON | termios.IXOFF | termios.IXANY)
            termios.tcsetattr(fd, termios.TCSANOW, attrs)
        except termios.error as exc:
            os.close(fd)
            self.log(f"Port-Konfiguration fehlgeschlagen: {exc}")
            return False
        self.fd = fd
        self.log(f"verbunden mit {self.port}")
        return True

    def close(self) -> None:
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None

    @property
    def connected(self) -> bool:
        return self.fd is not None

    def send(self, line: str) -> bool:
        if self.fd is None:
            return False
        try:
            os.write(self.fd, (line + "\n").encode())
            return True
        except OSError:
            self.close()
            return False

    def poll(self) -> list[str]:
        """Antworten des Displays abholen (nicht blockierend)."""
        if self.fd is None:
            return []
        try:
            ready, _, _ = select.select([self.fd], [], [], 0)
            if not ready:
                return []
            data = os.read(self.fd, 4096)
        except OSError:
            self.close()
            return []
        if not data:
            return []
        return [ln.strip() for ln in data.decode("utf-8", "replace").splitlines() if ln.strip()]


class KeyCounter:
    """Globale Tastaturanschlaege ueber X11/XRecord."""

    def __init__(self, log=None) -> None:
        self.times: list[float] = []
        self.lock = threading.Lock()
        self.log = log or (lambda _msg: None)
        self.available = False

    def start(self) -> None:
        try:
            from Xlib import display
            from Xlib.ext import record
        except ImportError:
            self.log("python-xlib fehlt – WPM bleibt 0")
            return
        try:
            local = display.Display()
        except Exception as exc:  # noqa: BLE001
            self.log(f"X11 nicht verfuegbar ({exc}) – WPM bleibt 0")
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
                if data and data[0] == 2:
                    with self.lock:
                        self.times.append(time.monotonic())
                        del self.times[:-64]
            except Exception:  # noqa: BLE001
                return

        self.available = True
        threading.Thread(
            target=local.record_enable_context,
            args=(ctx, handler),
            daemon=True,
            name="xrecord",
        ).start()
        self.log("Tastatur-Erkennung aktiv (XRecord)")

    def wpm(self) -> tuple[int, bool]:
        now = time.monotonic()
        with self.lock:
            self.times = [t for t in self.times if now - t <= 3.0]
            recent = self.times[-WPM_WINDOW_KEYS:]
            if not recent:
                return 0, False
            active = (now - recent[-1]) <= TYPING_TIMEOUT_S
        if len(recent) < 2:
            return 0, active
        span = recent[-1] - recent[0]
        if span < WPM_MIN_SPAN_S:
            return 0, active
        raw = (len(recent) / 5.0) / (span / 60.0)
        return min(int(round(raw)), 250), active


class Engine:
    """Sendet CPU/RAM/WPM an das Display – in einem eigenen Thread."""

    def __init__(self, port: str | None = None, log=None) -> None:
        self.log = log or (lambda _msg: None)
        self.port = port or find_port()
        self.esp = Esp32(self.port, log=self.log) if self.port else None
        self.keys = KeyCounter(log=self.log)
        self.cpu = 0
        self.ram = 0
        self.wpm = 0
        self.typing = False
        self.paused = False
        self.last_response = ""
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def connected(self) -> bool:
        return bool(self.esp and self.esp.connected)

    def start(self) -> None:
        self.keys.start()
        psutil.cpu_percent(interval=None)
        self._thread = threading.Thread(target=self._run, daemon=True, name="engine")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        if self.esp:
            self.esp.send("STOP")
            self.esp.close()

    def send_command(self, line: str) -> bool:
        """Beliebiges Kommando an das Display (z. B. BG:101418)."""
        if self.esp and self.esp.connected:
            return self.esp.send(line)
        return False

    def set_paused(self, paused: bool) -> None:
        self.paused = paused
        if paused and self.esp:
            self.esp.send("STOP")

    def _run(self) -> None:
        last_minute = None
        idle_sent = False
        streak = False
        last_try = 0.0

        while not self._stop.is_set():
            if self.esp is None:
                # Port taucht erst spaeter auf (Display angesteckt)
                found = find_port()
                if found:
                    self.port = found
                    self.esp = Esp32(found, log=self.log)
                else:
                    time.sleep(2)
                    continue

            if self.esp and not self.esp.connected:
                if time.monotonic() - last_try < 5:
                    time.sleep(0.5)
                    continue
                last_try = time.monotonic()
                if not self.esp.open():
                    time.sleep(1)
                    continue

            if self.paused:
                time.sleep(0.5)
                continue

            self.cpu = int(round(psutil.cpu_percent(interval=None)))
            self.ram = int(round(psutil.virtual_memory().percent))
            self.wpm, self.typing = self.keys.wpm()

            if self.esp:
                self.esp.send(f"STATS:CPU:{self.cpu},RAM:{self.ram},WPM:{self.wpm}")

                if self.typing and self.wpm > 0:
                    self.esp.send(f"SPEED:{wpm_to_speed(self.wpm)}")
                    if self.wpm >= STREAK_WPM and not streak:
                        self.esp.send("STREAK_ON")
                        streak = True
                    elif self.wpm < STREAK_WPM and streak:
                        self.esp.send("STREAK_OFF")
                        streak = False
                    idle_sent = False
                elif not idle_sent:
                    self.esp.send("STOP")
                    if streak:
                        self.esp.send("STREAK_OFF")
                        streak = False
                    idle_sent = True

                minute = time.strftime("%H:%M")
                if minute != last_minute:
                    self.esp.send(f"TIME:{minute}")
                    last_minute = minute

                for line in self.esp.poll():
                    self.last_response = line
                    self.log(f"<- {line}")

            time.sleep(1.0)
