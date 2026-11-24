# Vinç Oyunu (LED ekran + QR ile telefondan kumanda)

Katılımcılar ekrandaki QR'ı okutur, telefonları kumandaya dönüşür. 15 saniye içinde pençeyi topun üstüne getirip **YAKALA**'ya basarlar. Kazanana telefonunda ödül ve 4 haneli kod çıkar. Aynı anda 4 kişi oynayabilir, fazlası sıraya girer. Kimse oynamıyorken vitrin pençesi kendi kendine oynayıp kalabalığı çeker.

İnternet gerekmez. Hiçbir paket kurulmaz, yalnızca **Node.js** yeterli.

## Kurulum (5 dakika)

1. LED ekrana bağlı bilgisayara Node.js kurun (https://nodejs.org, "LTS" sürümü).
2. Bu klasörü bilgisayara kopyalayın.
3. Windows'ta **BASLAT.bat**'a çift tıklayın. Mac veya Linux'ta terminalde `node server.js` çalıştırın.
4. Chrome veya Edge'de `http://localhost:8080` adresini açın, LED ekrana sürükleyin ve **F** tuşuyla tam ekran yapın.
5. Telefonlar bilgisayarla **aynı Wi-Fi** ağında olmalı. QR, bilgisayarın yerel adresini otomatik gösterir.

> Windows ilk açılışta güvenlik duvarı izni sorarsa **"Özel ağlara izin ver"** seçin. Aksi halde telefonlar bağlanamaz.

## Ayarlar: `config.json`

| Ayar | Ne yapar |
|---|---|
| `title` | Arka duvara kazınan isim ve QR altındaki başlık |
| `joinText` | QR altındaki davet cümlesi |
| `playSeconds` | Oyun süresi (varsayılan 15 sn) |
| `maxPlayers` | Aynı anda ekrandaki pençe sayısı (1–6) |
| `winRate` | Kazanma olasılığı (0–1). 0.35 ≈ iyi ortalanmış atışların üçte biri |
| `playsPerPhone` | Telefon başına hak (0 = sınırsız) |
| `prizes` | Ödüller ve ağırlıkları (ağırlık büyükse daha sık çıkar) |
| `grandPrize` | Dikenli beyaz "yıldız" top yakalanınca çıkan ödül |
| `attractMode` | Boşta vitrin pençesi oynasın mı |
| `qrSize` | QR boyutu (ekranın kısa kenarına oranı) |
| `publicUrl` | Oyunu internette bir sunucuda çalıştırırsanız adresi (ör. `https://oyun.siteniz.com`) |

Ayarı değiştirdikten sonra ekran sayfasını yenileyin (F5).

## Ekran kısayolları

- **F**: tam ekran
- **Q**: QR'ı gizle / göster
- **D**: FPS ve top sayısı
- **T**: klavyeyle test oyuncusu (oklar + boşluk)

Kazananlar ve kodları sunucu penceresine de yazılır (`KAZANAN Ayşe Kahve İkramı 4821`). Görevli, telefondaki kodu buradan kontrol edebilir.

## Notlar

- Ekran 16:9, 3:2, ultra geniş veya dikey olabilir; dolap kendini ekrana uydurur.
- Ekran kartı olan bir bilgisayar önerilir. Yavaşlarsa tarayıcıyı 1080p çözünürlükte çalıştırın.
- Etkinlik Wi-Fi'ı cihazların birbirini görmesini engelliyorsa ("client isolation"), bilgisayarı kendi mobil hotspot'unuza ya da ayrı bir router'a bağlayın.
