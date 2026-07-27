export const basePackages = {
  mini: {
    name: "Mini Paket",
    price: 20000,
    image: "assets/images/hero-couple.webp",
  },
  signature: {
    name: "Ä°mza Paket",
    price: 28000,
    image: "assets/images/services/fotograf-cekimi.webp",
  },
  timeless: {
    name: "ZamansÄ±z Paket",
    price: 36000,
    image: "assets/images/venue-pavilion.webp",
  },
};

export const services = [
  {
    id: "fotograf",
    category: "photo",
    name: "FotoÄŸraf Ã‡ekimi",
    price: 7000,
    image: "assets/images/services/fotograf-cekimi.webp",
    gallery: [
      "assets/images/services/fotograf-cekimi.webp",
      "assets/images/hero-couple.webp",
      "assets/images/bride-portrait.webp",
    ],
    description:
      "GÃ¼nÃ¼n en doÄŸal anlarÄ±nÄ± yÃ¶nlendirmesi gÃ¼Ã§lÃ¼, zarif ve zamansÄ±z karelere dÃ¶nÃ¼ÅŸtÃ¼rÃ¼yoruz. Ã‡ekim planÄ± dÃ¼ÄŸÃ¼n akÄ±ÅŸÄ±nÄ±za gÃ¶re Ã¶nceden hazÄ±rlanÄ±r.",
    features: [
      "Profesyonel fotoÄŸraf ekibi",
      "Ã‡ift ve aile portreleri",
      "Ã–zenli renk ve Ä±ÅŸÄ±k dÃ¼zenleme",
      "YÃ¼ksek Ã§Ã¶zÃ¼nÃ¼rlÃ¼klÃ¼ dijital teslim",
    ],
    delivery: "7â€“14 iÅŸ gÃ¼nÃ¼",
  },
  {
    id: "video",
    category: "video",
    name: "Video Ã‡ekimi",
    price: 9000,
    image: "assets/images/services/video-cekimi.webp",
    gallery: [
      "assets/images/services/video-cekimi.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "HazÄ±rlÄ±ktan kutlamaya uzanan gÃ¼nÃ¼n sesini, hareketini ve duygusunu sinematik bir anlatÄ±yla kaydediyoruz.",
    features: [
      "4K profesyonel video kaydÄ±",
      "HazÄ±rlÄ±k ve tÃ¶ren anlarÄ±",
      "Temel kurgu ve renk dÃ¼zenleme",
      "Dijital baÄŸlantÄ± ile teslim",
    ],
    delivery: "14â€“21 iÅŸ gÃ¼nÃ¼",
  },
  {
    id: "drone",
    category: "video",
    name: "Drone Ã‡ekimi",
    price: 8000,
    image: "assets/images/services/drone-cekimi.webp",
    gallery: [
      "assets/images/services/drone-cekimi.webp",
      "assets/images/venue-pavilion.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Profesyonel drone ile dÃ¼ÄŸÃ¼nÃ¼nÃ¼zÃ¼n en Ã¶zel anlarÄ±nÄ± havadan yakalÄ±yoruz. MekÃ¢nÄ±n Ã¶lÃ§eÄŸini ve atmosferini sinematik gÃ¶rÃ¼ntÃ¼lerle unutulmaz hale getiriyoruz.",
    features: [
      "4K kalitede hava gÃ¶rÃ¼ntÃ¼sÃ¼",
      "Ã–zel rota planlamasÄ±",
      "DÃ¼ÄŸÃ¼n mekÃ¢nÄ±na uygun Ã§ekim",
      "Ortalama 3â€“5 dakikalÄ±k klip iÃ§eriÄŸi",
    ],
    delivery: "7â€“14 iÅŸ gÃ¼nÃ¼",
  },
  {
    id: "klip",
    category: "video",
    name: "DÃ¼ÄŸÃ¼n Klibi",
    price: 12000,
    image: "assets/images/services/klip-cekimi.webp",
    gallery: [
      "assets/images/services/klip-cekimi.webp",
      "assets/images/services/video-cekimi.webp",
      "assets/images/groom-portrait.webp",
    ],
    description:
      "HikÃ¢yenizi seÃ§tiÄŸiniz mÃ¼zik, gÃ¼Ã§lÃ¼ sahneler ve dinamik bir kurgu ile size Ã¶zel kÄ±sa bir dÃ¼ÄŸÃ¼n filmine dÃ¶nÃ¼ÅŸtÃ¼rÃ¼yoruz.",
    features: [
      "Size Ã¶zel hikÃ¢ye akÄ±ÅŸÄ±",
      "Sinematik Ã§ekim ve kurgu",
      "LisanslÄ± mÃ¼zik seÃ§eneÄŸi",
      "Sosyal medya iÃ§in kÄ±sa versiyon",
    ],
    delivery: "14â€“21 iÅŸ gÃ¼nÃ¼",
  },
  {
    id: "album",
    category: "keepsake",
    name: "AlbÃ¼m TasarÄ±mÄ±",
    price: 7000,
    image: "assets/images/services/album-tasarimi.webp",
    gallery: [
      "assets/images/services/album-tasarimi.webp",
      "assets/images/bride-portrait.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "SeÃ§tiÄŸiniz kareleri kaliteli malzeme, dengeli sayfa tasarÄ±mÄ± ve size Ã¶zel kapak seÃ§enekleriyle kalÄ±cÄ± bir hatÄ±raya dÃ¶nÃ¼ÅŸtÃ¼rÃ¼yoruz.",
    features: [
      "KiÅŸiye Ã¶zel sayfa tasarÄ±mÄ±",
      "Premium baskÄ± ve ciltleme",
      "Kapak malzemesi seÃ§enekleri",
      "BaskÄ± Ã¶ncesi dijital onay",
    ],
    delivery: "21â€“30 iÅŸ gÃ¼nÃ¼",
  },
  {
    id: "video360",
    category: "keepsake",
    name: "360Â° Video Booth",
    price: 5500,
    image: "assets/images/services/360-video.webp",
    gallery: [
      "assets/images/services/360-video.webp",
      "assets/images/services/klip-cekimi.webp",
      "assets/images/hero-couple.webp",
    ],
    description:
      "Misafirlerinizin eÄŸlenceli anlarÄ±nÄ± hareketli kamera platformuyla kaydediyor, anÄ±nda paylaÅŸÄ±labilir kÄ±sa videolara dÃ¶nÃ¼ÅŸtÃ¼rÃ¼yoruz.",
    features: [
      "Profesyonel 360Â° platform",
      "Etkinlik boyunca operatÃ¶r",
      "KiÅŸiselleÅŸtirilmiÅŸ video Ã§erÃ§evesi",
      "AnÄ±nda dijital paylaÅŸÄ±m",
    ],
    delivery: "Etkinlik gÃ¼nÃ¼",
  },
];

