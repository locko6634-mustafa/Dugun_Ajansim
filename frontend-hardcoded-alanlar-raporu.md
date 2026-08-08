# Frontend Hardcoded Alanlar Raporu

- **Tarih:** 9 Ağustos 2026
- **İncelenen dal/revizyon:** `main` / `f66616a20a6164029ea176f87aa859ce8bec4034`
- **Kapsam:** 9 HTML girişi, `js/` altında 23 JavaScript modülü ve üretilen `css/home/styles.css` hariç 17 CSS kaynak dosyası
- **Kapsam dışı:** Test fixture'ları, `node_modules`, build/test çıktıları ve backendin genel kod kalitesi. Backend yalnız frontend sözleşmelerini doğrulamak için hedefli incelendi.

## Yönetici özeti

Frontenddeki her sabit değer hata değildir. DOM seçicileri, route yolları, erişilebilirlik metinleri ve tasarım ölçüleri kodun doğal parçasıdır. Bu denetimde değişme ihtimali olan işletme/yayın verileri ile teknik sabitler ayrıldı.

Güncel durumda en önemli açıklar şunlardır:

1. **Yasal ve iletişim içeriği yayın için tamamlanmamış (P0):** Veri sorumlusu kimliği ve başvuru kanalı yok; ana sayfadaki iletişim alanında gerçek iletişim bilgisi bulunmuyor. KVKK kabulünde onaylanan belge sürümü de kaydedilmiyor.
2. **Public saat seçici backend sözleşmesiyle uyumsuz (P1):** Paket oluşturucu yalnız `09:00–23:30` arasında 30 dakikalık seçenekler üretirken backend `00:00–23:59` aralığını kabul ediyor. Ertesi gün `02:00` gibi geçerli saatler public arayüzden seçilemiyor.
3. **Galeri, video ve yayın metinleri kaynak koda bağlı (P2):** Referans içerikleri, FAQ, SEO metinleri ve Supabase Storage adresleri HTML deployu olmadan yönetilemiyor.
4. **Merkezileştirme kısmi (P2/P3):** Fiyat, ödeme politikası, mekânlar, temel domain etiketleri ve bölgesel ayarlar merkezileştirilmiş olsa da katalog fallback içeriği, başvuru durum etiketleri, admin form sınırları ve tasarım tokenlarında tekrarlar sürüyor.

## Öncelik tanımı

| Seviye | Anlamı                                                                      |
| ------ | --------------------------------------------------------------------------- |
| P0     | Yayın öncesi tamamlanmalı; yasal veya temel güven riski                     |
| P1     | Müşterinin yanlış işlem yapmasına veya akış uyumsuzluğuna yol açabilir      |
| P2     | İçerik/operasyon değişikliğinde kod deployu veya çoklu düzenleme gerektirir |
| P3     | Teknik borç; mevcut davranış çoğunlukla doğru fakat bakım maliyeti yüksek   |

## Açık bulgular

### HC-01 — Yasal kimlik, iletişim kanalı ve onay sürümü eksik (P0)

**Kanıt**

- `kvkk-aydinlatma.html:16-21`: Veri sorumlusu yalnız “Düğünajansım” olarak geçiyor; gerçek kimliğin ve iletişim bilgilerinin daha sonra ekleneceği yazıyor.
- `kvkk-aydinlatma.html:34-39`: KVKK başvuru kanalı somutlaştırılmamış.
- `gizlilik-politikasi.html:24-32`: Üretim saklama altyapısının devreye alınmadığını belirten geçici ifade ve belirsiz “iletişim kanalları” kullanılıyor.
- `index.html:192-199`: Ana CTA “İletişim yakında” durumunda.
- `index.html:1288-1356`: `#iletisim` footerı telefon, e-posta, adres veya sosyal hesap içermiyor.
- `paketini-olustur.html:621-665`: KVKK ve pazarlama kabul metinleri doğrudan HTML içinde.
- `backend/prisma/schema.prisma:228-229`: Yalnız `privacyConsentAt` ve `marketingConsentAt` zamanları tutuluyor; kabul edilen belge kimliği/sürümü saklanmıyor.
- Frontenddeki `mailto:` ve `tel:` üretimleri yalnız API'den gelen müşteri/personel verileridir; işletmeye ait statik iletişim kanalı saptanmadı.

**Risk:** Kullanıcı kime ve hangi kanaldan başvuracağını göremiyor. Metin daha sonra değişirse geçmiş bir başvurunun hangi onay metnini kabul ettiği teknik olarak kanıtlanamıyor.

**Öneri:** Hukuk/onay sahibi tarafından doğrulanmış ticari unvan, veri sorumlusu, adres ve başvuru kanallarını sürümlü bir site/yasal içerik kaynağında tutun. Başvuruya `privacyNoticeVersion` ve gerekiyorsa `marketingConsentVersion` ekleyip kabul anındaki sürümü backendde kaydedin.

### HC-02 — Public düğün saatleri kod içinde `09:00–23:30 / 30 dk` ile sınırlı (P1)

**Kanıt**

- `js/package-builder/application.js:964-977`: Saat seçenekleri `9 * 60` ile `23 * 60 + 30` arasında, `30` dakikalık artışla üretiliyor.
- `paketini-olustur.html:527-602`: Başlangıç ve bitiş alanları yalnız bu özel seçiciyi kullanıyor; “bitiş ertesi gün” seçeneği mevcut.
- `backend/src/schemas/api.schemas.ts:41,88-89`: Backend herhangi bir geçerli `HH:mm` değerini kabul ediyor; `09:00–23:30` veya 30 dakika kuralı yok.
- `admin.html:532-535,583-586`: Admin formlarında native `time` alanları var ve aynı aralık uygulanmıyor.
- Backend test verilerinde `20:00–02:00` gibi ertesi güne geçen saatler destekleniyor; public seçenek listesinde `02:00` bulunmuyor.

**Risk:** Backend açısından geçerli düğün saatleri public başvuruda seçilemiyor. Public, admin ve operasyon kanalları farklı iş kuralı uyguluyor.

**Öneri:** Çalışma saati, gün aşımı ve slot adımını backend/public config sözleşmesine ekleyin. Örneğin `bookingSchedulePolicy: { startMinute, endMinute, stepMinutes, allowNextDay }` yanıtı üretin ve hem public hem admin seçicilerini aynı kaynaktan oluşturun. Aralık işletme kuralı değilse public seçiciyi tam gün destekleyecek şekilde düzenleyin.

### HC-03 — Galeri ve video vitrini statik HTML ile harici Storage adreslerine bağlı (P2)

**Kanıt**

- `index.html:421-517`: 8 galeri kaydı, görsel yolu, alt metni ve sıra bilgisi statik.
- `index.html:556-668`: 3 video kartının mekân adı, tarih, poster ve açıklaması statik.
- `index.html:567,605,643`: Supabase Storage proje hostname'i doğrudan HTML içinde.
- `index.html:567,643`: Talia ve Rena kartları aynı `video1.mp4` kaynağına gidiyor.
- `css/home/shoots.css:173-182`: Üç poster yolu HTML'e ek olarak CSS içinde tekrar tanımlı.
- `index.html:515-517`: Galeri ilerleme göstergesi 4 sabit nokta; kart sayısı değişirse markup da güncellenmek zorunda.
- `js/home/gallery.js` ve `js/home/shoots.js`: Davranış, başlangıçta DOM'da bulunan statik kartlara bağlanıyor.

**Risk:** Medya, CDN veya sıra değişikliği kod deployu gerektirir. Aynı dosyanın iki farklı referans gibi sunulması içerik hatası olabilir. Harici alan değişiminde merkezi fallback/yayın kontrolü yoktur.

**Öneri:** Galeri ve video kayıtlarını bir public içerik API'si veya `media-manifest.json` kaynağına taşıyın. Her kayıt için `id`, başlık, tarih, venue, poster, medya URL'si, alt metin, sıra ve yayın durumu saklayın; Storage/CDN kökünü ortam yapılandırmasına alın.

### HC-04 — FAQ, SEO ve pazarlama vaatleri kaynak kodda dağınık (P2)

**Kanıt**

- `index.html:8-40`: Başlık, description, Open Graph, Twitter ve Organization JSON-LD metinleri ayrı ayrı yazılmış.
- `index.html:1040-1270`: 8 FAQ kaydı statik HTML. Teslim süresi, hizmet bölgesi, paket kapsamı ve “dilediğiniz zaman ek hizmet” gibi operasyonel vaatler burada tutuluyor.
- `index.html:70-419` ve `:1288-1356`: Marka, navigasyon, hero, fayda ve footer metinleri doğrudan HTML içinde.
- `login.html`, `paketini-olustur.html`, `admin.html`, `operasyon-paneli.html`, `musteri-paneli.html` ve üç yasal sayfa kendi title/marka metinlerini ayrı ayrı taşıyor.
- HTML ve üretim JS kapsamındaki ölçümde “Düğünajansım” 56 kez kullanılıyor.

**Risk:** Marka, SEO, iletişim veya iş vaadi değişikliğinde çoklu dosya düzenlemesi gerekir. FAQ ile gerçek katalog/operasyon davranışı zaman içinde ayrışabilir.

**Öneri:** Marka, SEO, iletişim, footer ve FAQ için tek bir yayın içeriği kaynağı oluşturun. FAQ cevaplarında ölçülebilir iş kurallarını serbest metin yerine katalog/politika alanlarından türetin veya editoryal onay sürecine bağlayın. Yasal dokümanları otomatik üretmeyin; onaylı ve sürümlü belge olarak yönetin.

### HC-05 — Hizmet kataloğunun yerel fallback içeriği API ile birlikte yaşamaya devam ediyor (P2)

**Kanıt**

- `js/shared/service-catalog.js:1-181`: Bir temel paket görseli ile 8 hizmetin adı, açıklaması, özellikleri, teslim metni, görseli ve galerisi statik.
- `index.html:688-921`: Aynı 8 hizmet için SEO/ilk render kartları ayrıca HTML içinde.
- `js/home/services.js:107-172`: API başarılı olduğunda kartlar yenileniyor; API başarısızsa HTML'deki başlangıç içeriği kalıyor.
- `js/package-builder/application.js:241-277`: API kayıtlarında alan eksik olduğunda eşleşen yerel katalog açıklaması, galeri ve görselleri fallback olarak kullanılıyor.

**Olumlu durum:** Fiyat, aktiflik ve normal çalışma zamanı kataloğunun otoritesi backend/API'dir; API olmadan ödeme akışına devam edilmiyor.

**Risk:** Admin/API içeriği değiştiğinde kaynak HTML ve yerel fallback eski kalabilir. JavaScript çalışmadan okuyan botlar veya API hatası yaşayan kullanıcılar farklı katalog görebilir.

**Öneri:** Public katalog için build-time snapshot/SSR benzeri tek bir üretim kaynağı kullanın ya da yerel fallback'i açıkça sürümlenmiş, API'den üretilen bir manifest haline getirin. Aynı hizmet metnini elle üç yerde yönetmeyin.

### HC-06 — Başvuru, ödeme ve hesap durum etiketleri hâlâ tekrarlı (P2)

**Kanıt**

- `js/shared/domain-labels.js`: Rol/panel, personel uzmanlığı, teslimat durumu ve mesaj türü etiketleri merkezileştirilmiş.
- `admin.html:253-257,527-542,578-579`: Başvuru durumu, birincil kişi ve ödeme yöntemi option/etiketleri statik.
- `js/admin/app.js:525-579` ile `:642-674`: `GELIN/DAMAT`, `CASH/DEPOSIT` ve dört başvuru durumu iki render akışında ayrı ayrı eşleniyor.
- `js/admin/app.js:920,1025,1061-1064`: Mesaj gönderim ve hesap aktiflik durumları yeniden inline eşleniyor.

**Risk:** Backende yeni enum eklendiğinde bazı ekranlar ham anahtar, yanlış sınıf veya eksik filtre gösterebilir. Mevcut domain sözleşme kontrolü bu kalan eşlemelerin tamamını kapsamıyor.

**Öneri:** `BOOKING_STATUS_LABELS`, `PAYMENT_METHOD_LABELS`, `PRIMARY_CONTACT_LABELS`, `MESSAGE_STATUS_LABELS` ve `ACCOUNT_STATUS_LABELS` haritalarını ortak domain modülüne alın; backend enum/şema anahtarlarıyla otomatik sözleşme kontrolüne ekleyin.

### HC-07 — Admin katalog formu sınırları backend şemasından türemiyor (P2)

**Kanıt**

- `js/shared/custom-dialogs.js:250`: Fiyat alanı `step="50"`; bu, yönetim arayüzünü 50 TL katlarına yönlendiriyor.
- `backend/src/schemas/api.schemas.ts:165,180`: Backend kuruş cinsinden `0–100.000.000` aralığını kabul ediyor; 50 TL adımı tanımlı değil.
- `js/shared/custom-dialogs.js:238-317`: Kod, ad, açıklama, teslim, görsel, özellik ve galeri alanlarında backendin 100/200/500/2.000 karakter sınırları input özelliklerine uygulanmıyor.
- `js/shared/custom-dialogs.js:461,524` ile `backend/src/schemas/api.schemas.ts:188-194`: Mekân sıra limiti ve slug regex'i iki katmanda ayrı ayrı yazılmış; bugün eşleşseler de ortak sözleşmeden gelmiyor.

**Risk:** Admin kullanıcıları backendin kabul ettiği bazı fiyatları tarayıcı doğrulaması nedeniyle giremeyebilir; metin sınırlarında ise ancak API hatasından sonra geri bildirim alır. Şema değişiklikleri iki katmanda elle senkronize edilir.

**Öneri:** Admin katalog/venue form sözleşmesini public olmayan bir admin config/schema yanıtıyla paylaşın veya ortak üretilen doğrulama manifesti kullanın. `step=50` bilinçli fiyat politikasıysa backendde de açıkça doğrulayın; değilse UI kısıtını kaldırın.

### HC-08 — Tasarım tokenları ve responsive eşikler parçalı (P3)

**Ölçüm**

- 17 CSS kaynak dosyasında 638 renk literal kullanımı, 67 media query ve 65 sayısal `z-index` kullanımı saptandı. Bu sayılar değişken tanımlarını ve bilinçli dekoratif efektleri de içerir; tek başına hata sayısı değildir.
- En yoğun dosyalar: `css/package-builder/package-builder.css` 200, `css/admin/admin.css` 76, `css/home/home.css` 63 renk literal kullanımı.
- 21 farklı `max-width` breakpoint değeri var: 370, 380, 430, 480, 520, 560, 640, 680, 700, 760, 780, 820, 900, 920, 960, 1060, 1080, 1120, 1180, 1200 ve 1280 px.
- `css/admin/admin.css:1-17` ile `css/operations/operations.css:1-17` aynı kabuk paleti, radius, shadow ve sidebar tokenlarını küçük farklarla yineliyor.

**Risk:** Marka rengi, responsive eşik veya katman sırası değişikliği çok dosyalı ve görsel regresyona açık hale geliyor.

**Öneri:** Bunları backend/CMS'e taşımayın. Ortak `css/shared/tokens.css` ve panel kabuk katmanında marka, durum, radius, z-index ve responsive yaklaşımını birleştirin; sayfaya özel dekoratif renkler yerel kalabilir.

### HC-09 — Runtime/deploy ve istemci sözleşme sabitleri kod içinde (P3)

**Kanıt**

- `js/shared/runtime-config.js:1-4`: `tr-TR`, `TRY`, `Europe/Istanbul` ve `İstanbul` tek dosyada fakat build/runtime girdisi değil.
- `js/shared/api-client.js:1-8`: Local hostname listesi, port `5000` ve `/api/v1` varsayımı kodda; `api-base-url` meta override desteği var.
- `js/shared/api-client.js:34-36`: CSRF cookie/header adları istemci-backend sözleşmesi olarak sabit.
- `js/package-builder/application.js:43,121`: Session storage anahtarı ve özel salon sentinel değeri sabit.
- API route pathleri tüm sayfa modüllerinde string olarak bulunuyor.
- `index.html:13-40`: `__APP_ORIGIN__` placeholderı deploy sırasında Dockerfile tarafından doğrulanıp değiştiriliyor.

**Değerlendirme:** Bunların çoğu içerik değil, teknik sözleşme sabitidir. Tek pazar ve tek API sürümü hedefinde kodda kalmaları kabul edilebilir. Çoklu marka/pazar veya farklı API originleri planlanırsa runtime environment manifestine taşınmalıdır.

### HC-10 — Marka yazımı bir kullanıcı mesajında farklı (P3)

**Kanıt**

- Genel kullanım “Düğünajansım” iken `js/login/login.js:72` içinde “Düğün Ajansım” yazıyor.
- Tarama sonucu üretim HTML/JS içinde 56 bitişik, 1 ayrı yazım bulundu.

**Öneri:** Marka adını site config sabitinden üretin veya en azından içerik sözleşmesi testine izin verilen tek yazımı ekleyin.

## Kaynak bazlı hardcoded envanteri

| Kaynak                                         | Sabit alanlar                                                                                  | Değerlendirme / hedef                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `index.html`                                   | SEO, marka, navigasyon, hero, fayda, galeri, videolar, hizmet fallback kartları, FAQ, footer   | SEO/yayın içeriği ve medya manifest/API; yapısal markup kodda kalabilir                    |
| `paketini-olustur.html`                        | Akış başlıkları, alan etiketleri, KVKK/pazarlama kabul metni, ödeme ve tamamlanma açıklamaları | Yasal metin sürümlü; sıradan UI metni kodda kalabilir                                      |
| `login.html` ve panel HTML'leri                | Title, marka, navigasyon, form/filtre seçenekleri                                              | Marka/site config; enum seçenekleri ortak domain sözleşmesi                                |
| Üç yasal HTML                                  | Belge metni ve `27 Temmuz 2026` revizyon tarihi                                                | Onaylı, sürümlü yasal doküman; tarih otomatikleştirilmemeli                                |
| `js/shared/service-catalog.js`                 | Paket/hizmet fallback metni ve 19 benzersiz yerel asset yolunun önemli bölümü                  | API'den üretilen snapshot veya manifest                                                    |
| `js/shared/domain-labels.js`                   | Rol, uzmanlık, teslimat ve mesaj türü etiketleri                                               | Doğru merkezileştirme; backend sözleşme testi korunmalı                                    |
| `js/shared/runtime-config.js`                  | Locale, para birimi, saat dilimi, şehir                                                        | Tek pazar için kabul edilebilir; çoklu pazar için runtime config                           |
| `js/shared/api-client.js`                      | API base fallback, cookie/header ve HTTP varsayımları                                          | Teknik sözleşme; ortam sayısı artarsa runtime manifest                                     |
| `js/package-builder/application.js`            | Saat aralığı, endpointler, storage anahtarı, WhatsApp şablonu, UI/fallback metinleri           | Saat politikası backendden; mesaj şablonu içerik/config; teknik anahtarlar kodda kalabilir |
| `js/admin/app.js`                              | Endpointler, başvuru/ödeme/hesap etiketleri, operasyon mesajları                               | Enum etiketleri ortak domain modülü; UI mesajları kodda kalabilir                          |
| `js/home/gallery.js`, `shoots.js`, `venues.js` | DOM yapısı varsayımları, görünür mekân adedi `4`, fallback görsel, observer eşikleri           | İçerik adedi veriden; görsel davranış sabitleri kodda kabul edilebilir                     |
| CSS kaynakları                                 | Renkler, fontlar, breakpointler, z-index, animasyon ve asset yolları                           | Ortak tasarım tokenları; sayfa dekorasyonu yerel                                           |

## Çözülmüş veya güvenli biçimde merkezileştirilmiş alanlar

Bu maddeler güncel kaynakta tekrar doğrulandı; yeniden açık bulgu sayılmadı:

- **Fiyat ve ödeme politikası:** Paket/hizmet fiyatları ile indirim/kapora politikası backend DB ve `/catalog` yanıtından geliyor. API olmadan paket/ödeme akışı açılmıyor.
- **Ödeme talimatları:** Banka, hesap sahibi, IBAN ve WhatsApp numarası frontend kaynaklarında gömülü değil; `/payment-instructions` yanıtından geliyor.
- **Form doğrulaması:** Başvuru ad/telefon/e-posta/özel salon/not sınırları backend `bookingFormConstraints` kaynağından public ve admin formlarına uygulanıyor. HC-07'deki admin katalog formları bunun dışında.
- **Referans mekânlar:** Vitrin adı, görsel, sıra ve görünürlük backend/admin/API ile yönetiliyor. `COLLAPSED_VENUE_COUNT = 4` yalnız mobil sunum tercihidir.
- **Rol, teslimat, uzmanlık ve mesaj türü etiketleri:** `js/shared/domain-labels.js` içinde ortak. HC-06, bu modüle henüz alınmamış diğer enumları kapsıyor.
- **Locale/currency/timezone:** Dağınık tekrarlar `js/shared/runtime-config.js` içinde toplanmış ve formatter yardımcıları kullanılıyor.
- **Copyright yılı ve cache-busting:** Yıl çalışma zamanında üretiliyor; elle yönetilen `?v=` asset sürümleri kaldırılmış ve cache politikası deploy katmanında.
- **Doğrulanmamış sayısal pazarlama iddiaları:** Eski ekip/düğün/adet/hedef iddiaları kaldırılmış ve içerik kontrolü kalite kapısına eklenmiş.

## Bilinçli olarak sorun sayılmayan sabitler

- DOM selectorları, event adları, HTTP methodları ve API route pathleri; sürümlü istemci-backend sözleşmesinin parçasıdır.
- Buton, hata, boş durum ve erişilebilirlik metinleri; çok dillilik hedefi yoksa kodda kalabilir. İşletme/yasal vaat içerenler bu istisnaya dahil değildir.
- CSS ölçüleri, SVG pathleri, animasyon süreleri ve observer eşikleri; tasarım/davranış sabitidir. Yalnız tekrar edenler tokenlaştırılmalıdır.
- Session storage anahtarı, özel salon sentinel değeri ve CSRF cookie/header adları; ortak teknik sözleşmedir.
- `__APP_ORIGIN__`; üretim image buildinde zorunlu HTTPS origin ile değiştirilen ve geride kalması engellenen placeholderdır.
- Test fixturelarındaki tarih, fiyat, kişi ve UUID değerleri; deterministik test verisidir.

## Güvenlik ve sır taraması notu

- Üretim HTML/JS kapsamında basit yüksek sinyal desen taramasında gömülü API anahtarı, bearer token, servis rolü anahtarı, düz metin parola, gerçek IBAN veya sabit WhatsApp alıcısı saptanmadı.
- Supabase hostname'i public medya adresidir; sır değildir, ancak HC-03 kapsamındaki deploy/içerik bağımlılığıdır.
- `mailto:` ve `tel:` şablonları admin/operasyon ekranında API'den gelen kullanıcı verileri için oluşturuluyor; işletme iletişim bilgisi olarak değerlendirilmedi.

## Önerilen uygulama sırası

1. **Yayın engeli:** Gerçek veri sorumlusu ve iletişim bilgilerini tamamlayın; yasal/onay metinlerini sürümleyip kabul edilen sürümü backendde saklayın.
2. **Saat sözleşmesi:** Public, admin ve backend için tek düğün saat/slot politikası belirleyin ve API'den dağıtın.
3. **Public içerik modeli:** Galeri, video, FAQ, SEO, marka ve iletişim verilerini yönetilen içerik kaynağına alın.
4. **Katalog snapshotı:** API ile HTML/yerel fallback içeriğini aynı kaynaktan üretin.
5. **Domain ve form sözleşmesi:** Kalan başvuru/ödeme/hesap enumlarını ve admin katalog sınırlarını ortaklaştırın.
6. **Tasarım borcu:** Panel kabuğu ve ortak CSS token katmanını ayırın.

## Kabul ölçütleri

- Footer ve yasal sayfalarda aynı, doğrulanmış veri sorumlusu/iletişim bilgileri görünür; başvuru kaydı kabul edilen metin sürümünü içerir.
- Public saat seçici backendin kabul ettiği politika ile aynı aralık, adım ve ertesi gün davranışını uygular.
- Galeri, video, FAQ, SEO veya iletişim değişikliği için HTML/JS/CSS kaynak düzenlemesi gerekmez.
- Admin kataloğu değiştiğinde API, ilk HTML ve fallback snapshotı arasında içerik farkı oluşmaz.
- Başvuru/ödeme/hesap enum etiketlerinin tek frontend kaynağı ve backend sözleşme testi vardır.
- Admin katalog form limitleri backend şemasıyla aynı kaynaktan üretilir veya otomatik doğrulanır.
- Ortak renk/radius/z-index/panel ölçüleri paylaşılan CSS token katmanından gelir.
