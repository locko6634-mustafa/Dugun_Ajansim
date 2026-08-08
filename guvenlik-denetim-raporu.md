# Security Review: Dugun_Ajansim

## Scope

Düğün Ajansım frontend, backend, Prisma/migration, Docker/Nginx, PostgreSQL rolü ve CI/CD yüzeylerinde standart tek geçişli statik güvenlik denetimi. Genel puan: 6,5/10.

- Scan mode: repository
- Target kind: git_revision
- Target ID: target_sha256_a7258619dcfe6659a4227b12cff5bcb5b25f691a735b294a4181d45f37952495
- Revision: 1ddc965fa54df421027009340434b08a1fc80f30
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: not_executed_for_security_discovery
- Artifacts reviewed: 170 tracked dosyalık envanter, 131 source/config türü dosya, En az 62 tamamen okunmuş dosya, 5 odaklı inceleme yüzeyi ve bağımsız baseline
- Scan context: Kullanıcı rakip/düşman saldırısı ve sitenin kapatılma riskinden endişe ediyor. Puan, doğrulanmış bulgu şiddeti ile mevcut koruyucu kontroller birlikte değerlendirilerek verildi.

Limitations and exclusions:

- Static/offline; canlı DAST yapılmadı.
- Güncel harici dependency advisory verisi sorgulanmadı.
- Canlı host/Traefik/firewall/WAF/secret-store/disk/backup ayarları doğrulanmadı.
- Excluded node_modules/\*\*, backend/node_modules/\*\*, dist/\*\*, backend/dist/\*\*: Vendor/üretilmiş artifact; source review kapsamı dışı.
- Excluded binary media/font assets: Çalıştırılabilir ürün mantığı içermeyen ikili varlıklar.
- Excluded ignored secret file contents such as backend/.env: Sır içeriği okunmadı; yalnız dosya varlığı doğrulandı.
- Excluded live production runtime and external network: Canlı DAST yetkisi verilmedi; standard source review çevrimdışı yürütüldü.

### Scan Summary

| Field               | Value                           |
| ------------------- | ------------------------------- |
| Reportable findings | 13                              |
| Severity mix        | high: 1, medium: 4, low: 8      |
| Confidence mix      | high: 12, medium: 1             |
| Coverage            | partial                         |
| Validation mode     | parent static source validation |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

Düğün Ajansım anonim ziyaretçi, müşteri, salon yetkilisi, yönetici ve altyapı operatörü sınırları olan public rezervasyon/operasyon platformudur. Genel güvenlik puanı 6,5/10: kimlik, CSRF, kripto, tenant ve üretim sır kontrolleri güçlü; ancak doğrulanmamış WhatsApp handoff sinyali kullanılabilirlik ve gelir açısından yüksek öncelikli açık oluşturur.

### Assets

- Başvuru ve müşteri PII'ı
- Salon takvimi ve rezervasyon kullanılabilirliği
- Admin/salon/müşteri sessionları
- Geçici parolalar ve teslimat URL'leri
- Paket/fiyat/ödeme bütünlüğü
- PostgreSQL, yedekler ve DATA_ENCRYPTION_KEY
- Production SSH/deploy yetkisi

### Trust Boundaries

- Anonim tarayıcı -\> public API
- Cookie session + DB-bound CSRF -\> protected API
- Müşteri/SALON_YETKILISI/ADMIN rol ve record sınırları
- Traefik/Nginx -\> Express -\> internal PostgreSQL
- Runtime DB rolü -\> owner/migration rolü
- GitHub Actions -\> üçüncü taraf action/image
- Yerel dev server -\> çalışma alanı

### Attacker Capabilities

- Public endpointleri çağırma
- Dağıtık IP veya saldırgan sayfası ile trafik üretme
- Kendi Payment-Flow-Key capability'sini oluşturma
- Çalınmış role session kullanma
- Paylaşılan tabdan capability edinme
- Düşük olasılıklı upstream supply-chain compromise

### Security Objectives

- Yalnız doğrulanmış ve unexpired rezervasyonların slot bloklaması
- Rol/venue/customer sınırları
- Session/capability lifecycle revocation
- PII ve secret minimum disclosure
- Server-authoritative fiyat
- Anonim girdinin kalıcı kaynak tüketimini sınırlama
- Production artifact/deploy bütünlüğü

### Assumptions

- Static/offline current-revision incelemesi yapıldı.
- Canlı Traefik/DNS/WAF/firewall/secret-store/disk durumu kaynak koddan doğrulanamaz.
- Production dağıtım compose/Dockerfile akışını izler.
- Rakip public API'ye erişebilir; role saldırıları ilgili session compromise gerektirir.

## Findings

| Finding                                                                                                 | Severity | Confidence | Detailed write-up |
| ------------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------------- |
| [Sahte WhatsApp handoff işlemi salon saatini süresiz bloke edebiliyor](#finding-1)                      | high     | high       | inline below      |
| [Kimliksiz public başvurular kalıcı veritabanı büyümesi oluşturabiliyor](#finding-2)                    | medium   | high       | inline below      |
| [Cross-origin reddedilen trafik kurban IP'nin API kotasını tüketebiliyor](#finding-3)                   | medium   | high       | inline below      |
| [Payment-flow bearer anahtarı expiry ve terminal/arşiv durumlarından sonra geçerli kalıyor](#finding-4) | medium   | high       | inline below      |
| [Yerel statik sunucu depo kökünü tüm ağ arayüzlerine yayımlıyor](#finding-5)                            | medium   | high       | inline below      |
| [Üretim eylemi ve container tabanları değişebilir etiketlere bağlı](#finding-6)                         | low      | high       | inline below      |
| [Geçici parolanın düz metin görüntülenmesi audit kaydı oluşturmuyor](#finding-7)                        | low      | high       | inline below      |
| [Salon operasyon API'leri gerekli olmayan düğün alanlarını döndürüyor](#finding-8)                      | low      | high       | inline below      |
| [Geçersiz payment-flow GET isteği küresel expiry süpürmesini tetikleyebiliyor](#finding-9)              | low      | medium     | inline below      |
| [Üretim CSP inline script çalıştırılmasına izin veriyor](#finding-10)                                   | low      | high       | inline below      |
| [Public availability endpointi salonların kesin doluluk saatlerini açığa çıkarıyor](#finding-11)        | low      | high       | inline below      |
| [Frontend logout, sunucu revocation başarısız olsa da tamamlanmış gibi yönlendiriyor](#finding-12)      | low      | high       | inline below      |
| [Dağıtım yedekleri retention olmadan sınırsız birikebiliyor](#finding-13)                               | low      | high       | inline below      |

### Confidence Scale

| Label  | Meaning                                                                                  |
| ------ | ---------------------------------------------------------------------------------------- |
| high   | Direct evidence supports the finding with no material unresolved blocker.                |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low    | Evidence is incomplete and the item is retained only for explicit follow-up.             |

<a id="finding-1"></a>

### [1] Sahte WhatsApp handoff işlemi salon saatini süresiz bloke edebiliyor

| Field                | Value                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity             | high                                                                                                                                                                                                                   |
| Confidence           | high                                                                                                                                                                                                                   |
| Confidence rationale | Public create ve handoff rotasından expiry ve takvim çakışma sorgularına kadar kaynak akışı doğrudan doğrulandı.                                                                                                       |
| Category             | business-logic-abuse                                                                                                                                                                                                   |
| CWE                  | CWE-841                                                                                                                                                                                                                |
| Affected lines       | backend/src/services/booking.service.ts:521, backend/src/services/booking.service.ts:137, backend/src/services/booking.service.ts:742, backend/src/routes/public.routes.ts:210, js/package-builder/application.js:1445 |

#### Summary

Kimliksiz bir saldırgan kendi public başvurusunda istemci kontrollü WhatsApp handoff sinyalini tetikleyerek ödeme/dekont doğrulanmadan salon slotunu süresiz rezerve edebilir.

#### Root Cause

İstemci tarafından üretilebilen whatsappHandoffAt telemetrisi, sunucu tarafından doğrulanmış ödeme olmadan geçici tutmayı süresiz aktif rezervasyona yükseltiyor; expiry seçimi handoff yapılmış kayıtları hariç tutuyor.

**Handoff kayıtları süpürülmüyor** — `backend/src/services/booking.service.ts:516`

whatsappHandoffAt dolu kayıtlar mutlak TTL geçmiş olsa bile expiry dışındadır.

```typescript
where: { source: "PUBLIC_FORM", status: "ONAY_BEKLIYOR", deletedAt: null, whatsappHandoffAt: null, paymentFlowExpiredAt: null, paymentFlowExpiresAt: { lte: now } }
```

**Handoff TTL'den bağımsız çakışma sayılıyor** — `backend/src/services/booking.service.ts:132`

Handoff işareti rezervasyonu süresiz aktif kabul eder.

```typescript
OR: [
  { status: "ONAYLANDI" },
  { whatsappHandoffAt: { not: null } },
  { paymentFlowExpiresAt: null },
  { paymentFlowExpiresAt: { gt: new Date() } }
];
```

#### Validation

markWhatsappHandoff yalnız bearer anahtarını, pending durumu ve mevcut TTL'yi kontrol edip whatsappHandoffAt yazar. expireStalePaymentFlows whatsappHandoffAt dolu kayıtları dışlar; takvim sorguları bu kayıtları TTL'den bağımsız çakışma sayar.

**Handoff kayıtları süpürülmüyor** — `backend/src/services/booking.service.ts:516`

whatsappHandoffAt dolu kayıtlar mutlak TTL geçmiş olsa bile expiry dışındadır.

```typescript
where: { source: "PUBLIC_FORM", status: "ONAY_BEKLIYOR", deletedAt: null, whatsappHandoffAt: null, paymentFlowExpiredAt: null, paymentFlowExpiresAt: { lte: now } }
```

**Handoff TTL'den bağımsız çakışma sayılıyor** — `backend/src/services/booking.service.ts:132`

Handoff işareti rezervasyonu süresiz aktif kabul eder.

```typescript
OR: [
  { status: "ONAYLANDI" },
  { whatsappHandoffAt: { not: null } },
  { paymentFlowExpiresAt: null },
  { paymentFlowExpiresAt: { gt: new Date() } }
];
```

#### Dataflow

Public katalogdan geçerli kimlikleri al -\> sahte başvuru oluştur -\> kendi Payment-Flow-Key ile handoff çağır -\> whatsappHandoffAt yazılır -\> expiry kaydı atlar -\> takvim slotu süresiz dolu sayar.

#### Reachability

Kimlik doğrulama gerekmez; iki geçerli public API çağrısı yeterlidir. Hız IP başına sınırlı olsa da etki yönetici müdahalesine kadar kalıcıdır.

#### Severity

**High** — Anonim, düşük maliyetli ve tekrarlanabilir saldırı doğrudan rezervasyon kullanılabilirliğini ve geliri etkiler; IP limitleri hızı azaltır ancak rezervasyon ömrünü sınırlamaz.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Tüm public rezervasyonlara handoff'tan bağımsız mutlak reservationExpiresAt üst sınırı uygulayın. whatsappHandoffAt değerini yalnız telemetri sayın; kalıcı blokajı ödeme webhook'u, doğrulanmış dekont/personel claim'i veya yönetici onayıyla başlatın. Takvim sorgularını yalnız onaylı kayıtlar ve süresi dolmamış tutmalarla sınırlandırın.

Tests:

- Handoff yapılmış public rezervasyon mutlak TTL sonunda takvimden çıkmalıdır.
- Ödeme doğrulaması olmadan handoff kalıcı rezervasyon oluşturmamalıdır.

Preventive controls:

- Sunucu doğrulamalı ödeme/dekont olayı
- Mutlak rezervasyon TTL'si
- Kişi/cihaz/slot abuse limiti

<a id="finding-2"></a>

### [2] Kimliksiz public başvurular kalıcı veritabanı büyümesi oluşturabiliyor

| Field                | Value                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity             | medium                                                                                                                                                                                                                  |
| Confidence           | high                                                                                                                                                                                                                    |
| Confidence rationale | Create/update, expiry, admin venue delete ve şema ilişkileri kaynakta doğrulandı.                                                                                                                                       |
| Category             | resource-exhaustion                                                                                                                                                                                                     |
| CWE                  | CWE-400, CWE-770                                                                                                                                                                                                        |
| Affected lines       | backend/src/services/booking.service.ts:261, backend/src/services/booking.service.ts:341, backend/src/routes/public.routes.ts:159, backend/src/services/booking.service.ts:540, backend/src/routes/admin.routes.ts:2146 |

#### Summary

İsteğe bağlı idempotency ve public custom-venue oluşturma, anonim saldırganın kalıcı Venue, BookingApplication, ilişki ve AuditLog kayıtlarını yaşam döngüsü temizliği olmadan biriktirmesine izin veriyor.

#### Root Cause

Doğrulanmamış customVenueName global aktif Venue satırına dönüştürülüyor; idempotency zorunlu değil ve expiry silme/anonimleştirme yerine status ile audit ekliyor.

**Anonim isimden global venue** — `backend/src/services/booking.service.ts:261`

Public girdi kalıcı global Venue üretir.

```typescript
transaction.venue.create({
  data: {
    name: customVenueName!,
    slug: `musteri-salonu-${randomReferenceCode().toLowerCase()}`,
    isPartner: false
  }
});
```

**Expiry silmiyor** — `backend/src/services/booking.service.ts:540`

Yaşam döngüsü depolama ayak izini geri kazanmaz.

```typescript
data: { status: "IPTAL_EDILDI", paymentFlowExpiredAt: now }
```

#### Validation

Her benzersiz customVenueName aktif Venue oluşturabilir; aynı akış application, service ve audit kayıtları üretir. Expiry yalnız IPTAL_EDILDI yapar; referanslı venue silinmez.

**Anonim isimden global venue** — `backend/src/services/booking.service.ts:261`

Public girdi kalıcı global Venue üretir.

```typescript
transaction.venue.create({
  data: {
    name: customVenueName!,
    slug: `musteri-salonu-${randomReferenceCode().toLowerCase()}`,
    isPartner: false
  }
});
```

**Expiry silmiyor** — `backend/src/services/booking.service.ts:540`

Yaşam döngüsü depolama ayak izini geri kazanmaz.

```typescript
data: { status: "IPTAL_EDILDI", paymentFlowExpiredAt: now }
```

#### Dataflow

Benzersiz customVenueName -\> Venue.create -\> BookingApplication + services + AuditLog -\> expiry yalnız status/audit -\> FK nedeniyle venue yalnız pasifleşir.

#### Reachability

IP başına hız sınırı toplam kalıcı kayıt sayısını veya saklama süresini sınırlamaz.

#### Severity

**Medium** — İstek başı boyut ve IP hızı sınırlı olsa da etki kalıcıdır, dağıtık kaynaklarla büyütülebilir ve iptal kayıtları mevcut akışla tam temizlenemez.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Özel salon adını başvuruya scope edilmiş alan/modelde tutun. CAPTCHA ve e-posta/SMS doğrulaması, kişi/cihaz kotaları ve zorunlu idempotency uygulayın. Expired doğrulanmamış kayıtları anonimleştiren/silen retention ve orphan venue temizliği ekleyin.

Tests:

- Doğrulanmamış custom venue challenge/kota ile reddedilmelidir.
- Retention expired ilişkileri ve orphan venue kayıtlarını temizlemelidir.

Preventive controls:

- İletişim doğrulaması
- Kalıcı abuse kotası
- Retention/anonymization

<a id="finding-3"></a>

### [3] Cross-origin reddedilen trafik kurban IP'nin API kotasını tüketebiliyor

| Field                | Value                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Severity             | medium                                                                                                                                  |
| Confidence           | high                                                                                                                                    |
| Confidence rationale | Middleware sırası ve disallowed Origin isteklerinin 101. istekte 429 aldığı repository testi doğrulandı.                                |
| Category             | denial-of-service                                                                                                                       |
| CWE                  | CWE-400                                                                                                                                 |
| Affected lines       | backend/src/middlewares/security.middleware.ts:56, backend/src/middlewares/security.middleware.ts:60, backend/tests/backend.test.ts:942 |

#### Summary

Global IP limiti CORS kontrolünden önce çalıştığı için saldırgan sayfası kurban tarayıcısından reddedilecek istekler göndererek aynı IP/NAT üzerindeki meşru API erişimini 15 dakika engelleyebilir.

#### Root Cause

Reddedilecek browser cross-origin istekleri origin/fetch-metadata politikası uygulanmadan ortak global IP bucket'ına yazılıyor.

**Limiter CORS'tan önce** — `backend/src/middlewares/security.middleware.ts:56`

Reddedilecek cross-origin trafik önce kota tüketir.

```typescript
app.use('/api', globalLimiter); ... app.use(cors({ ... }));
```

**Davranış testi** — `backend/tests/backend.test.ts:942`

Repository testi mekanizmayı doğrular.

```typescript
test('genel rate limiter CORS tarafından reddedilen 101. API isteğini de engeller', async () => { ... assert.equal(response?.status, 429); });
```

#### Validation

globalLimiter /api altında CORS'tan önce monte edilir. Repository testi 101 disallowed-Origin isteğinin 429 ürettiğini gösterir.

**Limiter CORS'tan önce** — `backend/src/middlewares/security.middleware.ts:56`

Reddedilecek cross-origin trafik önce kota tüketir.

```typescript
app.use('/api', globalLimiter); ... app.use(cors({ ... }));
```

**Davranış testi** — `backend/tests/backend.test.ts:942`

Repository testi mekanizmayı doğrular.

```typescript
test('genel rate limiter CORS tarafından reddedilen 101. API isteğini de engeller', async () => { ... assert.equal(response?.status, 429); });
```

#### Dataflow

Cross-origin istek -\> IP bucket artar -\> CORS sonra 403 verir -\> 100 istek sonrası limiter önce 429 döndürür -\> meşru istekler route'a ulaşamaz.

#### Reachability

CORS yanıtı okumayı engeller, isteği göndermeyi değil. Etki 15 dakikalık pencere ve IP/NAT kapsamındadır.

#### Severity

**Medium** — Saldırı kimlik doğrulamasız ve tarayıcıdan tekrarlanabilir; etki IP/IPv6 /56 veya ortak NAT ile sınırlı olsa da login, logout ve panelleri keser.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Strict Origin ve Fetch Metadata kontrollerini uygulama kotasından önce çalıştırın. Edge volumetrik limiti ayrı tutun; public/login/authenticated bucket'larını ayırın ve authenticated trafiği IP yanında session/user ile anahtarlayın.

Tests:

- Disallowed-Origin istekleri authenticated kotasını tüketmemelidir.
- Logout/public/authenticated bucket'ları bağımsız sınanmalıdır.

Preventive controls:

- CORS öncesi Fetch Metadata/Origin reddi
- Ayrı quota bucket'ları
- Edge rate limiting

<a id="finding-4"></a>

### [4] Payment-flow bearer anahtarı expiry ve terminal/arşiv durumlarından sonra geçerli kalıyor

| Field                | Value                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity             | medium                                                                                                                                                                                                                                                           |
| Confidence           | high                                                                                                                                                                                                                                                             |
| Confidence rationale | assertPaymentFlowAccess, get/update/handoff ve admin terminal yazımları doğrulandı; token hashini temizleyen geçiş bulunmadı.                                                                                                                                    |
| Category             | session-and-capability-lifecycle                                                                                                                                                                                                                                 |
| CWE                  | CWE-613, CWE-863                                                                                                                                                                                                                                                 |
| Affected lines       | backend/src/services/booking.service.ts:460, backend/src/services/booking.service.ts:563, backend/src/services/booking.service.ts:599, backend/src/services/booking.service.ts:725, backend/src/routes/admin.routes.ts:295, js/package-builder/application.js:68 |

#### Summary

Ödeme akışı erişim kontrolü yalnız source ve token hashini doğruluyor; handoff, onay, ret ve arşiv anahtarı iptal etmiyor, böylece ele geçirilmiş capability PII okumayı sürdürür ve arşivli pending kayıtlar mutasyona açık kalabilir.

#### Root Cause

Bearer capability süre, deletedAt ve izin verilen lifecycle state ile bağlı değil; terminal/geçiş işlemleri paymentFlowTokenHash'i iptal etmiyor.

**Erişim yalnız source/hash** — `backend/src/services/booking.service.ts:460`

Süre veya lifecycle state kontrol edilmez.

```typescript
if (
  application.source !== "PUBLIC_FORM" ||
  !application.paymentFlowTokenHash ||
  !tokenHashesMatch(paymentFlowKey, application.paymentFlowTokenHash)
) {
  throw new AppError("Ödeme akışı bulunamadı.", 404);
}
```

**Capability geniş PII döndürüyor** — `backend/src/services/booking.service.ts:473`

Ele geçirilen capability geniş müşteri verisine erişir.

```typescript
return { id, referenceCode, status, brideFirstName, brideLastName, bridePhone, groomFirstName, groomLastName, groomPhone, primaryEmail, ... }
```

#### Validation

assertPaymentFlowAccess yalnız PUBLIC_FORM ve hash eşleşmesini kontrol eder. GET geniş PII döndürür; update/handoff deletedAt filtresi kullanmaz; admin geçişleri tokenı temizlemez.

**Erişim yalnız source/hash** — `backend/src/services/booking.service.ts:460`

Süre veya lifecycle state kontrol edilmez.

```typescript
if (
  application.source !== "PUBLIC_FORM" ||
  !application.paymentFlowTokenHash ||
  !tokenHashesMatch(paymentFlowKey, application.paymentFlowTokenHash)
) {
  throw new AppError("Ödeme akışı bulunamadı.", 404);
}
```

**Capability geniş PII döndürüyor** — `backend/src/services/booking.service.ts:473`

Ele geçirilen capability geniş müşteri verisine erişir.

```typescript
return { id, referenceCode, status, brideFirstName, brideLastName, bridePhone, groomFirstName, groomLastName, groomPhone, primaryEmail, ... }
```

#### Dataflow

Capability ortak tab/sessionStorage'dan alınır -\> header ile replay -\> hash kontrolü geçer -\> expiry/terminal/deleted state dikkate alınmadan PII veya archived pending mutasyonu gerçekleşir.

#### Reachability

Brute force gerçekçi değildir; capability çiftinin ele geçirilmesi gerekir. Ele geçirildiğinde server-side lifecycle revocation yoktur.

#### Severity

**Medium** — Anahtar yüksek entropili ve ele geçirilmesi gerekir; paylaşılan/açık tab veya sessionStorage maruziyetinde kapsamlı PII'ya lifecycle sonrasında da erişim verir.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Get/update/handoff sorgularını deletedAt:null, status allowlist'i ve mutlak read/write expiry ile sınırlandırın. Handoff, onay, ret, arşiv ve expiry sırasında token hashini aynı transactionda null yapın/rotate edin; post-handoff yalnız minimal status capability kullanın.

Tests:

- Handoff/onay/ret/arşiv/expiry sonrası eski token 404/410 vermelidir.
- Arşivli pending kayıt bearer ile değiştirilememelidir.

Preventive controls:

- State-bound capability
- Terminal token revocation
- Minimal post-handoff DTO

<a id="finding-5"></a>

### [5] Yerel statik sunucu depo kökünü tüm ağ arayüzlerine yayımlıyor

| Field                | Value                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity             | medium                                                                                                                                        |
| Confidence           | high                                                                                                                                          |
| Confidence rationale | Sunucu kökü, dosya akışı, bind adresi ve başlatıcı kaynakta doğrulandı; backend/.env ile .git/config varlığı içerikleri okunmadan doğrulandı. |
| Category             | sensitive-file-exposure                                                                                                                       |
| CWE                  | CWE-552                                                                                                                                       |
| Affected lines       | tools/serve.mjs:8, tools/serve.mjs:48, tools/serve.mjs:52, sunucu_baslat.ps1:17, sunucu_baslat.ps1:25                                         |

#### Summary

Geliştirme sunucusu depo kökünü 0.0.0.0 üzerinde servis ederek çalıştığı sırada backend/.env, .git ve özel kaynak dosyalarını LAN veya yönlendirilmiş port üzerinden okunabilir kılabilir.

#### Root Cause

Statik kök yayımlanabilir public dizini yerine tüm depo; allowlist yok ve sunucu loopback yerine 0.0.0.0'a bağlanıyor.

**Depo kökü web kökü** — `tools/serve.mjs:8`

Statik kök tüm repository'dir.

```javascript
const rootDir = path.resolve(__dirname, "..");
```

**Ağdan genel dosya akışı** — `tools/serve.mjs:48`

Dosya allowlist'i yoktur ve tüm arayüzlere bağlanır.

```javascript
fs.createReadStream(filePath).pipe(res); ... server.listen(port, "0.0.0.0", () => {
```

#### Validation

tools/serve.mjs herhangi bir dosyayı rootDir altından stream eder ve 0.0.0.0 üzerinde dinler. sunucu_baslat.ps1 bu yolu kalıcı başlatır; üretim image'ı yalnız frontend allowlist'ini kopyalar.

**Depo kökü web kökü** — `tools/serve.mjs:8`

Statik kök tüm repository'dir.

```javascript
const rootDir = path.resolve(__dirname, "..");
```

**Ağdan genel dosya akışı** — `tools/serve.mjs:48`

Dosya allowlist'i yoktur ve tüm arayüzlere bağlanır.

```javascript
fs.createReadStream(filePath).pipe(res); ... server.listen(port, "0.0.0.0", () => {
```

#### Dataflow

İstek yolu depo köküyle birleşir -\> fs.stat dosyayı kabul eder -\> fs.createReadStream içeriği HTTP yanıtına taşır.

#### Reachability

Yalnız geliştirme sunucusu çalışırken ve saldırgan porta erişebildiğinde geçerlidir; production Nginx etkilenmez.

#### Severity

**Medium** — Sır ve kaynak kod sızıntısının etkisi yüksek olsa da yol üretim Nginx'ini değil, geliştirme makinesinde açıkça başlatılan yerel sunucuyu etkiler.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Yalnız yayımlanabilir frontend içeren ayrı public/build kökü kullanın, realpath containment doğrulayın, dotfile/backend/deploy/env yollarını reddedin ve varsayılan bind adresini 127.0.0.1 yapın. Python fallback'i aynı kurallarla sınırlandırın.

Tests:

- /backend/.env ve /.git/config 403/404 dönmelidir.
- Varsayılan dinleme adresi 127.0.0.1 olmalıdır.

Preventive controls:

- Ayrı public kökü
- Gerçek yol containment
- Loopback varsayılanı

<a id="finding-6"></a>

### [6] Üretim eylemi ve container tabanları değişebilir etiketlere bağlı

| Field                | Value                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Severity             | low                                                                                             |
| Confidence           | high                                                                                            |
| Confidence rationale | Action/image referansları ve bunlara verilen SSH/DB/encryption secret yetkileri doğrulandı.     |
| Category             | supply-chain-integrity                                                                          |
| CWE                  | CWE-494                                                                                         |
| Affected lines       | .github/workflows/deploy.yml:35, Dockerfile:1, backend/Dockerfile:1, compose.production.yaml:11 |

#### Summary

SSH deploy action ve Node/Nginx/Postgres tabanları tam commit/digest yerine etiketle seçildiği için upstream etiket ele geçirilmesi sonraki deployda üretim sırları ve sunucu yetkisine ulaşabilir.

#### Root Cause

Üçüncü taraf çalıştırılabilir artifact referansları içerik adresli commit SHA/image digest ile sabitlenmemiş.

**SSH action tag ile seçiliyor** — `.github/workflows/deploy.yml:35`

Tam commit SHA pin'i yoktur.

```yaml
uses: appleboy/ssh-action@v1.0.3
```

**Taban image tagi** — `backend/Dockerfile:1`

İçerik digest ile sabit değildir.

```text
FROM node:22-bookworm-slim AS dependencies
```

#### Validation

Workflow appleboy/ssh-action@v1.0.3 kullanıp SSH key verir. Docker/compose node:22-bookworm-slim, nginx:stable-alpine ve postgres:17-alpine'i digest olmadan kullanır.

**SSH action tag ile seçiliyor** — `.github/workflows/deploy.yml:35`

Tam commit SHA pin'i yoktur.

```yaml
uses: appleboy/ssh-action@v1.0.3
```

**Taban image tagi** — `backend/Dockerfile:1`

İçerik digest ile sabit değildir.

```text
FROM node:22-bookworm-slim AS dependencies
```

#### Dataflow

Mutable tag başka içeriğe taşınır -\> deploy indirir/çalıştırır -\> action SSH key'i veya image DB/encryption sırlarını görür -\> kompromis.

#### Reachability

Repository değişikliği gerekmez; upstream compromise ve yeni deploy gerekir.

#### Severity

**Low** — Etki tam production kompromisidir; ancak güvenilen upstream/registry yayın zincirinin ele geçirilmesi gibi düşük olasılıklı önkoşula bağlıdır.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

appleboy action'ı incelenmiş tam commit SHA'sına; Node/Nginx/Postgres image'larını doğrulanmış sha256 digestlerine sabitleyin. Güncellemeleri kontrollü PR'larla yapın ve deploy hesabını daraltın.

Tests:

- Action referansları tam SHA olmalıdır.
- Production image referansları @sha256 digest içermelidir.

Preventive controls:

- Commit SHA pinning
- OCI digest pinning
- Dar deploy hesabı

<a id="finding-7"></a>

### [7] Geçici parolanın düz metin görüntülenmesi audit kaydı oluşturmuyor

| Field                | Value                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity             | low                                                                                                                                                                |
| Confidence           | high                                                                                                                                                               |
| Confidence rationale | Liste, decrypt, render response ve komşu mark-sent/reset audit akışları karşılaştırıldı.                                                                           |
| Category             | insufficient-logging                                                                                                                                               |
| CWE                  | CWE-778                                                                                                                                                            |
| Affected lines       | backend/src/routes/admin.routes.ts:2279, backend/src/routes/admin.routes.ts:2226, backend/src/routes/admin.routes.ts:2241, backend/src/routes/admin.routes.ts:2183 |

#### Summary

ADMIN message-task render endpointi şifreli aktivasyon/reset parolasını çözüp yanıtta döndürürken hangi adminin credential'ı görüntülediğini AuditLog'a yazmıyor ve tek-görüntüleme uygulamıyor.

#### Root Cause

Credential render read işlemi güvenlik olayı olarak modellenmemiş; plaintext response sonrasında append-only audit/one-time view state'i yok.

**Geçici parola çözülüyor** — `backend/src/routes/admin.routes.ts:2226`

Secret plaintext'e dönüşür.

```typescript
const password = decryptValue({ ciphertext: task.secretCiphertext, iv: task.secretIv, authTag: task.secretAuthTag }, ...);
```

**Plaintext response audit olmadan** — `backend/src/routes/admin.routes.ts:2279`

Route içinde createAudit yoktur.

```typescript
router.get("/message-tasks/:id/render", ... res.json({ success: true, data: { message: rendered.message, ... } }));
```

#### Validation

renderMessage ACCOUNT_ACTIVATION/PASSWORD_RESET secretini decryptValue ile çözüp GET response message alanında döndürür. Endpoint createAudit çağırmaz; mark-sent ve reset audit yazar.

**Geçici parola çözülüyor** — `backend/src/routes/admin.routes.ts:2226`

Secret plaintext'e dönüşür.

```typescript
const password = decryptValue({ ciphertext: task.secretCiphertext, iv: task.secretIv, authTag: task.secretAuthTag }, ...);
```

**Plaintext response audit olmadan** — `backend/src/routes/admin.routes.ts:2279`

Route içinde createAudit yoktur.

```typescript
router.get("/message-tasks/:id/render", ... res.json({ success: true, data: { message: rendered.message, ... } }));
```

#### Dataflow

Task listesi -\> ID -\> render -\> encrypted secret decrypt -\> plaintext JSON -\> audit olmadan tekrarlı görüntüleme.

#### Reachability

ADMIN rolü gerekir; credential görüntüleme işlevin parçasıdır fakat hesap verebilirlik eksiktir.

#### Severity

**Low** — Endpoint güçlü admin session/role ve no-store ile korunur; risk kötü niyetli/ele geçirilmiş adminin credential erişiminde hesap verebilirlik eksikliğidir.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Credential görüntülemeyi ayrı POST ve mümkünse step-up doğrulamalı yetkiye taşıyın. Başarılı/başarısız görüntülemede actorUserId, taskId, weddingId, kind içeren ama secret içermeyen audit yazın; uygun ise tek-görüntüleme kullanın.

Tests:

- Credential render denemeleri secret içermeyen AuditLog üretmelidir.
- Tek-görüntüleme seçilirse ikinci render reddedilmelidir.

Preventive controls:

- Credential access audit
- Step-up auth
- One-time view

<a id="finding-8"></a>

### [8] Salon operasyon API'leri gerekli olmayan düğün alanlarını döndürüyor

| Field                | Value                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity             | low                                                                                                                                                                                                                 |
| Confidence           | high                                                                                                                                                                                                                |
| Confidence rationale | Include şekli, JSON dönüşleri, Prisma modeli ve frontend kullanımı karşılaştırıldı.                                                                                                                                 |
| Category             | sensitive-data-exposure                                                                                                                                                                                             |
| CWE                  | CWE-201                                                                                                                                                                                                             |
| Affected lines       | backend/src/routes/operations.routes.ts:66, backend/src/routes/operations.routes.ts:153, backend/src/routes/operations.routes.ts:317, backend/src/routes/operations.routes.ts:332, backend/prisma/schema.prisma:268 |

#### Summary

Prisma include Wedding modelinin tüm scalar alanlarını döndürerek salon yetkilisine operasyon için gereksiz primaryEmail, applicationId, customerUserId ve fiyat snapshotlarını açıyor.

#### Root Cause

Özet/liste/detay için explicit select/DTO yerine relation include kullanılıyor ve tüm Wedding scalarları doğrudan yanıta gidiyor.

**Scalarlar daraltılmıyor** — `backend/src/routes/operations.routes.ts:66`

Prisma include tüm Wedding scalarlarını korur.

```typescript
const weddingIncludeForVenue = (venueId: string) => ({ venue: { select: { id: true, name: true } }, assignments: { ... } }) satisfies Prisma.WeddingInclude;
```

**Geniş nesne doğrudan dönüyor** — `backend/src/routes/operations.routes.ts:153`

Minimum DTO uygulanmaz.

```typescript
res.json({ success: true, data: { ... todayWeddings, weekWeddings, ... }, correlationId: req.correlationId });
```

#### Validation

weddingIncludeForVenue relationları tanımlar, scalar select kullanmaz. Dashboard/list/detail geniş nesneyi JSON'a koyar; model gereksiz e-posta/iç ID/packageSummary alanlarını içerir.

**Scalarlar daraltılmıyor** — `backend/src/routes/operations.routes.ts:66`

Prisma include tüm Wedding scalarlarını korur.

```typescript
const weddingIncludeForVenue = (venueId: string) => ({ venue: { select: { id: true, name: true } }, assignments: { ... } }) satisfies Prisma.WeddingInclude;
```

**Geniş nesne doğrudan dönüyor** — `backend/src/routes/operations.routes.ts:153`

Minimum DTO uygulanmaz.

```typescript
res.json({ success: true, data: { ... todayWeddings, weekWeddings, ... }, correlationId: req.correlationId });
```

#### Dataflow

Venue sorgusu -\> Prisma tüm scalarlar -\> DTO daraltması yok -\> e-posta/iç kimlik/fiyat toplanır.

#### Reachability

Role ve venue sınırı etkilidir; yalnız kendi salon verisi görünür.

#### Severity

**Low** — Erişim aynı venue ile doğru sınırlandırılmıştır; risk ele geçirilmiş salon hesabında ihlal kapsamını büyütür ve cross-venue erişim sağlamaz.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Endpoint-specific explicit Prisma select/DTO tanımlayın. primaryEmail, applicationId, customerUserId ve fiyat dökümünü gereksinim yoksa çıkarın; negatif response-contract testleri ekleyin.

Tests:

- Operations response'larında gereksiz e-posta/iç ID/fiyat alanları bulunmamalıdır.

Preventive controls:

- Explicit Prisma select
- Endpoint DTO
- Negatif contract testi

<a id="finding-9"></a>

### [9] Geçersiz payment-flow GET isteği küresel expiry süpürmesini tetikleyebiliyor

| Field                | Value                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity             | low                                                                                                                                                            |
| Confidence           | medium                                                                                                                                                         |
| Confidence rationale | Pahalı işin doğrulamadan önce çağrıldığı kesin; gerçek lock/latency etkisinin büyüklüğü runtime backlog ve DB kapasitesine bağlı.                              |
| Category             | resource-exhaustion                                                                                                                                            |
| CWE                  | CWE-400                                                                                                                                                        |
| Affected lines       | backend/src/services/booking.service.ts:563, backend/src/services/booking.service.ts:516, backend/src/routes/public.routes.ts:180, backend/src/bootstrap.ts:22 |

#### Summary

Kimliksiz GET, application ve bearer doğrulanmadan önce 100 kayda kadar global expiry transaction'ı çalıştırarak backlog ve eşzamanlılık koşullarında veritabanı işini büyütebilir.

#### Root Cause

Küresel bakım işi anonim lookup request yolunda target ve capability doğrulanmadan çalıştırılıyor; request kaynaklı çağrılar tekilleştirilmiyor.

**Süpürme lookup'tan önce** — `backend/src/services/booking.service.ts:563`

Geçersiz bearer bile global işi tetikler.

```typescript
await expireStalePaymentFlows(new Date(), correlationId); const application = await prisma.bookingApplication.findUnique(...); assertPaymentFlowAccess(application, paymentFlowKey);
```

**100 kayıtlık transaction** — `backend/src/services/booking.service.ts:516`

Tek request çoklu DB mutasyonu tetikleyebilir.

```typescript
const expiredCandidates = await transaction.bookingApplication.findMany({ ... take: 100 }); for (const candidate of expiredCandidates) { ... }
```

#### Validation

getPaymentFlowApplication ilk olarak expireStalePaymentFlows çağırır; bu fonksiyon 100 global aday seçip her biri için updateMany/audit yapabilir. Background worker zaten 60 saniyede bir aynı işi yapar.

**Süpürme lookup'tan önce** — `backend/src/services/booking.service.ts:563`

Geçersiz bearer bile global işi tetikler.

```typescript
await expireStalePaymentFlows(new Date(), correlationId); const application = await prisma.bookingApplication.findUnique(...); assertPaymentFlowAccess(application, paymentFlowKey);
```

**100 kayıtlık transaction** — `backend/src/services/booking.service.ts:516`

Tek request çoklu DB mutasyonu tetikleyebilir.

```typescript
const expiredCandidates = await transaction.bookingApplication.findMany({ ... take: 100 }); for (const candidate of expiredCandidates) { ... }
```

#### Dataflow

Request -\> global sweep -\> target lookup/bearer kontrolü -\> 404.

#### Reachability

Her istek global limiter altındadır; anlamlı etki için expired backlog ve eşzamanlı çağrılar gerekir.

#### Severity

**Low** — Etki expiry backlog ve eşzamanlı istek önkoşullarına bağlıdır; global IP limiti, take:100 ve koşullu claimler amplifikasyonu sınırlar.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Global sweep'i yalnız background worker'a taşıyın. Lazy expiry gerekiyorsa doğru bearer sonrası yalnız hedef ID'de koşullu update yapın. Worker'da concurrency/timeout ve SKIP LOCKED benzeri claim, GET'te dar limit kullanın.

Tests:

- Yanlış bearer/UUID global sweep çağırmamalıdır.
- Eşzamanlı sweep tek worker/güvenli claim ile çalışmalıdır.

Preventive controls:

- Background-only maintenance
- Target-local expiry
- Concurrency sınırı

<a id="finding-10"></a>

### [10] Üretim CSP inline script çalıştırılmasına izin veriyor

| Field                | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Severity             | low                                                                                            |
| Confidence           | high                                                                                           |
| Confidence rationale | Nginx header varyantları ve inline bootstrap/onload ihtiyacı doğrulandı.                       |
| Category             | security-misconfiguration                                                                      |
| CWE                  | CWE-693                                                                                        |
| Affected lines       | deploy/nginx.conf:15, deploy/nginx.conf:33, deploy/nginx.conf:43, index.html:49, index.html:60 |

#### Summary

script-src 'unsafe-inline' inline event handler ve scriptleri çalıştırabildiği için mevcut veya gelecekteki markup injection kusurlarında CSP bağımsız containment sağlamıyor.

#### Root Cause

Inline tema/font kodu dış dosyaya taşınmadığı için production script-src unsafe-inline ile genişletilmiş.

**Production CSP gevşek** — `deploy/nginx.conf:15`

Inline script/event handler çalışabilir.

```text
script-src 'self' 'unsafe-inline';
```

**Inline kod mevcut** — `index.html:60`

Inline bootstrap gevşekliğin gerekçesidir.

```text
<script>document.documentElement.classList.add("js");</script>
```

#### Validation

Nginx üç response konumunda script-src 'self' 'unsafe-inline' döndürür; index.html inline onload/script içerir.

**Production CSP gevşek** — `deploy/nginx.conf:15`

Inline script/event handler çalışabilir.

```text
script-src 'self' 'unsafe-inline';
```

**Inline kod mevcut** — `index.html:60`

Inline bootstrap gevşekliğin gerekçesidir.

```text
<script>document.documentElement.classList.add("js");</script>
```

#### Dataflow

Markup injection -\> inline event handler/script -\> CSP izin verir -\> origin'de kod.

#### Reachability

Ek bir markup injection kusuru gerekir.

#### Severity

**Low** — Ordinary public inputtan doğrulanmış XSS zinciri bulunmadı; doğrudan kompromisten çok savunma derinliği kaybıdır.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Inline bootstrap ve onload handler'ı same-origin modüle taşıyın veya nonce/hash kullanın. script-src içinden unsafe-inline'ı kaldırın; style-src geçişini ayrı yönetin.

Tests:

- Production CSP script-src unsafe-inline içermemelidir.

Preventive controls:

- External modules
- Nonce/hash CSP
- CSP regression testi

<a id="finding-11"></a>

### [11] Public availability endpointi salonların kesin doluluk saatlerini açığa çıkarıyor

| Field                | Value                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Severity             | low                                                                                                                            |
| Confidence           | high                                                                                                                           |
| Confidence rationale | Public venue/availability rotaları ve exact occupiedSlots dönüşü doğrulandı.                                                   |
| Category             | information-exposure                                                                                                           |
| CWE                  | CWE-200                                                                                                                        |
| Affected lines       | backend/src/routes/public.routes.ts:137, backend/src/services/booking.service.ts:1041, backend/src/routes/public.routes.ts:116 |

#### Summary

Anonim rakip, public venue UUID'leriyle tarih tarih sorgulayarak düğün ve aktif başvuruların dakika hassasiyetindeki başlangıç/bitiş slotlarını haritalayabilir.

#### Root Cause

Public uygunluk cevabı minimum available/unavailable yerine exact start/end slotları ve sınırsız tarih ufku döndürüyor.

**Anonim route** — `backend/src/routes/public.routes.ts:137`

Auth gerektirmez.

```typescript
router.get("/venues/:venueId/availability", validateRequest(availabilitySchema), ...);
```

**Kesin saatler** — `backend/src/services/booking.service.ts:1082`

Başlangıç/bitiş dakikası açılır.

```typescript
slotsMap.set(`${s}-${e}`, { startTime: s, endTime: e });
```

#### Validation

Public /venues UUID'leri verir; availability yalnız UUID/tarih doğrular; servis Wedding ve BookingApplication aralıklarını startTime/endTime döndürür.

**Anonim route** — `backend/src/routes/public.routes.ts:137`

Auth gerektirmez.

```typescript
router.get("/venues/:venueId/availability", validateRequest(availabilitySchema), ...);
```

**Kesin saatler** — `backend/src/services/booking.service.ts:1082`

Başlangıç/bitiş dakikası açılır.

```typescript
slotsMap.set(`${s}-${e}`, { startTime: s, endTime: e });
```

#### Dataflow

Venue UUID listesi -\> tarihler üzerinde sorgu -\> gerçek/aktif aralıklar -\> exact occupiedSlots -\> rakip takvim haritası.

#### Reachability

Auth yoktur; IP limiti uzun süreli/dağıtık scraping'i tamamen engellemez.

#### Severity

**Low** — Yanıt PII içermez ve rezervasyon UX'i için işlevseldir; ancak rakip için operasyon istihbaratı ve abuse hedefleme sağlar.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Public yanıtta yalnız available/unavailable veya kaba zaman dilimleri kullanın; tarih ufkunu sınırlandırın. Ayrıntılı takvimi yetkili panellere bırakın ve scraping algılama/kota ekleyin.

Tests:

- Public endpoint minimum detay ve izinli tarih ufku döndürmelidir.

Preventive controls:

- Coarse availability
- Tarih ufku
- Scraping tespiti

<a id="finding-12"></a>

### [12] Frontend logout, sunucu revocation başarısız olsa da tamamlanmış gibi yönlendiriyor

| Field                | Value                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity             | low                                                                                                                                               |
| Confidence           | high                                                                                                                                              |
| Confidence rationale | Dört frontend handler ve backend revocation başarı yolu doğrulandı.                                                                               |
| Category             | session-lifecycle                                                                                                                                 |
| CWE                  | CWE-613                                                                                                                                           |
| Affected lines       | js/shared/auth-session.js:18, js/admin/app.js:2132, js/customer-panel/app.js:108, js/operations/app.js:502, backend/src/routes/auth.routes.ts:303 |

#### Summary

Admin, müşteri, operasyon ve ortak header logout işlemleri 403/429/5xx veya ağ hatasında da login/index sayfasına gider; HttpOnly cookie ve server session geçerli kalabilir.

#### Root Cause

İstemci logout başarısını server revocation sonucundan ayırıyor ve hata halinde session'ın aktif olduğunu kullanıcıya bildirmiyor.

**Hata halinde de yönlendirme** — `js/shared/auth-session.js:18`

Server sonucu başarı olarak doğrulanmaz.

```javascript
try { await apiRequest("/auth/logout", { method: "POST" }); } catch (error) { ... } finally { window.location.href = "index.html"; }
```

**Revocation yalnız success path** — `backend/src/routes/auth.routes.ts:303`

Route'a ulaşılamazsa session geçerlidir.

```typescript
await transaction.authSession.updateMany({ ... data: { revokedAt: now } }); ... clearAuthCookies(res);
```

#### Validation

apiRequest hata/non-2xx için throw ederken logout handler'ları finally veya swallowed catch sonrası yönlendirir. Backend revoke/clearCookie yalnız route başarıyla tamamlanırsa çalışır.

**Hata halinde de yönlendirme** — `js/shared/auth-session.js:18`

Server sonucu başarı olarak doğrulanmaz.

```javascript
try { await apiRequest("/auth/logout", { method: "POST" }); } catch (error) { ... } finally { window.location.href = "index.html"; }
```

**Revocation yalnız success path** — `backend/src/routes/auth.routes.ts:303`

Route'a ulaşılamazsa session geçerlidir.

```typescript
await transaction.authSession.updateMany({ ... data: { revokedAt: now } }); ... clearAuthCookies(res);
```

#### Dataflow

Logout POST başarısız -\> throw -\> finally redirect -\> cookie/server session değişmez -\> session sonraki erişimde kullanılabilir.

#### Reachability

Kota tüketimi somut 429 sağlar; güvenlik etkisi paylaşılan cihaz/token senaryosunda oluşur.

#### Severity

**Low** — Etkisi paylaşılan tarayıcı, çalınmış token veya logout hatası gibi ek koşullara bağlıdır; başarılı backend yolu doğru revocation yapar.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Yalnız 2xx veya session zaten invalid diyen 401 sonrası yönlendirin. 403/429/ağ/5xx durumunda sayfada kalıp session aktif uyarısı ve retry sunun; handler'ları ortak helper'da birleştirin.

Tests:

- 429/403/ağ/5xx logout hatasında yönlendirme olmamalı ve uyarı gösterilmelidir.

Preventive controls:

- Başarıya bağlı navigasyon
- Logout ayrı kotası
- Açık failure UX

<a id="finding-13"></a>

### [13] Dağıtım yedekleri retention olmadan sınırsız birikebiliyor

| Field                | Value                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Severity             | low                                                                                                   |
| Confidence           | high                                                                                                  |
| Confidence rationale | Deploy scripti, benzersiz backup yolu ve retention adımı yokluğu doğrulandı.                          |
| Category             | resource-exhaustion                                                                                   |
| CWE                  | CWE-770                                                                                               |
| Affected lines       | .github/workflows/deploy.yml:67, .github/workflows/deploy.yml:70, .gitignore:82, deploy/README.md:137 |

#### Summary

Her deploy benzersiz zaman damgalı tam pg_dump üretirken eski yedekler için yaş/adet/boyut veya boş disk eşiği uygulanmıyor; zaman içinde disk dolması hizmeti durdurabilir.

#### Root Cause

Yedek üretimi için retention, disk kapasitesi guard'ı ve doğrulanmış offsite lifecycle bulunmuyor.

**Her deploy yeni dump** — `.github/workflows/deploy.yml:70`

Aynı SHA için bile yeni dosya üretir.

```yaml
backup_path="backups/pre-deploy-${DEPLOY_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

**Yalnız doğrulama** — `.github/workflows/deploy.yml:74`

Retention veya disk guard yoktur.

```yaml
test -s "$backup_path"; $compose exec -T postgres pg_restore --list < "$backup_path" >/dev/null
```

#### Validation

Her deploy pre-deploy-SHA-timestamp.dump oluşturup yalnız boyut/pg_restore listesi doğrular; eski dosyaları silen/taşıyan adım yoktur.

**Her deploy yeni dump** — `.github/workflows/deploy.yml:70`

Aynı SHA için bile yeni dosya üretir.

```yaml
backup_path="backups/pre-deploy-${DEPLOY_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

**Yalnız doğrulama** — `.github/workflows/deploy.yml:74`

Retention veya disk guard yoktur.

```yaml
test -s "$backup_path"; $compose exec -T postgres pg_restore --list < "$backup_path" >/dev/null
```

#### Dataflow

Her deploy -\> tam pg_dump -\> benzersiz yerel dosya -\> retention yok -\> disk dolar -\> PostgreSQL/log/deploy yazmaları durur.

#### Reachability

Tek çalıştırma sınırlıdır; zaman içinde veya tekrarlı dispatch ile birikim oluşur.

#### Severity

**Low** — Etki gerçek ve kalıcıdır ancak genellikle uzun süreli normal operasyon veya tekrarlı yetkili/ele geçirilmiş deploy tetiklemesi gerekir.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Dump öncesi minimum boş disk eşiği koyun. Sabit backups dizini altında güvenli yaş/adet/boyut retention uygulayın; son doğrulanmış N yedeği koruyup şifreli offsite depoya aktarın.

Tests:

- Retention yalnız politika dışı dosyaları güvenli sabit dizinde silmelidir.
- Düşük disk alanında deploy fail-closed olmalıdır.

Preventive controls:

- Disk guard
- Retention
- Şifreli offsite backup

## Reviewed Surfaces

| Surface                                         | Risk Area                           | Outcome        | Notes                                                                                           |
| ----------------------------------------------- | ----------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| Public booking, payment-flow ve availability    | Business logic, PII, availability   | Reported       | Anonim create/update/handoff, expiry, idempotency, pricing, custom venue ve schedule incelendi. |
| Auth, session, CSRF, CORS ve rate limiting      | Account ve API control plane        | Reported       | Login, cookie, rotation/expiry, CSRF, CORS, trust proxy ve loglar incelendi.                    |
| Customer, venue-manager ve admin authorization  | Ownership ve privileged operations  | Reported       | Customer ownership, venue scoping, admin state, audit ve credential render incelendi.           |
| Frontend DOM, navigation ve browser capability  | XSS, redirect, storage, privacy     | Reported       | Ordinary public inputtan doğrulanmış XSS bulunmadı; lifecycle/logout/CSP riskleri raporlandı.   |
| Production containers, proxy, DB roles ve CI/CD | Supply chain, secrets, availability | Reported       | Compose, Dockerfiles, Nginx, runtime DB role, deploy, health ve backup incelendi.               |
| Local development server                        | Developer secret exposure           | Reported       | Repository-root serving ve bind davranışı incelendi.                                            |
| SQL, process, filesystem ve execution sinks     | Injection/code execution            | No issue found | Production SQL/command injection doğrulanmadı.                                                  |
| Password, token ve encrypted-field storage      | Cryptography/secret handling        | No issue found | Argon2id, token hashes, AES-256-GCM/AAD, key validation ve redaction incelendi.                 |

## Open Questions And Follow Up

- Canlı Traefik forwarded-header güveni ve edge rate-limit/WAF kaynak dokümanıyla uyumlu mu?
- Yerel dev server yalnız loopback/güvenilir LAN üzerinde mi ve 8000/TCP dışarı yönlendiriliyor mu?
- Expired public başvurular ve DB yedekleri için onaylı retention süresi nedir?
- GitHub production environment reviewer ve branch protection platform ayarlarında etkin mi?
- Canlı TLS/Traefik/WAF/rate-limit/DNS yüzeyi yalnız izinli dinamik testle doğrulanabilir.
  - Follow-up prompt: Review deferred unit deferred_live_dast and close its stated proof gap. Paths: compose.production.yaml, deploy/README.md.
- Güncel dış advisory/CVE verisi çevrimdışı taramada sorgulanmadı.
  - Follow-up prompt: Review deferred unit deferred_dependency_advisories and close its stated proof gap. Paths: package-lock.json, backend/package-lock.json.
- 170 tracked dosyanın en az 62'si tamamen incelendi; kalan dosyalar güvenlik yüzeyi odaklı arama/örnekleme ile kapsandı, literal tamlık iddiası yapılmadı.
  - Follow-up prompt: Review deferred unit deferred_full_file_line_review and close its stated proof gap.
