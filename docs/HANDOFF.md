# DriveDeck: durum ve devam notları

Son güncelleme: 25.10.2026, sürüm 3.1. Bu dosya, projeye başka bir bilgisayardan (Ubuntu) devam
edebilmek için şimdiye kadar konuşulanları ve kararları özetler.

## Donanım

- **Kutu:** Carlinkit CPC200-TBOX, "EAU" sürümü (EAU = Avrupa/Asya bölge sürümü). Android içinde model
  `DSB-0230`, ürün `S10A`, build `S10A_123 release-keys`, Qualcomm SM6125 ("trinket"), Android 13,
  ekran 1920x720.
- **Araç:** Mercedes-Benz, kutu onu `MB_B-E-3` olarak tanıyor. Kablolu CarPlay ile bağlı. Ekran dokunmatik
  değil, fare yok; kumanda tuşları var.
- **Bağlantı:** Kutu arabaya karşı USB'de iPhone gibi görünüyor (`sys.usb.state = appleSvc`). Görüntüyü
  arabaya Carlinkit'in kapalı kaynak CarPlay servisi ("suding carplay reverse") iletiyor.

## Kutuyu bilgisayardan yönetmek (arabasız)

Kablolu ADB mümkün değil: USB portu ya iPhone (CarPlay) ya da adb olabilir, ikisi birden olamaz.
Fabrika ayarlarındaki **142618** kodu portu adb'ye çeviriyor, o zaman araba kutuyu görmüyor. Bu kodu
kullanma.

Bunun yerine **kablosuz hata ayıklama** kullanılıyor:

- Kutu ve bilgisayar aynı ağda olmalı. Karar: **telefonun hotspot'u** (iPhone, `172.20.10.x`). Kutu bu
  ağı tanıyor ve kablosuz hata ayıklama bu ağda onaylı. iPhone'da "Kişisel Erişim Noktası" ekranı açık
  olmazsa kutu bazen bağlanmıyor.
- FritzBox ile de olur (Wi-Fi ve kablo aynı ağ), ama yeni ağda kablosuz hata ayıklamanın bir kere kutunun
  ekranında onaylanması gerekir. Şimdilik yapılmadı.
- Yardımcı betik: `tools/box.sh` (macOS ve Ubuntu):
  - `tools/box.sh pair IP:PORT KOD` her bilgisayar için bir kere
  - `tools/box.sh connect` kutuyu mDNS ile bulup bağlanır
  - `tools/box.sh install` release APK'yı derleyip kurar (aynı imza, ayarlar korunur)
  - `tools/box.sh screen` ekranı scrcpy ile gösterir
  - `tools/box.sh log` DriveDeck logları
  - `tools/box.sh restart`, `tools/box.sh reboot`
  - `tools/box.sh home`, `tools/box.sh home-stock` ana ekranı DriveDeck yapar / geri verir
- Mac eşleştirildi. Ubuntu henüz eşleştirilmedi.

### Henüz yapılmamış (arabada, kutunun ekranı görünürken)

Android, kablosuz hata ayıklamayı her yeniden başlatmada kapatıyor. Evde kutu hotspot'a bağlanıyor
ama adb ona ulaşamıyor (25.10. akşam test edildi). Çözüm 3.1'de: `WirelessDebug.java`, açılışta ve
Wi-Fi her bağlandığında ayarı tekrar açıyor. Bunun için bir kere:

1. Kutuda DriveDeck'i 3.1'e güncelle (uygulama içi güncelleme ya da `tools/box.sh install`).
2. Geliştirici seçenekleri > Kablosuz hata ayıklama'yı elle aç, `tools/box.sh connect`.
3. `adb shell pm grant com.koray.tboxtesla android.permission.WRITE_SECURE_SETTINGS`
4. `tools/box.sh home`, sonra Android sorarsa DriveDeck > Her zaman.
5. `tools/box.sh reboot` ile bağlantının kendiliğinden geri gelip gelmediğini test et.

Geri almak için: `adb shell pm revoke com.koray.tboxtesla android.permission.WRITE_SECURE_SETTINGS` ve
`tools/box.sh home-stock`. Carlinkit firmware güncellemesinden önce ana ekranı geri ver (aksi halde
güncelleme başarısız olabiliyor).

## Ubuntu kurulumu

```bash
sudo apt install openjdk-17-jdk adb scrcpy
# Android SDK (compileSdk 34): commandline-tools ile ya da Android Studio ile
echo "sdk.dir=$HOME/Android/Sdk" > local.properties   # local.properties git'te değil
./gradlew assembleRelease                              # app/release.keystore ile imzalanır
```

Release imzası repodaki `app/release.keystore` (şifre build.gradle'da). Kişisel, sideload edilen bir
uygulama olduğu için bilerek böyle.

## Sürüm çıkarma

- `app/build.gradle` içinde `versionCode` ve `versionName` artır, commit, `git tag vX.Y`, push.
- GitHub Actions (`.github/workflows/release.yml`) APK'yı derleyip Release'e koyuyor.
- Kutudaki uygulama içi güncelleme GitHub'daki son Release'i çekiyor.
- Remote `git@github-privat:kzorluoglu/drivedeck.git`, commitler `koray@d8devs.com` ile.

## Mimari (kısa)

- `MainActivity`: tam ekran WebView (`assets/web`), JS köprüsü `window.TBox` (`DeviceBridge`).
- `assets/web`: arayüz (harita, navigasyon, dock, uygulamalar). `apps/assistant.js` asistan (dock'ta,
  sesle yönetiliyor), `apps/browser.js` tarayıcı uygulaması (asistanın da kullandığı WebView).
- `CloudVoice`: ses kaydı ve OpenRouter ses tanıma (STT) + seslendirme (TTS). Yerel Android STT/TTS
  yok (bilinçli karar).
- `Microphone`: giriş ve kayıt türü seçimi, mikrofon testi.
- `PairingServer`: telefon sayfası (`assets/pair.html`), port 8765, uçtan uca AES-GCM. Kalıcı eşleşme.
  `MdnsResponder`: `drivedeck.local`.
- `SecretStore`: OpenRouter anahtarı, giriş bilgileri, ayarlar (Android Keystore ile şifreli).
- `Usage`: token/maliyet sayaçları. `Updater`: GitHub Release'lerinden güncelleme.
- `WirelessDebug`: kablosuz hata ayıklamayı açık tutar (izin verilmişse).

## Kararlar

- **Uyandırma kelimesi yok.** "DriveDeck" denemeleri (bulutta sürekli dinleme, Vosk, Android
  tanıyıcısı) bırakıldı: bip sesleri, gizlilik (araçtaki konuşmalar loglanıyordu), Türkçe'de tanıma
  sorunları. Asistan **sadece tuşla** başlıyor; kayıt doğrudan OpenRouter'a gidiyor.
- **Tuş:** Varsayılan herhangi bir tuşu 3 sn basılı tutmak. Telefon sayfasında tuş ve şekil seçilebilir
  (3 sn, 1 sn, iki kez kısa, bir kez kısa). Sesli asistan / arama tuşu her zaman çalışır.
- **Ekran dokunmatik değil:** Her şey asistan üzerinden sesle (`open_app`, `close_app`, `set_layout`,
  onaylar "evet/hayır" ile, soru sorarsa otomatik dinleme).
- **TTS:** varsayılan `google/gemini-3.8-flash-tts`, ses "Kore", 24 kHz PCM. Telefonda model/ses seçilir.
  `openai/gpt-4o-mini-tts` OpenRouter'ın canlı listesinde yoktu, Android sesine düşüyordu.
- **STT:** `openai/gpt-4o-mini-transcribe`, hata olursa `whisper-large-v3-turbo`, `whisper-1`.
- **Sürüşte video:** sürüş başlayınca durur; sadece "arka planda" denirse ya da sürerken istenirse ses
  devam eder.
- **DriveDeck ana ekran olabiliyor** (3.0). Kendi Android'ini kurmak (GSI/LineageOS) önerilmedi:
  CarPlay servisi kapalı kaynak, gider ve araba ekranı boş kalır; bootloader/yedek firmware belirsiz.

## Açık sorunlar

- **Mikrofon:** Mikrofon testinde bütün kombinasyonlar 0 çıktı. Android yeniden başlatıldıktan sonra kayıt
  tekrar ses aldı. 2.7+ teşhisi (Android sürümü, ön plan, diğer kayıtlar, susturulma, routing, 48 kHz)
  henüz sonuçla raporlanmadı. Arabanın mikrofonu (CarPlay üzerinden) Android'e gelip gelmediği belli değil.
  Telefon sayfasından "Mikrofonu test et" ile tekrar ölç, `tools/box.sh log` ile izle.
- **"Provider returned error":** 2.9'dan beri hata, model + sağlayıcı + asıl mesajla gösteriliyor.
  Hangi modelde ne dediği henüz görülmedi.
- **Beyaz şeffaf katman** uzun tuş basışında: WebView uzun tıklama kapatıldı (2.4), sonra tekrar görüldü.
  Muhtemelen Android'in uzun basışa bağlı bir sistem işlevi. Telefon sayfasındaki tuş günlüğü ile
  hangi tuş olduğunu bul, gerekirse "iki kez kısa" kullan.
- **Ses (TTS) kutuda doğrulanmadı:** Gemini PCM'in kutuda gerçekten çaldığı test edilmedi.

## Kutu: protokol (CarPlay / Android Auto) ve sıfırlama

- Kasadaki delik **sıfırlama değil, protokol tuşu**: kutu açık ve 1 dk beklemiş iken 2-3 sn bas.
  **10 sn veya daha uzun basma** (EDL moduna girip açılmayabilir).
- SD kart ile: kök dizine `reverse.ini` (Carlinkit'in dosyası, CRLF, yorum satırları + son satır):
  `revert_connect_type=1` CarPlay, `=2` Android Auto. Orijinal dosya Carlinkit Support'un YouTube
  videosunun açıklamasındaki Google Drive linkinde. Kutu 256 GB'a kadar TF kart destekliyor (FAT32,
  metal yüz aşağı). Geçişten sonra dosyayı kartta bırakma.
- Kart 25.10.'da hazırlandı; kartta `adbDeviceMode` (içinde `1`) vardı, kaldırıldı (yedek Mac'te,
  scratchpad). Sorunun sebebi aslında gevşek USB fişiydi.
- Fabrika ayarları (2025+ firmware): Ayarlar > Diğer > Fabrika ayarları, şifre 4545, protokol seçeneği.
- Fabrika sıfırlaması: Ayarlar > Sistem > Gelişmiş > Sıfırlama seçenekleri > Tüm verileri sil.
- Kaynaklar: https://aiboxfix.com/fix/switch-carplay-android-auto-protocol/ ,
  https://aiboxfix.com/fix/device-not-supported-after-adb/ , https://www.carlinkit.com/faq_detail/153.html ,
  https://www.youtube.com/watch?v=awFHW882R3Q , resmi kılavuz https://www.carlinkit.com/manuals_plus

## Raspberry Pi fikri (araştırma sonucu)

- **CarPlay (Pi'yi iPhone gibi göstermek):** Gerçekçi değil. iAP2 ve AirPlay/FairPlay kapalı; tek açık
  kaynak deneme CarPi (Pi 4B) arabada hiç çalışmamış. Pi 3 B/B+ zaten USB gadget desteklemiyor
  (Zero W, Zero 2 W, 3 A+, 4 destekliyor).
- **Android Auto (Pi'yi Android telefon gibi göstermek):** Daha açık. Telefon tarafının açık kaynak
  uygulamaları var: AARE (gerçek bir arabada görüntüyle çalışıyor), AACS (Linux + USB gadget).
  Engel: araba telefonun sertifikasını doğruluyor. Açık kaynak ve ucuz üniteler her sertifikayı kabul
  ediyor; Google'ın test ünitesi ve muhtemelen fabrika sistemleri (Mercedes MBUX) sadece Google imzalıyı.
- **Sonraki ucuz test:** Bir Android telefona AARE kurup USB ile Mercedes'e bağla. Araba kabul ederse
  Pi 4 / Zero 2 W ile kendi arayüzümüzü Android Auto üzerinden göstermek gerçekçi; reddederse yol kapalı.
- Kaynaklar: https://github.com/prototux/AARE , https://github.com/tomasz-grobelny/AACS ,
  https://github.com/tylxr59/CarPi , https://github.com/nisargjhaveri/WirelessAndroidAutoDongle ,
  https://github.com/aa-proxy/aa-proxy-rs

## Sürüm geçmişi (kısa)

- 1.5–1.8: OpenRouter ses, minimal asistan, telefon sayfası kalıcı + `drivedeck.local`, model/ses seçimi.
- 1.9: Asistan dock'ta, tarayıcı uygulaması, sesle her şey, araba paneli dar, sürüşte video durur.
- 2.0–2.2: Uyandırma kelimesi denemeleri (Vosk, Android), sonra kaldırıldı (2.3).
- 2.4–2.6: Uzun basış seçim çubuğu, ses algılama eşiği, mikrofon seçimi ve testi.
- 2.7–2.9: Mikrofon teşhisi, test en fazla 5 sn, STT yedek modeller, ayrıntılı hata, tuş seçimi.
- 3.0: DriveDeck ana ekran olabiliyor, Android ayarları / kutu ana ekranı sesle.
- 3.1: Kablosuz hata ayıklama açık tutulur, `tools/box.sh`.
