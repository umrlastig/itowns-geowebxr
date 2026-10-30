#!/data/data/com.termux/files/usr/bin/sh
# Install the STAG GNSS bridge in Termux on the Meta Quest and set up autostart.
#
# Usage (inside Termux, from this folder):
#   sh install-termux.sh tcp://127.0.0.1:<GNSS Master NMEA TCP port> [listen address]
set -e

SOURCE="$1"
LISTEN="${2:-127.0.0.1:5005}"
if [ -z "$SOURCE" ]; then
    echo "Usage: sh install-termux.sh tcp://127.0.0.1:<port> [listen host:port]"
    exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing Node.js"
pkg install -y nodejs-lts

echo "==> Installing dependencies"
cd "$DIR"
npm install --omit=dev --no-audit --no-fund

# Start script, also used by Termux:Boot (optional app) at headset boot
mkdir -p "$HOME/.termux/boot"
START="$HOME/.termux/boot/start-gnss-bridge.sh"
cat > "$START" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
# Keep the CPU awake while the headset is in immersive mode
termux-wake-lock
cd "$DIR"
exec node bridge.js --source "$SOURCE" --listen "$LISTEN" >> "\$HOME/gnss-bridge.log" 2>&1
EOF
chmod +x "$START"

echo
echo "Installed. Start it now with:"
echo "  $START &"
echo "Check it in the Quest browser: http://$LISTEN/status"
echo "With the Termux:Boot app installed and opened once, it will start at every boot."
