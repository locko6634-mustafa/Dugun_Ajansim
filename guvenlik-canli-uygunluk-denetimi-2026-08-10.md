# Düğün Ajansım Güvenlik ve Canlıya Uygunluk Denetimi

**Tarih:** 10 Ağustos 2026

**Yeniden doğrulama başlangıç revisionı:** `9932fb02663e74bc7dec3d81bcfefb05b1102768` — yerel, `origin/main` ve canlı eşitti

**Son salt-okunur doğrulanan canlı revision:** `9932fb02663e74bc7dec3d81bcfefb05b1102768` — production 10 Ağustos 2026'da tekrar doğrulandı

**Yöntem:** Yerel kaynak/yapılandırma/test incelemesi ve SSH MCP üzerinden canlı ortamda salt-okunur doğrulamalar

**Codex Security:** Açık bulgular validation iş akışıyla yeniden sınıflandırıldı; repo içinde doğrulanan dar kapsamlı maddeler fix-finding iş akışıyla düzeltildi. Yeni repository taraması yapılmadı.

## Yönetici özeti

**Nihai karar: NO-GO — sistem çalışır durumda olsa da mevcut güvenlik ve operasyon riskiyle koşulsuz canlı onayı verilmemelidir.**

Canlı revisionın `origin/main` ile eşit olduğu; frontend, iki backend replikası ve PostgreSQL'in sağlıklı çalıştığı; HTTP/2, HTTP→HTTPS, HSTS ve güvenlik başlıklarının etkin olduğu yeniden doğrulandı. Canlı veritabanında 24 migration, üç validated PII constraint, 15 RLS tablosu, etkin RLS enforcement, runtime rolüyle çalışan backend bağlantıları ve 65 başvuru/56 düğün/63 mesaj kaydında sıfır legacy plaintext doğrulandı. Günlük şifreli yedek de güncel dosya kanıtıyla çalışmaktadır.

Buna rağmen canlı yedek dizininde iki adet boş olmayan **düz metin PostgreSQL dump** bulunmuştur. Ayrıca tüm yedekler aynı hosttadır; otomatik off-site immutable kopya ve PITR yoktur. İnternete açık ortak Traefik container'ı root kullanıcıyla, yazılabilir root filesystem ile ve Docker socket bağlı şekilde çalışmaktadır. Tek fiziksel host/tek PostgreSQL mimarisi de devam etmektedir. Bu dört yüksek risk kapanmadan canlı kabulü önerilmez.

### Puan

| Alan | Puan |
| --- | ---: |
| Yerel uygulama ve kaynak güvenliği | **9,6 / 10** |
| Canlı altyapı ve operasyon güvenliği | **6,2 / 10** |
| **Genel mevcut güvenlik duruşu** | **7,6 / 10** |

Genel puan yalnız aritmetik ortalama değildir. Repo/CI güvenliği ve canlı uygulama kontrolleri yeniden doğrulanmıştır; fakat taşıma sonrasına bırakılan dört yüksek etkili operasyon riski sürdüğü için genel puana üst sınır uygulanmıştır.

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
| Revision | Yerel, `origin/main` ve canlı `9932fb02663e74bc7dec3d81bcfefb05b1102768` olarak eşitti. Bu rapor güncellemesindeki repo düzeltmeleri bu revisiondan sonra hazırlanmıştır. |
| Containerlar | 2 backend, 1 frontend ve 1 PostgreSQL çalışıyor ve `healthy` |
| Port yüzeyi | Dışarıya dinleyen TCP portları 22, 80 ve 443; uygulama/PostgreSQL host portu yayımlanmıyor |
| Container sertleştirmesi | Backend `node`, frontend `nginx`; read-only rootfs, non-privileged, `cap_drop=ALL`, `no-new-privileges`; PostgreSQL süreçleri UID 70 ile çalışıyor |
| TLS | HTTP/2 200; HTTP 308 ile HTTPS'e yönleniyor. Sertifika son kullanım tarihi bu yeniden doğrulamada ayrıca okunmadı. |
| Başlıklar | HSTS 1 yıl + subdomains, CSP, `nosniff`, `SAMEORIGIN`, Referrer-Policy ve Permissions-Policy mevcut |
| Turnstile | Public katalogda `enabled=true`, beklenen action ile etkin |
| Proxy güveni | `.env.production` `TRUST_PROXY` değeri canlı Traefik `edge_proxy` IP'siyle birebir eşleşiyor |
| Ortam dosyası | Gerekli production alanları değerler gösterilmeden `SET`; `.env.production` modu `600` |
| Migration | Canlıda tamamlanmış ve rollback edilmemiş migration sayısı `24` |
| PII | 65 başvuru, 56 düğün ve 63 mesaj kaydında şifrelenmemiş zarf ve legacy plaintext sayısı `0` |
| PII constraint | Üç core PII envelope constrainti canlıda `convalidated=true` |
| RLS | 15 public tabloda RLS etkin; `public.app_rls_is_enforced()` sonucu `true`; aktif bağlantılarda `dugun_runtime` rolü görülüyor |
| Yedek | Güncel `scheduled-*.dump.gcm` ve çoklu şifreli pre-deploy yedekleri mevcut; dizin `700`, dosyalar `600`. İki boş olmayan plaintext dump da hâlâ mevcut. |
| Host bakımı | Ubuntu 22.04.5 LTS; unattended upgrades, Fail2ban ve Netdata önceki doğrulamada aktifti; bu turda disk kullanımı %38 |
| Ortak Traefik | `root(default)`, `read_only=false`, `cap_drop=null`, `no-new-privileges=true`; Docker socket `:ro` bağlı; Compose image referansı `traefik:v3.7.8` ve digest ile pinli değil |
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
| 8 | Legacy plaintext PII ve production strict eksikliği | **Çözüldü ve canlı doğrulandı** | Canlıda üç envelope constrainti `convalidated=true`; 65 başvuru, 56 düğün ve 63 mesaj kaydında legacy plaintext ve eksik PII envelope sayısı `0`. |
| 9 | KMS/HSM/Docker Secrets yok | **Repo desteği hazır; canlı aktivasyon taşıma sonrası** | Bağımlılıksız allowlist `*_FILE` yükleyicisi, Node/Postgres/migrate/backup desteği, `USE_FILE_SECRETS=0` kapısı ve opt-in Compose overlay eklendi. Conflict, boş/aşırı büyük/NUL/symlink/non-file kaynakları fail-closed. Base Compose geriye uyumlu; overlay canlıda açılmadı, anahtar rotasyonu ve eski env temizliği yapılmadı. Commit `c2d7e48`. |
| 10 | DB RLS yok, tenant sınırı uygulama filtrelerine bağlı | **Çözüldü ve canlı doğrulandı** | Canlıda 15 public tabloda RLS etkin, enforcement fonksiyonu `true` ve backend bağlantıları `dugun_runtime` rolünü kullanıyor. İki salon/iki müşteri ve negatif yetki regresyonları gerçek runtime rolle daha önce geçti. |
| 11 | 72 saatlik setup/reset tokenı ve müşteri MFA eksikliği | **Çözüldü; ilgili revision canlıda** | Varsayılan TTL 24 saat ve müşteri TOTP enroll/confirm/disable akışı `9932fb0` içinde canlıya alınmış durumda. Enroll/login/replay/disable regresyonları geçti; gerçek müşteri hesabıyla UI kabul testi yapılmadı. |
| 12 | Payment capability `sessionStorage` içindeydi | **Çözüldü** | Capability HttpOnly/Secure/SameSite=Strict cookie'de; frontend storage yalnız application UUID tutuyor. `public.routes.ts:33-49,253-257`; `application.js:81-83`. |
| 13 | Audit temizliği ve runtime DB rolü fazla yetkiliydi | **Çözüldü; CI savunma-derinliği kapısı eklendi** | Owner migrationından sonra sentetik runtime rolü gerçek PostgreSQL'de kuruluyor. Gerekli CRUD çalışıyor; DDL, audit UPDATE/DELETE/TRUNCATE, `_prisma_migrations`, RLS state ve setter erişimi reddediliyor. Workflow kalite kapısına bağlı. Commit `639569e`; RLS genişletmesi `4fd81c9`. |
| 14 | Public istek sınırsız global sweep tetikleyebiliyordu | **Çözüldü** | Hedefli sweep, 100 kayıt sınırı ve advisory lock var. `booking.service.ts:615-677`. |
| 15 | HTTP/DB timeout ve container kaynak sınırı yoktu | **Çözüldü** | Node/DB timeoutları, CPU/RAM/PID/log sınırları ve healthcheckler mevcut ve canlı containerlarda uygulanmış. |
| 16 | WhatsApp URL'sinde PII ve RNG fail-open | **Çözüldü** | URL'den PII çıkarılmış, CSPRNG fail-closed ve tek kullanımlık bağlantı akışı var. |
| 17 | Veri yaşam döngüsü/retention yoktu | **Çözüldü; günlük akış canlıda çalışıyor** | Güncel `scheduled-*.dump.gcm` dosyası günlük `--backup-only` akışının çalıştığını kanıtlıyor; betik retentionı restore doğrulamasından sonra çalıştırıyor. Silinecek yaşta veri oluşmadığından bu turda canlı silme sonucu gözlenmedi. |
| 18 | İç container ağında mTLS yoktu | **Sunucu taşıması sonrasına ertelendi** | PostgreSQL izole internal networkte ve host portu yok; servisler arası mTLS kararı yeni sunucu topolojisi üzerinde yeniden değerlendirilecek. Bu oturumda değişiklik yapılmayacak. |
| 19 | Yönetilebilir görsel/teslim URL allowlist eksikti | **Çözüldü** | Görsel yolu local asset regex'i, teslimat URL'si HTTPS Google Drive allowlist'i ile sınırlı. `api.schemas.ts:46-53`; `utils/domain.ts:127-146`. |

## Güncel açık bulgular

### Yüksek

#### H-01 — Canlıda iki boş olmayan düz metin PostgreSQL yedeği var

SSH yeniden doğrulamasında `backups/` altında şifreli `.dump.gcm` dosyalarının yanında 45.224 ve 107.422 bayt boyutunda iki `.dump` dosyası `file` ile PostgreSQL custom database dump olarak doğrulandı. Ayrıca bir adet sıfır bayt `.dump` vardır; risk sayımına dahil edilmemiştir. Dosyalar `600`, dizin `700`; bu dış kullanıcı erişimini azaltır fakat host/kullanıcı hesabı ele geçirilmesi, yanlış kopyalama veya sunucu yedeği sırasında müşteri verisinin şifresiz açığa çıkmasını engellemez.

Repo artık yalnız kesin allowlist içindeki kısa/uzun SHA'lı `pre-deploy-*.dump` ve tarih damgalı eski `dugun-ajansim-*.dump` adlarını tanıyor; dizin dışı yol, symlink ve beklenmeyen adlar reddediliyor. Temizlik `LEGACY_PLAINTEXT_BACKUP_CLEANUP=0` varsayılanıyla pasif. Bu koruma canlı dosyaları değiştirmedi; önceki rapordaki “eski plaintext yedekler kaldırıldı” iddiası canlı için hâlâ yanlıştır.

**Kapanış — sunucu taşıması sonrası:** Yeni şifreli ve tercihen off-site yedeğin restore testi başarıyla tamamlandıktan sonra cleanup kapısı bilinçli olarak açılmalı. Yetkili bakım penceresinde dosyaların sahipliği/kullanımı ve olası kopyaları incelenmeli; güvenli silme yapılmalı, gerekirse maruziyet ve anahtar döndürme değerlendirmesi açılmalıdır. Repo regresyon testleri legacy adları ve güvenli yol sınırlarını şimdiden kapsıyor.

#### H-02 — Ortak Traefik container'ı Docker socket güven alanını hosta taşıyor

Canlı Traefik container'ı internete açık 80/443 girişidir; `root(default)`, `read_only=false` ve `cap_drop=null` ile çalışır. `no-new-privileges=true` olumlu bir karşı kontroldür ancak `/var/run/docker.sock` `:ro` bağlıdır. Bir Unix socketin read-only mount edilmesi Docker API'ye yalnız okuma semantiği sağlamaz; reverse proxy ele geçirilirse diğer projeler ve host için yüksek etkili Docker kontrol düzlemi riski doğar. Çalışan image yerelde digest çözümüne sahip olsa da Compose kaynağı yalnız `traefik:v3.7.8` kullanır ve immutable digest pinlemez.

**Kapanış — sunucu taşıması sonrası:** Docker socket proxy/API allowlist, ayrı ağ ve least-privilege kullanıcı/container hardening uygulanmalı; Traefik image digest ile sabitlenmeli. Ortak hosttaki n8n/VitrinOS servisleriyle blast radius ayrılmalıdır.

#### H-03 — Off-site immutable yedek ve PITR yok

Günlük AES-256-GCM yedek ve aynı clusterda restore provası güçlüdür; ancak yedekler ana veriyle aynı host/disk güven alanındadır. Host/disk/ransomware kaybı veri ve yedekleri birlikte etkileyebilir. `deploy/README.md:145-147` bunu manuel görev olarak bırakır.

**Kapanış — sunucu taşıması sonrası:** Projenin runtime bağımlılığına dönüştürmeden ayrı self-hosted yedek hedefi veya immutable object storage, otomatik kopya doğrulaması, ayrı key escrow, WAL/PITR ve off-site kopyadan belgeli restore tatbikatı gerekir.

#### H-04 — Tek fiziksel host ve tek PostgreSQL tam kesinti noktası

İki backend replika yalnız process/container arızasına karşı korur. Host, Docker daemon, disk, Traefik veya PostgreSQL kaybı uygulamanın tamamını durdurur. Aynı hostta başka üretim servisleri de çalıştığından kaynak ve güven sınırı paylaşılır.

**Kapanış — sunucu taşıması sonrası:** En azından self-managed replicated PostgreSQL, ikinci host/availability zone, ölçülmüş RPO/RTO ve failover tatbikatı; mümkün değilse açık iş riski kabulü gerekir.

## Yeniden doğrulama kapanış matrisi

Tüm adaylarda aynı beş ölçüt uygulandı:

- [x] Güncel checkout veya canlı durumdan kesin kanıt alındı.
- [x] Gerçek erişim yolu/önkoşul ve etki sınırı belirlendi.
- [x] Mevcut karşı kontroller ve karşı kanıtlar kaydedildi.
- [x] Repo içinde bugün kapatılabilirlik ile sunucu taşıması bağımlılığı ayrıldı.
- [x] Dinamik doğrulama mümkün değilse kalan kanıt boşluğu açıkça bırakıldı.

| ID | Bulgu | Yöntem ve güncel kanıt | Karar | Güven |
| --- | --- | --- | --- | --- |
| H-01 | İki plaintext PostgreSQL dump | SSH `find/stat/file`; iki boş olmayan custom dump | `reportable`, taşıma sonrasına ertelendi | Yüksek |
| H-02 | Traefik Docker socket/root-RW sınırı | Canlı `docker inspect` ve Compose kaynağı; `no-new-privileges` karşı kontrolü var | `reportable`, taşıma sonrasına ertelendi | Yüksek |
| H-03 | Off-site immutable/PITR yok | `findmnt`, volume inspect, backup workflow ve repo araması; veri/yedek `/dev/sda2` üzerinde | `reportable`, taşıma sonrasına ertelendi | Yüksek |
| H-04 | Tek host/tek PostgreSQL | Canlı container/ağ/mount envanteri; tek DB ve tek Docker host | `reportable`, taşıma sonrasına ertelendi | Yüksek |
| M-01 | Güvensiz alternatif runbook | Kaynak izleme ve regresyon; doğrudan `git pull/up` kaldırıldı, exact-SHA betik yolu ve ilk kurulumda iki replika zorunlu | `suppressed` — düzeltildi | Yüksek |
| M-02 | Repo güvenlik paketi canlıda doğrulanmadı | Canlı revision, 24 migration, üç validated constraint, 15 RLS tablo, enforcement ve runtime rolü | `suppressed` — iddia artık yanlış | Yüksek |
| M-03 | File-backed secret/rotasyon bekliyor | Canlı backendde `*_FILE` aktivasyonu yok; iki eski owner-only `.env.production*` kopyası var | `deferred` — taşıma sonrası | Yüksek |
| M-04 | Rate-limit ana iş DB'sine bağlı | Kod, iki-replika entegrasyon testi ve fail-closed production davranışı | `not_applicable` — kabul edilmiş mimari kullanılabilirlik riski | Yüksek |
| M-05 | Alarm zinciri ve firewall kanıtı eksik | 22/80/443 dinliyor; yetkisiz `ufw` sorgusu kesin kuralı göstermiyor; sentetik alarm teslim kanıtı yok | `deferred` — taşıma sonrası | Orta |
| M-06 | CI image provenance/SBOM/imza eksik | Actions/base image pinleri mevcut; prod image sunucuda exact SHA'dan yeniden build ediliyor | `deferred` — yeni dış servis eklenmeden ayrıca tasarlanacak savunma derinliği | Yüksek |
| L-01 | Public availability unknown alanları strip ediyor | Middleware şeması ve kırmızı→yeşil hedefli regresyon | `suppressed` — `.strict()` ile düzeltildi | Yüksek |
| L-02 | CSP stil/font/görsel yüzeyi geniş | Canlı HTTP/2 başlık ve `deploy/nginx.conf`; script-src inline değil | `reportable` düşük savunma derinliği | Yüksek |
| L-03 | Secret/key ignore denylisti eksik | `git check-ignore` ve `.dockerignore` regresyonu | `suppressed` — düzeltildi | Yüksek |
| L-04 | CI Node/PostgreSQL hareketli major | Canlı digest-pinned backendde Node `22.23.2`; production PostgreSQL digesti repo ile eşleşiyor | `suppressed` — CI kesin sürüm/digest ile sabitlendi | Yüksek |
| L-05 | Pasif/bilinmeyen salon için 404 yok | Public SQL fonksiyonu yalnız boolean occupancy döndürüyor; bilinmeyen ve boş aktif salon aynı `false` sonucunu verir | `not_applicable` — varlık sızıntısı değil, ürün semantiği | Yüksek |

### Açık orta bulgular — sunucu taşıması sonrası

1. **File-backed secret aktivasyonu ve rotasyon:** Opt-in `*_FILE` altyapısı hazırdır; yeni sunucuda overlay açılmalı, sırlar kontrollü döndürülmeli ve iki eski `.env.production*` kopyası doğrulanmış prosedürle temizlenmelidir.
2. **Alarm ve firewall kanıtı:** Yeni sunucunun kesin firewall kural seti yetkili salt-okunur denetimle görülmeli; uptime/5xx/DB/disk/sertifika/yedek alarmının sorumluya ulaştığı sentetik olayla kanıtlanmalıdır.
3. **Supply-chain provenance:** Yeni dış servis eklemeden CI'da prod image build, yerel SBOM/provenance üretimi ve sunucuda yeniden build yerine doğrulanmış artefakt kullanımı ayrıca tasarlanmalıdır. Bu madde mevcut dört yüksek canlı riskin önüne geçmez.

### Açık düşük / savunma derinliği

- CSP script yüzeyi kontrollüdür; ancak `style-src 'unsafe-inline'`, Google Fonts ve geniş `img-src https:` devam eder. Mevcut görsel/font sözleşmesi nedeniyle bu turda davranış değiştirilmedi.

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
| Kök `npm run test:quick` | Bu güncellemeden sonra geçti; frontend statik kontroller, **30/30** responsive test, backend build/typecheck/auth hedefi |
| Public availability strict regresyonu | Düzeltme öncesi kırmızı, düzeltme sonrası **1/1 geçti**; bilinmeyen query alanı 400/AppError ile reddediliyor |
| Dependency/ignore/CI pin regresyonları | **3/3 geçti** |
| `backend npm run test:quick` | **60/60 geçti**; build ve test typecheck geçti |
| `backend npm run test:integration` | Temiz PostgreSQL 17 üzerinde 24 migration, **11/11 geçti** |
| Sentetik runtime DB rolü testi | **2/2 geçti**; gerekli CRUD çalıştı; DDL, audit mutasyonu, `_prisma_migrations`, RLS state/setter ve çapraz tenant erişimi reddedildi |
| Kök ve backend `npm audit --json` | **0 bulgu** |
| `npm audit signatures` | Kök 211 imza/40 attestation; backend 167 imza/23 attestation doğrulandı |
| File-secret ve backup shell regresyonları | **8/8 geçti**; conflict, boyut/içerik/tür/symlink ve legacy cleanup sınırları doğrulandı |
| Operations security testleri | **7/7 geçti**; güvenli runbook, iki replika, deploy rollback/enforcement sırası dahil |
| Production Compose sentetik config | Güncel zorunlu alanlarla base Compose geçti; secret overlay önceki doğrulamada geçti ve canlıda etkinleştirilmedi |
| Backend/frontend/migrate image build | Önceki düzeltme paketinde geçti; bu turda Dockerfile/Compose davranışı değişmediği için yeniden build edilmedi |
| Production hardening Playwright testi | Bu güncellemeden sonra **1/1 geçti** |
| Nginx config | `nginx -t` geçti |
| Son canlı health/TLS/header | HTTP/2 200, HTTP→HTTPS 308, HSTS/CSP/nosniff/SAMEORIGIN/Referrer/Permissions başlıkları ve API `database=connected` yeniden doğrulandı |
| Son canlı PII/RLS kontrolü | Legacy plaintext ve eksik envelope `0`; üç constraint validated; 15 RLS tablo, enforcement `true`, runtime bağlantıları mevcut |
| Firewall | Yetki nedeniyle doğrulanamadı |

## Canlıya geçiş için zorunlu kapanış sırası

1. **Taşıma sonrası:** Yeni şifreli/off-site yedeği restore ederek doğrula; plaintext dump'lar için maruziyet değerlendirmesi yap ve pasif cleanup kapısını yetkili prosedürle aç.
2. **Taşıma sonrası:** Off-site immutable yedek, ayrı key escrow ve PITR kur; off-site restore tatbikatı ile RPO/RTO'yu kaydet.
3. **Taşıma sonrası:** Traefik Docker socket erişimini socket-proxy/allowlist ile daralt; root/read-write/capability ve shared-host blast radius'ını azalt.
4. **Taşıma sonrası:** Tek host/tek PostgreSQL kesinti noktasını failover/replication ile kaldır veya risk sahibinin süreli, yazılı kabulünü al; iç servis mTLS kararını yeni topolojide uygula.
5. **Taşıma sonrası:** File-secret overlay'i kontrollü aç; sırları döndür ve eski `.env.production*` kopyalarını doğrulanmış prosedürle temizle.
6. Yeni sunucuda güncel `origin/main` revisionını güvenli exact-SHA workflow'uyla dağıt; migration, PII, RLS, MFA, retention ve public strict doğrulamasını salt-okunur kanıtlarla tekrarla.
7. Firewall kural setini yetkili salt-okunur denetimle doğrula; alarm zincirini sentetik olayla kanıtla.
8. `canliya-gecis-kontrol-listesi.md` içindeki P0-02–P0-07 maddelerini yeni sunucu kanıtlarıyla kapat. Bu dosyanın mevcut kararı da hâlâ `NO-GO`dur (`canliya-gecis-kontrol-listesi.md:8,49-116,259-270`).

## Sonuç

Uygulama kodu sıradan bir web uygulamasının belirgin biçimde üzerinde güvenlik olgunluğuna sahiptir ve repo/CI kapsamında güçlü bir release candidate'tır. `9932fb0` revisionı production üzerinde tekrar doğrulandı; 24 migration, validated PII constraintleri, RLS enforcement, runtime rolü, şifreli PII ve günlük yedek akışı canlı kanıtla uyumludur. Bu rapor güncellemesinde ayrıca public unknown-field reddi, güvenli runbook, secret denylisti ve kesin CI runtime pinleri tamamlandı. Canlıda plaintext veritabanı yedekleri, Docker socket bağlı zayıf sertleştirilmiş ortak Traefik, off-site/PITR eksikliği ve tek-host/tek-DB mimarisi yüksek risk olmaya devam ediyor.

**Son karar: 7,6/10 — NO-GO. Repo bulguları büyük ölçüde kapatılmıştır; taşıma sonrasına ertelenen canlı riskler kapanmadan veya yetkili ve süreli risk kabulüyle telafi edilmeden koşulsuz canlı onayı verilmemelidir.**
