# Self-hosted üretim kurulumu

## Gereksinimler

- Alan adının A kaydı sunucunun genel IP adresine yönlenmeli.
- Sunucuda Docker Compose ve harici `edge_proxy` ağı çalışmalı.
- Traefik v3, `mytlschallenge` sertifika çözücüsünü sağlamalı.
- GitHub production environment içinde sunucu bilgileri, SSH anahtarı ve doğrulanmış
  `SERVER_HOST_FINGERPRINT` secret'ı tanımlanmalı.
- DNS hazırlanana kadar GitHub production `PUBLIC_HEALTHCHECK_MODE` variable'ı `pre-dns`, DNS ve
  geçerli TLS hazır olduktan sonra `strict` olmalı. Variable yoksa güvenli varsayılan `strict`tir.

`deploy/edge-proxy.compose.yaml`, sunucudaki `/opt/edge-proxy/compose.yaml` için kanonik
güvenlik sözleşmesidir. Traefik Docker socket'ini doğrudan bağlamaz; yalnız Traefik ile non-root
socket proxy'nin yer aldığı `internal` ağ üzerinden exact method/path allowlist'i kullanır.
`/opt/edge-proxy/.env` yalnız `deploy/edge-proxy.env.example` içindeki `ACME_EMAIL` ve
`DOCKER_GID` adlarını sağlamalı; `DOCKER_GID` değeri sunucuda
`stat -Lc '%g' /var/run/docker.sock` ile doğrulanmalıdır. Edge proxy değişikliğini etkinleştirmeden
önce şu salt okunur parse kontrolünü çalıştırın:

```bash
sudo docker compose --env-file /opt/edge-proxy/.env \
  -f /opt/edge-proxy/compose.yaml config -q
```

Sunucudaki `/etc/ssh/sshd_config.d/00-dugun-restrictions.conf`, izlenen
`deploy/ssh/00-dugun-restrictions.conf` dosyasıyla birebir eşleşmeli ve `root:root 600` olmalıdır.
Değişiklik yalnız `sudo sshd -t` ile sözdizimi, `sudo sshd -T` ile etkili değerler doğrulandıktan
sonra `sudo systemctl reload ssh` ile etkinleştirilmelidir; mevcut kurtarma oturumu yeni public-key
bağlantısı ve `sudo -n` doğrulanana kadar kapatılmamalıdır.

## İlk kurulum

```bash
install -m 600 .env.production.example .env.production
# .env.production içindeki alan adını, boş sırları ve canlı ödeme bilgilerini doldurun.
# İki veritabanı parolası birbirinden farklı, URL-güvenli ve en az 20 karakter olmalıdır.
# DATA_ENCRYPTION_KEY ve ondan farklı BACKUP_ENCRYPTION_KEY için ayrı ayrı: openssl rand -hex 32
# TRUST_PROXY değerini edge_proxy ağındaki sabit Traefik container IP'si olarak ayarlayın.
# PAYMENT_MODE=live kullanın; banka, hesap sahibi, IBAN ve WhatsApp alanlarının beşi de zorunludur.
docker compose --env-file .env.production -f compose.production.yaml \
  -f compose.production.secrets.yaml config -q
docker compose --env-file .env.production -f compose.production.yaml \
  -f compose.production.secrets.yaml \
  up -d --build --wait --scale backend=2
docker compose --env-file .env.production -f compose.production.yaml \
  -f compose.production.secrets.yaml --profile bootstrap run --rm seed
```

Compose; PostgreSQL'i yalnız izole Docker ağına açar, migration'ları çalıştırır, backend
healthcheck'i başarılı olduktan sonra frontend'i yayına alır. Traefik HTTPS sertifikasını
otomatik üretir ve `/api/v1` isteklerini backend'e yönlendirir. `seed` komutu yalnız ilk
kurulumda çalıştırılır; başlangıç paketi, hizmetleri ve salonları idempotent olarak hazırlar.

`POSTGRES_USER` yalnız migration, yedekleme ve geri yükleme için veritabanı sahibi olarak
kullanılır. Backend, seed ve admin bootstrap işlemleri `POSTGRES_RUNTIME_USER` ile bağlanır.
Runtime rolü şema oluşturamaz/değiştiremez; mevcut tablolarda gereken okuma/yazma ve yalnız
oturum temizliği için silme yetkisine sahiptir. Rol hazırlama adımı her dağıtımda idempotent
çalışır ve yeni migration nesneleri için default privilege kurallarını yeniden doğrular.

`edge_proxy` ağı yalnız Traefik ile bu uygulamanın frontend/backend container'larını içermelidir.
Traefik'e bu ağda sabit bir IP verin, aynı kesin IP'yi `TRUST_PROXY` olarak kullanın ve Traefik
`forwardedHeaders.insecure` ayarını etkinleştirmeyin. Sayısal `TRUST_PROXY=1` kullanımı, ağa
erişebilen başka bir container'ın istemci IP başlığını sahtelemesine izin verebilir.

### API giriş katmanı trafik sınırları

Traefik, `/api/v1` trafiğini backend'e aktarmadan önce IP tabanlı token-bucket hız sınırını ve
alan adı genelindeki eşzamanlı istek sınırını uygular. Varsayılanlar IP başına saniyede ortalama
20 istek, 40 istek burst, IPv6 için `/56` gruplama ve aynı anda 50 API isteğidir:

```dotenv
EDGE_RATE_LIMIT_AVERAGE=20
EDGE_RATE_LIMIT_PERIOD=1s
EDGE_RATE_LIMIT_BURST=40
EDGE_RATE_LIMIT_IPV6_SUBNET=56
EDGE_INFLIGHT_REQUESTS=50
```

Bu değerler uygulama içindeki daha dar login ve başvuru kotalarının yerine geçmez. Dağıtımdan
sonra Traefik `429` yanıtlarını, API gecikmesini ve backend CPU/bellek kullanımını izleyin.
Gerçek kullanıcıların ortak NAT altında engellendiği görülürse önce `burst` değerini kontrollü
artırın; sürekli yük kapasitesi doğrulanmadan `average` veya eşzamanlı istek sınırını büyütmeyin.
Değişiklik öncesinde her zaman `docker compose ... config -q` çalıştırın. Acil geri dönüşte
önceki doğrulanmış compose revizyonuna dönüp `up -d` uygulayın; uygulama içi kotaları kapatmayın.

İlk admin parolasını dosyaya veya komut geçmişine yazmadan, etkileşimli olarak oluşturun:

```bash
read -r -p "Ilk admin kullanici adi: " ADMIN_BOOTSTRAP_USERNAME
read -r -s -p "Ilk admin parolasi (en az 15 karakter): " ADMIN_BOOTSTRAP_PASSWORD
printf '\n'
export ADMIN_BOOTSTRAP_USERNAME ADMIN_BOOTSTRAP_PASSWORD
docker compose --env-file .env.production -f compose.production.yaml \
  --profile admin-bootstrap run --rm \
  -e ADMIN_BOOTSTRAP_USERNAME -e ADMIN_BOOTSTRAP_PASSWORD admin-bootstrap
unset ADMIN_BOOTSTRAP_USERNAME ADMIN_BOOTSTRAP_PASSWORD
```

Bootstrap yalnız sistemde hiç admin yokken çalışır. Hesap ilk oturum açılışında parola değişikliği
ister; girilen parola Compose dosyasına, image'a veya `.env.production` dosyasına kaydedilmez.

## Güncelleme

Normal üretim güncellemesi yalnız `.github/workflows/deploy.yml` üzerinden yapılır. Workflow,
kalite kapısından geçen güncel `main` revisionını exact SHA ile doğrular ve sunucuda
`deploy/deploy-production.sh` betiğini çalıştırır. Betik; şifreli yedek/restore provası, migration,
runtime rolü, iki backend replikası, sağlık kontrolü, RLS enforcement, retention ve otomatik
uygulama rollback kapılarını birlikte uygular. Sunucuda elle `git pull` veya doğrudan
`docker compose up` ile bu kapıları atlamayın.

### Mevcut volume'u DDL yetkisiz runtime rolüne yükseltme

Bu sürümden önce oluşturulmuş volume'u silmeyin veya yeniden başlatmayın. Önce yedek alın;
`.env.production` dosyasına `POSTGRES_RUNTIME_USER=dugun_runtime` ve mevcut owner parolasından
farklı güçlü bir `POSTGRES_RUNTIME_PASSWORD` ekleyin. Ardından migration ve idempotent rol
hazırlığını sırayla çalıştırın:

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --wait postgres
docker compose --env-file .env.production -f compose.production.yaml run --rm --build migrate
docker compose --env-file .env.production -f compose.production.yaml run --rm db-role-bootstrap
```

Runtime bağlantısıyla yalnız beklenen izinlerin bulunduğunu doğrulayın; parola komut satırına
yazılmaz ve çıktı içinde gösterilmez:

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps \
  --entrypoint sh db-role-bootstrap -c \
  'PGPASSWORD="$POSTGRES_RUNTIME_PASSWORD" psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_RUNTIME_USER" -d "$POSTGRES_DB" -c "SELECT has_database_privilege(current_user, current_database(), \$\$CREATE\$\$) AS database_create, has_schema_privilege(current_user, \$\$public\$\$, \$\$CREATE\$\$) AS schema_create, has_table_privilege(current_user, \$\$public.users\$\$, \$\$SELECT\$\$) AS users_select;"'
```

Beklenen sonuç `database_create = false`, `schema_create = false`, `users_select = true`'dur.
Gerçek DDL denemesi de transaction içinde reddedilmelidir; komut parola değerini yazdırmaz:

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps \
  --entrypoint sh db-role-bootstrap -c \
  'if PGPASSWORD="$POSTGRES_RUNTIME_PASSWORD" psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_RUNTIME_USER" -d "$POSTGRES_DB" -c "BEGIN; CREATE TABLE public.__runtime_ddl_probe(id integer); ROLLBACK;"; then echo "HATA: runtime DDL uygulayabildi" >&2; exit 1; else echo "Beklenen: runtime DDL reddedildi"; fi'
```

Kontroller başarılıysa backend ve frontend'i normal exact-SHA workflow'u üzerinden güncelleyin;
doğrudan `docker compose up` kullanmayın.

## Yedekleme ve geri yükleme tatbikatı

Dağıtım betiği migration öncesinde veritabanı ve host boş alanını ölçer. Yeterli alan yoksa fail-closed
durur. Custom-format dump, ayrı `BACKUP_ENCRYPTION_KEY` ile sürümlü başlık ve rastgele IV kullanan
AES-256-GCM akışına doğrudan şifrelenir; düz metin kalıcı yedek dosyası oluşturulmaz. Anahtar boş,
örnek/zayıf veya `DATA_ENCRYPTION_KEY` ile aynıysa dağıtım başlamaz.

Her şifreli yedek production verisine dokunmayan rastgele adlı geçici bir veritabanına
`pg_restore --exit-on-error --no-owner --no-acl` ile gerçekten geri yüklenir ve public tablolar
doğrulanır. Tatbikat tamamlanınca geçici veritabanı silinir. Başarılı dağıtımdan sonra 30 günden eski
veya en yeni 30 dosyanın dışındaki `pre-deploy-*.dump.gcm` yedekler güvenli kapsam kontrolüyle
temizlenir. Legacy düz metin yedek temizliği varsayılan olarak kapalıdır. Sunucu taşıması sonrası,
yeni şifreli yedeğin bağımsız restore testi ve operatör onayı tamamlandıktan sonra GitHub production
environment içinde `LEGACY_PLAINTEXT_BACKUP_CLEANUP=1` tanımlanabilir. Bu kapı yalnız 7-40
karakterlik SHA kullanan `pre-deploy-*.dump` ve eski `dugun-ajansim-YYYYMMDD-HHMMSS.dump`
adlarını; normal dosya, dizin sınırı ve symlink kontrollerinden sonra kaldırır. Diğer retention
değerleri workflow environment değişkenleriyle daraltılabilir.

Yeni sürüm sağlık kontrollerini geçemezse Git SHA ile backend/frontend image referansları önceki
doğrulanmış sete otomatik döndürülür. Veritabanı migration'ı veya production verisi otomatik geri
alınmaz; migration'lar expand/contract uyumlu olmalı, veri geri yükleme ise yazma kaybı riski nedeniyle
operatör onayıyla yapılmalıdır.

Yerel retention, host veya disk kaybına karşı koruma değildir. `*.dump.gcm` dosyalarını ve ilgili
anahtar sürümünü erişimi kısıtlı, sunucu dışı ve immutable depolamaya ayrıca kopyalayın; en az üç
ayda bir bu kopyadan bağımsız restore tatbikatı yapın.

Personel fotoğrafları `staff_photo_data` Docker volume'ünde tutulur ve veritabanı yedeğine dahil
değildir. Bu volume'ü de erişimi kısıtlı, şifreli ve sunucu dışı yedekleme politikasına dahil edin;
veritabanı ile fotoğraf volume yedeğini aynı zaman damgasıyla eşleştirin.

## Kontrol

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
curl -fsS "https://dugunajansim.com/healthz"
curl -fsS "https://dugunajansim.com/api/v1/health"
```

`.env.production` dosyasını repoya eklemeyin. `DATA_ENCRYPTION_KEY` değişirse mevcut şifreli
teslimat bağlantıları, `BACKUP_ENCRYPTION_KEY` değişirse eski yedekler çözülemez; iki anahtarı ayrı
ve güvenli bir parola kasasında sürümlü olarak yedekleyin.
Dosyanın izinlerini `stat -c '%a %n' .env.production` ile kontrol edin; beklenen izin `600`'dür.

## Sunucu taşıması sonrası file-backed secret geçişi

`compose.production.secrets.yaml` production için zorunlu overlay'dir ve `USE_FILE_SECRETS=1`
olmalıdır. Secret dosyaları normal dosya olarak yalnız dağıtım kullanıcısının okuyabileceği
izinlerle hazırlanmalı; Compose bind-mount secret'larının container içindeki non-root süreçlerce
okunabilmesi için dosyalar `0444`, onları çevreleyen secret kökü ise `0700` olmalıdır. Böylece host
üzerindeki diğer kullanıcılar dizini geçemezken container süreçleri salt okunur mountu okuyabilir.
`.env.production` içindeki doğrudan secret alanları boş kalmalıdır.
`PRODUCTION_SECRET_ROOT` altındaki dizin ve dosyalar dağıtım kullanıcısına ait olmalıdır. `/run`
kullanılıyorsa dosyalar root erişimli kalıcı kaynaktan Docker başlamadan önce yeniden
oluşturulmalıdır. Alternatif olarak dağıtım kullanıcısının home dizininde rebootta kalıcı,
`0700` izinli bir dizin seçilip tüm `*_SECRET_FILE` yolları aynı köke yönlendirilebilir.

Uygulama ve yardımcı betikler yalnız allowlist'teki `*_FILE` değişkenlerini kabul eder. Doğrudan
değer ile karşılık gelen `_FILE` aynı anda verilirse; dosya boşsa, aşırı büyükse, NUL içeriyorsa,
symlink ise veya normal dosya değilse işlem fail-closed durur. Overlay etkinleştirilmeden önce yeni
secret seti ve şifreli yedek restore testi doğrulanmalıdır. Canlı aktivasyon, anahtar rotasyonu ve
eski `.env` secret değerlerinin temizlenmesi sunucu taşıması sonrası ayrı operasyon adımıdır.

## DNS öncesi doğrulama

İlk sunucu hazırlığında `PUBLIC_HEALTHCHECK_MODE=pre-dns`, domaini yalnız hedef hostun
`127.0.0.1:443` Traefik girişine `curl --resolve` ile bağlar. Sertifika doğrulaması yalnız bu yerel
pre-DNS kontrolde kapatılır; frontend ve API routerları yine gerçek domain Host/SNI değeriyle
doğrulanır. DNS A/AAAA kaydı hedef IP'ye taşınıp ACME sertifikası üretildikten sonra variable
`strict` yapılmalı; böylece sonraki deploy ve watchdog kontrolleri gerçek DNS ve TLS zincirini
zorunlu tutar.
