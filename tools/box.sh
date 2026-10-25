#!/bin/bash
# Works with the T-Box over Wi-Fi (wireless debugging), no car needed: the box only needs power from any
# USB charger and the same Wi-Fi or hotspot as this computer. Runs on macOS and Ubuntu.
#
#   tools/box.sh pair IP:PORT CODE   once per computer: "Pair device with pairing code" on the box
#   tools/box.sh connect             finds the box by mDNS and connects (after every reboot of the box)
#   tools/box.sh install             builds the release APK and installs it over the old one
#   tools/box.sh screen              shows the screen of the box in a window, mouse and keyboard work
#   tools/box.sh log                 log of DriveDeck only (Ctrl+C stops)
#   tools/box.sh restart             restarts DriveDeck
#   tools/box.sh home                makes DriveDeck the home screen of the box
#   tools/box.sh home-stock          gives the home screen back to the box (before a Carlinkit update)
#   tools/box.sh reboot              reboots the box
#
# Needs adb and scrcpy: brew install scrcpy android-platform-tools / sudo apt install adb scrcpy
# Wireless debugging has to be on (Settings > System > Developer options), the box turns it off when the
# Wi-Fi changes. BOX=ip:port overrides the mDNS lookup.
set -euo pipefail

APP=com.koray.tboxtesla
cd "$(dirname "$0")/.."

# the connected box, or the one mDNS announces
box() {
  if [ -n "${BOX:-}" ]; then
    echo "$BOX"
    return
  fi
  local found
  found=$(adb devices | awk '$2 == "device" && $1 ~ /:[0-9]+$/ {print $1; exit}')
  if [ -z "$found" ]; then
    found=$(adb mdns services | awk '/_adb-tls-connect/ {print $3; exit}')
    [ -n "$found" ] && adb connect "$found" >/dev/null
  fi
  [ -n "$found" ] || { echo "No box found: wireless debugging on, same Wi-Fi?" >&2; exit 1; }
  echo "$found"
}

case "${1:-}" in
  pair)
    adb pair "$2" "$3"
    ;;
  connect)
    S=$(box) || exit 1
    echo "Connected to $S"
    ;;
  install)
    JAVA_HOME="${JAVA_HOME:-$( [ -d /opt/homebrew/opt/openjdk@17 ] && echo /opt/homebrew/opt/openjdk@17 )}" ./gradlew -q assembleRelease
    adb -s "$(box)" install -r app/build/outputs/apk/release/app-release.apk
    ;;
  screen)
    scrcpy -s "$(box)" --window-title "T-Box" --stay-awake
    ;;
  log)
    S=$(box)
    adb -s "$S" logcat -v time --pid="$(adb -s "$S" shell pidof $APP)"
    ;;
  restart)
    S=$(box)
    adb -s "$S" shell am force-stop $APP
    adb -s "$S" shell am start -n $APP/.MainActivity
    ;;
  home)
    adb -s "$(box)" shell cmd package set-home-activity $APP/.MainActivity
    ;;
  home-stock)
    adb -s "$(box)" shell cmd package set-home-activity com.android.launcher3/.uioverrides.QuickstepLauncher
    ;;
  reboot)
    adb -s "$(box)" reboot
    ;;
  *)
    sed -n '2,20p' "$0"
    ;;
esac
