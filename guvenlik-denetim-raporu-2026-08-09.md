# Düğün Ajansım Güvenlik Denetimi

**Tarih:** 9 Ağustos 2026
**Genel güvenlik puanı:** **6,2 / 10 — temel katmanlar güçlü, üretim ve veri koruma açıkları önemli**

## Kapsam ve yöntem

Altı bağımsız subagent ile kimlik/yetki, spam–DoS, veri/kriptografi, frontend,
üretim altyapısı ve bağımlılık–test alanları incelendi. Merkez incelemede 173 takip
edilen `.md` olmayan dosyanın envanteri çıkarıldı ve kritik bulgular çağrı zinciriyle
yeniden doğrulandı. Codex Security kullanılmadı; `AGENT.md` dışındaki mevcut `.md`
raporları okunmadı veya referans alınmadı.

Bu çalışma kaynak kodu, yapılandırma, migration, test ve güncel `npm audit`
sonuçlarına dayalı beyaz-kutu incelemedir. Canlı sisteme saldırı testi yapılmadı;
host disk şifrelemesi, Traefik statik TLS ayarları, dış izleme ve gerçek yedek kopyaları
depodan doğrulanamaz.

## Müşteri bilgileri şifreleniyor mu?

**Kısmen; uçtan uca veya tamamen şifreli değil.**

| Veri/kanal | Mevcut durum |
| --- | --- |
| Kalıcı kullanıcı parolası | Argon2id ile geri döndürülemez özet; güçlü. `backend/src/utils/crypto.ts:29-38` |
| Oturum, CSRF ve ödeme-akışı anahtarları | Veritabanında SHA-256 özet; güçlü. `backend/src/utils/crypto.ts:40-48`, `backend/src/routes/auth.routes.ts:80-120` |
| Teslimat Drive URL'si ve geçici parola | AES-256-GCM + rastgele IV + kayıt bağlı AAD. `backend/src/utils/crypto.ts:51-80`, `backend/prisma/schema.prisma:338-383` |
| Ad, soyad, telefon, e-posta, not ve mesaj alıcı telefonu | **Düz metin.** `backend/prisma/schema.prisma:195-249,268-301,372-393` |
| Tarayıcı → Traefik | TLS etkin. `compose.production.yaml:194-200,234-238` |
| Traefik → uygulama ve uygulama → PostgreSQL | İç ağda HTTP ve `sslmode=disable`; kriptografik uçtan uca taşıma yok. `compose.production.yaml:160-161,194-212` |
| Dağıtım öncesi DB yedeği | Dosya izinleri sıkı; otomatik şifreleme/uzak kopya/retention yok. `.github/workflows/deploy.yml:67-76` |

Sonuç: Veritabanı, volume veya yedek ele geçirilirse temel müşteri kimlik ve iletişim
bilgileri okunabilir. Uygulama anahtarı yalnız iki özel alanı koruyor.

## Öncelikli bulgular

### G-01 — Yüksek — Ödeme temizliği üretim DB rolüyle çalışamıyor

- Kod `audit_logs` üzerinde `DELETE` yapıyor; runtime rolünde bu yetki yok:
  `backend/src/services/booking.service.ts:590-594`,
  `deploy/postgres/init-runtime-role.sh:103-123`, `compose.production.yaml:160`.
- İlk süresi dolan başvuruda transaction rollback olabilir; PII silinmez, dakikalık görev
  sürekli hata verir ve ödeme-akışı uçları `500` üretebilir (`backend/src/bootstrap.ts:13-34`).
- **Düzeltme:** Geniş audit silme yetkisi vermek yerine dar bir bakım fonksiyonu/rolü
  ve gerçek production runtime rolüyle permission-smoke testi eklenmeli.

### G-02 — Yüksek — Public istek doğrulanmadan sınırsız global temizlik başlatıyor

- `expireStalePaymentFlows()` backlog bitene kadar `while (true)` ile çalışıyor:
  `backend/src/services/booking.service.ts:553-603`.
- Public PATCH/handoff çağrıları ödeme anahtarını doğrulamadan önce bu global işi tetikliyor:
  `backend/src/services/booking.service.ts:625-654,764-778`,
  `backend/src/routes/public.routes.ts:215-243`.
- Botnet veya büyük backlog DB/lock/IO tüketerek servis reddine yol açabilir.
- **Düzeltme:** İstek yolunda önce anahtar doğrulanıp yalnız hedef kayıt expire edilmeli;
  global iş süre/batch bütçeli worker, dağıtık lock ve uygun partial index kullanmalı.

### G-03 — Yüksek — Temel müşteri PII'si alan bazında şifrelenmiyor

- Çiftlerin adı, telefonu, e-postası ve notu hem başvuru hem düğün tablolarında düz metin:
  `backend/prisma/schema.prisma:202-233,274-287`; mesaj telefonu da düz (`:379`).
- DB/volume/yedek sızıntısında veriler topluca açılır; aynı PII'nin tekrarlanması etkiyi büyütür.
- **Düzeltme:** Telefon/e-posta/not gibi yüksek riskli alanlarda AES-GCM; arama için anahtarlı
  HMAC blind-index; gereksiz PII kopyalarını azaltma ve otomatik retention/purge uygulanmalı.

### G-04 — Yüksek — Ayrıcalıklı hesapların ele geçirilme etkisi fazla geniş

- Admin/salon girişinde MFA yok: `backend/src/routes/auth.routes.ts:53-78`,
  `backend/prisma/schema.prisma:109-124`.
- Tek `ADMIN` rolü müşteri geçici parolasını sıfırlayabilir ve düz metin görüntüleyebilir:
  `backend/src/routes/admin.routes.ts:61,2227-2272,2377-2499`.
- Takip edilen örnek admin parolası bootstrap tarafından özel olarak reddedilmiyor:
  `backend/.env.example:31-32`, `backend/src/scripts/bootstrapAdmin.ts:8-38`.
- **Düzeltme:** Admin için WebAuthn/TOTP, kritik işlemlerde step-up, ayrık yetkiler,
  tek kullanımlık hashli reset bağlantısı ve production'da bilinen örnek parola reddi.

### G-05 — Yüksek — Tek-host mimari ve felaket kurtarma kesinti riskini büyütüyor

- Backend, frontend ve PostgreSQL tek kopya/tek host; CPU, RAM ve disk kotası yok:
  `compose.production.yaml:9-33,143-155,214-257`.
- Deploy yerinde build+migration yapıyor; otomatik rollback yok. Yedek aynı hostta, şifreleme,
  prune, WAL/PITR veya gerçek restore tatbikatı otomasyonu yok:
  `.github/workflows/deploy.yml:51-87`.
- Host kaybı, disk dolması veya hatalı migration tam kesinti/veri kaybı oluşturabilir.
- **Düzeltme:** Kaynak limitleri, alarm, immutable image + blue/green rollback, şifreli 3-2-1
  yedek, retention, PITR ve izole ortama düzenli restore testi.

### G-06 — Orta — Spam ve brute-force koruması dağıtık saldırıya dayanıklı değil

- Katmanlı limitler var; ancak uygulama limitleri process-local ve yalnız IP tabanlı:
  `backend/src/middlewares/security.middleware.ts:82-95`,
  `backend/src/routes/auth.routes.ts:44-51`, `backend/src/routes/public.routes.ts:28-44`.
- Public başvuruda CAPTCHA/Turnstile, iletişim sahipliği doğrulaması ve zorunlu idempotency yok:
  `backend/src/routes/public.routes.ts:169-190`, `backend/src/schemas/api.schemas.ts:105-142`.
- Dağıtık botlar sahte başvuru/credential-stuffing yapabilir; ortak NAT kullanıcıları yanlış
  biçimde kilitlenebilir.
- **Düzeltme:** Paylaşımlı limiter store, IP + kullanıcı HMAC anahtarı, progressive delay,
  risk anında privacy-friendly challenge ve telefon/e-posta bazlı dedup/doğrulama.

### G-07 — Orta — Sistematik request/DB timeout ve bazı iş yükü sınırları yok

- Node HTTP timeout'ları ve genel PostgreSQL `statement_timeout/lock_timeout` tanımlı değil;
  yalnız health ve bazı transactionlar süreli: `backend/src/bootstrap.ts:37-42`,
  `backend/src/config/prisma.ts:26-38`, `compose.production.yaml:160`.
- Admin çatışma hesabı atama çiftlerini O(n²) karşılaştırıyor:
  `backend/src/routes/admin.routes.ts:568-588`.
- Askıda DB/ağ veya veri büyümesi 50 in-flight slotu/event-loop'u tüketebilir.
- **Düzeltme:** Edge+Node+DB deadline, iptal yayılımı, sorgu/result limitleri ve O(n log n)
  çatışma hesabı; lock/slowloris/yük testleri.

### G-08 — Orta — Frontend iki kanalda müşteri verisi/yetenek sırrı açığa çıkarıyor

- Ad, telefon, tarih, salon, paket ve fiyat WhatsApp `?text=` URL'sine yazılıyor:
  `js/package-builder/application.js:1356-1378,1442-1444`. HTTPS enjeksiyonu önler,
  fakat URL WhatsApp/Meta ve tarayıcı geçmişine PII taşır; sayfadaki “üçüncü kişilerle
  paylaşılmaz” beyanıyla gerilimlidir (`paketini-olustur.html:634-641`).
- `applicationId + paymentFlowKey` JavaScript-okur `sessionStorage` içinde tutuluyor ve tam
  başvuru PII'sini geri getirebiliyor: `js/package-builder/application.js:73-79,1662-1674`.
  RNG fallback'i CSPRNG değil: `js/shared/api-client.js:65-69`.
- **Düzeltme:** WhatsApp'a yalnız referans kodu; yetenek anahtarında `getRandomValues`/fail-closed,
  handoff sonrası silme veya HttpOnly kısa ömürlü cookie.

### G-09 — Orta — Kripto anahtar rotasyonu ve veri yaşam döngüsü eksik

- Tek statik veri anahtarı var; kayıtlar `keyId` taşımıyor. `encryptionVersion` anahtar sürümü
  değil, yalnız AAD biçimidir: `backend/src/utils/crypto.ts:17`,
  `backend/prisma/schema.prisma:347,383`.
- Eski v1 kayıtları AAD'siz okunabiliyor ve başvuru/audit/message PII'si için genel retention yok:
  `backend/src/routes/customer.routes.ts:94-101`,
  `backend/src/utils/sessionMaintenance.ts:3-25`.
- **Düzeltme:** KMS/Vault, `keyId`, çoklu anahtar okuma ve yeniden şifreleme; v1 migrasyonu;
  tablo/yedek bazlı saklama–anonimleştirme matrisi.

### G-10 — Orta — Bağımlılık ve CI tedarik zinciri kapısı eksik

- 9 Ağustos 2026 `npm audit`: backend tüm bağımlılıklarda ve frontend üretim setinde
  **0** bilinen açık; frontend geliştirme araç zincirinde **19 yüksek** advisory.
  Örnek kilit girdileri: `package-lock.json:1279,1747,2244,2451`.
- CI advisory kapısı çalıştırmıyor; quality actionları mutable `@v4` etiketinde ve açık en az
  yetkili `permissions` tanımı yok: `.github/workflows/quality.yml:1-25,55-64`.
- `.gitignore` `.env.staging/.env.test` benzeri adları kapsamıyor: `.gitignore:9-15`.
- **Düzeltme:** Runtime ve dev için ayrı eşikli audit/OSV kapısı, düzenli update triage,
  action SHA pinleri, `permissions: contents: read` ve `.env*` deny-by-default allowlist.

### G-11 — Orta/Düşük — Savunma derinliği ve test matrisi tamamlanmamış

- Tenant sınırları uygulama sorgularında iyi uygulanıyor, fakat DB RLS yok ve runtime rolü tüm
  tablolarda geniş DML alıyor: `backend/src/routes/operations.routes.ts:36-51`,
  `deploy/postgres/init-runtime-role.sh:74-124`.
- Production-role permission, paralel sweep, yavaş istek/DB lock, kapsamlı CSRF/IDOR/stored-XSS,
  yük/soak/chaos ve otomatik rollback senaryoları test edilmiyor.
- **Düzeltme:** Tenant-scope repository/RLS, production-role fixture ve tablo-temelli negatif
  güvenlik matrisi; periyodik yük ve restore tatbikatı.

## Güçlü güvenlik katmanları

- Helmet/CSP/CORS/HPP, 10 KB body sınırı, strict Zod allowlist ve güvenli production hata yanıtı.
- Argon2id; 256-bit session/CSRF tokenları; HttpOnly+Secure+SameSite cookie; token/CSRF rotasyonu.
- Admin, salon ve müşteri router seviyesinde rol kontrolü; salon `venueId` ve müşteri `userId`
  izolasyonu; tüm yetkili mutasyonlarda CSRF.
- Traefik edge rate-limit + host-geneli in-flight limit; uygulama seviyesinde ek global/login/form
  limitleri ve IPv6 `/56` normalizasyonu.
- Non-root container, `cap_drop: ALL`, `no-new-privileges`, PID sınırı, log rotasyonu, internal
  PostgreSQL ağı ve digest-pinned production base image'ları.
- Healthcheck, DB timeout/dedup, fail-fast crash handling ve zaman sınırlı graceful shutdown.
- Fiyat hesabı backend otoritesinde; idempotency, unique constraint ve Serializable transaction
  kontrolleri mevcut. Güncel çalıştırılabilir DOM-XSS, kritik IDOR veya CSRF bypass bulunmadı.

## Puanlama

| Alan | Puan |
| --- | ---: |
| Kimlik, oturum ve yetki | 7,2 / 10 |
| API doğrulama ve iş kuralı bütünlüğü | 7,8 / 10 |
| Frontend güvenliği | 7,5 / 10 |
| Spam/bot koruması | 6,0 / 10 |
| Çökme/DoS dayanıklılığı | 5,5 / 10 |
| Veri, kriptografi ve gizlilik | 5,5 / 10 |
| Üretim altyapısı, CI/CD ve felaket kurtarma | 6,0 / 10 |
| Bağımlılık, sır hijyeni ve test güvencesi | 6,5 / 10 |

Genel puan basit ortalama değildir; uzaktan tetiklenebilen ödeme temizleme zinciri, temel PII'nin
düz metin olması ve tek-host felaket kurtarma açığı daha yüksek ağırlıklandırılmıştır.

## Önerilen uygulama sırası

1. **İlk 24–48 saat:** G-01 production rolü/temizlik hatasını ve G-02 public global sweep'i düzelt;
   production-role regresyon testi ekle.
2. **İlk hafta:** Admin MFA/step-up, örnek bootstrap parola reddi, paylaşımlı limiter ve bot
   challenge; Node/DB timeout ve kaynak limitleri.
3. **İlk 30 gün:** PII alan şifreleme + blind index, anahtar rotasyonu, WhatsApp PII azaltımı,
   şifreli uzak yedek/retention/restore tatbikatı ve otomatik rollback.
4. **Sürekli:** Audit/OSV kapısı, action pinleme, negatif güvenlik matrisi, yük/chaos testi,
   alarm ve periyodik erişim/yedek gözden geçirmesi.

## Doğrulama sonuçları

- `backend npm run test:quick`: build, test typecheck ve **47/47** hedefli test geçti;
  fail/skip/todo yok.
- `npm audit --omit=dev`: frontend üretim **0**, backend üretim **0** bulgu.
- `backend npm audit`: tüm bağımlılıklar **0** bulgu.
- `npm audit` (frontend dev dahil): **19 yüksek**, kritik yok.
- Sentetik sırlarla `docker compose -f compose.production.yaml config -q`: geçti.

Bu testlerin geçmesi açık bulunmadığı anlamına gelmez; özellikle production runtime rolü mevcut
entegrasyon DB sahibinden farklı olduğu için G-01 testlerden kaçmaktadır.
