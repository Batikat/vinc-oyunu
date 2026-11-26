# Vinç Oyunu (LED ekran + QR ile telefondan kumanda)

Katılımcılar ekrandaki QR'ı okutur, telefonları kumandaya dönüşür. 15 saniye içinde pençeyi topun üstüne getirip **YAKALA**'ya basarlar. Kazanana telefonunda ödül ve 4 haneli kod çıkar. Ekranda yalnızca oyunun adı ve QR görünür. Aynı anda 4 kişi oynayabilir, fazlası sıraya girer. Kimse oynamıyorken vitrin pençesi kendi kendine oynayıp kalabalığı çeker.

İnternet gerekmez. Hiçbir paket kurulmaz, yalnızca **Node.js** yeterli.

## Kurulum (5 dakika)

1. LED ekrana bağlı bilgisayara Node.js kurun (https://nodejs.org, "LTS" sürümü).
2. Bu klasörü bilgisayara kopyalayın.
3. Windows'ta **BASLAT.bat**'a çift tıklayın. Mac veya Linux'ta terminalde `node server.js` çalıştırın.
4. Chrome veya Edge'de `http://localhost:8080` adresini açın, LED ekrana sürükleyin ve **F** tuşuyla tam ekran yapın.
5. Telefonlar bilgisayarla **aynı Wi-Fi** ağında olmalı. QR, bilgisayarın yerel adresini otomatik gösterir.

> Windows ilk açılışta güvenlik duvarı izni sorarsa **"Özel ağlara izin ver"** seçin. Aksi halde telefonlar bağlanamaz.

## Ödül paneli

Oyun açıkken tarayıcıda **http://localhost:8080/admin** adresini aç. İlk şifre **1234**; panelin en altından değiştir.

- **Ödüller:** her ödüle bir ad ve kazanma yüzdesi gir (ör. Kahve %15, Çanta %5). Toplamın dışında kalan kısım kaybettirir. Toplam 100'ü geçemez.
- **Oyun adı, süre, aynı anda oyuncu, telefon başı hak:** kaydedince ekrana anında uygulanır, sayfayı yenilemeye gerek yok.
- **Kazananlar:** her kazanan, ödülü ve 4 haneli koduyla listelenir. Görevli telefondaki kodu buradan arar. Liste Excel'e indirilebilir; ayrıca klasörde `kazananlar.csv` dosyasına yazılır.

Ayarlar `config.json` dosyasına kaydedilir ve kalıcıdır.

## Ekran kısayolları

- **F**: tam ekran
- **Q**: QR'ı gizle / göster
- **D**: FPS ve top sayısı
- **T**: klavyeyle test oyuncusu (oklar + boşluk)

Kazananlar sunucu penceresine de yazılır (`KAZANAN Ayşe — Kahve İkramı — kod 4821`).

## Notlar

- Ekran 16:9, 3:2, ultra geniş veya dikey olabilir; dolap kendini ekrana uydurur.
- Ekran kartı olan bir bilgisayar önerilir. Yavaşlarsa tarayıcıyı 1080p çözünürlükte çalıştırın.
- Etkinlik Wi-Fi'ı cihazların birbirini görmesini engelliyorsa ("client isolation"), bilgisayarı kendi mobil hotspot'unuza ya da ayrı bir router'a bağlayın.
