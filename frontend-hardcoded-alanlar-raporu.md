# Frontend Hardcoded Alanlar Raporu

- **Tarih:** 7 Ağustos 2026
- **İncelenen dal/revizyon:** `main` / `bff9faca13fe0212ca8b9d1e101511d81dfc5792`
- **Kapsam:** 9 HTML girişi, 19 JavaScript modülü ve üretilen `css/home/styles.css` hariç 17 CSS kaynak dosyası

## Yönetici özeti

Frontenddeki hardcoded alanların büyük kısmı statik tasarım ve arayüz metni olarak normaldir. Ancak aşağıdaki dört konu doğrudan yayın, müşteri beklentisi veya bakım riski taşır:

1. **Yasal metinler tamamlanmamış:** Veri sorumlusunun gerçek kimliği ve başvuru/iletişim kanalı yerine ileride güncelleneceğini söyleyen geçici metinler yayında görünmektedir.
2. **Fiyat ve ödeme politikası birden fazla kaynakta tekrar ediyor:** 20.000 TL paket fiyatı, %10 peşin indirim ve 5.000 TL kapora; HTML, frontend JS, backend servis ve seed verisinde ayrı ayrı tanımlıdır.
3. **Katalog ve referans içerikleri iki ayrı dünyada yönetiliyor:** Admin/API kataloğu değişse bile ana sayfadaki paket, hizmet, mekân ve medya içeriği otomatik güncellenmez.
4. **Teslim süresi çelişkisi giderildi:** İlgili paket, hizmet, FAQ ve yönetim formu metinleri “21 takvim günü” olarak tekleştirildi.

Önerilen yön, fiyat/ödeme/katalog gibi iş verilerini backend/API'de; yasal kimlik, iletişim, SEO, referans mekân ve medya gibi yayın içeriğini tek bir site yapılandırması veya içerik manifestinde; rol ve durum etiketleri gibi istemci sözleşmelerini ise ortak frontend modüllerinde toplamaktır.

## Öncelik tanımı

| Seviye | Anlamı                                                                     |
| ------ | -------------------------------------------------------------------------- |
| P0     | Yayın öncesi tamamlanmalı; yasal veya temel güven sorunu                   |
| P1     | Müşteriye yanlış/eski bilgi gösterme ya da akış uyumsuzluğu riski          |
| P2     | Yakın vadede merkezi kaynağa alınmalı; operasyon ve bakım riski            |
| P3     | Teknik borç; mevcut davranış doğru olsa da değişiklik maliyetini artırıyor |

## Bulgular

### HC-01 — Yasal kimlik ve iletişim kanalları geçici metin (P0)

**Kanıt**

- `kvkk-aydinlatma.html:16-20`: Veri sorumlusu yalnızca “Düğünajansım” olarak geçiyor ve iletişim bilgilerinin daha sonra ekleneceği açıkça yazıyor.
- `kvkk-aydinlatma.html:34-37`: KVKK başvuru kanalının ileride yayımlanacağı belirtiliyor.
- `gizlilik-politikasi.html:21-30`: Üretim saklama altyapısının devreye alınmadığını belirten geçici ifade ve somut olmayan “iletişim kanalları” kullanılıyor.
- `index.html:1388-1455`: `#iletisim` bölümü gerçek telefon, e-posta, adres veya sosyal hesap içermiyor.
- Frontend genelinde statik bir `mailto:` veya işletmeye ait `tel:` bağlantısı bulunmuyor; görülen telefon/e-posta bağlantıları yalnız API'den gelen müşteri/personel verileri için oluşturuluyor.

**Risk:** Yasal başvuru sahibinin kime ve hangi kanaldan ulaşacağı belli değil. Site tamamlanmış izlenimi verirken yasal sayfalar açıkça taslak durumunda.

**Öneri:** Yayın öncesinde hukuk/onay sahibi tarafından doğrulanmış ticari unvan, veri sorumlusu bilgisi, adres, e-posta/KEP veya tanımlı başvuru kanalı girilmeli. Bu bilgiler tek bir `site-config` kaynağından footer ve üç yasal sayfaya dağıtılmalı; yasal metnin kendisi otomatik üretilmemeli, onaylı sürüm olarak tutulmalı.

### HC-02 — Fiyat, indirim ve kapora dört ayrı katmanda tanımlı (P1) — Çözüldü

**Durum:** 7 Ağustos 2026 tarihinde çözüldü.

**Uygulanan çözüm**

- İndirim oranı ve kapora üst sınırı `backend/src/services/booking.service.ts:36-54` içinde tek `paymentPolicy` kaynağında toplandı; backend nihai ödeme tutarını aynı politika ile hesaplıyor.
- Public katalog `backend/src/routes/public.routes.ts:96-112` üzerinden paket/hizmet fiyatlarıyla birlikte ödeme politikasını döndürüyor.
- Paket oluşturucu `js/package-builder/application.js:179-207` içinde katalog ve politika sözleşmesini doğruluyor; `js/package-builder/application.js:361-421` içinde yalnız sunucudan gelen politika ile istemci önizlemesi üretiyor.
- `index.html:974-977` ve `paketini-olustur.html:120-270` içindeki gerçek sayısal başlangıç değerleri yükleme metinlerine dönüştürüldü. API yüklenmeden paket akışında ilerleme kapalıdır.
- `js/shared/service-catalog.js` içindeki paket/hizmet fiyat yedekleri kaldırıldı. Ana sayfa fiyatları `js/home/services.js:31-66` üzerinden katalog API'sinden geliyor.

**Doğrulama:** Backend birim testleri ödeme politikasının tek kaynağını; gerçek veritabanı entegrasyon testi `/catalog` sözleşmesini; E2E testleri ise backendin gönderdiği varsayılandan farklı `%20` indirim ve 30 TL kapora değerlerinin masaüstü/mobil frontend önizlemesine aynen yansıdığını doğruluyor.

**Kalan not:** `backend/prisma/seed.ts` fiyatların ayrı bir çalışma zamanı kaynağı değil, veritabanının ilk kurulum verisidir. Üretimde güncel katalog otoritesi veritabanıdır ve admin/API üzerinden yönetilir.

### HC-03 — Teslim süresi tanımları çelişiyor (P1) — Çözüldü

**Durum:** 7 Ağustos 2026 tarihinde “21 takvim günü” tanımı seçilerek çözüldü.

**Uygulanan çözüm**

- `js/shared/service-catalog.js` içindeki fotoğraf, video, drone, Jimmy Jib ve dış çekim teslim metinleri “21 takvim günü” olarak tekleştirildi.
- `index.html` içindeki teslimat FAQ yanıtı aynı tanıma geçirildi.
- `js/shared/custom-dialogs.js` içindeki admin hizmet formu örneği, yeni katalog girişlerinde aynı tanımı teşvik edecek şekilde güncellendi.
- Paket oluşturucudaki mevcut “21 takvim günü” tanımı korunarak public akışların aynı müşteri taahhüdünü göstermesi sağlandı.

**Doğrulama:** E2E testi ana sayfadaki hizmet detayının ve FAQ yanıtının “21 takvim günü” gösterdiğini doğruluyor.

### HC-04 — Ana sayfa hizmet kataloğu admin/API kataloğundan kopuk (P1) — Çözüldü

**Durum:** 7 Ağustos 2026 tarihinde ana sayfa kartları ile hizmet detay modalı aynı public `/catalog` yanıtına bağlanarak çözüldü.

**Uygulanan çözüm**

- `js/home/services.js`, API'deki aktif hizmet listesini adı, açıklaması, görseli, sırası, fiyatı, teslim bilgisi, özellikleri ve galerisiyle normalize edip kartları yeniden render ediyor.
- Ana sayfa kartı ve detay modalı aynı normalize edilmiş katalog nesnesini kullanıyor; admin panelinden eklenen yeni hizmetler görünürken pasife alınan hizmetler kaldırılıyor.
- `index.html` içindeki statik kartlar API erişilemediğinde dayanıklı başlangıç/SEO içeriği olarak korunuyor; API başarıyla geldiğinde görüntülenen kataloğun otoritesi backend oluyor.
- Boş aktif katalog için kullanıcıya açıklayıcı durum mesajı gösteriliyor ve API'de karşılığı olmayan yerel kartlar yayınlanmıyor.

**Doğrulama:** E2E testi API'den gelen yeni bir hizmetin kart adı, açıklaması, görseli ve modal alanlarıyla render edildiğini; statik katalogdaki API dışı hizmetin kaldırıldığını masaüstü ve mobil Chromium'da doğruluyor.

### HC-05 — Frontend ve backend form doğrulamaları aynı sözleşmeyi paylaşmıyor (P1)

**Kanıt**

- Telefon frontend kuralı `js/package-builder/application.js:725-736`: Türkiye formatına indirgenmiş, ilk hanesi 2–5 olan tam 10 hane kabul ediliyor.
- Backend telefon kuralı `backend/src/schemas/api.schemas.ts:9-14`: 10–24 karakter ve daha genel uluslararası telefon ayraçları kabul ediyor.
- Paket formundaki ad alanları `paketini-olustur.html:309-399` yalnız `required`; backend `backend/src/schemas/api.schemas.ts:4-7` içinde 2–80 karakter ve harf tabanlı regex uyguluyor.
- Paket notu `paketini-olustur.html:611-617` için istemci üst sınırı yok; backend `backend/src/schemas/api.schemas.ts:78` içinde 2.000 karakter sınırı uyguluyor.
- Admin düğün/personel formlarında da birçok alan yalnız `required` (`admin.html:429-433`, `admin.html:502-579`); ayrıntılı sınırlar yine backendde.

**Risk:** Backendin kabul edeceği bazı telefonlar frontend tarafından engellenirken, backendin reddedeceği ad/not değerleri kullanıcıya ancak API çağrısından sonra hata verir. Kural değişiklikleri iki katmanı sessizce ayrıştırabilir.

**Öneri:** Backend güvenlik otoritesi olarak kalmalı. Public bir form-sözleşme/config yanıtı veya paylaşılan, build sırasında üretilen frontend doğrulama sabitleri kullanılmalı. En azından `maxlength`, ad deseni ve telefon kapsamı ürün kararıyla eşitlenip E2E sözleşme testleri eklenmeli.

### HC-06 — Referans mekânlar ve görünür adet statik (P2)

**Kanıt**

- `index.html:1002-1093`: 7 referans mekân adı/görseli statik.
- `index.html:1104` ve `js/home/venues.js:14`: “7 Mekân” sayısı iki yerde sabit.
- `backend/prisma/seed.ts:5-13`: Aynı mekân ailesi backend başlangıç verisinde farklı sunum adlarıyla tekrar tanımlı (`Cess` / `Cess Wedding`, `Ömerli Mafsel` / `Mafsel Ömerli` gibi).
- `css/home/shoots.css:174-182`: Talia, Bella ve Rena poster görselleri CSS içinde sabit URL olarak bağlı.

**Risk:** Mekân ekleme, pasife alma, ad veya görsel değişikliği ana sayfaya yansımaz; adet metni kolayca yanlış kalır.

**Öneri:** Referans olarak gösterilme, sıralama, kısa sunum adı ve görsel alanları venue modeline veya ayrı içerik manifestine eklenmeli. Buton adedi DOM/veri listesinden hesaplanmalı.

### HC-07 — Galeri ve video içerikleri doğrudan markup/depolama adresine bağlı (P2)

**Kanıt**

- `index.html:439-517`: 8 galeri kaydı statik HTML.
- `index.html:562-672`: 3 çekim videosu; mekân adı, tarih ve açıklamalar statik.
- `index.html:573`, `:611`, `:649`: Supabase Storage proje alanı doğrudan URL içinde. 3 referans yalnız 2 benzersiz video dosyasına gidiyor; `video1.mp4` hem Talia hem Rena için kullanılıyor.
- `js/home/gallery.js:1-70` ve `js/home/shoots.js:1-65`: Davranış DOM'daki statik sıralama ve içeriğe bağlı.

**Risk:** Depolama alanı/CDN değişimi HTML deploy gerektirir. Aynı videonun iki farklı referansta kullanılması bilinçli değilse içerik hatasıdır. Harici medya hatasında merkezi fallback veya yayın durumu yoktur.

**Öneri:** Galeri/video kayıtlarını `media-manifest.json`, CMS veya public içerik API'sine taşıyın. Her kayıt için `id`, başlık, tarih, venue, poster, video URL, alt metin ve yayın durumu tutun. Storage hostname deploy/config katmanında yönetilsin.

### HC-08 — Rol, durum ve uzmanlık eşlemeleri kopyalanmış (P2)

**Kanıt**

- Uzmanlık etiketleri hem `js/admin/app.js:8-16` hem `js/operations/app.js:3-11` içinde aynı 7 değerle tanımlı; enum kaynağı `backend/prisma/schema.prisma:69-77` içinde backendde.
- Teslimat sırası/etiketleri `js/customer-panel/app.js:3-10`, admin etiketleri `js/admin/app.js:17-23` içinde ayrı.
- Mesaj türleri `js/admin/app.js:24-29`, backend enumu `backend/prisma/schema.prisma:51-56` içinde ayrı.
- Rol → panel yolu hem `js/shared/auth-session.js:25-40` hem `js/login/login.js:46-52` içinde tekrar ediyor.

**Risk:** Yeni enum değeri veya etiket değişikliği bazı ekranlarda `undefined`, yanlış sıralama ya da farklı yönlendirme üretebilir.

**Öneri:** Rol/panel yolu ve tüm kullanıcıya dönük enum etiketlerini `js/shared/domain-labels.js` benzeri tek frontend modülünde toplayın. Enum değerlerini mümkünse OpenAPI/JSON Schema gibi backend sözleşmesinden build sırasında doğrulayın; yetkilendirme yine backendde kalmalı.

### HC-09 — Tarih, yıl ve doğrulanması gereken pazarlama iddiaları statik (P2)

**Kanıt**

- Copyright: `index.html:1451` ve `paketini-olustur.html:1130` — 2026.
- Üç yasal sayfanın tarihi: `kvkk-aydinlatma.html:15`, `gizlilik-politikasi.html:15`, `kullanim-sartlari.html:15` — 27 Temmuz 2026.
- Referans çekim tarihleri: `index.html:596`, `:634`, `:672`.
- Pazarlama/faktüel iddialar: `index.html:11`, `:172`, `:181-182`, `:995`, `:1232-1234`, `:1401` — “Türkiye'nin En Kapsamlı”, yüzlerce organizasyon, 2018'den beri ve 2027 uluslararası hedefi.

**Risk:** Yıllık bakım unutulur; doğrulanmayan veya zamanı geçen iddialar SEO, marka güveni ve hukuki inceleme riski yaratır.

**Öneri:** Copyright yılı çalışma zamanında üretilebilir. Yasal “son güncelleme” tarihi yalnız onaylı doküman revizyonunda değişmeli. Pazarlama iddiaları içerik sahibi, kanıt bağlantısı ve gözden geçirme tarihi bulunan bir manifest/CMS kaydı olmalı.

### HC-10 — Manuel cache-busting sürümleri tutarsız yönetiliyor (P2)

**Kanıt**

- `index.html:69-73`, `paketini-olustur.html:39-40`, `login.html:36-37`: Dosya URL'lerinde elle yazılmış tarih/sürüm sorguları var.
- Admin, operasyon ve müşteri paneli girişleri (`admin.html:16-17`, `operasyon-paneli.html:16-17`, `musteri-paneli.html:16-17`) sürümsüz asset URL'leri kullanıyor.

**Risk:** Bir dosyada sürüm artırmayı unutmak eski asset sunabilir; diğer sayfalarda cache davranışı deploy/header ayarlarına bağlı ve farklıdır.

**Öneri:** Build sırasında content hash üreten manifest kullanın veya Nginx cache politikasını dosya türüne göre açıkça yönetin. Elle yazılan `?v=` değerlerini kaldırın.

### HC-11 — Locale, para birimi ve saat dilimi dağınık sabitler (P3)

**Kanıt**

- `tr-TR`, `TRY` ve `Europe/Istanbul` admin/operasyon/paket modüllerinde birçok kez doğrudan yazılmıştır; örnekler `js/admin/app.js:119-155`, `js/operations/app.js:42-73`, `js/package-builder/application.js:4-5`.
- Müşteri paneli `js/customer-panel/app.js:12-13` tarih formatında açık saat dilimi kullanmıyor; admin ve operasyon panelleri İstanbul saatini açıkça kullanıyor.
- Operasyon başlığında şehir `js/operations/app.js:503-504` içinde “İstanbul” olarak sabit.

**Risk:** Tek pazar varsayımı değişirse geniş çaplı düzenleme gerekir. Müşteri paneli farklı saat dilimindeki tarayıcıda admin/operasyon ekranından farklı tarih gösterebilir.

**Öneri:** `js/shared/runtime-config.js` içinde locale, currency, time zone ve operasyon şehri tanımlayın. Tarih yardımcılarını ortaklaştırın ve date-only alanların dönüşüm sözleşmesini test edin.

### HC-12 — Tasarım tokenları sayfa grupları arasında parçalı (P3)

**Kanıt**

- 17 CSS kaynak dosyasında toplam 631 renk literal kullanımı, 67 media-query ve 65 sayısal `z-index` kullanımı saptandı. Bu sayılar değişken tanımlarını ve bilinçli görsel efektleri de içerir; tek başına hata sayısı değildir.
- En yoğun dosyalar: `css/package-builder/package-builder.css` (200 renk literal kullanımı), `css/admin/admin.css` (73), `css/home/home.css` (63).
- `css/admin/admin.css:2-17` ile `css/operations/operations.css:2-17` neredeyse aynı palette/radius/sidebar tokenlarını ayrı ayrı tanımlıyor.
- Kaynaklarda 21 farklı `max-width` breakpoint değeri var: 370, 380, 430, 480, 520, 560, 640, 680, 700, 760, 780, 820, 900, 920, 960, 1060, 1080, 1120, 1180, 1200 ve 1280 px.

**Risk:** Marka rengi, responsive eşik veya katman sırası değişiklikleri çok dosyalı ve regresyona açık hale geliyor.

**Öneri:** Bunları CMS/backend config'e taşımayın. Ortak `css/shared/tokens.css` içinde marka, durum, breakpoint yaklaşımı ve z-index ölçeği tanımlayın; sayfaya özel dekoratif renkler yerel kalabilir. Admin ve operasyon ortak kabuk stilleri ayrıştırılmaya en uygun ilk alandır.

### HC-13 — API geliştirme adresi ve istemci sözleşme sabitleri kod içinde (P3)

**Kanıt**

- `js/shared/api-client.js:1-8`: localhost için port `5000`, üretim için `/api/v1` varsayımı; meta etiketiyle override desteği var.
- `js/shared/api-client.js:35-36`: CSRF cookie/header adları kod sözleşmesi olarak sabit.
- `js/package-builder/application.js:37` ve `:112`: session storage anahtarı ve özel salon sentinel değeri sabit.

**Değerlendirme:** Bunlar fiyat veya içerik gibi işletme tarafından değiştirilecek alanlar değildir. Port ve API yolu deploy ortamları çoğalırsa merkezi runtime config'e alınabilir; cookie adı, storage anahtarı ve sentinel değer ise ortak sözleşme sabiti olarak kodda kalabilir.

### HC-14 — Marka yazımı bir noktada farklı (P3)

**Kanıt**

- Genel kullanım “Düğünajansım” iken `js/login/login.js:74-77` içinde “Düğün Ajansım” yazıyor.

**Öneri:** Marka adı ortak site config sabitinden gelsin veya en azından lint/test ile tek yazım doğrulansın.

## Kaynağa göre taşınma matrisi

| Alan                            | Bugünkü kaynaklar                             | Hedef tek kaynak                                              |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Paket/hizmet fiyatı ve aktiflik | HTML + frontend katalog + backend seed/DB     | Backend DB + public katalog API                               |
| İndirim/kapora hesabı           | HTML + frontend JS + backend servis           | Backend fiyat politikası/önizleme yanıtı                      |
| Teslim taahhüdü                 | HTML + frontend katalog + admin serbest metni | Katalog alanı + onaylı içerik sözleşmesi                      |
| İşletme/yasal iletişim          | Taslak yasal HTML; footerda eksik             | Onaylı site config + sürümlü yasal doküman                    |
| Hizmet/mekân kartları           | Ana sayfa HTML + JS/CSS + backend             | Public içerik/katalog API veya build manifesti                |
| Galeri ve videolar              | Ana sayfa HTML + doğrudan Storage URL         | Medya manifesti/CMS + yapılandırılmış CDN kökü                |
| Rol/durum/uzmanlık etiketleri   | Birden fazla JS modülü                        | Ortak frontend domain modülü, backend sözleşmesiyle doğrulama |
| Locale/timezone/currency        | Birden fazla JS modülü                        | Ortak runtime config ve formatter yardımcıları                |
| Marka/SEO/copyright             | Birden fazla HTML ve JS                       | Site config; yasal ve pazarlama iddiaları onay akışıyla       |
| Renk/radius/z-index ölçeği      | Sayfa bazlı CSS kökleri ve literaller         | Ortak CSS token katmanı                                       |

## Önerilen uygulama sırası

1. **Yayın engelleri:** Gerçek veri sorumlusu ve iletişim bilgilerini tamamlayın; taslak yasal ifadeleri hukuk/onay sürecinden geçirin.
2. **Ticari tek kaynak:** Ödeme politikası ve gösterilen tüm sayısal fiyatları backend yanıtına bağlayın; API gelmeden eski fiyat göstermeyin.
3. **Public içerik modeli:** Ana sayfa hizmetleri, referans mekânlar, galeri, videolar, FAQ ve SEO verileri için build manifesti veya public content endpointi kurun.
4. **Sözleşme ortaklaştırma:** Rol yolları, enum etiketleri, formatlayıcılar ve form sınırlarını ortak modüllere alın; backend sözleşmesiyle test edin.
5. **Build ve tasarım borcu:** Hashli asset manifesti, ortak CSS tokenları ve kontrollü breakpoint/z-index ölçeği oluşturun.

## Bilinçli olarak sorun sayılmayan sabitler

- HTML erişilebilirlik etiketleri, buton metinleri ve hata mesajları; çok dillilik hedefi yoksa kodda kalabilir.
- CSS boyutları ve animasyon değerleri; içerik config'i değil, tasarım sisteminin parçasıdır. Yalnız tekrar edenler tokenlaştırılmalıdır.
- API route pathleri, DOM selectorları, storage anahtarları ve enumların makine değerleri; ortak sözleşme sabiti olarak kodda kalabilir.
- `index.html` içindeki `__APP_ORIGIN__` placeholderı; `Dockerfile:3-17` ve `compose.production.yaml:213` üzerinden üretim buildinde doğrulanıp değiştiriliyor.
- E2E test fixturelarındaki sabit tarih, kişi, fiyat ve UUID değerleri; deterministik test verisidir.

## Güvenlik taraması notu

HTML, CSS ve `js/` kapsamındaki basit desen taramasında gömülü API anahtarı, bearer token, servis rolü anahtarı veya düz metin parola saptanmadı. Supabase Storage hostname'i açık bir medya URL'sidir; gizli anahtar değildir, ancak HC-07 kapsamındaki dağıtım bağımlılığıdır.

## Kabul ölçütleri

Bu rapordaki hardcoded borcun giderildiği şu kontrollerle ölçülebilir:

- Admin panelinden fiyat/hizmet/mekân değişikliği yapıldığında public sayfalarda ayrıca kaynak kod düzenlemeden güncel bilgi görünür.
- Frontend kaynaklarında ödeme oranı veya kapora üst sınırı sayısal iş kuralı olarak bulunmaz.
- Teslim süresi için onaylı tek “21 takvim günü” ifadesi kullanılır.
- Footer ve yasal sayfalarda aynı, doğrulanmış iletişim/veri sorumlusu bilgileri görünür.
- Rol/durum/uzmanlık etiketlerinin tek frontend kaynağı vardır ve backend enumlarıyla sözleşme testi bulunur.
- Asset sürümleri elle yazılan tarih sorgularına bağlı değildir.
- Frontend kalite kapıları (`npm run validate`, `npm run audit:performance`, `npm run test:e2e`) yeni veri kaynağıyla da geçer.
