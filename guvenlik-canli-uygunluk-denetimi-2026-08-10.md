# Düğün Ajansım Güvenlik ve Canlıya Uygunluk Denetimi

**Tarih:** 10 Ağustos 2026

**Düzeltmeleri içeren yerel/origin revision:** `4fd81c9` (`acb8cec..4fd81c9` güvenlik paketleri)

**Son salt-okunur doğrulanan canlı revision:** `f1b579bab35746861839bbac6d4a42b2662c167d` — bu düzeltme oturumunda production tekrar doğrulanmadı

**Yöntem:** Yerel kaynak/yapılandırma/test incelemesi ve SSH MCP üzerinden canlı ortamda salt-okunur doğrulamalar

**Codex Security:** Doğrulanmış bulgular için fix-finding iş akışı kullanıldı; yeni repository taraması yapılmadı

## Yönetici özeti

**Nihai karar: NO-GO — sistem çalışır durumda olsa da mevcut güvenlik ve operasyon riskiyle koşulsuz canlı onayı verilmemelidir.**

Son canlı doğrulamada frontend, iki backend replikası ve PostgreSQL sağlıklıydı; TLS, HTTP→HTTPS, HSTS, güvenlik başlıkları, Turnstile, kesin `TRUST_PROXY`, container sertleştirmesi ve PII şifreleme olumlu doğrulanmıştı. Bu oturumda repo tarafında dağıtık availability kotası, PII constraint validation migrationı, 24 saat token ve isteğe bağlı müşteri MFA, gerçek runtime-role CI kapısı, bağımsız günlük retention, file-backed secret altyapısı ve kapsamlı RLS tamamlandı. Temiz PostgreSQL 17 üzerinde 24 migration ve 11/11 entegrasyon testi; sentetik runtime rolle 2/2 ACL/RLS testi geçti.

Buna rağmen canlı yedek dizininde iki adet boş olmayan **düz metin PostgreSQL dump** bulunmuştur. Ayrıca tüm yedekler aynı hosttadır; otomatik off-site immutable kopya ve PITR yoktur. İnternete açık ortak Traefik container'ı root kullanıcıyla, yazılabilir root filesystem ile ve Docker socket bağlı şekilde çalışmaktadır. Tek fiziksel host/tek PostgreSQL mimarisi de devam etmektedir. Bu dört yüksek risk kapanmadan canlı kabulü önerilmez.

### Puan

| Alan | Puan |
| --- | ---: |
| Yerel uygulama ve kaynak güvenliği | **9,4 / 10** |
| Canlı altyapı ve operasyon güvenliği | **6,2 / 10** |
| **Genel mevcut güvenlik duruşu** | **7,6 / 10** |

Genel puan yalnız aritmetik ortalama değildir. Repo/CI güvenliği belirgin biçimde yükselmiştir; fakat canlı tekrar doğrulanmadığı ve taşıma sonrasına bırakılan dört yüksek etkili operasyon riski sürdüğü için puana üst sınır uygulanmıştır.

## Kapsam ve sınırlamalar

İnceleme aşağıdakileri kapsadı:

- Önceki üç rapor: `guvenlik-analiz-raporu-2026-08-09.md`, `guvenlik-denetim-raporu-2026-08-09.md`, `guvenlik-duzeltmeleri-2026-08-09.md`.
- Backend auth/session/MFA/CSRF/RBAC/tenant filtreleri, Zod doğrulama, kriptografi, hata/audit ve rate-limit katmanı.
- Prisma şeması, 24 migration, gerçek PostgreSQL entegrasyon testleri, runtime rolü ve RLS politikaları.
- Frontend capability, XSS/URL yüzeyi, CSP ve runtime config.
- Docker/Compose/Nginx/Traefik, CI/CD, bağımlılıklar, yedek/restore/watchdog ve retention.
- SSH MCP ile çalışan revision, container durumu, container güvenlik seçenekleri, dinleyen portlar, TLS/HTTP başlıkları, güvenli ortam değişkeni varlık kontrolü, PII durum sayımları, migration/constraint/RLS durumu, yedek dosyaları ve sınırlı loglar.

Gerçek sır değerleri ve müşteri kayıt içerikleri okunmadı veya rapora alınmadı. PII için yalnız toplu sayaçlar sorgulandı. Penetrasyon testi, yük/chaos testi ve dış hesapların yönetim paneli denetimi yapılmadı. Firewall durumu yetkili okuma gerektirdiği için doğrulanamadı; yalnız işletim sisteminde dinleyen portlar görülebildi. `sshd -T` host key okuma yetkisi olmadan çalışmadığı için SSH etkin ayarı dosya düzeyindeki hardening konfigürasyonuyla sınırlı doğrulandı.

### Düzeltme oturumu kapsam kararı

- **Sunucu taşıması sonrasına ertelendi:** 2; 3'ün canlı düz metin yedek silme, off-site kopya ve PITR kısmı; 9'un canlı secret aktivasyonu, anahtar rotasyonu ve eski env kopyalarını temizleme kısmı; 18.
- **Bu oturumda canlı mutasyon yapılmayacak:** SSH üzerinden dosya silme, anahtar rotasyonu, off-site/PITR veya HA kurulumu, mTLS değişikliği ve secret overlay aktivasyonu kapsam dışıdır.
- **Repo desteği bu oturumun kapsamındadır:** 3 için pasif-varsayılanlı legacy yedek koruması; 9 için opt-in file-backed secret altyapısı. Bu hazırlıklar canlıda etkinleştirilmiş sayılmayacaktır.
- **Bulgu 7:** E2EE olmayan sunucu-tarafı veri işleme modeli belgelenmiş ve kabul edilmiş bir tasarım sınırıdır; güvenlik açığı olarak izlenmeyecektir.
- **Bulgu 13:** Asıl runtime rolü/audit yetki bulgusu çözülmüştür. Eklenecek gerçek PostgreSQL CI kontrolü, bulguyu yeniden açan bir düzeltme değil savunma-derinliği kalite kapısıdır.

## Canlı ortamda doğrulanan durum

| Kontrol | Sonuç |
| --- | --- |
| Revision | Son canlı doğrulama `f1b579b...`; repo/origin düzeltmeleri `4fd81c9` revisionına ulaştı. Canlı eşitlik bu oturumda tekrar doğrulanmadı. |
| Containerlar | 2 backend, 1 frontend ve 1 PostgreSQL çalışıyor ve `healthy` |
| Port yüzeyi | Dışarıya dinleyen TCP portları 22, 80 ve 443; uygulama/PostgreSQL host portu yayımlanmıyor |
| Container sertleştirmesi | Backend `node`, frontend `nginx`; read-only rootfs, non-privileged, `cap_drop=ALL`, `no-new-privileges`; PostgreSQL süreçleri UID 70 ile çalışıyor |
| TLS | HTTP/2 200; HTTP 301 ile HTTPS'e yönleniyor; Let's Encrypt sertifikası 27 Ekim 2026'ya kadar geçerli |
| Başlıklar | HSTS 1 yıl + subdomains, CSP, `nosniff`, `SAMEORIGIN`, Referrer-Policy ve Permissions-Policy mevcut |
| Turnstile | Public katalogda `enabled=true`, beklenen action ile etkin |
| Proxy güveni | `.env.production` `TRUST_PROXY` değeri canlı Traefik `edge_proxy` IP'siyle birebir eşleşiyor |
| Ortam dosyası | Gerekli production alanları değerler gösterilmeden `SET`; `.env.production` modu `600` |
| Migration | Son canlı doğrulamada 20 migration vardı; repo temiz PostgreSQL 17 testinde 24 migrationa ulaştı. Canlı uygulama doğrulaması bekliyor. |
| PII | 65 başvuru, 56 düğün ve 63 mesaj kaydında şifrelenmemiş zarf ve legacy plaintext sayısı `0` |
| PII constraint | Son canlı doğrulamada üç constraint `convalidated=false`; repo migrationı validation ekledi ve yerel PostgreSQL testinde `convalidated=true`. Canlı doğrulama bekliyor. |
| RLS | Son canlı doğrulamada etkin tablo sayısı `0`; repo 15 business tabloda RLS ve owner-controlled enforcement ekledi. Canlı doğrulama bekliyor. |
| Yedek | Güncel `.dump.gcm` yedek ve restore-test izi var; dizin `700`, dosyalar `600` |
| Host bakımı | Ubuntu 22.04.5 LTS; unattended upgrades etkin, Fail2ban ve Netdata aktif; disk kullanımı %32 |
| Firewall | `ufw status` root yetkisi istedi; kesin kural seti doğrulanamadı |

## Önceki rapor bulgularının güncel durumu

| # | Önceki bulgu | Güncel durum | Kanıt / değerlendirme |
| ---: | --- | --- | --- |
| 1 | Hatalı MFA denemeleri login kotasından düşüyordu | **Çözüldü** | Yalnız `<400` tam giriş başarı sayılıyor; yanlış/eksik TOTP 401 kalıyor. `backend/src/routes/auth.routes.ts:73-97,192-205`; regresyon `backend/tests/backend.test.ts:108-114`. |
| 2 | Tek host/tek PostgreSQL ve failover yok | **Sunucu taşıması sonrasına ertelendi** | İki backend replika ve watchdog var; ikisi de aynı host ve aynı PostgreSQL'e bağlı. Bu oturumda HA/failover değişikliği yapılmayacak. `compose.production.yaml:316-409`; `deploy/deploy-production.sh:525`. |
| 3 | Yedek yalnız deploy öncesi ve aynı hostta | **Repo desteği hazır; canlı silme/off-site/PITR taşıma sonrası** | Kısa/uzun SHA'lı `pre-deploy-*.dump` ve eski tarihli dump adları exact allowlist ile tanınıyor; dizin dışı yol, symlink ve beklenmeyen adlar reddediliyor. Cleanup varsayılanı `LEGACY_PLAINTEXT_BACKUP_CLEANUP=0`; canlı dosya silinmedi. Dinamik shell regresyonu geçti. Commit `6031f16`. |
| 4 | Backend dependency audit CI kapısında değildi | **Çözüldü** | Kök ve backend audit workflow'da çalışıyor; güncel auditler 0 bulgu. `.github/workflows/quality.yml:19-20,65-66`; `backend/package.json:21`. |
| 5 | Public formda bot doğrulama/idempotency/iletişim kotası yoktu | **Çözüldü** | Production Turnstile fail-closed, zorunlu UUID idempotency ve iletişim bazlı paylaşımlı kota var; canlı Turnstile etkin. `backend/src/utils/turnstile.ts:30-93`; `backend/src/routes/public.routes.ts:70-85,216-251`. |
| 6 | Rate-limit process-local ve ana iş DB'sine bağımlıydı | **Çözüldü — kabul edilen DB bağımlılığıyla** | Public availability sayacı `DatabaseRateLimitStore` üzerinden iki backend arasında ortak; iki bağımsız app/store toplam kotayı birlikte tüketiyor. Kritik sayaç production DB hatasında fail-closed. Global limiter ortak Traefik edge kotası nedeniyle bellekte bırakıldı; dış servis eklenmedi. Commit `1e8fe58`. |
| 7 | PII tam/E2EE değildi | **Kabul edilmiş tasarım sınırı — açık değil** | Temel PII güçlü biçimde şifreli; iş metadata'sı açık ve backend anahtara sahip olduğundan E2EE değildir. Sunucu-tarafı işleme gereksinimi kabul edilmiştir; güvenlik açığı olarak kapatılmıştır. |
| 8 | Legacy plaintext PII ve production strict eksikliği | **Repo/CI kapsamında çözüldü; canlı doğrulama bekliyor** | Yeni `20260810100000_validate_core_pii_constraints` migrationı üç zarf constraintini validate ediyor. Temiz PostgreSQL 17 testinde `convalidated=true` ve geçersiz zarf reddi doğrulandı; strict/legacy/crypto regresyonları geçti. Commit `9c510c6`. |
| 9 | KMS/HSM/Docker Secrets yok | **Repo desteği hazır; canlı aktivasyon taşıma sonrası** | Bağımlılıksız allowlist `*_FILE` yükleyicisi, Node/Postgres/migrate/backup desteği, `USE_FILE_SECRETS=0` kapısı ve opt-in Compose overlay eklendi. Conflict, boş/aşırı büyük/NUL/symlink/non-file kaynakları fail-closed. Base Compose geriye uyumlu; overlay canlıda açılmadı, anahtar rotasyonu ve eski env temizliği yapılmadı. Commit `c2d7e48`. |
| 10 | DB RLS yok, tenant sınırı uygulama filtrelerine bağlı | **Repo/CI kapsamında çözüldü; canlı doğrulama bekliyor** | Transaction-local sunucu bağlamı, 15 business tablo politikası, PII satırı açmayan boolean public uygunluk fonksiyonu ve owner-controlled enforcement eklendi. Eksik bağlam, iki salon/iki müşteri, public/auth/maintenance ve admin testleri gerçek runtime rolle geçti; rollback enforcement'ı eski backend öncesi kapatıyor. Commitler `f5cf2b6`, `4fd81c9`. |
| 11 | 72 saatlik setup/reset tokenı ve müşteri MFA eksikliği | **Repo/CI kapsamında çözüldü; canlı doğrulama bekliyor** | Varsayılan TTL 24 saat. Aktif ve ilk parolasını değiştirmiş müşteriler mevcut endpointlerle TOTP enroll/confirm/disable kullanabiliyor; müşteri paneli eklendi. Disable tüm oturumları iptal ediyor. Production zorunluluğu yalnız admin/salon yetkilisinde; müşteri MFA isteğe bağlı. Enroll/login/replay/disable regresyonları geçti. Commit `553043b`. |
| 12 | Payment capability `sessionStorage` içindeydi | **Çözüldü** | Capability HttpOnly/Secure/SameSite=Strict cookie'de; frontend storage yalnız application UUID tutuyor. `public.routes.ts:33-49,253-257`; `application.js:81-83`. |
| 13 | Audit temizliği ve runtime DB rolü fazla yetkiliydi | **Çözüldü; CI savunma-derinliği kapısı eklendi** | Owner migrationından sonra sentetik runtime rolü gerçek PostgreSQL'de kuruluyor. Gerekli CRUD çalışıyor; DDL, audit UPDATE/DELETE/TRUNCATE, `_prisma_migrations`, RLS state ve setter erişimi reddediliyor. Workflow kalite kapısına bağlı. Commit `639569e`; RLS genişletmesi `4fd81c9`. |
| 14 | Public istek sınırsız global sweep tetikleyebiliyordu | **Çözüldü** | Hedefli sweep, 100 kayıt sınırı ve advisory lock var. `booking.service.ts:615-677`. |
| 15 | HTTP/DB timeout ve container kaynak sınırı yoktu | **Çözüldü** | Node/DB timeoutları, CPU/RAM/PID/log sınırları ve healthcheckler mevcut ve canlı containerlarda uygulanmış. |
| 16 | WhatsApp URL'sinde PII ve RNG fail-open | **Çözüldü** | URL'den PII çıkarılmış, CSPRNG fail-closed ve tek kullanımlık bağlantı akışı var. |
| 17 | Veri yaşam döngüsü/retention yoktu | **Çözüldü — canlı çalışma doğrulaması bekliyor** | Günlük `--backup-only` akışı şifreli restore doğrulamasından sonra retention çalıştırıyor. Düğünle silinen application audit toplamına dahil; query indeksleri migrationla eklendi. Gerçek PostgreSQL testi süre, batch, Serializable transaction, izolasyon ve audit toplamını doğruladı. Commit `53adc20`. |
| 18 | İç container ağında mTLS yoktu | **Sunucu taşıması sonrasına ertelendi** | PostgreSQL izole internal networkte ve host portu yok; servisler arası mTLS kararı yeni sunucu topolojisi üzerinde yeniden değerlendirilecek. Bu oturumda değişiklik yapılmayacak. |
| 19 | Yönetilebilir görsel/teslim URL allowlist eksikti | **Çözüldü** | Görsel yolu local asset regex'i, teslimat URL'si HTTPS Google Drive allowlist'i ile sınırlı. `api.schemas.ts:46-53`; `utils/domain.ts:127-146`. |

## Güncel açık bulgular

### Yüksek

#### H-01 — Canlıda iki boş olmayan düz metin PostgreSQL yedeği var

SSH doğrulamasında `backups/` altında şifreli `.dump.gcm` dosyalarının yanında iki boş olmayan `.dump` dosyası `file` ile PostgreSQL custom database dump olarak doğrulandı. Dosyalar `600`, dizin `700`; bu dış kullanıcı erişimini azaltır fakat host/kullanıcı hesabı ele geçirilmesi, yanlış kopyalama veya sunucu yedeği sırasında müşteri verisinin şifresiz açığa çıkmasını engellemez.

Repo artık yalnız kesin allowlist içindeki kısa/uzun SHA'lı `pre-deploy-*.dump` ve tarih damgalı eski `dugun-ajansim-*.dump` adlarını tanıyor; dizin dışı yol, symlink ve beklenmeyen adlar reddediliyor. Temizlik `LEGACY_PLAINTEXT_BACKUP_CLEANUP=0` varsayılanıyla pasif. Bu koruma canlı dosyaları değiştirmedi; önceki rapordaki “eski plaintext yedekler kaldırıldı” iddiası canlı için hâlâ yanlıştır.

**Kapanış — sunucu taşıması sonrası:** Yeni şifreli ve tercihen off-site yedeğin restore testi başarıyla tamamlandıktan sonra cleanup kapısı bilinçli olarak açılmalı. Yetkili bakım penceresinde dosyaların sahipliği/kullanımı ve olası kopyaları incelenmeli; güvenli silme yapılmalı, gerekirse maruziyet ve anahtar döndürme değerlendirmesi açılmalıdır. Repo regresyon testleri legacy adları ve güvenli yol sınırlarını şimdiden kapsıyor.

#### H-02 — Ortak Traefik container'ı Docker socket güven alanını hosta taşıyor

Canlı Traefik container'ı internete açık 80/443 girişidir; root kullanıcıyla, yazılabilir root filesystem ve capability drop olmadan çalışır. `/var/run/docker.sock` `:ro` bağlıdır. Bir Unix socketin read-only mount edilmesi Docker API'ye yalnız okuma semantiği sağlamaz; reverse proxy ele geçirilirse diğer projeler ve host için yüksek etkili Docker kontrol düzlemi riski doğar.

**Kapanış:** Docker socket proxy/API allowlist, ayrı ağ ve least-privilege kullanıcı/container hardening uygulanmalı; Traefik image digest ile sabitlenmeli. Ortak hosttaki n8n/VitrinOS servisleriyle blast radius ayrılmalıdır.

#### H-03 — Off-site immutable yedek ve PITR yok

Günlük AES-256-GCM yedek ve aynı clusterda restore provası güçlüdür; ancak yedekler ana veriyle aynı host/disk güven alanındadır. Host/disk/ransomware kaybı veri ve yedekleri birlikte etkileyebilir. `deploy/README.md:141-143` bunu manuel görev olarak bırakır.

**Kapanış:** Ayrı hesap/sağlayıcıda immutable object storage, otomatik kopya doğrulaması, ayrı key escrow, WAL/PITR ve off-site kopyadan belgeli restore tatbikatı gerekir.

#### H-04 — Tek fiziksel host ve tek PostgreSQL tam kesinti noktası

İki backend replika yalnız process/container arızasına karşı korur. Host, Docker daemon, disk, Traefik veya PostgreSQL kaybı uygulamanın tamamını durdurur. Aynı hostta başka üretim servisleri de çalıştığından kaynak ve güven sınırı paylaşılır.

**Kapanış:** En azından harici/replicated PostgreSQL, ikinci host/availability zone, ölçülmüş RPO/RTO ve failover tatbikatı; mümkün değilse açık iş riski kabulü gerekir.

### Orta

1. **Güvensiz alternatif runbook:** `deploy/README.md:78-86` doğrudan `git pull` + `docker compose up` önererek doğrulanmış yedek/restore, provenance, rollback, replika, PII bakım ve retention kapılarını atlıyor. İlk kurulum da `--scale backend=2` kullanmıyor (`:13-22`).
2. **Repo güvenlik paketlerinin canlı doğrulaması bekliyor:** Canlı revision bu oturumda tekrar okunmadı. 24 migration, validate edilmiş PII constraintleri, RLS enforcement, 24 saat token varsayılanı, müşteri MFA ve bağımsız retention çalışması production üzerinde uygulanmış/doğrulanmış sayılmaz.
3. **File-backed secret aktivasyonu ve rotasyon bekliyor:** Repo opt-in `*_FILE` desteğine sahip olsa da canlı overlay kapalıdır. `.env.production` dışında bulunan iki owner-only eski `.env.production*` kopyası taşıma sonrasında temizlenmeli; ilgili sırlar kontrollü biçimde döndürülmelidir.
4. **Rate-limit ana iş DB'sine bağlı:** Kritik ve public availability sayaçları artık replikalar arasında ortaktır ve production DB hatasında fail-closed kalır. Dış bağımlılık eklememe kararı gereği bu sayaçların saldırı trafiğinde iş sorgularıyla aynı PostgreSQL kaynağını tüketmesi kabul edilen kalan kullanılabilirlik riskidir; global API için ortak Traefik edge kotası vardır.
5. **Alarm ve firewall kanıtı eksik:** Netdata, Fail2ban ve unattended upgrades aktif; buna rağmen dış uptime/5xx/DB/disk/sertifika/yedek alarmının sorumluya ulaştığı ve firewall kural seti doğrulanamadı.
6. **Supply-chain kanıtı kısmi:** Prod base image ve Actions pinli; fakat CI prod image build+scan/SBOM/imza üretmiyor, kalite kontrolünden sonra image sunucuda yeniden build ediliyor.

### Düşük / savunma derinliği

- Public availability Zod `query/params` şemaları `.strict()` değil; bilinmeyen alanlar strip ediliyor. Pasif/bilinmeyen venue UUID için aynı 404 sözleşmesi de yok.
- CSP script yüzeyi kontrollü; `style-src 'unsafe-inline'`, harici fontlar ve geniş `img-src https:` devam ediyor.
- `.gitignore`/`.dockerignore`, `.npmrc`, `.p12/.pfx/.jks` ve tipik SSH private-key adlarını geleceğe dönük denylistte kapsamıyor; bugün izlenen böyle bir dosya yok.
- CI Node 22 ve PostgreSQL 17 hareketli major etiketleri kullanıyor; production image'ları digest pinli olduğu için etki düşük.

## Güçlü güvenlik katmanları

- Ayrıcalıklı hesaplarda zorunlu production MFA; müşterilerde isteğe bağlı TOTP; replay koruması, güçlü parola, kısa idle/absolute session ve zorunlu ilk parola değişimi.
- Hashli session/CSRF/setup/payment tokenları; HttpOnly/Secure/SameSite cookie'ler ve authenticated mutasyonlarda CSRF.
- Backend route seviyesinde rol/tenant filtreleri; transaction-local sunucu güvenlik bağlamı ve 15 business tabloda owner-controlled RLS.
- Zod allowlist, 10 KB body sınırı, HPP, CORS allowlist, CSP/Helmet ve katmanlı rate-limit.
- AES-256-GCM PII, kayıt/model/sürüm/key-id bağlı AAD, ayrı HMAC blind index ve anahtar rotasyonu.
- DDL'siz runtime DB rolü; audit UPDATE/DELETE/TRUNCATE ve RLS yönetimi reddi; transaction/advisory lock/constraint temelli yarış koruması.
- Günlük şifreli yedek/restore doğrulamasına bağlı bağımsız retention; batch, izolasyon, indeks ve audit toplamı için gerçek PostgreSQL regresyonu.
- Non-root/read-only/capability'siz uygulama containerları, kaynak/PID/log sınırları ve iki sağlıklı backend replika.
- Exact-SHA deploy, pinned GitHub Actions/SSH fingerprint, digest-pinned production base image'ları ve frontend/backend audit kapısı.
- Canlı HTTPS, HSTS, güvenlik başlıkları, Turnstile, exact proxy trust, Fail2ban ve otomatik sistem güvenlik güncellemeleri.

## Doğrulama sonuçları

| Doğrulama | Sonuç |
| --- | --- |
| Kök `npm run test:quick` | Geçti; frontend statik kontroller, **30/30** responsive test, backend build/typecheck/auth hedefi |
| `backend npm run test:quick` | **60/60 geçti**; build ve test typecheck geçti |
| `backend npm run test:integration` | Temiz PostgreSQL 17 üzerinde 24 migration, **11/11 geçti** |
| Sentetik runtime DB rolü testi | **2/2 geçti**; gerekli CRUD çalıştı; DDL, audit mutasyonu, `_prisma_migrations`, RLS state/setter ve çapraz tenant erişimi reddedildi |
| Kök ve backend `npm audit --json` | **0 bulgu** |
| `npm audit signatures` | Kök 211 imza/40 attestation; backend 167 imza/23 attestation doğrulandı |
| File-secret ve backup shell regresyonları | **8/8 geçti**; conflict, boyut/içerik/tür/symlink ve legacy cleanup sınırları doğrulandı |
| Operations security testleri | **7/7 geçti**; deploy rollback/enforcement sırası dahil |
| Production Compose sentetik config | Base ve opt-in secret overlay geçti; overlay etkinleştirilmedi |
| Backend/frontend/migrate image build | Geçti; migrate image içinde 24 migration doğrulandı |
| Production hardening Playwright testi | **1/1 geçti**; image kullanıcıları ve `nginx -t` ayrıca doğrulandı |
| Nginx config | `nginx -t` geçti |
| Son canlı health/TLS/header | Önceki salt-okunur doğrulamada geçti; bu düzeltme revisionı canlıda tekrar doğrulanmadı |
| Son canlı PII aggregate kontrolü | Legacy plaintext `0`; üç envelope constrainti o anda `convalidated=false` idi; yeni migrationın canlı uygulaması bekliyor |
| Firewall | Yetki nedeniyle doğrulanamadı |

## Canlıya geçiş için zorunlu kapanış sırası

1. **Taşıma sonrası:** Yeni şifreli/off-site yedeği restore ederek doğrula; plaintext dump'lar için maruziyet değerlendirmesi yap ve pasif cleanup kapısını yetkili prosedürle aç.
2. **Taşıma sonrası:** Off-site immutable yedek, ayrı key escrow ve PITR kur; off-site restore tatbikatı ile RPO/RTO'yu kaydet.
3. **Taşıma sonrası:** Traefik Docker socket erişimini socket-proxy/allowlist ile daralt; root/read-write/capability ve shared-host blast radius'ını azalt.
4. **Taşıma sonrası:** Tek host/tek PostgreSQL kesinti noktasını failover/replication ile kaldır veya risk sahibinin süreli, yazılı kabulünü al; iç servis mTLS kararını yeni topolojide uygula.
5. **Taşıma sonrası:** File-secret overlay'i kontrollü aç; sırları döndür ve eski `.env.production*` kopyalarını doğrulanmış prosedürle temizle.
6. Repo düzeltme revisionını productiona güvenli akışla al; 24 migrationı, üç PII constraintini, RLS enforcement durumunu, müşteri MFA'yı ve günlük retention çalışmasını canlıda salt-okunur kanıtlarla doğrula.
7. `deploy/README.md` akışını yalnız güvenli `deploy-production.sh` yoluna yönlendir; ilk kurulumda iki backend replikasını garanti et.
8. Firewall kural setini yetkili salt-okunur denetimle doğrula; dış alarm zincirini sentetik olayla kanıtla.
9. `canliya-gecis-kontrol-listesi.md` içindeki P0-02–P0-07 maddelerini güncel kanıtlarla kapat. Bu dosyanın mevcut kararı da hâlâ `NO-GO`dur (`canliya-gecis-kontrol-listesi.md:8,49-116,259-270`).

## Sonuç

Uygulama kodu sıradan bir web uygulamasının belirgin biçimde üzerinde güvenlik olgunluğuna sahiptir ve repo/CI kapsamında güçlü bir release candidate'tır. Düzeltmeler dağıtık availability kotası, validated PII constraintleri, 24 saat token ve isteğe bağlı müşteri MFA, runtime-role kalite kapısı, günlük retention, opt-in file secrets ve kapsamlı RLS ile tamamlandı. Bununla birlikte bu revision production üzerinde tekrar doğrulanmadı. Canlıda plaintext veritabanı yedekleri, Docker socket bağlı zayıf sertleştirilmiş ortak Traefik, off-site/PITR eksikliği ve tek-host/tek-DB mimarisi yüksek risk olmaya devam ediyor.

**Son karar: 7,6/10 — NO-GO. Repo bulguları büyük ölçüde kapatılmıştır; taşıma sonrasına ertelenen canlı riskler kapanmadan veya yetkili ve süreli risk kabulüyle telafi edilmeden koşulsuz canlı onayı verilmemelidir.**
