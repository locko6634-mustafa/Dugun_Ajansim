# Düğün Ajansım Mevcut Backend Mimari ve İşlev Raporu

**Rapor tarihi:** 30 Temmuz 2026

**İncelenen alan:** `backend/`, backend'i kullanan frontend modülleri, veritabanı şeması, migration'lar, testler ve production dağıtım dosyaları

**Raporun amacı:** Bir sonraki ajanın mevcut sistemi yeniden keşfetmeden backend sorunlarını, eksiklerini ve iyileştirme alanlarını analiz edebilmesi için bugünkü backend davranışını nesnel biçimde belgelemek

> Bu belge bir hata analizi değildir. Kodda bugün bulunan bileşenleri, bunların ne işe yaradığını, iş kurallarını ve mevcut kapsamın sınırlarını açıklar. “Yok” olarak belirtilen maddeler hata sınıflandırması değil, uygulanmış kapsam ile uygulanmamış kapsam arasındaki sınırdır.

---

## 1. Yönetici özeti

Proje, düğün fotoğraf/video hizmeti için hazırlanmış bir müşteri başvurusu ve dijital teslimat backend'idir. Backend'in ana işi şunlardır:

1. Aktif salon, paket ve ek hizmet kataloğunu frontend'e sunmak.
2. Herkese açık paket oluşturma formundan veya admin panelinden düğün başvurusu almak.
3. Fiyatı istemciden kabul etmek yerine veritabanındaki güncel katalog üzerinden hesaplamak.
4. Adminin başvuruyu onaylaması veya reddetmesini sağlamak.
5. Onay sırasında müşteri hesabı, düğün kaydı, teslimat kaydı ve iletişim görevlerini tek transaction içinde oluşturmak.
6. Adminin düğün bilgilerini, katalog kayıtlarını ve teslimat sürecini yönetmesini sağlamak.
7. Müşterinin kendi düğün ve teslimat durumunu görüntülemesini, teslim tamamlandığında şifreli saklanan Google Drive bağlantısını almasını sağlamak.
8. Hesap aktivasyonu, hazırlık bildirimi, teslim bildirimi ve parola sıfırlama için yöneticinin WhatsApp üzerinden manuel gönderebileceği mesajlar üretmek.
9. Oturum, rol, CSRF, girdi doğrulama, rate limit, CORS, güvenlik başlıkları, audit kaydı ve correlation ID altyapısı sağlamak.

### 1.1 Teknoloji özeti

| Katman                   | Mevcut teknoloji                             |
| ------------------------ | -------------------------------------------- |
| Çalışma zamanı           | Node.js 22+                                  |
| Dil                      | TypeScript 5, strict mod                     |
| Modül biçimi             | ESM / NodeNext                               |
| HTTP sunucusu            | Express 4                                    |
| Veritabanı               | PostgreSQL 17                                |
| ORM ve migration         | Prisma 6                                     |
| Girdi doğrulama          | Zod 3                                        |
| Parola hashleme          | Argon2id                                     |
| Hassas alan şifreleme    | AES-256-GCM                                  |
| Güvenlik middleware'leri | Helmet, CORS, HPP, express-rate-limit        |
| Test altyapısı           | Node test runner, Supertest, TSX             |
| Production paketleme     | Çok aşamalı Docker build                     |
| Reverse proxy / TLS      | Harici Traefik ağı ve yönlendirme etiketleri |
| Frontend sunumu          | Nginx statik container                       |

### 1.2 Kapsamın kısa sayısal görünümü

| Unsur                        | Adet / durum                           |
| ---------------------------- | -------------------------------------- |
| HTTP endpoint                | 33                                     |
| Prisma modeli                | 13                                     |
| Prisma enum'u                | 10                                     |
| Migration                    | 2                                      |
| Seed salonu                  | 7                                      |
| Seed paketi                  | 1                                      |
| Seed ek hizmeti              | 8                                      |
| Backend birim/davranış testi | 26                                     |
| Veritabanı entegrasyon testi | 2                                      |
| Kullanıcı rolleri            | 3 tanımlı, 2 rolün aktif API akışı var |

---

## 2. Backend'in sistem içindeki yeri

Production mimarisi aynı alan adı altında iki ayrı container kullanır:

```text
İnternet
   |
   v
Traefik / HTTPS
   |-- /api/v1/* --------------> Node.js / Express backend :5000
   |
   `-- diğer tüm yollar --------> Nginx statik frontend :80

Express backend
   |
   `---------------------------> PostgreSQL :5432
                                  yalnız internal Docker ağı
```

- Frontend ve backend production'da aynı origin üzerinden sunulur.
- Traefik, `/api/v1` ön ekini backend'e; diğer yolları frontend'e yönlendirir.
- PostgreSQL host'a port açmadan yalnız `internal` Docker ağında tutulur.
- Migration servisi başarıyla bitmeden backend başlamaz.
- Backend healthcheck başarılı olmadan frontend container'ı başlamaz.

---

## 3. Kaynak kod organizasyonu

```text
backend/
├── src/
│   ├── app.ts                         Express uygulaması ve rota kaydı
│   ├── server.ts                      En erken uncaughtException koruması
│   ├── bootstrap.ts                   HTTP dinleme ve güvenli kapanış
│   ├── config/
│   │   ├── env.config.ts              Ortam değişkeni doğrulama
│   │   └── prisma.ts                  Prisma istemcisi ve DB healthcheck
│   ├── controllers/
│   │   └── health.controller.ts       Sistem sağlık yanıtı
│   ├── middlewares/
│   │   ├── auth.middleware.ts         Oturum, rol, parola ve CSRF koruması
│   │   ├── error.middleware.ts        Merkezi hata yanıtı ve loglama
│   │   ├── requestContext.middleware.ts Correlation ID
│   │   ├── security.middleware.ts     Helmet, rate limit ve CORS
│   │   └── validate.middleware.ts     Zod request doğrulama
│   ├── routes/
│   │   ├── health.routes.ts           Health endpoint'i
│   │   ├── public.routes.ts           Katalog, salon ve başvuru
│   │   ├── auth.routes.ts             Login, session, parola, logout
│   │   ├── admin.routes.ts            Yönetim API'si
│   │   └── customer.routes.ts         Müşteri paneli API'si
│   ├── schemas/
│   │   └── api.schemas.ts             HTTP girdi şemaları
│   ├── services/
│   │   └── booking.service.ts         Başvuru ve onay iş kuralları
│   ├── scripts/
│   │   ├── bootstrapAdmin.ts          İlk admin oluşturma
│   │   └── migrateTestDatabase.ts     Test DB migration yardımcısı
│   ├── types/
│   │   └── express.d.ts               req.auth / correlationId tipleri
│   └── utils/
│       ├── appError.ts                Operasyonel hata sınıfı
│       ├── asyncHandler.ts            Async Express hata aktarımı
│       ├── crypto.ts                  Hash, token ve şifreleme
│       ├── domain.ts                  Tarih, telefon, kullanıcı adı kuralları
│       └── processLifecycle.ts         Graceful shutdown
├── prisma/
│   ├── schema.prisma                  Veri modeli
│   ├── migrations/                    SQL migration'ları
│   └── seed.ts                        Başlangıç katalog verileri
├── tests/                              Backend testleri
├── dist/                               TypeScript derlenmiş çıktısı
├── docs/                               Kurulum ve rapor belgeleri
├── Dockerfile                          Backend build/runtime image'ı
├── compose.test.yaml                   Geçici PostgreSQL test servisi
├── package.json                        Komutlar ve bağımlılıklar
└── .env.example                        Yerel ortam örneği
```

### 3.1 Uygulama katmanlarının mevcut ayrımı

- Route dosyaları HTTP yönlendirme, yetki zinciri ve çoğu CRUD işlemini içerir.
- Başvuru oluşturma, başvuru onayı ve reddi `booking.service.ts` içinde ayrı servis fonksiyonlarıdır.
- Health endpoint'i ayrı controller kullanır.
- Girdi şemaları merkezi `api.schemas.ts` dosyasındadır.
- Kimlik doğrulama, CSRF, güvenlik, hata ve request context ayrı middleware'lerdir.
- Prisma tek veri erişim katmanıdır; ayrıca repository sınıfları bulunmaz.
- `admin.routes.ts`, yönetim işlemlerinin büyük bölümünü tek dosyada toplar.

---

## 4. İstek yaşam döngüsü

Bir API isteği genel olarak şu sıradan geçer:

1. `attachRequestContext`
   - Geçerli bir `X-Correlation-ID` varsa korur.
   - Yoksa UUID üretir.
   - Yanıta `X-Correlation-ID` ekler.
2. `trust proxy`
   - `TRUST_PROXY` ortam değişkenindeki sayısal hop değeri uygulanır.
3. Güvenlik katmanı
   - Helmet başlıkları.
   - `/api` için global rate limit.
   - Origin allowlist kullanan CORS.
4. Body ayrıştırma
   - JSON ve URL-encoded body için 10 KB sınırı.
5. HPP
   - HTTP parameter pollution koruması.
6. Rota zinciri
   - Gerekiyorsa oturum, zorunlu parola değişimi, rol ve CSRF kontrolü.
   - Zod ile body/query/params doğrulaması.
   - Route handler veya servis işlemi.
7. Tanımsız rota yakalayıcı
   - `404 AppError`.
8. Global hata middleware'i
   - Development ve production'a göre güvenli hata yanıtı.

---

## 5. API sözleşmesi

### 5.1 Ortak URL ve yanıt biçimi

- Ana API prefix'i: `/api/v1`
- Başarılı standart yanıt:

```json
{
  "success": true,
  "data": {},
  "correlationId": "istek-izleme-kimligi"
}
```

- Health endpoint'i `data` yerine sağlık alanlarını doğrudan üst seviyede döndürür.
- Hata yanıtları `success: false`, `status`, `statusCode`, `message` ve `correlationId` içerir.
- Doğrulama hatalarında güvenli `errors` dizisi bulunabilir.
- Beklenmeyen production hatalarında ayrıntı yerine genel mesaj ve `errorId` döner.
- Development yanıtı mesaj, stack ve daha fazla tanı bilgisi içerir.

### 5.2 Yetki işaretleri

| İşaret  | Anlam                                                         |
| ------- | ------------------------------------------------------------- |
| Açık    | Oturum gerektirmez                                            |
| Oturum  | Geçerli session cookie gerekir                                |
| Admin   | `ADMIN` rolü ve değiştirilmiş parola gerekir                  |
| Müşteri | `MUSTERI` rolü ve değiştirilmiş parola gerekir                |
| CSRF    | State-changing işlemde session'a bağlı `X-CSRF-Token` gerekir |

### 5.3 Health ve açık endpoint'ler

| Metot | Yol                            | Yetki | Amaç                                                           |
| ----- | ------------------------------ | ----- | -------------------------------------------------------------- |
| GET   | `/api/v1/health`               | Açık  | PostgreSQL'e `SELECT 1` çalıştırarak servis sağlığını raporlar |
| GET   | `/api/v1/catalog`              | Açık  | Aktif paketleri ve aktif ek hizmetleri listeler                |
| GET   | `/api/v1/venues`               | Açık  | Aktif salonların `id`, `slug`, `name` alanlarını listeler      |
| POST  | `/api/v1/booking-applications` | Açık  | Herkese açık düğün başvurusu oluşturur                         |

#### `GET /health`

Davranış:

- PostgreSQL sorgusu için `HEALTHCHECK_TIMEOUT_MS` kullanır.
- Aynı anda gelen health istekleri devam eden tek sorgunun sonucunu paylaşır.
- DB bağlıysa HTTP 200 ve `healthy`; bağlı değilse HTTP 503 ve `unhealthy`.
- Production'da ortam adı ve uptime gösterilmez.
- Development/test ortamında `environment` ve `uptime` eklenir.
- Yanıt `Cache-Control: no-store` kullanır.

#### `GET /catalog`

Yalnız `isActive: true` paket ve hizmetleri döndürür.

- Paket sırası: ada göre artan.
- Hizmet sırası: kategori, ardından ada göre artan.
- Paket ve hizmet kayıtları Prisma modelindeki alanlarla döner.

#### `GET /venues`

Yalnız aktif salonları ada göre sıralar ve sınırlı alan seti döndürür.

#### `POST /booking-applications`

Ek davranışlar:

- Endpoint'e özel limit: IP başına 15 dakikada 10 deneme.
- Opsiyonel `Idempotency-Key` header'ı kabul eder.
- Anahtar 16-128 karakter ve `[A-Za-z0-9._-]` biçiminde olmalıdır.
- Geçerli anahtar daha önce kullanılmışsa mevcut başvurunun özetini döndürür.
- Başvuru kaynağı `PUBLIC_FORM` olarak kaydedilir.
- Başarı yanıtı HTTP 201'dir.

Başarılı response verisi:

```text
id
referenceCode
status
totalPriceCents
payableNowCents
```

### 5.4 Kimlik doğrulama endpoint'leri

| Metot | Yol                            | Yetki  | CSRF  | Amaç                                                        |
| ----- | ------------------------------ | ------ | ----- | ----------------------------------------------------------- |
| POST  | `/api/v1/auth/login`           | Açık   | Hayır | Kullanıcı adı/parola ile session açar                       |
| GET   | `/api/v1/auth/session`         | Oturum | Hayır | Aktif oturum ve rol bilgisini döndürür                      |
| POST  | `/api/v1/auth/password/change` | Oturum | Evet  | Parolayı değiştirir ve geçici parola zorunluluğunu kaldırır |
| POST  | `/api/v1/auth/logout`          | Oturum | Evet  | Mevcut session'ı revoke eder ve cookie'leri temizler        |

#### Login

İstek alanları:

| Alan       | Kural                                 |
| ---------- | ------------------------------------- |
| `username` | 3-64 karakter; backend normalize eder |
| `password` | 6-256 karakter                        |
| `remember` | Boolean; varsayılan `false`           |

Login akışı:

1. Kullanıcı adı Türkçe karakter ve boşluk kurallarına göre normalize edilir.
2. Kullanıcı Prisma ile bulunur.
3. Parola Argon2id ile doğrulanır.
4. Kullanıcı `ACTIVE` değilse giriş verilmez.
5. `activeAt` gelecekteyse hesap henüz aktif kabul edilmez.
6. 32 baytlık opaque session token ve ayrı CSRF token üretilir.
7. Token'ların kendisi değil SHA-256 hash'leri veritabanına yazılır.
8. `lastLoginAt` güncellenir.
9. `auth.login` audit kaydı oluşturulur.
10. Session ve CSRF cookie'leri istemciye verilir.

Başarılı veri:

```json
{
  "username": "normalize-kullanici-adi",
  "role": "ADMIN | SALON_YETKILISI | MUSTERI",
  "mustChangePassword": true
}
```

#### Session

`req.auth` içeriğini döndürür:

```text
userId
username
role
sessionId
mustChangePassword
```

#### Parola değişimi

- Mevcut parola tekrar doğrulanır.
- Yeni parola 10-128 karakterdir; en az bir harf ve bir rakam ister.
- Yeni parola mevcut parolayla aynı olamaz.
- Yeni parola Argon2id ile hashlenir.
- `mustChangePassword` false yapılır.
- `passwordChangedAt` yazılır.
- Mevcut session dışındaki diğer session'lar revoke edilir.
- `auth.password_changed` audit kaydı yazılır.

#### Logout

- Yalnız mevcut session'a `revokedAt` yazar.
- Session ve CSRF cookie'lerini temizler.

### 5.5 Müşteri endpoint'leri

Bu router'ın tamamında şu zincir uygulanır:

```text
authenticate
-> requireChangedPassword
-> requireRole("MUSTERI")
```

| Metot | Yol                          | Yetki   | Amaç                                                |
| ----- | ---------------------------- | ------- | --------------------------------------------------- |
| GET   | `/api/v1/customer/dashboard` | Müşteri | Düğün, paket ve teslimat ilerlemesini gösterir      |
| GET   | `/api/v1/customer/delivery`  | Müşteri | Yayınlanmış Google Drive teslimat URL'sini döndürür |

#### Müşteri dashboard verisi

```text
couple.bride
couple.groom
venue
startsAt
endsAt
packageSummary
delivery.status
delivery.dueDate
delivery.releasedAt
delivery.history[].status
delivery.history[].createdAt
```

- Kullanıcı yalnız `customerUserId` ile kendisine bağlı düğünü görebilir.
- Teslimat history kayıtları oluşturulma zamanına göre artan sıralanır.
- Yanıt `Cache-Control: no-store` kullanır.

#### Müşteri teslimat verisi

Drive URL'sinin dönebilmesi için aynı anda şu koşullar aranır:

1. Teslimat kaydı var.
2. Durum `TESLIM_EDILDI`.
3. `releasedAt` dolu.
4. Şifreli URL'nin ciphertext, IV ve auth tag alanları dolu.

Koşullar sağlanınca URL AES-256-GCM ile çözülür ve şu alanlar döner:

```text
driveUrl
releasedAt
```

### 5.6 Admin endpoint'leri

Admin router'ının tamamında şu zincir uygulanır:

```text
authenticate
-> requireChangedPassword
-> requireRole("ADMIN")
```

GET işlemleri dışındaki state-changing admin işlemleri ayrıca CSRF doğrulaması kullanır.

#### Genel görünüm ve başvurular

| Metot | Yol                                              | CSRF  | Amaç                                      |
| ----- | ------------------------------------------------ | ----- | ----------------------------------------- |
| GET   | `/api/v1/admin/overview`                         | Hayır | Dört adet dashboard sayacı                |
| GET   | `/api/v1/admin/booking-applications`             | Hayır | Başvuruları filtreleyerek listeler        |
| GET   | `/api/v1/admin/booking-applications/:id`         | Hayır | Başvuru detayını getirir                  |
| POST  | `/api/v1/admin/booking-applications`             | Evet  | Admin kaynağıyla manuel başvuru oluşturur |
| POST  | `/api/v1/admin/booking-applications/:id/approve` | Evet  | Bekleyen başvuruyu onaylar                |
| POST  | `/api/v1/admin/booking-applications/:id/reject`  | Evet  | Bekleyen başvuruyu gerekçeyle reddeder    |

Overview sayaçları:

```text
pendingBookings = ONAY_BEKLIYOR başvurular
activeWeddings = cancelledAt null düğünler
pendingMessages = PENDING mesaj görevleri
readyDeliveries = TESLIME_HAZIR teslimatlar
```

Başvuru listesi:

- Opsiyonel `status` filtresi.
- Opsiyonel `referenceCode` içerme araması.
- En yeni başvuru önce.
- En fazla 200 kayıt.
- Salon adı, seçili hizmet snapshot'ları ve inceleyen admin kullanıcı adı dahil edilir.

Başvuru detayı:

- Salonun tam kaydı.
- Hizmet snapshot'ları.
- Oluşmuşsa wedding ve delivery.

Admin başvurusu:

- Public başvuruya benzer alanlar kullanır.
- Kaynak `ADMIN` olur.
- `privacyConsent` admin girişinde zorunlu `true` değildir; varsayılan `false`.
- Admin aktör kimliği audit kaydına yazılır.

Başvuru reddi:

- Yalnız `ONAY_BEKLIYOR` kayıt işlenir.
- 3-500 karakter gerekçe ister.
- Durum `REDDEDILDI` olur.
- `reviewedAt`, `reviewedById` ve `rejectionReason` yazılır.

#### Düğün yönetimi

| Metot | Yol                          | CSRF  | Amaç                                                     |
| ----- | ---------------------------- | ----- | -------------------------------------------------------- |
| GET   | `/api/v1/admin/weddings`     | Hayır | Düğünleri, müşteri hesabını ve teslimat özetini listeler |
| PATCH | `/api/v1/admin/weddings/:id` | Evet  | Çift, iletişim, tarih/saat, salon ve notu günceller      |

Düğün listesi:

- Başlangıç tarihine göre en yeni önce.
- En fazla 200 kayıt.
- Salon adı.
- Müşteri `id`, `username`, `activeAt`, `mustChangePassword`.
- Delivery özeti ve `hasDriveUrl`.
- Şifreli URL'nin kendisi veya şifreleme bileşenleri istemciye verilmez.

Düğün güncelleme davranışı:

- İptal edilmiş düğün güncellenmez.
- Salon kimliği doğrulanır.
- Telefonlar `+90` biçimine normalize edilir.
- Tarih ve saat Europe/Istanbul (`+03:00`) kabulüyle gerçek zaman aralığına çevrilir.
- Bir düğün en fazla 36 saat sürebilir.
- Birincil iletişim kişisine göre mesaj alıcısı güncellenir.
- Tarih değiştiyse bekleyen hazırlık mesajının zamanı yeniden hesaplanır.
- Teslim edilmemiş delivery'nin tahmini tarihi düğün +21 gün olacak şekilde güncellenir.
- Müşteri henüz zorunlu parolasını değiştirmediyse ve çift adı veya düğün tarihi değiştiyse:
  - yeni kullanıcı adı üretilir,
  - düğün tarihinden yeni geçici parola üretilir,
  - hesap aktivasyon zamanı yeniden hesaplanır,
  - açık session'lar revoke edilir,
  - aktivasyon mesaj görevi yeni şifreli parola ile güncellenir.

#### Teslimat yönetimi

| Metot | Yol                                    | CSRF | Amaç                                             |
| ----- | -------------------------------------- | ---- | ------------------------------------------------ |
| PATCH | `/api/v1/admin/deliveries/:id`         | Evet | Durum, tahmini tarih ve Drive URL'sini günceller |
| POST  | `/api/v1/admin/deliveries/:id/deliver` | Evet | Teslimatı müşteriye yayınlar                     |

Delivery PATCH alanları:

| Alan       | Mevcut kabul                                         |
| ---------- | ---------------------------------------------------- |
| `status`   | `HAZIRLANIYOR`, `MONTAJ`, `KONTROL`, `TESLIME_HAZIR` |
| `dueDate`  | `YYYY-MM-DD`                                         |
| `driveUrl` | En fazla 2000 karakter URL                           |

Drive URL davranışı:

- URL ayrıca domain kuralından geçer.
- Yalnız HTTPS kabul edilir.
- Yalnız `drive.google.com` ve `docs.google.com` host'ları kabul edilir.
- URL plaintext olarak değil AES-256-GCM bileşenleriyle saklanır.

Durum değişirse `DeliveryStatusHistory` kaydı oluşturulur.

Teslim etme davranışı:

1. Mevcut durum `TESLIME_HAZIR` olmalıdır.
2. Şifreli Drive URL alanlarının tamamı mevcut olmalıdır.
3. Durum `TESLIM_EDILDI` yapılır.
4. `releasedAt` yazılır.
5. History kaydı eklenir.
6. `DELIVERY_READY` mesaj görevi oluşturulur veya yeniden beklemeye alınır.
7. `delivery.released` audit kaydı yazılır.

#### Paket kataloğu yönetimi

| Metot  | Yol                          | CSRF  | Amaç                                          |
| ------ | ---------------------------- | ----- | --------------------------------------------- |
| GET    | `/api/v1/admin/packages`     | Hayır | Aktif/pasif tüm paketleri listeler            |
| POST   | `/api/v1/admin/packages`     | Evet  | Paket oluşturur                               |
| PATCH  | `/api/v1/admin/packages/:id` | Evet  | Paket alanlarını kısmi günceller              |
| DELETE | `/api/v1/admin/packages/:id` | Evet  | Fiziksel silme yerine `isActive: false` yapar |

Paket alanları:

```text
code
name
description?
imagePath?
priceCents
isActive
```

- `code` yalnız küçük harf, rakam ve tire kabul eder.
- Fiyat integer kuruş olarak saklanır.
- Fiyat aralığı 0 ile 100.000.000 kuruştur.

#### Ek hizmet kataloğu yönetimi

| Metot  | Yol                          | CSRF  | Amaç                                          |
| ------ | ---------------------------- | ----- | --------------------------------------------- |
| GET    | `/api/v1/admin/services`     | Hayır | Aktif/pasif tüm hizmetleri listeler           |
| POST   | `/api/v1/admin/services`     | Evet  | Hizmet oluşturur                              |
| PATCH  | `/api/v1/admin/services/:id` | Evet  | Hizmet alanlarını kısmi günceller             |
| DELETE | `/api/v1/admin/services/:id` | Evet  | Fiziksel silme yerine `isActive: false` yapar |

Hizmet alanları:

```text
code
category
name
eyebrow?
description?
imagePath?
priceCents
isActive
```

#### Mesaj görevleri

| Metot | Yol                                         | CSRF  | Amaç                                  |
| ----- | ------------------------------------------- | ----- | ------------------------------------- |
| GET   | `/api/v1/admin/message-tasks`               | Hayır | Mesaj görevlerini listeler            |
| GET   | `/api/v1/admin/message-tasks/:id/render`    | Hayır | Mesaj metni ve WhatsApp URL'si üretir |
| POST  | `/api/v1/admin/message-tasks/:id/mark-sent` | Evet  | Görevi gönderildi olarak işaretler    |

Listeleme:

- Önce status, sonra `dueAt` sırasıyla gelir.
- En fazla 300 kayıt.
- Çift adları ve varsa gönderen admin kullanıcı adı eklenir.
- Şifrelenmiş geçici parola bileşenleri listeden çıkarılır.

Render:

- `ACCOUNT_ACTIVATION`: kullanıcı adı ve çözülen geçici parola.
- `PASSWORD_RESET`: çözülen yeni geçici parola.
- `PREPARATION_UPDATE`: tahmini teslim tarihi.
- `DELIVERY_READY`: müşteri panelinden dosyaya erişim bilgisi.
- Alıcı telefonundan `https://wa.me/...` bağlantısı oluşturur.
- Yanıt `Cache-Control: no-store` kullanır.

Mark sent:

- Status `SENT` olur.
- `sentAt` ve `sentById` yazılır.
- Şifreli parola ciphertext/IV/auth tag alanları null yapılır.

#### Müşteri parola sıfırlama

| Metot | Yol                                          | CSRF | Amaç                                                 |
| ----- | -------------------------------------------- | ---- | ---------------------------------------------------- |
| POST  | `/api/v1/admin/customers/:id/reset-password` | Evet | Müşteri için geçici parola ve WhatsApp görevi üretir |

Akış:

1. Kullanıcının `MUSTERI` rolünde ve bir wedding kaydına bağlı olduğu doğrulanır.
2. Rastgele geçici parola oluşturulur.
3. Parola Argon2id ile hashlenir.
4. Mesajda kullanılacak plaintext parola AES-256-GCM ile şifrelenir.
5. `mustChangePassword: true`, `passwordChangedAt: null` yapılır.
6. Kullanıcının açık session'ları revoke edilir.
7. `PASSWORD_RESET` görevi oluşturulur veya güncellenir.
8. Audit kaydı oluşturulur.
9. Frontend'e görev kimliği ve WhatsApp URL'si döner.

#### Audit kayıtları

| Metot | Yol                        | Amaç                                            |
| ----- | -------------------------- | ----------------------------------------------- |
| GET   | `/api/v1/admin/audit-logs` | Son 300 audit kaydını aktör bilgisiyle listeler |

Sıralama en yeni kayıt önce olacak şekildedir.

---

## 6. Başvuru veri sözleşmesi ve iş kuralları

### 6.1 Başvuru body alanları

| Alan               | Tip / kural                                               |
| ------------------ | --------------------------------------------------------- |
| `brideFirstName`   | 2-80 karakter                                             |
| `brideLastName`    | 2-80 karakter                                             |
| `bridePhone`       | 10-24 karakter; sonra Türkiye numarasına normalize edilir |
| `groomFirstName`   | 2-80 karakter                                             |
| `groomLastName`    | 2-80 karakter                                             |
| `groomPhone`       | 10-24 karakter; sonra Türkiye numarasına normalize edilir |
| `primaryContact`   | `GELIN` veya `DAMAT`                                      |
| `primaryEmail`     | Geçerli e-posta; lowercase; en fazla 254                  |
| `weddingDate`      | `YYYY-MM-DD`                                              |
| `startTime`        | `HH:mm`                                                   |
| `endTime`          | `HH:mm`                                                   |
| `endsNextDay`      | Boolean                                                   |
| `venueId`          | UUID                                                      |
| `packageCode`      | 1-80 karakter                                             |
| `serviceCodes`     | En fazla 20 kod; varsayılan boş dizi                      |
| `paymentMethod`    | `CASH` veya `DEPOSIT`                                     |
| `note`             | Opsiyonel; en fazla 2000                                  |
| `privacyConsent`   | Public formda literal `true`                              |
| `marketingConsent` | Boolean; varsayılan `false`                               |

### 6.2 Telefon kuralı

- Tüm rakam dışı karakterler atılır.
- `90` ülke kodu veya baştaki `0` normalize edilir.
- Kalan ulusal numara `[2-5]` ile başlamalı ve 10 rakam olmalıdır.
- Veritabanına `+90xxxxxxxxxx` biçiminde yazılır.

### 6.3 Tarih ve saat kuralı

- Düğün zamanı sabit `+03:00` ile Europe/Istanbul kabul edilir.
- `endsNextDay: true` ise bitiş tarihi bir sonraki takvim günüdür.
- Bitiş başlangıçtan sonra olmalıdır.
- Toplam süre en fazla 36 saattir.
- Public form geçmiş tarihli başvuru kabul etmez.
- Admin kaynaklı başvuruda public formun geçmiş tarih kuralı uygulanmaz.

### 6.4 Katalog doğrulaması

Başvuru oluşturulurken:

- Salon kimliği mevcut ve aktif olmalıdır.
- Paket kodu mevcut ve aktif olmalıdır.
- Tüm hizmet kodları mevcut ve aktif olmalıdır.
- Tekrarlanan hizmet kodları tekilleştirilir.
- Paket ve hizmet fiyatları frontend payload'ından alınmaz.

### 6.5 Fiyat hesabı

Tüm fiyatlar kuruş cinsinden integer tutulur.

```text
ara toplam = paket fiyatı + seçili hizmet fiyatları
```

| Ödeme yöntemi | Toplam                                 | Şimdi ödenecek                         |
| ------------- | -------------------------------------- | -------------------------------------- |
| `CASH`        | Ara toplamın %90'ı, yani %10 indirimli | İndirimli toplamın tamamı              |
| `DEPOSIT`     | Ara toplamın tamamı                    | Toplam ile 500.000 kuruştan küçük olan |

`500.000` kuruş = `5.000 TL`.

### 6.6 Snapshot davranışı

Başvuru anında aşağıdaki katalog bilgileri kopyalanır:

- Paket kodu.
- Paket adı.
- Paket fiyatı.
- Her ek hizmetin kodu.
- Her ek hizmetin adı.
- Her ek hizmetin fiyatı.

Bu sayede katalog daha sonra değişse bile başvurunun tarihsel fiyat ve isim özeti korunur.

### 6.7 Referans ve idempotency

- Referans biçimi: `DA-YYYYMMDD-6-rakam`.
- Unique çakışmasında en fazla dört üretim denemesi yapılır.
- Geçerli `Idempotency-Key` unique sütunda saklanır.
- Aynı anahtarla yinelenen public istek mevcut başvuru özetini döndürür.

---

## 7. Başvuru onayının oluşturduğu sistem kayıtları

Başvuru onayı backend'in en önemli transaction'ıdır.

### 7.1 Ön koşul

- Başvuru mevcut olmalıdır.
- Durum tam olarak `ONAY_BEKLIYOR` olmalıdır.
- Transaction içinde koşullu `updateMany` ile kaydın başka bir işlemce daha önce alınmadığı tekrar kontrol edilir.

### 7.2 Oluşturulan/güncellenen kayıtlar

Tek Prisma transaction içinde:

1. `BookingApplication`
   - `ONAYLANDI`
   - `reviewedAt`
   - `reviewedById`
2. `User`
   - Rol `MUSTERI`
   - Benzersiz kullanıcı adı
   - Argon2id geçici parola hash'i
   - `mustChangePassword: true`
   - `activeAt`: düğünden sonraki gün 09:00
3. `Wedding`
   - Çift ve iletişim bilgileri
   - Düğün zaman aralığı
   - Salon ilişkisi
   - Paket ve hizmetlerin JSON özeti
4. `Delivery`
   - İlk durum `HAZIRLANIYOR`
   - Tahmini tarih düğünden 21 takvim günü sonra
5. `DeliveryStatusHistory`
   - İlk kayıt `null -> HAZIRLANIYOR`
6. İki `MessageTask`
   - `ACCOUNT_ACTIVATION`: düğünden sonraki gün 09:00
   - `PREPARATION_UPDATE`: düğünden iki gün sonra 10:00
7. `AuditLog`
   - `booking.approved`

### 7.3 Müşteri kullanıcı adı ve geçici parola

Kullanıcı adı:

```text
normalize(gelin-soyadı)-normalize(damat-soyadı)-4-rakam
```

- Türkçe harfler ASCII karşılığına çevrilir.
- Küçük harfe dönüştürülür.
- Harf/rakam dışı gruplar tireye çevrilir.
- Prefix 48 karakterle sınırlandırılır.
- Benzersizlik için en fazla 20 rastgele deneme yapılır.

İlk geçici parola:

```text
DDMMYYYY
```

- Düğün tarihinden üretilir.
- User tablosuna yalnız Argon2id hash'i yazılır.
- Aktivasyon mesajı için gereken değer MessageTask içinde AES-256-GCM ile şifreli tutulur.

---

## 8. Veri modeli

### 8.1 Model ilişki özeti

```text
Venue
├── User (salon yöneticisi ilişkisi için)
├── BookingApplication
└── Wedding

BookingApplication
├── Package
├── BookingApplicationService[] -> Service
├── reviewedBy -> User
└── Wedding (onaylanırsa bire bir)

User
├── AuthSession[]
├── Wedding (müşteri için bire bir)
├── reviewedBookings[]
├── AuditLog[]
├── DeliveryStatusHistory[]
└── sentMessages[]

Wedding
├── Customer User
├── Venue
├── Delivery (bire bir)
└── MessageTask[]

Delivery
└── DeliveryStatusHistory[]
```

### 8.2 `SystemHealth`

Amaç:

- İlk migration ile oluşturulan basit sistem sağlık tablosu.

Alanlar:

```text
id
status = "ok"
checkedAt
```

Mevcut runtime health endpoint'i bu tabloyu okumaz; doğrudan `SELECT 1` çalıştırır. Model ve tablo şemada durmaktadır.

### 8.3 `Venue`

Salon kataloğu ve salon ilişkileri.

Önemli alanlar:

```text
id UUID
slug unique
name unique
isActive
createdAt
updatedAt
```

İlişkiler:

- Salon yöneticisi olarak atanabilecek kullanıcılar.
- Başvurular.
- Onaylanmış düğünler.

İndeks:

- `(isActive, name)`

### 8.4 `User`

Admin, salon yetkilisi ve müşteri hesaplarının ortak modeli.

Önemli alanlar:

```text
username unique
passwordHash
role
status
mustChangePassword
activeAt
passwordChangedAt
lastLoginAt
venueId?
```

İlişkiler:

- Session'lar.
- Müşteri düğünü.
- İncelenen başvurular.
- Audit kayıtları.
- Delivery history aktörlüğü.
- Gönderilmiş mesajlar.

İndeksler:

- `(role, status)`
- `venueId`

### 8.5 `AuthSession`

Sunucu taraflı opaque oturum kaydı.

Alanlar:

```text
tokenHash unique
csrfTokenHash
userId
expiresAt
lastUsedAt
revokedAt?
createdAt
```

Davranış:

- Session token plaintext saklanmaz.
- Session doğrulamasında cookie token'ının SHA-256 hash'i aranır.
- Son kullanım zamanı beş dakikadan eskiyse güncellenir.
- Expire veya revoke edilmiş session geçersizdir.

İndeksler:

- `(userId, expiresAt)`
- `(expiresAt, revokedAt)`

### 8.6 `Package`

Ana çekim paketi kataloğu.

```text
code unique
name
description?
imagePath?
priceCents
isActive
timestamps
```

### 8.7 `Service`

Pakete eklenebilen hizmet kataloğu.

```text
code unique
category
name
eyebrow?
description?
imagePath?
priceCents
isActive
timestamps
```

### 8.8 `BookingApplication`

Public veya admin kaynaklı ham başvuru.

İçerdiği veri grupları:

- Kaynak, durum, referans ve idempotency.
- Gelin/damat ad, soyad ve telefonları.
- Birincil kişi ve e-posta.
- Başlangıç/bitiş zamanı.
- Salon ve paket ilişkisi.
- Paket snapshot'ı.
- Backend hesaplı toplam ve ilk ödeme.
- Ödeme yöntemi.
- Not.
- KVKK/gizlilik ve pazarlama onay zamanları.
- İnceleme zamanı, aktörü ve ret gerekçesi.
- Hizmet snapshot'ları.

İndeksler:

- `(status, createdAt)`
- `(venueId, weddingStartsAt)`
- `primaryEmail`

### 8.9 `BookingApplicationService`

Başvurunun seçtiği her hizmet için tarihsel snapshot.

```text
applicationId
serviceId
codeSnapshot
nameSnapshot
priceCents
createdAt
```

Bir başvuruda aynı `serviceId` yalnız bir kez bulunabilir.

### 8.10 `Wedding`

Onaylanmış ve operasyonel hale gelmiş düğün kaydı.

Önemli alanlar:

```text
applicationId unique
customerUserId unique
çift ve iletişim alanları
startsAt / endsAt
venueId
packageSummary JSON
note?
cancelledAt?
timestamps
```

Her wedding:

- Tek bir başvuruya.
- Tek bir müşteri hesabına.
- Tek bir salona.
- En fazla bir delivery kaydına bağlıdır.

### 8.11 `Delivery`

Düğün sonrası fotoğraf/video teslimat süreci.

```text
weddingId unique
status
dueDate (PostgreSQL DATE)
driveUrlCiphertext?
driveUrlIv?
driveUrlAuthTag?
releasedAt?
timestamps
```

İndeks:

- `(status, dueDate)`

### 8.12 `DeliveryStatusHistory`

Her delivery durum değişimini aktör ve zamanla kaydeder.

```text
deliveryId
fromStatus?
toStatus
actorUserId?
createdAt
```

### 8.13 `MessageTask`

Adminin manuel iletişim kuyruğu.

```text
weddingId
kind
status
dueAt
recipientPhone
secretCiphertext?
secretIv?
secretAuthTag?
sentAt?
sentById?
timestamps
```

- Aynı wedding ve message kind çifti unique'tir.
- `(status, dueAt)` indeksi vardır.
- Hassas secret alanları yalnız hesap aktivasyonu/parola sıfırlama için kullanılır.

### 8.14 `AuditLog`

İşlem izleme kaydı.

```text
actorUserId?
action
targetType
targetId?
outcome
correlationId
metadata JSON?
createdAt
```

İndeksler:

- `createdAt`
- `(actorUserId, createdAt)`
- `(targetType, targetId)`

---

## 9. Enum'lar ve mevcut durum makineleri

### 9.1 Kullanıcı

```text
UserRole:
ADMIN
SALON_YETKILISI
MUSTERI

UserStatus:
ACTIVE
DISABLED
```

Aktif API kullanımı:

- `ADMIN`: admin router'ına erişir.
- `MUSTERI`: customer router'ına erişir.
- `SALON_YETKILISI`: veri modelinde ve login response'unda tanımlıdır; bu role özel router/endpoint mevcut değildir.

### 9.2 Başvuru

```text
ONAY_BEKLIYOR
├── ONAYLANDI
└── REDDEDILDI

IPTAL_EDILDI
```

Mevcut endpoint akışı yalnız bekleyen başvurudan onay veya ret geçişini uygular. `IPTAL_EDILDI` enum değeri şemada ve filtrede tanımlıdır; bu duruma geçiren bir endpoint bulunmaz.

### 9.3 Teslimat

Amaçlanan operasyon sırası:

```text
HAZIRLANIYOR
-> MONTAJ
-> KONTROL
-> TESLIME_HAZIR
-> TESLIM_EDILDI
```

Mevcut PATCH endpoint'i ilk dört durumdan herhangi birini doğrudan seçebilir. `TESLIM_EDILDI` yalnız özel `/deliver` endpoint'iyle ve Drive URL ön koşuluyla oluşur.

### 9.4 Mesaj

```text
MessageKind:
ACCOUNT_ACTIVATION
PREPARATION_UPDATE
DELIVERY_READY
PASSWORD_RESET

MessageStatus:
PENDING
SENT
CANCELLED
```

Mevcut endpoint akışı `PENDING -> SENT` işlemini yapar. `CANCELLED` şemada vardır; bunu ayarlayan bir endpoint bulunmaz.

---

## 10. Seed verileri

`npm run seed` idempotent `upsert` işlemleriyle başlangıç kataloğunu hazırlar.

### 10.1 Salonlar

1. Cess Wedding
2. Bella Garden
3. Yeşil Nesil Garden
4. Talia Garden
5. Rena Garden
6. Mafsel Ömerli
7. Green House Garden

### 10.2 Paket

| Kod    | Ad         |     Fiyat |
| ------ | ---------- | --------: |
| `mini` | Mini Paket | 20.000 TL |

### 10.3 Ek hizmetler

| Kod            | Kategori   | Ad                      |     Fiyat |
| -------------- | ---------- | ----------------------- | --------: |
| `fotograf`     | photo      | Düğün Fotoğrafçılığı    |  7.000 TL |
| `video`        | production | Sinematik Düğün Filmi   |  9.000 TL |
| `drone`        | production | Drone Çekimi            |  8.000 TL |
| `jimmy-jib`    | production | Jimmy Jib Çekimi        | 12.000 TL |
| `dis-cekim`    | photo      | Dış Çekim               |  7.000 TL |
| `organizasyon` | experience | Organizasyon Hizmetleri |  5.500 TL |
| `album`        | experience | Premium Albüm Tasarımı  |  7.000 TL |
| `aninda-baski` | experience | Anında Fotoğraf Baskısı |  5.000 TL |

---

## 11. Kimlik doğrulama ve güvenlik modeli

### 11.1 Session modeli

- JWT kullanılmaz.
- Rastgele, opaque session token kullanılır.
- Token session cookie'sinde plaintext olarak istemcide tutulur.
- Veritabanında yalnız SHA-256 hash bulunur.
- Varsayılan normal session: 12 saat.
- “Beni hatırla” session'ı: 30 gün.
- Süreler ortam değişkenleriyle ayarlanabilir.

Session cookie:

```text
httpOnly: true
secure: production'da true
sameSite: lax
path: /
```

CSRF cookie:

```text
httpOnly: false
secure: production'da true
sameSite: lax
path: /
```

### 11.2 CSRF modeli

- Login sırasında ayrı CSRF token üretilir.
- Token'ın hash'i `AuthSession.csrfTokenHash` içinde saklanır.
- Plain token JS'in okuyabildiği `dugunajansim_csrf` cookie'sine yazılır.
- State-changing korumalı istek `X-CSRF-Token` header'ı gönderir.
- Middleware header, cookie ve session'daki hash'i karşılaştırır.

### 11.3 Parola güvenliği

Argon2id parametreleri:

```text
memoryCost: 19456
timeCost: 2
parallelism: 1
```

- İlk admin de aynı hash fonksiyonunu kullanır.
- Müşteri onayı ve parola reset akışı da aynı fonksiyonu kullanır.
- Zorunlu parola değişimi tamamlanmadan admin/customer iş router'larına geçilemez.

### 11.4 Alan şifreleme

AES-256-GCM kullanılır.

- Anahtar `DATA_ENCRYPTION_KEY`: 64 hex karakter / 32 bayt.
- Her değer için rastgele 12 bayt IV.
- Ciphertext, IV ve auth tag ayrı sütunlarda saklanır.

Şifrelenen mevcut veriler:

1. Google Drive teslimat URL'si.
2. Hesap aktivasyonunda kullanılacak geçici parola.
3. Admin parola sıfırlamasında kullanılacak geçici parola.

### 11.5 HTTP güvenliği

- Helmet.
- Development'ta CSP kapalı; production'da Helmet varsayılan CSP davranışı.
- Cross-Origin Embedder Policy kapalı.
- HPP.
- JSON ve form body limiti 10 KB.
- İzin verilen HTTP metotları: GET, POST, PUT, DELETE, PATCH, OPTIONS.
- Credentials içeren CORS aktif.
- Origin yoksa server-to-server isteğe izin verilir.
- Origin varsa `CORS_ORIGIN` allowlist'inde bulunmalıdır.

### 11.6 Rate limit

| Alan                 | Limit                     |
| -------------------- | ------------------------- |
| Tüm `/api` istekleri | IP başına 15 dakikada 100 |
| Public başvuru       | IP başına 15 dakikada 10  |
| Login                | IP başına 15 dakikada 5   |

### 11.7 Correlation ve hata izleme

- Her istekte correlation ID vardır.
- Gelen ID yalnız 8-128 karakter ve güvenli karakter kümesindeyse kabul edilir.
- Response header ve JSON response içinde geri verilir.
- Beklenmeyen hatalara ayrıca UUID `errorId` atanır.
- Production logları JSON biçiminde temel olay bilgisi yazar.
- Development logları mesaj ve stack içerir.

### 11.8 Audit üreten mevcut eylemler

Kodda açıkça audit kaydı üreten eylemler:

```text
admin.bootstrapped
auth.login
auth.password_changed
booking.created
booking.approved
booking.rejected
wedding.updated
delivery.updated
delivery.released
customer.password_reset
```

Diğer endpoint'lerin route gövdelerinde açık audit write işlemi bulunmaz.

---

## 12. Ortam değişkenleri

### 12.1 Runtime değişkenleri

| Değişken                             | Varsayılan / kural     | Amaç                                  |
| ------------------------------------ | ---------------------- | ------------------------------------- |
| `PORT`                               | `5000`, 1-65535        | HTTP portu                            |
| `NODE_ENV`                           | `development`          | development/production/test           |
| `CORS_ORIGIN`                        | Zorunlu URL listesi    | İzin verilen frontend origin'leri     |
| `DATABASE_URL`                       | Zorunlu PostgreSQL URL | Prisma bağlantısı                     |
| `ALLOW_PRIVATE_DATABASE_WITHOUT_TLS` | `false`                | İzole Docker PostgreSQL TLS istisnası |
| `TRUST_PROXY`                        | `0`, 0-10              | Güvenilen proxy hop sayısı            |
| `HEALTHCHECK_TIMEOUT_MS`             | `3000`, 250-10000      | DB health sorgu timeout'u             |
| `DATA_ENCRYPTION_KEY`                | 64 hex karakter        | AES-256-GCM anahtarı                  |
| `SESSION_COOKIE_NAME`                | `dugunajansim_session` | Session cookie adı                    |
| `SESSION_TTL_HOURS`                  | `12`, 1-720            | Normal session süresi                 |
| `REMEMBER_SESSION_TTL_DAYS`          | `30`, 1-90             | Hatırlanan session süresi             |

İlk admin script'inin ayrıca okuduğu değişkenler:

```text
ADMIN_BOOTSTRAP_USERNAME
ADMIN_BOOTSTRAP_PASSWORD
```

### 12.2 Production'a özel doğrulama

Production modunda:

- PostgreSQL parolası en az 20 karakter olmalıdır.
- En az üç karakter sınıfı ister.
- Bilinen zayıf parolalar ve kullanıcı adıyla aynı parola reddedilir.
- Harici DB URL'si `sslmode=require&sslaccept=strict` ister.
- Yalnız hostname `postgres` olan özel Docker servisi, açık izinle `sslmode=disable` kullanabilir.
- Development varsayılan encryption key'i kabul edilmez.

### 12.3 Mevcut environment dosyaları

- `backend/.env.example`: yerel geliştirme örneği.
- `backend/.env`: yerel çalışma dosyası mevcut ve gitignore kapsamındadır; içeriği bu rapora alınmamıştır.
- `.env.production.example`: Docker production örneği.
- `backend/tests/test.env`: birim/davranış test ortamı.

---

## 13. Sunucu başlangıcı ve yaşam döngüsü

### 13.1 Başlangıç

1. `server.ts`, uygulama modüllerini dinamik import etmeden önce `uncaughtException` handler'ı kurar.
2. `bootstrap.ts` dinamik import edilir.
3. Express uygulaması `PORT` üzerinde dinlemeye başlar.
4. Prisma bağlantısı ihtiyaç oldukça kullanılır.

### 13.2 Güvenli kapanış

Şu olaylar için shutdown mekanizması vardır:

- `SIGTERM`
- `SIGINT`
- `unhandledRejection`
- Çalışan sunucuda `uncaughtException`

Kapanış:

1. Yeni HTTP bağlantısı kabul etmeyi durdurur.
2. HTTP server'ın kapanmasını bekler.
3. Prisma bağlantısını keser.
4. En fazla 10 saniye bekler.
5. Gerekirse açık HTTP bağlantılarını zorla kapatır.
6. Tekrarlanan kapanış sinyallerini tek akışta birleştirir.

### 13.3 Yerel başlatma dosyaları

- `backend/run_server.bat`
- `backend/sunucu_baslat_backend.ps1`

Her ikisi de `npm run dev` üzerinden TSX watch sürecini başlatmak üzere hazırlanmıştır. Proje kök talimatı gereği sunucu test/görüntüleme için hazır script üzerinden başlatılmalıdır.

---

## 14. Migration, seed ve ilk admin

### 14.1 Migration'lar

1. `20260728000000_init_system_health`
   - `public` şeması.
   - `system_health` tablosu.
2. `20260729000000_customer_delivery_mvp`
   - Tüm domain enum'ları.
   - Salon, kullanıcı, session, katalog, başvuru, wedding, delivery, mesaj ve audit tabloları.
   - Unique constraint'ler, indeksler ve foreign key'ler.

Production compose içindeki `migrate` servisi:

```text
npx prisma migrate deploy
```

komutunu backend başlamadan önce çalıştırır.

### 14.2 Seed

Seed production'da otomatik her açılışta çalışmaz. `bootstrap` profile'ı ile ilk kurulumda manuel tetiklenir. Upsert kullandığı için aynı katalog kodlarını yeniden oluşturmaz.

### 14.3 İlk admin

`npm run admin:bootstrap`:

- Normalize edilmiş kullanıcı adı ister.
- En az 12 karakter parola ister.
- Sistemde herhangi bir admin varsa ikinci admin bootstrap işlemini durdurur.
- Admini `mustChangePassword: true` ile oluşturur.
- `admin.bootstrapped` audit kaydı yazar.

---

## 15. Frontend ile mevcut bağlantı

### 15.1 Ortak API istemcisi

Dosya: `js/shared/api-client.js`

Base URL seçimi:

1. HTML'deki `meta[name="api-base-url"]`.
2. Localhost'ta `http://<hostname>:5000/api/v1`.
3. Production'da relative `/api/v1`.

İstemci davranışı:

- `Accept: application/json`.
- JSON body varsa `Content-Type: application/json`.
- GET/HEAD/OPTIONS dışındaki isteklerde CSRF cookie'sini okuyup header'a ekler.
- `credentials: include`.
- Başarısız response'tan ortak Error nesnesi üretir.
- Public başvuru için UUID tabanlı idempotency key üretir.

### 15.2 Paket oluşturucu

Dosya: `js/package-builder/application.js`

Kullandığı endpoint'ler:

```text
GET  /catalog
GET  /venues
POST /booking-applications
```

- Başlangıçta backend kataloğunu ve salonları yükler.
- Başvuruda `Idempotency-Key` gönderir.
- Yerel katalog modülü de frontend içinde mevcuttur; API yükleme akışında backend verisi kullanılır.

### 15.3 Login ekranı

Dosya: `js/login/login.js`

```text
POST /auth/login
POST /auth/password/change
```

- Role göre kullanıcıyı admin veya müşteri paneline yönlendirir.
- `mustChangePassword` true ise parola değiştirme akışını açar.

### 15.4 Admin paneli

Dosya: `js/admin/app.js`

Backend'deki şu işlevleri aktif olarak tüketir:

- Session ve logout.
- Overview.
- Başvuru listeleme/onay/ret/manuel oluşturma.
- Düğün listeleme ve güncelleme.
- Teslimat güncelleme ve yayınlama.
- Müşteri parola sıfırlama.
- Mesaj görevlerini listeleme/render/mark-sent.
- Paket/hizmet CRUD.
- Audit logları.
- Public salon ve katalog verisi.

### 15.5 Müşteri paneli

Dosya: `js/customer-panel/app.js`

```text
GET  /auth/session
GET  /customer/dashboard
GET  /customer/delivery
POST /auth/logout
```

---

## 16. Test ve CI durumu

### 16.1 Backend test komutları

| Komut                      | İçerik                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `npm test`                 | Build + test TypeScript typecheck + 26 birim/davranış testi |
| `npm run test:integration` | Test DB migration + 2 gerçek PostgreSQL entegrasyon testi   |
| `npm run test:db:up`       | Port 55432'de geçici PostgreSQL 17                          |
| `npm run test:db:down`     | Test PostgreSQL servisini kapatır                           |
| `npm run build`            | `src` -> `dist` TypeScript build                            |
| `npm run typecheck:tests`  | Testlerle birlikte noEmit typecheck                         |

### 16.2 Birim/davranış testlerinin kapsadığı alanlar

- Environment doğrulaması ve CORS origin normalizasyonu.
- Prisma health timeout'u ve eşzamanlı sorgu tekilleştirme.
- Production/development health yanıtları.
- Production hata gizleme davranışı.
- Operasyonel hata yanıtları.
- Uncaught exception ve graceful shutdown.
- Shutdown timeout.
- Zod request doğrulama ve normalize veri yazımı.
- Startup config hatasının port açmadan kapanması.
- Helmet, CORS, HPP ve body limit davranışı.
- 404 yanıtı.
- Global rate limit.
- Gece yarısını aşan İstanbul düğün zamanı.
- Kullanıcı adı ve geçici parola kuralları.
- Backend fiyat hesabı.
- Argon2id ve AES-GCM.
- Google Drive URL kuralı.
- Admin wedding update şeması.

### 16.3 Entegrasyon testlerinin kapsadığı alanlar

1. Migration ile oluşan gerçek tablo ve healthcheck.
2. Başvuru oluşturma, atomik onay, rol izolasyonu ve gizli teslimatın uçtan uca akışı.

### 16.4 CI

GitHub Actions iki job çalıştırır:

1. Windows frontend quality/e2e job'u.
2. Ubuntu + PostgreSQL 17 backend integration job'u.

Backend CI sırası:

```text
npm ci
npx prisma migrate deploy
npm test
npm run test:integration
```

### 16.5 Bu rapor hazırlanırken gözlenen doğrulama

30 Temmuz 2026 tarihinde `backend/` içinde `npm test` çalıştırıldı:

```text
Build: başarılı
Test typecheck: başarılı
Test: 26
Başarılı: 26
Başarısız: 0
Atlanan: 0
```

Bu rapor hazırlanırken Docker/PostgreSQL gerektiren `npm run test:integration` ayrıca çalıştırılmadı; entegrasyon test dosyaları ve CI çalıştırma tanımı incelendi.

---

## 17. Production dağıtım modeli

### 17.1 Compose servisleri

| Servis     | İşlev                                    |
| ---------- | ---------------------------------------- |
| `postgres` | Kalıcı PostgreSQL 17 veritabanı          |
| `migrate`  | Prisma migration deploy, tek seferlik    |
| `seed`     | Bootstrap profile ile başlangıç kataloğu |
| `backend`  | Node.js Express API                      |
| `frontend` | Nginx statik site                        |

### 17.2 Backend image

Çok aşamalı build:

1. `dependencies`: npm paketleri + Prisma generate.
2. `build`: TypeScript compile.
3. `migrate`: Prisma CLI içeren migration image.
4. `production-dependencies`: dev paketlerini prune eder.
5. `runtime`: yalnız production node_modules ve dist.

Runtime:

- `node` kullanıcısı.
- Port 5000.
- `node dist/server.js`.

### 17.3 Network ve kalıcılık

- `postgres_data` named volume.
- `internal` ağı `internal: true`.
- `edge_proxy` harici Traefik ağı.
- PostgreSQL yalnız internal ağda.
- Backend internal ve edge_proxy ağlarında.
- Frontend yalnız edge_proxy ağında.

### 17.4 Healthcheck zinciri

- PostgreSQL: `pg_isready`.
- Backend: `fetch(http://127.0.0.1:5000/api/v1/health)`.
- Frontend: `wget http://127.0.0.1/healthz`.

---

## 18. Mevcut kapsam sınırları: ne var, ne yok

Bu bölüm sonraki analiz ajanının backend'in bugünkü ürün sınırını yanlış yorumlamaması için hazırlanmıştır.

### 18.1 Mevcut ve çalışan kapsam

- Public salon ve katalog okuma.
- Public ve admin başvuru oluşturma.
- Backend kontrollü fiyat hesabı.
- Başvuru idempotency desteği.
- Admin başvuru onay ve ret.
- Onaydan müşteri/wedding/delivery/message üretme.
- Admin wedding güncelleme.
- Admin paket/hizmet oluşturma, güncelleme, pasife alma.
- Admin delivery durum ve Drive URL yönetimi.
- Müşteri dashboard ve teslimat URL erişimi.
- Admin kaynaklı müşteri parola sıfırlama.
- Manuel WhatsApp mesaj hazırlama ve gönderildi işaretleme.
- Session/CSRF/rol/zorunlu parola değişimi.
- Audit/correlation/error logging.
- Docker, migration, seed ve CI altyapısı.

### 18.2 Veri modelinde tanımlı, fakat aktif API iş akışı olmayan unsurlar

- `SALON_YETKILISI` rolü.
- User ile Venue arasındaki salon yöneticisi ilişkisi.
- `BookingStatus.IPTAL_EDILDI`.
- `Wedding.cancelledAt`.
- `MessageStatus.CANCELLED`.
- `AuditOutcome.FAILURE`.
- `SystemHealth` tablosu.

### 18.3 Backend'de uygulanmamış ürün kabiliyetleri

- Otomatik WhatsApp/Meta API gönderimi.
  - Mevcut sistem mesaj metni ve `wa.me` linki üretir; admin gönderimi tarayıcıdan yapar.
- Google Drive API ile dosya yükleme, klasör oluşturma veya izin yönetimi.
  - Mevcut sistem yalnız adminin verdiği Drive URL'sini şifreleyip saklar.
- Backend'e medya/dosya upload endpoint'i.
- Ödeme kuruluşu entegrasyonu, ödeme alma, ödeme doğrulama veya ödeme kaydı.
  - Mevcut sistem yalnız fiyat ve “şimdi ödenecek” tutarı hesaplar.
- E-posta gönderimi.
- SMS sağlayıcı entegrasyonu.
- Otomatik cron, queue veya worker.
  - `MessageTask.dueAt` kayıtları vardır; zaman gelince otomatik çalışan süreç yoktur.
- Müşterinin kendi kendine “parolamı unuttum” akışı.
  - Reset yalnız admin endpoint'i üzerinden yapılır.
- Admin dışı kullanıcı/rol yönetim API'si.
- Salon CRUD API'si.
  - Salonlar seed ile gelir; public listeleme vardır.
- Salon yetkilisi paneli/API'si.
- Başvuru veya wedding iptal endpoint'i.
- Message task iptal endpoint'i.
- Delivery kaydını silme endpoint'i.
- Refresh token modeli.
- OAuth veya sosyal login.
- API key veya servis hesabı doğrulaması.
- Webhook endpoint'i.
- OpenAPI/Swagger spesifikasyonu.
- API response pagination sözleşmesi.
  - Büyük admin listeleri sabit `take` sınırı kullanır.
- Ayrı cache servisi.
- Redis.
- Mesaj broker'ı.
- Object storage.
- Merkezi harici log/metric/tracing servisi.
- Veritabanı yedekleme otomasyonu bu repository içinde tanımlı değildir.

---

## 19. Sonraki analiz ajanı için başlangıç haritası

Bir sonraki ajan sorun/eksik analizi yaparken sistemi şu sırayla okuyabilir:

1. `backend/src/app.ts`
   - Middleware ve route sırası.
2. `backend/src/config/env.config.ts`
   - Ortam ve production güvenlik varsayımları.
3. `backend/prisma/schema.prisma`
   - Veri bütünlüğü ve domain sınırları.
4. `backend/src/schemas/api.schemas.ts`
   - İstemci girdisi sözleşmesi.
5. `backend/src/services/booking.service.ts`
   - Fiyat, başvuru, onay, müşteri ve delivery üretimi.
6. `backend/src/routes/auth.routes.ts`
   - Session ve parola yaşam döngüsü.
7. `backend/src/routes/admin.routes.ts`
   - Yönetim kabiliyetlerinin tamamı.
8. `backend/src/routes/customer.routes.ts`
   - Müşteri veri izolasyonu ve teslimat erişimi.
9. `backend/src/middlewares/`
   - Yetki, CSRF, güvenlik ve hata davranışı.
10. `backend/tests/`
    - Bugünkü davranışın test sözleşmesi.
11. `compose.production.yaml` ve Dockerfile'lar
    - Production ağ ve başlangıç sırası.
12. `js/shared/api-client.js`, `js/admin/app.js`, `js/customer-panel/app.js`, `js/package-builder/application.js`
    - Frontend'in gerçekten tükettiği API davranışı.

Analiz sırasında özellikle üç farklı kavram ayrı tutulmalıdır:

- Şemada tanımlı durum/rol.
- Backend endpoint'iyle gerçekten uygulanmış iş akışı.
- Frontend tarafından bugün gerçekten kullanılan endpoint.

---

## 20. İncelenen ana kaynaklar

Backend:

- `backend/package.json`
- `backend/src/app.ts`
- `backend/src/server.ts`
- `backend/src/bootstrap.ts`
- `backend/src/config/env.config.ts`
- `backend/src/config/prisma.ts`
- `backend/src/controllers/health.controller.ts`
- `backend/src/middlewares/*.ts`
- `backend/src/routes/*.ts`
- `backend/src/schemas/api.schemas.ts`
- `backend/src/services/booking.service.ts`
- `backend/src/utils/*.ts`
- `backend/src/scripts/bootstrapAdmin.ts`

Veri ve dağıtım:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/*/migration.sql`
- `backend/prisma/seed.ts`
- `backend/.env.example`
- `.env.production.example`
- `backend/Dockerfile`
- `Dockerfile`
- `compose.production.yaml`
- `deploy/nginx.conf`
- `deploy/README.md`

Tüketici ve doğrulama:

- `js/shared/api-client.js`
- `js/package-builder/application.js`
- `js/login/login.js`
- `js/admin/app.js`
- `js/customer-panel/app.js`
- `backend/tests/backend.test.ts`
- `backend/tests/mvp.test.ts`
- `backend/tests/database.integration.test.ts`
- `.github/workflows/quality.yml`

---

## 21. Sonuç

Mevcut backend, genel amaçlı bir düğün ajansı ERP'sinden ziyade belirli bir operasyon zincirine odaklanır:

```text
Katalog
-> Başvuru
-> Admin inceleme
-> Müşteri hesabı + düğün
-> Çekim sonrası teslimat takibi
-> Manuel WhatsApp iletişimi
-> Şifreli Google Drive bağlantısının müşteriye yayınlanması
```

Temel veri kaynağı PostgreSQL'dir. İşlem bütünlüğü için Prisma transaction'ları, kimlik doğrulama için sunucu taraflı opaque session, hassas değerler için alan şifreleme ve operasyon takibi için audit/correlation altyapısı kullanılır. Frontend; public paket oluşturucu, admin operasyon paneli ve müşteri teslimat paneli üzerinden bu API'yi aktif olarak tüketmektedir.

Bu rapor, sonraki aşamadaki hata, eksik ve iyileştirme analizinin mevcut ürün davranışını değiştirmeden önce kullanacağı başlangıç belgesidir.
