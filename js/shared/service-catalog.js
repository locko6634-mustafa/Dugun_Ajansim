// Ana sayfa ve paket oluşturucu tarafından paylaşılan hizmet kataloğu.
export const basePackages = {
  mini: {
    name: "Mini Paket",
    image: "assets/images/hero-couple.webp"
  }
};

export const services = [
  {
    id: "fotograf",
    category: "photo",
    name: "Düğün Fotoğrafçılığı",
    eyebrow: "Zamansız Kareler",
    image: "assets/images/services/fotograf-cekimi.webp",
    gallery: [
      "assets/images/services/fotograf-cekimi.webp",
      "assets/images/hero-couple.webp",
      "assets/images/bride-portrait.webp"
    ],
    description:
      "Hazırlık telaşından son dansa kadar günün gerçek duygusunu doğal, estetik ve zamansız karelerle anlatıyoruz. Ekibimiz düğün akışını önceden planlayarak hem beklenmedik anları hem de vazgeçilmez aile portrelerini eksiksiz kaydeder.",
    features: [
      "Hazırlık, tören ve davet boyunca profesyonel fotoğraf çekimi",
      "Gelin-damat, aile ve yakın çevre portreleri",
      "Doğal anlara odaklanan belgesel çekim yaklaşımı",
      "Seçilen karelerde renk, ışık ve rötuş düzenlemesi"
    ],
    delivery: "En geç 21 takvim günü"
  },
  {
    id: "video",
    category: "production",
    name: "Sinematik Düğün Filmi",
    eyebrow: "Sinematik Anlatı",
    image: "assets/images/services/video-cekimi.webp",
    gallery: [
      "assets/images/services/video-cekimi.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Düğününüzü yalnızca kaydetmiyor; bakışları, sesleri ve küçük ayrıntıları güçlü bir hikâye akışıyla ömür boyu izlemek isteyeceğiniz sinematik bir filme dönüştürüyoruz.",
    features: [
      "Hazırlık, tören, ilk dans ve kutlamadan çok açılı çekimler",
      "4K kayıt, profesyonel ses ve atmosfer görüntüleri",
      "Hikâyeye özel kurgu, renk düzenleme ve müzik akışı",
      "Uzun film ve sosyal paylaşım için kısa özet versiyonu"
    ],
    delivery: "En geç 21 takvim günü"
  },
  {
    id: "drone",
    category: "production",
    name: "Drone Çekimi",
    eyebrow: "Havadan Hikâye",
    image: "assets/images/services/drone-cekimi.webp",
    gallery: [
      "assets/images/services/drone-cekimi.webp",
      "assets/images/venue-pavilion.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Mekânın ölçeğini, çevresini ve kutlamanın görkemini etkileyici hava görüntüleriyle hikâyenize dâhil ediyoruz. Çekim planı, düğün akışı ile hava ve uçuş koşulları birlikte değerlendirilerek hazırlanır.",
    features: [
      "Mekân ve çevresini tanıtan 4K hava görüntüleri",
      "Çift çekimi, karşılama ve davet akışına uygun planlama",
      "Hava ve uçuş koşullarına göre güvenli çekim rotası",
      "Görüntülerin sinematik düğün filmine uyumlu kurgulanması"
    ],
    delivery: "Film teslimiyle birlikte, en geç 21 takvim günü"
  },
  {
    id: "jimmy-jib",
    category: "production",
    name: "Jimmy Jib Çekimi",
    eyebrow: "Akıcı Perspektif",
    image: "assets/images/services/klip-cekimi.webp",
    gallery: [
      "assets/images/services/klip-cekimi.webp",
      "assets/images/services/video-cekimi.webp",
      "assets/images/groom-portrait.webp"
    ],
    description:
      "Profesyonel kamera vinciyle sahnenin üzerinden süzülen geniş ve akıcı görüntüler üretiyoruz. Özellikle giriş, ilk dans ve eğlence anlarında düğünün atmosferini sinema ölçeğinde hissettiren güçlü planlar yakalıyoruz.",
    features: [
      "Profesyonel kamera vinci ve uzman operatör",
      "Gelin-damat girişi, ilk dans ve sahne çekimleri",
      "Geniş açıdan yakın plana kesintisiz kamera hareketleri",
      "Görüntülerin düğün filmi kurgusuna dâhil edilmesi"
    ],
    delivery: "Film teslimiyle birlikte, en geç 21 takvim günü"
  },
  {
    id: "dis-cekim",
    category: "photo",
    name: "Dış Çekim",
    eyebrow: "Doğal Işık",
    image: "assets/images/hero-couple.webp",
    gallery: [
      "assets/images/hero-couple.webp",
      "assets/images/bride-portrait.webp",
      "assets/images/groom-portrait.webp"
    ],
    description:
      "Sizi yansıtan bir mekân, doğru saat ve doğal ışıkla düğün hikâyenize özel bir çekim planlıyoruz. Rahat yönlendirmelerle poz baskısını azaltıyor, samimi ve zamansız bir fotoğraf serisi oluşturuyoruz.",
    features: [
      "Konsept ve lokasyon için çekim öncesi planlama",
      "Doğal ışığa göre saat ve kadraj hazırlığı",
      "Çift portreleri ile hareketli, samimi kareler",
      "Seçilen fotoğraflarda profesyonel renk ve rötuş"
    ],
    delivery: "En geç 21 takvim günü"
  },
  {
    id: "organizasyon",
    category: "experience",
    name: "Organizasyon Hizmetleri",
    eyebrow: "Misafir Deneyimi",
    image: "assets/images/services/360-video.webp",
    gallery: [
      "assets/images/services/360-video.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Misafirlerinizin kutlamaya aktif biçimde katılacağı eğlenceli ve paylaşılabilir anı deneyimleri tasarlıyoruz. Seçilen çözümleri düğününüzün konseptiyle uyumlu tek bir organizasyon akışında birleştiriyoruz.",
    features: [
      "360° Video Booth kurulumu ve etkinlik operatörü",
      "Instax misafir albümü ve anında hatıra köşesi",
      "QR kodlu dijital fotoğraf ve video paylaşımı",
      "Karşılama panosu ile kişiselleştirilebilir anı alanları"
    ],
    delivery: "Etkinlik günü; dijital içerikler 3 iş günü"
  },
  {
    id: "album",
    category: "experience",
    name: "Premium Albüm Tasarımı",
    eyebrow: "Basılı Hatıra",
    image: "assets/images/services/album-tasarimi.webp",
    gallery: [
      "assets/images/services/album-tasarimi.webp",
      "assets/images/bride-portrait.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Düğün hikâyenizin en güçlü karelerini özenle seçip dengeli sayfa düzenleri, kaliteli baskı ve size özel kapak seçenekleriyle yıllarca saklanacak bir albüme dönüştürüyoruz.",
    features: [
      "Hikâye akışına göre fotoğraf seçimi ve sayfa kurgusu",
      "Premium baskı, ciltleme ve kapak seçenekleri",
      "İsim, tarih ve monogramla kişiselleştirme",
      "Üretim öncesinde dijital tasarım onayı"
    ],
    delivery: "Tasarım onayından sonra üretim planına göre"
  },
  {
    id: "aninda-baski",
    category: "experience",
    name: "Anında Fotoğraf Baskısı",
    eyebrow: "Düğün Günü Hatırası",
    image: "assets/images/bride-portrait.webp",
    gallery: [
      "assets/images/bride-portrait.webp",
      "assets/images/services/fotograf-cekimi.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Düğün sırasında çekilen seçili fotoğrafları profesyonel baskı istasyonumuzda hazırlayıp aynı gece misafirlerinize fiziksel bir hatıra olarak teslim ediyoruz.",
    features: [
      "Etkinlik alanında profesyonel baskı istasyonu",
      "Düğün sırasında seçilen karelerin hızlı hazırlanması",
      "İsim ve tarihle kişiselleştirilebilir baskı çerçevesi",
      "Hazırlanan fotoğrafların misafirlere anında teslimi"
    ],
    delivery: "Düğün sırasında anında"
  }
];
