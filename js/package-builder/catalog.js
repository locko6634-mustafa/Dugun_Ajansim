export const basePackages = {
  mini: {
    name: "Mini Paket",
    price: 20000,
    image: "assets/images/hero-couple.webp",
  },
  signature: {
    name: "İmza Paket",
    price: 28000,
    image: "assets/images/services/fotograf-cekimi.webp",
  },
  timeless: {
    name: "Zamansız Paket",
    price: 36000,
    image: "assets/images/venue-pavilion.webp",
  },
};

export const services = [
  {
    id: "fotograf",
    category: "photo",
    name: "Fotoğraf Çekimi",
    price: 7000,
    image: "assets/images/services/fotograf-cekimi.webp",
    gallery: [
      "assets/images/services/fotograf-cekimi.webp",
      "assets/images/hero-couple.webp",
      "assets/images/bride-portrait.webp",
    ],
    description:
      "Günün en doğal anlarını yönlendirmesi güçlü, zarif ve zamansız karelere dönüştürüyoruz. Çekim planı düğün akışınıza göre önceden hazırlanır.",
    features: [
      "Profesyonel fotoğraf ekibi",
      "Çift ve aile portreleri",
      "Özenli renk ve ışık düzenleme",
      "Yüksek çözünürlüklü dijital teslim",
    ],
    delivery: "7–14 iş günü",
  },
  {
    id: "video",
    category: "video",
    name: "Video Çekimi",
    price: 9000,
    image: "assets/images/services/video-cekimi.webp",
    gallery: [
      "assets/images/services/video-cekimi.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Hazırlıktan kutlamaya uzanan günün sesini, hareketini ve duygusunu sinematik bir anlatıyla kaydediyoruz.",
    features: [
      "4K profesyonel video kaydı",
      "Hazırlık ve tören anları",
      "Temel kurgu ve renk düzenleme",
      "Dijital bağlantı ile teslim",
    ],
    delivery: "14–21 iş günü",
  },
  {
    id: "drone",
    category: "video",
    name: "Drone Çekimi",
    price: 8000,
    image: "assets/images/services/drone-cekimi.webp",
    gallery: [
      "assets/images/services/drone-cekimi.webp",
      "assets/images/venue-pavilion.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Profesyonel drone ile düğününüzün en özel anlarını havadan yakalıyoruz. Mekânın ölçeğini ve atmosferini sinematik görüntülerle unutulmaz hale getiriyoruz.",
    features: [
      "4K kalitede hava görüntüsü",
      "Özel rota planlaması",
      "Düğün mekânına uygun çekim",
      "Ortalama 3–5 dakikalık klip içeriği",
    ],
    delivery: "7–14 iş günü",
  },
  {
    id: "klip",
    category: "video",
    name: "Düğün Klibi",
    price: 12000,
    image: "assets/images/services/klip-cekimi.webp",
    gallery: [
      "assets/images/services/klip-cekimi.webp",
      "assets/images/services/video-cekimi.webp",
      "assets/images/groom-portrait.webp",
    ],
    description:
      "Hikâyenizi seçtiğiniz müzik, güçlü sahneler ve dinamik bir kurgu ile size özel kısa bir düğün filmine dönüştürüyoruz.",
    features: [
      "Size özel hikâye akışı",
      "Sinematik çekim ve kurgu",
      "Lisanslı müzik seçeneği",
      "Sosyal medya için kısa versiyon",
    ],
    delivery: "14–21 iş günü",
  },
  {
    id: "album",
    category: "keepsake",
    name: "Albüm Tasarımı",
    price: 7000,
    image: "assets/images/services/album-tasarimi.webp",
    gallery: [
      "assets/images/services/album-tasarimi.webp",
      "assets/images/bride-portrait.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Seçtiğiniz kareleri kaliteli malzeme, dengeli sayfa tasarımı ve size özel kapak seçenekleriyle kalıcı bir hatıraya dönüştürüyoruz.",
    features: [
      "Kişiye özel sayfa tasarımı",
      "Premium baskı ve ciltleme",
      "Kapak malzemesi seçenekleri",
      "Baskı öncesi dijital onay",
    ],
    delivery: "21–30 iş günü",
  },
  {
    id: "video360",
    category: "keepsake",
    name: "360° Video Booth",
    price: 5500,
    image: "assets/images/services/360-video.webp",
    gallery: [
      "assets/images/services/360-video.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Misafirlerinizin eğlenceli anlarını hareketli kamera platformuyla kaydediyor, anında paylaşılabilir kısa videolara dönüştürüyoruz.",
    features: [
      "Profesyonel 360° platform",
      "Etkinlik boyunca operatör",
      "Kişiselleştirilmiş video çerçevesi",
      "Anında dijital paylaşım",
    ],
    delivery: "Etkinlik günü",
  },
];
