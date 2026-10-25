#!/bin/bash
# Desktop Head Unit als "Auto" für die Box: Box per USB anstecken, ihr Bildschirm erscheint im Fenster.
# DHU beendet sich, wenn kein Gerät da ist, daher die Schleife.
# Nicht mit sudo und nicht im VS-Code-Terminal starten (schwarzes Fenster, "VS Code reagiert nicht").
# USB-Zugriff ohne root: Udev-Regel, siehe docs/hardware/box-usb-access.md
export PATH="$PATH:$HOME/Android/Sdk/platform-tools"
export SDL_VIDEODRIVER=x11
adb kill-server 2>/dev/null
cd "$HOME/Android/Sdk/extras/google/auto" || exit 1
chmod +x ./desktop-head-unit
while true; do
  ./desktop-head-unit --usb -c config/default_720p.ini 2>&1 | tee -a "$HOME/Android/dhu.log"
  sleep 1
done
