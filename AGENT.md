# Düğün Ajansım — Proje Tanımı

## Projenin Amacı

Düğün Ajansım; düğün fotoğrafçılığı, video çekimi, drone çekimi, klip hazırlama,
albüm tasarımı ve benzeri hizmetleri dijital ortamda sunmayı amaçlayan bir web projesidir.

Proje; ziyaretçilerin ajansı ve hizmetleri tanımasını, çekim örneklerini incelemesini,
kendi hizmet paketini oluşturmasını ve hesaplarına erişmesini sağlar. Yönetim ve operasyon
ekipleri için ayrı panel deneyimleri, müşteriler için ise rezervasyon ve teslimat süreçlerini
takip edebilecekleri bir alan geliştirilmektedir.

## Mevcut Ürün Alanları

- Kurumsal ana sayfa ve hizmet tanıtımları
- Çekim galerisi ve mekan içerikleri
- Sıkça sorulan sorular
- Kişiselleştirilebilir paket oluşturucu
- Kullanıcı giriş ekranı
- Müşteri paneli
- Yönetim paneli
- Operasyon paneli
- KVKK aydınlatma, gizlilik politikası ve kullanım şartları sayfaları
- Rezervasyon, kullanıcı ve müşteri teslimat süreçlerini destekleyen backend API

## Teknoloji Yapısı

### Frontend

Frontend, framework bağımlılığı olmadan Vanilla HTML, CSS ve JavaScript ile geliştirilir.
JavaScript tarafında ES modules kullanılır. Sayfalar proje kökündeki HTML dosyalarından,
stiller `css/`, istemci kodları `js/`, görsel varlıklar ise `assets/` klasöründen sunulur.

Ana frontend kalite araçları:

- ESLint
- Stylelint
- Prettier
- html-validate
- Playwright
- Axe erişilebilirlik kontrolleri

### Backend

Backend, `backend/` klasöründe yer alan Node.js ve TypeScript tabanlı bir Express API'dir.
Veri erişiminde Prisma ORM ve PostgreSQL kullanılır. API; kimlik doğrulama, yönetim,
müşteri, rezervasyon, teslimat ve sistem sağlığı gibi alanları destekleyecek şekilde
modüler olarak geliştirilmektedir.

Başlıca backend teknolojileri:

- Node.js 22+
- TypeScript
- Express
- Prisma
- PostgreSQL
- Zod
- Argon2
- Supertest

### Dağıtım

Proje Docker ile paketlenebilir. Üretim ortamı için Docker Compose ve Nginx
yapılandırmaları `compose.production.yaml` ve `deploy/` altında bulunur.

## Klasör Yapısı

```text
/
├── assets/                 Görseller ve ortak statik varlıklar
├── css/                    Sayfa bazlı frontend stilleri
├── js/                     Sayfa bazlı JavaScript modülleri
│   └── shared/             Ortak istemci yardımcıları ve servisler
├── tests/e2e/              Frontend uçtan uca testleri
├── tools/                  CSS derleme ve performans araçları
├── backend/
│   ├── src/                TypeScript API kaynak kodu
│   ├── prisma/             Prisma şeması, migration ve seed dosyaları
│   ├── tests/              Backend testleri
│   └── docs/               Backend teknik dokümantasyonu
├── deploy/                 Nginx ve dağıtım belgeleri
└── *.html                  Frontend sayfa girişleri
```

## Frontend Sayfa Eşleşmeleri

| Alan | HTML | JavaScript | CSS |
|---|---|---|---|
| Ana sayfa | `index.html` | `js/home/app.js` | `css/home/` |
| Giriş | `login.html` | `js/login/login.js` | `css/login/` |
| Paket oluşturucu | `paketini-olustur.html` | `js/package-builder/main.js` | `css/package-builder/` |
| Yönetim paneli | `admin.html` | `js/admin/app.js` | `css/admin/` |
| Müşteri paneli | `musteri-paneli.html` | `js/customer-panel/app.js` | `css/customer-panel/` |
| Operasyon paneli | `operasyon-paneli.html` | Geliştirme aşamasında | `css/customer-panel/` |
| Yasal sayfalar | İlgili kök HTML dosyaları | Gerektiğinde eklenir | `css/yasal/` |

## Gelişim Durumu

Proje aktif olarak geliştirilmektedir. Mevcut yapı yeni sayfalar, paneller, API uçları,
veritabanı modelleri, otomasyonlar ve dağıtım seçenekleriyle genişletilmeye açıktır.
