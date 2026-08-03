# Düğün Ajansım Backend Kapsamlı Denetim ve Güçlendirme Raporu

**Tarih:** 2 Ağustos 2026

**Kapsam:** Express/TypeScript backend, Prisma/PostgreSQL veri katmanı, 33 HTTP endpoint, frontend sözleşmesi ve production Docker/Traefik/Nginx dağıtımı

**Yaklaşım:** OWASP API Security Top 10, ilgili OWASP ASVS kontrolleri, kaynak kod incelemesi ve çalışma zamanı kanıtı

## 1. Yönetici özeti

Backend kaynak kodu, 33 endpoint, 13 Prisma modeli, migration geçmişi, frontend API tüketimi ve production dağıtım dosyaları uçtan uca incelendi. Başlangıç mimari raporu yalnız rota haritası olarak kullanıldı; önemli iddialar güncel kaynak, test veya çalışma zamanı davranışıyla yeniden doğrulandı.

Doğrulanan kritik bulgu çıkmadı. Buna karşılık kimlik doğrulama zamanlaması ve session yaşam döngüsü, idempotency ve eşzamanlı durum geçişleri, şifreli secret bağlamı, veritabanı invariant'ları, reverse proxy/IP güveni ve production least-privilege alanlarında yüksek önem düzeyinde sorunlar kanıtlandı. Bu sorunlar public ürün akışını gereksiz değiştirmeden giderildi ve regresyon testleri eklendi.

Son durumda:

- Tam 33 endpoint'in yetki, rol, CSRF, doğrulama, rate-limit, cache ve response davranışı çıkarıldı.
- Admin/müşteri izolasyonu ve BOLA negatif senaryoları gerçek PostgreSQL üzerinde geçti.
- Session rotation/revoke, geçici parola süresi, inactive kullanıcı, CSRF, idempotency ve paralel işlem senaryoları doğrulandı.
- Yeni migration temiz test PostgreSQL veritabanına uygulandı; seed aynı izole veritabanında iki kez başarılı oldu.
- Backend build/typecheck/test, frontend doğrulama/build/performance ve tam Chromium E2E paketi geçti.
- Production frontend/backend/migration image'ları build edildi. Non-root Nginx çalışma hatası gerçek container içinde yakalanıp düzeltildi; son `nginx -t` başarılı oldu.
- Production bağımlılıklarında bilinen açık bulunmadı. Frontend'in yalnız geliştirme/CI ESLint zincirinde, upstream düzeltmesi bulunmayan 6 yüksek uyarı kaldı.

Bu rapor “kusursuz güvenlik” iddiası taşımaz. Dağıtık rate limit, anahtar rotation altyapısı, container secret aktarım modeli, immutable audit ve gerçek Traefik/TLS ortam doğrulaması kalan riskler bölümünde açıkça listelenmiştir.

## 2. Başlangıç sistem durumu

### 2.1 Çalışma ağacı

Denetim başında aktif dal `main` idi. Kullanıcıya ait aşağıdaki mevcut çalışma ağacı değişiklikleri korundu ve görev commit'ine dahil edilmedi:

- `AGENT.md`
- `backend/docs/backend-kapsamli-denetim-ve-guclendirme-raporu1.md`

İstenen rapor hedefi `backend/docs/backend-kapsamli-denetim-ve-guclendirme-raporu.md` çalışma ağacında silinmiş durumdaydı; bu görev kapsamında güncel kanıtlarla yeniden oluşturuldu.

### 2.2 Değişiklik öncesi test tabanı

| Kontrol | Başlangıç sonucu |
|---|---:|
| Backend build + birim/davranış testleri | 26/26 geçti |
| PostgreSQL entegrasyon testleri | 2/2 geçti |
| Frontend format/lint/style/html doğrulaması | Geçti |
| Production image build | Geçti |

Başlangıç testlerinin geçmesi, aşağıdaki yarış koşulları ve güvenlik invariant'ları için kapsama sahip oldukları anlamına gelmiyordu. Yeni testler özellikle negatif, paralel ve veri tabanı constraint senaryolarına odaklandı.

## 3. Kullanılan yöntem

1. Proje talimatları ve mevcut mimari rapor tamamen okundu.
2. Route kaydı kaynak koddan yeniden sayıldı; dinamik katalog route fabrikasının sekiz gerçek endpoint ürettiği hesaba katıldı.
3. Middleware sırası, auth/session/cookie/CSRF/CORS/rate-limit ve hata zinciri incelendi.
4. Controller/route, service ve Prisma işlemlerinde transaction sınırları ile check-then-act yarışları arandı.
5. Prisma şeması tüm migration'larla karşılaştırıldı; FK, unique, nullability, index ve durum invariant'ları incelendi.
6. Şifreleme, token üretimi/hash/karşılaştırma, Argon2id ve secret yaşam döngüsü kontrol edildi.
7. Frontend'in beş ana API tüketicisi endpoint, method, cookie, CSRF, idempotency, response ve error sözleşmesi açısından eşleştirildi.
8. İzole `dugun_ajansim_test` PostgreSQL veritabanı yalnız `127.0.0.1:55432` üzerinden kullanıldı; mevcut `5432` veritabanında yıkıcı test yapılmadı.
9. Gerçek Chromium masaüstü/mobil E2E, Docker image build ve non-root Nginx config testi çalıştırıldı.
10. Her kesin bulgu kod, failing test veya çalışma zamanı çıktısıyla kanıtlandı; tahmine dayalı riskler “kalan risk” olarak ayrıldı.

## 4. Endpoint güvenlik matrisi

Kısaltmalar: `G100` global 100 istek/15 dakika/IP, `L5` login 5/15 dakika/IP, `B10` public başvuru 10/15 dakika/IP, `NS` `Cache-Control: no-store`.

| # | Endpoint | Yetki / rol | CSRF | Doğrulama | Limit | Cache | Kaynak |
|---:|---|---|:---:|---|---|---|---|
| 1 | `GET /api/v1/health` | Açık | — | Girdi tüketmiyor | G100 | NS | `health.routes.ts:10` |
| 2 | `GET /api/v1/catalog` | Açık | — | Girdi tüketmiyor | G100 | Varsayılan | `public.routes.ts:25` |
| 3 | `GET /api/v1/venues` | Açık | — | Girdi tüketmiyor | G100 | Varsayılan | `public.routes.ts:43` |
| 4 | `POST /api/v1/booking-applications` | Açık | — | Strict body + idempotency header | G100+B10 | NS | `public.routes.ts:55` |
| 5 | `POST /api/v1/auth/login` | Açık | — | Strict login body | G100+L5 | NS | `auth.routes.ts:53` |
| 6 | `GET /api/v1/auth/session` | Session | — | Strict boş istek | G100 | NS | `auth.routes.ts:150` |
| 7 | `POST /api/v1/auth/password/change` | Session | Evet | Strict parola body | G100 | NS | `auth.routes.ts:167` |
| 8 | `POST /api/v1/auth/logout` | Session | Evet | Strict boş istek | G100 | NS | `auth.routes.ts:297` |
| 9 | `GET /api/v1/admin/booking-applications` | Admin + kalıcı parola | — | Status/reference query | G100 | NS | `admin.routes.ts:72` |
| 10 | `GET /api/v1/admin/booking-applications/:id` | Admin + kalıcı parola | — | UUID | G100 | NS | `admin.routes.ts:104` |
| 11 | `POST /api/v1/admin/booking-applications` | Admin + kalıcı parola | Evet | Strict admin booking body | G100 | NS | `admin.routes.ts:139` |
| 12 | `POST /api/v1/admin/booking-applications/:id/approve` | Admin + kalıcı parola | Evet | UUID | G100 | NS | `admin.routes.ts:159` |
| 13 | `POST /api/v1/admin/booking-applications/:id/reject` | Admin + kalıcı parola | Evet | UUID + ret nedeni | G100 | NS | `admin.routes.ts:173` |
| 14 | `GET /api/v1/admin/weddings` | Admin + kalıcı parola | — | Girdi tüketmiyor | G100 | NS | `admin.routes.ts:190` |
| 15 | `PATCH /api/v1/admin/weddings/:id` | Admin + kalıcı parola | Evet | Strict wedding body + UUID | G100 | NS | `admin.routes.ts:230` |
| 16 | `PATCH /api/v1/admin/deliveries/:id` | Admin + kalıcı parola | Evet | Boş olmayan strict body + UUID | G100 | NS | `admin.routes.ts:461` |
| 17 | `POST /api/v1/admin/deliveries/:id/deliver` | Admin + kalıcı parola | Evet | UUID | G100 | NS | `admin.routes.ts:546` |
| 18 | `GET /api/v1/admin/packages` | Admin + kalıcı parola | — | Girdi tüketmiyor | G100 | NS | `admin.routes.ts:656,764` |
| 19 | `POST /api/v1/admin/packages` | Admin + kalıcı parola | Evet | Strict package body | G100 | NS | `admin.routes.ts:667,764` |
| 20 | `PATCH /api/v1/admin/packages/:id` | Admin + kalıcı parola | Evet | Boş olmayan strict partial + UUID | G100 | NS | `admin.routes.ts:695,764` |
| 21 | `DELETE /api/v1/admin/packages/:id` | Admin + kalıcı parola | Evet | UUID | G100 | NS | `admin.routes.ts:729,764` |
| 22 | `GET /api/v1/admin/services` | Admin + kalıcı parola | — | Girdi tüketmiyor | G100 | NS | `admin.routes.ts:656,765` |
| 23 | `POST /api/v1/admin/services` | Admin + kalıcı parola | Evet | Strict service body | G100 | NS | `admin.routes.ts:667,765` |
| 24 | `PATCH /api/v1/admin/services/:id` | Admin + kalıcı parola | Evet | Boş olmayan strict partial + UUID | G100 | NS | `admin.routes.ts:695,765` |
| 25 | `DELETE /api/v1/admin/services/:id` | Admin + kalıcı parola | Evet | UUID | G100 | NS | `admin.routes.ts:729,765` |
| 26 | `GET /api/v1/admin/message-tasks` | Admin + kalıcı parola | — | Girdi tüketmiyor | G100 | NS | `admin.routes.ts:767` |
| 27 | `GET /api/v1/admin/message-tasks/:id/render` | Admin + kalıcı parola | — | UUID | G100 | NS | `admin.routes.ts:855` |
| 28 | `POST /api/v1/admin/message-tasks/:id/mark-sent` | Admin + kalıcı parola | Evet | UUID + `expectedUpdatedAt` | G100 | NS | `admin.routes.ts:873` |
| 29 | `POST /api/v1/admin/customers/:id/reset-password` | Admin + kalıcı parola | Evet | UUID | G100 | NS | `admin.routes.ts:920` |
| 30 | `GET /api/v1/admin/audit-logs` | Admin + kalıcı parola | — | Girdi tüketmiyor | G100 | NS | `admin.routes.ts:1031` |
| 31 | `GET /api/v1/admin/overview` | Admin + kalıcı parola | — | Girdi tüketmiyor | G100 | NS | `admin.routes.ts:1043` |
| 32 | `GET /api/v1/customer/dashboard` | Müşteri + kalıcı parola | — | Girdi tüketmiyor | G100 | NS | `customer.routes.ts:27` |
| 33 | `GET /api/v1/customer/delivery` | Müşteri + kalıcı parola | — | Girdi tüketmiyor | G100 | NS | `customer.routes.ts:60` |

Ortak doğrulamalar:

- Admin zinciri: `authenticate → requireChangedPassword → requireRole('ADMIN')`.
- Müşteri zinciri: `authenticate → requireChangedPassword → requireRole('MUSTERI')`.
- Tüm `/api` rotaları global limit altındadır; login ve public başvuru ek limit taşır.
- Tüm state-changing admin endpoint'leri ile password-change/logout CSRF doğrular.
- CORS preflight CSRF, idempotency ve correlation header'larına izin verir.
- Girdi kullanan body/query/params şemaları strict'tir. Girdi tüketmeyen bazı GET endpoint'leri beklenmeyen query'yi kullanmadan yok sayar; mass-assignment yolu oluşturmaz.

## 5. Bulgular

### DA-BE-001 — Login user-enumeration ve timing ayrımı

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/src/routes/auth.routes.ts:30-110`
- **Mevcut davranış:** Kullanıcı bulunmayan ve parola yanlış olan yollar farklı hash işi/yanıt davranışı gösterebiliyordu.
- **Beklenen güvenli davranış:** Tek tip `401`, aynı Argon2 doğrulama maliyeti ve PII içermeyen güvenlik olayı.
- **Kanıt:** Bilinmeyen kullanıcı için dummy hash regresyon testi; entegrasyonda unknown/expired/revoked/disabled kullanıcılar aynı sözleşmeyle reddedildi.
- **Etki:** Kullanıcı adı doğrulama ve brute-force optimizasyonu.
- **Kök neden:** Kullanıcı yokken pahalı parola doğrulamasının atlanması ve fazla ayrıntılı hata yolu.
- **Düzeltme:** Sabit dummy Argon2id hash, generic hata, sabit alanlı güvenlik logu ve login-specific limiter.
- **Test:** `başarısız giriş güvenlik kaydı...`; PostgreSQL kimlik negatif testi.
- **Düzeltme sonrası doğrulama:** Backend test ve integration paketi geçti.

### DA-BE-002 — Session fixation, yarış, idle ve revoke yaşam döngüsü

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/src/middlewares/auth.middleware.ts:45-140`, `backend/src/routes/auth.routes.ts:190-320`, `backend/src/utils/sessionMaintenance.ts`
- **Mevcut davranış:** Password change sonrası aynı session token'ı kalabiliyor; idle timeout rol bazlı değildi; eşzamanlı touch/revoke atomik değildi.
- **Beklenen güvenli davranış:** Absolute TTL + rol bazlı idle TTL, rotation, diğer session'ların revoke edilmesi, revoked/expired/inactive session'ın tek işlemle reddi.
- **Kanıt:** Eski session'ın password change/logout sonrası reddedilmesi ve ikinci session'ın revoke edilmesi gerçek DB testinde gözlendi.
- **Etki:** Çalınmış session'ın uzun süre kullanılması ve session fixation/replay.
- **Kök neden:** Session yenileme ile kullanıcı/parola durumu arasında eksik transaction sınırı.
- **Düzeltme:** 32 bayt opaque token rotation; session/CSRF hash yenileme; admin 30 dakika, müşteri 12 saat idle; absolute TTL; bounded cleanup.
- **Test:** Session expiry/revoke/idle/disabled ve rotation entegrasyon senaryoları.
- **Düzeltme sonrası doğrulama:** Eski cookie `401`, yeni cookie başarılı; diğer açık session revoked.

### DA-BE-003 — Geçici parola ve mesaj secret yaşam döngüsü

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/src/routes/auth.routes.ts:190-275`, `backend/src/routes/admin.routes.ts:920-1026`, `backend/prisma/schema.prisma:99`
- **Mevcut davranış:** Geçici parolanın açık DB son-kullanım süresi yoktu; password change/reset ile pending secret görevleri arasında artık bırakma riski vardı.
- **Beklenen güvenli davranış:** Kısa ve açık expiry, kalıcı parola sonrası secret temizliği/cancel, reset sonrası session revoke.
- **Kanıt:** Süresi dolmuş geçici kullanıcı reddi; kalıcı parola sonrası activation/reset task secret alanlarının temizlenmesi DB assertion'ı.
- **Etki:** Eski geçici kimliğin veya mesaj secret'ının yeniden kullanımı.
- **Kök neden:** `mustChangePassword` boolean'ına tek başına güvenilmesi.
- **Düzeltme:** `temporaryPasswordExpiresAt`, varsayılan 72 saat; password change transaction'ında pending secret temizleme/cancel; reset'te revoke.
- **Test:** `süresi dolmuş geçici kimlikler reddedilir`; uçtan uca secret temizliği.
- **Düzeltme sonrası doğrulama:** DB constraint ve entegrasyon testi geçti.

### DA-BE-004 — IPv6 rate-limit ve reverse proxy güveni

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/src/middlewares/rateLimit.middleware.ts`, `backend/src/middlewares/security.middleware.ts:38-58`, `backend/src/config/env.config.ts:90-180`
- **Mevcut davranış:** IPv6 adres döndürme ile istemci anahtarı değiştirilebiliyor; production'da sayısal proxy hop güveni forwarded header spoof etki alanını büyütüyordu.
- **Beklenen güvenli davranış:** IPv6 `/56` ağ normalizasyonu ve yalnız kesin proxy IP allowlist.
- **Kanıt:** Aynı `/56` içindeki farklı IPv6 adreslerle gerçek limiter önce bypass edilebilirken yeni test 429 doğruluyor; production numeric trust değeri env testinde reddediliyor.
- **Etki:** Brute force/resource limit bypass ve sahte istemci IP'si.
- **Kök neden:** Ham IP anahtarı ve belirsiz proxy hop sayısı.
- **Düzeltme:** IPv4-mapped normalizasyon, IPv6 `/56`, ortak 429 sözleşmesi; production `TRUST_PROXY` exact IP zorunluluğu.
- **Test:** IPv6 unit + gerçek middleware limit testi, env ve preflight testleri.
- **Düzeltme sonrası doğrulama:** 41 backend testi içinde geçti.

### DA-BE-005 — Idempotency payload bağlama ve yarış koşulu

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/src/services/booking.service.ts:70-270`, migration satırları 6, 117-129
- **Mevcut davranış:** Aynı idempotency key farklı payload için önceki cevabı döndürebiliyor; paralel istekler check-then-create yarışı taşıyordu.
- **Beklenen güvenli davranış:** Key'in canonical request fingerprint'ine bağlanması, farklı payload için `409`, paralel aynı payload için tek kayıt.
- **Kanıt:** Sıralı ve paralel tekrarlar, farklı payload ve DB kayıt sayımı entegrasyon testi.
- **Etki:** Yanlış başvuruya cevap bağlama ve duplicate kayıt.
- **Kök neden:** Key unique olsa da istek içeriği saklanmıyordu; transaction izolasyonu yetersizdi.
- **Düzeltme:** SHA-256 canonical fingerprint, serializable transaction, `P2002/P2034` retry ve DB invariant.
- **Test:** Sequential/concurrent idempotency ve mismatch testi.
- **Düzeltme sonrası doğrulama:** Tek DB kaydı ve aynı response ID doğrulandı.

### DA-BE-006 — Onay, düğün, teslimat ve mesaj durum yarışları

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/src/services/booking.service.ts:290-470`, `backend/src/routes/admin.routes.ts:230-640,873-1026`
- **Mevcut davranış:** Paralel approve/deliver/mark-sent/reset işlemleri eski durum üzerinden iki kez yan etki üretebiliyordu.
- **Beklenen güvenli davranış:** Optimistic claim, beklenen `updatedAt/status`, kısa atomik transaction ve ikinci isteğe `409`.
- **Kanıt:** Paralel approve ve deliver testlerinde tam bir başarı, bir `409`; tek Wedding/User/history/task DB sayımı.
- **Etki:** Çift müşteri hesabı, çift mesaj, bozuk history ve tutarsız durum.
- **Kök neden:** Okuma ve yazmanın aynı atomik claim içinde olmaması.
- **Düzeltme:** `updateMany` compare-and-swap, lock sırası, `expectedUpdatedAt`, shared username retry ve transaction içi audit/history.
- **Test:** Paralel PostgreSQL onay/teslim ve mark-sent replay testleri.
- **Düzeltme sonrası doğrulama:** Tek yan etki ve beklenen `409` doğrulandı.

### DA-BE-007 — AES-GCM ciphertext bağlamı ve hassas response alanları

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/src/utils/crypto.ts:20-70`, `backend/src/routes/admin.routes.ts:90-135,770-868`, `backend/src/utils/domain.ts`
- **Mevcut davranış:** Ciphertext doğru key ile başka kayda taşındığında kayıt/kullanım bağlamına kriptografik olarak bağlı değildi; bazı Prisma nesneleri cipher/idempotency alanlarını response'a taşıyabiliyordu.
- **Beklenen güvenli davranış:** 12 bayt IV, 16 bayt tag, canonical encoding, kayıt+tür AAD ve allowlist response DTO.
- **Kanıt:** Farklı delivery/message AAD ile decrypt denemesi hata veriyor; admin/customer response'larında cipher, tag, IV ve fingerprint bulunmadığı assertion'ı.
- **Etki:** DB yazma yetkisi olan saldırganda cross-record ciphertext swap ve hassas metadata ifşası.
- **Kök neden:** AES-GCM authentication tag'in application bağlamına bağlanmaması ve Prisma spread kullanımı.
- **Düzeltme:** Encryption version 2 + AAD; legacy version 1 okuma uyumu; safe DTO map.
- **Test:** Crypto AAD unit testi, delivery/reset uçtan uca response/DB testi.
- **Düzeltme sonrası doğrulama:** Yanlış AAD reddedildi, secret yalnız gerekli render aşamasında çözüldü.

### DA-BE-008 — Veritabanı invariant ve FK index eksikleri

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/prisma/migrations/20260730000000_backend_hardening/migration.sql:1-228`, `backend/prisma/schema.prisma`
- **Mevcut davranış:** Fiyat/ödeme, 36 saat, consent, review, expiry, encryption parçaları, durum geçmişi ve SENT-secret kuralları yalnız uygulama koduna bağlıydı; bazı FK'lerde index yoktu.
- **Beklenen güvenli davranış:** Uygulama bypass edilse dahi kritik veri ilişkileri DB tarafından reddedilmeli.
- **Kanıt:** Geçersiz user/session/delivery/message raw Prisma update/create işlemleri constraint hatası veriyor.
- **Etki:** Bozuk ödeme, yetim/çelişkili durum ve okunamaz şifreli kayıt.
- **Kök neden:** Şemada veri tipleri bulunmasına rağmen iş invariant'larının constraint olmaması.
- **Düzeltme:** Yeni migration ile CHECK'ler, FK indexleri, `reviewedBy` restrict ve yeni lifecycle alanları.
- **Test:** Clean migration + raw invalid write entegrasyon testleri.
- **Düzeltme sonrası doğrulama:** Üç migration temiz DB'ye sırayla uygulandı; invalid write'lar reddedildi.

### DA-BE-009 — PostgreSQL migrator/runtime rol ayrımı

- **Önem:** Yüksek
- **Etkilenen yer:** `compose.production.yaml`, `.env.production.example`, `deploy/postgres/init-runtime-role.sh`, `deploy/README.md`
- **Mevcut davranış:** Aynı DB sahibi hesabı migration ve runtime backend tarafından kullanılıyordu.
- **Beklenen güvenli davranış:** Migrator DDL sahibi; runtime yalnız CONNECT/USAGE ve gerekli tablo/sequence DML yetkileri.
- **Kanıt:** Başlangıç Compose URL'lerinin aynı kullanıcı/parolayı kullandığı statik kontrol; production role testinde runtime DML başarılı, DDL reddedildi.
- **Etki:** Backend credential/RCE ihlalinde veriyle birlikte şemayı silme/değiştirme blast-radius'u.
- **Kök neden:** Tek PostgreSQL credential ile basit deployment kurulumu.
- **Düzeltme:** Ayrı runtime secret, idempotent role bootstrap, mevcut volume upgrade yolu, default privileges ve DDL revoke.
- **Test:** Production hardening statik assertion'ları ve izole Docker role/DDL kontrolü.
- **Düzeltme sonrası doğrulama:** Son production doğrulama bölümüne bakın.

### DA-BE-010 — Production image kullanıcı/dependency ve non-root Nginx çalışma hatası

- **Önem:** Yüksek
- **Etkilenen yer:** `backend/Dockerfile:21-45`, kök `Dockerfile:1-30`, `deploy/nginx.conf`
- **Mevcut davranış:** Runtime image geliştirme bağımlılıkları/package metadata açısından zayıftı; Nginx non-root yapılandırması `/run/nginx.pid` yazamadığı için gerçek container config testi başarısız oldu.
- **Beklenen güvenli davranış:** Minimal production dependencies, non-root `node/nginx`, yazılabilir yalnız gerekli runtime dizinleri ve başarılı health/config.
- **Kanıt:** İlk `docker run ... nginx -t` çıktısı `Permission denied /run/nginx.pid`; düzeltme sonrası aynı komut başarılı.
- **Etki:** Production frontend container'ın başlamaması; gereksiz paket saldırı yüzeyi.
- **Kök neden:** `/var/run` bağlantısının sahipliği gerçek `/run` dizinini kapsamıyordu.
- **Düzeltme:** Multi-stage prune, runtime package metadata, `USER node/nginx`, port 8080, `/run` sahipliği ve healthcheck.
- **Test:** Production static E2E, üç image build, image user inspect ve `nginx -t`.
- **Düzeltme sonrası doğrulama:** Backend/migrate/frontend image build başarılı; config test başarılı.

### DA-BE-011 — Cookie pollution ve CSRF/session bağlama

- **Önem:** Orta
- **Etkilenen yer:** `backend/src/middlewares/auth.middleware.ts:60-190`, auth route'ları
- **Mevcut davranış:** Malformed veya aynı adlı birden fazla session cookie'nin ayrıştırılması belirsizdi; hata 500'e düşebilir veya farklı parser yorumu doğurabilirdi.
- **Beklenen güvenli davranış:** Duplicate/malformed cookie fail-closed, cookie temizleme; CSRF hash'i aktif session ile eşleşmeli.
- **Kanıt:** Duplicate cookie testi `401` ve temizleme header'ı doğruladı; yanlış CSRF password mutation üretmedi.
- **Etki:** HTTP parameter pollution ve auth parser tutarsızlığı.
- **Kök neden:** Hazır cookie parser davranışına aşırı güven.
- **Düzeltme:** Tekil cookie ayrıştırma, biçim/uzunluk kontrolü, hash karşılaştırması ve clear.
- **Test:** Bozuk/duplicate cookie, pozitif/negatif CSRF testleri.
- **Düzeltme sonrası doğrulama:** 500 oluşmadı; state değişmedi.

### DA-BE-012 — Girdi, tarih, URL ve unknown-field doğrulaması

- **Önem:** Orta
- **Etkilenen yer:** `backend/src/schemas/api.schemas.ts:1-140`, `backend/src/utils/domain.ts`, frontend form sözleşmesi
- **Mevcut davranış:** Bazı unknown alanlar sessizce strip ediliyor; Date rollover, ad/telefon kontrol karakteri ve gevşek Drive URL riski bulunuyordu.
- **Beklenen güvenli davranış:** Strict şema, gerçek Gregoryen tarih, 36 saat sınırı, güvenli kişi/telefon normalizasyonu ve yalnız HTTPS Google Drive host'u.
- **Kanıt:** 31 Nisan, kontrol karakterli ad, harf gizlenmiş telefon, client price alanı, boş PATCH ve saldırgan URL negatif testleri.
- **Etki:** Sessiz sözleşme hatası, log/mesaj injection, yanlış tarih ve SSRF-benzeri link yönlendirmesi.
- **Kök neden:** Genel `Date` ve `url()` doğrulamasının iş bağlamı için yeterli kabul edilmesi.
- **Düzeltme:** Strict Zod body/query/params, takvim yardımcıları, Unicode kişi adı allowlist, telefon allowlist, host+HTTPS doğrulaması.
- **Test:** MVP şema/domain testleri ve endpoint integration testleri.
- **Düzeltme sonrası doğrulama:** Bilinmeyen client fiyat alanı reddedildi; frontend yalnız sözleşme alanlarını gönderiyor.

### DA-BE-013 — Katalog snapshot, fiyat otoritesi ve duplicate hizmet

- **Önem:** Orta
- **Etkilenen yer:** `backend/src/services/booking.service.ts:130-270`, katalog admin route'ları
- **Mevcut davranış:** Katalog okuma ile başvuru snapshot yazımı arasında fiyat/aktiflik değişikliği yarışı ve tekrarlanan hizmet ihtimali vardı.
- **Beklenen güvenli davranış:** Fiyat yalnız backend'de, seçilen katalog snapshot'ı tek serializable transaction içinde, duplicate code reddi.
- **Kanıt:** Client price alanı reddi; aktif/pasif ve idempotency entegrasyonu; katalog duplicate `409`.
- **Etki:** Yanlış ücret/snapshot ve çift hizmet hesabı.
- **Kök neden:** Katalog seçimi ile başvuru oluşturmanın ayrı read/write adımları.
- **Düzeltme:** Canonical unique service set, backend kuruş hesabı, cash/deposit kuralı ve serializable snapshot.
- **Test:** Ödeme unit testi, public başvuru ve katalog CRUD entegrasyonu, frontend server-price E2E.
- **Düzeltme sonrası doğrulama:** WhatsApp/özet yalnız server `totalPriceCents/payableNowCents` değerini kullandı.

### DA-BE-014 — Hata/log/cache ve correlation bilgisi

- **Önem:** Orta
- **Etkilenen yer:** `backend/src/middlewares/error.middleware.ts:40-175`, `backend/src/app.ts:59-64`, `backend/src/utils/securityLogger.ts`
- **Mevcut davranış:** Raw path/query veya beklenmeyen hata ayrıntısı log/response'a çıkabilir; hassas hata ve 429 cevaplarında cache politikası tutarlı değildi.
- **Beklenen güvenli davranış:** Production'da generic message + error ID/correlation, route template logu, PII/token/cookie olmaması ve `no-store`.
- **Kanıt:** Production 500 ayrıntı gizleme, 404 path yansıtmama, güvenlik logu alan allowlist ve health header runtime testi.
- **Etki:** Hassas veri ifşası ve log injection.
- **Kök neden:** Development ve production hata sözleşmesinin yeterince ayrılmaması.
- **Düzeltme:** Güvenli operational/expose sınıflandırması, normalize correlation, sabit 404, no-store ve structured security event.
- **Test:** Error middleware, 404, 429 ve live health testleri.
- **Düzeltme sonrası doğrulama:** Açık backend health `200`, no-store ve correlation ID döndürdü.

### DA-BE-015 — Production env, proxy, container ve ağ korumaları

- **Önem:** Orta
- **Etkilenen yer:** `.env.production.example`, `compose.production.yaml`, `deploy/nginx.conf`, `deploy/README.md`
- **Mevcut davranış:** Örnek secret/trust değerleri yanlışlıkla kopyalanabilir; PostgreSQL host portu, container capability/log/restart ve cache/gizli dosya politikaları yeterince açık değildi.
- **Beklenen güvenli davranış:** Boş/fail-closed secret'lar, internal DB ağı, exact proxy IP, bounded logs/PIDs, dropped capabilities ve güvenli Nginx policy.
- **Kanıt:** Sentetik env ile `docker compose config -q`; boş zorunlu değerlerde fail; production static assertions.
- **Etki:** Secret reuse, client-IP spoof, gereksiz DB erişimi ve disk/resource tüketimi.
- **Kök neden:** Development kolaylıklarının production örneğine taşınması.
- **Düzeltme:** Boş zorunlu secret alanları, internal network/no host DB port, `pids_limit`, `cap_drop`, `no-new-privileges`, log rotation, security headers ve gizli dosya blokları.
- **Test:** Compose config, image build, production-hardening E2E.
- **Düzeltme sonrası doğrulama:** Compose config ve image build başarılı.

### DA-BE-016 — Migration/seed/bootstrap/restore operasyon güvenliği

- **Önem:** Orta
- **Etkilenen yer:** `compose.production.yaml`, `backend/src/scripts/bootstrapAdmin.ts`, `deploy/README.md`, test DB scriptleri
- **Mevcut davranış:** Seed migration tamamlanmasını kesin beklemiyor; bootstrap kullanıcı adını logluyor; restore readiness kontrolü yetersizdi; çıplak seed yanlış DB'ye yönelebilirdi.
- **Beklenen güvenli davranış:** Migration gate, idempotent ve korumalı test seed, secret'ı argüman/loga koymayan bootstrap, restore `--wait/--exit-on-error`.
- **Kanıt:** Clean migration; izole seed iki kez; statik production testleri.
- **Etki:** Kısmi deploy, yanlış DB mutasyonu ve kişisel bilgi/secret sızıntısı.
- **Kök neden:** Operasyon komutlarının mutlu-yol varsayımı.
- **Düzeltme:** Service-completed dependency, `seed:test` guard, güvenli admin env girişi, restore-check adımları.
- **Test:** İki seed çalıştırması, Compose ve deploy doküman assertion'ları.
- **Düzeltme sonrası doğrulama:** Her iki seed başarılı; bootstrap logu kullanıcı adı içermiyor.

### DA-BE-017 — Graceful shutdown, health ve session temizliği

- **Önem:** Orta
- **Etkilenen yer:** `backend/src/server.ts`, `backend/src/routes/health.routes.ts`, `backend/src/utils/sessionMaintenance.ts`
- **Mevcut davranış:** Signal/exception tekrarlarında kaynak kapatma ve timeout davranışı için yeterli regresyon güvencesi yoktu; session temizliği sınırsız büyüyebilirdi.
- **Beklenen güvenli davranış:** Tek kapanış akışı, bounded timeout/disconnect, DB timeout'lu health ve bounded eski-session cleanup.
- **Kanıt:** Yinelenen sinyal, uncaught exception ve kapanış timeout testleri; live health.
- **Etki:** Deploy sırasında yarım istek, çift disconnect ve DB/session bakım yükü.
- **Kök neden:** Process yaşam döngüsü yollarının ayrı ayrı ele alınması.
- **Düzeltme:** Idempotent async shutdown, timeout, health query tekilleştirme ve 30 gün/100 kayıt cleanup batch'i.
- **Test:** Backend process/health/sessionMaintenance testleri.
- **Düzeltme sonrası doğrulama:** İlgili tüm davranış testleri geçti.

### DA-BE-018 — Frontend geliştirme bağımlılığı advisory zinciri

- **Önem:** Orta; production runtime'a dahil değil
- **Etkilenen yer:** Kök geliştirme dependency ağacı (`eslint → minimatch → brace-expansion`)
- **Mevcut davranış:** `npm audit` tüm dependency ağacında 6 yüksek DoS advisory bildiriyor ve “No fix available” diyor.
- **Beklenen güvenli davranış:** Upstream güvenli sürüm yayımlandığında lock kontrollü yükseltilmeli; untrusted glob pattern CI aracına verilmemeli.
- **Kanıt:** `npm audit --audit-level=high` çıktısı; `npm audit --omit=dev` sıfır açık.
- **Etki:** Yalnız geliştirme/CI lint işlemlerinde kötü niyetli genişleme ile kaynak tüketimi; production web/backend image'ına taşınmıyor.
- **Kök neden:** Upstream ESLint/minimatch transitive bağımlılığı.
- **Düzeltme:** Güvenli otomatik düzeltme bulunmadığından lock/major sürüm zorlanmadı; production prune ve takip riski olarak kaydedildi.
- **Test:** Backend prod/all audit 0; frontend prod audit 0; frontend all audit 6 high.
- **Düzeltme sonrası doğrulama:** Production image içinde geliştirme zinciri bulunmuyor.

### DA-BE-019 — Büyük admin route modülü

- **Önem:** Düşük / bakım
- **Etkilenen yer:** `backend/src/routes/admin.routes.ts`
- **Mevcut davranış:** HTTP, iş kuralı, transaction, crypto ve DTO sorumlulukları aynı büyük dosyada yoğunlaşıyor.
- **Beklenen güvenli davranış:** Gelecek bakımda route/controller/service ayrımı; mevcut public sözleşme korunmalı.
- **Kanıt:** Tek dosyada 23 endpoint ve çok sayıda transaction/status akışı.
- **Etki:** İnceleme maliyeti ve ileride güvenlik regresyonu olasılığı.
- **Kök neden:** MVP'nin tek route modülünde büyümesi.
- **Düzeltme:** Bu görevde riskli geniş refactor yapılmadı; yalnız doğrulanmış davranışlar nokta atışı güçlendirildi.
- **Test:** 23 admin endpoint matrisi ve entegrasyon akışı.
- **Düzeltme sonrası doğrulama:** Public API değişmeden testler geçti.

## 6. Uygulanan düzeltmeler

- Generic/timing-denk login ve PII'siz güvenlik logu.
- Rol bazlı idle TTL, absolute TTL, session+CSRF rotation/revoke ve bounded cleanup.
- Geçici parola expiry, password reset/change secret temizliği.
- Strict cookie, body/query/params ve unknown-field reddi.
- IPv6 `/56` limiter anahtarı, standardize 429 ve exact production proxy trust.
- Canonical idempotency fingerprint, serializable snapshot ve retry.
- Optimistic state claims, lock sırası ve replay'e `409`.
- AES-256-GCM AAD + encryption version ve safe response DTO'ları.
- Yeni DB CHECK/FK index migration'ı.
- Ayrı PostgreSQL migrator/runtime rolleri.
- Non-root/minimal production image, Nginx `/run` fix'i.
- Internal DB ağı, container hardening, fail-closed secret örneği ve deploy gate'leri.
- Frontend'in backend otoriter kuruş değerlerini ve yeni parola sözleşmesini kullanması.

## 7. Eklenen/değiştirilen testler

- `backend/tests/backend.test.ts`: env, CORS, error hiding, process shutdown, IPv6 limiter, body limit, cookie pollution, 404 ve health.
- `backend/tests/mvp.test.ts`: tarih, kişi/telefon, parola, strict unknown field, fiyat, Drive URL ve AES-GCM AAD.
- `backend/tests/database.integration.test.ts`: DB constraint, auth negatifleri, session rotation/revoke, BOLA, idempotency, paralel approve/deliver, katalog CRUD, wedding bağlı güncellemeleri, reset/render/mark-sent ve secret leakage.
- `tests/e2e/smoke.spec.js`: frontend-backend katalog/form/admin/müşteri/parola/server-price sözleşmesi.
- `tests/e2e/production-hardening.spec.js`: Docker/Compose/Nginx/env/deploy güvenlik regresyonları.

## 8. Test komutları ve sonuçları

| Komut / kontrol | Sonuç |
|---|---|
| `backend: npm test` | 41/41 geçti; build ve test TypeScript typecheck dahil |
| `backend: npm run test:integration` | 4/4 geçti; test DB guard dahil gerçek PostgreSQL |
| `backend: npm run seed:test` iki kez | İki çalıştırma da geçti |
| `npx prisma validate` | Geçti |
| `npm run validate` | Prettier, ESLint, Stylelint, HTML validate geçti |
| `npm run build` | Geçti |
| `npm run audit:performance` | Bütçe geçti |
| `npm run test:e2e` | 37 geçti, 1 bilinçli mobil duplicate skip, 0 hata |
| Live `GET /api/v1/health` | 200, DB connected, no-store, correlation ID |
| `docker compose ... config -q` | Sentetik secret'larla geçti; zorunlu boş env fail-closed |
| Production Docker build | frontend, backend, migrate başarılı |
| Image user inspect | backend `node`, frontend `nginx` |
| Non-root `nginx -t` | İlk çalıştırmada `/run/nginx.pid` hatası kanıtlandı; fix sonrası geçti |
| Fresh production DB rol testi | Migration/bootstrap geçti; runtime DML geçti, DDL reddedildi; geçici volume kaldırıldı |
| Backend `npm audit` prod/all | 0 açık |
| Frontend `npm audit --omit=dev` | 0 açık |
| Frontend full `npm audit` | 6 high; dev-only upstream, fix yok |

Not: İlk entegrasyon tekrarında hazırlık mesajı testinin iş kuralındaki “düğünden 2 gün sonra” formülünü yanlış beklediği görüldü; kaynak formülüyle uyumlu assertion düzeltildi ve paket baştan geçti. İlk tam E2E'de WhatsApp Markdown kalın işaretini hesaba katmayan assertion yanlış negatif üretti; server tutarı doğruydu, test kesin sözleşmeye göre düzeltildi ve tam paket geçti. Assertion zayıflatılmadı.

## 9. Migration ve production doğrulaması

### 9.1 Migration

- Mevcut migration geçmişi değiştirilmedi.
- `20260730000000_backend_hardening` yeni migration olarak eklendi.
- İzole PostgreSQL ilk kurulumunda üç migration sırasıyla uygulandı.
- Prisma şeması valid.
- Constraint'ler raw invalid write testleriyle doğrulandı.
- Seed iki kez çalıştırıldı ve idempotent kaldı.

### 9.2 Production

- PostgreSQL yalnız internal Docker network'te; host portu açılmıyor.
- Migration tamamlanmadan backend/seed/bootstrap başlamıyor.
- Runtime ve migrator DB rolleri ayrıldı; mevcut volume için non-destructive upgrade adımı dokümante edildi.
- Backend/frontend non-root çalışıyor.
- Image build ve Nginx config gerçek Docker Engine üzerinde doğrulandı.
- Secret örneği değer taşımıyor; dosya izni ve üretim komutları deploy dokümanında yer alıyor.
- Traefik yönlendirme/TLS sertifika edinimi gerçek production domain üzerinde bu yerel denetimde uygulanmadı.

## 10. Dependency audit sonucu

| Kapsam | Sonuç | Değerlendirme |
|---|---:|---|
| Backend production | 0 | Temiz |
| Backend tüm bağımlılıklar | 0 | Temiz |
| Frontend production | 0 | Temiz |
| Frontend tüm bağımlılıklar | 6 high | ESLint/minimatch/brace-expansion; upstream fix yok; production'a dahil değil |

Lock dosyaları sebepsiz değiştirilmedi; güvenli otomatik çözüm bulunmayan transitive uyarı için major sürüm zorlanmadı.

## 11. Önce/sonra karşılaştırması

| Alan | Önce | Sonra |
|---|---|---|
| Login | Kullanıcı yolu/timing ayrımı | Generic cevap + dummy Argon2 + L5 |
| Session | Eksik idle/rotation atomikliği | Rol idle + absolute TTL + rotation/revoke |
| Geçici parola | Boolean yaşam döngüsü | Açık expiry + DB constraint + secret cleanup |
| Idempotency | Key yalnız | Key + payload fingerprint + serializable retry |
| Durum geçişi | Check-then-write | Optimistic claim + `409` replay |
| Şifreleme | GCM tag, bağlamsız | Versioned GCM + kayıt/tür AAD |
| DB bütünlüğü | Çoğunlukla uygulama kodu | CHECK/FK index/status invariant'ları |
| Girdi | Bazı unknown alanlar strip | Girdi kullanan şemalar strict/fail-closed |
| Rate limit | Ham IPv6/proxy hop | `/56` normalize + exact proxy IP |
| Production DB | Owner runtime credential | Ayrı migrator ve DML-only runtime rolü |
| Frontend image | Non-root pid hatası | `/run` yazılabilir, `nginx -t` başarılı |
| Test kapsamı | 26 unit, 2 integration | 41 unit, 4 kapsamlı integration, 37 E2E |

## 12. Kalan riskler

1. **Dağıtık rate limit:** Limiter process belleğindedir. Birden çok backend replica için Redis gibi merkezi store gerekir.
2. **Encryption key rotation:** Ciphertext version var; ancak key ID ve dual-key read/write rotation mekanizması yoktur. Key değişimi mevcut secret'ları erişilemez yapar.
3. **Secret aktarımı:** Production secret'ları Compose environment üzerinden container'a aktarılır ve yetkili Docker inspect kullanıcısı görebilir. Docker secrets/external vault tercih edilmelidir.
4. **Frontend dev advisory:** ESLint zincirindeki 6 yüksek advisory için upstream düzeltme bekleniyor. Production bağımlılıklarında açık yoktur.
5. **Immutable audit:** Audit uygulama transaction'larında tutulur; ayrı append-only/WORM store veya DB-level immutable policy yoktur. Bazı başarısız business işlemleri yalnız structured logda kalır.
6. **Container sınırları:** PID/log/capability sınırları var; CPU/memory quota, read-only root filesystem ve tmpfs kapsamı ayrıca uygulanabilir.
7. **Image pinning:** Base image tag'leri build sırasında digest'e çözülse de Compose/Dockerfile kaynakta mutable tag kullanır. Kontrollü digest yenileme otomasyonu önerilir.
8. **CSP:** Mevcut frontend uyumu nedeniyle `unsafe-inline` gereksinimi tamamen kaldırılamadı. Nonce/hash tabanlı CSP sonraki teknik borç çalışmasıdır.
9. **Saat dilimi:** Türkiye'nin güncel sabit UTC+3 kuralı uygulanır. Gelecekte mevzuat/politika değişirse timezone kütüphanesi ve testler güncellenmelidir.
10. **Dış servisler:** Gerçek WhatsApp/Drive API gönderimi yoktur; URL ve render akışı test edilmiştir, harici servis teslim garantisi bu kapsamda doğrulanamaz.
11. **Kod organizasyonu:** `admin.routes.ts` hâlâ büyüktür. Davranış sabitlenmeden geniş refactor yapılmaması tercih edildi.
12. **Gerçek production edge:** Traefik sabit IP, DNS, TLS certificate resolver, backup hedefi ve host firewall gerçek production sunucuda ayrıca smoke test edilmelidir.

## 13. Yeni özellik geliştirmeye geçiş değerlendirmesi

**Değerlendirme: Koşullu olarak hazır.** Doğrulanmış kritik/yüksek uygulama bulguları giderildi; build, typecheck, unit, PostgreSQL integration, frontend E2E, migration, seed ve production image kontrolleri başarılıdır. Yeni özellik geliştirmeye başlanabilir.

Production deploy öncesi operasyon gate'i olarak gerçek secret üretimi, sabit Traefik IP doğrulaması, DB rol bootstrap/privilege sorguları, DNS/TLS ve restore tatbikatı tamamlanmalıdır. Kalan riskler yeni ürün özelliğini doğrudan engellemez; ancak rate-limit store, key rotation ve secret manager çalışmaları production ölçeği büyümeden planlanmalıdır.

## 14. Değiştirilen dosyalar

### Backend kaynak ve build çıktısı

- `backend/src/app.ts`
- `backend/src/config/env.config.ts`
- `backend/src/middlewares/auth.middleware.ts`
- `backend/src/middlewares/error.middleware.ts`
- `backend/src/middlewares/rateLimit.middleware.ts`
- `backend/src/middlewares/security.middleware.ts`
- `backend/src/routes/admin.routes.ts`
- `backend/src/routes/auth.routes.ts`
- `backend/src/routes/customer.routes.ts`
- `backend/src/routes/public.routes.ts`
- `backend/src/schemas/api.schemas.ts`
- `backend/src/scripts/bootstrapAdmin.ts`
- `backend/src/scripts/migrateTestDatabase.ts`
- `backend/src/scripts/seedTestDatabase.ts`
- `backend/src/scripts/testDatabaseGuard.ts`
- `backend/src/services/booking.service.ts`
- `backend/src/utils/crypto.ts`
- `backend/src/utils/domain.ts`
- `backend/src/utils/securityLogger.ts`
- `backend/src/utils/sessionMaintenance.ts`
- İlgili `backend/dist/**` derlenmiş çıktıları

### Prisma, migration ve test altyapısı

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260730000000_backend_hardening/migration.sql`
- `backend/compose.test.yaml`
- `backend/package.json`
- `backend/tests/test.env`
- `backend/tests/backend.test.ts`
- `backend/tests/database.integration.test.ts`
- `backend/tests/mvp.test.ts`

### Frontend sözleşmesi ve E2E

- `js/admin/app.js`
- `js/login/login.js`
- `js/package-builder/application.js`
- `login.html`
- `tests/e2e/smoke.spec.js`
- `tests/e2e/production-hardening.spec.js`

### Production ve dokümantasyon

- `.env.production.example`
- `Dockerfile`
- `backend/Dockerfile`
- `compose.production.yaml`
- `deploy/nginx.conf`
- `deploy/postgres/init-runtime-role.sh`
- `deploy/README.md`
- `backend/docs/backend-kapsamli-denetim-ve-guclendirme-raporu.md`

Kullanıcıya ait başlangıç değişiklikleri görev commit'ine dahil edilmemiştir.
