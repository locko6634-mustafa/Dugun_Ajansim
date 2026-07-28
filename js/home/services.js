const homeServices = [
  {
    id: "fotograf",
    name: "Fotoğraf Çekimi",
    price: 7000,
    image: "assets/images/services/fotograf-cekimi.webp",
    gallery: [
      "assets/images/services/fotograf-cekimi.webp",
      "assets/images/hero-couple.webp",
      "assets/images/bride-portrait.webp"
    ],
    description:
      "Günün en doğal anlarını yönlendirmesi güçlü, zarif ve zamansız karelere dönüştürüyoruz. Çekim planı düğün akışınıza göre önceden hazırlanır.",
    features: [
      "Profesyonel fotoğraf ekibi",
      "Çift ve aile portreleri",
      "Özenli renk ve ışık düzenleme",
      "Yüksek çözünürlüklü dijital teslim"
    ],
    delivery: "7–14 iş günü"
  },
  {
    id: "video",
    name: "Video Çekimi",
    price: 9000,
    image: "assets/images/services/video-cekimi.webp",
    gallery: [
      "assets/images/services/video-cekimi.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Hazırlıktan kutlamaya uzanan günün sesini, hareketini ve duygusunu sinematik bir anlatıyla kaydediyoruz.",
    features: [
      "4K profesyonel video kaydı",
      "Hazırlık ve tören anları",
      "Temel kurgu ve renk düzenleme",
      "Dijital bağlantı ile teslim"
    ],
    delivery: "14–21 iş günü"
  },
  {
    id: "drone",
    name: "Drone Çekimi",
    price: 8000,
    image: "assets/images/services/drone-cekimi.webp",
    gallery: [
      "assets/images/services/drone-cekimi.webp",
      "assets/images/venue-pavilion.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Profesyonel drone ile düğününüzün en özel anlarını havadan yakalıyoruz. Mekânın ölçeğini ve atmosferini sinematik görüntülerle unutulmaz hale getiriyoruz.",
    features: [
      "4K kalitede hava görüntüsü",
      "Özel rota planlaması",
      "Düğün mekânına uygun çekim",
      "Ortalama 3–5 dakikalık klip içeriği"
    ],
    delivery: "7–14 iş günü"
  },
  {
    id: "klip",
    name: "Düğün Klibi",
    price: 12000,
    image: "assets/images/services/klip-cekimi.webp",
    gallery: [
      "assets/images/services/klip-cekimi.webp",
      "assets/images/services/video-cekimi.webp",
      "assets/images/groom-portrait.webp"
    ],
    description:
      "Hikâyenizi seçtiğiniz müzik, güçlü sahneler ve dinamik bir kurgu ile size özel kısa bir düğün filmine dönüştürüyoruz.",
    features: [
      "Size özel hikâye akışı",
      "Sinematik çekim ve kurgu",
      "Lisanslı müzik seçeneği",
      "Sosyal medya için kısa versiyon"
    ],
    delivery: "14–21 iş günü"
  },
  {
    id: "album",
    name: "Albüm Tasarımı",
    price: 7000,
    image: "assets/images/services/album-tasarimi.webp",
    gallery: [
      "assets/images/services/album-tasarimi.webp",
      "assets/images/bride-portrait.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Seçtiğiniz kareleri kaliteli malzeme, dengeli sayfa tasarımı ve size özel kapak seçenekleriyle kalıcı bir hatıraya dönüştürüyoruz.",
    features: [
      "Kişiye özel sayfa tasarımı",
      "Premium baskı ve ciltleme",
      "Kapak malzemesi seçenekleri",
      "Baskı öncesi dijital onay"
    ],
    delivery: "21–30 iş günü"
  },
  {
    id: "video360",
    name: "360° Video Booth",
    price: 5500,
    image: "assets/images/services/360-video.webp",
    gallery: [
      "assets/images/services/360-video.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Misafirlerinizin eğlenceli anlarını hareketli kamera platformuyla kaydediyor, anında paylaşılabilir kısa videolara dönüştürüyoruz.",
    features: [
      "Profesyonel 360° platform",
      "Etkinlik boyunca operatör",
      "Kişiselleştirilmiş video çerçevesi",
      "Anında dijital paylaşım"
    ],
    delivery: "Etkinlik günü"
  }
];

function formatPrice(amount) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0
  }).format(amount);
}

document.addEventListener("DOMContentLoaded", () => {
  const detailDialog = document.getElementById("home-service-detail");
  if (!detailDialog) return;

  const detailClose = detailDialog.querySelector(".js-detail-close");
  const detailMainImage = detailDialog.querySelector(".js-detail-main-image");
  const detailNumber = detailDialog.querySelector(".js-detail-number");
  const detailThumbs = detailDialog.querySelector(".js-detail-thumbs");
  const detailTitle = detailDialog.querySelector(".js-detail-title");
  const detailDescription = detailDialog.querySelector(".js-detail-description");
  const detailFeatures = detailDialog.querySelector(".js-detail-features");
  const detailDelivery = detailDialog.querySelector(".js-detail-delivery");
  const detailPrice = detailDialog.querySelector(".js-detail-price");
  const detailAction = detailDialog.querySelector(".js-detail-action");

  function setDetailImage(service, imagePath, index) {
    detailMainImage.src = imagePath;
    detailMainImage.alt = `${service.name} çekim örneği ${index + 1}`;
    detailNumber.textContent = `0${index + 1}`;
    detailThumbs.querySelectorAll("button").forEach((btn, idx) => {
      btn.classList.toggle("is-active", idx === index);
    });
  }

  function openHomeServiceDetail(serviceId) {
    const service = homeServices.find((item) => item.id === serviceId);
    if (!service) return;

    detailTitle.textContent = service.name;
    detailDescription.textContent = service.description;

    detailFeatures.replaceChildren(
      ...service.features.map((feature) => {
        const item = document.createElement("li");
        item.textContent = feature;
        return item;
      })
    );

    detailDelivery.textContent = service.delivery;
    detailPrice.textContent = formatPrice(service.price);

    if (detailAction) {
      detailAction.href = `paketini-olustur.html?hizmet=${service.id}`;
    }

    detailThumbs.replaceChildren(
      ...service.gallery.map((image, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", `${index + 1}. çekim örneğini göster`);

        const img = document.createElement("img");
        img.src = image;
        img.alt = "";

        button.append(img);
        button.addEventListener("click", () => setDetailImage(service, image, index));
        return button;
      })
    );

    setDetailImage(service, service.gallery[0], 0);
    detailDialog.showModal();
  }

  // "İncele" butonlarına tıklama dinleyicileri
  document.querySelectorAll("[data-open-service]").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      const serviceId = button.dataset.openService;
      if (serviceId) {
        openHomeServiceDetail(serviceId);
      }
    });
  });

  if (detailClose) {
    detailClose.addEventListener("click", () => {
      detailDialog.close();
    });
  }

  detailDialog.addEventListener("click", (e) => {
    const rect = detailDialog.getBoundingClientRect();
    const isInDialog =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width;
    if (!isInDialog) {
      detailDialog.close();
    }
  });
});
