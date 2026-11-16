# Bongo Cat – Linux-Begleiter

Die offizielle Bongo-Cat-App gibt es nur für Windows und macOS. Dieses Script
übernimmt denselben Job unter Linux: es schickt **CPU**, **RAM**, **Tippgeschwindigkeit
(WPM)** und die **Uhrzeit** per USB-Serial an das ESP32-Display.

## Was es macht

```
┌──────────────┐   USB-Serial 115200    ┌─────────────────┐
│ Linux-Script │ ─────────────────────▶ │ ESP32 + Display │
│  /proc, X11  │   STATS / SPEED / ...  │  (Bongo Cat)    │
└──────────────┘                        └─────────────────┘
```

- **CPU/RAM** aus `psutil` (kernelgenau, wie `htop`)
- **WPM** über XRecord (globaler Tastatur-Mitschnitt, kein Root nötig)
- **Uhrzeit** bei jedem Minutenwechsel

## Protokoll

Aus der Firmware (`bongo_cat.ino`) und der Electron-App (`src/serial.js`)
extrahiert – zeilenbasiert, `\n`-terminiert, 115200 8N1:

| Kommando | Bedeutung |
|---|---|
| `STATS:CPU:12,RAM:47,WPM:58` | alle Werte auf einmal, jede Sekunde |
| `SPEED:<ms>` | Animationstempo; 500 = langsam, 30 = schnell |
| `STREAK_ON` / `STREAK_OFF` | ab 65 WPM (glückliches Gesicht) |
| `STOP` | gerade wird nicht getippt |
| `TIME:HH:MM` | Uhrzeit im Display |
| `HEARTBEAT` | Keepalive (optional) |

WPM-Formel wie in der Original-App: die letzten 8 Tastenanschläge, Mindestspanne
0,4 s, `(Anschläge / 5) / Minuten`, geglättet.

## Benutzung

```bash
cd ./

./bongocat_linux.py              # Port automatisch finden, normaler Betrieb
./bongocat_linux.py --verbose    # zeigt auch Antworten des Displays
./bongocat_linux.py --list       # vorhandene serielle Ports
./bongocat_linux.py --port /dev/ttyUSB1
```

Der Port wird bevorzugt über die USB-Kennung des **CH340** (`1a86:7523`)
gefunden, sonst der erste `/dev/ttyUSB*`.

## Autostart

Als systemd-**User**-Dienst (braucht die grafische Sitzung für XRecord):

```bash
mkdir -p ~/.config/systemd/user
cp .//bongocat-linux.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bongocat-linux.service
systemctl --user status bongocat-linux.service
journalctl --user -u bongocat-linux -f      # Log
```

Stoppen:

```bash
systemctl --user disable --now bongocat-linux.service
```

## Abhängigkeiten

Nur zwei Dinge, beide bei Linux Mint vorhanden:

```bash
sudo apt install python3-psutil python3-xlib
```

Seriell wird direkt über `termios` gemacht – **kein** `pyserial` nötig.

## Farben

Die Original-Firmware hat feste Farben (weißer Hintergrund, schwarzer Text).
Die Firmware in `firmware/` ist gepatcht und versteht zwei zusätzliche Kommandos:

```
BG:RRGGBB    Hintergrundfarbe
FG:RRGGBB    Textfarbe
```

Die Tray-App hat dafür ein Menü **Farbe** mit Presets (Weiß/Dunkel/Blau/Amber/Grün).
Die Wahl wird in `~/.config/bongocat-tray.json` gespeichert und beim nächsten
Verbinden automatisch wieder gesetzt (die Firmware selbst speichert keine Farben).

Firmware neu bauen und flashen:

```bash
cd .//firmware
docker run --rm -v "$PWD:/project" -v pio-core:/root/.platformio -w /project \
  python:3.12 sh -c "pip install -q platformio && pio pkg install >/dev/null 2>&1; \
  cp src/User_Setup.h .pio/libdeps/cyd/TFT_eSPI/User_Setup.h && pio run"
```

**Wichtig:** Der `cp` ist Pflicht. TFT_eSPI benutzt sonst seine eigene
Default-`User_Setup.h` (240×320, Standard-ILI9341) – Ergebnis: schwarzes Display.
Die richtige Variante ist `ILI9341_2_DRIVER` mit 320×240. Nach `pio run -t clean`
oder wenn PlatformIO die Libs neu entpackt, muss die Datei erneut kopiert werden.

Zusaetzlich setzt `main.ino` in `setup()` das **Backlight auf GPIO21** (in
`User_Setup.h` steht faelschlich 27).

# flashen (Bootloader + Partitionen + App, weil anderes Partitionsschema)
docker run --rm --device=/dev/ttyUSB0 -v "$PWD:/fw" \
  --entrypoint esptool.py ghcr.io/esphome/esphome:latest \
  --port /dev/ttyUSB0 write_flash 0x1000 /fw/.pio/build/cyd/bootloader.bin \
  0x8000 /fw/.pio/build/cyd/partitions.bin 0x10000 /fw/.pio/build/cyd/firmware.bin
```

## Lizenz / Beitrag

Das Originalprojekt ist **MIT** (Copyright (c) 2024 Bongo Cat Project) – Forks,
Änderungen und Pull Requests sind ausdrücklich erlaubt, solange Copyright- und
Lizenzhinweis erhalten bleiben. Unser Tray-Icon ist aus den Original-Sprites
zusammengesetzt (ebenfalls MIT) – Attribution beim Veröffentlichen nicht vergessen.
Der Projektname/das Logo gehören dem Originalprojekt; ein Fork sollte sich nicht
als offizielle Version ausgeben.

## Grenzen

- **X11 only.** Unter Wayland darf kein Programm global Tasten mitlesen; dann
  bleibt WPM bei 0 (CPU/RAM/Uhrzeit funktionieren weiter).
- Läuft nur, solange die Sitzung läuft (User-Dienst).
- Wenn das Display wieder die Monitor-Firmware bekommt, versteht es diese
  Kommandos nicht – dann den Dienst stoppen.
