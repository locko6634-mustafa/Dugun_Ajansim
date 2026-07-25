'use strict';

const SITE_CONFIG = Object.freeze({
  demoMode: true,
  whatsappNumber: '',
});

document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const body = document.body;
  const selectAll = (selector, scope = document) =>
    Array.from(scope.querySelectorAll(selector));
  const scheduleOnAnimationFrame = (callback) => {
    let scheduled = false;

    return () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        callback();
      });
    };
  };
  const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktopNavigationQuery = window.matchMedia('(min-width: 62.01rem)');
  const mobileCtaQuery = window.matchMedia('(max-width: 45rem)');
  const hasReducedMotion = () => reduceMotionQuery.matches;
  const gsapAvailable = Boolean(window.gsap && window.ScrollTrigger);

  /* Preloader & Page Load Handler */
  const preloader = document.querySelector('#preloader');
  const heroEl = document.querySelector('.hero');

  const hidePreloader = () => {
    if (!preloader || preloader.classList.contains('is-hidden')) return;
    preloader.classList.add('is-hidden');
    body.classList.add('is-page-loaded');
    if (heroEl) heroEl.classList.add('is-loaded');
  };

  const startTime = performance.now();
  const minDisplayTime = 750;

  const triggerHide = () => {
    const elapsedTime = performance.now() - startTime;
    const remainingTime = Math.max(0, minDisplayTime - elapsedTime);
    setTimeout(hidePreloader, remainingTime);
  };

  if (document.readyState === 'complete') {
    triggerHide();
  } else {
    window.addEventListener('load', triggerHide, { once: true });
  }

  setTimeout(hidePreloader, 2000);

  /* Header and navigation */
  const siteHeader = document.querySelector('#site-header');
  const menuToggle = document.querySelector('#menu-toggle');
  const siteNav = document.querySelector('#site-nav');
  const scrollProgressBar = document.querySelector('#scroll-progress-bar');
  const headerScenes = selectAll('[data-scene]');

  const updateScrollProgress = () => {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollableHeight > 0 ? Math.min(window.scrollY / scrollableHeight, 1) : 0;
    if (scrollProgressBar) scrollProgressBar.style.transform = `scaleX(${progress})`;
  };

  const scheduleScrollProgress = scheduleOnAnimationFrame(updateScrollProgress);

  updateScrollProgress();
  window.addEventListener('scroll', scheduleScrollProgress, { passive: true });
  window.addEventListener('resize', scheduleScrollProgress);

  const applyHeaderTheme = (scene) => {
    if (!siteHeader || !scene) return;
    siteHeader.dataset.theme = scene.dataset.scene === 'dark' ? 'light' : 'dark';
  };

  applyHeaderTheme(headerScenes[0]);

  if ('IntersectionObserver' in window && headerScenes.length) {
    const sceneStates = new Map();
    const headerSceneObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => sceneStates.set(entry.target, entry));
        const activeScene = Array.from(sceneStates.values())
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.boundingClientRect.top - a.boundingClientRect.top)[0];
        if (activeScene) applyHeaderTheme(activeScene.target);
      },
      { rootMargin: '0% 0% -90% 0%', threshold: 0 },
    );
    headerScenes.forEach((scene) => headerSceneObserver.observe(scene));
  }

  const setMenuState = (open, restoreFocus = false) => {
    if (!menuToggle || !siteNav) return;
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
    siteNav.dataset.open = String(open);
    body.classList.toggle('is-menu-open', open);
    if (restoreFocus) menuToggle.focus();
  };

  menuToggle?.addEventListener('click', () => {
    setMenuState(menuToggle.getAttribute('aria-expanded') !== 'true');
  });

  siteNav?.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenuState(false);
  });

  document.addEventListener('click', (event) => {
    if (
      menuToggle?.getAttribute('aria-expanded') === 'true' &&
      !siteNav?.contains(event.target) &&
      !menuToggle.contains(event.target)
    ) {
      setMenuState(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') {
      setMenuState(false, true);
    }
  });

  desktopNavigationQuery.addEventListener('change', ({ matches }) => {
    if (matches) setMenuState(false);
  });

  /* Reveal motion */
  const revealItems = selectAll('[data-reveal]');
  const heroRevealItems = selectAll('.hero [data-reveal]');
  heroRevealItems.forEach((item, index) => {
    item.style.setProperty('--reveal-order', index);
  });

  const revealAll = () => {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  };

  if (hasReducedMotion() || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    revealItems.forEach((item) => revealObserver.observe(item));
  }

  const handleMotionPreference = ({ matches }) => {
    if (matches) revealAll();
  };
  reduceMotionQuery.addEventListener('change', handleMotionPreference);
  handleMotionPreference(reduceMotionQuery);

  /* Demo notification */
  const demoToast = document.querySelector('#demo-toast');
  const toastMessage = demoToast?.querySelector('[data-toast-message]');
  let toastTimer;

  const hideDemoToast = () => {
    if (!demoToast || demoToast.hidden) return;
    demoToast.classList.remove('is-visible');
    window.clearTimeout(toastTimer);
    window.setTimeout(() => {
      demoToast.hidden = true;
    }, 360);
  };

  const showDemoToast = (message) => {
    if (!demoToast) return;
    if (message && toastMessage) toastMessage.textContent = message;
    demoToast.hidden = false;
    window.requestAnimationFrame(() => demoToast.classList.add('is-visible'));
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(hideDemoToast, 5200);
  };

  demoToast?.querySelector('[data-toast-close]')?.addEventListener('click', hideDemoToast);

  /* WhatsApp links and selected package */
  const normalizedWhatsAppNumber = SITE_CONFIG.whatsappNumber.replace(/\D/g, '');
  const whatsappEnabled =
    !SITE_CONFIG.demoMode && normalizedWhatsAppNumber.length >= 10;
  const whatsappTargets = selectAll('[data-whatsapp]');
  const packageButtons = selectAll('[data-package-select]');
  const mobileCta = document.querySelector('#mobile-sticky-cta') || document.querySelector('#mobile-cta');

  const buildWhatsAppMessage = (packageName) =>
    [
      'Merhaba DüğünAjansım,',
      `${packageName || 'çekim hizmetleri'} için bilgi ve tarih uygunluğu almak istiyorum.`,
      'Düğün tarihi:',
      'Mekân / ilçe:',
    ].join('\n');

  const buildWhatsAppUrl = (packageName) =>
    `https://wa.me/${normalizedWhatsAppNumber}?text=${encodeURIComponent(
      buildWhatsAppMessage(packageName),
    )}`;

  const updateWhatsAppTargets = () => {
    whatsappTargets.forEach((target) => {
      if (whatsappEnabled) {
        target.href = buildWhatsAppUrl(target.dataset.package);
        target.target = '_blank';
        target.rel = 'noopener noreferrer';
        target.removeAttribute('aria-describedby');
      } else {
        target.href = '#demo-toast';
        if (demoToast) target.setAttribute('aria-describedby', demoToast.id);
      }
    });
  };

  whatsappTargets.forEach((target) => {
    target.addEventListener('click', (event) => {
      if (whatsappEnabled) return;
      event.preventDefault();
      const selectedName = target.dataset.package || 'Seçtiğiniz çekim';
      showDemoToast(
        `“${selectedName}” için WhatsApp mesajı hazır. Gerçek numara eklendiğinde bağlantı etkinleşecektir.`,
      );
    });
  });

  const setSelectedPackage = (button) => {
    const packageName = button.dataset.package || 'Seçili paket';
    const packagePrice = button.dataset.packagePrice || '';

    packageButtons.forEach((candidate) => {
      const selected = candidate === button;
      candidate.setAttribute('aria-pressed', String(selected));
      candidate.textContent = selected ? 'Seçildi ✓' : 'Bu paketi seç';
      candidate.classList.toggle('button--primary', selected);
      candidate.classList.toggle('button--outline', !selected);
      candidate.closest('.package')?.classList.toggle('is-selected', selected);
    });

    if (!mobileCta) return;
    const packageLabel = mobileCta.querySelector('[data-selected-package]');
    const priceLabel = mobileCta.querySelector('[data-selected-price]');
    const mobileLink = mobileCta.querySelector('[data-whatsapp]');
    const shortName = packageName.split('—')[0].trim();

    if (packageLabel) packageLabel.textContent = shortName;
    if (priceLabel) priceLabel.textContent = packagePrice;
    if (mobileLink) {
      mobileLink.dataset.package = packageName;
      mobileLink.href = whatsappEnabled ? buildWhatsAppUrl(packageName) : '#demo-toast';
    }
  };

  packageButtons.forEach((button) => {
    button.addEventListener('click', () => setSelectedPackage(button));
  });

  const initialPackage =
    packageButtons.find((button) => button.getAttribute('aria-pressed') === 'true') ||
    packageButtons[0];
  if (initialPackage) setSelectedPackage(initialPackage);
  updateWhatsAppTargets();

  /* Context-aware mobile conversion bar */
  const packageSection = document.querySelector('#paketler');
  const finalCtaSection = document.querySelector('.final-cta');
  const updateMobileCta = () => {
    if (!mobileCta) return;

    const scrollY = window.scrollY || window.pageYOffset || 0;
    const heroBottom = heroEl?.getBoundingClientRect().bottom ?? 0;

    // Kullanıcı henüz aşağı kaydırmamışsa (scrollY < 100) veya Hero bölümü ekrandayken buton gizlidir
    if (scrollY < 100 || heroBottom > window.innerHeight * 0.2) {
      mobileCta.classList.remove('is-visible');
      mobileCta.dataset.ctaState = 'hidden';
    } else {
      mobileCta.classList.add('is-visible');
      mobileCta.dataset.ctaState = 'visible';
    }
  };

  const scheduleMobileCta = scheduleOnAnimationFrame(updateMobileCta);
  window.addEventListener('scroll', scheduleMobileCta, { passive: true });
  window.addEventListener('resize', updateMobileCta);
  updateMobileCta();

  /* Gallery lightbox */
  const lightbox = document.querySelector('#lightbox-dialog');
  const lightboxImage = lightbox?.querySelector('[data-lightbox-image]');
  const lightboxCaption = lightbox?.querySelector('[data-lightbox-caption-target]');
  const closeLightboxButton = lightbox?.querySelector('[data-dialog-close]');
  let lastLightboxTrigger = null;

  const closeLightbox = () => {
    if (!lightbox) return;
    if (typeof lightbox.close === 'function' && lightbox.open) lightbox.close();
    body.classList.remove('is-dialog-open');
  };

  selectAll('[data-lightbox-src]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      if (!lightbox || !lightboxImage) return;
      lastLightboxTrigger = trigger;
      lightboxImage.src = trigger.dataset.lightboxSrc;
      lightboxImage.alt = trigger.dataset.lightboxAlt || '';
      if (lightboxCaption) {
        lightboxCaption.textContent = trigger.dataset.lightboxCaption || '';
      }

      body.classList.add('is-dialog-open');
      if (typeof lightbox.showModal === 'function') {
        lightbox.showModal();
      } else {
        lightbox.setAttribute('open', '');
      }
    });
  });

  closeLightboxButton?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  lightbox?.addEventListener('close', () => {
    body.classList.remove('is-dialog-open');
    lastLightboxTrigger?.focus();
  });

  /* FAQ: keep one answer open at a time */
  const faqItems = selectAll('.faq details');
  faqItems.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      faqItems.forEach((candidate) => {
        if (candidate !== item) candidate.open = false;
      });
    });
  });

  /* Editorial service index */
  const serviceLines = selectAll('[data-service]');
  const setActiveService = (activeLine) => {
    serviceLines.forEach((line) => {
      const selected = line === activeLine;
      line.classList.toggle('is-active', selected);
      line.setAttribute('aria-current', selected ? 'true' : 'false');
    });
  };

  const isHoverable = window.matchMedia('(hover: hover)').matches;

  serviceLines.forEach((line) => {
    if (isHoverable) {
      line.addEventListener('pointerenter', () => setActiveService(line));
    }
    line.addEventListener('focus', () => setActiveService(line));
  });

  if ('IntersectionObserver' in window && serviceLines.length) {
    const serviceObserver = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visibleEntry) setActiveService(visibleEntry.target);
      },
      { rootMargin: '-35% 0px -45% 0px', threshold: [0.05, 0.4, 0.8] },
    );
    serviceLines.forEach((line) => serviceObserver.observe(line));
  }

  /* Photo sequence */
  const showreel = document.querySelector('[data-showreel-stage]');
  const showreelSection = showreel?.closest('.showreel');
  const showreelFrames = selectAll('[data-showreel-frame]', showreel || document);
  const showreelProgress = selectAll('.showreel__progress span', showreel || document);
  const showreelToggle = showreel?.querySelector('[data-showreel-toggle]');
  const showreelLabel = showreelToggle?.querySelector('[data-play-label]');
  const showreelIcon = showreelToggle?.querySelector('[data-play-icon]');
  let activeFrame = 0;
  let sequenceTimer = null;
  let sequencePaused = hasReducedMotion();

  const renderFrame = (index) => {
    if (!showreelFrames.length || !showreel) return;
    activeFrame = (index + showreelFrames.length) % showreelFrames.length;
    showreelFrames.forEach((frame, frameIndex) => {
      frame.classList.toggle('is-active', frameIndex === activeFrame);
    });
    showreelProgress.forEach((bar, barIndex) => {
      bar.classList.toggle('is-active', barIndex === activeFrame);
    });
  };

  const stopSequence = () => {
    window.clearInterval(sequenceTimer);
    sequenceTimer = null;
  };

  const startSequence = () => {
    stopSequence();
    if (
      sequencePaused ||
      hasReducedMotion() ||
      document.hidden ||
      root.classList.contains('has-scroll-sequence')
    ) return;
    sequenceTimer = window.setInterval(() => renderFrame(activeFrame + 1), 4800);
  };

  const renderSequenceToggle = () => {
    if (!showreelToggle) return;
    showreelToggle.setAttribute('aria-pressed', String(sequencePaused));
    if (showreelLabel) {
      showreelLabel.textContent = sequencePaused ? 'Sekansı oynat' : 'Sekansı durdur';
    }
    if (showreelIcon) showreelIcon.textContent = sequencePaused ? '▶' : 'Ⅱ';
  };

  showreelToggle?.addEventListener('click', () => {
    sequencePaused = !sequencePaused;
    renderSequenceToggle();
    startSequence();
  });

  document.addEventListener('visibilitychange', startSequence);
  reduceMotionQuery.addEventListener('change', ({ matches }) => {
    if (matches) sequencePaused = true;
    renderSequenceToggle();
    startSequence();
  });

  renderFrame(0);
  renderSequenceToggle();
  startSequence();

  /* GSAP enhancement: the page remains functional when the library is absent. */
  const initCinematicMotion = () => {
    if (!gsapAvailable || hasReducedMotion()) return;

    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);
    gsap.from('.hero__content > *', {
      y: 34,
      autoAlpha: 0,
      duration: 0.72,
      stagger: 0.08,
      ease: 'power3.out',
      clearProps: 'transform,opacity,visibility',
    });
    /* Dokunmatik Cihazlarda Esnek Soft Spring Yaylanma */
    selectAll('.glass-card-neon').forEach((card) => {
      card.addEventListener('touchstart', () => {
        card.classList.add('is-touching');
      }, { passive: true });

      const removeTouch = () => {
        card.classList.remove('is-touching');
      };

      card.addEventListener('touchend', removeTouch, { passive: true });
      card.addEventListener('touchcancel', removeTouch, { passive: true });
    });

    /* GSAP Paket Kartları Süzülerek Geliş Animasyonu (Görünürlük Kilidi Kaldırıldı) */
    if (selectAll('#paketler .package').length && !hasReducedMotion()) {
      gsap.from('#paketler .package', {
        y: 30,
        duration: 0.7,
        stagger: 0.12,
        ease: 'power2.out',
        clearProps: 'transform',
        scrollTrigger: {
          trigger: '#paketler',
          start: 'top 90%',
          once: true,
        },
      });
    }

    /* 3D Perspective Tilt Kart Etkileşimi (Sadece Masaüstü / Fare Cihazlarında) */
    const isFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (isFinePointer) {
      selectAll('.glass-card-neon').forEach((card) => {
        card.addEventListener('mousemove', (e) => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const rotateX = (y - centerY) / 12;
          const rotateY = (centerX - x) / 12;

          gsap.to(card, {
            rotateX: rotateX,
            rotateY: rotateY,
            transformPerspective: 1000,
            scale: 1.02,
            duration: 0.4,
            ease: 'power2.out',
          });
        });

        card.addEventListener('mouseleave', () => {
          gsap.to(card, {
            rotateX: 0,
            rotateY: 0,
            scale: 1,
            duration: 0.6,
            ease: 'power2.out',
          });
        });
      });

      /* Magnetik Buton Etkileşimi */
      selectAll('.magnetic-element').forEach((element) => {
        element.addEventListener('mousemove', (e) => {
          const rect = element.getBoundingClientRect();
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;
          gsap.to(element, {
            x: x * 0.25,
            y: y * 0.25,
            rotation: x * 0.02,
            duration: 0.3,
            ease: 'power2.out',
          });
        });

        element.addEventListener('mouseleave', () => {
          gsap.to(element, {
            x: 0,
            y: 0,
            rotation: 0,
            duration: 0.6,
            ease: 'elastic.out(1, 0.4)',
          });
        });
      });
    }

    /* Parallax Görsel Kaydırma */
    selectAll('.parallax-img').forEach((img) => {
      gsap.to(img, {
        yPercent: 12,
        ease: 'none',
        scrollTrigger: {
          trigger: img.closest('.parallax-wrapper') || img,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.8,
        },
      });
    });

    gsap.from('.hero__arch', {
      clipPath: 'inset(0 0 100% 0 round 48% 48% 2rem 2rem)',
      scale: 1.035,
      duration: 0.95,
      ease: 'power3.inOut',
      clearProps: 'clipPath,transform',
    });

    selectAll('.story').forEach((story, index) => {
      const media = story.querySelector('.story__media');
      const image = story.querySelector('img');
      if (!media || !image) return;
      gsap.from(media, {
        clipPath: index % 2
          ? 'inset(0 0 100% 0 round 0.7rem)'
          : 'inset(100% 0 0 0 round 0.7rem)',
        duration: 1.15,
        ease: 'power3.inOut',
        scrollTrigger: { trigger: story, start: 'top 84%', once: true },
      });
      gsap.fromTo(
        image,
        { yPercent: -5, scale: 1.08 },
        {
          yPercent: 5,
          scale: 1.02,
          ease: 'none',
          scrollTrigger: {
            trigger: story,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.8,
          },
        },
      );
    });

    gsap.from('.process__steps', {
      '--timeline-progress': 0,
      scrollTrigger: {
        trigger: '.process__steps',
        start: 'top 78%',
        end: 'bottom 62%',
        scrub: 0.7,
      },
    });

    const desktopMotion = gsap.matchMedia();
    desktopMotion.add('(min-width: 62.01rem)', () => {
      if (!showreel || !showreelSection || showreelFrames.length < 2) return undefined;

      root.classList.add('has-scroll-sequence');
      sequencePaused = true;
      stopSequence();
      renderSequenceToggle();

      gsap.set(showreelFrames, { autoAlpha: 0, scale: 1.055 });
      gsap.set(showreelFrames[0], { autoAlpha: 1, scale: 1 });

      const setCinematicHeader = (hidden) => {
        siteHeader?.classList.toggle('is-cinematic-hidden', hidden);
      };

      const sequenceTimeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: showreelSection,
          start: 'top top',
          end: () => `+=${Math.round(window.innerHeight * showreelFrames.length * 0.78)}`,
          pin: showreelSection,
          pinSpacing: true,
          invalidateOnRefresh: true,
          scrub: 0.7,
          anticipatePin: 1,
          onEnter: () => setCinematicHeader(true),
          onEnterBack: () => setCinematicHeader(true),
          onLeave: () => setCinematicHeader(false),
          onLeaveBack: () => setCinematicHeader(false),
          onUpdate: (self) => {
            const frameIndex = Math.min(
              showreelFrames.length - 1,
              Math.floor(self.progress * showreelFrames.length),
            );
            if (frameIndex !== activeFrame) renderFrame(frameIndex);
          },
        },
      });

      for (let index = 1; index < showreelFrames.length; index += 1) {
        sequenceTimeline
          .to(showreelFrames[index - 1], { autoAlpha: 0, scale: 0.985, duration: 1 }, index - 0.25)
          .fromTo(
            showreelFrames[index],
            { autoAlpha: 0, scale: 1.055 },
            { autoAlpha: 1, scale: 1, duration: 1 },
            index - 0.25,
          );
      }

      return () => {
        setCinematicHeader(false);
        root.classList.remove('has-scroll-sequence');
        sequencePaused = hasReducedMotion();
        gsap.set(showreelFrames, { clearProps: 'opacity,visibility,transform' });
        renderFrame(0);
        renderSequenceToggle();
        startSequence();
      };
    });

    ScrollTrigger.refresh();
  };

  initCinematicMotion();

  /* Video Autoplay & Mute/Unmute Controller */
  const initVideoControllers = () => {
    const videos = selectAll('video');
    const muteToggles = selectAll('[data-video-mute-toggle]');

    muteToggles.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const container = btn.closest('.hero__arch, .showreel-card__video-wrapper') || btn.parentElement;
        const video = container ? container.querySelector('video') : null;
        if (!video) return;

        if (video.muted) {
          // Mute all other videos before unmuting this one
          videos.forEach((v) => {
            if (v !== video) {
              v.muted = true;
              const containerOther = v.closest('.hero__arch, .showreel-card__video-wrapper') || v.parentElement;
              const otherBtn = containerOther?.querySelector('[data-video-mute-toggle]');
              if (otherBtn) {
                otherBtn.classList.remove('is-unmuted');
                const label = otherBtn.querySelector('.sound-label');
                if (label) label.textContent = 'Sesi Aç';
              }
            }
          });
          video.muted = false;
          btn.classList.add('is-unmuted');
          const label = btn.querySelector('.sound-label');
          if (label) label.textContent = 'Sesi Kapat';
        } else {
          video.muted = true;
          btn.classList.remove('is-unmuted');
          const label = btn.querySelector('.sound-label');
          if (label) label.textContent = 'Sesi Aç';
        }
      });
    });

    // IntersectionObserver to auto-play when in viewport and pause when off-screen
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const video = entry.target;
            if (entry.isIntersecting) {
              video.play().catch(() => {});
            } else {
              video.pause();
            }
          });
        },
        { threshold: 0.25 }
      );

      videos.forEach((video) => observer.observe(video));
    }
  };

  initVideoControllers();

  /* Current year */
  selectAll('[data-current-year]').forEach((item) => {
    item.textContent = String(new Date().getFullYear());
  });

  /* ==========================================================================
     YENİ SAYFA BİLEŞENLERİ ETKİLEŞİMLERİ (FİLTRE, LİKE, REZERVASYON)
     ========================================================================== */

  /* 1. Örnek Fotoğraflar Sekmeli Filtreleme */
  const galleryTabs = selectAll('.gallery-tab');
  const photoCards = selectAll('.photo-card');
  const viewAllLink = document.querySelector('.view-all-link');

  galleryTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const filter = tab.dataset.filter;

      galleryTabs.forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');

      photoCards.forEach((card) => {
        const category = card.dataset.category;
        if (filter === 'all' || category === filter) {
          card.classList.remove('is-hidden');
        } else {
          card.classList.add('is-hidden');
        }
      });
    });
  });

  if (viewAllLink) {
    viewAllLink.addEventListener('click', (e) => {
      const allTab = document.querySelector('.gallery-tab[data-filter="all"]');
      if (allTab) {
        allTab.click();
      }
    });
  }

  /* 2. Fotoğraf Kalp / Beğeni Butonları & Kart Görsel Tıklaması */
  const likeButtons = selectAll('.photo-card__like');
  likeButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.classList.toggle('is-liked');
    });
  });

  /* 3. Örnek Video Oynat/Durdur & Ses Kontrolü */
  const videoCards = selectAll('.video-card');
  videoCards.forEach((card) => {
    const video = card.querySelector('video');
    if (!video) return;

    card.addEventListener('click', (e) => {
      // Lightbox veya başka buton tıklanmışsa engelleme
      if (e.target.closest('button:not(.video-card__play-btn)')) return;

      if (video.paused) {
        video.play().catch(() => {});
      } else if (video.muted) {
        // Mute all other videos and unmute this one
        selectAll('video').forEach((v) => { if (v !== video) v.muted = true; });
        video.muted = false;
      } else {
        video.muted = true;
      }
    });
  });

  /* 4. Hizmet Kutularına Tıklayınca Rezervasyona Kaydırma & Paket/Hizmet Seçimi */
  const serviceBoxes = selectAll('.service-box');
  const reservationSelect = document.querySelector('#res-service');

  serviceBoxes.forEach((box) => {
    box.addEventListener('click', (e) => {
      const serviceName = box.dataset.serviceType;
      if (serviceName && reservationSelect) {
        // Option arayalım veya text matches yapalım
        for (let i = 0; i < reservationSelect.options.length; i++) {
          if (reservationSelect.options[i].text.includes(serviceName) || reservationSelect.options[i].value.includes(serviceName)) {
            reservationSelect.selectedIndex = i;
            break;
          }
        }
      }
    });
  });

  /* 5. Rezervasyon Form Gönderimi */
  const reservationForm = document.querySelector('#reservation-form');
  reservationForm?.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.querySelector('#res-name')?.value;
    const phone = document.querySelector('#res-phone')?.value;
    const date = document.querySelector('#res-date')?.value;
    const venue = document.querySelector('#res-venue')?.value;
    const service = document.querySelector('#res-service')?.value;

    showDemoToast(`Sayın ${name}, rezervasyon talebiniz (${date || 'Tarih seçilmedi'}) başarıyla alındı! Ekibimiz size dönüş yapacaktır.`);
    reservationForm.reset();
  });

  /* ==========================================================================
     MOBILE-FIRST HOOKING & INTERACTION LOGIC
     ========================================================================== */

  /* A. BEFORE / AFTER SLIDER LOGIC */
  const beforeAfterSlider = document.querySelector('#beforeAfterSlider');
  if (beforeAfterSlider) {
    const beforeImg = beforeAfterSlider.querySelector('.before-after-card__before');
    const handle = beforeAfterSlider.querySelector('.before-after-card__handle');

    const updateSliderPosition = (clientX) => {
      const rect = beforeAfterSlider.getBoundingClientRect();
      let x = clientX - rect.left;
      x = Math.max(0, Math.min(x, rect.width));
      const percentage = (x / rect.width) * 100;

      if (beforeImg) beforeImg.style.width = `${percentage}%`;
      if (handle) handle.style.left = `${percentage}%`;
    };

    let isDragging = false;

    const onPointerDown = (e) => {
      isDragging = true;
      updateSliderPosition(e.clientX || e.touches[0].clientX);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      updateSliderPosition(e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0));
    };

    const onPointerUp = () => {
      isDragging = false;
    };

    beforeAfterSlider.addEventListener('mousedown', onPointerDown);
    beforeAfterSlider.addEventListener('touchstart', onPointerDown, { passive: true });

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: true });

    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
  }

  /* B. DOUBLE-TAP HEART ANIMATION & FAVORITES */
  let favoriteCount = 0;
  const favCountEl = document.querySelector('#mobile-fav-count');

  photoCards.forEach((card) => {
    let lastTapTime = 0;

    card.addEventListener('touchend', (e) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTapTime;

      if (tapLength < 300 && tapLength > 0) {
        // Double tap triggered
        e.preventDefault();
        triggerHeartBurst(card);
      }
      lastTapTime = currentTime;
    });

    // Double click fallback for desktop
    card.addEventListener('dblclick', () => {
      triggerHeartBurst(card);
    });
  });

  function triggerHeartBurst(container) {
    favoriteCount++;
    if (favCountEl) favCountEl.textContent = favoriteCount;

    const heart = document.createElement('div');
    heart.className = 'heart-burst';
    heart.innerHTML = '❤️';
    container.style.position = 'relative';
    container.appendChild(heart);

    setTimeout(() => {
      heart.remove();
    }, 750);
  }

  /* D. INSTAGRAM STORIES REVIEWS MODAL */
  const storyData = {
    'story-1': {
      title: 'Ece & Kaan',
      img: 'assets/images/hero-garden-walk.webp',
      text: '"Fotoğraflarımız tam bir sinematik başyapıt oldu. Çekim günü ekibin güler yüzü bize tüm heyecanımızı unutturdu!"',
      tag: '📍 Polonezköy Dış Çekim',
    },
    'story-2': {
      title: 'Selin & Mert',
      img: 'assets/images/scene-forest.webp',
      text: '"Orman çekimindeki ışık açıları harikaydı. Düğün albümümüzü gören herkes hangi ajans olduğunu soruyor."',
      tag: '📍 Belgrad Ormanı Çekimi',
    },
    'story-3': {
      title: 'Cansu & Arda',
      img: 'assets/images/scene-ceremony.webp',
      text: '"Kır düğünümüzün her anını duygu dolu yakalamışlar. Sinematik klip hala gözlerimizi yaşartıyor."',
      tag: '📍 Kır Düğün Seremonisi',
    },
    'story-4': {
      title: 'Zeynep & Burak',
      img: 'assets/images/scene-city-night.webp',
      text: '"Gece çekimindeki ışık gösterisi ve drone çekimleri muazzamdı. Zamanında teslimat için ayrıca teşekkürler!"',
      tag: '📍 İstanbul Gece Çekimi',
    },
  };

  const storyModal = document.querySelector('#story-modal');
  const storyModalImg = document.querySelector('#story-modal-img');
  const storyModalTitle = document.querySelector('#story-modal-title');
  const storyModalText = document.querySelector('#story-modal-text');
  const storyModalTag = document.querySelector('#story-modal-tag');
  const storyModalClose = document.querySelector('#story-modal-close');
  const storyProgressFill = document.querySelector('#story-modal-progress');
  const storyButtons = selectAll('.story-avatar-btn');

  let storyTimer = null;

  const openStory = (storyId) => {
    const data = storyData[storyId];
    if (!data || !storyModal) return;

    if (storyModalImg) storyModalImg.src = data.img;
    if (storyModalTitle) storyModalTitle.textContent = data.title;
    if (storyModalText) storyModalText.textContent = data.text;
    if (storyModalTag) storyModalTag.textContent = data.tag;

    storyModal.setAttribute('aria-hidden', 'false');

    if (storyProgressFill) {
      storyProgressFill.style.transition = 'none';
      storyProgressFill.style.width = '0%';
      setTimeout(() => {
        storyProgressFill.style.transition = 'width 4s linear';
        storyProgressFill.style.width = '100%';
      }, 50);
    }

    clearTimeout(storyTimer);
    storyTimer = setTimeout(() => {
      closeStory();
    }, 4000);
  };

  const closeStory = () => {
    if (!storyModal) return;
    storyModal.setAttribute('aria-hidden', 'true');
    clearTimeout(storyTimer);
    if (storyProgressFill) {
      storyProgressFill.style.transition = 'none';
      storyProgressFill.style.width = '0%';
    }
  };

  storyButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const storyId = btn.dataset.storyId;
      openStory(storyId);
    });
  });

  storyModalClose?.addEventListener('click', closeStory);
  storyModal?.querySelector('.story-modal__overlay')?.addEventListener('click', closeStory);

  /* E. REELS AUTOPLAY VIDEO OBSERVER */
  const allVideos = selectAll('video');
  if ('IntersectionObserver' in window && allVideos.length) {
    const videoObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target;
          if (entry.isIntersecting) {
            video.muted = true;
            video.playsInline = true;
            const playPromise = video.play();
            if (playPromise !== undefined) {
              playPromise.catch(() => {});
            }
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.2 }
    );

    allVideos.forEach((v) => videoObserver.observe(v));
  }

  /* F. MOBİL PAKETLER CAROUSEL CONTROLS & ODAKLAMA LOGIC */
  const packagesList = document.querySelector('#paketler .packages__list');
  const packageDots = selectAll('.package-dot');

  if (packagesList && packageDots.length) {
    const packages = packagesList.querySelectorAll('.package');

    // 2. Pakete (Tam Hikâye) anında (gecikmesiz/animasyonsuz) veya yumuşak odaklanma
    const centerPopularPackage = (instant = true) => {
      if (window.innerWidth <= 768 && packages[1]) {
        const packageWidth = packages[1].offsetWidth;
        const listWidth = packagesList.offsetWidth;
        const scrollTarget = packages[1].offsetLeft - (listWidth - packageWidth) / 2;
        
        if (instant) {
          packagesList.scrollLeft = scrollTarget;
        } else {
          packagesList.scrollTo({ left: scrollTarget, behavior: 'smooth' });
        }
      }
    };

    // İlk yüklemede anında 2. paketi konumlandır (1. paketten kayma efekti olmaması için)
    centerPopularPackage(true);
    requestAnimationFrame(() => centerPopularPackage(true));
    setTimeout(() => centerPopularPackage(true), 50);

    const updateDots = () => {
      const scrollLeft = packagesList.scrollLeft;
      const listWidth = packagesList.offsetWidth;
      let activeIndex = 0;

      packages.forEach((pkg, index) => {
        const pkgLeft = pkg.offsetLeft - packagesList.offsetLeft;
        const pkgCenter = pkgLeft + pkg.offsetWidth / 2;
        if (Math.abs(scrollLeft + listWidth / 2 - pkgCenter) < pkg.offsetWidth / 2 + 30) {
          activeIndex = index;
        }
      });

      packageDots.forEach((dot, idx) => {
        dot.classList.toggle('is-active', idx === activeIndex);
      });
    };

    packagesList.addEventListener('scroll', updateDots, { passive: true });

    packageDots.forEach((dot) => {
      dot.addEventListener('click', () => {
        const index = parseInt(dot.dataset.index, 10);
        if (packages[index]) {
          const packageWidth = packages[index].offsetWidth;
          const listWidth = packagesList.offsetWidth;
          const scrollLeft = packages[index].offsetLeft - (listWidth - packageWidth) / 2;
          packagesList.scrollTo({ left: scrollLeft, behavior: 'smooth' });
        }
      });
    });

    window.addEventListener('resize', () => centerPopularPackage(true), { passive: true });
  }
});


