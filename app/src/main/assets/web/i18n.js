(function () {
  'use strict';

  // The app is written in German, the German text is the key. Turkish and English are looked up
  // here, anything missing falls back to German. {0}, {1} are filled with the arguments of t().
  const LANGS = ['de', 'tr', 'en'];
  const STORE_KEY = 'appLang';

  const TABLE = [
    // static interface
    ['Navigieren', 'Navigasyon', 'Navigate'],
    ['Ankunft', 'Varış', 'Arrival'],
    ['Dauer', 'Süre', 'Duration'],
    ['Strecke', 'Mesafe', 'Distance'],
    ['Ton an', 'Ses açık', 'Sound on'],
    ['Ton aus', 'Ses kapalı', 'Sound off'],
    ['Beenden', 'Bitir', 'End'],
    ['Fahrzeug', 'Araç', 'Car'],
    ['Höhe', 'Yükseklik', 'Altitude'],
    ['Kurs', 'Yön', 'Heading'],
    ['Genauigkeit', 'Doğruluk', 'Accuracy'],
    ['Drehzahl', 'Devir', 'RPM'],
    ['Kühlmittel', 'Soğutma suyu', 'Coolant'],
    ['Apps', 'Uygulamalar', 'Apps'],
    ['Fahrzeugtyp', 'Araç tipi', 'Car type'],
    ['Lackfarbe', 'Boya rengi', 'Paint colour'],
    ['Ansicht', 'Görünüm', 'View'],
    ['Türen', 'Kapılar', 'Doors'],
    ['360° Ansicht', '360° görünüm', '360° view'],
    ['Einstellungen', 'Ayarlar', 'Settings'],
    ['FPS Anzeige', 'FPS göstergesi', 'FPS display'],
    ['Maus', 'Fare', 'Mouse'],
    ['Fahrsperre', 'Sürüş kilidi', 'Driving lock'],
    ['3D Qualität', '3D kalitesi', '3D quality'],
    ['Sprache', 'Dil', 'Language'],
    ['„DriveDeck“ hören', '„DriveDeck“ dinle', 'Listen for "DriveDeck"'],
    ['Verlauf', 'Geçmiş', 'History'],
    ['Stimme: {0}', 'Ses: {0}', 'Voice: {0}'],
    ['Modell {0}: {1}', 'Model {0}: {1}', 'Model {0}: {1}'],
    ['Browser', 'Tarayıcı', 'Browser'],
    ['Suchen oder Adresse', 'Ara veya adres yaz', 'Search or address'],
    ['Der Browser läuft nur in der App.', 'Tarayıcı sadece uygulamada çalışır.', 'The browser only runs in the app.'],
    ['Koppeln', 'Eşleştir', 'Pair'],
    ['Handy', 'Telefon', 'Phone'],
    ['Einführung', 'Tanıtım', 'Intro tour'],
    ['Tour ansehen', 'Turu göster', 'Show the tour'],
    ['Neu laden', 'Yeniden yükle', 'Reload'],
    ['Android', 'Android', 'Android'],
    ['Box', 'Kutu', 'Box'],
    ['Startbildschirm', 'Ana ekran', 'Home screen'],
    ['Nicht gefunden', 'Bulunamadı', 'Not found'],
    ['Seite', 'Sayfa', 'Page'],
    ['Sichtbar', 'Görünür', 'Visible'],
    ['Versteckt', 'Gizli', 'Hidden'],
    ['An', 'Açık', 'On'],
    ['Aus', 'Kapalı', 'Off'],
    ['An (ab 5 km/h)', 'Açık (5 km/s üzeri)', 'On (above 5 km/h)'],
    ['Sparsam (30 FPS)', 'Tasarruflu (30 FPS)', 'Economy (30 FPS)'],
    ['Volle Qualität', 'Tam kalite', 'Full quality'],
    ['Offen', 'Açık', 'Open'],
    ['Zu', 'Kapalı', 'Closed'],
    ['Lange drücken, um eine App ins Dock zu legen oder daraus zu entfernen.', 'Bir uygulamayı dock\'a eklemek veya kaldırmak için uzun bas.', 'Long press an app to add it to the dock or remove it.'],
    // car types and paint
    ['Kleinwagen', 'Küçük araç', 'Hatchback'],
    ['Limousine', 'Sedan', 'Sedan'],
    ['Sportlimousine', 'Spor sedan', 'Sports sedan'],
    ['SUV groß', 'Büyük SUV', 'Large SUV'],
    ['Silber', 'Gümüş', 'Silver'],
    ['Perlweiß', 'İnci beyazı', 'Pearl white'],
    ['Schwarz', 'Siyah', 'Black'],
    ['Tiefblau', 'Koyu mavi', 'Deep blue'],
    ['Rot', 'Kırmızı', 'Red'],
    // apps
    ['Assistent', 'Asistan', 'Assistant'],
    ['Notizen', 'Notlar', 'Notes'],
    ['Malen', 'Çizim', 'Paint'],
    ['Trennen', 'Bağlantıyı kes', 'Disconnect'],
    ['Song oder Interpret', 'Şarkı veya sanatçı', 'Song or artist'],
    ['Notiz schreiben ...', 'Not yaz ...', 'Write a note ...'],
    ['Neue Notiz', 'Yeni not', 'New note'],
    ['Erinnerung', 'Hatırlatma', 'Reminder'],
    // messages
    ['Türen nur im Stand', 'Kapılar sadece dururken açılır', 'Doors only when parked'],
    ['Dieses Modell hat keine beweglichen Türen', 'Bu modelin açılır kapıları yok', 'This model has no moving doors'],
    ['Nur im Stand verfügbar', 'Sadece dururken kullanılabilir', 'Only available when parked'],
    ['App wegen Fahrt geschlossen', 'Sürüş nedeniyle uygulama kapatıldı', 'App closed because the car is moving'],
    ['App', 'Uygulama', 'App'],
    ['{0} aus dem Dock entfernt', '{0} dock\'tan kaldırıldı', '{0} removed from the dock'],
    ['{0} zum Dock hinzugefügt', '{0} dock\'a eklendi', '{0} added to the dock'],
    ['Dock ist voll, höchstens {0} Apps', 'Dock dolu, en fazla {0} uygulama', 'Dock is full, {0} apps at most'],
    ['Nur in der App verfügbar', 'Sadece uygulamada kullanılabilir', 'Only available in the app'],
    ['Spiel vorbei, {0} Punkte', 'Oyun bitti, {0} puan', 'Game over, {0} points'],
    ['Game over', 'Oyun bitti', 'Game over'],
    ['Notiz konnte nicht gespeichert werden', 'Not kaydedilemedi', 'Note could not be saved'],
    ['Erinnerung konnte nicht gespeichert werden', 'Hatırlatma kaydedilemedi', 'Reminder could not be saved'],
    ['Ziel nicht gefunden: {0}', 'Hedef bulunamadı: {0}', 'Destination not found: {0}'],
    ['Ziel vom Handy: {0}', 'Telefondan hedef: {0}', 'Destination from your phone: {0}'],
    ['Ziel vom Handy konnte nicht gesucht werden', 'Telefondan gelen hedef aranamadı', 'The destination from your phone could not be searched'],
    ['Notiz vom Handy gespeichert', 'Telefondan gelen not kaydedildi', 'Note from your phone saved'],
    ['Kein GPS', 'GPS yok', 'No GPS'],
    ['Suche fehlgeschlagen, Internet prüfen', 'Arama başarısız, internete bak', 'Search failed, check the internet'],
    ['Noch kein GPS Signal', 'Henüz GPS sinyali yok', 'No GPS signal yet'],
    ['Route konnte nicht berechnet werden', 'Rota hesaplanamadı', 'The route could not be calculated'],
    ['Ort konnte nicht gespeichert werden', 'Yer kaydedilemedi', 'The place could not be saved'],
    ['Markierter Punkt', 'İşaretli nokta', 'Marked point'],
    ['Unbekannter Ort', 'Bilinmeyen yer', 'Unknown place'],
    ['Ziel erreicht', 'Hedefe ulaşıldı', 'Destination reached'],
    ['Sie haben Ihr Ziel erreicht', 'Hedefinize ulaştınız', 'You have reached your destination'],
    ['Route wird neu berechnet', 'Rota yeniden hesaplanıyor', 'Recalculating the route'],
    ['Route nach {0}. {1}.', '{0} için rota. {1}.', 'Route to {0}. {1}.'],
    ['Wetterdienst nicht erreichbar', 'Hava durumu servisine ulaşılamıyor', 'Weather service unreachable'],
    // weather
    ['klar', 'açık', 'clear'],
    ['heiter bis wolkig', 'az bulutlu', 'partly cloudy'],
    ['bedeckt', 'kapalı', 'overcast'],
    ['Nebel', 'sisli', 'fog'],
    ['Nieselregen', 'çisenti', 'drizzle'],
    ['Regen', 'yağmur', 'rain'],
    ['Schnee', 'kar', 'snow'],
    ['Gewitter', 'fırtına', 'thunderstorm'],
    ['unbekannt', 'bilinmiyor', 'unknown'],
    // units and durations
    ['{0} Metern', '{0} metre', '{0} meters'],
    ['{0} Kilometern', '{0} kilometre', '{0} kilometers'],
    ['{0} Minuten', '{0} dakika', '{0} minutes'],
    ['{0} Stunden {1} Minuten', '{0} saat {1} dakika', '{0} hours {1} minutes'],
    ['In {0} {1}', '{0} sonra {1}', 'In {0}, {1}'],
    // directions
    ['links', 'sol', 'left'],
    ['rechts', 'sağ', 'right'],
    ['leicht links', 'hafif sol', 'slightly left'],
    ['leicht rechts', 'hafif sağ', 'slightly right'],
    ['scharf links', 'keskin sol', 'sharp left'],
    ['scharf rechts', 'keskin sağ', 'sharp right'],
    ['geradeaus', 'düz', 'straight'],
    ['wenden', 'U dönüşü', 'U-turn'],
    // turn instructions: the street name variants end in "auf {0}"
    ['Losfahren', 'Yola çıkın', 'Start driving'],
    ['Losfahren auf {0}', '{0} üzerinde yola çıkın', 'Start driving on {0}'],
    ['Im Kreisverkehr die {0}. Ausfahrt nehmen', 'Kavşakta {0}. çıkışı alın', 'At the roundabout take exit {0}'],
    ['Im Kreisverkehr die {0}. Ausfahrt nehmen auf {1}', 'Kavşakta {0}. çıkışı alın, {1}', 'At the roundabout take exit {0} onto {1}'],
    ['In den Kreisverkehr', 'Kavşağa girin', 'Enter the roundabout'],
    ['In den Kreisverkehr auf {0}', '{0} üzerindeki kavşağa girin', 'Enter the roundabout onto {0}'],
    ['An der Gabelung {0} halten', 'Çatalda {0} tarafta kalın', 'At the fork keep {0}'],
    ['An der Gabelung {0} halten auf {1}', '{1} için çatalda {0} tarafta kalın', 'At the fork keep {0} onto {1}'],
    ['Ausfahrt {0} nehmen', '{0} çıkışı alın', 'Take the {0} exit'],
    ['Ausfahrt {0} nehmen auf {1}', '{1} için {0} çıkışı alın', 'Take the {0} exit onto {1}'],
    ['Auffahrt {0} nehmen', '{0} giriş rampasını alın', 'Take the {0} on-ramp'],
    ['Auffahrt {0} nehmen auf {1}', '{1} için {0} giriş rampasını alın', 'Take the {0} on-ramp onto {1}'],
    ['{0} einfädeln', '{0} şeride katılın', 'Merge {0}'],
    ['{0} einfädeln auf {1}', '{1} üzerinde {0} şeride katılın', 'Merge {0} onto {1}'],
    ['Am Ende der Straße {0} abbiegen', 'Yolun sonunda {0} tarafa dönün', 'At the end of the road turn {0}'],
    ['Am Ende der Straße {0} abbiegen auf {1}', 'Yolun sonunda {1} için {0} tarafa dönün', 'At the end of the road turn {0} onto {1}'],
    ['Weiter geradeaus', 'Düz devam edin', 'Continue straight'],
    ['Weiter geradeaus auf {0}', '{0} üzerinde düz devam edin', 'Continue straight on {0}'],
    ['{0} halten', '{0} tarafta kalın', 'Keep {0}'],
    ['{0} halten auf {1}', '{1} üzerinde {0} tarafta kalın', 'Keep {0} onto {1}'],
    ['Wenden', 'U dönüşü yapın', 'Make a U-turn'],
    ['Wenden auf {0}', '{0} üzerinde U dönüşü yapın', 'Make a U-turn onto {0}'],
    ['Geradeaus weiter', 'Düz devam edin', 'Go straight on'],
    ['Geradeaus weiter auf {0}', '{0} üzerinde düz devam edin', 'Go straight on {0}'],
    ['{0} abbiegen', '{0} tarafa dönün', 'Turn {0}'],
    ['{0} abbiegen auf {1}', '{1} için {0} tarafa dönün', 'Turn {0} onto {1}'],
    // app windows
    ['+ Neue Notiz', '+ Yeni not', '+ New note'],
    ['Löschen', 'Sil', 'Delete'],
    ['Zurück zur Liste', 'Listeye dön', 'Back to the list'],
    ['Singen', 'Söyle', 'Sing'],
    ['Vorschläge', 'Öneriler', 'Suggestions'],
    ['Gekoppelte Geräte', 'Eşleşmiş cihazlar', 'Paired devices'],
    ['Keine gekoppelten Bluetooth Geräte gefunden.', 'Eşleşmiş Bluetooth cihazı bulunamadı.', 'No paired Bluetooth devices found.'],
    ['OBD gibt es nur in der App.', 'OBD sadece uygulamada var.', 'OBD is only available in the app.'],
    ['Den OBD Adapter zuerst in den Bluetooth Einstellungen von Android koppeln.', 'OBD adaptörünü önce Android\'in Bluetooth ayarlarından eşleştir.', 'Pair the OBD adapter in the Android Bluetooth settings first.'],
    ['Tempo', 'Hız', 'Speed'],
    ['Tank', 'Depo', 'Fuel'],
    ['Radierer', 'Silgi', 'Eraser'],
    ['Rückgängig', 'Geri al', 'Undo'],
    ['Leeren', 'Temizle', 'Clear'],
    ['Punkte', 'Puan', 'Points'],
    ['Rekord', 'Rekor', 'Best'],
    ['Neues Spiel', 'Yeni oyun', 'New game'],
    ['Wischen zum Schieben', 'Kaydırarak oyna', 'Swipe to move'],
    ['Neu starten', 'Yeniden başlat', 'Restart'],
    ['Getrennt', 'Bağlı değil', 'Disconnected'],
    ['Fehler: {0}', 'Hata: {0}', 'Error: {0}'],
    ['Unerwartete Antwort vom Modell', 'Modelden beklenmeyen cevap', 'Unexpected answer from the model'],
    ['Fenster', 'Pencere', 'Window'],
    ['Halb', 'Yarım', 'Half'],
    ['Voll', 'Tam', 'Full'],
    ['Notiz', 'Not', 'Note'],
    // updates
    ['Update-Suche', 'Güncelleme denetimi', 'Update check'],
    ['Nach Updates suchen', 'Güncellemeleri denetle', 'Check for updates'],
    ['Wird heruntergeladen ... {0} %', 'İndiriliyor ... %{0}', 'Downloading ... {0} %'],
    ['Update {0}', 'Güncelleme {0}', 'Update {0}'],
    ['Update fehlgeschlagen', 'Güncelleme başarısız', 'Update failed'],
    ['Schließen', 'Kapat', 'Close'],
    ['Berechtigung nötig', 'İzin gerekli', 'Permission needed'],
    ['Erlaube DriveDeck in den Android-Einstellungen, Apps zu installieren, und tippe danach noch einmal auf Installieren.', 'Android ayarlarında DriveDeck\'in uygulama yüklemesine izin ver, sonra tekrar Yükle\'ye dokun.', 'Allow DriveDeck to install apps in the Android settings, then tap Install again.'],
    ['Installieren', 'Yükle', 'Install'],
    ['Später', 'Sonra', 'Later'],
    ['Bestätige die Installation auf dem Bildschirm. Danach die App neu öffnen.', 'Kurulumu ekranda onayla. Sonra uygulamayı yeniden aç.', 'Confirm the installation on the screen. Then open the app again.'],
    ['Version {0} ist verfügbar, installiert ist {1}.', '{0} sürümü hazır, kurulu olan {1}.', 'Version {0} is available, {1} is installed.'],
    ['Diese Version überspringen', 'Bu sürümü atla', 'Skip this version'],
    ['Update-Suche fehlgeschlagen', 'Güncelleme araması başarısız', 'The update search failed'],
    ['Die App ist aktuell ({0})', 'Uygulama güncel ({0})', 'The app is up to date ({0})'],
    // lane bar, intro, language picker
    ['Überspringen', 'Atla', 'Skip'],
  ];

  let lang = null;
  try {
    lang = localStorage.getItem(STORE_KEY);
  } catch (e) {
    lang = null;
  }
  const known = LANGS.includes(lang);
  if (!known) {
    lang = 'de';
  }
  const column = LANGS.indexOf(lang);
  const dictionary = new Map(TABLE.map((row) => [row[0], row[column]]));

  function t(key, ...args) {
    const text = dictionary.get(key) || key;
    return args.length ? text.replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : args[i])) : text;
  }

  const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];

  /**
   * Translates the text and the placeholder/title attributes below root, using the German text as key.
   */
  function apply(root) {
    if (lang === 'de') {
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    nodes.forEach((node) => {
      const text = node.nodeValue.trim();
      if (text && dictionary.has(text)) {
        node.nodeValue = node.nodeValue.replace(text, dictionary.get(text));
      }
    });
    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    [root, ...elements].forEach((el) => {
      ATTRIBUTES.forEach((name) => {
        const value = el.getAttribute && el.getAttribute(name);
        if (value && dictionary.has(value)) {
          el.setAttribute(name, dictionary.get(value));
        }
      });
    });
  }

  function setLang(next) {
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch (e) {
      // without storage the choice is asked again at the next start
    }
  }

  document.documentElement.lang = lang;
  window.i18n = {
    t,
    apply,
    setLang,
    lang,
    chosen: known,
    langs: LANGS,
    // BCP 47 tag for speech
    tag: { de: 'de-DE', tr: 'tr-TR', en: 'en-US' }[lang],
    decimal: (n, digits) => (lang === 'en' ? n.toFixed(digits) : n.toFixed(digits).replace('.', ',')),
  };
  document.addEventListener('DOMContentLoaded', () => apply(document.body));
})();
