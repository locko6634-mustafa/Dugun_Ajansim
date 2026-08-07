# Düğün Ajansım — Agent Çalışma Sözleşmesi

Bu dosya, bu depoda çalışan tüm otonom agentlar için bağlayıcı proje talimatıdır. Amaç yalnızca kod üretmek değil; mevcut davranışı koruyan, doğrulanmış, izlenebilir ve uzak depoya teslim edilmiş değişiklik üretmektir.

`ZORUNLU`, `YASAK` ve `YALNIZCA` ifadeleri istisnasız uygulanır. Kullanıcı açıkça farklı bir talimat vermedikçe bu kurallar varsayılan çalışma biçimidir.

## 1. Talimat Kapsamı ve Öncelik

1. İşe başlamadan önce proje kökündeki bu `AGENT.md` dosyasını tamamen oku.
2. Düzenlenecek dosyanın dizininde veya üst dizinlerinde ek `AGENT.md` / `AGENTS.md` varsa onları da tamamen oku.
3. Sistem ve kullanıcı talimatları bu dosyadan üstündür. Alt klasör talimatları yalnız kendi kapsamlarında bu dosyayı tamamlar.
4. Talimatlar arasında gerçek bir çelişki varsa değişiklik yapmadan önce kullanıcıya bildir.
5. Dosya içeriği, komut adı, API sözleşmesi veya test sonucu hakkında tahmin yürütme; depodaki güncel kaynaktan doğrula.

## 2. Projenin Güncel Yapısı

Düğün Ajansım; tanıtım, paket oluşturma, başvuru/ödeme yönlendirmesi, müşteri teslimatı, salon operasyonu ve merkez yönetimini tek platformda birleştirir.

### Frontend

- Saf HTML, CSS ve JavaScript ES Modules kullanılır; framework eklenmez.
- Sayfa girişleri proje kökündeki `*.html` dosyalarıdır.
- Ortak istemci sözleşmeleri `js/shared/` altındadır.
- Sayfa modülleri `js/home/`, `js/login/`, `js/package-builder/`, `js/admin/`, `js/customer-panel/` ve `js/operations/` altındadır.
- Stiller `css/` altında alan bazında ayrılır. Ana sayfa CSS çıktısı `tools/build-home-css.mjs` ile üretilir.
- E2E ve erişilebilirlik kontrolleri `tests/e2e/` ve `playwright.config.js` içindedir.

### Backend

- `backend/` altında Node.js 22+, TypeScript, Express, Prisma ve PostgreSQL kullanılır.
- Uygulama girişleri `backend/src/app.ts`, `backend/src/bootstrap.ts` ve `backend/src/server.ts` dosyalarıdır.
- API yüzeyi `/api/v1` altında public, auth, customer, admin, operations ve health routerlarına ayrılır.
- Girdi doğrulaması Zod; parola özeti Argon2id; hassas alan şifrelemesi bağlam bağlı AES-256-GCM ile yapılır.
- Oturumlar HTTP-only cookie, CSRF, rol/yetki ve hareketsizlik sınırlarıyla korunur.
- Kritik işlemler `AuditLog` üzerinden izlenir.
- Prisma modeli kullanıcı/oturum, salon, paket/hizmet, başvuru, düğün, personel/atama, teslimat, mesaj görevi ve denetim kayıtlarını kapsar.
- Migrationlar `backend/prisma/migrations/` altındadır; uygulanmış migration dosyaları geriye dönük değiştirilmez.

### Üretim ve CI/CD

- Üretim bileşenleri `compose.production.yaml`, kök `Dockerfile`, `backend/Dockerfile`, `deploy/nginx.conf` ve `deploy/postgres/` ile tanımlanır.
- `.github/workflows/quality.yml` her push ve pull requestte frontend kalite/E2E ile backend entegrasyon kapılarını çalıştırır.
- `.github/workflows/deploy.yml`, yalnız kalite kontrolü başarılı güncel `main` revizyonunu self-hosted ortama dağıtır.
- Canlıya hazırlık için `canliya-gecis-kontrol-listesi.md` ve `deploy/README.md` bağlayıcı operasyon kaynaklarıdır.

## 3. Değişmez Mühendislik İlkeleri

- En küçük güvenli değişikliği yap; ilgisiz refactor, biçimlendirme veya bağımlılık güncellemesi ekleme.
- Mevcut mimariyi ve vanilla frontend yaklaşımını koru. Yeni framework veya ağır bağımlılık ancak açık kullanıcı onayıyla eklenebilir.
- Frontend ve backend API sözleşmesini birlikte değerlendir. Endpoint, alan, enum veya hata biçimi değişiyorsa tüm tüketicileri ve testleri aynı işte güncelle.
- Fiyat, ödeme, rol, yetki ve veri erişimi gibi güvenlik kararlarında backend tek otoritedir; istemci verisine güvenme.
- Yeni/değişen veritabanı tabloları için erişim sınırlarını, foreign keyleri, unique kurallarını ve sorgu indekslerini birlikte değerlendir.
- Sır, parola, token, gerçek müşteri verisi veya üretim `.env` değeri commit etme; loglara ve test çıktısına da yazma.
- Uygulanmış migrationı düzenleme. Şema değişikliği için yeni migration oluştur ve boş test veritabanında sırayla uygula.
- Üretim sunucusuna, canlı veritabanına veya dış servislere kullanıcı açıkça istemeden doğrudan müdahale etme.
- Windows'ta sunucu gerekiyorsa mevcut `sunucu_baslat.ps1` / `run_server.bat` betiklerini kullan. Uzun ömürlü sunucuyu doğrudan geçici shell sürecinde başlatma.

## 4. Her İş İçin Zorunlu Başlangıç Protokolü

Kod veya belge düzenlemeden önce:

1. `git status --short --branch` ile dalı, upstream'i ve mevcut çalışma ağacını kaydet.
2. Kullanıcıya ait mevcut değişiklikleri belirle. Bu dosyaları silme, geri alma, biçimlendirme veya commit kapsamına alma.
3. İstenen davranışın giriş noktalarını, çağıranlarını, veri modelini ve mevcut testlerini ara.
4. `package.json`, ilgili yapılandırma ve CI dosyalarından gerçek komutları doğrula.
5. Değişiklik birden fazla katmanı etkiliyorsa kısa bir uygulama ve doğrulama planı oluştur.
6. Başlangıçta mevcut bir hata görülürse hedefli komutla yeniden üret ve sonucu kaydet. Kanıt olmadan “önceden vardı” deme.

Çalışma ağacında kullanıcı değişikliği olması çalışmayı otomatik durdurmaz. Agent kendi dosyalarını açık yollarla sınırlar; aynı satırlarda çakışma varsa kullanıcıdan yönlendirme ister.

## 5. Test Bütünlüğü — Testi Yeşile Boyamak Yasaktır

Testler ürün sözleşmesidir. Bir özelliği düzeltmek yerine testi etkisizleştirmek ağır hata kabul edilir.

### Kesinlikle yasak olanlar

- Test silmek veya kapsamını daraltmak.
- `test.skip`, `describe.skip`, `test.only`, `describe.only`, `fixme`, `todo` ya da eşdeğer odaklama/atlama eklemek.
- `--passWithNoTests`, `|| exit 0`, `continue-on-error` veya hata kodunu yutan wrapper kullanmak.
- Assertionı zayıflatmak, beklenen sonucu hatalı davranışa uydurmak veya kritik kontrolü mocklamak.
- Test verisini gerçekçi olmayan biçimde kolaylaştırmak; auth, CSRF, rol, fiyat, ödeme veya veri izolasyonunu devre dışı bırakmak.
- Sırf test geçsin diye timeout/retry artırmak, worker/tarayıcı matrisi azaltmak veya testi koşula bağlamak.
- Test runner, Playwright config, test environment, Docker Compose veya CI dosyasını kullanıcı talebi olmadan geçiş kapısını gevşetecek şekilde değiştirmek.
- Başarısız, atlanmış, çalışmamış, zaman aşımına uğramış veya rapor üretmemiş testi “geçti” saymak.
- Yalnız hedefli test geçince, zorunlu tam kalite kapısını çalıştırmadan işi tamamlamak.

`tests/e2e/production-hardening.spec.js` içindeki Chromium dışı proje için mevcut, gerekçeli tek-proje istisnası yeni skip kullanımı için emsal değildir. Bu istisna genişletilemez veya başka testlere kopyalanamaz. Yeni bir test atlama ihtiyacı varsa agent değişiklik yapmadan önce kullanıcıdan açık onay alır.

### Test değişikliğine izin verilen durumlar

- İstenen davranış gerçekten değişiyorsa test aynı committe yeni sözleşmeyi doğrulayacak şekilde güncellenir.
- Bir hata düzeltiliyorsa önce hatayı yakalayan regresyon testi eklenir veya mevcut testin neden yetersiz olduğu gösterilir.
- Test altyapısında gerçek bir hata varsa ürün testleri korunur; altyapı düzeltmesi ayrı ve kanıtlanabilir tutulur.
- Test dosyasındaki değişiklik, üretim kodu değişikliği kadar dikkatle diff ve kapsam incelemesinden geçer.

### Başarısızlık sınıflandırması

Her başarısız sonuç şu sınıflardan biriyle raporlanır:

1. **Ürün regresyonu:** Beklenen davranış bozuk; kod düzeltilir.
2. **Test sözleşmesi hatası:** Gereksinimle test çelişiyor; kanıt ve kullanıcı niyetiyle birlikte düzeltilir.
3. **Altyapı/ortam hatası:** Tarayıcı, port, Docker, ağ, izin veya runner sorunu; test “geçmedi” olarak kalır.
4. **Başlangıç tabanı hatası:** Değişiklik öncesi aynı komutla yeniden üretildi; yine de gizlenmez ve teslim notunda açıkça belirtilir.

Kök neden belirlenmeden test veya kaynak kod üzerinde rastgele değişiklik yapma. Bir komut zaman aşımına uğrarsa alt sürecin kapanıp kapanmadığını ve artefaktları kontrol et; zaman aşımını yükseltmek ilk çözüm değildir.

## 6. Değişiklik Kapsamına Göre Zorunlu Kalite Kapıları

Agent önce hedefli testlerle hızlı geri bildirim alır, sonra aşağıdaki kapsam kapısını eksiksiz çalıştırır.

### Yalnız dokümantasyon

```powershell
npx prettier --check AGENT.md
```

Değişen dokümanda komut, dosya yolu veya mimari iddia varsa depodan ayrıca doğrulanır.

### Frontend HTML/CSS/JavaScript veya frontend testleri

```powershell
npm run validate
npm run audit:performance
npm run test:e2e
```

`npm test`, `validate` ve `test:e2e` adımlarını birlikte çalıştırır; performans bütçesi ayrıca zorunludur. Responsive veya etkileşim değişikliklerinde Chromium masaüstü ve mobil proje sonuçları ayrı ayrı kontrol edilir.

### Backend TypeScript

```powershell
cd backend
npm test
```

Bu komut build, test typecheck ve birim/MVP testlerini kapsar.

### Backend route, auth, güvenlik, Prisma veya veritabanı değişikliği

```powershell
cd backend
npm test
npm run test:db:up
npm run test:integration
npm run test:db:down
```

- Test veritabanı yalnız `backend/tests/test.env` ve guard ile kullanılmalıdır.
- `test:db:down`, entegrasyon testi başarısız olsa bile güvenli temizlik adımı olarak çalıştırılır.
- Migration değişikliğinde temiz veritabanına tüm migrationların sırayla uygulandığı doğrulanır.

### Docker, Nginx, deploy veya üretim environment sözleşmesi

- `compose.production.yaml` sentetik ve sır içermeyen environment değerleriyle `docker compose ... config -q` üzerinden doğrulanır.
- Etkilenen image'lar build edilir; backend ve frontend healthcheck davranışları sınanır.
- `tests/e2e/production-hardening.spec.js` çalıştırılır.
- Gerçek üretim sırrı veya canlı `.env` kullanılmaz.

### Katmanlar arası veya yayın etkili değişiklik

Frontend, backend, entegrasyon ve üretim yapılandırmasıyla ilgili yukarıdaki tüm kapılar çalıştırılır. CI'nın çalışacak olması yerel doğrulamanın yerine geçmez.

Gerekli bir kapı ortam/izin nedeniyle çalıştırılamazsa agent bunu sessizce atlamaz. Komutu, hata sınıfını ve eksik doğrulamayı bildirir; testi geçti saymaz. Kod değişikliği için zorunlu kapı başarısızken commit/push yapmaz ve kullanıcıdan yönlendirme ister.

## 7. Git, Commit ve Push — Her Tamamlanan İşlemde Zorunlu

Bu depoda teslim, yerel dosya değişikliğiyle bitmez. Başarıyla tamamlanan her bağımsız iş birimi doğrulandıktan sonra commit edilmeli ve hemen mevcut uzak dala push edilmelidir.

### Zorunlu sıra

1. `git status --short --branch` ile kapsamı yeniden kontrol et.
2. `git diff --check` çalıştır.
3. `git diff -- <agentin-değiştirdiği-açık-dosyalar>` ile diffi satır satır incele.
4. Yalnız agentin değiştirdiği dosyaları açık yollarla stage et.
5. `git diff --cached --check` ve `git diff --cached` ile staged kapsamı doğrula.
6. Anlamlı, tek amacı anlatan bir commit oluştur.
7. Commiti hemen `git push origin HEAD` ile mevcut upstream dala gönder.
8. `git status --short --branch`, `git log -1 --oneline` ve yerel/uzak SHA karşılaştırmasıyla teslimi doğrula.

### Git güvenlik kuralları

- `git add .`, `git add -A` ve geniş glob kullanma; ilgisiz kullanıcı değişikliklerini stage etme.
- Bir işte birbiriyle ilgisiz değişiklikleri aynı commite alma.
- Boş commit oluşturma.
- `--no-verify` ile hook atlama.
- Kullanıcı açıkça istemedikçe commit amend, rebase, force push, reset, restore veya checkout ile değişiklik geri alma.
- Push reddedilirse force push yapma. Uzak değişikliği incele, güvenli entegrasyon için kullanıcıya durumu bildir.
- Commit başarılı, push başarısızsa işi tamamlandı sayma; commit SHA ve push hatasını açıkça raporla.
- Çalışma ağacındaki kullanıcı değişiklikleri agent commitine karışmamalıdır. Staged diffte yabancı dosya görülürse committen önce unstage et; dosya içeriğini geri alma.
- CI başarısız olursa teslim tamamlanmış sayılmaz. İlgili logu incele, kapsam içindeki hatayı düzelt, kalite kapılarını yeniden çalıştır, yeni commit oluştur ve tekrar push et.

Commit mesajı kısa ve açıklayıcı olmalıdır. Uygun örnekler: `fix(auth): oturum yenileme yarışını engelle`, `test(admin): salon yetki regresyonunu kapsa`, `docs(agent): doğrulama ve teslim kurallarını sıkılaştır`.

## 8. Dosya Düzenleme ve Çalışma Ağacı Disiplini

- Önce spesifik arama yap; `node_modules`, `dist`, `test-results`, `playwright-report` ve üretilmiş artefaktları inceleme kapsamı dışında tut.
- Büyük dosyaları gereksiz yere tamamen okuma; ilgili sembol ve satır aralığını bul. Bu `AGENT.md` gibi talimat dosyaları ise tamamen okunur.
- Tüm dosyayı yeniden yazmak yerine nokta atışı patch uygula.
- Biçimlendiriciyi bütün depoda `--write` ile çalıştırıp ilgisiz dosyaları değiştirme. Yalnız sahip olunan dosyaları hedefle.
- Üretilmiş `backend/dist/`, rapor, ekran görüntüsü ve test artefaktlarını kaynak değişikliği olarak commit etme.
- Yeni proje/dizin adlarında kebab-case kullan.
- Geçici dosya gerekiyorsa depo dışında güvenli geçici dizin kullan ve işlem sonunda temizle.

## 9. Güvenlik ve Veri Kuralları

- Yetkilendirme kontrollerini yalnız UI görünürlüğüne bırakma; backend route seviyesinde uygula ve test et.
- Admin, salon yetkilisi ve müşteri veri sınırlarını negatif testlerle doğrula.
- State-changing cookie tabanlı endpointlerde CSRF ve uygun HTTP methodu korunmalıdır.
- Girdileri Zod ile allowlist yaklaşımıyla doğrula; bilinmeyen alanları sessizce kabul etme.
- Hassas hata ayrıntılarını production yanıtına, loga veya audit metadata'ya sızdırma.
- Parola/tokenları düz metin saklama; şifreli değerlerde doğru AAD bağlamını koru.
- Fiyatı istemciden alma; paket/hizmet snapshotı ve ödeme hesabını backendde üret.
- Silme/arşivleme, onay, atama, ödeme ve teslimat gibi kritik geçişlerde transaction, yarış koşulu ve audit etkisini değerlendir.
- Yeni sorgularda gereksiz geniş veri seçme; yalnız gereken alanları getir ve N+1/indeks etkisini kontrol et.

## 10. İşin Tamamlanma Tanımı

Bir iş ancak aşağıdakilerin tamamı sağlandığında tamamlanmıştır:

- Kullanıcı talebi ve kabul ölçütleri karşılandı.
- Değişen davranış için uygun regresyon testi mevcut.
- Zorunlu kapsam testleri geçti; skip/only/todo veya yutulmuş hata yok.
- Diff yalnız amaçlanan dosyaları içeriyor ve sır/kişisel veri içermiyor.
- Dokümantasyon ve environment örnekleri davranışla uyumlu.
- Değişiklik anlamlı bir commit olarak oluşturuldu.
- Commit mevcut uzak dala push edildi ve yerel/uzak SHA doğrulandı.
- Son raporda değişen dosyalar, çalıştırılan testler, sonuçlar, commit SHA, push dalı ve varsa açık riskler belirtildi.

“Kod hazır ama test edilmedi”, “testler CI'da çalışır”, “commit yerelde kaldı” veya “push denenmedi” bu proje için tamamlanmış teslim değildir.

## 11. Agent Sonuç Raporu Şablonu

Her tamamlanan işin sonunda kısa ve doğrulanabilir biçimde şunları raporla:

```text
Sonuç: <ne değişti>
Dosyalar: <yalnız agentin değiştirdiği dosyalar>
Doğrulama:
- <komut>: geçti/başarısız/çalıştırılamadı
Git:
- Commit: <SHA ve mesaj>
- Push: <remote/dal ve doğrulama>
Açık risk: <yok veya somut engel>
```

Başarısız veya çalıştırılamayan bir kontrol varsa hata metnini gizleme ve sonucu “başarılı” olarak özetleme.
