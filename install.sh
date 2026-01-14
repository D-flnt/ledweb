#!/bin/bash
# LedWeb Installer voor Raspberry Pi
# Gebruik: curl -sSL https://raw.githubusercontent.com/D-flnt/ledweb/main/install.sh | bash

set -e

echo "🌈 LedWeb Installer"
echo "=================="
echo ""

# Check if running on Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null && ! grep -q "BCM" /proc/cpuinfo 2>/dev/null; then
    echo "⚠️  Waarschuwing: Dit lijkt geen Raspberry Pi te zijn."
    read -p "Doorgaan? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check Python version
echo "📦 Checking Python..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 niet gevonden. Installeer eerst Python3."
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "✅ Python $PYTHON_VERSION gevonden"

# Check Git
echo "📦 Checking Git..."
if ! command -v git &> /dev/null; then
    echo "📥 Git wordt geïnstalleerd..."
    sudo apt-get update
    sudo apt-get install -y git
fi
echo "✅ Git gevonden"

# Install directory
INSTALL_DIR="$HOME/ledweb"

if [ -d "$INSTALL_DIR" ]; then
    echo "📁 LedWeb directory bestaat al: $INSTALL_DIR"
    read -p "Verwijderen en opnieuw installeren? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🗑️  Oude installatie verwijderen..."
        rm -rf "$INSTALL_DIR"
    else
        echo "❌ Installatie afgebroken."
        exit 1
    fi
fi

# Clone repository
echo "📥 Repository klonen..."
git clone https://github.com/D-flnt/ledweb.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Install Python dependencies
echo "📦 Python dependencies installeren..."
if [ -f "requirements.txt" ]; then
    pip3 install --user -r requirements.txt
else
    echo "⚠️  requirements.txt niet gevonden, handmatig installeren:"
    echo "   pip3 install flask flask-cors python-dotenv"
fi

# Create .env file if not exists
if [ ! -f ".env" ]; then
    echo "🔒 .env bestand aanmaken..."
    cat > .env << 'EOF'
# LedWeb Configuration
LED_PASSWORD=ledweb123
LED_COUNT=300
LED_PIN=18
LED_FREQ_HZ=800000
LED_DMA=10
LED_BRIGHTNESS=255
LED_INVERT=False
LED_CHANNEL=0
EOF
    echo "✅ .env aangemaakt met standaard instellingen"
    echo "   Pas LED_PASSWORD aan naar je eigen wachtwoord!"
else
    echo "✅ .env bestand bestaat al"
fi

# Create systemd service (optional)
read -p "🚀 Wil je LedWeb automatisch opstarten bij boot? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/ledweb.service"
    echo "📝 Systemd service aanmaken..."
    
    sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=LedWeb LED Controller
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/python3 $INSTALL_DIR/server.py
Restart=always
RestartSec=10
Environment="PYTHONUNBUFFERED=1"

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable ledweb.service
    echo "✅ Systemd service geïnstalleerd"
    echo "   Start met: sudo systemctl start ledweb"
    echo "   Status check: sudo systemctl status ledweb"
    echo "   Logs bekijken: sudo journalctl -u ledweb -f"
fi

# Get IP address
IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "✨ Installatie voltooid!"
echo "========================"
echo ""
echo "📁 Installatie directory: $INSTALL_DIR"
echo "🔧 Configuratie: $INSTALL_DIR/.env"
echo ""
echo "🚀 Starten:"
echo "   cd $INSTALL_DIR"
echo "   python3 server.py"
echo ""
echo "🌐 Open in browser:"
echo "   V2 Interface: http://$IP_ADDR:5000/frontend/index_v2.html"
echo "   V1 Interface: http://$IP_ADDR:5000/frontend/index.html"
echo ""
echo "🔑 Standaard wachtwoord: ledweb123"
echo "   Wijzig dit in .env voor productie gebruik!"
echo ""

read -p "🎉 Wil je LedWeb nu starten? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 LedWeb starten..."
    cd "$INSTALL_DIR"
    python3 server.py
else
    echo "👋 Start later met: cd $INSTALL_DIR && python3 server.py"
fi
