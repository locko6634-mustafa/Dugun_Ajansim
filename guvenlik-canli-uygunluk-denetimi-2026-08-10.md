# Düğün Ajansım Güvenlik ve Canlıya Uygunluk Denetimi

**Tarih:** 10 Ağustos 2026

**İncelenen yerel revision:** `f1b579bab35746861839bbac6d4a42b2662c167d`

**İncelenen canlı revision:** `f1b579bab35746861839bbac6d4a42b2662c167d`

**Yöntem:** Yerel kaynak/yapılandırma/test incelemesi ve SSH MCP üzerinden canlı ortamda salt-okunur doğrulamalar

**Codex Security:** Kullanılmadı

## Yönetici özeti

**Nihai karar: NO-GO — sistem çalışır durumda olsa da mevcut güvenlik ve operasyon riskiyle koşulsuz canlı onayı verilmemelidir.**

Canlı frontend, iki backend replikası ve PostgreSQL sağlıklıdır; yerel ve canlı revision aynıdır. TLS, HTTP→HTTPS yönlendirmesi, HSTS, temel güvenlik başlıkları, Turnstile, kesin `TRUST_PROXY`, container sertleştirmesi ve PII şifreleme durumu canlıda olumlu doğrulanmıştır. Yerel backend testleri 59/59, veritabanı entegrasyon testleri 6/6 geçmiş; frontend ve backend bağımlılık denetimleri 0 açık vermiştir.

Buna rağmen canlı yedek dizininde iki adet boş olmayan **düz metin PostgreSQL dump** bulunmuştur. Ayrıca tüm yedekler aynı hosttadır; otomatik off-site immutable kopya ve PITR yoktur. İnternete açık ortak Traefik container'ı root kullanıcıyla, yazılabilir root filesystem ile ve Docker socket bağlı şekilde çalışmaktadır. Tek fiziksel host/tek PostgreSQL mimarisi de devam etmektedir. Bu dört yüksek risk kapanmadan canlı kabulü önerilmez.

### Puan

| Alan | Puan |
| --- | ---: |
| Yerel uygulama ve kaynak güvenliği | **8,7 / 10** |
| Canlı altyapı ve operasyon güvenliği | **6,2 / 10** |
| **Genel mevcut güvenlik duruşu** | **7,4 / 10** |

Genel puan yalnız aritmetik ortalama değildir; canlıda doğrulanan yüksek etkili yedek ve container yönetim riskleri puana üst sınır uygulamıştır.

## Kapsam ve sınırlamalar

İnceleme aşağıdakileri kapsadı:

- Önceki üç rapor: `guvenlik-analiz-raporu-2026-08-09.md`, `guvenlik-denetim-raporu-2026-08-09.md`, `guvenlik-duzeltmeleri-2026-08-09.md`.
- Backend auth/session/MFA/CSRF/RBAC/tenant filtreleri, Zod doğrulama, kriptografi, hata/audit ve rate-limit katmanı.
- Prisma şeması, 20 migration, gerçek PostgreSQL entegrasyon testleri ve runtime rolü.
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
| Revision | Canlı `main`, yerel/origin ile aynı ve çalışma ağacı temiz: `f1b579b...` |
| Containerlar | 2 backend, 1 frontend ve 1 PostgreSQL çalışıyor ve `healthy` |
| Port yüzeyi | Dışarıya dinleyen TCP portları 22, 80 ve 443; uygulama/PostgreSQL host portu yayımlanmıyor |
| Container sertleştirmesi | Backend `node`, frontend `nginx`; read-only rootfs, non-privileged, `cap_drop=ALL`, `no-new-privileges`; PostgreSQL süreçleri UID 70 ile çalışıyor |
| TLS | HTTP/2 200; HTTP 301 ile HTTPS'e yönleniyor; Let's Encrypt sertifikası 27 Ekim 2026'ya kadar geçerli |
| Başlıklar | HSTS 1 yıl + subdomains, CSP, `nosniff`, `SAMEORIGIN`, Referrer-Policy ve Permissions-Policy mevcut |
| Turnstile | Public katalogda `enabled=true`, beklenen action ile etkin |
| Proxy güveni | `.env.production` `TRUST_PROXY` değeri canlı Traefik `edge_proxy` IP'siyle birebir eşleşiyor |
| Ortam dosyası | Gerekli production alanları değerler gösterilmeden `SET`; `.env.production` modu `600` |
| Migration | Canlı veritabanında 20 migration uygulanmış |
| PII | 65 başvuru, 56 düğün ve 63 mesaj kaydında şifrelenmemiş zarf ve legacy plaintext sayısı `0` |
| PII constraint | Üç PII envelope constrainti mevcut fakat `convalidated=false` |
| RLS | Public şemada RLS etkin tablo sayısı `0` |
| Yedek | Güncel `.dump.gcm` yedek ve restore-test izi var; dizin `700`, dosyalar `600` |
| Host bakımı | Ubuntu 22.04.5 LTS; unattended upgrades etkin, Fail2ban ve Netdata aktif; disk kullanımı %32 |
| Firewall | `ufw status` root yetkisi istedi; kesin kural seti doğrulanamadı |

## Önceki rapor bulgularının güncel durumu

| # | Önceki bulgu | Güncel durum | Kanıt / değerlendirme |
| ---: | --- | --- | --- |
| 1 | Hatalı MFA denemeleri login kotasından düşüyordu | **Çözüldü** | Yalnız `<400` tam giriş başarı sayılıyor; yanlış/eksik TOTP 401 kalıyor. `backend/src/routes/auth.routes.ts:73-97,192-205`; regresyon `backend/tests/backend.test.ts:108-114`. |
| 2 | Tek host/tek PostgreSQL ve failover yok | **Sunucu taşıması sonrasına ertelendi** | İki backend replika ve watchdog var; ikisi de aynı host ve aynı PostgreSQL'e bağlı. Bu oturumda HA/failover değişikliği yapılmayacak. `compose.production.yaml:316-409`; `deploy/deploy-production.sh:525`. |
| 3 | Yedek yalnız deploy öncesi ve aynı hostta | **Repo koruması bu oturumda; canlı işlemler taşıma sonrası** | Legacy plaintext dosyaları güvenli biçimde tanıyacak pasif-varsayılanlı repo koruması hazırlanacak. Canlı dosya silme, off-site/PITR ve anahtar değerlendirmesi taşıma sonrasına ertelendi. `.github/workflows/production-backup.yml:3-52`; `deploy/deploy-production.sh:467-516`. |
| 4 | Backend dependency audit CI kapısında değildi | **Çözüldü** | Kök ve backend audit workflow'da çalışıyor; güncel auditler 0 bulgu. `.github/workflows/quality.yml:19-20,65-66`; `backend/package.json:21`. |
| 5 | Public formda bot doğrulama/idempotency/iletişim kotası yoktu | **Çözüldü** | Production Turnstile fail-closed, zorunlu UUID idempotency ve iletişim bazlı paylaşımlı kota var; canlı Turnstile etkin. `backend/src/utils/turnstile.ts:30-93`; `backend/src/routes/public.routes.ts:70-85,216-251`. |
| 6 | Rate-limit process-local ve ana iş DB'sine bağımlıydı | **Kısmi** | Kritik sayaçlar atomik/HMAC'li PostgreSQL store ve production fail-closed; global/availability limitleri hâlâ process-local, kritik sayaçlar iş DB'sini kullanıyor. `databaseRateLimitStore.ts:29-66`; `security.middleware.ts:83-96`; `public.routes.ts:61-68`. |
| 7 | PII tam/E2EE değildi | **Kabul edilmiş tasarım sınırı — açık değil** | Temel PII güçlü biçimde şifreli; iş metadata'sı açık ve backend anahtara sahip olduğundan E2EE değildir. Sunucu-tarafı işleme gereksinimi kabul edilmiştir; güvenlik açığı olarak kapatılmıştır. |
| 8 | Legacy plaintext PII ve production strict eksikliği | **Veri düzeyinde çözüldü, constraint kısmi** | Canlı toplu sayımlarda legacy plaintext `0`; healthy production API strict moda işaret ediyor. Üç `NOT VALID` constraint hâlâ validate edilmemiş. `env.config.ts:341-347`; migration `20260809150000...:51-135`. |
| 9 | KMS/HSM/Docker Secrets yok | **Repo desteği bu oturumda; canlı aktivasyon taşıma sonrası** | Allowlist tabanlı opt-in file-backed secret desteği hazırlanacak. Canlı aktivasyon, anahtar rotasyonu ve eski env kopyalarının temizliği sunucu taşıması sonrasına ertelendi. |
| 10 | DB RLS yok, tenant sınırı uygulama filtrelerine bağlı | **Çözülmedi** | Canlı RLS sayısı `0`. Runtime rolü least-privilege ve app tenant filtreleri güçlü; DB ikinci bariyeri yok. `deploy/postgres/init-runtime-role.sh:74-126`. |
| 11 | 72 saatlik setup/reset tokenı ve müşteri MFA eksikliği | **Çözülmedi** | Token CSPRNG/hash/tek kullanım açısından güçlü; varsayılan TTL hâlâ 72 saat ve MFA ayrıcalıklı rollerle sınırlı. `env.config.ts:258-262`; `auth.middleware.ts:57-63`. |
| 12 | Payment capability `sessionStorage` içindeydi | **Çözüldü** | Capability HttpOnly/Secure/SameSite=Strict cookie'de; frontend storage yalnız application UUID tutuyor. `public.routes.ts:33-49,253-257`; `application.js:81-83`. |
| 13 | Audit temizliği ve runtime DB rolü fazla yetkiliydi | **Asıl bulgu çözüldü; CI savunma-derinliği boşluğu açık** | Runtime rolü DDL/superuser/BYPASSRLS değil; audit UPDATE/DELETE/TRUNCATE gerçek PostgreSQL testinde reddedildi. Eklenecek CI testi bu yetki sınırını sürekli doğrulayan kalite kapısıdır. |
| 14 | Public istek sınırsız global sweep tetikleyebiliyordu | **Çözüldü** | Hedefli sweep, 100 kayıt sınırı ve advisory lock var. `booking.service.ts:615-677`. |
| 15 | HTTP/DB timeout ve container kaynak sınırı yoktu | **Çözüldü** | Node/DB timeoutları, CPU/RAM/PID/log sınırları ve healthcheckler mevcut ve canlı containerlarda uygulanmış. |
| 16 | WhatsApp URL'sinde PII ve RNG fail-open | **Çözüldü** | URL'den PII çıkarılmış, CSPRNG fail-closed ve tek kullanımlık bağlantı akışı var. |
| 17 | Veri yaşam döngüsü/retention yoktu | **Kısmi** | Bounded, transaction'lı retention kodu var; fakat yalnız deploy sonunda çağrılıyor, bağımsız zamanlayıcı yok. `compose.production.yaml:277-314`; `deploy-production.sh:560-564`. |
| 18 | İç container ağında mTLS yoktu | **Sunucu taşıması sonrasına ertelendi** | PostgreSQL izole internal networkte ve host portu yok; servisler arası mTLS kararı yeni sunucu topolojisi üzerinde yeniden değerlendirilecek. Bu oturumda değişiklik yapılmayacak. |
| 19 | Yönetilebilir görsel/teslim URL allowlist eksikti | **Çözüldü** | Görsel yolu local asset regex'i, teslimat URL'si HTTPS Google Drive allowlist'i ile sınırlı. `api.schemas.ts:46-53`; `utils/domain.ts:127-146`. |

## Güncel açık bulgular

### Yüksek

#### H-01 — Canlıda iki boş olmayan düz metin PostgreSQL yedeği var

SSH doğrulamasında `backups/` altında şifreli `.dump.gcm` dosyalarının yanında iki boş olmayan `.dump` dosyası `file` ile PostgreSQL custom database dump olarak doğrulandı. Dosyalar `600`, dizin `700`; bu dış kullanıcı erişimini azaltır fakat host/kullanıcı hesabı ele geçirilmesi, yanlış kopyalama veya sunucu yedeği sırasında müşteri verisinin şifresiz açığa çıkmasını engellemez.

Kod yalnız 40 karakter SHA'lı `pre-deploy-*.dump` kalıbını siliyor; eski kısa SHA ve `dugun-ajansim-*.dump` adlarını kapsamıyor. `deploy/deploy-production.sh:226-251`. Önceki rapordaki “eski plaintext yedekler kaldırıldı” iddiası canlı için yanlıştır.

**Kapanış:** Yetkili bakım penceresinde dosyaların sahipliği/kullanımı ve olası kopyaları incelenmeli; doğrulanmış şifreli/off-site yedek sonrasında güvenli silme yapılmalı, gerekirse maruziyet ve anahtar döndürme değerlendirmesi açılmalı. Cleanup testi tüm legacy adlarını kapsamalıdır.

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
2. **Retention zamanlanmıyor:** Temizlik yalnız başarılı deploy sonunda çalışıyor. Uzun süre deploy olmazsa süre dolmuş kayıtlar kalır.
3. **DB RLS yok:** Uygulama tenant filtreleri güçlü olsa da runtime credential veya uygulama katmanı ihlalinde bütün tenant verileri aynı role açıktır.
4. **KMS/secret manager yok ve stale env kopyaları var:** Canlıda `.env.production` dışında iki owner-only eski `.env.production*` kopyası bulunuyor. Mod `600` olsa da eski/geçerli sırların kopya sayısını artırır.
5. **Rate-limit ana iş DB'sine bağlı:** Kritik limiter fail-closed olsa da saldırı trafiği iş sorgularıyla aynı PostgreSQL kaynağını tüketir; global/availability sayaçları iki backend arasında paylaşılmaz.
6. **PII constraint ve CI runtime rol boşluğu:** Canlı veri tamamen backfill/redact edilmiş görünür, fakat üç constraint validate edilmemiştir. CI entegrasyonu owner/superuser test rolüyle çalışır; gerçek runtime ACL/timeout/maintenance regresyonu sürekli kapıda değildir.
7. **Alarm ve firewall kanıtı eksik:** Netdata, Fail2ban ve unattended upgrades aktif; buna rağmen dış uptime/5xx/DB/disk/sertifika/yedek alarmının sorumluya ulaştığı ve firewall kural seti doğrulanamadı.
8. **Hesap kurtarma sertleştirmesi:** Müşteri setup/reset bağlantısı varsayılan 72 saat; müşteri MFA yok. Tek kullanım ve hash koruması etkiyi düşürür.
9. **Supply-chain kanıtı kısmi:** Prod base image ve Actions pinli; fakat CI prod image build+scan/SBOM/imza üretmiyor, kalite kontrolünden sonra image sunucuda yeniden build ediliyor.

### Düşük / savunma derinliği

- Public availability Zod `query/params` şemaları `.strict()` değil; bilinmeyen alanlar strip ediliyor. Pasif/bilinmeyen venue UUID için aynı 404 sözleşmesi de yok.
- CSP script yüzeyi kontrollü; `style-src 'unsafe-inline'`, harici fontlar ve geniş `img-src https:` devam ediyor.
- `.gitignore`/`.dockerignore`, `.npmrc`, `.p12/.pfx/.jks` ve tipik SSH private-key adlarını geleceğe dönük denylistte kapsamıyor; bugün izlenen böyle bir dosya yok.
- CI Node 22 ve PostgreSQL 17 hareketli major etiketleri kullanıyor; production image'ları digest pinli olduğu için etki düşük.
- Retention gerçek runtime DB entegrasyonunda test edilmiyor; arşiv düğünle silinen application sayısı audit sonucuna eklenmiyor. Bazı FK/retention sorgularında leading index eksikleri var.

## Güçlü güvenlik katmanları

- Ayrıcalıklı hesaplarda production MFA, replay koruması, güçlü parola, kısa idle/absolute session ve zorunlu ilk parola değişimi.
- Hashli session/CSRF/setup/payment tokenları; HttpOnly/Secure/SameSite cookie'ler ve authenticated mutasyonlarda CSRF.
- Backend route seviyesinde rol/tenant filtreleri ve negatif entegrasyon testleri.
- Zod allowlist, 10 KB body sınırı, HPP, CORS allowlist, CSP/Helmet ve katmanlı rate-limit.
- AES-256-GCM PII, kayıt/model/sürüm/key-id bağlı AAD, ayrı HMAC blind index ve anahtar rotasyonu.
- DDL'siz runtime DB rolü; audit UPDATE/DELETE/TRUNCATE reddi; transaction/advisory lock/constraint temelli yarış koruması.
- Non-root/read-only/capability'siz uygulama containerları, kaynak/PID/log sınırları ve iki sağlıklı backend replika.
- Exact-SHA deploy, pinned GitHub Actions/SSH fingerprint, digest-pinned production base image'ları ve frontend/backend audit kapısı.
- Canlı HTTPS, HSTS, güvenlik başlıkları, Turnstile, exact proxy trust, Fail2ban ve otomatik sistem güvenlik güncellemeleri.

## Doğrulama sonuçları

| Doğrulama | Sonuç |
| --- | --- |
| `backend npm run test:quick` | **59/59 geçti**; build ve test typecheck geçti |
| `backend npm run test:integration` | Temiz PostgreSQL 17 üzerinde 20 migration, **6/6 geçti** |
| Runtime DB rolü manuel PostgreSQL probesi | DDL/BYPASSRLS/superuser yok; audit mutasyonu reddedildi |
| Kök ve backend `npm audit --json` | **0 bulgu** |
| `npm audit signatures` | Kök 211 imza/40 attestation; backend 167 imza/23 attestation doğrulandı |
| Dependency/operations güvenlik testleri | **8/8 geçti** |
| Production Compose sentetik config | Geçti |
| Backend/frontend/migrate image build | Geçti; migrate image içinde 20 migration doğrulandı |
| Nginx config | `nginx -t` geçti |
| Canlı health/TLS/header | Geçti |
| Canlı PII aggregate kontrolü | Legacy plaintext `0`; envelope constraint validation açık |
| Firewall | Yetki nedeniyle doğrulanamadı |

## Canlıya geçiş için zorunlu kapanış sırası

1. Canlı plaintext dump'lar için maruziyet değerlendirmesi yap; yetkili ve doğrulanmış prosedürle kaldır, cleanup regresyon testi ekle.
2. Off-site immutable yedek + key escrow + PITR kur; off-site kopyadan restore tatbikatını ve RPO/RTO'yu kaydet.
3. Traefik Docker socket erişimini socket-proxy/allowlist ile daralt; root/read-write/capability ve shared-host blast radius'ını azalt.
4. `deploy/README.md` akışını yalnız güvenli `deploy-production.sh` yoluna yönlendir; ilk kurulumda iki backend replikasını garanti et.
5. Retention'ı deploydan bağımsız zamanla; gerçek runtime rolle PII verify/constraint validation/retention entegrasyonunu CI'a ekle.
6. Firewall kural setini yetkili salt-okunur denetimle doğrula; dış alarm zincirini sentetik olayla kanıtla.
7. Tek host/tek PostgreSQL için failover uygula veya risk sahibinin süreli, yazılı kabulünü al.
8. `canliya-gecis-kontrol-listesi.md` içindeki P0-02–P0-07 maddelerini güncel kanıtlarla kapat. Bu dosyanın mevcut kararı da hâlâ `NO-GO`dur (`canliya-gecis-kontrol-listesi.md:8,49-116,259-270`).

## Sonuç

Uygulama kodu sıradan bir web uygulamasının belirgin biçimde üzerinde güvenlik olgunluğuna sahiptir ve yerel olarak güçlü bir release candidate'tır. Canlı ortamda doğru revision, şifreli aktif PII, iki backend replika, TLS ve container hardening çalışmaktadır. Ancak mevcut canlı güvenlik duruşu **üretim için koşulsuz kabul edilemez**: plaintext veritabanı yedekleri, Docker socket bağlı zayıf sertleştirilmiş ortak Traefik, off-site/PITR eksikliği ve tek-host/tek-DB mimarisi yüksek risk oluşturur.

**Son karar: 7,4/10 — NO-GO. Yukarıdaki yüksek riskler kapanmadan veya yetkili ve süreli risk kabulüyle telafi edilmeden canlı onayı verilmemelidir.**
