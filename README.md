# DriveDeck

Cockpit-Oberfläche im Stil des Tesla-UI für die Carlinkit CPC200 T-Box (Android 13,
Snapdragon 665, 1920×720 Display). Die App ist eine Android-WebView, die gesamte Oberfläche ist
HTML/JS mit three.js für die 3D-Ansicht und Leaflet für die Karte.

## Funktionen

- 3D-Fahrzeug mit Fahransicht: Kamera kreist im Stand, wechselt beim Fahren hinter das Auto.
  Räder drehen sich mit der GPS-Geschwindigkeit, Türen (Scissor) öffnen per Tipp im Stand.
- Fahrzeugtypen: Concept 011 (Standard), eigenes Blender-Concept, Kenney-Modelle. Lackfarbe wählbar.
- Geschwindigkeit, Kurs, Höhe aus GPS. P/D zeigt nur Stand oder Fahrt, ohne OBD gibt es keinen echten Gang.
- Navigation komplett Open Source: Suche über Photon (OpenStreetMap), Route über OSRM,
  Abbiegehinweise auf Deutsch, automatisches Neuberechnen, Sprachausgabe über Google TTS.
- Eigene Bildschirmtastatur (DE/TR), weil die Android-Tastatur bei 720 px Höhe das Layout zerdrückt.
- App-Starter nur mit den eigenen Web-Apps (Assistent, Notizen, Malen, 2048, Snake, Karaoke), keine
  installierten Android-Apps. Kurzbefehle im Dock per langem Druck.
- Assistent: KI über OpenRouter, die einen eingebauten Browser bedient (öffnen, lesen, klicken, tippen).
  Schlüssel und Anmeldungen kommen per QR-Code vom Handy (siehe unten), nur im Stand nutzbar.
- Video, Spiele und Malen sind während der Fahrt (über 5 km/h) gesperrt.
- FPS-Anzeige. Ziel ist eine stabile 30 FPS, das Display der Box läuft mit 30 Hz.

## Aufbau

```
app/src/main/java/.../MainActivity.java   WebView, Asset-Server (https://appassets.androidplatform.net),
                                           Bridge window.TBox: Lautstärke, App-Liste, Apps starten, TTS
app/src/main/assets/web/
  index.html, style.css                    Layout für 1816×720 (App-Fläche neben der Box-Leiste)
  app.js                                   Kern: GPS, Geschwindigkeit, Karte, Dock, Fahrzeug-Menü, FPS
  car3d.js                                 three.js-Szene, Modelle, Räder, Türen, Lack, Reflexionen
  nav.js                                   Suche, Route, Abbiegehinweise, Neuberechnung, Sprachausgabe
  keyboard.js                              Bildschirmtastatur
  apps.js, apps/*.js                       App-Starter, Dock-Kurzbefehle, Web-Apps
  models/, env/, lib/                      3D-Modelle, HDRI, three.js r128, Leaflet 1.9.4
tools/
  emulator.sh                              Emulator mit T-Box-Profil starten, App bauen und starten
  drive.mjs                                Fahrsimulator: echte OSRM-Route als GPS in den Emulator
  model-pipeline/                          Blender- und gltf-transform-Skripte für Concept 011
```

## APK herunterladen und installieren

Fertige APKs liegen unter **Releases** des GitHub-Repos. Ein neuer Release entsteht, wenn man einen Tag
wie `v1.1` pusht (`git tag v1.2 && git push origin v1.2`), GitHub Actions baut dann die signierte APK.
Alle Builds sind mit demselben Schlüssel (`app/release.keystore`) signiert, eine neue APK lässt sich also
über die alte installieren, ohne Daten zu verlieren. Auf der Box: APK im Browser laden, antippen,
"Unbekannte Apps installieren" erlauben. USB-Debugging ist dafür nicht nötig.

## Bauen und installieren

Voraussetzungen (Homebrew): `openjdk@17`, `android-commandlinetools`, `android-platform-tools`.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
echo "sdk.dir=/opt/homebrew/share/android-commandlinetools" > local.properties
./gradlew assembleDebug
```

Auf die Box über WLAN-Debugging (Box und Mac im selben Netz, z. B. Handy-Hotspot):

```bash
adb pair <ip>:<pairing-port>      # einmalig, Code aus "Kabelloses Debugging"
adb connect <ip>:<port>
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Debuggen der Oberfläche auf der Box: `chrome://inspect` in Chrome auf dem Mac.

## Emulator und Fahrsimulator

```bash
tools/emulator.sh          # realistischer Modus (Software-GPU), baut, installiert und startet die App
tools/emulator.sh fast     # GPU des Macs, für schnelle Funktionstests
node tools/drive.mjs       # Testfahrt Hauingen -> Lörrach Bahnhof mit echten Straßengeschwindigkeiten
node tools/drive.mjs 47.63,7.67 47.61,7.66 --speed 1.5
```

Das AVD `tbox` bildet Display (1816×720, 240 dpi, 30 Hz), RAM (4 GB), Android 13 und Kernzahl der
Box nach. Die GPU lässt sich nicht exakt nachbilden: Bei leichten Szenen liefert der Emulator die
gleichen FPS wie die Box, bei schwerer 3D-Last etwa die Hälfte. Was im Emulator 30 FPS schafft,
läuft auf der Box flüssig.

## Assistent und Handy-Kopplung

Im Assistenten zeigt die Box einen QR-Code. Das Handy (selbes WLAN oder Hotspot) öffnet damit eine
Seite, die die Box kurz selbst ausliefert (Port 8765, Link mit Einmal-Token, 10 Minuten gültig). Dort
gibt man den OpenRouter-Schlüssel, das Modell und optional Anmeldungen (Seite, Benutzer, Passwort) ein.
Die Daten werden mit einem Android-Keystore-Schlüssel verschlüsselt gespeichert (`SecretStore`). Die
Oberfläche bekommt sie nie zurück: Die Anfragen an OpenRouter laufen über Java, und das Werkzeug `login`
trägt Benutzer und Passwort direkt in die Seite ein, ohne dass die KI sie sieht.

Grenzen: Die Übertragung ans Auto ist unverschlüsseltes HTTP im lokalen Netz. Google blockiert die
Anmeldung in eingebetteten Browsern teilweise oder verlangt 2FA am Handy.

Test im Emulator: `adb forward tcp:8765 tcp:8765`, die Pairing-URL (IP durch `localhost` ersetzen) im
Browser des Rechners öffnen.

## Performance-Regeln für die Box

Gemessen auf der echten Box, nicht geschätzt:

- Die HDRI-Reflexion ist der teuerste Teil. Sie bekommen nur spiegelnde Materialien (Lack, Glas,
  Chrom, Felgen, Licht), nie Straße, Reifen oder Innenraum.
- Clearcoat und Specular erzeugen `MeshPhysicalMaterial`, das wird beim Laden auf Standard-PBR umgestellt.
- Modelle unter ~110k Dreiecke und mit wenigen Objekten (Draw Calls) halten.
- Drehbare Teile hängen an Pivot-Empties. Meshopt-Kompression verschiebt sonst die Pivots.

## Modell-Pipeline (Concept 011)

Die Sketchfab-Datei hat ein kaputtes Tür-Rig und ~200 Einzelteile. Aufbereitung:

```bash
cd tools/model-pipeline && npm install
/Applications/Blender.app/Contents/MacOS/Blender -b --python fix_concept011.py -- \
  <free_concept_car_011.glb> /tmp/fixed.glb /tmp/preview
node optimize.mjs /tmp/fixed.glb ../../app/src/main/assets/web/models/concept-011.glb
```

## Lizenzen und Quellen

- Free Concept Car 011, Sketchfab, CC0
- Car Kit von Kenney (www.kenney.nl), CC0
- Studio-HDRI `studio_small_08` von Poly Haven, CC0
- three.js r128 (MIT), Leaflet 1.9.4 (BSD-2), meshoptimizer (MIT)
- Kartenkacheln: Esri World Dark Gray. Suche: Photon / OpenStreetMap. Routen: OSRM-Demoserver,
  nur für private Nutzung gedacht.
