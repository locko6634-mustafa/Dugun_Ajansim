# Self-hosted üretim kurulumu

## Gereksinimler

- Alan adının A kaydı sunucunun genel IP adresine yönlenmeli.
- Sunucuda Docker Compose ve harici `edge_proxy` ağı çalışmalı.
- Traefik, `mytlschallenge` sertifika çözücüsünü sağlamalı.

## İlk kurulum

```bash
cp .env.production.example .env.production
# .env.production içindeki alan adı ve iki sırrı benzersiz değerlerle değiştirin.
docker compose --env-file .env.production -f compose.production.yaml config
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml --profile bootstrap run --rm seed
```

Compose; PostgreSQL'i yalnız izole Docker ağına açar, migration'ları çalıştırır, backend
healthcheck'i başarılı olduktan sonra frontend'i yayına alır. Traefik HTTPS sertifikasını
otomatik üretir ve `/api/v1` isteklerini backend'e yönlendirir. `seed` komutu yalnız ilk
kurulumda çalıştırılır; başlangıç paketi, hizmetleri ve salonları idempotent olarak hazırlar.

## Güncelleme

```bash
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yaml up -d --build
```

## Kontrol

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
curl -fsS "https://dugun.n8n-mustafa.me/healthz"
curl -fsS "https://dugun.n8n-mustafa.me/api/v1/health"
```

`.env.production` dosyasını repoya eklemeyin. `DATA_ENCRYPTION_KEY` değişirse mevcut şifreli
teslimat bağlantıları çözülemez; anahtarı güvenli bir parola kasasında yedekleyin.
