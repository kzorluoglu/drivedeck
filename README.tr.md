# DriveDeck

[English](README.md) · [Deutsch](README.de.md) · **Türkçe** · [中文](README.zh.md)

Carlinkit CPC200 T-Box (Android 13, Snapdragon 665, 1816×720 ekran) için Tesla tarzı bir kokpit arayüzü.
Uygulama bir Android WebView'dır, arayüzün tamamı HTML/JS ile yazılmıştır: 3D araç için three.js, harita için Leaflet.

![Ana ekran](docs/img/home.png)

## Özellikler

- **3D araç** ve sürüş görünümü: tekerlekler GPS hızıyla döner, yol akar, park halindeyken makas kapılar dokunuşla açılır.
  Birden çok araç tipi ve boya rengi. Hiçbir şey hareket etmezken sahne durur ve sadece bir şey değiştiğinde çizilir,
  yani araç park halindeyken GPU'yu yormaz.
- **Tasarruf modu** (varsayılan): 30 FPS sınırı, kenar yumuşatma yok, daha küçük çizim tamponu. Ayarlardan kapatılabilir.
- **Navigasyon**, açık verilerle: arama (Photon / OpenStreetMap), rota (OSRM), sesli yönlendirme, otomatik yeniden
  hesaplama, kayıtlı yerler, yakında ve rota boyunca arama, hız limiti tabelası, hava durumu.
- **Dock**, Tesla'daki gibi: altında yazı olan büyük ikonlar, Apps düğmesi kısayolların hemen yanında.
  Bir uygulamaya uzun basarak dock'a ekleyebilir veya kaldırabilirsin.
- **Asistan**: OpenRouter üzerinden çalışan bir yapay zekâ, yerleşik bir tarayıcıyı kullanır: arar, okur, tıklar, yazar,
  navigasyon başlatır, not ve zamanlayıcı tutar, müzik ve video açar. Üç düzen: pencere, yarım, tam (sinema).
  Almanca, Türkçe ve İngilizce sesli giriş ve çıkış. Şifreleri uygulama kendisi sayfaya yazar, model hiç görmez.
- **Telefonla eşleştirme**: Kutu bir QR kodu gösterir, telefon kutunun sunduğu bir sayfayı açar ve API anahtarını,
  girişleri, hedefleri ve bağlantıları gönderir. Her şey uçtan uca şifrelidir (AES-GCM) ve Android Keystore anahtarıyla saklanır.
- Arabanın yön tuşlarıyla kullanılan **sanal fare** (aşağıya bak).
- Notlar, OBD göstergesi (Bluetooth üzerinden ELM327), 2048, Snake, Karaoke, Çizim.
- İlk açılışta **tanıtım turu** (Almanca, Türkçe, İngilizce), ok tuşları ve orta tuşla da kullanılır. Tekrar açmak için Apps → Einstellungen → Einführung.
- Sürüş kilidi: 5 km/s üzerinde tarayıcı, oyunlar ve yazı girişi kilitlenir, sadece ses kalır.

![Sürüş](docs/img/driving.gif)

## Sanal fare

**Apps → Einstellungen → Maus** ile aç ya da arabanın yön tuşunun orta tuşuna yaklaşık bir saniye bas ve tut.
Tuşlar sayfaya normal ok ve Enter tuşları olarak ulaşır.

| Tuş | İşlem |
|---|---|
| Ok tuşları | İmleci hareket ettirir. Bir basış az, basılı tutmak hızlandırır |
| Orta, kısa | Tıklama |
| Orta, basılı tut | Tuşu basılı tutar (sürükleme, haritayı kaydırır) |
| Orta, hızlı iki kez | Kaydırma moduna geçer: yukarı ve aşağı, imlecin altındaki listeyi kaydırır |

Bir yazı alanı odaktayken tuşlar normal çalışır. Tıklama ve kaydırma asistanın tarayıcısında da çalışır.

![Sanal fare](docs/img/mouse.gif)

![Uygulamalar ve ayarlar](docs/img/apps.png)

## İndirme ve kurulum

İmzalı APK'lar **Releases** altında. `v1.2` gibi bir etiket gönderilince (`git tag v1.2 && git push origin v1.2`)
yeni bir sürüm oluşur, APK'yı GitHub Actions derler. Tüm sürümler aynı anahtarla (`app/release.keystore`) imzalanır,
yani yeni APK eskisinin üstüne veri kaybetmeden kurulur. Kutuda: APK'yı tarayıcıdan indir, dokun, "bilinmeyen
uygulamaları yükle" iznini ver. USB hata ayıklama gerekmez.

## Derleme

Gereksinimler: JDK 17+, Android SDK (platform 34).

```bash
echo "sdk.dir=$HOME/Android/Sdk" > local.properties
./gradlew assembleDebug        # imzalı APK için assembleRelease
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Kutudaki arayüzü `chrome://inspect` ile hata ayıklayabilirsin.

## Emülatör ve sürüş simülatörü

```bash
tools/emulator.sh          # gerçekçi mod, derler, kurar ve uygulamayı başlatır
node tools/drive.mjs       # gerçek OSRM rotasını GPS olarak emülatöre verir
tools/emulator-pairing.sh  # eşleştirme sayfasını yerel ağdaki telefona açar
```

`tbox` AVD'si kutunun ekranını, RAM'ini ve Android sürümünü taklit eder. GPU birebir taklit edilemez:
emülatörde 30 FPS çalışan şey kutuda akıcı çalışır.

## Yapı

```
app/src/main/java/.../MainActivity.java   WebView, varlık sunucusu, köprü window.TBox (ses, TTS, tarayıcı, yapay zekâ, konuşma)
app/src/main/java/.../PairingServer.java  eşleştirme sunucusu, telefonla şifreli veri alışverişi
app/src/main/java/.../SecretStore.java    Android Keystore anahtarıyla şifrelenmiş gizli bilgiler
app/src/main/assets/web/
  app.js, car3d.js, nav.js, apps.js       çekirdek, 3D sahne, navigasyon, uygulama başlatıcı ve dock
  mouse.js                                sanal fare
  browser.js, apps/assistant.js           asistan ve tarayıcısı
  weather.js, speedlimit.js, reminders.js, media.js, inbox.js
```

## Kutu için performans kuralları

- HDRI yansıması en pahalı kısımdır: sadece yansıtıcı malzemeler alır.
- Clearcoat ve specular `MeshPhysicalMaterial` üretir, yüklenirken standart PBR'a çevrilir.
- Modelleri ~110 bin üçgenin altında ve az nesneyle (draw call) tut.

## Durum

Emülatörde denendi: arayüz, navigasyon, eşleştirme, notlar, zamanlayıcılar, düzenler, sanal fare. Gerçek donanımda henüz
denenmedi: ses tanıma (Google konuşma servisi gerekir), OBD, hız limiti tabelası ve yakında arama (herkese açık
Overpass sunucularına bağlı).

## Lisanslar ve kaynaklar

- Free Concept Car 011 (Sketchfab, CC0), Kenney Car Kit (CC0), Poly Haven stüdyo HDRI (CC0)
- three.js (MIT), Leaflet (BSD-2), meshoptimizer (MIT)
- Harita karoları: Esri World Dark Gray. Arama: Photon / OpenStreetMap. Rotalar: OSRM demo sunucusu, sadece kişisel kullanım için.
