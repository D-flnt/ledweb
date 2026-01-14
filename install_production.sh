#!/usr/bin/env bash
#
# LedWeb Production Installer
# Waterdichte installatie met validatie, error handling en diagnostics
#

set -euo pipefail

# Colors voor output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuratie
BASE_DIR="/home/pi/ledweb"
VENV_DIR="/home/pi/.venv"
SERVICE_NAME="piled.service"
LOG_FILE="/var/log/ledweb-install.log"

# Functies
log() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "Dit script moet als root worden uitgevoerd. Gebruik: sudo bash $0"
    fi
}

check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check OS
    if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
        warn "Dit lijkt geen Raspberry Pi te zijn. Script kan falen."
    fi
    
    # Check internet
    if ! ping -c 1 8.8.8.8 &>/dev/null; then
        error "Geen internetverbinding. Check je netwerk."
    fi
    
    # Check disk space (minimaal 500MB vrij)
    FREE_SPACE=$(df -m / | awk 'NR==2 {print $4}')
    if [[ $FREE_SPACE -lt 500 ]]; then
        error "Onvoldoende schijfruimte: ${FREE_SPACE}MB vrij. Minimaal 500MB nodig."
    fi
    
    log "✓ Prerequisites OK"
}

install_system_packages() {
    log "Installing system packages..."
    
    apt update || error "apt update failed"
    
    # Essentiële packages
    local PACKAGES=(
        python3
        python3-venv
        python3-pip
        python3-dev
        git
        libffi-dev
        build-essential
        avahi-daemon
        libnss-mdns
        jq
        curl
    )
    
    # Audio packages
    PACKAGES+=(
        libportaudio2
        portaudio19-dev
        libasound2-dev
    )
    
    # NumPy dependencies (verschillende namen per distro)
    if apt-cache search libatlas-base-dev | grep -q libatlas-base-dev; then
        PACKAGES+=(libatlas-base-dev)
    elif apt-cache search libatlas3-base | grep -q libatlas3-base; then
        PACKAGES+=(libatlas3-base)
    fi
    
    apt install -y "${PACKAGES[@]}" || error "Package installation failed"
    
    log "✓ System packages installed"
}

setup_repository() {
    log "Setting up repository..."
    
    if [[ ! -d "$BASE_DIR" ]]; then
        log "Cloning repository..."
        git clone https://github.com/D-flnt/ledweb.git "$BASE_DIR" || error "Git clone failed"
    else
        log "Repository exists, pulling latest changes..."
        cd "$BASE_DIR"
        git fetch origin
        git reset --hard origin/main || warn "Git reset failed, continuing..."
    fi
    
    cd "$BASE_DIR"
    chown -R pi:pi "$BASE_DIR"
    
    log "✓ Repository ready"
}

setup_python_venv() {
    log "Setting up Python virtual environment..."
    
    # Remove old venv if exists
    if [[ -d "$VENV_DIR" ]]; then
        warn "Removing old virtual environment..."
        rm -rf "$VENV_DIR"
    fi
    
    # Create new venv as pi user
    sudo -u pi python3 -m venv "$VENV_DIR" || error "venv creation failed"
    
    # Upgrade pip
    sudo -u pi "$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel || error "pip upgrade failed"
    
    log "✓ Virtual environment created"
}

install_python_dependencies() {
    log "Installing Python dependencies..."
    
    cd "$BASE_DIR"
    
    # Install requirements
    sudo -u pi "$VENV_DIR/bin/pip" install -r requirements.txt || error "pip install failed"
    
    # Verify critical packages
    local CRITICAL_PACKAGES=("fastapi" "uvicorn" "numpy" "rpi_ws281x")
    for pkg in "${CRITICAL_PACKAGES[@]}"; do
        if ! sudo -u pi "$VENV_DIR/bin/pip" list | grep -qi "$pkg"; then
            error "Critical package $pkg not installed"
        fi
    done
    
    log "✓ Python dependencies installed"
}

validate_config_files() {
    log "Validating configuration files..."
    
    local CONFIG_DIR="$BASE_DIR/config"
    local REQUIRED_CONFIGS=("hardware.json" "ui.json" "presets.json" "zones.json" "alarms.json")
    
    for config in "${REQUIRED_CONFIGS[@]}"; do
        local CONFIG_FILE="$CONFIG_DIR/$config"
        if [[ ! -f "$CONFIG_FILE" ]]; then
            error "Missing config file: $config"
        fi
        
        # Validate JSON syntax
        if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
            error "Invalid JSON in $config"
        fi
    done
    
    # Validate hardware config
    local LED_COUNT=$(jq -r '.led_count' "$CONFIG_DIR/hardware.json")
    local GPIO_PIN=$(jq -r '.gpio_pin' "$CONFIG_DIR/hardware.json")
    
    if [[ -z "$LED_COUNT" || "$LED_COUNT" -le 0 ]]; then
        error "Invalid led_count in hardware.json"
    fi
    
    if [[ -z "$GPIO_PIN" ]]; then
        error "Invalid gpio_pin in hardware.json"
    fi
    
    log "✓ Configuration files validated"
}

setup_systemd_service() {
    log "Setting up systemd service..."
    
    local SERVICE_SRC="$BASE_DIR/systemd/$SERVICE_NAME"
    local SERVICE_DEST="/etc/systemd/system/$SERVICE_NAME"
    
    if [[ ! -f "$SERVICE_SRC" ]]; then
        error "Service file not found: $SERVICE_SRC"
    fi
    
    # Copy service file
    cp "$SERVICE_SRC" "$SERVICE_DEST"
    
    # Reload systemd
    systemctl daemon-reload
    
    # Enable service
    systemctl enable "$SERVICE_NAME" || error "Failed to enable service"
    
    log "✓ Systemd service configured"
}

configure_mdns() {
    log "Configuring mDNS..."
    
    # Start and enable avahi
    systemctl enable avahi-daemon
    systemctl restart avahi-daemon
    
    # Get hostname
    local HOSTNAME=$(hostname)
    log "✓ mDNS configured - Access via: http://${HOSTNAME}.local:8080/frontend/"
}

run_hardware_test() {
    log "Running hardware test..."
    
    cd "$BASE_DIR"
    
    if [[ -f "led_test.py" ]]; then
        log "Testing LED strip (running for 5 seconds)..."
        timeout 5 sudo "$VENV_DIR/bin/python" led_test.py || warn "LED test completed/failed - check if LEDs lit up"
    else
        warn "led_test.py not found, skipping hardware test"
    fi
}

create_health_check_script() {
    log "Creating health check script..."
    
    cat > /usr/local/bin/ledweb-health <<'EOF'
#!/usr/bin/env bash
# LedWeb Health Check Script

SERVICE="piled.service"
PORT=8080

echo "=== LedWeb Health Check ==="
echo

# Check service status
echo "[1] Service Status:"
systemctl is-active --quiet "$SERVICE" && echo "✓ Service is running" || echo "✗ Service is NOT running"
echo

# Check port
echo "[2] Port $PORT:"
ss -tuln | grep -q ":$PORT " && echo "✓ Port $PORT is listening" || echo "✗ Port $PORT is NOT listening"
echo

# Check process
echo "[3] Python Process:"
pgrep -f "uvicorn backend.main:app" >/dev/null && echo "✓ uvicorn process found" || echo "✗ uvicorn process NOT found"
echo

# Check logs
echo "[4] Recent Logs:"
journalctl -u "$SERVICE" -n 5 --no-pager
echo

# Check endpoint
echo "[5] HTTP Endpoint:"
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/status" | grep -q "401"; then
    echo "✓ API is responding (auth required)"
elif curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT" | grep -q "200"; then
    echo "✓ Frontend is accessible"
else
    echo "✗ HTTP endpoint not responding"
fi
echo

echo "Run 'sudo journalctl -u $SERVICE -f' for live logs"
EOF

    chmod +x /usr/local/bin/ledweb-health
    log "✓ Health check created: ledweb-health"
}

create_quick_fix_script() {
    log "Creating quick-fix script..."
    
    cat > /usr/local/bin/ledweb-fix <<'EOF'
#!/usr/bin/env bash
# LedWeb Quick Fix Script

SERVICE="piled.service"
VENV="/home/pi/.venv"
BASE="/home/pi/ledweb"

echo "=== LedWeb Quick Fix ==="
echo

echo "[1] Stopping service..."
systemctl stop "$SERVICE"

echo "[2] Checking permissions..."
chown -R pi:pi "$BASE"
chown -R pi:pi "$VENV"

echo "[3] Validating config files..."
for f in "$BASE"/config/*.json; do
    if ! jq empty "$f" 2>/dev/null; then
        echo "✗ Invalid JSON: $f"
    fi
done

echo "[4] Restarting service..."
systemctl restart "$SERVICE"

sleep 2

echo "[5] Checking status..."
systemctl status "$SERVICE" --no-pager

echo
echo "Run 'ledweb-health' for full diagnostics"
EOF

    chmod +x /usr/local/bin/ledweb-fix
    log "✓ Quick fix created: ledweb-fix"
}

start_service() {
    log "Starting LedWeb service..."
    
    # Stop if running
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    
    # Start service
    systemctl start "$SERVICE_NAME" || error "Failed to start service"
    
    # Wait for startup
    sleep 3
    
    # Check status
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log "✓ Service started successfully"
    else
        error "Service failed to start. Check: journalctl -u $SERVICE_NAME"
    fi
}

print_summary() {
    local HOSTNAME=$(hostname)
    
    echo
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}   LedWeb Installation Complete! ✓${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo
    echo -e "${BLUE}Access URLs:${NC}"
    echo "  • http://localhost:8080/frontend/"
    echo "  • http://${HOSTNAME}.local:8080/frontend/"
    echo "  • http://$(hostname -I | awk '{print $1}'):8080/frontend/"
    echo
    echo -e "${BLUE}Useful Commands:${NC}"
    echo "  • systemctl status $SERVICE_NAME    # Check status"
    echo "  • journalctl -u $SERVICE_NAME -f    # Live logs"
    echo "  • ledweb-health                     # Health check"
    echo "  • ledweb-fix                        # Quick fix"
    echo
    echo -e "${BLUE}Config Files:${NC}"
    echo "  • $BASE_DIR/config/hardware.json    # LED settings"
    echo "  • $BASE_DIR/config/ui.json          # UI settings"
    echo "  • $BASE_DIR/config/presets.json     # Presets"
    echo
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Edit config/hardware.json with your LED count & GPIO pin"
    echo "  2. Restart: sudo systemctl restart $SERVICE_NAME"
    echo "  3. Check health: ledweb-health"
    echo
}

# Main Installation Flow
main() {
    log "Starting LedWeb installation..."
    echo "Logfile: $LOG_FILE"
    
    check_root
    check_prerequisites
    install_system_packages
    setup_repository
    setup_python_venv
    install_python_dependencies
    validate_config_files
    setup_systemd_service
    configure_mdns
    create_health_check_script
    create_quick_fix_script
    
    # Optional hardware test
    read -p "Run LED hardware test? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        run_hardware_test
    fi
    
    start_service
    print_summary
}

# Run installation
main "$@"
