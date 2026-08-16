# Düğünajansım NO-GO → GO Uygulama Yol Haritası

**Hazırlanma tarihi:** 12 Ağustos 2026
**Başlangıç kararı:** **NO-GO**
**Hedef:** Bütün teknik, işlevsel, veri, SEO, operasyon ve doğrulama kapılarını kanıtla kapatıp yeniden ortak GO/NO-GO değerlendirmesi yapmak

> Bu belge, [`canliya-gecis-kapsamli-hazirlik-raporu.md`](canliya-gecis-kapsamli-hazirlik-raporu.md) kaynak alınarak hazırlanmış uygulama ve agent devir raporudur. Kaynak rapordaki P0/P1 bulguları, SEO işleri, veri temizliği, test matrisleri, DevTools kontrolleri, erişilebilirlik, CI/CD, dağıtım, yedekleme, izleme, olası durumlar, rollback ve canlı sonrası takip maddeleri bu yol haritasına bağımlılık sırasıyla taşınmıştır.

> Bu belgenin tamamlanması tek başına otomatik olarak “GO” anlamına gelmez. Son görev, kaynak raporun güncel sürüm ve canlı ortam üzerinde birlikte yeniden çalıştırılmasıdır. Nihai kararı Mustafa ile yapılacak son inceleme verir.

---

## 1. Bu rapor nasıl kullanılacak?

Bu dosya başka bir agentın ana yürütme ve devir defteri olarak kullanılacaktır. Agent görevleri aşağıdaki sırayı bozmadan ele almalıdır; bir fazın çıkış kapısı kapanmadan ona bağımlı sonraki faz “tamamlandı” sayılamaz.

### 1.1 Durum işaretleri

| İşaret | Anlamı                                                          |
| ------ | --------------------------------------------------------------- |
| `[ ]`  | Başlanmadı veya kanıtlanmadı                                    |
| `[~]`  | Devam ediyor; henüz çıkış ölçütü geçmedi                        |
| `[x]`  | Uygulandı, doğrulandı ve kanıtı kaydedildi                      |
| `[!]`  | Kullanıcı onayı, dış hesap, dış sistem veya yetki bekliyor      |
| `[B]`  | Somut hata/engel nedeniyle bloke; hata ve gerekli karar yazıldı |

Markdown standart checkbox yalnız `[ ]` ve `[x]` biçimini tanıdığı için `[~]`, `[!]` ve `[B]` durumları metinsel takip işaretidir.

### 1.2 Her görev için zorunlu kapanış kaydı

Bir madde `[x]` yapılırken hemen altına veya ayrı yürütme günlüğüne şunlar eklenmelidir:

```text
Tamamlanma tarihi:
Değişen dosyalar / dış sistem:
Doğrulama komutu veya manuel senaryo:
Sonuç:
Kanıt bağlantısı / request ID / ekran kaydı:
Commit SHA ve dal (varsa):
Kalan risk:
```

### 1.3 Agent için değişmez çalışma kuralları

- [ ] Her yeni çalışma turunda kök `AGENT.md` tamamen okunacak.
- [ ] Alt klasörde `AGENT.md` veya `AGENTS.md` varsa ilgili dosya düzenlenmeden önce okunacak.
- [ ] `git status --short --branch` ile kullanıcıya ait mevcut değişiklikler kaydedilecek ve korunacak.
- [ ] Kaynak rapordaki gözlem, güncel kod ve ortam üzerinden yeniden doğrulanmadan varsayım yapılmayacak.
- [ ] Önce sorunu yeniden üreten test/kanıt, sonra en küçük güvenli düzeltme hazırlanacak.
- [ ] Uygulanmış migration dosyası değiştirilmeyecek; şema değişikliği yeni migration ile yapılacak.
- [ ] Gerçek parola, token, secret veya müşteri verisi rapora, teste, commite ve loga yazılmayacak.
- [ ] Canlı sunucu, canlı DB, DNS, TLS, Search Console, ölçüm, yedek veya alarm sisteminde yazma işlemi kullanıcı açıkça izin vermeden yapılmayacak.
- [ ] Finansal veya kalıcı silme etkili canlı işlemler ayrıca kullanıcı onayı isteyecek.
- [ ] Test başarısızlığı gizlenmeyecek; skip/only/todo veya hata kodu yutma eklenmeyecek.
- [ ] Her bağımsız kod işi güncel `AGENT.md` teslim kurallarına ve kullanıcının o andaki git talimatına göre doğrulanacak.
- [ ] Bu raporun oluşturulduğu oturumda commit/push yapılmadığı bilinmeli; uygulama agentı bunu yapılmış varsaymamalı.

### 1.4 Harici erişim kapıları

Aşağıdaki erişimler yoksa agent kod tarafındaki hazırlığı bitirir, fakat ilgili görevi `[x]` yapmaz:

- [ ] Üretim/staging backend ve proxy loglarına salt-okunur erişim.
- [ ] İzole production-benzeri staging ortamı.
- [ ] Admin step-up için yetkili test prosedürü ve MFA erişimi.
- [ ] Ayrı sentetik müşteri hesabı veya güvenli hesap oluşturma yetkisi.
- [ ] DNS sağlayıcısı erişimi.
- [ ] Ana alan ve `www` için TLS/ACME yönetim erişimi.
- [ ] GitHub production environment/reviewer ayarlarına erişim.
- [ ] Container registry erişimi.
- [ ] Ayrı offsite/immutable yedek hedefi.
- [ ] Harici monitoring ve alarm alıcıları.
- [ ] Search Console Domain Property erişimi.
- [ ] Seçilen analytics/ölçüm sistemi erişimi.
- [ ] Google Business Profile erişimi.
- [ ] Gerçek Android ve iPhone/Safari test cihazı veya güvenilir cihaz laboratuvarı.
- [ ] İşletmenin doğrulanmış adı, telefonu, e-postası, hizmet bölgesi, sosyal profilleri, katalog ve fiyat onayı.

---

## 2. Ana fazlar ve zorunlu sıra

| Sıra | Faz                                  | Ana amaç                                                     | Bağımlılık | Çıkış kapısı                              |
| ---: | ------------------------------------ | ------------------------------------------------------------ | ---------- | ----------------------------------------- |
|   00 | Yönetişim ve taban kanıtı            | Ortamı, sahipleri ve başlangıç durumunu sabitlemek           | Yok        | Baseline kaydı tamam                      |
|   01 | Public başvuru P0                    | Canlı ana dönüşümü ve görünür hata UX’ini düzeltmek          | 00         | Nakit/kapora gerçek staging akışı geçiyor |
|   02 | TTL ve veri saklama P0               | Ödeme/dekont aşamasındaki başvuru kaybını engellemek         | 00         | Handoff kayıtları korunuyor               |
|   03 | Aktivasyon, mesaj ve müşteri P0      | Müşteri hesabını güvenilir biçimde kullanılabilir yapmak     | 01–02      | Müşteri altın yolu geçiyor                |
|   04 | İş yaşam döngüsü ve veri bütünlüğü   | Arşiv, iptal, teslimat, tarih ve yarış koşullarını düzeltmek | 01–03      | Kritik iş kuralları testli                |
|   05 | Admin/salon/public UI kalitesi       | Görünür bozuklukları ve form sözleşmelerini düzeltmek        | 01–04      | Rol panelleri kullanılabilir              |
|   06 | Full-stack test ve CI                | Mock dışı release kapısı kurmak                              | 01–05      | Altın yol CI’da geçiyor                   |
|   07 | Teknik SEO ve indekslenebilir içerik | Crawl, canonical, schema ve arama içeriğini tamamlamak       | 05–06      | SEO staging matrisi geçiyor               |
|   08 | Gerçek içerik ve veri hazırlığı      | Katalog, metin ve test veri cutover’ını hazırlamak           | 04–07      | İmzalı temiz veri planı hazır             |
|   09 | Deploy ve kurtarma                   | Temiz host, migration ve rollback güvenilirliği              | 06         | Failure drill geçiyor                     |
|   10 | Yedek, izleme ve kapasite            | Felaket kurtarma ve dış gözlemlenebilirlik                   | 09         | Restore + alarm + kapasite kanıtı         |
|   11 | Kapsamlı doğrulama                   | İşlev, ağ, cihaz, erişilebilirlik ve kenar senaryoları       | 01–10      | Bütün P0/P1 doğrulamaları geçiyor         |
|   12 | Üretim öncesi cutover                | Release’i, veriyi ve dış sistemleri son kez hazırlamak       | 11         | T-1 sign-off tamam                        |
|   13 | T0 canlıya geçiş                     | Kontrollü dağıtım ve gerçek altın yol smoke                  | 12         | T0 kapıları geçiyor                       |
|   14 | Canlı sonrası takip                  | T+1 saat, T+24 saat ve T+7 gün doğrulaması                   | 13         | Stabilizasyon tamam                       |
|   15 | Nihai yeniden analiz                 | Kaynak raporu tekrar çalıştırıp ortak karar vermek           | 14         | Mustafa ile nihai GO/NO-GO                |

---

## 3. FAZ 00 — Yönetişim, erişimler ve başlangıç tabanı

**Durum:** Tamamlandı — 12 Ağustos 2026
**Release tabanı:** `ca2db408d0945017b2dcce1bc12f25b8d33ea6bd`
**Kanıt:** [`kanit/faz-00-baslangic-tabani.md`](kanit/faz-00-baslangic-tabani.md)

### 00.1 Çalışma ağacı ve sürüm tabanı

- [x] `AGENT.md` ve ilgili alt klasör talimatlarını oku.
- [x] Dal, upstream, HEAD SHA ve `git status --short --branch` çıktısını yürütme günlüğüne yaz.
- [x] Kullanıcıya ait silinmiş/değişmiş dosyaları ayrı listele; agent kapsamına alma.
- [x] Kaynak raporun SHA/tarihini ve bu yol haritasının başladığı SHA’yı kaydet.
- [x] Staging, production ve yerel ortamların hangi commit/image digest’i çalıştırdığını doğrula.
- [x] Kaynak rapordaki her P0/P1 için kod giriş noktası, backend route, veri modeli ve mevcut testi yeniden bul.

### 00.2 Sorumlular ve karar kayıtları

- [x] Teknik uygulama sorumlusu belirle.
- [x] Backend/veri sorumlusu belirle.
- [x] Frontend/UX sorumlusu belirle.
- [x] QA ve cihaz matrisi sorumlusu belirle.
- [x] Sunucu/DevOps sorumlusu belirle.
- [x] DNS/TLS sorumlusu belirle.
- [x] SEO/Search Console/ölçüm sorumlusu belirle.
- [x] İş katalog/fiyat/içerik onay sorumlusu belirle.
- [x] Go-live komuta kanalı ve acil durumda ulaşılacak kişiler belirle.
- [x] RPO, RTO, tek-host riski, iptal ve veri saklama gibi iş kararları için karar günlüğü aç.

### 00.3 Ortam ve erişim hazırlığı

- [x] Üretim benzeri, gerçek Nginx/API/PostgreSQL kullanan izole staging ortamını hazırla.
- [x] Staging’in production secretlarını kullanmadığını doğrula.
- [x] Sentetik test verisi isimlendirme ve güvenli cleanup standardını belirle.
- [x] Admin, salon ve müşteri için ayrı sentetik hesaplar oluşturma prosedürünü yaz.
- [x] Admin step-up/MFA testini gerçek sırrı rapora yazmadan yapma yöntemini belirle.
- [x] Backend/proxy logunda request ID ile arama yeteneğini doğrula.
- [x] DNS, TLS, registry, offsite backup, monitoring, Search Console ve ölçüm erişim durumunu tek tabloda kaydet.
- [x] Eksik dış erişimleri kullanıcıya tek seferde, açık amaç ve riskle bildir.

### 00.4 Başlangıç doğrulaması

- [x] Public başvuru hatasını staging veya canlı salt-okunur log eşlemesiyle yeniden üret.
- [x] `robots.txt`, sitemap, `/index.html`, `www`, HTTP/HTTPS ve 404 mevcut davranışını kaydet.
- [x] Mevcut hızlı/hedefli test komutlarını `package.json` ve CI’dan doğrula.
- [x] CI dışında kalan abuse testlerini ve mock kullanan browser testlerini tekrar doğrula.
- [x] Mevcut production image/Compose/health davranışını sentetik environment ile doğrula.
- [x] Başlangıç test sonuçlarını “geçti/ürün hatası/ortam hatası/bloke” olarak sınıflandır.

**Faz 00 çıkış kapısı**

- [x] Başlangıç SHA’sı, ortamlar, sorumlular, erişimler, P0 yeniden üretimleri ve kanıt konumları eksiksiz kaydedildi.

---

## 4. FAZ 01 — P0 public başvuru ve görünür hata akışı

**Kaynak:** P0-01, public işlev matrisi, DevTools public POST bölümü.

### 01.1 Kök nedeni kanıtla

- [x] Başarısız başvuruyu sentetik veriyle staging’de yeniden üret.
- [x] POST URL, method, status, response content-type ve response error code’u kaydet.
- [x] Response request/correlation ID’sini kaydet.
- [x] Aynı ID’yi backend ve proxy logunda bul.
- [x] Hatanın frontend, Turnstile, proxy, doğrulama, DB transaction veya backend içinden hangisinde olduğunu kesinleştir.
- [x] Hassas form verisini log/rapor kanıtında maskele.
- [x] Aynı hatayı yakalayan başarısız regresyon testi ekle veya mevcut testin neden yakalamadığını belgeleyip düzelt.

### 01.2 Backend sözleşmesini düzelt

- [x] Public create/handoff endpointinin gerçek input şemasını frontend payload’ıyla karşılaştır.
- [x] Fiyat, indirim, kapora ve hizmet snapshotının yalnız backend tarafından üretildiğini koru.
- [x] Transaction içindeki kısmi kayıt/yetim kayıt olasılığını test et.
- [x] Hata response’unu güvenli, kararlı `code/message/requestId/fieldErrors` sözleşmesine getir.
- [x] 400, 409, 422, 429 ve 500 durumlarının birbirinden ayrıldığını doğrula.
- [x] Aynı idempotency key ile tekrar isteğin tek kayıt ürettiğini doğrula.
- [x] Eşzamanlı slot yarışında yalnız bir başvurunun başarılı olduğunu doğrula.
- [x] Public başarısız denemede DB’de yarım başvuru, payment-flow veya ilişki kalmadığını doğrula.

### 01.3 Aktif adımda hata ve tekrar deneme UX’i

- [x] Başvuru hatasını gizli 5. adım yerine kullanıcının bulunduğu aktif adımda göster.
- [x] Alan hatalarını ilgili input yakınında göster.
- [x] Genel hata alanını erişilebilir live region yap.
- [x] Mesajı HTTP jargonundan arındır; ne olduğu ve kullanıcının ne yapacağı açık olsun.
- [x] 5xx, timeout ve offline durumunda doldurulmuş form verisini koru.
- [x] Güvenli “Tekrar dene” eylemi ekle.
- [x] Gönderim sırasında butonu loading/disabled yap.
- [x] Çift tıklama ve Enter tekrarının duplicate POST üretmesini engelle.
- [x] Turnstile tokenı reset olduğunda widget’ı güvenli biçimde yeniden hazırla.
- [x] Turnstile script yükleme hatasında kullanıcıya retry/yenileme eylemi sun.
- [x] Başarıda referansı görünür, kopyalanabilir ve kalıcı başarı adımında göster.
- [x] Yenileme/geri/ileri hareketinin başarı veya hata durumunu bozmadığını doğrula.

### 01.4 Public fiyat ve uygunluk sözleşmesi

- [x] Katalog başarılı yükleniyor.
- [x] Katalog 4xx/5xx/offline durumunda eski veya uydurma fiyat göstermiyor.
- [x] Her hizmet ekleme/çıkarma toplamı backend snapshotıyla eşleşiyor.
- [x] Nakit indirimi ve yuvarlama backend hesabıyla eşleşiyor.
- [x] Kapora, kalan tutar ve toplam backend hesabıyla eşleşiyor.
- [x] Özel salon alanı yalnız ilgili seçimde zorunlu oluyor.
- [x] Özel salon adı ve kişi adı doğrulama hataları ilgili alan yanında açık neden gösteriyor.
- [x] Geçmiş tarih ve geçmiş saat UI ile backend tarafından reddediliyor.
- [x] Saat adımı ve en geç bitiş kuralı UI/backend’de aynı.
- [x] Dolu salon/saat doğru engelleniyor.
- [x] Yavaş eski uygunluk yanıtı yeni seçimi ezmiyor; eski request iptal/ignore ediliyor.
- [x] Fiyat form açıkken değişirse kullanıcı güncel snapshotı açıkça görüyor ve onaylıyor.

### 01.5 P0-01 kabul testleri

- [x] Nakit seçimiyle en az üç bağımsız staging başvurusu 2xx tamamlandı.
- [x] Kapora seçimiyle en az üç bağımsız staging başvurusu 2xx tamamlandı.
- [x] Her deneme tek ve tam referans üretti.
- [x] Her referans admin kuyruğunda doğru kişi/salon/tarih/hizmet/fiyatla bir kez göründü.
- [x] 400 senaryosu aktif adımda doğru mesaj gösterdi.
- [x] 409 çakışma senaryosu aktif adımda doğru mesaj gösterdi.
- [x] 422 alan hatası ilgili alanda gösterildi.
- [x] 429 kalan süre/tekrar deneme mesajını gösterdi.
- [x] 500 ve offline durumları form verisini korudu.
- [x] Turnstile success/expired/error/script-load-fail senaryoları geçti.
- [x] Sekmeyi yenileme, geri/ileri ve gönderimde kapatma yarım/duplicate kayıt bırakmadı.
- [x] Console’da beklenmeyen error/pageerror yok.
- [x] Network’te beklenmeyen pending/cancelled/requestfailed yok.

**Faz 01 çıkış kapısı**

- [x] Public başvuru ana dönüşümü gerçek Nginx/API/PostgreSQL üzerinde nakit ve kapora için kanıtla geçti; görünür hata UX’i bütün negatif durumlarda çalıştı. Kanıt: `kanit/faz-01-public-basvuru.md`.

---

## 5. FAZ 02 — P0 TTL, handoff ve veri saklama güvenliği

**Kaynak:** P0-02, veri kaybı riski, canlı sonrası cleanup kontrolü.

### 02.1 İş kuralını kesinleştir

- [x] Public başvuru durumlarını ve ödeme/handoff adımlarını açık state tablosuna çıkar.
- [x] “Gerçek terk”, “handoff açıldı”, “dekont gönderildi”, “admin bekliyor”, “onay/red” ayrımını tanımla.
- [x] Handoff/dekont aşamasındaki kayıtların otomatik fiziksel silinmeyeceği iş kararı olarak onaylansın.
- [x] Gerçek terk kayıtlarının saklama süresi ve arşiv/silme biçimi iş sahibi tarafından onaylansın.
- [x] Silme yerine durum değişimi veya ayrı arşiv seçeneğini değerlendir ve karar kaydına yaz.

### 02.2 Cleanup davranışını düzelt

- [x] Cleanup sorgusunu yalnız izin verilen terk durumlarına sınırla.
- [x] Handoff/dekont kanıtı taşıyan kayıtları TTL kapsamından çıkar.
- [x] Fiziksel silme gerekiyorsa bağlı kayıtlar, audit ve transaction davranışını tanımla.
- [x] Cleanup işlemi için kaç kayıt seçildi/saklandı/hata aldı metrikleri ekle.
- [x] Beklenmeyen silme sayısı için alarm üret.
- [x] Cleanup tekrar çalıştığında idempotent olduğunu doğrula.
- [x] Saat dilimi ve sınır anı davranışını fake clock ile test et.

### 02.3 Regresyon ve uzun süre testi

- [x] Düzenleme süresi dolan başvurunun silinmediğini doğrulayan entegrasyon testini ekle.
- [x] Handoff yapılmış ve yapılmamış kayıtların 24+ saat sonra korunduğunu doğrula.
- [x] Süre sonrası düzenleme isteğinin açık kullanıcı uyarısıyla reddedildiğini doğrula.
- [x] Süre dolsa da WhatsApp geçişinin ve yönetici onayının çalıştığını doğrula.
- [x] Bekleyen public başvurunun salon slotu tutmadığını doğrula.
- [x] Süre dolumu audit izinin kayıt ID’si, karar nedeni ve zamanı taşıdığını doğrula.
- [x] Cleanup hatasının kayıtları yarım güncellemediğini doğrula.

**Faz 02 çıkış kapısı**

- [x] Handoff/dekont aşamasındaki hiçbir başvuru TTL ile kaybolmuyor; gerçek terk temizliği kontrollü, auditli ve alarmlı çalışıyor. Kanıt: `kanit/faz-02-ttl-handoff-saklama.md`.

---

## 6. FAZ 03 — P0 aktivasyon, mesajlar ve müşteri altın yolu

**Kaynak:** P0-03, P0-04, P1-03, P1-05, müşteri ve mesaj/teslimat matrisleri.

### 03.1 Aktivasyon görev state machine’i

- [x] Aktivasyon görevi durumlarını `planlandı/hazırlandı/gönderime hazır/gönderildi/başarısız/iptal` olarak tanımla.
- [x] “Gönderildi” geçişinden önce render edilmiş geçerli token/link zorunlu yap.
- [x] Link/token oluşturulmadan doğrudan “Gönderildi” endpointini backend’de reddet.
- [x] `dueAt` gelmeden normal gönderim eylemini backend ve UI’da kilitle.
- [x] Erken gönderim gerekiyorsa ayrı yetki, neden, onay ve audit isteyen override tanımla.
- [x] Yanlış işaretlenmiş görev için güvenli iptal/yeniden üretim prosedürü ekle.
- [x] Token üretme ve görevi hazırlama işlemini transaction/yarış koşulu açısından koru.
- [x] Admin UI sırasını `Hazırla → Linki doğrula → Gönder → Gönderildi işaretle` olarak zorla.
- [x] WhatsApp açma ile “gönderildi” işaretlemeyi ayrı eylemler olarak göster.
- [x] Gönderim başarısızlığı ve retry kuyruğunu tanımla.

### 03.2 Onay ve red bildirimleri

- [x] Başvuru onaylandığında müşteriye gidecek karar bildirim şablonunu tanımla.
- [x] Başvuru reddedildiğinde nedenin güvenli/uygun metinle bildirileceği şablonu tanımla.
- [x] Kanal, due zamanı, retry ve başarısız gönderim davranışını tanımla.
- [x] Karar mesajı ve aktivasyon mesajının görev ayrımını netleştir.
- [x] Onay/red işleminin ilgili mesaj görevini atomik veya güvenilir outbox yaklaşımıyla oluşturmasını sağla.
- [x] Mesaj içeriğinde yanlış müşteri/ref/link karışmasını negatif test et.

### 03.3 Aktivasyon ve müşteri hesabı

- [x] Ayrı sentetik müşteriyle gerçek aktivasyon tokenı üret.
- [x] Tokenın yalnız doğru kullanıcı ve amaç için geçerli olduğunu doğrula.
- [x] Token tek kullanım sonrası geçersiz oluyor.
- [x] Süresi dolmuş token doğru, güvenli mesajla reddediliyor.
- [x] Erken açılan token davranışı iş kuralıyla uyumlu ve anlaşılır.
- [x] Güçlü parola belirleme çalışıyor.
- [x] Parola düz metin log/audit/response içinde görünmüyor.
- [x] Doğru login çalışıyor.
- [x] Yanlış login genel mesaj ve rate limit uyguluyor.
- [x] Oturum cookie bayrakları doğru.
- [x] Idle timeout çalışıyor.
- [x] Logout oturumu gerçekten geçersiz kılıyor.
- [x] Geri tuşu/cache korumalı veriyi yeniden göstermiyor.
- [x] Parola değiştirme mevcut oturum ve diğer oturumlar için tanımlı davranışı uyguluyor.
- [x] Şifre kurtarma yalnız metin olmaktan çıkarılıp gerçek tek kullanımlık akışa veya açık iş kanalına bağlanıyor.

### 03.4 Müşteri veri izolasyonu

- [x] Müşteri yalnız kendi düğününü görüyor.
- [x] Başka müşteri ID’sine doğrudan erişim 403/404.
- [x] Başka düğün/teslimat ID’sine doğrudan erişim 403/404.
- [x] İptal/arşivli düğünde müşteri erişim kuralı uygulanıyor.
- [x] Hazır olmayan teslimat linki API response ve UI’da gizli.
- [x] Teslim edilen link yalnız doğru müşteri için açılıyor.
- [x] Süresi dolmuş/geri çekilmiş link doğru biçimde kapanıyor.
- [x] Teslimat URL’si yanlış izinle açıksa admin yayınlama işlemi engelleniyor.

### 03.5 MFA, step-up ve güvenilen cihaz doğrulaması

- [x] Sentetik admin hesabında MFA enrollment akışını test et.
- [x] MFA ile doğru/yanlış login ve rate limit davranışını test et.
- [x] Kalıcı silme/parola sıfırlama gibi kritik eylemlerde step-up zorunluluğunu test et.
- [x] Step-up süresi dolduğunda yeniden doğrulama istendiğini test et.
- [x] Güvenilen cihaz ekleme, süre sonu ve geri çekme davranışını test et.
- [x] MFA recovery/break-glass prosedürünü gerçek sırrı rapora yazmadan doğrula.
- [x] NTP/saat sapmasının TOTP davranışına etkisini kontrollü test et.

### 03.6 Müşteri altın yolu kabul testi

- [x] Public sentetik başvuru oluştur.
- [x] Admin kuyruğunda doğrula ve onayla.
- [x] Karar/aktivasyon görevlerini doğru sırayla oluştur.
- [x] Aktivasyon mesajını render et ve linki doğrula.
- [x] Sentetik müşteri parolasını belirle.
- [x] Müşteri olarak login ol.
- [x] Kendi düğün ve teslimat durumunu gör.
- [x] Hazır olmayan teslimatın gizli kaldığını gör.
- [x] Admin teslimat state machine’iyle test teslimatını ilerlet.
- [x] Güvenli test URL’sini yayınla.
- [x] Müşteri panelinden URL’yi aç.
- [x] Linki geri çek ve müşteri erişiminin kapandığını doğrula.
- [x] Logout ve idle timeout doğrula.
- [x] Bütün sentetik kayıtları güvenli cleanup ile kaldır.

**Faz 03 çıkış kapısı**

- [x] Gerçek aktivasyon → parola → login → izolasyon → teslimat → logout zinciri kanıtla geçti; mesaj görevleri erken/yanlış geçişe kapalı. Kanıt: `kanit/faz-03-aktivasyon-musteri-altin-yolu.md`.

---

## 7. FAZ 04 — Başvuru/düğün yaşam döngüsü ve veri bütünlüğü

### 04.1 Başvuru arşivleme ve geri yükleme

- [x] Handoff öncesi arşiv → restore → akışı sürdürme davranışını tanımla.
- [x] Handoff sonrası arşiv → restore → admin onay davranışını tanımla.
- [x] Özel salonlu `venueId=null` başvurunun restore sözleşmesini düzelt.
- [x] Arşivlemede payment-flow anahtarının silinip silinmeyeceğine açık karar ver.
- [x] Restore gerekiyorsa güvenli payment-flow anahtarını yeniden üret veya akışı kapalı admin durumuna getir.
- [x] UI metnini gerçekten geri döndürülebilir davranışla uyumlu yap.
- [x] Handoff öncesi, handoff sonrası ve özel salon varyantlarını gerçek DB entegrasyon testine ekle.
- [x] İki admin eşzamanlı arşiv/restore/onay yaparsa transaction/409 davranışını test et.

### 04.2 Gerçek düğün iptal akışı

- [x] İptal nedeni, iptal eden rol, zaman ve audit alanlarını tanımla.
- [x] `IPTAL_EDILDI`/`cancelledAt` geçişini gerçek endpoint ve servis akışına bağla.
- [x] İptal sonrası salon uygunluk slotunun serbest kalma kuralını uygula.
- [x] İptal sonrası personel atamalarının durumunu tanımla.
- [x] İptal sonrası mesaj görevlerini iptal et veya dönüştür.
- [x] İptal sonrası teslimat ve müşteri erişimini tanımla.
- [x] Yanlış iptal için yetkili, nedenli ve auditli geri alma prosedürü tanımla.
- [x] İptal/arşiv/sil eylemlerini UI’da açıkça ayır.
- [x] İptal ve geri alma yarış koşullarını test et.

### 04.3 Teslimat state machine’i

- [x] İzinli teslimat durum geçiş haritasını yaz.
- [x] İleri/geri geçişleri backend’de allowlist ile uygula.
- [x] Geri dönüşleri rol + neden + audit ile sınırla.
- [x] Geçersiz sıçramayı 409/422 ile reddet.
- [x] URL olmadan “teslim edildi/yayınlandı” durumuna izin verme.
- [x] URL formatı ve izin/erişim smoke kontrolü ekle.
- [x] Teslim tarihini düğün tarihi ve hizmet SLA’sıyla doğrula.
- [x] Arşivli/iptal düğünde teslimat mutasyonlarını kapat.
- [x] Müşterinin gösterdiği geri sayımı İstanbul timezone ve overdue durumu için düzelt.
- [x] Teslimat geri çekme ve müşteri linkini kapatma auditini test et.

### 04.4 Tarih, saat ve referans sözleşmesi

- [x] 30 dakikalık adım ve en geç bitiş politikasını tek sözleşmede tanımla.
- [x] UI ve backend doğrulamasını aynı kurala getir.
- [x] Bugünün geçmiş saatini backend’de reddet.
- [x] Başlangıç=bitiriş, ters aralık ve gece yarısı sınırını test et.
- [x] İstanbul timezone’u ve DST olmayan yerel saat davranışını açıkça uygula.
- [x] Referans tarihinin UTC/İstanbul gün farkı üretmesini engelle.
- [x] Tarayıcı timezone’u İstanbul dışında olduğunda doğru tarih gösterimini test et.

### 04.5 Listeleme, pagination ve tutarlılık

- [x] Başvuru listesindeki sessiz 200 limitini pagination/cursor ile değiştir.
- [x] Düğün listesindeki sessiz 200 limitini pagination/cursor ile değiştir.
- [x] Mesaj listesindeki sessiz 300 limitini pagination/cursor ile değiştir.
- [x] Toplam kayıt, sayfa/cursor, filtre ve sıralama sözleşmesini tanımla.
- [x] Arşivli/silinmiş filtrelerinin pagination ile doğru çalıştığını test et.
- [x] Boş, son ve geçersiz sayfa davranışlarını test et.
- [x] Admin sayaçları ile detay listelerinin aynı filtre/zaman dilimini kullandığını doğrula.

### 04.6 Personel, atama ve salon izolasyonu

- [x] Salon personeli uzmanlığını UI’da zorunlu ve alan bazlı hata ile göster.
- [x] Ad doğrulama kuralını kullanıcıya anlaşılır biçimde açıkla.
- [x] Telefon tekrarının unique/iş kuralını tanımla ve backend’de koru.
- [x] Mutasyonlarda loading/disabled ve duplicate submit koruması ekle.
- [x] Pasif personeli yeni atamada seçilemez yap.
- [x] Aynı personelin çakışan düğüne atanmasını transaction ile engelle.
- [x] Yetkili override varsa neden ve audit zorunlu yap.
- [x] Başka salon ID’sine salon yetkilisi erişimini 403/404 negatif testiyle doğrula.
- [x] İki salon yetkilisinin eşzamanlı atama yarışını test et.
- [x] Arşivli/iptal düğünde atama kontrollerini kapat.

**Faz 04 çıkış kapısı**

- [x] Başvuru restore, düğün iptal, teslimat state machine, tarih/saat, pagination ve atama kuralları backend otoritesiyle uygulanmış ve yarış/negatif testleri geçmiştir. Kanıt: `kanit/faz-04-yasam-dongusu-veri-butunlugu.md`.

---

## 8. FAZ 05 — Public, admin ve salon frontend kalite düzeltmeleri

### 05.1 Admin paneli

- [x] Genel Bakış’a gerçek `.js-today-weddings` render hedefi ekle.
- [x] Bugünkü düğün metriği ile görünen kartları aynı veri/filtreye bağla.
- [x] Sayfa H1’ini aktif admin bölümüne göre güncelle.
- [x] Aktif navigasyonda `aria-current` uygula.
- [x] Düğün badge sayısını gerçek veriyle güncelle.
- [x] `Sistem bağlı` metnini gerçek health ve son başarılı veri zamanı ile bağla.
- [x] API yüklenmemişken takvim prev/next/today eylemlerini kilitle.
- [x] API hata durumunda takvim navigasyonunun `RangeError` üretmesini engelle.
- [x] Teslimat, atama ve katalog hatalarını açık modal/form bağlamında göster.
- [x] URL/date alanlarında native ve uygulama validasyonunu uyumlu hale getir.
- [x] Katalog API yüklenmezse constraint bağımlı formları güvenli kapat ve açıklayıcı hata göster.
- [x] Başvuru, personel, paket, hizmet, salon ve teslimat mutasyonlarında in-flight kilidi ekle.
- [x] Arşivli/iptal kayıtta geçersiz mutasyon butonlarını gizle veya devre dışı bırak.

### 05.2 Salon operasyon paneli

- [x] Takvim/hafta navigasyonunu veri yükleme ve hata durumuna göre kilitle.
- [x] Düğün güncelleme API/alan hatalarını modal içinde göster.
- [x] Personel uzmanlığını zorunlu işaretle.
- [x] Ad/telefon/uzmanlık hatalarını alan bazlı göster.
- [x] Personel ve atama mutasyonlarında loading/disabled uygula.
- [x] Başarılı mutasyon sonrası yalnız gerekli görünümü güncelle.
- [x] Yetkisiz başka salon verisini UI cache’inde göstermediğini doğrula.

### 05.3 Public ve giriş sayfaları

- [x] Public başvuru görünür hata/retry düzeltmesini Faz 01 ile tamamla.
- [x] Hizmet `İncele` butonunun erişilebilir adına hizmet adını dahil et.
- [x] İletişim hedefinde doğrulanmış gerçek iletişim aksiyonlarını göster. Telefon ve WhatsApp yayımlandı; doğrulanmış işletme e-postası bulunmadığından kullanıcı onayıyla e-posta kapsam dışında bırakıldı (2026-08-13).
- [x] Şifre kurtarma eylemini gerçek akış veya açık iletişim kanalına bağla.
- [x] Login input sınırlarını backend sözleşmesiyle uyumlu hale getir.
- [x] Paket oluşturucu başarı/tamamlama markup’ının gerçekten kullanılan akışa bağlı olduğunu doğrula.
- [x] Kullanılmayan/handlersız tamamlama ve lightbox kontrollerini ya işlevsel yap ya güvenle kaldır.
- [x] Public paket builder indeksleme kararını SEO fazıyla uyumlu tut.
- [x] Builder adım başlıklarını tek sayfa H1’i ve anlamlı H2/H3 hiyerarşisiyle düzenle.

### 05.4 Erişilebilir panel navigasyonu

- [x] Admin ve salon drawer butonuna `aria-expanded` ekle.
- [x] Drawer butonuna `aria-controls` ekle.
- [x] Drawer açıldığında focus’u doğru yere taşı.
- [x] Drawer kapanınca focus’u tetikleyiciye geri ver.
- [x] Drawer açıkken arka içeriği focus/interaction dışına çıkar.
- [x] Escape ile güvenli kapatma uygula.
- [x] Dialoglarda `aria-labelledby`, focus trap ve focus dönüşünü tamamla.
- [x] Form hata alanlarını `aria-describedby` ve live region ile bağla.
- [x] Video/ses kontrollerinin klavye ve ekran okuyucu etkileşimini düzelt.

**Faz 05 çıkış kapısı**

- [x] Admin, salon, public ve login ekranlarında kaynak rapordaki görünür/erişilebilirlik bozuklukları regresyon testleriyle kapanmıştır. Kanıt: `kanit/faz-05-frontend-kalite.md`.

---

## 9. FAZ 06 — Gerçek full-stack test, CI ve release kalite kapısı

**Kaynak:** P0-12, test altyapısı bölümü ve zorunlu işlev matrisinin tamamı.

### 06.1 Abuse testlerini CI’a dahil et

- [x] `backend/tests/abuse-security.test.ts` içindeki 6 senaryoyu normal backend CI komutuna ekle.
- [x] Production rate limiter PostgreSQL deposu testini koru.
- [x] Sentetik hassas veri opt-in testini koru.
- [x] Honeypot ve minimum form süresi testini koru.
- [x] E-posta/telefon tekrar kotası testini koru. İşletme iletişimi telefon + WhatsApp kapsamındadır; `primaryEmail` mevcut hesap/abuse sinyali olarak korunur.
- [x] Şüpheli başvurunun veri yazımına ulaşmama testini koru.
- [x] CORS abuse başlıkları testini koru.
- [x] Testlerin yalnız typecheck edilmediğini, gerçekten koştuğunu CI çıktısında doğrula.
- [x] Test sayısı/rapor kaydıyla regresyon kapısını görünür yap.

### 06.2 Production-benzeri full-stack ortam

- [x] Test ortamı gerçek production frontend image’ını kullansın.
- [x] Gerçek Nginx yapılandırmasını kullansın.
- [x] Gerçek backend image’ını kullansın.
- [x] Gerçek PostgreSQL ve migration zincirini kullansın.
- [x] Runtime least-privilege DB rolünü kullansın.
- [x] Gerçek cookie, CSRF, CORS ve proxy zincirini kullansın.
- [x] Public akışta production-benzeri Turnstile test anahtar/sözleşmesi kullansın.
- [x] Production sırrı veya gerçek müşteri verisi kullanmasın.
- [x] Test başına izole sentetik kimlik/reference üret.
- [x] Başarıda ve başarısızlıkta güvenli cleanup uygula.
- [x] Cleanup başarısızlığını test hatası yap ve kalıntı ID’lerini raporla.

### 06.3 Mock kullanmayan altın yol

- [x] Public paket/katalog yükle.
- [x] Nakit veya kapora başvurusu oluştur.
- [x] Başvuruyu gerçek admin API/UI kuyruğunda bul.
- [x] Admin onayla; düğün, teslimat ve mesaj görevlerini doğrula.
- [x] Aktivasyon mesajını doğru sırayla hazırla.
- [x] Müşteri parolasını gerçek tokenla belirle.
- [x] Gerçek müşteri cookie’siyle login ol.
- [x] Müşteri veri izolasyonunu doğrula.
- [x] Düğünü salon panelinde gör.
- [x] Salon personeli oluştur/düzenle veya izole test personeli kullan.
- [x] Atama ekle ve geri kaldır.
- [x] Admin teslimat durumlarını izinli sırayla ilerlet.
- [x] Güvenli test teslimat URL’si yayınla.
- [x] Müşteri panelinden URL’yi aç.
- [x] Teslimatı geri çekme davranışını doğrula.
- [x] Bütün sentetik veriyi temizle.
- [x] Bu zincirde `page.route(...).fulfill(...)` veya eşdeğer API mock’u kullanma.

### 06.4 Global browser hata kapısı

- [x] Beklenmeyen `console.error` testleri fail etsin.
- [x] `pageerror` testleri fail etsin.
- [x] `requestfailed` testleri fail etsin.
- [x] İzinli listede olmayan 4xx/5xx testleri fail etsin.
- [x] Sonsuz pending/cancelled request testi fail etsin.
- [x] İzin verilen negatif test HTTP durumları senaryo bazında açık allowlist olsun.
- [x] Request ID’ler test raporuna hassas veri içermeden yazılsın.

### 06.5 CI artifact ve tarayıcı matrisi

- [x] Başarısızlıkta Playwright trace yükle.
- [x] Başarısızlıkta screenshot yükle.
- [x] Başarısızlıkta video yükle.
- [x] Gereken ağ senaryolarında maskelenmiş HAR yükle.
- [x] Desktop Chromium zorunlu.
- [x] WebKit/Safari sözleşmesi zorunlu.
- [x] Firefox smoke ekle.
- [ ] Edge/Chrome farkı için release manuel smoke kaydı ekle.
- [ ] Mobil emülasyon yanında gerçek cihaz manuel kanıtına bağlantı ver.

### 06.6 Test kararlılığı ve kapsamı

- [x] `reuseExistingServer: true` nedeniyle yanlış port/sunucuya bağlanma riskini kaldır veya kimlik doğrulaması ekle.
- [x] Sabit `waitForTimeout` beklemelerini olay/koşul tabanlı beklemeyle değiştir.
- [x] TOTP testlerinde kontrollü saat/fake clock veya güvenli pencere yaklaşımı uygula.
- [ ] Çok büyük DB entegrasyon testini bağımsız, izole ve anlamlı testlere böl.
- [x] Erken assertion hatasının sonraki kritik senaryoları atlamasını engelle.
- [x] Frontend/backend kod kapsamı ölçümünü ekle.
- [x] Anlamlı line/branch threshold belirle; düşük değeri yalnız yeşil görünmek için seçme.
- [x] Axe kapısını yalnız critical değil serious/moderate bulgular için de kararlaştır ve ihlalleri düzelt.
- [x] `production-hardening` testini yalnız string aramak yerine gerçek image/Compose/Nginx runtime smoke ile destekle.
- [ ] Production clone üzerinde migration prova testini release sürecine bağla.

### 06.7 Rol ve route negatif matrisi

- [x] Anonim → public izinli rotalar.
- [x] Anonim → admin/salon/müşteri 401/redirect.
- [x] Admin → admin izinli rotalar.
- [x] Admin → step-up/MFA gerektiren kritik rotalar.
- [x] Salon → yalnız kendi salon rotaları.
- [x] Salon → başka salon 403/404.
- [x] Salon → admin/müşteri rol rotaları 403/redirect.
- [x] Müşteri → yalnız kendi kullanıcı/düğün/teslimat rotaları.
- [x] Müşteri → başka müşteri/düğün/teslimat 403/404.
- [x] Arşivli/iptal/silinmiş kayıtta bütün rollerin beklenen 404/409 davranışı.
- [x] CSRF eksik/yanlış state-changing isteklerin reddi.
- [x] CORS yanlış origin/credentials isteklerinin reddi.

### 06.8 Test sonuçlarının izlenebilirliği

- [x] Her kaynak rapor test maddesini test dosyası/senaryo adıyla eşleştir.
- [x] Manuel kalan testlerin neden otomatikleştirilemediğini yaz.
- [x] Başarısız/flaky testleri gizleme; ayrı kayıt ve sahibi belirle.
- [x] Release SHA değişirse ilgili full-stack ve regresyon kapılarını yeniden çalıştır.

**Faz 06 çıkış kapısı**

- [ ] Abuse testleri dahil tam CI yeşil; gerçek Nginx/API/PostgreSQL altın yolu mock olmadan geçiyor ve başarısızlık artifact’ları üretiliyor.

---

## 10. FAZ 07 — Teknik SEO, indekslenebilir içerik ve ölçüm

### 07.1 Crawl ve canonical teknikleri

- [ ] `robots.txt` oluştur.
- [ ] `robots.txt` 200 ve doğru `text/plain` döndürsün.
- [ ] `Sitemap: https://dugunajansim.com/sitemap.xml` satırını ekle.
- [ ] Geçerli XML sitemap oluştur.
- [ ] Sitemap yalnız 200 dönen canonical/indexlenebilir URL’leri içersin.
- [ ] Admin, salon, müşteri, login ve noindex işlem sayfalarını sitemap dışında tut.
- [ ] `/index.html` → `/` tek adım 301/308 yönlendirme ekle.
- [ ] HTTP → HTTPS path/query korumalı tek adım yönlendirme doğrula.
- [ ] `www` için geçerli TLS sertifikası sağla.
- [ ] `www` → non-www path/query korumalı tek adım yönlendirme ekle.
- [ ] Yanlış/bilinmeyen URL gerçek 404 kalmalı.
- [ ] Markalı 404 sayfası eklenirse statusun 404 kaldığını doğrula.
- [ ] Redirect zincirlerinin loop veya iki+ adım içermediğini otomatik test et.

### 07.2 Site adı ve structured data

- [ ] Ana sayfaya parse edilebilir `WebSite` JSON-LD ekle.
- [ ] `name` değerini onaylı birleşik marka adıyla tutarlı kullan.
- [ ] `alternateName` içinde `Düğün Ajansım` ve alan adını tanımla.
- [ ] `url` mutlak production HTTPS canonical olsun.
- [ ] Mevcut `Organization` JSON-LD ile çelişen ad/URL bırakma.
- [ ] Gerçek işletme verisi hazırsa uygun `LocalBusiness` alanlarını ekle.
- [ ] `telephone`, `address`/`areaServed` ve `sameAs` yalnız doğrulanmış gerçek bilgilerle doldur.
- [ ] Schema Markup Validator ile hata/uyarıları incele.
- [ ] Search Console rendered HTML’de schema’nın bulunduğunu doğrula.

### 07.3 İlk HTML’de indekslenebilir hizmet içeriği

- [ ] Hizmet adlarını ve temel açıklamalarını build sırasında ilk HTML’e üret.
- [ ] Salon/hizmet özünü API başarısızlığında da arama motorunun görebileceği güvenli statik içerik olarak sun.
- [ ] Fiyat ve uygunluk gibi değişken veriyi API ile hydrate et.
- [ ] Statik içerik ile dinamik API içeriğinin çelişmemesini test et.
- [ ] Önemli hizmetleri crawl edilebilir gerçek `<a href>` bağlantılarıyla bağla.
- [ ] Hizmet buton/dialoglarının ana keşif yolu olmasına güvenme.
- [ ] Googlebot rendered HTML’de hizmet içeriği ve bağlantıların bulunduğunu URL Inspection ile doğrula.

### 07.4 Landing sayfaları ve builder kararı

- [ ] Paket oluşturucunun işlem sayfası olarak `noindex` kalıp kalmayacağına açık karar ver.
- [ ] Builder `noindex` kalırsa sitemap dışında tut.
- [ ] Paket niyeti için tek H1’li, statik ve indekslenebilir `/paketler/` sayfası oluştur.
- [ ] Düğün fotoğrafçılığı için özgün landing sayfası oluştur.
- [ ] Sinematik düğün filmi için özgün landing sayfası oluştur.
- [ ] Drone düğün çekimi için özgün landing sayfası oluştur.
- [ ] Düğün albümü için özgün landing sayfası oluştur.
- [ ] İstanbul/hizmet bölgesi için gerçek kapsamı anlatan özgün landing sayfası oluştur.
- [ ] Her sayfada benzersiz title, description, canonical ve tek görünür H1 kullan.
- [ ] İçerik hizmet kapsamı, süreç, teslim süresi, gerçek örnek ve SSS ile özgün olsun.
- [ ] Landing sayfaları arasında ve ana sayfadan anlamlı iç linkler kur.
- [ ] Aynı metnin küçük kelime farklarıyla çoğaltılmadığını içerik onayıyla doğrula.

### 07.5 Yerel işletme ve iletişim sinyalleri — kullanıcı/dış kapı

- [ ] İşletmenin onaylı adı alınsın.
- [ ] Gerçek telefon ve e-posta alınsın.
- [ ] Gerçek hizmet bölgesi/adres modeli alınsın.
- [ ] Gerçek sosyal profil URL’leri alınsın.
- [ ] Site footer ve iletişim hedefinde aynı bilgiler tutarlı gösterilsin.
- [ ] Google Business Profile oluşturulsun veya mevcut profil doğrulansın.
- [ ] Profilde ad, telefon, alan adı ve hizmet bölgesi siteyle eşleşsin.
- [ ] Uydurma adres, telefon veya hizmet bölgesi kullanılmasın.

### 07.6 Search Console ve analytics — kullanıcı/dış kapı

- [ ] Search Console `dugunajansim.com` Domain Property oluştur.
- [ ] DNS TXT ile doğrula.
- [ ] Doğrulama kaydını kalıcı tut.
- [ ] Sitemap’i gönder ve `Success` durumunu kaydet.
- [ ] Keşfedilen URL sayısını kaydet.
- [ ] Ana sayfa ve bütün landing sayfalarında URL Inspection çalıştır.
- [ ] Google’ın seçtiği canonical’ı kontrol et.
- [ ] Render edilmiş HTML ve index eligibility’yi kontrol et.
- [ ] Pages, Manual Actions, Security Issues ve Core Web Vitals raporlarını incele.
- [ ] Gerekli yeni URL’lerde `Request indexing` kullan.
- [ ] Seçilen ölçüm sistemini kur.
- [ ] `page_view` ölç.
- [ ] Paket başlangıcı ölç.
- [ ] Başvuru başarı/hata sonucu ölç.
- [ ] WhatsApp tıklaması ölç.
- [ ] Event parametrelerine ad, telefon, e-posta veya form notu gönderme.

### 07.7 Core Web Vitals

- [ ] Ana sayfada mobil cold-cache Lighthouse/PageSpeed çalıştır.
- [ ] Her indekslenebilir landing sayfasında mobil cold-cache ölçüm yap.
- [ ] Warm-cache ölçümünü ayrıca kaydet.
- [ ] LCP ≤ 2,5 sn hedefini karşıla.
- [ ] INP < 200 ms hedefini karşıla.
- [ ] CLS < 0,1 hedefini karşıla.
- [ ] Yavaş 4G ve CPU throttling altında ana dönüşümü test et.
- [ ] Canlı sonrası Search Console alan verisini haftalık takip et.

### 07.8 SEO regresyon paketi

- [ ] Canonical mutlak HTTPS production URL’si.
- [ ] Build çıktısında `__APP_ORIGIN__` kalmıyor.
- [ ] `WebSite` ve `Organization` JSON-LD parse ediliyor.
- [ ] OG/Twitter zorunlu alanları doğru.
- [ ] `robots.txt` ve sitemap status/içeriği doğru.
- [ ] Sitemap URL’leri 200, canonical ve indexlenebilir.
- [ ] Panel/giriş sayfalarının `noindex` etiketi korunuyor.
- [ ] `www`, HTTP ve `/index.html` yönlendirmeleri doğru.
- [ ] Bilinmeyen rota 404.
- [ ] Her indekslenebilir sayfada tek görünür H1.
- [ ] Her indekslenebilir sayfada benzersiz title/description.
- [ ] Statik dosya sürümleme/cache stratejisi eski JS-yeni API riskini azaltıyor.

**Faz 07 çıkış kapısı**

- [ ] Teknik crawl/canonical/schema testleri staging ve canlı adayında geçiyor; kullanıcı/dış kapıdaki Search Console, işletme ve ölçüm kanıtları tamamlanmıştır.

---

## 11. FAZ 08 — Gerçek içerik, katalog ve veri cutover hazırlığı

### 08.1 İş tarafından doğrulanacak gerçek içerik

- [ ] Gerçek paket listesi ve aktiflik durumları onaylandı.
- [ ] Gerçek hizmet listesi ve aktiflik durumları onaylandı.
- [ ] Gerçek fiyatlar, nakit indirimi ve kapora kuralları onaylandı.
- [ ] Gerçek salon listesi ve aktiflik durumları onaylandı.
- [ ] Paket/hizmet açıklamaları tamamlandı; `Açıklama belirtilmemiş.` kalmadı.
- [ ] Ana sayfa/girişteki marka yılı tek doğrulanmış değere getirildi.
- [ ] Tarihli portföy/çekim metinleri gerçek kayıtlarla eşleştirildi.
- [ ] Gerçek banka/ödeme-handoff metni çift kişiyle onaylandı.
- [ ] İletişim aksiyonları gerçek telefon/e-posta/WhatsApp ile çalışıyor.
- [ ] Statik `Sistem bağlı` metni gerçek health verisiyle değiştirildi.

### 08.2 Salt-okunur üretim veri envanteri

- [ ] Aktif ve arşivli bütün başvuruları gerekli sütunlarla envanterle.
- [ ] Aktif, iptal, arşivli ve silinmiş bütün düğünleri gerekli sütunlarla envanterle.
- [ ] Admin, salon ve müşteri hesaplarını envanterle.
- [ ] Personel ve atamaları envanterle.
- [ ] Mesaj görevleri ve durumlarını envanterle.
- [ ] Teslimat ve link durumlarını envanterle.
- [ ] Audit kayıtlarını bağlı kayıtlarla değerlendir.
- [ ] Payment-flow/handoff kayıtlarını envanterle.
- [ ] Her kaydı “gerçek/test/belirsiz” olarak iş sahibiyle sınıflandır.
- [ ] Belirsiz kayıtları tahminle silme; kullanıcı kararına bırak.

### 08.3 Özellikle temizlenecek sentetik kalıntılar

- [ ] `DA-20260812-405440` referansını envanterde bul ve kullanıcı onayı sonrası temizleme listesine al.
- [ ] Pasif `Canli TestSalonDenetim` personelini envanterde bul ve temizleme listesine al.
- [ ] `CanliTest`, `UctanUca` ve `demo-*` kayıtlarını bul.
- [ ] Açıkça sentetik e-posta ve telefonları bul.
- [ ] `Ay?e` benzeri karakter bozulmuş kayıtları kaynağıyla belirle.
- [ ] İleri tarihli test düğünlerini ve bloke ettikleri salon slotlarını belirle.
- [ ] Gelecek tarihli test mesajlarını ve yanlış `Gönderildi` durumlarını belirle.
- [ ] Public başarısız denemesinden yetim/yarım kayıt kalıp kalmadığını log/DB ile kontrol et.
- [ ] Demo çiftlerin gerçek mi test mi olduğunu iş sahibine doğrulat.

### 08.4 Cutover stratejisi kararı

- [ ] Seçenek A: temiz production DB + migration + yalnız onaylı gerçek seed.
- [ ] Seçenek B: mevcut DB + kontrollü cleanup migration/script.
- [ ] İki seçeneğin kesinti, geri dönüş, veri kaybı ve operasyon etkisini yaz.
- [ ] İş sahibi seçimi yazılı onaylasın.
- [ ] Temiz DB seçilirse gerçek hesap/katalog başlangıç datasını güvenli seed et.
- [ ] Seed içindeki boş `update: {}` davranışını gözden geçir; onaylı katalog değişikliklerini mevcut kayda güvenli ve idempotent biçimde uygulayan sözleşme oluştur.
- [ ] Seed’i hem temiz DB hem önceden kayıtlı/stale katalog bulunan DB üzerinde test et.
- [ ] Mevcut DB seçilirse bağımlılık sıralı dry-run cleanup script’i hazırla.
- [ ] Cleanup önce/sonra tablo sayaçlarını ve hedef ID’leri raporla.
- [ ] Kalıcı silme komutunu açık kullanıcı onayı ve bakım penceresi olmadan çalıştırma.
- [ ] İşlem öncesi şifreli yedek al ve bağımsız restore ile doğrula.

### 08.5 Temizlik sonrası kabul

- [ ] Demo/sentetik ad, telefon, e-posta ve referans kalmadı.
- [ ] Gelecekteki test düğünü gerçek salon uygunluğunu bloke etmiyor.
- [ ] Gereksiz test admin/salon/müşteri hesabı kalmadı.
- [ ] Test personel ve ataması kalmadı.
- [ ] Test mesaj/teslimat/payment-flow kalıntısı kalmadı.
- [ ] Gerçek admin ve salon hesapları login/rol kapsamında doğrulandı.
- [ ] Katalog onaylı fiyat/açıklamalarla eşleşiyor.
- [ ] Ana sayfa başlangıç fiyatı gerçek katalogla eşleşiyor.
- [ ] Paket toplamı backend snapshotıyla eşleşiyor.
- [ ] Her salon uygunluk takvimi gerçek rezervasyonlarla doğru.
- [ ] Admin sayaçları detay listeleriyle eşleşiyor.
- [ ] Salon yetkilisi yalnız kendi gerçek salon/personelini görüyor.
- [ ] Müşteri yalnız kendi düğününü görüyor.
- [ ] Test iletişim verisi log, analytics ve alarm sistemlerinde kalmadı.
- [ ] Temizlik sonrası altın yol yeniden geçti.

**Faz 08 çıkış kapısı**

- [ ] Gerçek içerik/katalog imzalı; üretim veri cutover seçeneği onaylı; dry-run, yedek/restore ve temizlik sonrası kabul ölçütleri hazırdır.

---

## 12. FAZ 09 — Temiz host, deploy, migration ve rollback mühendisliği

### 09.1 Tek ve güncel temiz-host runbook’u

- [ ] Çelişkili secret/env talimatlarını kaldır; file-secret tek kaynak olsun.
- [ ] Eski/yanlış backup encryption değişken adlarını güncelle.
- [ ] Host kullanıcı, grup, sudo ve dosya sahipliği modelini yaz.
- [ ] Uygulama dizini ve sahipliğini yaz.
- [ ] Desteklenen Docker ve Compose sürümlerini sabitle/doğrula.
- [ ] Firewall’da yalnız gerekli portları aç.
- [ ] SSH anahtar yönetimi, rotasyon ve break-glass prosedürünü yaz.
- [ ] External Docker network oluşturma adımını yaz.
- [ ] Sabit trust proxy/IP varsayımını kurulum ve değişiklik prosedürüyle yaz.
- [ ] Volume, secret, certificate ve log path izinlerini yaz.
- [ ] Let’s Encrypt/ACME dizin ve yenileme adımlarını yaz.
- [ ] Log rotasyonu ve disk kotasını yaz.
- [ ] NTP/saat senkronu doğrulamasını yaz.
- [ ] Her komutun beklenen çıktısı ve geri alma adımı olsun.
- [ ] Farklı bir kişi boş hostta runbook’u sıfırdan prova etsin.

### 09.2 Production environment fail-fast

- [ ] Production `PAYMENT_MODE !== live` ise başlangıç başarısız olsun.
- [ ] `APP_DOMAIN=dugunajansim.com` doğrulansın.
- [ ] Placeholder/test değerleri production env’de reddedilsin.
- [ ] Secret dosya yok/izin yanlışsa başlangıç başarısız olsun.
- [ ] Ana ve `www` TLS kapsamı preflight’ta kontrol edilsin.
- [ ] NTP sapması kabul sınırının dışındaysa deploy durdurulsun.
- [ ] Hassas değerler config/health/log outputunda gösterilmesin.

### 09.3 Forward-only failure marker ve watchdog

- [ ] Forward-only başlamadan kalıcı maintenance/failure marker yaz.
- [ ] Marker içinde release SHA, migration adı, zaman ve durum olsun; secret olmasın.
- [ ] Watchdog marker varken eski uygulamayı otomatik açmasın.
- [ ] Deploy hata yolu marker’ı yanlışlıkla temizlemesin.
- [ ] Resume/roll-forward prosedürü yaz.
- [ ] Manuel müdahale ve yetkili karar noktalarını yaz.
- [ ] Forward-only başlamadan önceki rollback davranışını koru.
- [ ] Migration yarıda bilinçli durdurularak failure drill yap.
- [ ] Drill sırasında trafik kapalı ve eski uyumsuz uygulama kapalı kalsın.
- [ ] Güvenli roll-forward sonrası marker kontrollü temizlensin.

### 09.4 Migration ve DB çalışma güvenliği

- [ ] Production clone üzerinde bütün migrationları prova et.
- [ ] Migration süresini ölç.
- [ ] Lock/traffic etkisini ölç.
- [ ] Forward-only başlangıç noktasını logla.
- [ ] Migration öncesi şifreli yedeği restore ederek doğrula.
- [ ] Runtime DB least-privilege testlerini çalıştır.
- [ ] Connection pool limitini DB kapasitesiyle eşleştir.
- [ ] Slow query ve lock alarmı kur.
- [ ] N-1 uygulama ile yeni şema uyumluluğunu kanıtla veya rollback’i kapalı olarak belgele.

### 09.5 İmaj ve release bütünlüğü

- [ ] CI gerçek production backend image’ını build etsin.
- [ ] CI gerçek production frontend image’ını build etsin.
- [ ] CI migration image’ını build etsin.
- [ ] Production Compose ile Nginx/API/DB runtime smoke çalışsın.
- [ ] İmajları immutable registry digest ile sakla.
- [ ] Deploy hedefini tag yerine digest ile sabitle.
- [ ] Health/metadata’da güvenli commit SHA ve image digest doğrula.
- [ ] Rollback imajını host local cache’i dışında registry’de tut.
- [ ] Base image build’ini reproducible yap; kontrolsüz upgrade değişkenliğini kaldır.
- [ ] Deploy sonunda çalışan container revision’ını beklenen release ile karşılaştır.
- [ ] GitHub production environment required reviewer ayarını dış sistemde doğrula.
- [ ] Production deploy’un yetkili insan onayı olmadan her `main` başarısında otomatik ilerleyip ilerlemeyeceğini doğrula ve onay politikasını uygula.
- [ ] Production branch/environment kısıtlarını ve yetkili reviewer listesini kayıt altına al.

### 09.6 Rollback önkoşulları ve karar matrisi

- [ ] Son sağlam immutable digest biliniyor ve registry’de mevcut.
- [ ] Eski uygulama ile yeni şema uyumu kanıtlı.
- [ ] Forward-only marker ve karar noktası loglanıyor.
- [ ] Restore komutları güncel runbook’tan geliyor.
- [ ] Rollback sonrası aynı altın yol smoke çalışıyor.
- [ ] Public başvuru 5xx/kayıt yok karar adımı yazılı.
- [ ] Migration failure karar adımı yazılı.
- [ ] Veri sayaç farkı karar adımı yazılı.
- [ ] 5xx spike karar adımı yazılı.
- [ ] TLS/canonical arızası karar adımı yazılı.
- [ ] Disk dolu/OOM karar adımı yazılı.
- [ ] Müşteri teslimat linki arızası karar adımı yazılı.
- [ ] Cleanup veri kaybı karar adımı yazılı.
- [ ] Forward-only başladıktan sonra otomatik eski sürüme dönüş yapılmayacağı açık.

**Faz 09 çıkış kapısı**

- [ ] Boş host kurulumu ve bilinçli migration failure drill’i geçti; immutable release/rollback ve resume/roll-forward kanıtı hazırdır.

---

## 13. FAZ 10 — Offsite yedek, dış izleme, kapasite ve dayanıklılık

### 10.1 Offsite/immutable yedek

- [ ] En az bir aynı host dışı şifreli yedek hedefi kur.
- [ ] Mümkünse immutable/object-lock koruması uygula.
- [ ] Yedek şifreleme anahtarını uygulama hostundan ayrı güvenli yönet.
- [ ] Anahtar rotasyonu prosedürü yaz.
- [ ] Anahtar kaybı/break-glass prosedürü yaz.
- [ ] Yedek retention politikasını iş ihtiyacıyla onayla.
- [ ] Yedek upload bütünlüğünü checksum veya eşdeğer yöntemle doğrula.
- [ ] Yedek yaşını, boyutunu, şifreleme ve upload durumunu metrik yap.

### 10.2 RPO/RTO ve bağımsız restore

- [ ] RPO hedefini iş sahibiyle yazılı onayla.
- [ ] RTO hedefini iş sahibiyle yazılı onayla.
- [ ] Ayrı ortamda sıfırdan restore yap.
- [ ] Restore süresini ölç ve RTO ile karşılaştır.
- [ ] Veri tablo/satır sayılarını doğrula.
- [ ] Kritik ilişkilerin bütünlüğünü doğrula.
- [ ] Restore edilmiş ortamda public→müşteri→salon→teslimat altın yolunu çalıştır.
- [ ] Restore kanıtını tarih, yedek ID ve sonuçlarla arşivle; secret yazma.

### 10.3 Host dışı monitoring ve alarm

- [ ] Ana sayfa uptime sentetiği kur.
- [ ] Health endpoint sentetiği kur.
- [ ] Public katalog sentetiği kur.
- [ ] Login sayfası sentetiği kur.
- [ ] 5xx oranı alarmı kur.
- [ ] p95/p99 gecikme alarmı kur.
- [ ] PostgreSQL connection alarmı kur.
- [ ] PostgreSQL lock/slow query alarmı kur.
- [ ] Disk kullanım alarmı kur.
- [ ] Container restart alarmı kur.
- [ ] OOM alarmı kur.
- [ ] Beklenen replica sayısı alarmı kur.
- [ ] TLS bitiş süresi alarmı kur.
- [ ] ACME yenileme başarısızlığı alarmı kur.
- [ ] Yedek yaşı/upload/restore alarmı kur.
- [ ] Alarmın gerçek telefon/e-posta/mesaj alıcısına ulaştığını test et.
- [ ] Alarm sahipliği ve sessiz saat/escalation zincirini yaz.
- [ ] Uygulama/proxy/DB loglarını host kaybından etkilenmeyen merkezi hedefte topla veya eşdeğer dayanıklı log planı uygula.
- [ ] Log retention, erişim, saat senkronu ve request ID ile uçtan uca arama davranışını doğrula.
- [ ] ACME hesap/sertifika yapılandırması için felaket kurtarma prosedürü hazırla.

### 10.4 Kapasite ve bozulma tatbikatları

- [ ] Beklenen normal ve peak public trafik tahmini onaylansın.
- [ ] Public katalog ve başvuru yük testi yap.
- [ ] Login/rate-limit yük testi yap.
- [ ] Admin listeleme ve takvim yük testi yap.
- [ ] Salon takvim/atama yük testi yap.
- [ ] PostgreSQL CPU/RAM/IOPS/connection kapasitesini ölç.
- [ ] Uygulama pool ve replica sayısını ölçüme göre ayarla.
- [ ] Gerçek proxy IP zincirinde rate limit doğrula.
- [ ] Disk dolu tatbikatı yap.
- [ ] DB bağlantı kaybı tatbikatı yap.
- [ ] Container restart/OOM tatbikatı yap.
- [ ] Tek replica kaybı tatbikatı yap.
- [ ] DNS split/eski host senaryosu için TTL ve gözlem planı hazırla.
- [ ] Tek-host arızasının kabul edilen risk olup olmadığını yazılı onayla.

**Faz 10 çıkış kapısı**

- [ ] Offsite restore RPO/RTO içinde geçti; dış alarmlar gerçek alıcıya ulaştı; peak ve failure drill sonuçları kabul edildi.

---

## 14. FAZ 11 — Release candidate kapsamlı manuel doğrulama

Bu faz yeni özellik geliştirme fazı değildir. Önceki bütün düzeltmeler aynı release SHA/digest üzerinde gerçek tarayıcı, gerçek API ve production-benzeri ortamla doğrulanır.

### 11.1 DevTools hazırlığı

- [ ] Network `Preserve log` açık.
- [ ] Console `Preserve log` açık.
- [ ] Cold-cache turunda `Disable cache` açık.
- [ ] Ayrı warm-cache turu yapılıyor.
- [ ] Fetch/XHR ve All filtreleri ayrı inceleniyor.
- [ ] Hassas veri maskelenerek HAR veya ekran kaydı saklanıyor.
- [ ] Test başlangıç/bitiş zamanı, release SHA/digest ve sentetik referans kaydediliyor.

### 11.2 Her ana istek için ağ kontrolü

- [ ] URL ve HTTP method doğru.
- [ ] Status beklenen değer.
- [ ] Response content-type doğru.
- [ ] Redirect zinciri gereksiz adım içermiyor.
- [ ] 4xx/5xx güvenli ve kullanıcıya uygun error code taşıyor.
- [ ] Request ID response ile backend/proxy logunda eşleşiyor.
- [ ] CORS origin ve credentials doğru.
- [ ] CSP başlıkları beklenen kaynakları engellemiyor ve beklenmeyen kaynağa izin vermiyor.
- [ ] Console’da CSP violation görülmüyor.
- [ ] Cookie `Secure`, `HttpOnly`, uygun `SameSite`, domain/path ve süreyle geliyor.
- [ ] State-changing cookie endpointlerinde CSRF çalışıyor.
- [ ] Beklenmeyen pending/cancelled/requestfailed yok.
- [ ] Tek tıklama duplicate POST üretmiyor.
- [ ] Response içinde stack trace, secret veya gereksiz kişisel veri yok.
- [ ] API ve statik dosya cache-control doğru.
- [ ] Büyük/gereksiz payload yok.
- [ ] Gereksiz tekrarlı istek yok.

### 11.3 Public negatif ağ ve yarış senaryoları

- [ ] Offline gönderim.
- [ ] Slow 4G/yüksek latency.
- [ ] Request timeout.
- [ ] Backend 500.
- [ ] 429 rate limit.
- [ ] Turnstile script yüklenmiyor.
- [ ] Turnstile token süresi doluyor.
- [ ] Eski availability response’u yenisinden sonra geliyor.
- [ ] Gönderim sırasında refresh.
- [ ] Gönderim sırasında sekme kapanıyor.
- [ ] Çift tıklama/Enter tekrarı.
- [ ] Fiyat form açıkken değişiyor.
- [ ] İki kullanıcı son slotu aynı anda alıyor.
- [ ] WhatsApp açılıyor fakat mesaj gönderilmiyor.
- [ ] Handoff oluyor fakat admin 60+ dakika işlem yapmıyor.
- [ ] Aynı telefon/e-posta kısa sürede tekrar başvuruyor.

### 11.4 Admin başvuru matrisi

- [ ] Liste yükleme.
- [ ] Arama.
- [ ] Durum filtresi.
- [ ] Pagination/toplam kayıt.
- [ ] Manuel başvuru oluşturma.
- [ ] Public başvuru detayını açma.
- [ ] Onaylama.
- [ ] Red + neden + bildirim.
- [ ] Handoff öncesi arşiv/restore.
- [ ] Handoff sonrası arşiv/restore.
- [ ] Özel salon arşiv/restore.
- [ ] Kalıcı silme step-up + MFA + audit.
- [ ] İki admin eşzamanlı işlem/409.
- [ ] Onay sonrası düğün, teslimat ve doğru mesaj görevleri.
- [ ] Audit log listesi, filtreleri ve kritik işlemlerin doğru kaydı.
- [ ] Genel bakış sayaçlarının audit/listelerle tutarlılığı.

### 11.5 Admin düğün ve takvim matrisi

- [ ] Düğün arama/filtre/pagination.
- [ ] Bugünkü düğün sayısı ve kartlarının eşleşmesi.
- [ ] Haftalık plan önceki/sonraki/bugün.
- [ ] Salon takvimi salon/ay/bugün geçişi.
- [ ] Veri yüklenmeden navigasyon güvenliği.
- [ ] Düğün düzenleme.
- [ ] Salon/saat çakışması.
- [ ] Yetkili override nedeni ve audit.
- [ ] Gerçek iptal ve slotu serbest bırakma.
- [ ] İptal geri alma prosedürü.
- [ ] Arşiv/restore/kalıcı silme.
- [ ] Arşivli/iptal kayıtta mutasyon kontrollerinin kapanması.

### 11.6 Admin personel, yetkili ve katalog matrisi

- [ ] Personel oluşturma.
- [ ] Personel düzenleme.
- [ ] Pasifleştirme/aktifleştirme.
- [ ] Personel silme ve bağımlılık davranışı.
- [ ] Telefon tekrar kuralı.
- [ ] Uzmanlık zorunluluğu ve alan hatası.
- [ ] Atama ekleme/çıkarma.
- [ ] Personel çakışması.
- [ ] Pasif personelin seçilememesi.
- [ ] Salon yetkilisi oluşturma/düzenleme/aktiflik.
- [ ] Hizmet oluşturma/düzenleme/pasifleştirme/silme.
- [ ] Hizmet aktifliğinin public kart ve mevcut fiyat snapshotına etkisi.
- [ ] Paket oluşturma/düzenleme/pasifleştirme/silme.
- [ ] Pakete hizmet ekleme/çıkarma ve toplam.
- [ ] Salon oluşturma/düzenleme/pasifleştirme/silme.
- [ ] Bağımlı silmede anlaşılır 409/hata.
- [ ] API yüklenmezse constraint bağımlı formların güvenli kapanması.

### 11.7 Salon yetkilisi matrisi

- [ ] Doğru/yanlış login ve rate limit.
- [ ] Yalnız kendi salon dashboard’u.
- [ ] Haftalık plan ve salon takvimi.
- [ ] Düğün detayını açma.
- [ ] Düğün güncelleme başarılı kayıt.
- [ ] Düğün güncelleme alan/API hatası.
- [ ] Personel oluşturma/düzenleme/aktiflik.
- [ ] Atama ekleme/çıkarma.
- [ ] Başka salon ID’sine 403/404.
- [ ] Admin/müşteri role geçişinin engellenmesi.
- [ ] İki salon yetkilisinin eşzamanlı atama yarışı.
- [ ] Oturum süresi, logout ve cache/back davranışı.

### 11.8 Müşteri matrisi

- [ ] Aktivasyon linki ve doğru mesaj.
- [ ] Token tek kullanımlık.
- [ ] Token süre sonu.
- [ ] Parola belirleme.
- [ ] Doğru/yanlış login ve rate limit.
- [ ] Kendi düğün detayını görme.
- [ ] Başka müşteri/düğün/teslimata 403/404.
- [ ] Teslimat aşamalarını doğru görme.
- [ ] Hazır olmayan linkin gizli kalması.
- [ ] Teslim edilen linkin gerçek yetkiyle açılması.
- [ ] Süresi dolmuş/geri çekilmiş link davranışı.
- [ ] Parola değiştirme.
- [ ] Gerçek şifre kurtarma.
- [ ] Idle timeout, logout ve geri tuşu.
- [ ] Çoklu cihaz/oturum ve parola değişikliği davranışı.

### 11.9 Admin MFA ve step-up matrisi

- [ ] MFA enrollment.
- [ ] MFA ile login.
- [ ] Yanlış TOTP ve rate limit.
- [ ] Trusted-device oluşturma ve süre sonu.
- [ ] Trusted-device geri çekme.
- [ ] Kritik işlem step-up.
- [ ] Step-up süre sonu.
- [ ] Recovery/break-glass prosedürü.

### 11.10 Mesaj ve teslimat matrisi

- [ ] Aktivasyon render edilmeden `Gönderildi` yapılamıyor.
- [ ] `dueAt` öncesi normal eylem kapalı.
- [ ] Yetkili erken override neden/audit istiyor.
- [ ] Render edilen link doğru kullanıcıya ait.
- [ ] WhatsApp açma ve gönderildi işaretleme ayrı.
- [ ] Retry/başarısız gönderim kuyruğu.
- [ ] Onay bildirimi.
- [ ] Red bildirimi.
- [ ] Teslimat izinli state geçişleri.
- [ ] Geçersiz state sıçraması reddi.
- [ ] Drive/dosya URL format ve erişim kontrolü.
- [ ] Teslim etmeden önce URL smoke.
- [ ] Müşteride link açma.
- [ ] Geri çekme ve audit.

### 11.11 Tarih/saat ve tarayıcı timezone matrisi

- [ ] Geçmiş tarih.
- [ ] Bugünün geçmiş saati.
- [ ] Başlangıç ve bitiş eşit.
- [ ] Başlangıç bitişten sonra.
- [ ] Gece yarısını aşan aralık.
- [ ] 30 dakika dışı dakika doğrudan API’ye gönderme.
- [ ] En geç bitiş sınırı.
- [ ] İstanbul timezone gösterimi.
- [ ] İstanbul dışı tarayıcı timezone’u.
- [ ] UTC/yerel gün sınırında referans üretimi.
- [ ] İptal/arşiv sonrası slotun doğru serbestliği.
- [ ] Personel takvim çakışması.

### 11.12 Cihaz ve tarayıcı matrisi

- [ ] Desktop Chrome tam altın yol.
- [ ] Desktop Firefox public/login/rol smoke.
- [ ] Desktop Edge public/admin/dosya/WhatsApp smoke.
- [ ] WebKit/Safari public/tarih/login/müşteri teslimat.
- [ ] Gerçek Android Chrome menü/builder/form/modal/ödeme.
- [ ] Gerçek iPhone Safari menü/builder/date-time/viewport/sticky/modal.
- [ ] 320 px dar ekran yatay taşma/form/dialog.
- [ ] Tablet portrait navigasyon/takvim.
- [ ] Tablet landscape navigasyon/takvim.
- [ ] Desktop ve mobil cold/warm cache.

### 11.13 Klavye ve ekran okuyucu matrisi

- [ ] Bütün işlevlere yalnız klavyeyle erişim.
- [ ] Görünür focus göstergesi.
- [ ] Modal açılınca focus modal içine gidiyor.
- [ ] Modal kapanınca focus tetikleyiciye dönüyor.
- [ ] Escape yalnız güvenli dialogu kapatıyor.
- [ ] Hatalar live region/`aria-describedby` ile okunuyor.
- [ ] Drawer açık/kapalı durumu duyuruluyor.
- [ ] Drawer açıkken arka içerik erişilemez.
- [ ] Aktif navigasyon duyuruluyor.
- [ ] Başlık hiyerarşisi sayfa bağlamını doğru veriyor.
- [ ] Hizmet eylemlerinin adı hizmeti içeriyor.
- [ ] Medya ses kontrolleri klavye/ekran okuyucuyla çalışıyor.
- [ ] Renk kontrastı WCAG AA.
- [ ] Axe critical/serious/moderate sonuçları incelendi ve kabul edilen istisna yok.

### 11.14 Altyapı/uyumluluk kenar senaryoları

- [ ] Deploy migration ortasında kesiliyor.
- [ ] Watchdog maintenance marker varken eski servisi açmıyor.
- [ ] DB bağlantısı kayboluyor.
- [ ] Disk doluyor.
- [ ] Container OOM/restart oluyor.
- [ ] Beklenen replica kayboluyor.
- [ ] DNS TTL nedeniyle eski/yeni host birlikte trafik alıyor.
- [ ] `www` veya ana host TLS süresi/yenilemesi bozuluyor.
- [ ] ACME rate limit/yenileme hatası.
- [ ] Host ve local backup birlikte kayboluyor; offsite restore çalışıyor.
- [ ] Monitoring ana host kaybında erişilebilir kalıyor.
- [ ] Tarayıcı/CDN eski JS kullanırken API yeni sözleşmede.
- [ ] Saat/NTP kayması MFA/TOTP’yi etkiliyor.

**Faz 11 çıkış kapısı**

- [ ] Aynı release SHA/digest üzerinde bütün işlev, negatif ağ, rol, cihaz, erişilebilirlik ve kenar senaryosu sonuçları kanıtlıdır; açık P0 yoktur ve genel trafiği etkileyecek P1 kalmamıştır.

---

## 15. FAZ 12 — Üretim öncesi cutover ve T-1 hazırlığı

### 12.1 T-14 ile T-7 kapanışı

- [ ] Public başvuru kök nedeni ve düzeltmesi tamam.
- [x] Handoff TTL/veri kaybı kuralı tamam.
- [ ] Full-stack altın yol staging’de tamam.
- [ ] Müşteri rolü uçtan uca tamam.
- [ ] Veri cutover stratejisi ve cleanup dry-run onaylı.
- [ ] Temiz-host runbook ve forward-only failure drill tamam.
- [ ] Offsite yedek ve bağımsız restore tamam.
- [ ] External monitoring ve alarm alıcı testi tamam.
- [ ] Teknik SEO staging matrisi tamam.
- [ ] Migration, veri dönüşümü ve beklenen bakım kesintisi süresi ölçüldü; bakım penceresi bu kanıta göre onaylandı.

### 12.2 T-7 ile T-2 kapanışı

- [ ] Production-benzeri yük ve CWV ölçümü tamam.
- [ ] Chrome, Firefox, WebKit, Edge, Android ve iPhone smoke tamam.
- [ ] Bütün rol/route 401/403/404 matrisi tamam.
- [ ] Katalog/fiyat/açıklama iş onayı tamam.
- [ ] Google Business Profile ve site işletme bilgileri tutarlı.
- [ ] Search Console DNS doğrulama hazırlığı tamam.
- [ ] DNS TTL düşürme kararı ve zamanı kayıtlı.
- [ ] Bakım penceresi onaylı.
- [ ] Go-live/rollback sorumluları ve iletişim kanalı hazır.

### 12.3 T-1 release freeze

- [ ] Main/release dalı ve hedef SHA donduruldu.
- [ ] Production image digestleri kaydedildi.
- [ ] Tam CI abuse testleri dahil yeşil.
- [ ] Kaynak rapor P0/P1 kanıt tablosu güncel.
- [ ] Şifreli son yedek alındı.
- [ ] Offsite kopya ve checksum doğrulandı.
- [ ] Restore edilebilirlik son kayıtla doğrulandı.
- [ ] Test veri envanteri iş sahibi tarafından imzalandı.
- [ ] Cleanup hedefleri ve before/after sayaçları hazır.
- [ ] Secret/env checklist iki kişiyle kontrol edildi.
- [ ] `PAYMENT_MODE=live` doğrulandı.
- [ ] Banka/ödeme-handoff metni doğrulandı.
- [ ] Ana ve `www` sertifika kapsamı doğrulandı.
- [ ] DNS A/AAAA/firewall erişimi doğrulandı.
- [ ] Search Console doğrulaması/sitemap gönderim adımı hazır.
- [ ] Bakım, başarı ve geri dönüş mesajları hazır.
- [ ] Son sağlam rollback digest ve schema uyumu doğrulandı.
- [ ] Release SHA değişirse etkilenen kapıların yeniden çalışacağı kabul edildi.

**Faz 12 çıkış kapısı**

- [ ] T-1 sign-off tamam; tek hedef release SHA/digest, doğrulanmış yedek/rollback ve onaylı veri planı hazırdır.

---

## 16. FAZ 13 — T0 kontrollü canlıya geçiş

Canlıya yazma, veri temizliği, migration, DNS/TLS veya harici sistem değişikliği kullanıcı açık onayı ve bakım penceresi olmadan çalıştırılmaz.

### 13.1 Preflight

- [ ] Bakım penceresi başlatıldı ve ekip bilgilendirildi.
- [ ] Dış uptime monitor bakım moduna doğru biçimde alındı; gerçek arızayı tamamen gizlemiyor.
- [ ] Health, disk, DB bağlantı/lock ve replica durumu normal.
- [ ] Son yedek ID’si, offsite kopya ve restore kanıtı doğrulandı.
- [ ] Hedef commit SHA/image digest doğrulandı.
- [ ] Maintenance/forward-only marker mekanizması hazır.
- [ ] Rollback ve roll-forward yetkilisi erişilebilir.

### 13.2 Migration ve veri cutover

- [ ] Maintenance marker yazıldı.
- [ ] Production trafik/yazma planlandığı biçimde durduruldu.
- [ ] Migration yalnız onaylı release image’ıyla çalıştı.
- [ ] Gerekliyse onaylı cleanup script/migration dry-run çıktısıyla eşleşerek çalıştı.
- [ ] Migration/cleanup exit code başarılı.
- [ ] Before/after tablo ve ilişki sayaçları beklenen değerlerde.
- [ ] Sentetik/test hedefler kaldırıldı; gerçek kayıtlar korundu.
- [ ] İleri tarihli gerçek takvim ve slotlar doğrulandı.
- [ ] Runtime DB rolü ve migration durumu doğrulandı.

### 13.3 Uygulama açılışı

- [ ] Production containerlar hedef digest ile başladı.
- [ ] Container healthcheckler yeşil.
- [ ] Health/metadata revision beklenen SHA/digest.
- [ ] Nginx/frontend/backend/DB bağlantısı sağlıklı.
- [ ] Maintenance marker yalnız güvenli noktada kaldırıldı.
- [ ] Dış monitor yeniden aktif.

### 13.4 Salt-okunur smoke

- [ ] Ana sayfa 200 ve doğru canonical.
- [ ] Katalog gerçek verilerle yükleniyor.
- [ ] Login sayfası açılıyor.
- [ ] Admin salt-okunur dashboard/listeler doğru.
- [ ] Salon salt-okunur dashboard/takvim doğru.
- [ ] Müşteri test hesabı yalnız kendi verisini görüyor.
- [ ] Beklenmeyen console/network 4xx/5xx yok.

### 13.5 Gerçek production sentetik altın yolu

- [ ] Benzersiz sentetik public başvuru oluştur.
- [ ] Admin kuyruğunda aynı referansı bul.
- [ ] Admin onayla.
- [ ] Aktivasyon mesaj/token sırasını doğrula.
- [ ] Müşteri parolasını belirle ve login ol.
- [ ] Düğünü salon takviminde gör.
- [ ] İzole test personeli/atama ekle ve geri kaldır.
- [ ] Teslimat state’lerini güvenli test URL’siyle ilerlet.
- [ ] Müşteri panelinden test URL’sini aç.
- [ ] Teslimatı geri çek.
- [ ] Sentetik başvuru/düğün/müşteri/personel/atama/mesaj/teslimat kayıtlarını onaylı cleanup ile kaldır.
- [ ] Cleanup sonrası sayaç ve slotların başlangıç durumuna döndüğünü doğrula.

### 13.6 DNS, TLS ve Google uçları

- [ ] HTTP → HTTPS tek adım.
- [ ] `www` TLS geçerli ve ana hosta tek adım.
- [ ] `/index.html` → `/` tek adım.
- [ ] `robots.txt` 200 ve sitemap satırı doğru.
- [ ] Sitemap 200/geçerli ve canonical URL’ler içeriyor.
- [ ] Rastgele URL 404.
- [ ] Search Console sitemap gönderildi.
- [ ] Ana URL Inspection yapıldı ve kanıt kaydedildi.

**Faz 13 çıkış kapısı**

- [ ] Production migration/veri/uygulama doğrulandı; gerçek sentetik altın yol geçti ve kalıntısı temizlendi; DNS/TLS/SEO uçları çalışıyor.

---

## 17. FAZ 14 — Canlı sonrası hypercare

### 14.1 T+1 saat

- [ ] 4xx/5xx oranı normal.
- [ ] p95/p99 gecikme normal.
- [ ] DB connection/lock/slow query normal.
- [ ] Container restart/OOM/replica sayısı normal.
- [ ] Disk kullanımı normal.
- [ ] Public başvuru başarı/hata oranı izleniyor.
- [ ] İlk gerçek başvuru varsa admin görünümü ve karar/bildirim prosedürü doğrulandı.
- [ ] Cleanup hiçbir handoff/dekont kaydını silmedi.
- [ ] Alarm kanalı gerçek test mesajı aldı.
- [ ] Planlı yedek işi çalıştı ve offsite upload tamam.

### 14.2 T+24 saat

- [ ] Başvuru sayısı, başarı/hata oranı ve drop-off incelendi.
- [ ] Nakit/kapora dağılımı ve hataları incelendi.
- [ ] Admin operasyon geri bildirimi alındı.
- [ ] Salon operasyon geri bildirimi alındı.
- [ ] Müşteri aktivasyon/login/teslimat destek talepleri incelendi.
- [ ] Search Console crawl/indexing ve sitemap durumu kontrol edildi.
- [ ] Tekrarlı 4xx/5xx ve yavaş endpointler incelendi.
- [ ] Sentetik/test kayıt kalmadığı doğrulandı.
- [ ] Yeni incident/iyileştirme işleri sahibiyle backlog’a işlendi.

### 14.3 T+7 gün

- [ ] Core Web Vitals ilk saha sinyalleri incelendi.
- [ ] Google index coverage incelendi.
- [ ] Marka ve temel hizmet sorguları takip edildi; sıralama garantisi varsayılmadı.
- [ ] Yedek restore tatbikat kayıtları arşivlendi.
- [ ] Tekrarlayan destek ve operasyon sorunları sınıflandırıldı.
- [ ] Kapasite ve alarm eşikleri gerçek trafik verisiyle yeniden değerlendirildi.
- [ ] Açılan P2/P3 işlerin sahibi ve hedef tarihi belirlendi.

**Faz 14 çıkış kapısı**

- [ ] İlk 7 günlük stabilizasyon tamam; veri kaybı, ana dönüşüm veya rol/teslimat engeli yok; gözlem ve yedek kanıtları sağlıklı.

---

## 18. FAZ 15 — Kaynak raporu yeniden çalıştırma ve nihai ortak karar

### 15.1 Yeniden analiz önkoşulları

- [ ] Değerlendirilecek tek release SHA ve production image digest kaydedildi.
- [ ] Faz 00–14 içindeki açık `[ ]`, `[!]` veya `[B]` maddeleri listelendi.
- [ ] Her kapalı P0/P1 için güncel kod/test/canlı kanıtı bağlı.
- [ ] Kaynak raporun ilk NO-GO kanıtları ile yeni sonuçlar karşılaştırılabilir.
- [ ] P0 düzeltmelerinden sonra release/config değişmişse ilgili testler yeniden koşuldu.

### 15.2 Kaynak raporun bağımsız yeniden denetimi

- [ ] Public site ve paket başvurusu baştan sona yeniden test edildi.
- [ ] Admin panelinin bütün kritik eylemleri yeniden test edildi.
- [ ] Salon yetkilisi panelinin bütün kritik eylemleri yeniden test edildi.
- [ ] Müşteri aktivasyon/login/teslimat zinciri yeniden test edildi.
- [ ] Console/Network negatif senaryoları yeniden test edildi.
- [ ] P0-01’den P0-12’ye her bulgu tek tek yeniden değerlendirildi.
- [ ] P1-01’den P1-16’ya her bulgu tek tek yeniden değerlendirildi.
- [ ] SEO/canonical/Search Console/CWV yeniden değerlendirildi.
- [ ] Veri temizliği ve gerçek katalog yeniden değerlendirildi.
- [ ] Full-stack CI, cihaz ve erişilebilirlik matrisi yeniden değerlendirildi.
- [ ] Deploy, failure drill, rollback, offsite restore ve alarmlar yeniden değerlendirildi.
- [ ] T+7 günlük canlı metrikleri nihai karara dahil edildi.

### 15.3 Nihai karar kuralları

**GO verilebilir yalnızca:**

- [ ] Bütün P0 maddeleri kapalı ve kanıtlı.
- [ ] Genel trafiği veya ana operasyonu bozacak P1 kalmamış.
- [ ] Müşteri altın yolu gerçek ortamda geçmiş.
- [ ] Veri cutover/temizlik doğrulanmış.
- [ ] Rollback/roll-forward ve offsite restore kanıtlı.
- [ ] Dış monitoring ve alarm zinciri çalışıyor.
- [ ] Teknik SEO uçları ve Search Console kurulumu tamam.
- [ ] Release SHA/digest yeniden test sonrası değişmemiş.
- [ ] Açık P2/P3’ler sahibi/tarihi/riskiyle kabul edilmiş.
- [ ] Mustafa kanıtları birlikte inceleyip açıkça GO kararı vermiş.

**NO-GO devam eder eğer:**

- [ ] Herhangi bir P0 açık, bloke veya kanıtsızsa.
- [ ] Public başvuru, aktivasyon, müşteri teslimat veya veri saklama zinciri güvenilir değilse.
- [ ] Geri dönüş/restore mümkün değilse.
- [ ] Üretim veri temizliği belirsizse.
- [ ] DNS/TLS/canonical erişiminde kritik sorun varsa.
- [ ] Release SHA kanıtlar tamamlandıktan sonra değişmiş ve testler yenilenmemişse.

**Faz 15 çıkış kapısı**

- [ ] Mustafa ile ortak yeniden analiz tamamlanmış, nihai GO/NO-GO kararı tarih/release SHA/kanıtlarla bu dosyaya yazılmıştır.

---

## 19. Zorunlu nihai sign-off tablosu

Bu 12 satırın hiçbiri birleştirilerek veya atlanarak kapatılamaz.

|  No | Kapı                              | Zorunlu kanıt                                              | Sorumlu             | Durum           |
| --: | --------------------------------- | ---------------------------------------------------------- | ------------------- | --------------- |
|   1 | Public başvuru gerçek API/DB      | HAR + request ID + admin referansı + nakit/kapora testleri | Frontend + Backend  | AÇIK            |
|   2 | TTL ve handoff veri saklama       | Entegrasyon testi + 24 saat simülasyonu/canlı gözlem       | Backend             | KAPALI — Faz 02 |
|   3 | Müşteri aktivasyon/login/teslimat | Gerçek token, session ve teslimat altın yolu               | Backend + QA        | AÇIK            |
|   4 | Production veri cutover           | İmzalı envanter + yedek/restore + before/after sayaçları   | Backend + Operasyon | AÇIK            |
|   5 | Payment live ve iş fiyatları      | Fail-fast config smoke + çift kişi fiyat/metin onayı       | Backend + İş sahibi | AÇIK            |
|   6 | Deploy/recovery drill             | Temiz-host prova + forward-only failure/resume kaydı       | DevOps              | AÇIK            |
|   7 | Offsite yedek/restore             | Ayrı ortam restore, süre ve veri/altın yol kanıtı          | DevOps              | AÇIK            |
|   8 | External monitoring               | Uptime/5xx/DB/TLS/yedek alarmı ve gerçek alıcı testi       | DevOps              | AÇIK            |
|   9 | Teknik SEO ve Search Console      | Status/redirect matrisi + sitemap kabulü + URL Inspection  | SEO + DevOps        | AÇIK            |
|  10 | Full-stack CI release kapısı      | Mock dışı altın yol CI run ve artifact                     | QA + Backend        | AÇIK            |
|  11 | Cihaz/erişilebilirlik matrisi     | Tarayıcı/gerçek cihaz ve klavye/EK sonuçları               | QA                  | AÇIK            |
|  12 | İş içeriği/katalog                | Onaylı fiyat, paket, hizmet, salon, marka ve iletişim      | İş sahibi           | AÇIK            |

---

## 20. Kaynak rapor → uygulama fazı izlenebilirlik matrisi

| Kaynak rapor bölümü                 | Bu rapordaki yürütme fazı | Birleşim notu                                  |
| ----------------------------------- | ------------------------- | ---------------------------------------------- |
| Yönetici özeti / ana çıkış kapıları | 00–15, Bölüm 19           | 12 sign-off ile korunur                        |
| P0-01 public başvuru                | Faz 01, 06, 11, 13        | Public matris ve DevTools aynı çalışma altında |
| P0-02 TTL veri kaybı                | Faz 02, 10, 14            | Retention + metrik/alarm + canlı takip         |
| P0-03 müşteri altın yolu            | Faz 03, 06, 11, 13        | Aktivasyon/login/teslimat tek zincir           |
| P0-04 erken `Gönderildi`            | Faz 03, 04, 11            | Mesaj state machine içinde                     |
| P0-05 veri cutover/test verisi      | Faz 08, 12, 13            | Envanter → onay → T0 cleanup                   |
| P0-06 payment live                  | Faz 01, 08, 09, 12        | Backend hesap + iş onayı + fail-fast           |
| P0-07 temiz-host runbook            | Faz 09, 12                | Boş host prova zorunlu                         |
| P0-08 forward-only/watchdog         | Faz 09, 10, 12–13         | Marker + failure drill + T0 uygulama           |
| P0-09 offsite yedek/RPO/RTO         | Faz 10, 12–14             | Restore ve canlı yedek takibi                  |
| P0-10 dış izleme                    | Faz 10, 12–14             | Alarm kurulumu ve hypercare                    |
| P0-11 robots/sitemap/www/index      | Faz 07, 11–13             | Teknik SEO + canlı status matrisi              |
| P0-12 full-stack/abuse CI           | Faz 06, 11–13             | Release kalite kapısı                          |
| P1-01 archive/restore               | Faz 04, 11                | Başvuru yaşam döngüsü                          |
| P1-02 gerçek iptal                  | Faz 04, 11                | Düğün yaşam döngüsü                            |
| P1-03 karar bildirimi               | Faz 03, 11                | Mesaj state machine                            |
| P1-04 teslimat geçişleri            | Faz 04, 11                | Teslimat state machine                         |
| P1-05 gelecekteki görev             | Faz 03, 11                | `dueAt` ve override                            |
| P1-06 bugünkü düğün render          | Faz 05, 11                | Admin UI                                       |
| P1-07 dinamik panel başlığı         | Faz 05, 11                | Admin UI/a11y                                  |
| P1-08 hata bağlamı                  | Faz 01, 05, 11            | Ortak form hata sözleşmesi                     |
| P1-09 in-flight/idempotency         | Faz 01, 04, 05, 11        | UI + backend birlikte                          |
| P1-10 personel sözleşmesi           | Faz 04, 05, 11            | Backend/UI doğrulama                           |
| P1-11 availability yarışı           | Faz 01, 11                | Yalnız son response                            |
| P1-12 Turnstile kilidi              | Faz 01, 11                | Retry/reset akışı                              |
| P1-13 liste limitleri               | Faz 04, 11                | Pagination/toplam kayıt                        |
| P1-14 tarih/saat farkı              | Faz 04, 11                | Tek backend sözleşmesi                         |
| P1-15 takvim navigasyonu            | Faz 05, 11                | Loading/error güvenliği                        |
| P1-16 statik sistem durumu          | Faz 05, 08, 11            | Gerçek health/son veri                         |
| SEO 7.1–7.3                         | Faz 07, 11–14             | Teknik, dış kurulum ve takip                   |
| Veri/metin kalıntıları 8.1–8.3      | Faz 08, 12–13             | Salt-okunur envanter + onaylı cleanup          |
| İşlev matrisi 9.1–9.8               | Faz 06 ve Faz 11          | Otomatik + manuel tam matris                   |
| DevTools 10                         | Faz 01 ve Faz 11          | Kök neden + release aday turu                  |
| Erişilebilirlik/cihaz 11            | Faz 05, 06, 11            | Düzeltme + CI + gerçek cihaz                   |
| Test altyapısı 12                   | Faz 06                    | Tek release quality gate                       |
| Deploy/altyapı 13                   | Faz 09–10, 12–14          | Runbook, recovery, kapasite, gözlem            |
| Olası durumlar 14                   | Faz 11                    | Negatif ve failure senaryoları                 |
| Zaman çizelgesi 15                  | Faz 12–14                 | T-14/T-1/T0/T+1/T+24/T+7                       |
| Rollback matrisi 16                 | Faz 09, 12–13             | Immutable digest ve forward-only kararları     |
| Sign-off 17                         | Bölüm 19 ve Faz 15        | Nihai 12 kapı                                  |
| Son karar 19                        | Faz 15                    | Birlikte yeniden analiz                        |

---

## 21. Agent devir özeti şablonu

Her agent çalışma turunun sonunda bu bölüme veya ayrı yürütme günlüğüne aşağıdaki özet eklenmelidir:

```text
Tarih/saat:
Agent:
Başlangıç SHA / dal:
Ele alınan görev ID'leri:
Tamamlanan maddeler ve kanıtlar:
Değişen dosyalar / dış sistemler:
Çalıştırılan hedefli kontroller ve sonuçları:
Commit/push durumu (kullanıcı ve AGENT.md talimatına göre):
Yeni veya devam eden engeller:
Kullanıcıdan gereken karar/erişim:
Sonraki kesin görev:
```

### Başlangıç devir notu

- Kaynak denetim kararı: **NO-GO**.
- En önce ele alınacak konu: **Faz 01 public başvurunun gerçek hata kök nedeni ve görünür hata akışı**.
- Buna paralel erken açılacak dış kapılar: staging/log erişimi, sentetik müşteri+MFA prosedürü, DNS/TLS, offsite backup, monitoring, Search Console ve gerçek iş katalog/iletişim verileri.
- Bu yol haritasının hazırlandığı oturumda implementation, canlı sistem değişikliği, test, commit veya push yapılmadı.
- Bütün fazlar tamamlandığında yeni agent kendi başına “GO” ilan etmeyecek; Faz 15 kapsamında Mustafa ile bu taskta yeniden analiz yapılacaktır.
