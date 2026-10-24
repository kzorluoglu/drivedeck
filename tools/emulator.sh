#!/bin/bash
# Starts the "tbox" emulator (T-Box CPC200 profile), installs the app and launches it.
#
#   tools/emulator.sh          realistic mode: software GPU (SwiftShader)
#   tools/emulator.sh fast     host GPU, for quick functional checks
#
# The emulator cannot reproduce the Snapdragon 665 / Adreno 610 exactly. Measured against the real
# box, the realistic mode matches it on light scenes (Kenney car: 30 vs 29 FPS) and is about half as
# fast on heavy 3D (Concept 011: 16 vs 30 FPS). Whatever reaches 30 FPS here is smooth on the box.
set -euo pipefail

MODE="${1:-tbox}"
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
EMULATOR="$ANDROID_SDK_ROOT/emulator/emulator"
SERIAL=emulator-5554
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/app/build/outputs/apk/debug/app-debug.apk"

if ! adb devices | grep -q "^$SERIAL"; then
  ARGS=(-avd tbox -no-snapshot-save -no-boot-anim -netfast)
  if [ "$MODE" = "fast" ]; then
    "$EMULATOR" "${ARGS[@]}" -gpu host >/tmp/tbox-emulator.log 2>&1 &
  else
    "$EMULATOR" "${ARGS[@]}" -gpu swiftshader_indirect >/tmp/tbox-emulator.log 2>&1 &
  fi
  echo "booting emulator ($MODE) ..."
  adb -s "$SERIAL" wait-for-device
  until [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi

(cd "$ROOT" && ./gradlew assembleDebug -q)
adb -s "$SERIAL" install -r "$APK" >/dev/null
adb -s "$SERIAL" shell pm grant com.koray.tboxtesla android.permission.ACCESS_FINE_LOCATION
adb -s "$SERIAL" shell am start -S -n com.koray.tboxtesla/.MainActivity >/dev/null
echo "app running on $SERIAL"
