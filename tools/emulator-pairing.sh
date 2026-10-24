#!/bin/bash
# Makes the phone pairing reachable from a real phone while the app runs in the emulator.
# The emulator is behind NAT, so the computer forwards its LAN port 8765 into it and the app
# advertises the computer's address in the QR code. Phone and computer must be in the same Wi-Fi.
#
#   tools/emulator-pairing.sh          start (keeps running, Ctrl+C stops it)
set -euo pipefail

PORT=8765
ADB_PORT=18765   # adb only listens on localhost, so socat bridges the LAN port to it
HOST_IP="${1:-$(ip route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')}"

adb forward tcp:$ADB_PORT tcp:$PORT >/dev/null
adb shell settings put global drivedeck_host "$HOST_IP"
trap 'adb shell settings delete global drivedeck_host >/dev/null; adb forward --remove tcp:'$ADB_PORT' >/dev/null' EXIT
echo "QR code now points to http://$HOST_IP:$PORT (open the pairing screen in the app again)"
socat TCP-LISTEN:$PORT,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:$ADB_PORT
