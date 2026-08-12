# Düğünajansım Canlıya Geçiş Hazırlık ve Uçtan Uca Test Raporu

**Rapor tarihi:** 12 Ağustos 2026

**İncelenen canlı adres:** `https://dugunajansim.com`

**İncelenen kaynak:** Bu deponun mevcut `main` dalı ve üretim yapılandırmaları
**Karar:** **ŞİMDİLİK NO-GO — P0 çıkış kapıları kapanmadan canlı trafik alınmamalı**

---

## 1. Yönetici özeti

Uygulamanın temel iskeleti, rol ayrımı, admin ve salon operasyonlarının önemli bir bölümü çalışıyor. Canlı Chrome oturumunda admin paneliyle manuel başvuru oluşturma ve onaylama; salon panelinde personel oluşturma, düzenleme, pasifleştirme ve düğüne atayıp geri kaldırma başarıyla doğrulandı. Ana sayfa, katalog, paket hesaplama, galeri ve SSS gibi temel etkileşimler de açıldı ve çalıştı.

Buna rağmen mevcut durum canlıya çıkış için uygun değil. En kritik neden, herkese açık paket başvurusunun gerçek canlı sitede gönderilememesi ve hatanın kullanıcıya görünmemesidir. Bunun yanında WhatsApp/dekont aşamasına ulaşmış başvuruların varsayılan 60 dakikalık süre sonunda otomatik silinebilmesi, gerçek müşteri aktivasyon ve teslimat zincirinin kanıtlanmamış olması, canlı test verisi temizliği/cutover planının eksikliği ve üretim hata kurtarma/yedekleme/izleme boşlukları çıkışı engelliyor.

Google görünürlüğü açısından da canlı sistem hazır değildir: `robots.txt` ve `sitemap.xml` canlıda 404 dönüyor, `www` alan adı sertifika hatasına düşüyor ve `/index.html` canonical `/` adresine yönlenmiyor. Search Console, gerçek Core Web Vitals ölçümü ve yerel işletme sinyalleri de tamamlanmalıdır.

### Canlıya çıkışı durduran ana başlıklar

- [ ] Canlı public başvuru gönderimi düzeltilmiş ve gerçek API/DB üzerinde tekrar tekrar başarıyla doğrulanmış olmalı.
- [ ] Başvuru hatası formun aktif adımında, anlaşılır ve tekrar denenebilir biçimde gösterilmeli.
- [ ] WhatsApp/dekont aşamasına geçmiş başvurular otomatik süre temizliğinden çıkarılmalı; ödeme kanıtı taşıyan kayıt kaybolmamalı.
- [ ] Gerçek müşteri aktivasyonu → parola belirleme → giriş → panel → teslimat bağlantısı zinciri uçtan uca geçmeli.
- [ ] Üretim veritabanı temiz başlangıç/cutover planı uygulanmalı; bütün test kayıtları ve takvimi bloke eden test düğünleri ayıklanmalı.
- [ ] `PAYMENT_MODE=live` ve gerçek banka/ödeme metinleri dağıtım kapısı olarak doğrulanmalı.
- [ ] Temiz sunucu kurulumu, forward-only migration hatası ve kurtarma prosedürü prova edilmeli.
- [ ] Yedeklerin aynı sunucu dışındaki şifreli/immutable kopyası ve bağımsız restore tatbikatı bulunmalı.
- [ ] Dışarıdan uptime, 5xx, gecikme, disk, OOM, TLS ve yedek alarmı kurulmalı.
- [ ] `robots.txt`, sitemap, `www` TLS/canonical ve `/index.html` yönlendirmesi düzeltilmeli.
- [ ] Search Console Domain Property doğrulanmalı, sitemap kabul edilmeli ve ana URL render edilmiş haliyle incelenmeli.
- [ ] Gerçek Nginx/API/PostgreSQL kullanan full-stack “altın yol” testi release kapısı olmalı.
- [ ] CI dışında kalan abuse testleri normal CI kapısına eklenmeli.
- [ ] DNS/TLS ve GitHub production environment onay kuralları dış sistemlerde ayrıca doğrulanmalı.

---

## 2. Öncelik ve durum sözlüğü

| Kod    | Anlamı                                                                                             | Çıkış kararı                               |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **P0** | Veri kaybı, ana dönüşümün çalışmaması, erişilememe veya güvenilir geri dönüş bulunmaması           | Kapanmadan canlıya çıkılmaz                |
| **P1** | Müşteri/operasyon akışını ciddi biçimde bozabilecek veya görünürlüğü önemli ölçüde düşürecek sorun | Genel trafiğe açılmadan kapatılır          |
| **P2** | Kullanılabilirlik, bakım, erişilebilirlik veya ölçekleme riski                                     | Planlanır; tercihen canlı öncesi kapatılır |
| **P3** | İyileştirme ve uzun vadeli kalite işi                                                              | Backlog ve sahibi belirlenir               |

| Test durumu       | Anlamı                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| **GEÇTİ**         | Canlı tarayıcıda veya ilgili otomatik testte gözlemlendi                                |
| **BAŞARISIZ**     | Beklenen davranış gerçekleşmedi                                                         |
| **BLOKE**         | Gerekli hesap, MFA, ortam veya dış sistem olmadığı için kanıtlanamadı                   |
| **KISMİ**         | Salt-okunur ya da form doğrulaması görüldü; kalıcı mutasyon tamamlanmadı                |
| **TEST EDİLMEDİ** | Canlı veri üzerinde geri döndürülemez veya finansal etki yaratmamak için çalıştırılmadı |

---

## 3. Denetim yöntemi ve dürüst kapsam sınırları

Bu rapor aşağıdaki kanıtlardan üretildi:

1. Kullanıcının açık ve giriş yapılmış Chrome oturumunda canlı site testi.
2. Herkese açık ana sayfa ve paket oluşturucu üzerinde gerçek form/etkileşim testi.
3. Admin panelinde gerçek test verisiyle başvuru oluşturma ve onaylama.
4. Salon yetkilisi hesabıyla gerçek personel CRUD ve atama ekle/kaldır testi.
5. Rol yönlendirmeleri, giriş, çıkış ve şifre kurtarma davranışlarının testi.
6. Frontend, backend, Prisma, Nginx, Compose, CI ve deploy kodlarının statik incelemesi.
7. SEO metadata, indekslenebilirlik, canlı uç noktalar ve Google hazırlığının incelemesi.
8. Mevcut testlerin kapsam ve release gücü analizi.

### Kanıtlanamayan veya sınırlı kalan alanlar

- Kullanılabilir müşteri parolası yoktu. Admin üzerinden parola sıfırlama ise mevcut admin parolası ve 6 haneli MFA ile yeniden doğrulama istedi. Bu nedenle gerçek müşteri paneli içi işlemler **BLOKE** kaldı.
- Chrome bağlantısı Console kayıtlarını kontrol etmeye izin verdi; fakat başarısız public POST isteğinin DevTools Network yanıt gövdesi/statusu ve backend correlation/request ID’si yakalanamadı. UI yalnız genel hata gösterdi. Kök neden kesinleştirilmeden tahmin yürütülmemelidir.
- GitHub Environment koruması, DNS sağlayıcı ayarları, ACME/TLS sertifika kapsamı, harici yedek depolama ve alarm alıcıları depo dışı olduğu için ayrıca okunmalıdır.
- Public sayfanın canlı desktop etkileşimleri doğrulandı. Public mobil görünümün release adayı üzerinde gerçek iPhone/Android testi ayrıca yapılmalıdır; mevcut otomasyon emülasyondur.
- Kalıcı silme, gerçek mesajı gönderildi işaretleme, gerçek teslimat linki yayınlama ve finansal sonucu olabilecek işlemler canlı test verisinde çalıştırılmadı.

---

## 4. Canlı Chrome uçtan uca test özeti

### 4.1 Public ana sayfa ve paket oluşturucu

| Akış                         | Durum              | Canlı gözlem                                                                                                       |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Ana sayfanın açılması        | GEÇTİ              | Başlık, içerik, hizmet/mekân verileri ve CTA’lar yüklendi.                                                         |
| Galeri lightbox açma         | GEÇTİ              | İlk fotoğraf açıldı.                                                                                               |
| Galeride sonraki fotoğraf    | GEÇTİ              | İçerik ikinci fotoğrafa geçti.                                                                                     |
| Galeri kapatma               | GEÇTİ              | Dialog kapandı.                                                                                                    |
| SSS aç/kapa                  | GEÇTİ              | İlk soru cevabı açıldı ve geri kapandı.                                                                            |
| Hizmet filtreleme            | GEÇTİ              | Filtre sonuçları güncellendi.                                                                                      |
| Hizmet detay dialogu         | GEÇTİ              | Detay açıldı.                                                                                                      |
| Hizmet ekleme ve toplam      | GEÇTİ              | Drone eklendi; toplam `28.000 TL` oldu.                                                                            |
| Zorunlu alan doğrulaması     | GEÇTİ              | Eksik alanlarla ilerleme engellendi.                                                                               |
| Nakit/kapora seçimi          | GEÇTİ              | Nakit `25.200 TL`, kapora `5.000 TL` gösterildi; seçim değişti.                                                    |
| Turnstile token üretimi      | GEÇTİ              | Gönderim öncesi response oluştu.                                                                                   |
| Public başvuru gönderimi     | **BAŞARISIZ / P0** | “Referans oluşturuluyor” sonrası form 4. adımda kaldı; gizli sonraki adımda yalnız `Bir hata oluştu.` yazdı.       |
| Başvurunun adminde görünmesi | **BAŞARISIZ / P0** | Public formdan yeni bekleyen başvuru oluşmadı.                                                                     |
| Kullanıcıya görünür hata     | **BAŞARISIZ / P0** | Hata aktif adımda gösterilmedi; kullanıcı ne olduğunu ve ne yapacağını göremiyor.                                  |
| Console kontrolü             | GEÇTİ              | Kontrol edilen public ekranlarda beklenmeyen console error görülmedi. Bu, POST’un başarılı olduğu anlamına gelmez. |

**Canlı testte kullanılan public sentetik veri:** `CanliTest Basvuru / UctanUca Denetim`, test e-posta/telefonları, 29 Ağustos 2026, Talia Garden, Mini Paket + Drone. Başvuru başarısız olduğu için admin listesinde kayıt görülmedi.

### 4.2 Admin paneli

| Alan/işlev                       | Durum | Canlı gözlem                                                                                        |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| Genel bakış verileri             | KISMİ | Kartlar yüklendi; “bugünkü düğünler” sayısı ile içerik alanı arasında görünürlük sorunu var.        |
| Haftalık plan                    | GEÇTİ | Önceki hafta ve “Bugün” geçişleri çalıştı.                                                          |
| Düğün detayını açma              | GEÇTİ | Detay, teslimat, atama ve parola işlemleri göründü.                                                 |
| Salon takvimi                    | GEÇTİ | Salon sekmeleri, sonraki ay ve bugüne dönüş çalıştı.                                                |
| Manuel başvuru formu validasyonu | GEÇTİ | Zorunlu alanlar doğrulandı.                                                                         |
| Manuel başvuru oluşturma         | GEÇTİ | Referans `DA-20260812-405440` oluşturuldu.                                                          |
| Referansla arama                 | GEÇTİ | Sentetik başvuru bulundu.                                                                           |
| Başvuru detayları                | GEÇTİ | Tarih, salon, paket, ödeme ve not doğru göründü.                                                    |
| Başvuru onaylama                 | GEÇTİ | Düğün ve teslimat planı oluştu; mesaj sayısı 58’den 60’a çıktı.                                     |
| Onaylı düğünün listede görünmesi | GEÇTİ | 29 Ağustos 2026 düğünü listede göründü.                                                             |
| Düğün arama                      | GEÇTİ | Arama çalıştı.                                                                                      |
| Personel arama/filtre            | GEÇTİ | Sonuçlar güncellendi.                                                                               |
| Admin personel oluşturma         | KISMİ | Form ve zorunlu validasyon test edildi; kalıcı kayıt oluşturulmadı.                                 |
| Mesaj listesi                    | GEÇTİ | 60 görev yüklendi; gelecekteki görevlerde dahi eylem butonu görünmesi ayrıca bulgudur.              |
| Katalog                          | KISMİ | 1 paket, 8 hizmet, 7 salon yüklendi; modal açıldı, kalıcı CRUD yapılmadı.                           |
| Salon yetkilileri                | KISMİ | Mevcut yetkili yüklendi; ekleme modalı/validasyon görüldü, yeni hesap açılmadı.                     |
| Müşteri parola sıfırlama         | BLOKE | Admin parolası + MFA step-up istendi; gerekli doğrulama bilgileri mevcut değildi.                   |
| Mobil admin drawer               | GEÇTİ | 390×844 testinde aç/kapa çalıştı; yatay taşma görülmedi. Erişilebilirlik eksikleri ayrı listelendi. |
| Admin çıkış                      | GEÇTİ | Oturum kapandı ve giriş formu geldi.                                                                |
| Console kontrolü                 | GEÇTİ | Kontrol edilen admin ekranlarında beklenmeyen console error görülmedi.                              |

### 4.3 Salon yetkilisi paneli

| Alan/işlev                          | Durum | Canlı gözlem                                                                |
| ----------------------------------- | ----- | --------------------------------------------------------------------------- |
| Salon yetkilisi girişi              | GEÇTİ | Hesap Cess Wedding kapsamıyla açıldı. Rapor kimlik bilgisi içermez.         |
| Dashboard                           | GEÇTİ | Bugün/hafta/personel/bekleyen atama göstergeleri yüklendi.                  |
| Haftalık plan                       | GEÇTİ | Önceki hafta ve bugüne dönüş çalıştı.                                       |
| Salon takvimi                       | GEÇTİ | Yalnız yetkili salon gösterildi; ay geçişleri çalıştı.                      |
| Düğün detayını açma                 | GEÇTİ | Detay açıldı.                                                               |
| Düğün güncelleme validasyonu        | GEÇTİ | Eksik/geçersiz alan gönderimi engellendi.                                   |
| Düğün planı arama                   | GEÇTİ | Arama çalıştı.                                                              |
| Personel listesi                    | GEÇTİ | 4 mevcut personel yüklendi.                                                 |
| Eksik uzmanlıkla personel oluşturma | KISMİ | Backend genel `Girdi doğrulama hatası` döndürdü; alan bazlı açıklama yoktu. |
| Geçerli personel oluşturma          | GEÇTİ | `Canli TestSalon` oluşturuldu.                                              |
| Personel düzenleme                  | GEÇTİ | Ad `Canli TestSalonDenetim` yapıldı ve ikinci uzmanlık eklendi.             |
| Geçersiz ad davranışı               | KISMİ | Rakam içeren ad reddedildi fakat mesaj yine genel kaldı.                    |
| Pasifleştir/aktifleştir             | GEÇTİ | İki yön de çalıştı. Kayıt test sonunda pasif bırakıldı.                     |
| Düğüne personel atama               | GEÇTİ | Test personeli mevcut Cess düğününe Video göreviyle atandı.                 |
| Atamayı kaldırma                    | GEÇTİ | Atama geri kaldırıldı.                                                      |
| Admin paneline yetkisiz geçiş       | GEÇTİ | Salon rolü operasyon paneline geri yönlendirildi.                           |
| Müşteri paneline yetkisiz geçiş     | GEÇTİ | Salon rolü operasyon paneline geri yönlendirildi.                           |
| Mobil görünüm                       | GEÇTİ | Drawer çalıştı, yatay taşma görülmedi.                                      |
| Desktop görünüm                     | GEÇTİ | Geniş ekranda taşma görülmedi; mobil toggle gizlendi.                       |
| Çıkış                               | GEÇTİ | Oturum kapandı.                                                             |
| Console kontrolü                    | GEÇTİ | Kontrol edilen operasyon ekranlarında beklenmeyen console error görülmedi.  |

### 4.4 Müşteri rolü

| Alan/işlev                                 | Durum | Canlı gözlem                                                                                 |
| ------------------------------------------ | ----- | -------------------------------------------------------------------------------------------- |
| Anonim müşteri paneli erişimi              | GEÇTİ | `/musteri-paneli.html` → `/login.html` yönlendirdi.                                          |
| Geçersiz giriş                             | GEÇTİ | Genel `Kullanıcı adı veya parola hatalı.` mesajı gösterildi.                                 |
| Şifremi unuttum                            | KISMİ | Yalnız ekiple iletişime geçme metni gösteriliyor; kullanıcıyı götüren gerçek kanal/akış yok. |
| Mevcut müşteri hesabı parolasını sıfırlama | BLOKE | Admin step-up parolası + MFA gerekliydi.                                                     |
| Aktivasyon linki                           | BLOKE | Gerçek link üretilemedi.                                                                     |
| Parola belirleme                           | BLOKE | Aktivasyon zinciri başlayamadı.                                                              |
| Müşteri login                              | BLOKE | Kullanılabilir müşteri parolası yoktu.                                                       |
| Müşteri dashboard                          | BLOKE | Oturum açılamadı.                                                                            |
| Teslimat durumu ve dosya linki             | BLOKE | Müşteri oturumu ve teslim edilmiş test kaydıyla kanıtlanmadı.                                |
| Logout/oturum süresi                       | BLOKE | Müşteri oturumu açılamadı.                                                                   |

**Sonuç:** Müşteri rolü canlıya hazır olarak işaretlenemez. Bu rol için salt yönlendirme testi geçmiş olsa da ana iş akışı kanıtlanmamıştır.

---

## 5. P0 — Canlıya çıkmadan kapanması zorunlu bulgular

### P0-01 — Public başvuru canlıda gönderilemiyor ve hata görünmüyor

**Kanıt**

- Canlı Chrome testinde bütün zorunlu alanlar dolu, Turnstile response mevcut ve geçerli ödeme seçiliyken gönderim başarısız oldu.
- UI “Referans oluşturuluyor” dedikten sonra 4. adımda kaldı.
- Hata metni yalnız gizli 5. adımın `.js-payment-notification-status` alanına yazıldı.
- Admin panelindeki bekleyen başvuru sayısı public deneme nedeniyle artmadı.
- Kod: `js/package-builder/application.js:882-899`, `js/package-builder/application.js:1389-1390`, `js/package-builder/application.js:1493`, `paketini-olustur.html:719-723`, `paketini-olustur.html:865`.

**Etki**

- Ana dönüşüm yolu fiilen kapalıdır.
- Kullanıcı hatayı görmeden aynı formu tekrar doldurabilir veya ayrılabilir.
- İşletme başvuru ve gelir kaybeder.

**Yapılacaklar**

- [ ] Backend/proxy logunda test zamanı ve form fingerprint’i ile gerçek hata bulunmalı.
- [ ] POST status, response body, request/correlation ID ve server logu birlikte kaydedilmeli.
- [ ] Hata aktif adımda ve ilgili alan yakınında gösterilmeli.
- [ ] Geçici 5xx/ağ hatası için form verisi korunmalı ve “Tekrar dene” sunulmalı.
- [ ] Turnstile reset sonrası widget otomatik yeniden hazırlanmalı.
- [ ] Aynı isteğin çift gönderiminde idempotency davranışı doğrulanmalı.
- [ ] Başarı halinde referans görünmeli ve admin listesinde aynı kayıt bulunmalı.

**Kabul ölçütü**

- [ ] Nakit ve kapora için en az üçer gerçek staging gönderimi 2xx ile tamamlanıyor.
- [ ] Her gönderim tam bir referans üretiyor ve admin paneline bir kez düşüyor.
- [ ] 400/409/422/429/500/offline senaryolarının her biri kullanıcıya doğru mesajı aktif adımda gösteriyor.
- [ ] Yenileme/geri/ileri sonrası aynı başvuru yanlışlıkla çoğalmıyor.

### P0-02 — WhatsApp/dekont aşamasındaki başvuru 60 dakika sonra otomatik silinebiliyor — KAPATILDI (2026-08-12)

**Kanıt**

- Handoff tamamlanmış public başvuru varsayılan TTL sonunda cleanup tarafından siliniyor.
- Varsayılan süre 60 dakika; tarama her dakika çalışıyor.
- Entegrasyon testi bu silmeyi beklenen davranış olarak doğruluyor.
- Kod: `backend/src/services/booking.service.ts:725-733`, `backend/src/bootstrap.ts:13`, `backend/src/bootstrap.ts:22-36`, `backend/src/config/env.config.ts:353-358`, `backend/tests/database.integration.test.ts:1594-1631`.

**Etki**

- Kullanıcı dekont/ödeme kanıtı göndermişken admin bir saat içinde işlem yapmazsa kayıt kaybolabilir.
- Finansal mutabakat ve operasyon takibi güvenilir olmaz.

**Yapılacaklar**

- [x] Handoff/dekont aşamasındaki kayıtlar otomatik silme kapsamından çıkarıldı.
- [x] TTL yalnız ödeme adımına ulaşmamış gerçek terk kayıtlarına uygulanıyor.
- [x] Fiziksel silme yerine kontrollü iptal/arşiv durum geçişi uygulanıyor.
- [x] Cleanup metriği ve beklenmeyen silme alarmı kuruldu.
- [x] Entegrasyon testi yeni veri saklama kuralına göre değiştirildi.

**Kabul ölçütü**

- [x] Handoff yapılmış test başvurusu 24+ saat sonra hâlâ admin kuyruğunda bulunuyor.
- [x] Gerçek terk kayıtları tanımlı sürede ve kayıtlı audit iziyle arşivleniyor.

**Güncel çözüm kanıtı:** `kanit/faz-02-ttl-handoff-saklama.md`. Gerçek terk 60 dakikada fiziksel silinmiyor; `IPTAL_EDILDI` durumuna atomik geçiriliyor ve varsayılan 90 günlük public retention politikasına bırakılıyor. Handoff/ödeme kanalı bulunan başvurular korunuyor, slot tutuyor ve TTL sonrasında da yönetici tarafından onaylanabiliyor. Hata enjeksiyonunda transaction rollback’i doğrulandı.

### P0-03 — Müşteri altın yolu kanıtlanmadı

**Eksik zincir**

`public başvuru → admin onay → aktivasyon mesajı render → müşteri parola belirleme → müşteri login → panel → teslimat durumu → teslim edilen bağlantıyı açma`

**Risk**

- Admin onaylamış olsa bile müşteri hesabı kullanılamayabilir.
- Aktivasyon, tarih kısıtı veya “Gönderildi” işareti nedeniyle kalıcı olarak kilitlenebilir.
- Teslimat tamamlanmış görünse bile müşteri dosyaya erişemeyebilir.

**Yapılacaklar ve kabul ölçütü**

- [ ] Ayrı sentetik müşteriyle gerçek aktivasyon tokenı üretilmeli.
- [ ] Token bir kez kullanılmalı; tekrar kullanım ve süresi dolmuş token reddedilmeli.
- [ ] Güçlü parola belirlenmeli ve login çalışmalı.
- [ ] Müşteri yalnız kendi düğününü görmeli.
- [ ] Hazır olmayan teslimat bağlantısı gizli kalmalı.
- [ ] Teslim edilen gerçek test bağlantısı açılmalı ve yetkisi doğrulanmalı.
- [ ] Oturum sonlandırma ve idle timeout çalışmalı.
- [ ] Başka müşteri/düğün ID’sine doğrudan erişim 403/404 vermeli.

### P0-04 — Aktivasyon mesajı link üretilmeden “Gönderildi” yapılabiliyor

**Kanıt**

- Admin UI gelecekteki aktivasyon görevinde dahi “Gönderildi” eylemi sunuyor.
- Backend `dueAt` zamanını işleme önkoşulu yapmıyor.
- Aktivasyon mesajı render edilmeden görev `SENT` olursa sonradan render reddediliyor.
- Müşteri başlangıçta bilinmeyen rastgele parolayla oluşturulduğu için gerçek aktivasyon olmadan giriş yapamaz.
- Kod: `backend/src/services/booking.service.ts:1123`, `backend/src/services/booking.service.ts:1211-1219`, `backend/src/routes/admin.routes.ts:2535-2542`, `backend/src/routes/admin.routes.ts:2637-2650`, `js/admin/app.js:1089-1093`.

**Yapılacaklar**

- [ ] Aktivasyon görevi “Gönderildi” olmadan önce render edilmiş geçerli token zorunlu olmalı.
- [ ] Gelecek `dueAt` için eylem kilitli veya açıkça yetkili override olmalı.
- [ ] Yanlış işaretlenmiş görev için güvenli yeniden üretim/iptal prosedürü olmalı.
- [ ] Admin UI sıralamayı adım adım zorlamalı: `Hazırla → Linki doğrula → Gönder → Gönderildi işaretle`.

### P0-05 — Üretim veri cutover ve test verisi temizliği planı yok

**Canlı gözlem**

- Canlı paneller demo adlar, test e-postaları/telefonları, eski ve ileri tarihli test düğünleri içeriyor.
- İleri tarihli test düğünleri gerçek uygunluk kontrolünü bloke edebilir.
- Bu denetim iki yeni sentetik kayıt bıraktı:
  - Onaylı başvuru/düğün referansı: `DA-20260812-405440`
  - Pasif salon personeli: `Canli TestSalonDenetim`
- Katalog yalnız Mini Paket içeriyor ve paket/hizmet açıklamalarında `Açıklama belirtilmemiş.` görünüyor.
- Seed mevcut kaydı `update: {}` ile düzeltmiyor: `backend/prisma/seed.ts:111`.

**Tercih edilen strateji**

- [ ] Gerçek üretim verisi yoksa temiz production DB oluştur, migration çalıştır, sadece onaylı gerçek katalog/hesapları seed et.
- [ ] Mevcut DB korunacaksa tablo bazında kayıt envanteri çıkar, bağımlılık sırasını doğrula ve kontrollü cleanup migration/script’i yaz.
- [ ] İşlem öncesi şifreli yedek al ve restore ile doğrula.
- [ ] Admin, salon, müşteri, başvuru, düğün, atama, mesaj, teslimat, audit ve ödeme akışı kayıtlarının test/gerçek ayrımını imzalı listeyle onayla.
- [ ] Temizlik sonrası uygunluk takvimini salon salon manuel kontrol et.

**Kabul ölçütü**

- [ ] Üretimde demo/sentetik ad, telefon, e-posta, referans ve gelecekteki test düğünü kalmıyor.
- [ ] Gerçek admin ve salon hesapları doğrulanıyor; gereksiz test kullanıcıları yok.
- [ ] Katalog iş tarafından onaylanan fiyat/açıklamalarla eşleşiyor.
- [ ] Temizlikten sonra altın yol yeniden çalıştırılıyor.

### P0-06 — Ödeme modu canlı konfigürasyonda zorunlu değil

**Kanıt**

- `PAYMENT_MODE` varsayılanı `test`; production bunu otomatik olarak `live` olmaya zorlamıyor.
- Kod: `backend/src/config/env.config.ts:353`, `backend/src/routes/public.routes.ts:183`.

**Yapılacaklar**

- [ ] Production başlangıcı `PAYMENT_MODE !== live` ise fail-fast olmalı.
- [ ] Canlı banka/ödeme metinleri iş sahibi tarafından çift kontrol edilmeli.
- [ ] Nakit indirimi, kapora tutarı, toplam ve handoff metni aynı kaynakta tutulmalı.
- [ ] Deploy smoke gerçek production config endpointinde `live` durumunu doğrulamalı; hassas değerleri loglamamalı.

### P0-07 — Temiz sunucu kurulum runbook’u eksik ve çelişkili

**Kanıt**

- Deploy README bir yerde env içine secret yazmayı ve eski `BACKUP_ENCRYPTION_KEY` adını söylüyor; başka bölüm file-secret yaklaşımı istiyor.
- Workflow deploy dizinini `/opt/dugun-ajansim/app` olarak sabit kabul ediyor.
- External edge network, `172.30.0.2` trust proxy ve Let’s Encrypt host path izinlerinin kurulumu eksik.
- Kod/doküman: `deploy/README.md:34-40`, `deploy/README.md:186-203`, `.github/workflows/deploy.yml:68-69`.

**Yapılacaklar**

- [ ] Sıfırdan temiz host kurulumu tek ve güncel runbook’a dönüştürülmeli.
- [ ] Kullanıcı, dizin, Docker/Compose sürümü, firewall, volume, external network, secret dosyaları, izinler, log rotasyonu ve TLS adımları açık olmalı.
- [ ] Runbook boş bir sunucuda farklı bir kişi tarafından prova edilmeli.
- [ ] Her adımın beklenen çıktısı ve geri alma yöntemi yazılmalı.

### P0-08 — Forward-only migration hatasında watchdog eski servisi yeniden açabilir

**Kanıt**

- Deploy veri dönüşümünden önce backend/frontend’i durduruyor.
- Forward-only adım başladıktan sonra otomatik rollback kapatılıyor.
- Hata yolunda trafik kapalı kalması amaçlanıyor; fakat watchdog uygulamayı koşulsuz yeniden başlatabiliyor.
- Kod: `.github/workflows/deploy.yml:680-712`, `deploy/watchdog.ps1:110-149` veya eşdeğer watchdog betiği.

**Etki**

- Yeni şemayla uyumsuz eski uygulama yanlışlıkla yeniden açılabilir.
- Veri bozulması veya uzun kesinti riski vardır.

**Yapılacaklar**

- [ ] Forward-only işlem başlamadan önce kalıcı maintenance/failure marker yazılmalı.
- [ ] Watchdog marker varken eski servisi açmamalı.
- [ ] Resume, roll-forward ve manuel müdahale karar ağacı hazırlanmalı.
- [ ] Tatbikatta migration yarıda bilinçli düşürülüp sistem davranışı doğrulanmalı.

### P0-09 — Offsite/immutable yedek, RPO/RTO ve bağımsız restore güvencesi yok

**Olumlu mevcut durum**

- Şifreli yedek ve restore doğrulama betikleri mevcut.
- Backup safety testleri geçti.

**Eksik**

- Yedekler aynı hostta kalırsa host/disk/hesap kaybı hepsini etkiler.
- Yazılı RPO/RTO hedefi ve bağımsız restore tatbikatı yok.

**Yapılacaklar**

- [ ] En az bir şifreli offsite ve mümkünse immutable kopya oluştur.
- [ ] RPO ve RTO’yu iş hedefi olarak yazılı onayla.
- [ ] Ayrı ortamda sıfırdan restore edip veri sayıları ve uygulama altın yolunu doğrula.
- [ ] Yedek yaşı, boyutu, şifreleme ve upload başarısını alarm üretir hale getir.
- [ ] Anahtar kaybı ve anahtar rotasyonu prosedürü hazırla.

### P0-10 — Bağımsız dış izleme ve alarm zinciri yok

**Risk**

- Host içi curl aynı host/dns/network arızasında güvenilir gözlemci değildir.
- 5xx artışı, disk dolması, OOM, sertifika süresi veya yedek başarısızlığı sorumluya ulaşmayabilir.

**Zorunlu alarmlar**

- [ ] Dışarıdan ana sayfa ve health endpoint uptime.
- [ ] Public katalog ve login sayfası sentetik smoke.
- [ ] 5xx oranı ve p95/p99 gecikme.
- [ ] PostgreSQL bağlantı/lock/slow query ve disk kullanımı.
- [ ] Container restart, OOM ve replica sayısı.
- [ ] TLS bitiş süresi ve ACME yenileme.
- [ ] Yedek yaşı, upload ve restore testi.
- [ ] Alarmın gerçek telefon/e-posta/mesaj kanalına ulaştığı test.

### P0-11 — Google keşif ve canonical uç noktaları canlıda eksik

**12 Ağustos 2026 canlı doğrulaması**

| URL                                    | Sonuç                        | Beklenen                                            |
| -------------------------------------- | ---------------------------- | --------------------------------------------------- |
| `https://dugunajansim.com/robots.txt`  | 404 Nginx                    | 200 text/plain + sitemap satırı                     |
| `https://dugunajansim.com/sitemap.xml` | 404 Nginx                    | 200 geçerli XML                                     |
| `https://dugunajansim.com/index.html`  | 200 ve URL aynı kaldı        | Tek adım 301/308 `/`                                |
| `https://www.dugunajansim.com/`        | `ERR_CERT_AUTHORITY_INVALID` | Geçerli TLS + tek adım canonical host yönlendirmesi |
| Rastgele olmayan URL                   | 404                          | 404 — bu davranış doğru                             |

**Yapılacaklar**

- [ ] `robots.txt` oluştur; sitemap URL’sini bildir.
- [ ] Yalnız canonical ve indexlenebilir URL’leri sitemap’e al.
- [ ] `noindex` panel/giriş/işlem sayfalarını sitemap’e alma.
- [ ] `www` sertifikasını kapsa ve path/query korunarak ana hosta yönlendir.
- [ ] `/index.html` → `/` tek adım canonical yönlendirme ekle.
- [ ] HTTP → HTTPS, `www` → non-www ve path matrisini `curl -I`/otomasyonla doğrula.

### P0-12 — Gerçek full-stack release kapısı yok; kritik abuse testleri CI dışında

**Kanıt**

- Playwright statik `127.0.0.1:8000` sunucusunda çalışıyor ve API’leri `page.route(...).fulfill(...)` ile mockluyor.
- Gerçek cookie, CSRF, CORS, proxy, Nginx, API ve PostgreSQL zinciri birlikte test edilmiyor.
- `backend/tests/abuse-security.test.ts` içindeki 6 test hedefli çalıştırmada geçti fakat normal CI komutlarına dahil değil.
- Kod: `playwright.config.js:11-22`, `backend/package.json:17-19`, `backend/tsconfig.test.json:7`.

**Yapılacaklar**

- [ ] Üretim benzeri Compose ortamında gerçek Nginx/API/PostgreSQL ile altın yol testi yaz.
- [ ] Test her koşuda izole sentetik veri oluştursun ve güvenli biçimde temizlesin.
- [ ] Abuse testlerini normal backend CI komutuna ekle.
- [ ] CI başarısızlığında Playwright trace/screenshot/video artifact’larını yükle.
- [ ] Console error, `pageerror`, requestfailed ve beklenmeyen 4xx/5xx için global kapı ekle.

---

## 6. P1 — Ciddi işlevsel ve operasyonel bulgular

### P1-01 — Başvuru arşivle/geri yükle akışı güvenilir değil

- Arşiv ödeme akışı anahtarını siliyor; restore bunu geri üretmiyor.
- Handoff öncesi restore edilen kayıt müşteri tarafından sürdürülemeyebilir ve admin onayında handoff önkoşuluna takılabilir.
- Özel salonlu başvurular `venueId=null` nedeniyle restore edilemeyebilir.
- UI buna rağmen işlemin geri döndürülebilir olduğunu söylüyor.
- Kanıt: `backend/src/routes/admin.routes.ts:393-457`, `backend/src/services/booking.service.ts:631-645`, `backend/src/services/booking.service.ts:1115-1121`, `js/admin/app.js:1367-1388`.

**Kapanış ölçütü:** hazır ödeme akışı, handoff ve özel salon varyantlarında arşiv → restore → onay zinciri gerçek DB entegrasyon testinde geçmeli.

### P1-02 — Onaylı düğün için gerçek iptal akışı yok

- Prisma’da `IPTAL_EDILDI` ve `cancelledAt` var; bunlara yazan tamamlanmış runtime akışı yok.
- Arşivleme düğünü listeden saklıyor fakat bağlı onaylı başvuru takvimi dolu tutabilir.
- Müşteri erişimi devam edebilir.
- Kanıt: `backend/prisma/schema.prisma:21-26`, `backend/src/routes/admin.routes.ts:1278-1398`, `backend/src/routes/customer.routes.ts:32-59`.

**Yapılacaklar**

- [ ] İptal nedeni, iptal eden rol, tarih ve audit kaydı tanımla.
- [ ] Uygunluk takvimini serbest bırakma kuralını açıkla.
- [ ] Atama, mesaj, teslimat ve müşteri erişiminin iptal sonrası durumunu tanımla.
- [ ] Yanlış iptal için kontrollü geri alma prosedürü yaz.

### P1-03 — Onay/red sonrası tanımlı müşteri bildirimi yok

- Red nedeni saklanıyor ancak gönderilecek görev üretilmiyor.
- Onay sonrası anlık karar bildirimi yok; oluşan ilk görevler düğün sonrası tarihlere ait.
- Kanıt: `backend/src/services/booking.service.ts:1202-1283`, `backend/src/services/booking.service.ts:1317-1362`, `js/admin/app.js:1351`.

**Kapanış ölçütü:** onay ve red için şablon, kanal, retry, gönderim kanıtı ve başarısız gönderim kuyruğu tanımlanmış olmalı.

### P1-04 — Teslimat durumlarında geçiş haritası yok

- Admin bütün durumlar arasında ileri/geri sıçrayabilir.
- Teslim tarihi düğünden önceye veya geçmişe yazılabilir.
- Arşivli düğünde bazı teslimat kontrolleri aktif kalır.
- Kanıt: `backend/src/schemas/api.schemas.ts:397`, `backend/src/routes/admin.routes.ts:1413`, `backend/src/routes/admin.routes.ts:2011`, `js/admin/app.js:902-923`.

**Yapılacaklar**

- [ ] İzinli state machine tanımla.
- [ ] Geri dönüşleri yetki + neden + audit ile sınırla.
- [ ] URL açılmadan “teslim edildi” durumuna izin verme.
- [ ] Teslim tarihini düğün tarihi ve hizmet SLA’sıyla doğrula.

### P1-05 — Gelecekteki mesaj görevleri erkenden eyleme açık

- Canlı adminde ileri tarihli WhatsApp görevlerinde `Gönderildi` butonu görünüyordu.
- Backend `dueAt` önkoşulu uygulamıyor.
- Erken aktivasyon linki müşteri aktif olmadığı için 410 dönebilir.

**Kapanış ölçütü:** due zamanı gelmeyen görev kilitli olmalı; override gerekiyorsa ayrı yetki, onay ve audit istemeli.

### P1-06 — Admin genel bakış bugünkü düğünleri render etmiyor

- Kod `.js-today-weddings` hedefini arıyor fakat `admin.html` içinde hedef yok.
- Bugünkü düğün metriği `2` iken kart alanında düğün görünmedi.
- Kanıt: `js/admin/app.js:371-376`, `admin.html:103-181`, `css/admin/admin.css:294-335`.

### P1-07 — Panel başlığı sayfayla birlikte değişmiyor

- Admin alt bölümlerde H1 sürekli `Günün akışı` kalıyor.
- Aktif navigasyon değişse de sayfa bağlamı ekran okuyucu ve kullanıcı için net değil.
- Kanıt: `admin.html:93-95`, `js/admin/app.js:1236-1248`.

### P1-08 — API/form hatalarının bir bölümü yanlış bağlamda veya çok genel gösteriliyor

- Public başvuru hatası gizli adımda.
- Operasyon düğün güncelleme API hatası modal içinde alan bazlı görünmüyor.
- Salon personeli uzmanlığı eksikken yalnız `Girdi doğrulama hatası` gösterildi.
- Admin teslimat/atama hataları modal dışındaki gizli/global alana düşebiliyor.
- Kanıt: `js/operations/app.js:292-304`, `js/operations/app.js:402-441`, `js/admin/app.js:911-923`, `js/admin/app.js:1500-1511`.

**Standart:** hata, hatalı alanın yanında; anlaşılır neden, korunmuş veri ve güvenli tekrar deneme ile görünmeli.

### P1-09 — Mutasyonlarda in-flight kilidi ve güvenilir çift tıklama koruması eksik

- Bazı admin ve salon formları gönderim sırasında butonu kilitlemiyor.
- Çift tıklama duplicate personel/atama/başvuru riski oluşturabilir.
- Kanıt: `js/operations/app.js:365-383`, `js/admin/app.js:1708-1728`, `js/admin/app.js:1745-1772`, `js/admin/app.js:2058-2091`.

**Kapanış ölçütü:** buton loading/disabled, idempotency key ve backend unique/transaction koruması birlikte doğrulanmalı.

### P1-10 — Salon personeli formu ile backend sözleşmesi uyuşmuyor

- UI uzmanlığı zorunlu göstermiyor; backend en az bir uzmanlık bekliyor.
- Ad regex’i nedeniyle rakam reddediliyor fakat kullanıcı nedenini göremiyor.
- Kanıt: `backend/src/schemas/api.schemas.ts:55-69`, `backend/src/schemas/api.schemas.ts:427-434`.

### P1-11 — Doluluk sorgusunda yarış koşulu var

- Tarih/salon/saat hızla değiştiğinde eski uygunluk yanıtı yeni seçimi ezebilir.
- Kanıt: `js/package-builder/application.js:1160-1198`, `js/package-builder/application.js:1250`, `js/package-builder/application.js:1325`, `js/package-builder/application.js:1340`.

**Kapanış ölçütü:** AbortController veya monoton request ID ile yalnız en yeni yanıt uygulanmalı; yavaş ağ testi eklenmeli.

### P1-12 — Turnstile yükleme hatası başvuruyu kalıcı kilitleyebiliyor

- Script yüklenmezse hata katalog yükleme akışıyla aynı catch’e düşebiliyor.
- Güvenli otomatik retry veya kullanıcıya yeniden yükleme eylemi yok.
- Kanıt: `js/package-builder/application.js:243-319`, `js/package-builder/application.js:390-397`.

### P1-13 — Liste sonuçları sessizce kesiliyor

- Başvuru/düğün listeleri 200, mesaj listesi 300 kayıtla sınırlı; pagination veya toplam kayıt bilgisi yok.
- Canlı yoğunluk arttığında eski/önemli kayıtlar “yokmuş” gibi görünebilir.

**Kapanış ölçütü:** cursor/page pagination, toplam kayıt, filtre/sıralama ve boş sayfa geri dönüş testleri eklenmeli.

### P1-14 — Tarih/saat sözleşmesi UI ve backend arasında farklı

- Yayınlanan akış 30 dakikalık adım ve en geç 23:30 kullanıyor.
- Backend her dakikayı 23:59’a kadar kabul edebiliyor.
- Bugünün geçmiş saatine başvuru riski var.
- Kanıt: `backend/src/schemas/api.schemas.ts:22`, `backend/src/services/booking.service.ts:318`, `js/package-builder/application.js:1043`.

### P1-15 — Takvim navigasyonu veri yüklenmeden tetiklenirse hata riski var

- Admin/operasyon önceki/sonraki hafta-ay butonları veri yüklenmeden kullanılabilir.
- API hata durumunda `RangeError`/yakalanmamış hata olasılığı var.
- Kanıt: `js/admin/app.js:220-229`, `js/admin/app.js:1285-1317`, `js/operations/app.js:459-485`.

### P1-16 — Canlı sistem durumu bazı alanlarda statik gösteriliyor

- `Sistem bağlı` ifadesi gerçek health/connection sonucuna bağlı değil.
- Düğün badge sayısı her durumda güncellenmiyor.
- Yanlış güven sinyali üretir.

**Kapanış ölçütü:** status yalnız gerçek API health ve son başarılı veri zamanı ile gösterilmeli.

---

## 7. Google'da “Düğün Ajansım” görünürlüğü ve SEO planı

### 7.1 Mevcut olumlu SEO temeli

- [x] Ana sayfa `lang="tr"`.
- [x] Ana sayfada tek H1 var.
- [x] Title 52, meta description 120 karakter civarında.
- [x] Canonical, Open Graph ve Twitter metadata mevcut.
- [x] Production build canonical placeholder’ı gerçek HTTPS origin ile değiştiriyor.
- [x] Admin, salon, müşteri ve giriş sayfaları `noindex, nofollow`.
- [x] Bilinmeyen rotalar gerçek 404 dönüyor; soft-404 yok.
- [x] Mevcut statik `audit:performance` ve site-content kontrolleri geçti.

### 7.2 Google için zorunlu canlı öncesi işler

#### A. Crawl ve canonical

- [ ] `/robots.txt` 200 dönmeli ve `Sitemap: https://dugunajansim.com/sitemap.xml` içermeli.
- [ ] `/sitemap.xml` 200 dönmeli ve geçerli XML olmalı.
- [ ] Sitemap yalnız 200 dönen, canonical ve indekslenebilir URL’leri içermeli.
- [ ] `/index.html` tek adımda `/` adresine yönlenmeli.
- [ ] `www` geçerli sertifikayla ana hosta tek adımda yönlenmeli.
- [ ] HTTP → HTTPS yönlendirmesi path/query korumalı olmalı.
- [ ] Rastgele URL 404 kalmalı.

Google kaynakları: [Sitemap oluşturma](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [Search Console sitemap gönderimi](https://support.google.com/webmasters/answer/7451001).

#### B. Marka/site adı sinyali

Mevcut JSON-LD yalnız `Organization` içeriyor. Ana sayfaya `WebSite` şeması eklenmeli:

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Düğünajansım",
  "alternateName": ["Düğün Ajansım", "dugunajansim.com"],
  "url": "https://dugunajansim.com/"
}
```

- [ ] Birleşik marka ana isim olarak tutarlı kullanılmalı.
- [ ] `Düğün Ajansım` ayrı yazım varyantı görünür metinde bir kez doğal biçimde geçmeli.
- [ ] Schema Markup Validator ve Search Console render ile kontrol edilmeli.

Google kaynağı: [Site adı yapılandırması](https://developers.google.com/search/docs/appearance/site-names).

#### C. İndekslenebilir hizmet içeriği

- İlk HTML hizmet ve salon içeriği yerine yükleme metni içeriyor: `index.html:690`, `index.html:741`, `index.html:767`.
- Asıl içerik API sonrası JS ile üretiliyor: `js/home/services.js:163-188`, `js/home/venues.js:68-100`.
- Hizmet kartları crawl edilebilir bağlantı değil, dialog açan butonlar: `js/home/services.js:64-94`.

**Yapılacaklar**

- [ ] Hizmet adları ve temel açıklamaları build sırasında HTML’e üret.
- [ ] Fiyat/uygunluk gibi değişken veriyi API ile hydrate et.
- [ ] Ana arama niyetleri için özgün, gerçek içerikli landing sayfaları oluştur.
- [ ] Örnek sayfa niyetleri: düğün fotoğrafçılığı, sinematik düğün filmi, drone çekimi, düğün albümü, İstanbul hizmet bölgesi.
- [ ] Her landing sayfasında benzersiz title, description, tek H1, canonical ve gerçek iç bağlantılar olsun.
- [ ] İçerik sadece kelime varyasyonu değil, hizmet kapsamı, süreç, teslim süresi, örnek senaryo ve SSS ile özgün olmalı.
- [ ] Google URL Inspection rendered HTML’de içerik ve linkleri görmeli.

Google kaynağı: [JavaScript SEO temelleri](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

#### D. Paket oluşturucunun indeksleme kararı

- Builder `noindex, nofollow` ve altı H1 içeriyor.
- İşlem akışı olarak kalacaksa `noindex` korunmalı ve sitemap’e alınmamalı.
- Google’da paket niyetini hedeflemek için ayrı, statik, tek H1’li `/paketler/` landing sayfası tercih edilmeli.

#### E. Yerel işletme görünürlüğü

- [ ] Gerçek işletme adı, telefon, e-posta ve hizmet bölgesi görünür ve tutarlı olmalı.
- [ ] Google Business Profile oluşturulmalı/doğrulanmalı.
- [ ] Profildeki ad, telefon, alan adı ve hizmet bölgesi siteyle birebir eşleşmeli.
- [ ] Gerçek verilere dayanıyorsa `LocalBusiness`, `telephone`, `address`/`areaServed` ve `sameAs` eklenmeli.
- [ ] Footer ve iletişim hedefi gerçek iletişim aksiyonları sunmalı.
- [ ] İşletme bilgisi uydurulmamalı.

Google kaynakları: [Yerel sıralama önerileri](https://support.google.com/business/answer/7091), [LocalBusiness structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business).

#### F. Search Console ve ölçüm

- [ ] Search Console’da `dugunajansim.com` Domain Property aç.
- [ ] DNS TXT ile doğrula ve doğrulama kaydını kalıcı tut.
- [ ] Sitemap’i gönder; `Success`/keşfedilen URL sayısını kaydet.
- [ ] `/` ve landing sayfalarında URL Inspection çalıştır.
- [ ] Render edilmiş HTML, canonical seçimi ve index eligibility kontrol et.
- [ ] Pages, Manual Actions, Security Issues ve Core Web Vitals raporlarını incele.
- [ ] Gerekli URL’ler için `Request indexing` kullan; bunun sıralama garantisi olmadığını kabul et.
- [ ] GA4 veya seçilen ölçümde `page_view`, paket başlangıcı, başvuru başarı/hata sonucu ve WhatsApp tıklaması ölçülsün.
- [ ] Event’lere ad, telefon, e-posta veya form notu gönderilmesin.

Google kaynağı: [Search Console DNS doğrulaması](https://support.google.com/webmasters/answer/9008080).

#### G. Core Web Vitals

Mevcut `npm run audit:performance` Lighthouse değildir; HTML kural/bütçe kontrolüdür.

- [ ] Mobil soğuk-cache Lighthouse/PageSpeed çalıştır.
- [ ] Hedef: LCP ≤ 2,5 sn.
- [ ] Hedef: INP < 200 ms.
- [ ] Hedef: CLS < 0,1.
- [ ] Ana sayfa ve her indekslenebilir landing sayfasını ayrı ölç.
- [ ] Canlı sonrası Search Console alan verisini haftalık izle.

Google kaynağı: [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals).

### 7.3 SEO regresyon testleri

- [ ] Canonical mutlak HTTPS ve production origin olmalı.
- [ ] Build çıktısında `__APP_ORIGIN__` kalmamalı.
- [ ] `WebSite` ve `Organization` JSON-LD parse edilmeli.
- [ ] OG/Twitter zorunlu alanları doğrulanmalı.
- [ ] `robots.txt` ve sitemap status/içeriği test edilmeli.
- [ ] Sitemap URL’leri 200, canonical ve indexlenebilir olmalı.
- [ ] Panel/giriş sayfalarının `noindex` etiketi korunmalı.
- [ ] `www`, HTTP ve `/index.html` yönlendirmeleri test edilmeli.
- [ ] Bilinmeyen rota 404 dönmeli.
- [ ] Her indekslenebilir sayfada tek görünür H1 ve benzersiz metadata olmalı.

---

## 8. Test aşamasından kalma veri, metin ve alanlar

### 8.1 Canlı veri temizliği envanteri

- [ ] Bütün başvuruları `reference/status/createdAt/contact fingerprint/deletedAt` alanlarıyla envanterle.
- [ ] Bütün düğünleri `reference/date/venue/status/deletedAt` alanlarıyla envanterle.
- [ ] İleri tarihli test düğünlerinin salon uygunluğunu bloke etmediğini doğrula; tercihen temizle.
- [ ] Demo/test admin, salon ve müşteri hesaplarını ayıkla.
- [ ] Test personellerini ve atamalarını temizle.
- [ ] Mesaj görevleri, teslimatlar ve audit kayıtlarını bağlı kayıtlarla birlikte değerlendir.
- [ ] Arşivli/silinmiş kayıtları da dahil et; yalnız aktif listeye bakma.
- [ ] Bu denetimin `DA-20260812-405440` referansını temizle.
- [ ] Bu denetimin pasif `Canli TestSalonDenetim` personelini temizle.
- [ ] Public başarısız denemesi için backend logunda yetim/yarım kayıt oluşmadığını doğrula.
- [ ] Temizlikten sonra salon bazında takvim ve bekleyen başvuru sayısını yeniden doğrula.

### 8.2 Görülen test/placeholder içerikleri

- [ ] Karakter bozulması görülen `Ay?e` benzeri kayıtları UTF-8 kaynağında düzelt veya temizle.
- [ ] `CanliTest`, `UctanUca`, `demo-*` ve açıkça sentetik ad/e-posta/telefonları temizle.
- [ ] `Elif Yılmaz & Can Demir` gibi demo çiftlerin gerçekten yayın ortamında kalıp kalmayacağını kararlaştır; testse temizle.
- [ ] Paket ve hizmetlerdeki `Açıklama belirtilmemiş.` metinlerini gerçek açıklamalarla tamamla.
- [ ] Ana sayfa/giriş sayfasındaki `8.Yıl` ve `10.Yıl` çelişkisini tek doğrulanmış değerle düzelt.
- [ ] 2026 tarihli çekim/portföy metinlerinin gerçek içerikle eşleştiğini iş sahibiyle onayla.
- [ ] `Sistem bağlı` gibi statik durum metinlerini gerçek health verisine bağla.
- [ ] Gelecek tarihli test mesajları ve “Gönderildi” durumlarını temizle.
- [ ] Katalogdaki tek Mini Paket ve 8 hizmet/7 salon verisini gerçek fiyat listesiyle karşılaştır.
- [ ] Girişte şifre kurtarma metnine gerçek iletişim kanalı/akışı ekle.
- [ ] `#iletisim` hedefinde kullanıcıyı gerçekten iletişime götüren telefon/e-posta/WhatsApp aksiyonlarını doğrula.

### 8.3 Temizlik sonrası zorunlu kontrol

- [ ] Ana sayfa fiyat başlangıcı gerçek katalogla eşleşiyor.
- [ ] Paket toplamı backend snapshot fiyatıyla eşleşiyor.
- [ ] Her salonun uygunluk takvimi boş/gerçek rezervasyonlarla doğru.
- [ ] Admin dashboard sayaçları detay listeleriyle eşleşiyor.
- [ ] Salon yetkilisi yalnız kendi salonunu ve gerçek personelini görüyor.
- [ ] Müşteri yalnız kendi düğününü görüyor.
- [ ] Test e-posta/telefonu log, analytics ve alarm sistemlerinde kalmıyor.

---

## 9. Zorunlu işlev test matrisi

### 9.1 Public başvuru

- [ ] Katalog başarılı yükleniyor.
- [ ] Katalog 4xx/5xx/offline durumunda eski veya uydurma fiyat göstermiyor.
- [ ] Her hizmet ekleme/çıkarma toplamı doğru.
- [ ] Nakit indirimi yuvarlama dahil doğru.
- [ ] Kapora toplamı ve kalan tutar doğru.
- [ ] Özel salon alanı yalnız ilgili seçimde zorunlu.
- [ ] Geçmiş tarih ve geçmiş saat reddediliyor.
- [ ] 30 dakikalık saat politikası UI ve backend’de aynı.
- [ ] Dolu salon/saat doğru engelleniyor.
- [ ] İki kullanıcı aynı slotu aynı anda seçtiğinde yalnız biri başarılı oluyor.
- [ ] Yavaş eski uygunluk yanıtı yeni seçimi ezmiyor.
- [ ] Turnstile başarılı, expired, error ve script-load-fail senaryoları çalışıyor.
- [ ] 429 durumunda kalan süre ve tekrar deneme anlatılıyor.
- [ ] Çift tıklama tek kayıt üretiyor.
- [ ] Ağ kesilip geldiğinde form verisi korunuyor.
- [ ] Sayfa yenileme ve geri/ileri ödeme akışını bozmuyor.
- [ ] Başarılı başvuru referansı görünür ve kopyalanabilir.
- [ ] Başvuru admin kuyruğunda aynı fiyat/salon/tarih/iletişimle bulunuyor.

### 9.2 Admin başvurular

- [ ] Liste, arama, durum filtresi ve pagination.
- [ ] Manuel başvuru oluşturma.
- [ ] Public başvuru detayını açma.
- [ ] Onaylama.
- [ ] Red + neden + müşteri bildirimi.
- [ ] Arşivleme.
- [ ] Geri yükleme: handoff öncesi/sonrası ve özel salon varyantı.
- [ ] Kalıcı silme step-up + MFA + audit.
- [ ] Aynı başvuruyu iki admin eşzamanlı işlerse transaction/409 davranışı.
- [ ] Onay sonrası düğün, teslimat ve doğru mesaj görevlerinin oluşması.

### 9.3 Admin düğün ve takvim

- [ ] Düğün arama/filtre/pagination.
- [ ] Bugünkü düğün sayısı ile kartların eşleşmesi.
- [ ] Haftalık plan önceki/sonraki/bugün.
- [ ] Salon takvimi ay geçişi.
- [ ] Düğün düzenleme.
- [ ] Salon/saat çakışması ve override prosedürü.
- [ ] Gerçek iptal ve takvimi serbest bırakma.
- [ ] Arşivle/geri al/kalıcı sil.
- [ ] Arşivli kayıtta mutasyon kontrollerinin kapanması.

### 9.4 Admin personel ve atamalar

- [ ] Personel oluşturma, düzenleme, pasifleştirme, aktifleştirme, silme.
- [ ] Telefon tekrarında sözleşmeye uygun davranış.
- [ ] Uzmanlık zorunluluğu ve alan bazlı hata.
- [ ] Düğüne atama ekleme/çıkarma.
- [ ] Aynı personelin çakışan düğüne atanmasının engellenmesi.
- [ ] Yetkili override varsa neden ve audit.
- [ ] Pasif personelin yeni atamada seçilememesi.

### 9.5 Salon yetkilisi

- [x] Login.
- [x] Kendi salon dashboard’u.
- [x] Haftalık plan ve takvim.
- [x] Düğün detayını açma.
- [x] Personel oluşturma/düzenleme/aktiflik.
- [x] Atama ekleme/çıkarma.
- [x] Başka role geçişin engellenmesi.
- [ ] Başka salon ID’sine doğrudan API erişiminin 403/404 olması.
- [ ] Düğün düzenleme mutasyonunun gerçek başarılı kaydı.
- [ ] İki salon yetkilisinin eşzamanlı atama yarışı.
- [ ] Oturum süresi dolması ve logout sonrası cache/back davranışı.

### 9.6 Müşteri

- [ ] Aktivasyon linki üretme ve doğru mesaj.
- [ ] Token süresi dolma/tek kullanımlık olma.
- [ ] Parola belirleme.
- [ ] Doğru/yanlış login ve rate limit.
- [ ] Kendi düğün detayını görme.
- [ ] Başka müşterinin ID’sine erişememe.
- [ ] Teslimat aşamalarını doğru görme.
- [ ] Hazır olmayan linkin gizli kalması.
- [ ] Teslim edilen linkin açılması ve gerçek yetki.
- [ ] Süresi dolmuş/geri çekilmiş link davranışı.
- [ ] Parola değiştirme.
- [ ] Şifre kurtarma gerçek kanal/tek kullanımlık bağlantı.
- [ ] Idle timeout, logout ve geri tuşu.

### 9.7 Katalog CRUD

- [ ] Hizmet oluştur/düzenle/pasifleştir/sil.
- [ ] Hizmet aktifliği public kartları ve mevcut snapshot fiyatlarını doğru etkiliyor.
- [ ] Paket oluştur/düzenle/pasifleştir/sil.
- [ ] Paketten hizmet ekle/çıkar ve fiyat toplamı.
- [ ] Salon oluştur/düzenle/pasifleştir/sil.
- [ ] Silme bağımlılıklarında anlaşılır 409/hata.
- [ ] API yüklenmezse form constraint’leri güvenli biçimde kapanıyor.

### 9.8 Mesaj ve teslimat

- [ ] Aktivasyon mesajını render etmeden gönderildi yapılamıyor.
- [ ] `dueAt` gelmeden normal eylem kapalı.
- [ ] Render edilen link doğru kullanıcıya ait.
- [ ] WhatsApp açma ve gönderildi işaretleme ayrı ve açık adımlar.
- [ ] Retry/başarısız gönderim kuyruğu.
- [ ] Teslimat state machine izinli geçişleri.
- [ ] Drive/dosya URL doğrulaması.
- [ ] Teslim etmeden önce URL erişim smoke’u.
- [ ] Müşteride açılma testi.
- [ ] Geri çekme ve audit.

---

## 10. DevTools Console/Network zorunlu testi

Canlı Chrome turunda kontrol edilen ekranların Console’unda beklenmeyen hata görülmedi. Buna rağmen public başvuru başarısızlığı, console temizliğinin tek başına yeterli olmadığını gösterdi. Aşağıdaki test release adayı üzerinde DevTools Network ile kayda alınmalıdır.

### Hazırlık

- [ ] DevTools → Network → `Preserve log` açık.
- [ ] `Disable cache` açık; ayrıca warm-cache turu yapılacak.
- [ ] Fetch/XHR filtresi ve All filtresi ayrı kontrol edilecek.
- [ ] Console’da Preserve log açık.
- [ ] Her ana akış için HAR veya ekran kaydı saklanacak; hassas form verileri paylaşılmadan maskeleme yapılacak.

### Her istek için kontrol

- [ ] URL, method ve status beklenen değerde.
- [ ] Redirect zinciri gereksiz adım içermiyor.
- [ ] Response content-type doğru.
- [ ] 4xx/5xx gövdeleri kullanıcıya uygun hata kodu taşıyor.
- [ ] Request/correlation ID response ve backend logunda eşleşiyor.
- [ ] CORS origin/credentials doğru.
- [ ] Cookie’ler `Secure`, `HttpOnly`, uygun `SameSite`, domain/path ve süreyle geliyor.
- [ ] CSRF mekanizması gerçek mutasyonlarda çalışıyor.
- [ ] Beklenmeyen pending/cancelled/requestfailed yok.
- [ ] Aynı tıklama duplicate POST üretmiyor.
- [ ] Response içinde stack trace, secret veya gereksiz kişisel veri yok.
- [ ] Cache-control API ve statik dosya için doğru.
- [ ] Büyük payload veya gereksiz tekrarlı istek yok.

### Özellikle public POST için

- [ ] Başarısız canlı isteğin gerçek HTTP statusu kaydedilsin.
- [ ] Response error code ve request ID kaydedilsin.
- [ ] Aynı request ID backend logunda bulunup kök neden yazılsın.
- [ ] Düzeltmeden sonra aynı payload yeni test kimliğiyle başarılı olsun.
- [ ] Public başarı response’u ile admin listesi/DB kaydı birebir eşleşsin.

### Negatif ağ senaryoları

- [ ] Offline.
- [ ] Slow 4G / yüksek latency.
- [ ] Request timeout.
- [ ] Backend 500.
- [ ] 429 rate limit.
- [ ] Turnstile script/domain başarısızlığı.
- [ ] API response gecikmesiyle yarış koşulu.
- [ ] Sekmeyi kapatma/yenileme sırasında yarım POST.

---

## 11. Erişilebilirlik ve cihaz matrisi

### Bilinen eksikler

- Mobil admin/operasyon drawer butonunda `aria-expanded`, `aria-controls`, focus yönetimi ve arka içeriği inert yapma eksikleri var.
- Aktif navigasyon için `aria-current` tutarlı değil.
- Bazı dialoglarda `aria-labelledby`/focus trap/Escape davranışı eksik olabilir.
- Hizmet kartlarındaki `İncele →` butonlarının erişilebilir adı hizmet ismini taşımıyor.
- Medya ses kontrollerinin klavye ve ekran okuyucu davranışı iyileştirilmeli.
- Axe yalnız `critical` seviyeyi fail ediyor; serious/moderate ihlaller CI’dan geçebilir.

### Zorunlu cihaz/tarayıcı matrisi

| Ortam                     | Zorunlu akışlar                                             |
| ------------------------- | ----------------------------------------------------------- |
| Desktop Chrome            | Bütün altın yol + tüm CRUD smoke                            |
| Desktop Firefox           | Public başvuru, login, admin/salon temel operasyon          |
| Desktop Edge              | Public başvuru, admin, dosya/WhatsApp açma                  |
| Safari/WebKit             | Public başvuru, tarih/saat, login, müşteri teslimat         |
| Gerçek Android Chrome     | Menü, paket builder, form, klavye, modal, ödeme adımı       |
| Gerçek iPhone Safari      | Menü, paket builder, date/time, viewport, sticky CTA, modal |
| 320 px dar ekran          | Yatay taşma, form ve dialog kullanılabilirliği              |
| Tablet portrait/landscape | Navigasyon breakpoint ve takvimler                          |

### Klavye/ekran okuyucu kontrolü

- [ ] Tüm işlevlere yalnız klavyeyle erişim.
- [ ] Görünür focus göstergesi.
- [ ] Modal açılınca focus modal içine gider; kapanınca tetikleyiciye döner.
- [ ] Escape yalnız güvenli dialogu kapatır.
- [ ] Hata mesajı `aria-describedby`/live region ile okunur.
- [ ] Drawer açık/kapalı durumu duyurulur.
- [ ] Başlık hiyerarşisi sayfa bağlamını doğru verir.
- [ ] Renk kontrastı WCAG AA.

---

## 12. Test altyapısı ve kalite kapıları

### Mevcut kapsam

- Frontend statik/operasyon sözleşmeleri: **44 Node testi**.
- Playwright: **47 benzersiz senaryo**, desktop/mobil Chromium projeleriyle **93 keşfedilen yürütme**.
- Backend birim: **74 test**.
- PostgreSQL entegrasyon: **11 üst seviye test**.
- Runtime role/RLS HTTP: **4 test**.
- Normal CI backend toplamı: **89 test**.
- CI dışında kalan abuse: **6 test**.

### Güçlü alanlar

- `skip`, `only`, `todo`, `fixme` bulunmadı.
- Temel frontend lint/HTML/style/cache/deploy sözleşmeleri var.
- Backend DB entegrasyonları fiyat, çakışma, onay ve rol izolasyonunun önemli bölümünü kapsıyor.
- Playwright trace/video/screenshot ayarı mevcut.
- File-secret, backup safety ve deploy health doğrulamaları mevcut.

### Eksikler ve flaky riskleri

- [ ] Gerçek full-stack browser E2E yok; API’ler mock.
- [ ] Yalnız Chromium; Firefox/WebKit yok.
- [ ] `reuseExistingServer: true` yanlış sunucuya bağlanma riski taşıyor.
- [ ] Sabit `waitForTimeout` beklemeleri var.
- [ ] TOTP testleri gerçek saate/30 saniye penceresine bağlı.
- [ ] Büyük DB entegrasyon testi tek blok; erken hata sonraki kontrolleri atlıyor.
- [ ] Global console/network hata kapısı yok.
- [ ] Axe yalnız critical ihlali fail ediyor.
- [ ] Kod kapsamı ve minimum branch/line threshold yok.
- [ ] CI Playwright artifact upload etmiyor.
- [ ] `audit:performance` gerçek Lighthouse/CWV değil.
- [ ] Production hardening testi container/Compose/Nginx çalıştırmıyor; çoğunlukla string sözleşmesi.
- [ ] Migration yalnız temiz DB’de değil, production clone üzerinde de prova edilmeli.

### Release için önerilen altın yol otomasyonu

```text
public başvuru
  → admin kuyruğunda görünme
  → admin onay
  → aktivasyon mesajı/token
  → müşteri parola belirleme ve login
  → salon takviminde düğün
  → salon personel atama/çıkarma
  → admin teslimat durumu ve test URL'si
  → müşteri panelinden teslimatı açma
```

Bu test:

- [ ] Gerçek Nginx/API/PostgreSQL kullanmalı.
- [ ] Mock route kullanmamalı.
- [ ] İzole sentetik kimlik üretmeli.
- [ ] Başarı/başarısızlıkta güvenli cleanup yapmalı.
- [ ] Console, pageerror, requestfailed ve beklenmeyen HTTP durumlarını fail etmeli.
- [ ] Desktop Chrome ve en az WebKit projesinde koşmalı.

---

## 13. Dağıtım, altyapı ve işletim kontrol listesi

### 13.1 Mevcut olumlu kontroller

- [x] Deploy yalnız quality-checked `main` SHA’sını hedefliyor.
- [x] Dirty tree reddediliyor.
- [x] SSH action SHA ile sabitlenmiş.
- [x] File-secret yaklaşımı doğrulanıyor.
- [x] Şifreli yedek ve restore doğrulaması mevcut.
- [x] Forward-only aşamadan önce rollback desteği var.
- [x] Healthcheck, backend replica ve resource limitleri var.
- [x] `validate:backup-safety`, `validate:file-secrets`, `validate:deploy-health` hedefli kontrolleri geçti.
- [x] Uygulama ve edge Compose parse kontrolleri geçti.

### 13.2 Canlı öncesi altyapı işleri

- [ ] Temiz-host runbook tamamla ve prova et.
- [ ] Docker/Compose sürümlerini sabitle/doğrula.
- [ ] Production host kullanıcı/izin/sudo modelini yaz.
- [ ] Firewall yalnız gerekli portları açsın.
- [ ] SSH erişimi, anahtar rotasyonu ve break-glass prosedürü doğrulansın.
- [ ] External Docker network ve sabit trust proxy davranışı doğrulansın.
- [ ] Secret dosya sahipliği/izinleri doğrulansın.
- [ ] Production env içinde placeholder/test değer bulunmasın.
- [ ] `PAYMENT_MODE=live` fail-fast kapısı.
- [ ] `APP_DOMAIN=dugunajansim.com`; `www` canonical route ayrıca tanımlı.
- [ ] AAAA kaydı varsa IPv6 gerçekten sunuluyor; yoksa yanlış AAAA kaldırılmış.
- [ ] TLS sertifikası ana ve `www` hostlarını kapsıyor.
- [ ] ACME yenileme ve sertifika süresi alarmı var.
- [ ] Log rotasyonu ve disk kotası var.
- [ ] DB volume, upload/temp alanı ve yedek hedefi kapasitesi ölçüldü.
- [ ] Saat/NTP senkronu doğrulandı; MFA/TOTP buna bağlı.

### 13.3 Veritabanı ve migration

- [ ] Production clone üzerinde migration dry-run/prova.
- [ ] Migration süresi ve lock etkisi ölçüldü.
- [ ] Forward-only başlangıç noktası açıkça loglanıyor.
- [ ] Maintenance marker watchdog tarafından saygı görüyor.
- [ ] Resume/roll-forward runbook’u var.
- [ ] Migration öncesi yedek restore edilmiş ve doğrulanmış.
- [ ] Runtime DB rolünün least-privilege testleri geçiyor.
- [ ] Connection pool limiti DB kapasitesiyle uyumlu.
- [ ] Slow query ve lock alarmı var.

### 13.4 İmaj ve release bütünlüğü

- [ ] CI gerçek production image’larını build ediyor.
- [ ] Compose ile container’ları ayağa kaldırıp Nginx/API/DB smoke çalıştırıyor.
- [ ] İmaj registry’de immutable digest ile saklanıyor.
- [ ] Deploy edilen container’ın commit SHA/digest’i health veya metadata ile doğrulanıyor.
- [ ] Rollback imajı yalnız host local cache’ine bağlı değil.
- [ ] Base image güncellemeleri reproducible; build içinde kontrolsüz `apk upgrade` gibi değişkenlik azaltılıyor.

### 13.5 Kapasite ve dayanıklılık

- [ ] Public katalog ve başvuru için beklenen peak yük tanımlandı.
- [ ] Login, admin listeleme ve takvim için yük testi yapıldı.
- [ ] PostgreSQL CPU/RAM/IOPS ve connection sınırları ölçüldü.
- [ ] Rate limit gerçek proxy IP zincirinde doğru çalışıyor.
- [ ] Disk dolu, DB bağlantı kaybı, container restart ve tek replica kaybı tatbikatı yapıldı.
- [ ] Tek host arızasının kabul edilen iş riski olup olmadığı yazılı onaylandı.

---

## 14. Olası durumlar ve kenar senaryoları

### Başvuru ve ödeme

- Kullanıcı gönder butonuna çift tıklar.
- Kullanıcı gönderim sırasında sekmeyi kapatır veya yeniler.
- Turnstile tokenı gönderimden hemen önce biter.
- WhatsApp açılır fakat mesaj gönderilmez.
- Mesaj gönderilir fakat admin 60+ dakika bakmaz.
- Aynı telefon/e-posta kısa sürede tekrar başvurur.
- İki çift son uygun slotu aynı anda alır.
- Fiyat kullanıcı formu açıkken admin tarafından değiştirilir.
- Public toplam ile backend snapshot toplamı farklı çıkar.
- Nakit/kapora arasında hızla geçiş yapılır.
- Banka/handoff metni yanlış environment’dan gelir.

### Tarih, saat ve takvim

- Bugünün geçmiş saati seçilir.
- Gece yarısını aşan organizasyon girilir.
- Başlangıç ve bitiş eşit veya ters olur.
- 30 dakika dışı dakika doğrudan API’ye gönderilir.
- Tarayıcı timezone’u İstanbul dışında olur.
- UTC ile oluşturulan referans tarihi yerel tarihten farklı görünür.
- İptal/arşiv sonrası slot yanlışlıkla dolu kalır.
- Aynı personel çakışan iki salona atanır.

### Oturum ve hesap

- Müşteri aktivasyon linkini erken açar.
- Admin link üretmeden “Gönderildi” işaretler.
- Token kullanılmış veya süresi dolmuş olur.
- MFA cihaz saati kaymıştır.
- Kullanıcı geri tuşuyla cache’lenmiş korumalı ekrana döner.
- Aynı hesap iki cihazda açıktır; parola değişir.
- Salon yetkilisi URL/ID değiştirerek başka salon verisini ister.
- Müşteri başka düğün/teslimat ID’sini dener.

### Teslimat

- URL hatalı, erişim izni kapalı veya link süresi bitmiş olur.
- Admin URL’yi doğrulamadan teslim edildi yapar.
- Durum geriye alınır fakat müşteri eski linki açmaya devam eder.
- Teslim tarihi düğünden önce girilir.
- Müşteri paneli tarayıcı timezone’unda gecikmeyi `0 gün` gösterir.

### Altyapı

- Deploy migration ortasında kesilir.
- Watchdog maintenance sırasında eski servisi açar.
- DB veya disk dolar.
- Container OOM ile tekrar başlar.
- DNS TTL nedeniyle kullanıcıların bir kısmı eski hosta gider.
- `www` sertifikası yenilenmez.
- ACME rate limit/yenileme hatası olur.
- Aynı host ve aynı diskteki uygulama ile yedek birlikte kaybolur.
- Alarm sistemi aynı hostla birlikte erişilemez hale gelir.
- CDN/browser eski JS’i, API yeni sözleşmeyi kullanır.

Her senaryo için beklenen sonuç, kullanıcı mesajı, retry/idempotency davranışı, log/metric ve sorumlu belirlenmelidir.

---

## 15. Canlıya geçiş zaman çizelgesi

### T-14 ile T-7 gün

- [ ] P0-01 public başvuru kök nedeni ve düzeltmesi tamamlandı.
- [x] TTL/veri kaybı kuralı düzeltildi.
- [ ] Full-stack altın yol staging’de çalışıyor.
- [ ] Müşteri rolü uçtan uca geçti.
- [ ] Veri cutover stratejisi ve cleanup script/migration’ı onaylandı.
- [ ] Temiz-host runbook ve forward-only failure tatbikatı tamamlandı.
- [ ] Offsite yedek ve bağımsız restore tamamlandı.
- [ ] External monitoring ve alarm alıcıları test edildi.
- [ ] SEO teknik uç noktaları staging’de geçti.

### T-7 ile T-2 gün

- [ ] Production benzeri yük ve CWV ölçümü.
- [ ] Chrome, Firefox, WebKit, Android ve iPhone smoke.
- [ ] Bütün rol/route 401/403/404 matrisi.
- [ ] Katalog fiyat/açıklama iş onayı.
- [ ] Google Business Profile ve işletme bilgilerinin tutarlılığı.
- [ ] Search Console DNS doğrulama hazırlığı.
- [ ] DNS TTL düşürme kararı ve zamanlaması.
- [ ] Go-live/rollback sorumluları ve iletişim kanalı.

### T-1 gün

- [ ] Main dalı ve release SHA donduruldu.
- [ ] CI tamamen yeşil; abuse testleri dahil.
- [ ] Production image digest kaydedildi.
- [ ] Şifreli yedek alındı, offsite kopya doğrulandı.
- [ ] Test verisi envanteri son kez imzalandı.
- [ ] Secret/env checklist çift kişiyle kontrol edildi.
- [ ] `PAYMENT_MODE=live` doğrulandı.
- [ ] Sertifika ana + `www` kapsamı doğrulandı.
- [ ] Bakım/geri dönüş mesajları hazırlandı.

### T0 — dağıtım

- [ ] Bakım penceresi başlatıldı.
- [ ] Preflight health, disk, DB ve yedek kontrolü.
- [ ] Hedef commit SHA/digest doğrulandı.
- [ ] Migration ve gerekiyorsa kontrollü cleanup çalıştı.
- [ ] Migration sonucu ve satır/veri sayıları doğrulandı.
- [ ] Container health ve revision doğrulandı.
- [ ] Ana sayfa/katalog/login salt-okunur smoke.
- [ ] Public sentetik başvuru oluşturuldu ve adminde görüldü.
- [ ] Admin onay → müşteri aktivasyon/login geçti.
- [ ] Salon takvimi/atama geçti.
- [ ] Teslimat test linki müşteride açıldı.
- [ ] Test kayıtları güvenli cleanup ile kaldırıldı.
- [ ] DNS/canonical/robots/sitemap/TLS kontrolleri geçti.
- [ ] Search Console sitemap gönderildi ve ana URL inspection yapıldı.

### T+1 saat

- [ ] 4xx/5xx, latency, DB connection, restart, OOM ve disk metrikleri normal.
- [ ] İlk gerçek başvuru varsa admin görünümü ve bildirim prosedürü doğrulandı.
- [ ] Herhangi bir başvurunun cleanup tarafından silinmediği kontrol edildi.
- [ ] Alarm kanalı test mesajı aldı.
- [ ] Yedek işi planlı zamanda çalıştı.

### T+24 saat

- [ ] Başvuru sayısı, başarı/hata oranı ve drop-off incelendi.
- [ ] Admin/salon operasyon geri bildirimi alındı.
- [ ] Search Console crawl/indexing ve sitemap durumu kontrol edildi.
- [ ] Loglarda tekrarlı 4xx/5xx ve yavaş endpointler incelendi.
- [ ] Test/sentetik kayıt kalmadığı doğrulandı.
- [ ] Incident/iyileştirme notları backlog’a işlendi.

### T+7 gün

- [ ] Core Web Vitals ilk saha sinyalleri incelendi.
- [ ] Google index coverage ve marka sorgusu takip edildi.
- [ ] Yedek restore tatbikatının kayıtları arşivlendi.
- [ ] Tekrarlayan operasyon hataları ve destek talepleri sınıflandırıldı.

---

## 16. Rollback ve acil durum karar matrisi

| Belirti                                 | İlk eylem                                                   | Rollback/roll-forward kararı                                                                          |
| --------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Public başvuru 5xx veya kayıt oluşmuyor | Trafiği/basvuruyu kontrollü durdur, request ID ve log topla | Schema değişmediyse son sağlam digest’e rollback; forward-only başladıysa runbook’a göre roll-forward |
| Migration başarısız                     | Maintenance marker’ı koru, watchdog açılmasını engelle      | Otomatik eski sürüm açma; migration uzmanı karar verir                                                |
| DB veri doğrulama farkı                 | Yazma trafiğini durdur, yedek ve audit’i koru               | Restore/roll-forward kararı veri sahibinin onayıyla                                                   |
| 5xx oranı eşik üstü                     | Alarm, deploy freeze, hızlı tanı                            | Değişiklikle korelasyon varsa rollback; DB şema uyumu kontrolü şart                                   |
| TLS/canonical erişim sorunu             | DNS/TLS sorumlusunu çağır                                   | Uygulama rollback’i yerine edge düzeltmesi gerekebilir                                                |
| Disk/OOM                                | Yazma ve log büyümesini kontrol et                          | Kapasite/limit düzelt; veri silme rastgele yapılmaz                                                   |
| Müşteri linkleri açılmıyor              | Yeni teslimat yayınını durdur                               | Uygulama/URL izin kök nedenine göre roll-forward                                                      |
| Başvuru cleanup kaybı                   | Cleanup job’u durdur, yedek/log koru                        | Kayıtları doğrulanmış kaynaktan geri getir; olay kaydı aç                                             |

### Rollback önkoşulları

- [ ] Son sağlam image digest biliniyor ve registry’de mevcut.
- [ ] Eski uygulamanın yeni DB şemasıyla uyumu kanıtlı.
- [ ] Forward-only marker ve karar noktası loglanıyor.
- [ ] Restore komutları tahmine değil güncel runbook’a dayanıyor.
- [ ] Rollback sonrası aynı altın yol smoke’u çalışıyor.

---

## 17. Sign-off / çıkış kapıları

| Kapı                                    | Sorumlu             | Kanıt                                   | Durum           |
| --------------------------------------- | ------------------- | --------------------------------------- | --------------- |
| Public başvuru gerçek API/DB’de geçiyor | Frontend + Backend  | HAR/request ID + admin referansı + test | AÇIK            |
| TTL veri kaybı düzeltildi               | Backend             | Entegrasyon testi + 24 saat test kaydı  | KAPALI — Faz 02 |
| Müşteri altın yolu geçiyor              | Ürün + QA           | Aktivasyon/login/teslimat kaydı         | AÇIK            |
| Test verisi temiz/cutover tamam         | Backend + Operasyon | İmzalı envanter + backup + sayaçlar     | AÇIK            |
| Payment live konfigürasyonu             | Backend + İş sahibi | Production config smoke + fiyat onayı   | AÇIK            |
| Deploy/recovery tatbikatı               | DevOps              | Temiz-host ve failure drill kaydı       | AÇIK            |
| Offsite backup/restore                  | DevOps              | Ayrı ortam restore raporu               | AÇIK            |
| External monitoring/alarmlar            | DevOps              | Test alarmı ve dashboard                | AÇIK            |
| SEO teknik kapıları                     | SEO + DevOps        | 200/redirect matrisi + Search Console   | AÇIK            |
| Full-stack CI altın yolu                | QA + Backend        | CI run linki/artifact                   | AÇIK            |
| Cihaz/tarayıcı matrisi                  | QA                  | Test run sonuçları                      | AÇIK            |
| İş içeriği/katalog onayı                | İş sahibi           | Fiyat/hizmet/salon imzası               | AÇIK            |

**GO kararı ancak bütün P0 satırları KAPALI olduğunda, her satırın kanıt bağlantısı bulunduğunda ve release SHA’sı değişmediğinde verilebilir.** P0 kapandıktan sonra kod veya production config değişirse ilgili kapılar yeniden test edilir.

---

## 18. Kaynak kanıt dizini

### Public/frontend

- `js/package-builder/application.js:243-319`
- `js/package-builder/application.js:882-899`
- `js/package-builder/application.js:1160-1198`
- `js/package-builder/application.js:1389-1390`
- `paketini-olustur.html:719-723`
- `js/admin/app.js:371-376`
- `js/admin/app.js:1089-1093`
- `js/admin/app.js:1236-1248`
- `js/operations/app.js:292-304`
- `js/operations/app.js:365-441`

### Backend/veri akışları

- `backend/src/services/booking.service.ts:631-733`
- `backend/src/services/booking.service.ts:1115-1362`
- `backend/src/routes/admin.routes.ts:336-494`
- `backend/src/routes/admin.routes.ts:1278-1413`
- `backend/src/routes/admin.routes.ts:2011`
- `backend/src/routes/admin.routes.ts:2523-2650`
- `backend/src/routes/customer.routes.ts:32-59`
- `backend/src/config/env.config.ts:353-358`
- `backend/prisma/schema.prisma:21-26`
- `backend/prisma/seed.ts:111`

### SEO/edge

- `index.html:8-43`
- `index.html:690-767`
- `index.html:1060-1110`
- `js/home/services.js:64-94`
- `js/home/services.js:163-188`
- `js/home/venues.js:68-100`
- `Dockerfile:12-20`
- `deploy/nginx.conf:27-48`
- `deploy/edge-proxy.compose.yaml:86-88`
- `compose.production.yaml:424-449`

### Test/CI/deploy

- `playwright.config.js:7-34`
- `tests/e2e/smoke.spec.js`
- `backend/package.json:17-19`
- `backend/tsconfig.test.json:7`
- `backend/tests/abuse-security.test.ts:48-173`
- `backend/tests/database.integration.test.ts:663`
- `.github/workflows/quality.yml:19-84`
- `.github/workflows/deploy.yml:68-69`
- `.github/workflows/deploy.yml:680-712`
- `deploy/README.md:34-40`
- `deploy/README.md:186-203`

---

## 19. Son karar

Sistem; admin ve salon operasyonlarında önemli bir işlevsel seviyeye ulaşmış olsa da ana public başvuru akışı canlıda çalışmadığı, müşteri zinciri kanıtlanmadığı ve veri/dağıtım kurtarma kapıları açık olduğu için **canlıya hazır değildir**.

Önerilen sıra:

1. Public başvuru hatasını request ID ve backend loguyla kök nedene indir, düzelt ve görünür hata UX’ini tamamla.
2. Handoff başvurularını silen TTL davranışını durdur.
3. Temiz production veri cutover planını uygula.
4. Gerçek müşteri altın yolunu tamamla.
5. Deploy recovery, offsite restore ve external alarm tatbikatını bitir.
6. SEO crawl/canonical uç noktalarını ve Search Console kurulumunu tamamla.
7. Gerçek full-stack altın yolu CI/release kapısı yap.
8. Bütün P0 kanıtlarını bu rapordaki sign-off tablosuna bağla ve ardından GO/NO-GO toplantısı yap.
