# DriveDeck

**English** · [Deutsch](README.de.md) · [Türkçe](README.tr.md) · [中文](README.zh.md)

A Tesla-style cockpit UI for the Carlinkit CPC200 T-Box (Android 13, Snapdragon 665, 1816×720 display).
The app is an Android WebView; the whole interface is HTML/JS, with three.js for the 3D car and
Leaflet for the map.

![Home screen](docs/img/home.png)

## Features

- **3D car** with a drive view: the wheels turn with the GPS speed, the road flows past, scissor doors open
  by tap while parked. Several car types and paint colours. The scene is static while nothing moves and is
  only drawn when something changes, so it costs no GPU time when the car is parked.
- **Eco mode** (default): 30 FPS cap, no anti-aliasing, smaller render buffer. Can be switched off in the settings.
- **Navigation** built on open data: search (Photon / OpenStreetMap), routing (OSRM), turn-by-turn voice
  guidance, automatic re-routing, saved places, nearby search along the route, speed-limit sign, weather.
- **Dock** like in a Tesla: big icons with captions, the Apps button sits next to the shortcuts. Long press an
  app to pin it to the dock or remove it.
- **Assistant**: an LLM (via OpenRouter) that operates a built-in browser: it searches, reads, clicks, types,
  starts navigation, keeps notes and timers, plays music and video. Three layouts: window, split, cinema.
  Speech input and output in German, Turkish and English. Passwords are typed into pages by the app and never
  reach the model.
- **Phone pairing**: the box shows a QR code, the phone opens a page served by the box and sends the API key,
  logins, destinations and links. Everything is end-to-end encrypted (AES-GCM) and stored with an Android Keystore key.
- **Virtual mouse** driven by the arrow keys of the car (see below).
- Notes, OBD dashboard (ELM327 over Bluetooth), 2048, Snake, Karaoke, Paint.
- **Intro tour** on first start (German, Turkish, English), arrow keys and the centre key work too. Reopen it under Apps → Einstellungen → Einführung.
- Driving lock (optional, on by default; switch it off under Apps → Einstellungen → Fahrsperre): above 5 km/h browser, games and text input are locked, only voice remains.

![Driving](docs/img/driving.gif)

## Virtual mouse

Turn it on under **Apps → Einstellungen → Maus**, or hold the centre key of the car's direction pad for about
a second. The keys arrive in the page as normal arrow and Enter keys.

| Key | Action |
|---|---|
| Arrow keys | Move the pointer. One press moves a little, holding speeds it up |
| Centre, short | Click |
| Centre, hold | Hold the button down (drag, pans the map) |
| Centre, twice quickly | Switch to scrolling: up and down scroll the list under the pointer |

While a text field has focus, the keys behave normally. Clicks and scrolling also work inside the assistant's browser.

![Virtual mouse](docs/img/mouse.gif)

![Apps and settings](docs/img/apps.png)

## Download and install

Signed APKs are published under **Releases**. A new release is created by pushing a tag such as `v1.2`
(`git tag v1.2 && git push origin v1.2`); GitHub Actions builds the APK. All builds are signed with the same key
(`app/release.keystore`), so a new APK installs over the old one without losing data. On the box: download the APK in
the browser, tap it and allow "install unknown apps". USB debugging is not needed.

## Build

Requirements: JDK 17+, Android SDK (platform 34).

```bash
echo "sdk.dir=$HOME/Android/Sdk" > local.properties
./gradlew assembleDebug        # or assembleRelease for the signed APK
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Debug the interface on the box with `chrome://inspect`.

## Emulator and drive simulator

```bash
tools/emulator.sh          # realistic mode, builds, installs and starts the app
node tools/drive.mjs       # real OSRM route as GPS into the emulator
tools/emulator-pairing.sh  # makes the pairing page reachable from a phone on the LAN
```

The AVD `tbox` mimics display, RAM and Android version of the box. The GPU cannot be copied exactly:
what runs at 30 FPS in the emulator runs smoothly on the box.

## Layout

```
app/src/main/java/.../MainActivity.java   WebView, asset server, bridge window.TBox (volume, TTS, browser, LLM, speech)
app/src/main/java/.../PairingServer.java  pairing server, encrypted exchange with the phone
app/src/main/java/.../SecretStore.java    secrets encrypted with an Android Keystore key
app/src/main/assets/web/
  app.js, car3d.js, nav.js, apps.js       core, 3D scene, navigation, launcher and dock
  mouse.js                                virtual mouse
  browser.js, apps/assistant.js           assistant and its browser
  weather.js, speedlimit.js, reminders.js, media.js, inbox.js
```

## Performance rules for the box

- The HDRI reflection is the most expensive part: only reflective materials get it.
- Clearcoat and specular create `MeshPhysicalMaterial`, which is converted to standard PBR on load.
- Keep models under ~110k triangles and few objects (draw calls).

## Status

Tested in the emulator: UI, navigation, pairing, notes, timers, layouts, virtual mouse. Not yet tested on real
hardware: speech recognition (needs the Google speech service), OBD, the speed-limit sign and nearby search
(depends on the public Overpass servers).

## Licenses and sources

- Free Concept Car 011 (Sketchfab, CC0), Car Kit by Kenney (CC0), studio HDRI by Poly Haven (CC0)
- three.js (MIT), Leaflet (BSD-2), meshoptimizer (MIT)
- Map tiles: Esri World Dark Gray. Search: Photon / OpenStreetMap. Routes: OSRM demo server, for private use only.
