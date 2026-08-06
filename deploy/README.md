# Self-hosted üretim kurulumu

## Gereksinimler

- Alan adının A kaydı sunucunun genel IP adresine yönlenmeli.
- Sunucuda Docker Compose ve harici `edge_proxy` ağı çalışmalı.
- Traefik, `mytlschallenge` sertifika çözücüsünü sağlamalı.

## İlk kurulum

```bash
install -m 600 .env.production.example .env.production
# .env.production içindeki alan adını düzenleyin; boş üç sırrı benzersiz değerlerle doldurun.
# İki veritabanı parolası birbirinden farklı, URL-güvenli ve en az 20 karakter olmalıdır.
# DATA_ENCRYPTION_KEY için: openssl rand -hex 32
# TRUST_PROXY değerini edge_proxy ağındaki sabit Traefik container IP'si olarak ayarlayın.
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

GitHub Actions dağıtımı migration öncesinde `backups/` altında izinleri kısıtlı custom-format
bir yedek oluşturur ve `pg_restore --list` ile arşiv bütünlüğünü doğrulamadan ilerlemez. Bu yerel
önlem; şifreli sunucu dışı kopya, saklama süresi ve gerçek geri yükleme tatbikatının yerine geçmez.
Başarılı bir dağıtım da tek başına geri yükleme veya rollback garantisi değildir; ters migration
ya da veri geri yükleme kararı ayrıca hazırlanmış ve sınanmış bir runbook ile uygulanmalıdır.

Yedekleri erişimi kısıtlı, şifreli ve sunucu dışında da tutulan bir dizine alın:

```bash
umask 077
mkdir -p backups
chmod 700 backups
backup_path="backups/dugun-ajansim-$(date +%Y%m%d-%H%M%S).dump"
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$backup_path"
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres \
  pg_restore --list < "$backup_path" >/dev/null
```

`pg_restore --list` yalnız arşiv biçimini doğrular. Yedeğin gerçekten geri yüklenebilir olduğunu,
production verisine dokunmayan ayrı bir Compose projesinde düzenli olarak sınayın:

```bash
docker compose --env-file .env.production -f compose.production.yaml \
  -p dugun-ajansim-restore-check up -d --wait postgres
docker compose --env-file .env.production -f compose.production.yaml \
  -p dugun-ajansim-restore-check exec -T postgres \
  sh -c 'pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$backup_path"
docker compose --env-file .env.production -f compose.production.yaml \
  -p dugun-ajansim-restore-check exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM \"_prisma_migrations\";"'
docker compose --env-file .env.production -f compose.production.yaml \
  -p dugun-ajansim-restore-check down -v
```

`dugun-ajansim-restore-check` proje adını değiştirmeyin ve bu komutları çalışan production
projesine karşı uygulamayın. Tatbikatı en az üç ayda bir tekrarlayın; yedek saklama süresini,
şifrelemeyi ve sunucu dışı kopyayı işletme politikanızda ayrıca tanımlayın.

## Kontrol

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
curl -fsS "https://dugun.n8n-mustafa.me/healthz"
curl -fsS "https://dugun.n8n-mustafa.me/api/v1/health"
```

`.env.production` dosyasını repoya eklemeyin. `DATA_ENCRYPTION_KEY` değişirse mevcut şifreli
teslimat bağlantıları çözülemez; anahtarı güvenli bir parola kasasında sürümlü olarak yedekleyin.
Dosyanın izinlerini `stat -c '%a %n' .env.production` ile kontrol edin; beklenen izin `600`'dür.
