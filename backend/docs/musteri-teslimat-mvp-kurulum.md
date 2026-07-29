# Müşteri Teslimat MVP Kurulumu

## 1. Ortam değişkenleri

`backend/.env.example` dosyasını temel alarak `backend/.env` dosyasını hazırlayın.

Zorunlu üretim değerleri:

- `DATABASE_URL`: PostgreSQL bağlantısı
- `DATA_ENCRYPTION_KEY`: 64 karakterlik rastgele hex anahtar
- `CORS_ORIGIN`: İzin verilen frontend adresleri
- `TRUST_PROXY`: Reverse proxy katman sayısı

`DATA_ENCRYPTION_KEY` değişirse daha önce kaydedilmiş Drive bağlantıları ve geçici mesaj
sırları çözülemez. Anahtarı parola kasasında yedekleyin.

## 2. Veritabanı ve başlangıç kayıtları

```powershell
cd backend
npm install
npx prisma migrate deploy
npm run seed
```

Seed komutu yedi salonu, Mini Paketi ve başlangıç ek hizmetlerini ekler.

## 3. İlk admin

Herkese açık admin kaydı yoktur. İlk admini yalnızca CLI ile oluşturun:

```powershell
$env:ADMIN_BOOTSTRAP_USERNAME="admin"
$env:ADMIN_BOOTSTRAP_PASSWORD="Guclu-ve-benzersiz-bir-parola"
npm run admin:bootstrap
```

Admin ilk girişte parolasını değiştirmeden yönetim ekranına erişemez.

## 4. Kalite kontrolleri

Backend:

```powershell
npm test
npm run test:db:up
npm run test:integration
npm run test:db:down
```

Frontend proje kökünde:

```powershell
npm run validate
npm run test:e2e
```

Entegrasyon veritabanı `localhost:55432` üzerinde yalnızca RAM kullanan geçici bir Docker
containerıdır; `test:db:down` ile kaldırılır.

## 5. Panel adresleri

- Yönetim: `admin.html`
- Müşteri teslimatı: `musteri-paneli.html`
- Giriş: `login.html`
- Paket başvurusu: `paketini-olustur.html`

`operasyon-paneli.html` sonraki fazdaki salon yetkilisi/personel planlaması için ayrılmıştır.
