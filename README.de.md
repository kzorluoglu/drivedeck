# DriveDeck

[English](README.md) · **Deutsch** · [Türkçe](README.tr.md) · [中文](README.zh.md)

Cockpit-Oberfläche im Stil des Tesla-UI für die Carlinkit CPC200 T-Box (Android 13, Snapdragon 665,
Display 1816×720). Die App ist eine Android-WebView, die gesamte Oberfläche ist HTML/JS mit three.js für
das 3D-Auto und Leaflet für die Karte.

![Startbildschirm](docs/img/home.png)

## Funktionen

- **3D-Fahrzeug** mit Fahransicht: Die Räder drehen sich mit der GPS-Geschwindigkeit, die Straße zieht vorbei,
  Scissor-Türen öffnen per Tipp im Stand. Mehrere Fahrzeugtypen und Lackfarben. Solange sich nichts bewegt,
  steht die Szene still und wird nur bei Änderungen gezeichnet, im Stand kostet sie also keine GPU-Zeit.
- **Sparmodus** (Standard): 30 FPS, keine Kantenglättung, kleinerer Render-Puffer. In den Einstellungen abschaltbar.
- **Navigation** auf offenen Daten: Suche (Photon / OpenStreetMap), Route (OSRM), Sprachausgabe der
  Abbiegehinweise, automatisches Neuberechnen, gespeicherte Orte, Suche in der Nähe und entlang der Route,
  Tempolimit-Schild, Wetter.
- **Dock** wie im Tesla: große Symbole mit Beschriftung, der Apps-Knopf steht direkt neben den Kurzbefehlen.
  Langer Druck auf eine App legt sie ins Dock oder nimmt sie heraus.
- **Assistent**: Eine KI (über OpenRouter) bedient einen eingebauten Browser: suchen, lesen, klicken, tippen,
  Navigation starten, Notizen und Timer, Musik und Video. Drei Layouts: Fenster, Halb, Voll (Kino).
  Spracheingabe und -ausgabe auf Deutsch, Türkisch und Englisch. Passwörter trägt die App selbst in Seiten ein,
  das Modell sieht sie nie.
- **Handy-Kopplung**: Die Box zeigt einen QR-Code, das Handy öffnet eine von der Box ausgelieferte Seite und sendet
  API-Schlüssel, Anmeldungen, Ziele und Links. Alles ist Ende-zu-Ende verschlüsselt (AES-GCM) und wird mit einem
  Android-Keystore-Schlüssel gespeichert.
- **Virtuelle Maus**, gesteuert mit den Pfeiltasten des Autos (siehe unten).
- Notizen, OBD-Anzeige (ELM327 über Bluetooth), 2048, Snake, Karaoke, Malen.
- Fahrsperre: Über 5 km/h sind Browser, Spiele und Texteingabe gesperrt, nur Sprache bleibt.

![Fahrt](docs/img/driving.gif)

## Virtuelle Maus

Einschalten unter **Apps → Einstellungen → Maus** oder die Mitteltaste des Steuerkreuzes etwa eine Sekunde
gedrückt halten. Die Tasten kommen als normale Pfeil- und Enter-Tasten in der Seite an.

| Taste | Aktion |
|---|---|
| Pfeiltasten | Zeiger bewegen. Ein Druck bewegt ein Stück, Halten beschleunigt |
| Mitte, kurz | Klick |
| Mitte, halten | Taste gedrückt halten (Ziehen, verschiebt die Karte) |
| Mitte, zweimal schnell | Auf Scrollen umschalten: hoch und runter scrollen die Liste unter dem Zeiger |

Hat ein Textfeld den Fokus, verhalten sich die Tasten normal. Klicks und Scrollen funktionieren auch im Browser des Assistenten.

![Virtuelle Maus](docs/img/mouse.gif)

![Apps und Einstellungen](docs/img/apps.png)

## APK herunterladen und installieren

Fertige APKs liegen unter **Releases**. Ein neuer Release entsteht, wenn man einen Tag wie `v1.2` pusht
(`git tag v1.2 && git push origin v1.2`), GitHub Actions baut dann die APK. Alle Builds sind mit demselben
Schlüssel (`app/release.keystore`) signiert, eine neue APK lässt sich also über die alte installieren, ohne Daten
zu verlieren. Auf der Box: APK im Browser laden, antippen, "Unbekannte Apps installieren" erlauben.
USB-Debugging ist dafür nicht nötig.

## Bauen

Voraussetzungen: JDK 17+, Android SDK (Plattform 34).

```bash
echo "sdk.dir=$HOME/Android/Sdk" > local.properties
./gradlew assembleDebug        # oder assembleRelease für die signierte APK
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Die Oberfläche auf der Box lässt sich mit `chrome://inspect` debuggen.

## Emulator und Fahrsimulator

```bash
tools/emulator.sh          # realistischer Modus, baut, installiert und startet die App
node tools/drive.mjs       # echte OSRM-Route als GPS in den Emulator
tools/emulator-pairing.sh  # macht die Kopplungsseite für ein Handy im WLAN erreichbar
```

Das AVD `tbox` bildet Display, RAM und Android-Version der Box nach. Die GPU lässt sich nicht exakt nachbilden:
Was im Emulator 30 FPS schafft, läuft auf der Box flüssig.

## Aufbau

```
app/src/main/java/.../MainActivity.java   WebView, Asset-Server, Bridge window.TBox (Lautstärke, TTS, Browser, KI, Sprache)
app/src/main/java/.../PairingServer.java  Kopplungsserver, verschlüsselter Austausch mit dem Handy
app/src/main/java/.../SecretStore.java    Geheimnisse, verschlüsselt mit einem Android-Keystore-Schlüssel
app/src/main/assets/web/
  app.js, car3d.js, nav.js, apps.js       Kern, 3D-Szene, Navigation, App-Starter und Dock
  mouse.js                                virtuelle Maus
  browser.js, apps/assistant.js           Assistent und sein Browser
  weather.js, speedlimit.js, reminders.js, media.js, inbox.js
```

## Performance-Regeln für die Box

- Die HDRI-Reflexion ist der teuerste Teil: Nur spiegelnde Materialien bekommen sie.
- Clearcoat und Specular erzeugen `MeshPhysicalMaterial`, das wird beim Laden auf Standard-PBR umgestellt.
- Modelle unter ~110k Dreiecke und mit wenigen Objekten (Draw Calls) halten.

## Stand

Im Emulator getestet: Oberfläche, Navigation, Kopplung, Notizen, Timer, Layouts, virtuelle Maus. Noch nicht auf
echter Hardware getestet: Spracherkennung (braucht den Google-Sprachdienst), OBD, Tempolimit-Schild und Suche in
der Nähe (hängt von den öffentlichen Overpass-Servern ab).

## Lizenzen und Quellen

- Free Concept Car 011 (Sketchfab, CC0), Car Kit von Kenney (CC0), Studio-HDRI von Poly Haven (CC0)
- three.js (MIT), Leaflet (BSD-2), meshoptimizer (MIT)
- Kartenkacheln: Esri World Dark Gray. Suche: Photon / OpenStreetMap. Routen: OSRM-Demoserver, nur für private Nutzung.
