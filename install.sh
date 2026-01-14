#!/bin/bash
# LedWeb Installer voor Raspberry Pi - Fixed voor Python 3.13+
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
    sudo apt-get update -qq
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

# Install Python dependencies - FIXED for Python 3.13+
echo "📦 Python dependencies installeren..."

# Try system packages first (fastest & most reliable)
echo "   Methode 1: System packages via apt (snelst)..."
sudo apt-get update -qq
if sudo apt-get install -y python3-flask python3-flask-cors python3-dotenv 2>/dev/null; then
    echo "   ✅ Dependencies geïnstalleerd via apt"
    USE_VENV=false
else
    echo "   ⚠️  System packages niet beschikbaar, probeer virtual environment..."
    
    # Install venv tools
    sudo apt-get install -y python3-venv python3-full 2>/dev/null || true
    
    # Create virtual environment
    echo "   Methode 2: Virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    
    # Install in venv
    pip install --upgrade pip setuptools wheel
    
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt
    else
        pip install flask flask-cors python-dotenv
    fi
    
    echo "   ✅ Dependencies geïnstalleerd in virtual environment"
    USE_VENV=true
fi

# Verify installation
echo "🔍 Verificatie..."
if [ "$USE_VENV" = true ]; then
    source venv/bin/activate
fi

if python3 -c "import flask; import flask_cors" 2>/dev/null; then
    echo "   ✅ Flask modules OK"
else
    echo "   ❌ Flask modules niet gevonden"
    echo "   Probeer handmatig: pip3 install --break-system-packages flask flask-cors python-dotenv"
    exit 1
fi

# Create .env file if not exists
if [ ! -f ".env" ]; then
    echo "🔐 .env bestand aanmaken..."
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
DEBUG=False
EOF
    echo "✅ .env aangemaakt met standaard instellingen"
    echo "   ⚠️  Pas LED_PASSWORD aan naar je eigen wachtwoord!"
else
    echo "✅ .env bestand bestaat al"
fi

# Create systemd service (optional)
read -p "🚀 Wil je LedWeb automatisch opstarten bij boot? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/ledweb.service"
    echo "📝 Systemd service aanmaken..."
    
    if [ "$USE_VENV" = true ]; then
        # Service for virtual environment
        sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=LedWeb LED Controller
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/venv/bin/python $INSTALL_DIR/server.py
Restart=always
RestartSec=10
Environment="PYTHONUNBUFFERED=1"

[Install]
WantedBy=multi-user.target
EOF
    else
        # Service for system packages
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
    fi

    sudo systemctl daemon-reload
    sudo systemctl enable ledweb.service
    echo "✅ Systemd service geïnstalleerd"
    echo "   Start met: sudo systemctl start ledweb"
    echo "   Status check: sudo systemctl status ledweb"
    echo "   Logs bekijken: sudo journalctl -u ledweb -f"
fi

# Get IP address
IP_ADDR=$(hostname -I | awk '{print $1}')

# Create convenient start script
cat > start.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
if [ -d "venv" ]; then
    source venv/bin/activate
fi
python3 server.py
EOF
chmod +x start.sh

echo ""
echo "✨ Installatie voltooid!"
echo "========================"
echo ""
echo "📁 Installatie directory: $INSTALL_DIR"
echo "🔧 Configuratie: $INSTALL_DIR/.env"
if [ "$USE_VENV" = true ]; then
    echo "🐍 Virtual environment: $INSTALL_DIR/venv"
fi
echo ""
echo "🚀 Starten:"
echo "   cd $INSTALL_DIR"
if [ "$USE_VENV" = true ]; then
    echo "   ./start.sh"
    echo "   # of handmatig:"
    echo "   source venv/bin/activate && python3 server.py"
else
    echo "   python3 server.py"
    echo "   # of:"
    echo "   ./start.sh"
fi
echo ""
echo "🌐 Open in browser:"
echo "   V2 Interface: http://$IP_ADDR:5000/frontend/index_v2.html"
echo "   V1 Interface: http://$IP_ADDR:5000/frontend/index.html"
echo ""
echo "🔑 Standaard wachtwoord: ledweb123"
echo "   ⚠️  Wijzig dit in .env voor productie gebruik!"
echo ""

read -p "🎉 Wil je LedWeb nu starten? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 LedWeb starten..."
    cd "$INSTALL_DIR"
    ./start.sh
else
    echo "👋 Start later met: cd $INSTALL_DIR && ./start.sh"
fi
