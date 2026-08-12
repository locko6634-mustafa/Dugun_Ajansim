# Faz 00 — Yönetişim, erişimler ve başlangıç tabanı kanıt kaydı

**Kanıt tarihi:** 12 Ağustos 2026
**Saat dilimi:** Europe/Istanbul
**Başlangıç release SHA:** `ca2db408d0945017b2dcce1bc12f25b8d33ea6bd`
**Dal / upstream:** `main` / `origin/main`
**Faz kapsamı:** Yalnız Faz 00; hiçbir P0/P1 düzeltmesi bu fazda uygulanmadı.

## 1. Kaynak ve çalışma ağacı tabanı

| Kayıt | Değer / sonuç |
|---|---|
| Proje talimatı | Kök `AGENT.md` tamamen okundu; kapsamda ek alt klasör talimatı bulunmadı. |
| Başlangıç çalışma ağacı | `git status --short --branch` → `## main...origin/main`; kullanıcıya ait değiştirilmiş veya silinmiş dosya yoktu. |
| HEAD | `ca2db408d0945017b2dcce1bc12f25b8d33ea6bd` |
| Kaynak hazırlık raporu | 12 Ağustos 2026; SHA-256 `4C364010A02413FBABF272D1215E20C4B2669EF32CCC392FE959133FE875FABB` |
| Yol haritası başlangıç sürümü | SHA-256 `A9F008E62EE6BA7A1A123BB97B27C629C3ACE4DBE2356F18FD500DCDBA815F74` |
| GitHub tabanı | Bağlı depo `locko6634-mustafa/Dugun_Ajansim`, varsayılan dal `main`; connector erişimi çalışıyor. Yerel `gh` kimliği geçersiz olduğundan CLI erişimi “ortam hatası” olarak kaydedildi. |

## 2. Ortam, revision ve image tabanı

| Ortam | Revision / image | Sağlık ve not |
|---|---|---|
| Yerel kaynak | `ca2db408…` | Çalışma ağacı başlangıçta temiz. |
| İzole staging | Backend `sha256:5b9e1cb7cd2c940b70f2fbb43584974c8f9282314cde39e79abe88fae9fbf3d3`; frontend `sha256:8b818f7687751a4f54b2850313d5884803cee0d8e5adaba9cf95914554350de7`; migrate `sha256:cb1837f602b35657c9791b4166bbbd87ff8c3b772228220aa383069bba5ffe5b` | Backend, frontend ve PostgreSQL healthy; migrate/runtime-role/hardening işleri exit 0. Backend ve frontend revision etiketi `ca2db408…`; backend kullanıcı `node`, frontend kullanıcı `nginx`. |
| Production checkout | `ca2db408…` | Sunucudaki `/opt/dugun-ajansim/app` checkout’u ve çalışan backend/frontend revision etiketleri başlangıç HEAD’iyle eşleşti. |
| Production image | Backend `sha256:519e076c26ec…`; frontend `sha256:3a3e6934458b…`; PostgreSQL `sha256:d6a50fc…` | İki backend replikası, frontend, PostgreSQL, Traefik ve socket proxy healthy. Production üzerinde yazma/restart/deploy yapılmadı. |

İzole staging `compose.production.yaml` ile `dugun-phase00` proje adında, yerel `edge_proxy` ağı ve yalnız sentetik environment kullanılarak kuruldu. Production secretları kopyalanmadı. Production fail-fast kontrolü Turnstile kapalıyken başlatmayı reddetti; sentetik Turnstile yapılandırmasıyla ortam sağlıklı açıldı. İlk iki başarısız deneme ürün hatası değil test environment hazırlık hatası olarak sınıflandırıldı.

## 3. Sorumluluk ve komuta kaydı

| Alan | Uygulayan | Hesap veren / onaylayan |
|---|---|---|
| Teknik uygulama | Codex GO uygulama agentı | Mustafa |
| Backend ve veri | Codex GO uygulama agentı | Mustafa; canlı veri yazımı/silimi için ön onay zorunlu |
| Frontend ve UX | Codex GO uygulama agentı | Mustafa |
| QA ve cihaz matrisi | Codex: otomasyon/emülasyon; Mustafa: fiziksel cihaz kabulü | Mustafa |
| Sunucu / DevOps | Codex: doğrulama ve onaylı uygulama | Mustafa: kalıcı canlı işlem onayı |
| DNS / TLS | Mustafa | Codex: salt-okunur doğrulama ve onaylı uygulama desteği |
| SEO / Search Console / ölçüm | Mustafa | Codex: teknik uygulama ve kanıt toplama |
| Katalog / fiyat / içerik | Mustafa | Codex: onaylı veriyi uygulama |

**Go-live komuta kanalı:** Bu Codex görevi yazılı karar ve kanıt günlüğüdür.

**Acil karar sahibi:** Mustafa. Başka bir dış acil durum kişisi sağlanmadı; T-1 kapısından önce ayrıca kesinleştirilecek.

## 4. Karar günlüğü

| ID | Tarih | Karar / açık karar | Durum |
|---|---|---|---|
| D-0001 | 2026-08-12 | Faz 00 salt-okunur production doğrulaması ve izole sentetik staging ile yürütülecek; canlı veriye yazılmayacak. | Kabul edildi |
| D-0002 | 2026-08-12 | Fazlar sırayla ve kullanıcı onayıyla ilerleyecek; Faz 00’da P0/P1 düzeltmesi yapılmayacak. | Kabul edildi |
| D-0003 | 2026-08-12 | RPO, RTO, tek-host risk kabulü, gerçek düğün iptal politikası ve veri saklama süreleri ilerideki ilgili fazlarda Mustafa’nın açık iş kararı olmadan kapanmayacak. | Açık karar |
| D-0004 | 2026-08-12 | Ücretli servis kullanılmayacak; offsite yedek ve dış izleme için ücretsiz/self-hosted seçenekler önceliklendirilecek. | Kabul edildi |

## 5. Sentetik veri ve hesap prosedürü

- Ad standardı: `F<faz>-<akış>-<UTC tarih>-<kısa kimlik>`; e-posta alanlarında `example.invalid`, telefonlarda yalnız açıkça sentetik numaralar kullanılır.
- Her test çalışması oluşturduğu kayıt kimliklerini ve marker değerini yalnız kanıt özetinde, PII olmadan tutar.
- Cleanup yalnız marker/explicit ID allowlist’iyle ve önce salt-okunur sayım doğrulamasıyla yapılır. Canlı cleanup ayrıca Mustafa’nın açık onayını gerektirir.
- Admin hesabı belgeli bootstrap yordamıyla, salon yetkilisi admin akışıyla, müşteri hesabı sentetik başvuru onay zinciriyle ayrı ayrı oluşturulur. Ortak kullanıcı veya gerçek müşteri verisi kullanılmaz.
- Parola ve geçici tokenlar yalnız çalışma zamanı secret/env veya parola yöneticisinde tutulur; rapor, log ve commit’e yazılmaz.
- Admin MFA/step-up testi yalnız staging’de yeni sentetik TOTP sırrıyla yapılır; sır/QR kanıta alınmaz, yalnız enrollment/login/step-up/disable sonuçları ve correlation ID kaydedilir. Production MFA değişikliği canlı kalıcı işlem sayılır ve ayrıca onay ister.

## 6. Erişim tabanı

| Kapı | Durum | Faz 00 kanıtı / risk |
|---|---|---|
| Yerel depo ve Docker | Var | Production-benzeri staging kurulup health doğrulandı. |
| GitHub repository | Kısmi | Connector okuma/yazma yetkisi var; yerel `gh` tokenı geçersiz. Production environment’ta protection rule/reviewer görünmedi. |
| Production SSH | Var, onay kapılı | Salt-okunur checkout/container/log/health kontrolleri yapıldı; kalıcı işlem yapılmadı. |
| DNS sağlayıcı paneli | Yok | Yalnız public DNS/HTTP davranışı görülebiliyor; kayıt değişikliği için kullanıcı erişimi gerekir. |
| TLS / edge kontrol düzlemi | Kısmi | Traefik ve sertifika davranışı salt-okunur görüldü; `www` sertifikası başarısız. Değişiklik için kullanıcı onayı gerekir. |
| Image registry | Kanıtlanmadı | Yerel ve production image ID’leri görüldü; bağımsız registry oturumu/immutable digest politikası yok. |
| Offsite/immutable backup | Yok | Aynı hostta şifreli yedekler var; host dışı kopya/restore erişimi kanıtlanmadı. |
| Dış monitoring/alarm | Yok | Host içi workflow/watchdog var; host dışı probe ve bildirim zinciri kanıtlanmadı. |
| Search Console | Yok | Hesap/property erişimi sağlanmadı. |
| Analytics/ölçüm | Yok | Hesap ve event doğrulama erişimi sağlanmadı. |
| Chrome canlı oturumu | Var | Mevcut kullanıcı oturumunda yalnız salt-okunur UI/console/layout kontrolü yapıldı. |

Eksik dış erişimler Faz 00 devir özetinde kullanıcıya tek listede bildirilecektir; ilgili sonraki faz görevi erişim ve somut kanıt gelmeden `[x]` yapılmayacaktır.

## 7. Başlangıç davranış kanıtı

### 7.1 Public başvuru yeniden üretimi

- Ortam: mevcut HEAD’den üretilen backend image + gerçek PostgreSQL; bot koruması yalnız yeniden üretim konteynerinde test modu/disabled, PII yazımı yalnız sentetik opt-in.
- İstek: sentetik alanlarla `POST /api/v1/booking-applications`, geçerli UUID idempotency anahtarı ve form süresi sinyali.
- Sonuç: HTTP `500`, güvenli istemci mesajı `Bir hata oluştu.`
- Correlation ID: `4e14fc0f-8cd6-4ba7-9c20-77083197f849`.
- Aynı ID backend logunda `PrismaClientUnknownRequestError` ve `createBookingApplication` transaction zinciriyle eşleşti.
- Sınıf: **ürün hatası / P0-01 yeniden üretildi**. Düzeltme Faz 01’e bırakıldı.
- Production Traefik logunda aynı gün, son deployment öncesine ait public POST 500/400 örnekleri vardı; bunlar mevcut release yeniden üretimi yerine tarihsel destekleyici kanıt sayıldı.

Backend logu correlation ID ile aranabiliyor. Traefik access logu method/path/status ve kendi request sayacını içeriyor fakat uygulama correlation ID’sini taşımıyor; bu gözlemlenebilirlik boşluğu açık risk olarak kaydedildi.

### 7.2 Canlı edge/SEO mevcut davranışı

| İstek | Mevcut sonuç | Sınıf |
|---|---|---|
| `https://dugunajansim.com/` | 200 HTML | Geçti |
| `/api/v1/health` | 200 JSON | Geçti |
| `/robots.txt` | 404 HTML | Ürün hatası / P0-11 |
| `/sitemap.xml` | 404 | Ürün hatası / P0-11 |
| `/index.html` | 200, canonical redirect yok | Ürün hatası / P0-11 |
| `https://www.dugunajansim.com/` | TLS doğrulama hatası, HTTP status üretilemedi | Ürün/altyapı hatası / P0-11 |
| HTTP ana host + probe path/query | 301 HTTPS, path/query korundu | Geçti |
| Bilinmeyen HTTPS path | 404 | Geçti |

Chrome salt-okunur kontrolde canonical `/`, doğru title, tek H1, 8 hizmet, 7 salon, yatay taşma olmaması ve console warning/error olmaması doğrulandı. Oturum kullanıcıya aitti; kimlik veya müşteri verisi kanıta alınmadı.

## 8. Test tabanı

| Komut / kontrol | Sonuç | Sınıf |
|---|---|---|
| `npm run validate` | Bütün format/lint/HTML/domain/security/deploy doğrulamaları geçti. İlk sandbox denemesinde Docker pipe erişimi engellendi; yetkili tekrar geçti. | Geçti; ilk deneme ortam hatası |
| `npm test` (`backend`) | 74/74 geçti; build ve test typecheck dahil. | Geçti |
| `npm run test:integration` (`backend`) | 28 migration uygulandı; 11/11 gerçek PostgreSQL entegrasyon testi geçti. | Geçti |
| `npm run test:runtime-role` (`backend`) | CI ile aynı sentetik runtime rol kurulumu sonrası 4/4 geçti. İlk çağrı gerekli runtime env kurulmadan yapıldığı için başlamadı. | Geçti; ilk deneme ortam hatası |
| Abuse testi doğrudan | Doğru `tests/test.env` ile 6/6 geçti. İlk yanlış çağrı DB environment olmadan 5/6 verdi. | Geçti; ilk deneme ortam hatası |
| `npm run test:targeted` | Chromium + mobile Chromium toplam 93/93 geçti. | Geçti; route mock kapsam sınırı var |
| `npm run test:quick` (ilk taban) | Değişen dosya olmadığı için agent-check bilinçli olarak test çalıştırmadı. Doküman değişikliklerinden sonra tekrar çalıştırılacak. | Atlandı; tasarlanmış davranış |
| `docker compose -f compose.production.yaml config -q` | Gerekli sentetik env tamamlandıktan sonra geçti. İlk çağrı eksik backup active-key ID nedeniyle durdu. | Geçti; ilk deneme environment hatası |
| Production image/health | Image revision, non-root kullanıcı, frontend `nginx -t`, backend/DB/frontend health doğrulandı. | Geçti |

`package.json` ve `.github/workflows/quality.yml` yeniden okundu: frontend validate/performance/E2E ve backend unit/integration/runtime-role CI’da; `backend/tests/abuse-security.test.ts` CI komutlarında yok. Playwright dosyalarında `page.route` mockları kullanılıyor; bu nedenle 93/93 sonucu gerçek Nginx/API/PostgreSQL altın yol kanıtı değildir.

## 9. P0/P1 kod–route–model–test izlenebilirlik tabanı

| Bulgu | UI / kod girişi | Route / servis | Model / config | Mevcut test ve Faz 00 hükmü |
|---|---|---|---|---|
| P0-01 | `js/package-builder/application.js`, `paketini-olustur.html` | `backend/src/routes/public.routes.ts`; `backend/src/services/booking.service.ts` | `BookingApplication`, paket/salon ilişkileri | DB integration servis seviyesinde; browser route mocklu. Gerçek API/DB’de 500 yeniden üretildi. |
| P0-02 | Public ödeme/WhatsApp handoff akışı | `expireStalePaymentFlows` (`booking.service.ts`) | `paymentFlowExpiresAt`, `whatsappHandoffAt`, `BookingApplication` indexi | DB integration handed-off expired kaydın silinmesini bekliyor; veri kaybı riski kodda doğrulandı. |
| P0-03 | `js/customer-panel/app.js`, login/password UI | Auth/customer/admin aktivasyon route ve servisleri | `User`, `Session`, `Wedding`, `Delivery` | Büyük DB integration zinciri kısmi; mock kullanmayan browser altın yolu yok. |
| P0-04 | `js/admin/app.js` mesaj görev eylemi | Admin message `mark-sent` route’u | `MessageTask`, `Wedding` | Geçerli token/link veya `dueAt` önkoşul testi yok; risk doğrulandı. |
| P0-05 | `backend/prisma/seed.ts`, deploy/seed yordamları | Seed ve production operasyon scriptleri | Venue/Package/Service ve işlem verileri | Seed unit kontrolü var; production salt-okunur envanter/cutover/cleanup kanıtı yok. |
| P0-06 | Public ödeme talimatı ve builder | `public.routes.ts` payment instructions; `env.config.ts` | `PAYMENT_MODE` ve banka/WhatsApp config’i | Config testleri var; production’da `live` zorunlu değil, risk doğrulandı. |
| P0-07 | Deploy README/runbook dosyaları | Deploy/rollback/host hazırlık scriptleri | Compose/environment sözleşmesi | Operations testleri parçalı; tek temiz-host prova kanıtı ve çelişkisiz runbook yok. |
| P0-08 | Deploy/watchdog workflow ve scriptleri | Forward-only migration/deploy/watchdog akışı | Failure marker/Compose servis durumu | Watchdog testleri mevcut; bilinçli migration failure + eski servisi açmama kanıtı yok. |
| P0-09 | Backup/restore scriptleri ve workflow | Aynı host backup/restore operasyonu | Şifreli backup keyring config’i | Crypto/pruning testleri geçiyor; offsite kopya ve bağımsız restore yok. |
| P0-10 | Health route ve watchdog | `/api/v1/health`, host içi workflow | Health/config | Health sözleşme testleri var; host dışı monitor/notification erişimi yok. |
| P0-11 | Nginx config ve public statik dosyalar | Edge route/canonical davranışı | Uygulanamaz | Statik/mock smoke var; canlı robots/sitemap/index/www matrisi başarısız. |
| P0-12 | Playwright config/spec’leri | Gerçek full-stack CI servisi yok | Uygulanamaz | `abuse-security.test.ts` 6/6 yerelde geçti fakat CI dışında; browser testleri route mocklu. |
| P1-01 | `js/admin/app.js` archive/restore UI | Admin booking archive/restore route’ları | `BookingApplication`, archive/deleted alanları | DB integration kısmi; custom venue restore için `venueId` eksikliği güvenilir kapanmıyor. |
| P1-02 | Admin wedding action UI | Gerçek cancel route’u bulunmadı; archive davranışı var | `Wedding` archive/deleted alanları | Gerçek iptal state machine/testi yok. |
| P1-03 | Admin karar UI | Başvuru karar route’u | `BookingApplication`, `MessageTask` | Onay/red sonrası tanımlı müşteri bildirim zinciri testi yok. |
| P1-04 | Admin/customer delivery UI | Delivery update route/servisi | `Delivery`, `DeliveryStatusHistory` | Bazı guardlar var; izinli geçiş haritası eksik. |
| P1-05 | Admin message task UI | Message `mark-sent` route’u | `MessageTask.dueAt/status` | Gelecek görev için zorunlu override/ret testi yok. |
| P1-06 | `js/admin/app.js` `.js-today-weddings` hedefi | Admin wedding/list route’u | `Wedding` | Admin HTML’de render hedefi yok; test bunu yakalamıyor. |
| P1-07 | Admin sayfa başlıkları | Uygulanamaz | Uygulanamaz | H1 statik; route/section değişim testi yok. |
| P1-08 | Builder ve panel form hata bölgeleri | Ortak API hata sözleşmesi | İlgili mutasyon modeli | P0-01 hatası gizli ödeme adımı alanına yazılıyor; negatif UX testi eksik. |
| P1-09 | Birden çok admin/operations/customer formu | Mutasyon route’ları; public idempotency var | İlgili modeller/idempotency alanları | Bütün mutasyonlarda in-flight/çift tıklama matrisi yok. |
| P1-10 | `js/operations/app.js` personel formu | Salon/personel route ve schema | `Staff.specialties`, `StaffSpecialty` | Backend en az bir uzmanlık ister; UI alanı zorunlu değil. |
| P1-11 | Builder availability fetch’i | Public venue availability route’u | `Venue`, `BookingApplication`, `Wedding` | Abort/latest-response koruması ve yarış testi yok. |
| P1-12 | Builder Turnstile loader/UI | Bot challenge verification | Turnstile env config’i | Backend token/hostname/action unit testleri var; script yükleme hatası retry testi yok. |
| P1-13 | Admin/operations/customer liste fetch’leri | Liste route’larında sabit take limitleri | Liste modelleri | 200/300 sınırları var; pagination/toplam kayıt kabul testi yok. |
| P1-14 | Tarih/saat form bileşenleri | API şemaları ve booking schedule policy | Wedding/Booking zaman alanları | Slot policy testleri var; backend `HH:mm` dakikayı UI slot adımı kadar sınırlamıyor. |
| P1-15 | Admin takvim navigasyonu | Admin calendar/list route’u | `Wedding` | Veri yüklenmeden navigasyon/loading yarış testi yok. |
| P1-16 | Admin/operations statik “Sistem bağlı” alanları | Health route mevcut | Health/config | Gerçek health/son veri zamanını UI’a bağlayan test yok. |

## 10. Faz 00 çıkış değerlendirmesi

- Başlangıç SHA, ortam/image eşlemesi, sorumlular, erişimler, karar günlüğü, P0/P1 giriş noktaları, public 500 yeniden üretimi, edge davranışı ve test tabanı kaydedildi.
- Kaynak rapordaki P0/P1 bulguları çözülmüş varsayılmadı; sonraki fazlara açık risk olarak devredildi.
- Production üzerinde yazma, deploy, restart, DNS/TLS değişikliği, veri temizliği veya kalıcı silme yapılmadı.
- Faz 00’ın yönetişim/baseline işi tamamdır; Faz 01 ancak Mustafa’nın açık onayıyla başlayabilir.
