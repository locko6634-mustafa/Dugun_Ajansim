# Düğün Ajansım — Proje Tanımı ve Agent Rehberi

## Projenin Amacı

Düğün Ajansım; düğün fotoğrafçılığı, dış çekim, video çekimi, drone çekimi, klip hazırlama, albüm tasarımı ve salon çekim hizmetlerini dijital ortamda uçtan uca sunan ve yöneten modern bir web platformudur.

Platform; ziyaretçilerin ajansı ve hizmetleri tanımasını, çekim örneklerini incelemesini, kendi hizmet paketini dinamik olarak oluşturup başvuru yapmasını, müşterilerin çekim ve teslimat süreçlerini takip etmesini, salon yetkililerinin ve yönetim ekibinin tüm operasyonu (rezervasyonlar, düğünler, teslimat durumları, kullanıcı yetkileri ve sistem günlükleri) yönetmesini sağlar.

## Mevcut Ürün Alanları

- **Kurumsal Ana Sayfa & Hizmetler**: Marka tanıtımı, dinamik galeriler, hizmet ve paket sunumları, SSS ve iletişim.
- **Kişiselleştirilebilir Paket Oluşturucu**: Kullanıcıların hizmet, albüm ve ekstra detayları seçerek anlık fiyat hesaplamasıyla başvuru oluşturabildiği etkileşimli modül.
- **Kimlik Doğrulama & Oturum Yönetimi**: Kullanıcı adı/şifre, güvenli cookie ve CSRF korumalı oturum mimarisi ile giriş ekranı.
- **Müşteri Paneli**: Müşterilerin kendi düğün detaylarını, hazırlık/teslimat durumlarını ve teslimat bağlantılarını (Drive URL vb.) görüntülediği panel.
- **Yönetim Paneli (Admin)**: Başvuruların incelenmesi/onaylanması, düğün planlaması, teslimat yönetimi, yetkili/kullanıcı yönetimi, mesaj görevleri ve denetim kayıtları (Audit Logs).
- **Operasyon Paneli**: Saha ve operasyon ekiplerine yönelik panel arayüzü.
- **Yasal ve Bilgilendirme Sayfaları**: KVKK Aydınlatma Metni, Gizlilik Politikası ve Kullanım Şartları.
- **Backend REST API**: Modüler, güvenli, rol tabanlı yetkilendirmeye sahip (v1) Express & TypeScript API.

## Teknoloji Yapısı

### Frontend

Frontend; framework bağımlılığı olmadan saf (Vanilla) HTML, CSS ve JavaScript (ES Modules) mimarisiyle geliştirilmektedir. Sayfalar proje kökündeki HTML dosyalarından sunulur.

- **Mimari**: ES Modules (`js/`), modüler CSS (`css/`), statik medya varlıkları (`assets/`).
- **Yardımcı Betikler ve Araçlar**: `tools/` altında CSS derleme (`build-home-css.mjs`), performans bütçesi kontrolü (`check-performance-budget.mjs`) ve yerel sunucu (`serve.mjs`).
- **Frontend Kalite ve Test Araçları**:
  - **ESLint**: JavaScript kod kalitesi ve standartları.
  - **Stylelint**: CSS düzen ve kural denetimi.
  - **Prettier**: Kod biçimlendirme.
  - **html-validate**: HTML semantik ve geçerlilik denetimi.
  - **Playwright**: Uçtan uca (E2E) testler ve `@axe-core/playwright` ile erişilebilirlik (a11y) kontrolleri.

### Backend

Backend, `backend/` klasöründe Node.js (>=22) ve TypeScript tabanlı modüler Express mimarisiyle yapılandırılmıştır.

- **Veritabanı & ORM**: PostgreSQL ve Prisma ORM.
- **Güvenlik & Şifreleme**:
  - **Argon2**: Güvenli parola özetleme (hashing).
  - **AES-256-GCM**: Drive URL'leri ve mesaj sırları için çift yönlü simetrik şifreleme (v2 encryption: IV + AuthTag).
  - **Güvenlik Başlıkları & Limitler**: Helmet, HPP, express-rate-limit.
  - **Şema Doğrulama**: Zod ile girdi doğrulama.
  - **Oturum Yönetimi**: Güvenli HTTP-Only Cookie + CSRF Token doğrulama (AuthSession).
  - **Denetim Kayıtları (Audit Logging)**: Tüm kritik işlemler `AuditLog` modeline kaydedilir.
- **Test ve Geliştirme Araçları**:
  - **Node.js Native Test Runner** (`node:test` & `tsx`)
  - **Supertest**: API uç nokta entegrasyon testleri.
  - **Docker Compose Test Ortamı**: `compose.test.yaml` ile izolasyonlu test veritabanı.

### Dağıtım ve Altyapı

- **Docker & Docker Compose**: Üretim ortamı için `Dockerfile`, `backend/Dockerfile` ve `compose.production.yaml`.
- **Nginx Sunucu Yapılandırması**: `deploy/nginx.conf` üzerinden reverse proxy, statik dosya sunumu ve güvenlik başlıkları.
- **CI/CD İş Akışları**: `.github/workflows/` altında kalite denetimleri (`quality.yml`) ve otomatik dağıtım (`deploy.yml`).
- **Bağımsız Başlatma Betikleri**: Windows ortamında bağımsız sunucu başlatmak için `sunucu_baslat.ps1` / `run_server.bat` ve `backend/sunucu_baslat_backend.ps1` / `backend/run_server.bat`.

## Klasör Yapısı

```text
/
├── assets/                 Görseller ve ortak statik varlıklar
├── css/                    Sayfa ve modül bazlı CSS stilleri
│   ├── admin/
│   ├── customer-panel/
│   ├── home/
│   ├── login/
│   ├── package-builder/
│   └── yasal/
├── js/                     Sayfa bazlı JavaScript modülleri (ESM)
│   ├── admin/
│   ├── customer-panel/
│   ├── home/
│   ├── login/
│   ├── package-builder/
│   └── shared/             Ortak API servisleri, cookie, CSRF ve DOM yardımcıları
├── tests/
│   └── e2e/                Playwright E2E ve erişilebilirlik testleri
├── tools/                  CSS derleme, performans bütçesi ve statik sunucu araçları
├── backend/
│   ├── src/                Express & TypeScript API kaynak kodu
│   │   ├── config/         Ortam ve güvenlik yapılandırmaları
│   │   ├── controllers/    İstek işleyicileri
│   │   ├── middlewares/    Oturum, CSRF, rol yetki, rate limit ve hata middleware'leri
│   │   ├── routes/         API uç noktaları (public, auth, customer, admin, health)
│   │   ├── schemas/        Zod doğrulama şemaları
│   │   ├── scripts/        Seed, bootstrap ve veritabanı migration betikleri
│   │   ├── services/       İş mantığı ve şifreleme servisleri
│   │   ├── types/          TypeScript tip tanımları
│   │   └── utils/          Yardımcı fonksiyonlar ve loglayıcılar
│   ├── prisma/             Prisma şeması (schema.prisma), migration'lar ve seed verileri
│   ├── tests/              Backend birim, entegrasyon ve MVP testleri
│   └── docs/               Backend API ve veritabanı teknik dokümantasyonu
├── deploy/                 Nginx yapılandırması (`nginx.conf`) ve dağıtım kılavuzları
├── .github/workflows/      CI/CD GitHub Actions iş akışları
├── sunucu_baslat.ps1       Frontend sunucusunu bağımsız başlatma betiği
└── *.html                  Frontend giriş sayfaları
```

## Frontend Sayfa Eşleşmeleri

| Alan             | HTML                                                                             | JavaScript                    | CSS                    |
| ---------------- | -------------------------------------------------------------------------------- | ----------------------------- | ---------------------- |
| Ana Sayfa        | `index.html`                                                                     | `js/home/app.js`              | `css/home/`            |
| Giriş            | `login.html`                                                                     | `js/login/login.js`           | `css/login/`           |
| Paket Oluşturucu | `paketini-olustur.html`                                                          | `js/package-builder/main.js`  | `css/package-builder/` |
| Yönetim Paneli   | `admin.html`                                                                     | `js/admin/app.js`             | `css/admin/`           |
| Müşteri Paneli   | `musteri-paneli.html`                                                            | `js/customer-panel/app.js`    | `css/customer-panel/`  |
| Operasyon Paneli | `operasyon-paneli.html`                                                          | Modüler genişletme aşamasında | `css/customer-panel/`  |
| Yasal Sayfalar   | `gizlilik-politikasi.html`<br>`kullanim-sartlari.html`<br>`kvkk-aydinlatma.html` | Statik / Gerektiğinde ESM     | `css/yasal/`           |

## Veritabanı ve Rol Yapısı

- **Kullanıcı Rolleri (`UserRole`)**: `ADMIN`, `SALON_YETKILISI`, `MUSTERI`
- **Başlıca Modeller**:
  - `User`, `AuthSession`, `Venue`
  - `Package`, `Service`
  - `BookingApplication`, `BookingApplicationService`
  - `Wedding`, `Delivery`, `DeliveryStatusHistory`
  - `MessageTask`, `AuditLog`, `SystemHealth`

## Gelişim Durumu ve İpuçları

- **Test Komutları**:
  - Frontend: `npm test`, `npm run test:e2e`, `npm run validate`
  - Backend: `npm test` (`backend/` klasöründe), `npm run test:integration`
- **Sunucu Başlatma**:
  - Yerel bağımsız çalıştırma için `sunucu_baslat.ps1` veya `run_server.bat` betikleri kullanılır.
- Proje aktif olarak geliştirilmekte olup test kapsamı, güvenlik kontrolleri ve modüler yapısı korunarak genişletilmektedir.
