# LedWeb Troubleshooting Guide 🔧

## Quick Diagnostics

```bash
# Run automated health check
sudo ledweb-health

# View live logs
sudo journalctl -u piled.service -f

# Quick fix attempt
sudo ledweb-fix

# Manual service restart
sudo systemctl restart piled.service
sudo systemctl status piled.service
```

---

## Common Issues & Solutions

### 1. ❌ Service Won't Start

**Symptoms:**
```
● piled.service - Pi LED Controller
   Loaded: loaded
   Active: failed
```

**Solutions:**

#### A. Check logs
```bash
journalctl -u piled.service -n 50
```

#### B. Common causes:

**Python import errors:**
```bash
# Reinstall dependencies
cd /home/pi/ledweb
source /home/pi/.venv/bin/activate
pip install --force-reinstall -r requirements.txt
```

**Permission errors:**
```bash
sudo chown -R pi:pi /home/pi/ledweb
sudo chown -R pi:pi /home/pi/.venv
```

**Config file errors:**
```bash
# Validate all JSON files
for f in /home/pi/ledweb/config/*.json; do
    echo "Checking $f..."
    jq empty "$f" || echo "ERROR in $f"
done
```

---

### 2. 💡 LEDs Not Lighting Up

**Check hardware config:**
```bash
cat /home/pi/ledweb/config/hardware.json
```

**Common settings:**
- `gpio_pin`: Usually 18 (PWM) or 10 (SPI)
- `led_count`: Total number of LEDs in your strip
- `brightness`: 0-255 (start with 50-100 for testing)

**Hardware checklist:**
- [ ] Power supply connected (5V, adequate amperage)
- [ ] Data line connected to correct GPIO pin
- [ ] Ground shared between Pi and LED power supply
- [ ] 330-470Ω resistor on data line (recommended)
- [ ] Strip type matches: WS2811/WS2812B/SK6812

**Test LED strip directly:**
```bash
cd /home/pi/ledweb
sudo /home/pi/.venv/bin/python led_test.py
```

**If test fails:**
```bash
# Check if rpi_ws281x is properly installed
/home/pi/.venv/bin/pip show rpi_ws281x

# Reinstall if needed
sudo /home/pi/.venv/bin/pip uninstall rpi_ws281x
sudo /home/pi/.venv/bin/pip install rpi_ws281x
```

---

### 3. 🎵 No Audio Reactive Effects

**Check USB microphone:**
```bash
# List audio devices
arecord -l

# Should show something like:
# card 1: Device [USB Audio Device], device 0: USB Audio [USB Audio]
```

**Test audio input:**
```bash
# Record 3 seconds of audio
arecord -d 3 -f cd test.wav

# Play it back
aplay test.wav
```

**If no device found:**
- Reconnect USB microphone
- Try different USB port
- Check `lsusb` output

**PyAudio issues:**
```bash
# Reinstall audio packages
sudo apt install --reinstall portaudio19-dev libportaudio2

cd /home/pi/ledweb
source /home/pi/.venv/bin/activate
pip install --force-reinstall pyaudio
```

---

### 4. 🌐 Can't Access Web Interface

**Check if service is running:**
```bash
systemctl status piled.service
```

**Check if port 8080 is listening:**
```bash
ss -tuln | grep 8080
# Should show: tcp LISTEN 0.0.0.0:8080
```

**Test locally:**
```bash
curl http://localhost:8080
# Should return HTML
```

**Check firewall:**
```bash
# If using ufw
sudo ufw allow 8080/tcp
sudo ufw status
```

**Access URLs to try:**
- `http://localhost:8080/frontend/`
- `http://raspberrypi.local:8080/frontend/`
- `http://<Pi-IP-address>:8080/frontend/`

**Get Pi IP address:**
```bash
hostname -I
```

---

### 5. 🔗 mDNS (.local) Not Working

**Check avahi-daemon:**
```bash
systemctl status avahi-daemon

# Restart if needed
sudo systemctl restart avahi-daemon
```

**Test mDNS resolution:**
```bash
avahi-browse -a
# Should show your Pi

ping $(hostname).local
```

**Client-side issues:**
- **Windows**: Install [Bonjour Print Services](https://support.apple.com/kb/DL999)
- **Linux**: Install `avahi-daemon` and `libnss-mdns`
- **macOS**: Should work out of the box

---

### 6. 🔒 Authentication/Login Issues

**Default password:**
Check `/home/pi/ledweb/config/auth.json`

**Reset password:**
```bash
cd /home/pi/ledweb
cat > config/auth.json <<EOF
{"password": "admin"}
EOF

sudo systemctl restart piled.service
```

---

### 7. 📊 High CPU Usage

**Check current effect:**
Some effects (especially audio-reactive ones) use more CPU.

**Reduce LED count:**
Edit `config/hardware.json` and lower `led_count` if you have fewer LEDs.

**Disable audio if not needed:**
Via web UI: Settings → Audio → Disable

**Monitor resources:**
```bash
# CPU usage
top -p $(pgrep -f uvicorn)

# Memory usage
free -h
```

---

### 8. 🔄 Service Restarts Constantly

**Check crash logs:**
```bash
journalctl -u piled.service --since "5 minutes ago"
```

**Common causes:**
- Syntax error in config files
- Missing Python dependencies
- Hardware conflict (GPIO already in use)
- Insufficient permissions

**Stop auto-restart temporarily:**
```bash
sudo systemctl stop piled.service

# Run manually to see errors
cd /home/pi/ledweb
source /home/pi/.venv/bin/activate
sudo /home/pi/.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8080
```

---

### 9. 🎨 Effects Not Displaying Correctly

**Check zones config:**
```bash
cat /home/pi/ledweb/config/zones.json
jq . /home/pi/ledweb/config/zones.json  # Pretty print
```

**Reset to defaults:**
```bash
cd /home/pi/ledweb/config
echo '[]' > zones.json
sudo systemctl restart piled.service
```

**Test with simple effect:**
Via web UI: Switch to "Solid" effect with single color.

---

### 10. 📱 Browser Not Loading Frontend

**Check frontend files exist:**
```bash
ls -la /home/pi/ledweb/frontend/
# Should contain index.html, app.js, etc.
```

**Clear browser cache:**
- Chrome/Edge: Ctrl+Shift+Delete
- Firefox: Ctrl+Shift+R
- Try incognito/private mode

**Check browser console:**
Press F12 → Console tab → Look for errors

---

## Advanced Debugging

### Enable Verbose Logging

Edit `/etc/systemd/system/piled.service`:
```ini
[Service]
Environment=PYTHONUNBUFFERED=1
Environment=LOG_LEVEL=DEBUG
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl restart piled.service
```

### Check GPIO Status

```bash
# Show GPIO states
gpio readall

# Check if pin is in use
sudo lsof | grep gpio
```

### Memory Leak Detection

```bash
# Monitor over time
watch -n 1 'ps aux | grep uvicorn'
```

### Network Debugging

```bash
# Check all listening ports
sudo netstat -tulpn

# Check active connections
ss -ant | grep 8080

# Test from another device
curl -v http://<pi-ip>:8080
```

---

## Complete Reinstallation

If all else fails:

```bash
# Stop and disable service
sudo systemctl stop piled.service
sudo systemctl disable piled.service

# Remove old installation
sudo rm -rf /home/pi/ledweb
sudo rm -rf /home/pi/.venv
sudo rm /etc/systemd/system/piled.service

# Fresh install
cd /home/pi
git clone https://github.com/D-flnt/ledweb.git
cd ledweb
sudo bash install_production.sh
```

---

## Getting Help

**Collect diagnostic info:**
```bash
# Create debug bundle
sudo bash -c '
echo "=== System Info ===" > /tmp/ledweb-debug.txt
uname -a >> /tmp/ledweb-debug.txt
cat /proc/cpuinfo | grep Model >> /tmp/ledweb-debug.txt
echo >> /tmp/ledweb-debug.txt

echo "=== Service Status ===" >> /tmp/ledweb-debug.txt
systemctl status piled.service >> /tmp/ledweb-debug.txt
echo >> /tmp/ledweb-debug.txt

echo "=== Recent Logs ===" >> /tmp/ledweb-debug.txt
journalctl -u piled.service -n 100 >> /tmp/ledweb-debug.txt
echo >> /tmp/ledweb-debug.txt

echo "=== Config Files ===" >> /tmp/ledweb-debug.txt
ls -la /home/pi/ledweb/config/ >> /tmp/ledweb-debug.txt
echo >> /tmp/ledweb-debug.txt

echo "=== Hardware Config ===" >> /tmp/ledweb-debug.txt
cat /home/pi/ledweb/config/hardware.json >> /tmp/ledweb-debug.txt
echo >> /tmp/ledweb-debug.txt

echo "=== Python Packages ===" >> /tmp/ledweb-debug.txt
/home/pi/.venv/bin/pip list >> /tmp/ledweb-debug.txt
'

cat /tmp/ledweb-debug.txt
```

**Include this info when asking for help!**

---

## Maintenance Commands

```bash
# Update to latest version
cd /home/pi/ledweb
git pull origin main
sudo systemctl restart piled.service

# Backup configuration
sudo tar -czf /home/pi/ledweb-backup-$(date +%Y%m%d).tar.gz /home/pi/ledweb/config/

# Restore configuration
sudo tar -xzf /home/pi/ledweb-backup-YYYYMMDD.tar.gz -C /

# View disk usage
du -sh /home/pi/ledweb/
du -sh /home/pi/.venv/

# Clean old logs
sudo journalctl --vacuum-time=7d
```
