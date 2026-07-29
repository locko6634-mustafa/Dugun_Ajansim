const homeServices = [
  {
    id: "fotograf",
    name: "Düğün Fotoğrafçılığı",
    price: 7000,
    image: "assets/images/services/fotograf-cekimi.webp",
    gallery: [
      "assets/images/services/fotograf-cekimi.webp",
      "assets/images/hero-couple.webp",
      "assets/images/bride-portrait.webp"
    ],
    description:
      "Hazırlık anından son dansa kadar en özel anlarınızı doğal, estetik ve zamansız karelerle ölümsüzleştiriyoruz.",
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
    name: "Sinematik Düğün Filmi",
    price: 9000,
    image: "assets/images/services/video-cekimi.webp",
    gallery: [
      "assets/images/services/video-cekimi.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Düğününüzü yalnızca kaydetmiyor, en özel anlarınızı sinematik bir anlatımla ömür boyu izlemek isteyeceğiniz bir filme dönüştürüyoruz.",
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
      "Mekânın atmosferini ve düğününüzün ihtişamını etkileyici hava görüntüleriyle farklı bir bakış açısıyla yansıtıyoruz.",
    features: [
      "4K kalitede hava görüntüsü",
      "Özel rota planlaması",
      "Düğün mekânına uygun çekim",
      "Ortalama 3–5 dakikalık klip içeriği"
    ],
    delivery: "7–14 iş günü"
  },
  {
    id: "jimmy-jib",
    name: "Jimmy Jib Çekimi",
    price: null,
    image: "assets/images/services/klip-cekimi.webp",
    gallery: [
      "assets/images/services/klip-cekimi.webp",
      "assets/images/services/video-cekimi.webp",
      "assets/images/groom-portrait.webp"
    ],
    description:
      "Profesyonel vinç sistemiyle geniş açılı, akıcı ve sinema kalitesinde görüntüler elde ediyoruz.",
    features: [],
    delivery: null
  },
  {
    id: "album",
    name: "Premium Albüm Tasarımı",
    price: 7000,
    image: "assets/images/services/album-tasarimi.webp",
    gallery: [
      "assets/images/services/album-tasarimi.webp",
      "assets/images/bride-portrait.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "En değerli karelerinizi, yıllarca saklayabileceğiniz özel tasarım premium albümlere dönüştürüyoruz.",
    features: [
      "Kişiye özel sayfa tasarımı",
      "Premium baskı ve ciltleme",
      "Kapak malzemesi seçenekleri",
      "Baskı öncesi dijital onay"
    ],
    delivery: "21–30 iş günü"
  },
  {
    id: "organizasyon",
    name: "Organizasyon Hizmetleri",
    price: null,
    image: "assets/images/services/360-video.webp",
    gallery: [
      "assets/images/services/360-video.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "360° Video Booth, Instax misafir albümü, QR kodlu dijital anı paylaşımı, karşılama panoları, anı köşeleri ve düğününüze değer katan özel organizasyon çözümlerini tek çatı altında sunuyoruz.",
    features: [],
    delivery: null
  },
  {
    id: "dis-cekim",
    name: "Dış Çekim",
    price: null,
    image: "assets/images/hero-couple.webp",
    gallery: [
      "assets/images/hero-couple.webp",
      "assets/images/bride-portrait.webp",
      "assets/images/groom-portrait.webp"
    ],
    description:
      "Size özel seçilen konsept mekânlarda, doğal ışık ve profesyonel bakış açısıyla unutulmaz dış çekim deneyimleri sunuyoruz.",
    features: [],
    delivery: null
  },
  {
    id: "aninda-baski",
    name: "Anında Fotoğraf Baskısı",
    price: null,
    image: "assets/images/bride-portrait.webp",
    gallery: [
      "assets/images/bride-portrait.webp",
      "assets/images/services/fotograf-cekimi.webp",
      "assets/images/hero-couple.webp"
    ],
    description:
      "Profesyonel baskı hizmetimizle çekilen fotoğrafları düğün sırasında misafirlerinize anında teslim ediyoruz.",
    features: [],
    delivery: null
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
    detailFeatures.hidden = service.features.length === 0;
    detailFeatures.style.display = service.features.length ? "" : "none";

    const deliveryBlock = detailDelivery.closest(".service-detail__delivery");
    detailDelivery.textContent = service.delivery || "";
    if (deliveryBlock) {
      deliveryBlock.hidden = !service.delivery;
      deliveryBlock.style.display = service.delivery ? "" : "none";
    }

    const hasPrice = Number.isFinite(service.price);
    detailPrice.textContent = hasPrice ? formatPrice(service.price) : "";
    detailPrice.hidden = !hasPrice;
    detailPrice.style.display = hasPrice ? "" : "none";

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
