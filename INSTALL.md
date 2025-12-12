# Installatie & Deployment (Raspberry Pi)

1) Basispackages
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git \
  libatlas-base-dev libportaudio2 libffi-dev build-essential \
  avahi-daemon libnss-mdns
```

2) Virtuele omgeving + Python dependencies
```bash
cd /home/pi
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

3) Start handmatig voor test
```bash
source /home/pi/.venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8080
# Bezoek: http://<hostname>.local:8080/frontend/
```

4) mDNS (al geïnstalleerd hierboven)
- Controleer dat `avahi-daemon` draait: `systemctl status avahi-daemon`
- Clients kunnen `http://<pi-hostname>.local:8080` gebruiken.

5) Systemd-service
- Bestand: `systemd/piled.service`
```bash
sudo cp systemd/piled.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable piled.service
sudo systemctl start piled.service
sudo systemctl status piled.service
```

6) Configuratiebestanden
- `config/hardware.json` – LED-setup (led_count, gpio_pin, brightness)
- `config/ui.json` – UI-tuning (naam, accentkleur, default preset)
- `config/presets.json` – lijst met presets
- `config/zones.json` – segmentdefinities (start/eind, effect, params)
- `config/alarms.json` – wekkers en timers

7) Nieuwe effecten toevoegen
- Backend: voeg een klasse toe in `backend/effects/__init__.py`, stel `name`, `category`, `default_params` en `render` in en registreer in de lijst onderaan.
- Frontend: wordt automatisch zichtbaar via `/api/status`; zorg dat `category` logisch is zodat filtering werkt.

8) Troubleshooting
- Geen licht: controleer `gpio_pin`/`led_count` in `config/hardware.json` en herstart service.
- rpi_ws281x errors: check voeding + datalijn (weerstand 330–470 Ω), run `python led_test.py` als rooktest.
- Geen audio: controleer USB-mic in `arecord -l`; zorg dat `pyaudio` device bestaat.
- Geen mDNS: herstart `avahi-daemon`; sommige Windows-clients hebben Bonjour nodig.
