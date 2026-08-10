# Self-hosted üretim kurulumu

## Gereksinimler

- Alan adının A kaydı sunucunun genel IP adresine yönlenmeli.
- Sunucuda Docker Compose ve harici `edge_proxy` ağı çalışmalı.
- Traefik v3, `mytlschallenge` sertifika çözücüsünü sağlamalı.
- GitHub production environment içinde sunucu bilgileri, SSH anahtarı ve doğrulanmış
  `SERVER_HOST_FINGERPRINT` secret'ı tanımlanmalı.

## İlk kurulum

```bash
install -m 600 .env.production.example .env.production
# .env.production içindeki alan adını, boş sırları ve canlı ödeme bilgilerini doldurun.
# İki veritabanı parolası birbirinden farklı, URL-güvenli ve en az 20 karakter olmalıdır.
# DATA_ENCRYPTION_KEY ve ondan farklı BACKUP_ENCRYPTION_KEY için ayrı ayrı: openssl rand -hex 32
# TRUST_PROXY değerini edge_proxy ağındaki sabit Traefik container IP'si olarak ayarlayın.
# PAYMENT_MODE=live kullanın; banka, hesap sahibi, IBAN ve WhatsApp alanlarının beşi de zorunludur.
docker compose --env-file .env.production -f compose.production.yaml config -q
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml --profile bootstrap run --rm seed
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

Önce aşağıdaki yöntemle doğrulanmış bir yedek alın. Ardından:

```bash
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yaml config -q
docker compose --env-file .env.production -f compose.production.yaml up -d --build
```

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

Kontroller başarılıysa normal `up -d --build` komutuyla backend ve frontend'i güncelleyin.

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

## Kontrol

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
curl -fsS "https://dugun.n8n-mustafa.me/healthz"
curl -fsS "https://dugun.n8n-mustafa.me/api/v1/health"
```

`.env.production` dosyasını repoya eklemeyin. `DATA_ENCRYPTION_KEY` değişirse mevcut şifreli
teslimat bağlantıları, `BACKUP_ENCRYPTION_KEY` değişirse eski yedekler çözülemez; iki anahtarı ayrı
ve güvenli bir parola kasasında sürümlü olarak yedekleyin.
Dosyanın izinlerini `stat -c '%a %n' .env.production` ile kontrol edin; beklenen izin `600`'dür.
