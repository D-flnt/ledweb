# LedWeb - Raspberry Pi LED Controller 🌈

Web-based LED strip controller voor Raspberry Pi met audio-reactive effecten, zones, presets en alarms.

## ✨ Features

- 🎨 **Meerdere LED effecten**: Rainbow, solid colors, gradient, chase, sparkle, fire, etc.
- 🎵 **Audio-reactive**: Sync LED's met muziek via USB-microfoon
- 📍 **Zone systeem**: Verschillende effecten per LED segment
- 📦 **Presets**: Bewaar en laad je favoriete instellingen
- ⏰ **Alarms**: Automatische LED acties op ingestelde tijden
- 🌐 **Web interface**: Bestuur alles via je browser
- 📱 **mDNS**: Bereikbaar via `hostname.local`
- 🔒 **Auth**: Password-protected API

## 📦 Quick Start (Aanbevolen)

### **Waterdichte Productie Installatie**

Gebruik de nieuwe productie installer voor een bug-vrije setup:

```bash
# Clone repository
cd /home/pi
git clone https://github.com/D-flnt/ledweb.git
cd ledweb

# Run productie installer
sudo bash install_production.sh
```

De installer doet **alles automatisch**:
- ✓ System packages installeren
- ✓ Python virtual environment setup
- ✓ Dependencies installeren
- ✓ Config files valideren
- ✓ Systemd service configureren
- ✓ mDNS/avahi setup
- ✓ Health check tools installeren
- ✓ LED hardware test (optioneel)

**Na installatie:**
- Web interface: `http://raspberrypi.local:8080/frontend/`
- Of via IP: `http://<pi-ip>:8080/frontend/`
- Default password: zie `config/auth.json`

---

## 🔧 Handmatige Installatie

Voor geavanceerde gebruikers of debugging:

### 1. System Dependencies

```bash
sudo apt update
sudo apt install -y \
  python3 python3-venv python3-pip python3-dev \
  git libffi-dev build-essential \
  portaudio19-dev libportaudio2 libasound2-dev \
  libatlas-base-dev \
  avahi-daemon libnss-mdns \
  jq curl
```

### 2. Clone Repository

```bash
cd /home/pi
git clone https://github.com/D-flnt/ledweb.git
cd ledweb
```

### 3. Python Virtual Environment

```bash
python3 -m venv /home/pi/.venv
source /home/pi/.venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

### 4. Configuratie

Edit `/home/pi/ledweb/config/hardware.json`:
```json
{
  "led_count": 300,
  "gpio_pin": 18,
  "brightness": 200,
  "freq_hz": 800000,
  "dma": 10,
  "invert": false,
  "channel": 0,
  "strip_type": "ws281x"
}
```

**Belangrijke settings:**
- `led_count`: Aantal LEDs in je strip
- `gpio_pin`: GPIO pin (meestal 18 voor PWM)
- `brightness`: 0-255 (start met 50-100)

### 5. Test Hardware

```bash
cd /home/pi/ledweb
sudo /home/pi/.venv/bin/python led_test.py
```

Als LEDs niet werken, check:
- Power supply (5V, voldoende amperage)
- Data line naar correcte GPIO pin
- Gedeelde ground tussen Pi en LED power
- Optional: 330-470Ω resistor op data line

### 6. Manual Start (Test)

```bash
source /home/pi/.venv/bin/activate
cd /home/pi/ledweb
sudo uvicorn backend.main:app --host 0.0.0.0 --port 8080
```

Open browser: `http://<pi-ip>:8080/frontend/`

### 7. Systemd Service (Auto-start)

```bash
sudo cp systemd/piled.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable piled.service
sudo systemctl start piled.service
```

Check status:
```bash
systemctl status piled.service
journalctl -u piled.service -f  # Live logs
```

---

## 🪧 Hardware Requirements

### Minimum
- Raspberry Pi 3B+ of hoger (Pi 4 recommended)
- WS2812B/WS2811/SK6812 LED strip
- 5V power supply (60mA per LED @ max brightness)
- MicroSD card (8GB+)

### Optional
- USB-microfoon voor audio-reactive effecten
- Level shifter (3.3V → 5V) voor data line
- Resistor 330-470Ω voor data line

### Wiring

```
Raspberry Pi          LED Strip
-----------          ---------
GPIO 18  ----------> DIN (Data In)
GND      ----------> GND

Power Supply
------------
5V       ----------> +5V (LED Strip)
GND      ----------> GND (LED Strip + Pi GND)
```

**⚠️ Belangrijk:**
- Verbind LED ground met Pi ground
- Gebruik externe power supply voor LEDs (niet via Pi!)
- Pi en LED power supply moeten gedeelde ground hebben

---

## 🐞 Troubleshooting

### Quick Diagnostics

```bash
# Automated health check
sudo ledweb-health

# Quick fix
sudo ledweb-fix

# Live logs
sudo journalctl -u piled.service -f
```

### Common Issues

**LEDs niet aan:**
- Check `config/hardware.json` (led_count, gpio_pin)
- Test met `sudo python led_test.py`
- Controleer power supply en bekabeling
- Run als root/sudo (GPIO access vereist)

**Service start niet:**
```bash
journalctl -u piled.service -n 50
# Check voor Python errors, missing packages, config syntax
```

**Audio werkt niet:**
```bash
arecord -l  # Check USB-mic
arecord -d 3 test.wav  # Test recording
```

**Web interface niet bereikbaar:**
```bash
systemctl status piled.service  # Check if running
ss -tuln | grep 8080  # Check port
curl http://localhost:8080  # Test locally
```

**Voor volledige troubleshooting guide, zie:**  
📚 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

---

## 🛠️ Nuttige Commando's

```bash
# Service management
sudo systemctl start piled.service
sudo systemctl stop piled.service
sudo systemctl restart piled.service
sudo systemctl status piled.service

# Logs
sudo journalctl -u piled.service -f        # Live logs
sudo journalctl -u piled.service -n 100    # Last 100 lines
sudo journalctl -u piled.service --since "1 hour ago"

# Health check
sudo ledweb-health

# Quick fix
sudo ledweb-fix

# Update to latest version
cd /home/pi/ledweb
git pull origin main
sudo systemctl restart piled.service

# Backup config
sudo tar -czf ledweb-backup-$(date +%Y%m%d).tar.gz /home/pi/ledweb/config/

# Manual test
cd /home/pi/ledweb
source /home/pi/.venv/bin/activate
sudo /home/pi/.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8080
```

---

## 📝 Configuratie Files

Alle configs in `/home/pi/ledweb/config/`:

- **hardware.json** - LED strip instellingen (count, pin, brightness)
- **ui.json** - UI configuratie (naam, kleuren, default preset)
- **presets.json** - Opgeslagen LED presets
- **zones.json** - Segmenten met verschillende effecten
- **alarms.json** - Geplande LED acties
- **auth.json** - Wachtwoord voor web interface

Na wijziging:
```bash
sudo systemctl restart piled.service
```

---

## 🎯 API Endpoints

**Base URL:** `http://<hostname>:8080`

### Authentication
```bash
curl -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-password"}'
# Returns: {"token": "xxx"}
```

### Get Status
```bash
curl http://localhost:8080/api/status \
  -H "X-Session-Token: your-token"
```

### Set Effect
```bash
curl -X POST http://localhost:8080/api/effect \
  -H "X-Session-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "effect": "rainbow_cycle",
    "effect_params": {"speed": 5}
  }'
```

### Apply Preset
```bash
curl -X POST http://localhost:8080/api/presets/apply \
  -H "X-Session-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Preset"}'
```

Voor volledige API docs, zie: `backend/main.py`

---

## 🔥 Nieuwe Effecten Toevoegen

1. Maak effect class in `backend/effects/__init__.py`:

```python
class MyEffect:
    name = "my_effect"
    label = "My Effect"
    category = "basic"  # basic, music, dynamic, advanced
    description = "My custom LED effect"
    default_params = {
        "speed": 5,
        "color": [255, 0, 0]
    }
    
    def render(self, strip, t, params, audio):
        # Your effect code here
        # strip: numpy array [led_count, 3] (RGB)
        # t: tijd in seconden
        # params: dict met je parameters
        # audio: dict met audio data (spectrum, beat, etc.)
        
        for i in range(len(strip)):
            strip[i] = params['color']
```

2. Registreer in `EFFECTS` dict onderaan `backend/effects/__init__.py`

3. Restart service:
```bash
sudo systemctl restart piled.service
```

Effect verschijnt automatisch in web UI!

---

## 📚 Documentatie

- [INSTALL.md](./INSTALL.md) - Gedetailleerde installatie instructies
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Volledige troubleshooting guide
- [TODO.md](./TODO.md) - Toekomstige features & improvements
- [AGENTS.md](./AGENTS.md) - AI agent info

---

## 🔐 Security

**Productie tips:**
1. Wijzig default password in `config/auth.json`
2. Gebruik firewall (ufw) om port 8080 te limiteren
3. Overweeg reverse proxy met HTTPS (nginx/caddy)
4. Gebruik sterke wachtwoorden

```bash
# Firewall example
sudo ufw allow from 192.168.1.0/24 to any port 8080
sudo ufw enable
```

---

## ⚙️ Requirements

**Python packages** (zie `requirements.txt`):
- fastapi - Web framework
- uvicorn - ASGI server
- numpy - Array manipulatie
- pyaudio - Audio input
- rpi_ws281x - LED strip control

**System packages:**
- python3, python3-venv, python3-pip
- libportaudio2, portaudio19-dev
- libatlas-base-dev (numpy)
- avahi-daemon (mDNS)

---

## 💯 Performance Tips

1. **LED count:** Meer LEDs = meer CPU. Test met minder LEDs eerst.
2. **Brightness:** Lagere brightness = minder stroom en iets sneller.
3. **Audio:** Disable audio als je het niet gebruikt.
4. **Pi model:** Pi 4 is significant sneller dan Pi 3.
5. **Cooling:** Zorg voor goede ventilatie/koeling.

**Monitoring:**
```bash
top -p $(pgrep -f uvicorn)  # CPU usage
vcgencmd measure_temp       # Pi temperature
```

---

## 🐛 Known Issues

- **Audio sync delay:** ~50-100ms latency is normaal
- **GPIO conflicts:** Andere GPIO apps kunnen conflicteren
- **Memory:** Zeer lange runtime kan geheugen lekken (restart service)

---

## ❤️ Credits

Gebouwd met:
- [rpi_ws281x](https://github.com/jgarff/rpi_ws281x) - LED strip library
- [FastAPI](https://fastapi.tiangolo.com/) - Web framework
- [NumPy](https://numpy.org/) - Array processing

---

## 📝 License

MIT License - Gebruik vrij voor persoonlijke en commerciële projecten.

---

## 🚀 Roadmap

Zie [TODO.md](./TODO.md) voor planned features.

---

**Vragen? Problemen?**

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. Run `sudo ledweb-health`
3. Check logs: `journalctl -u piled.service -f`
4. Open GitHub issue met debug info

Happy LEDing! 🌈✨
