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
  const mobileCta = document.querySelector('#mobile-cta');

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
  const heroSection = document.querySelector('.hero');
  const packageSection = document.querySelector('#paketler');
  const finalCtaSection = document.querySelector('.final-cta');
  const updateMobileCta = () => {
    if (!mobileCta) return;
    let nextState = 'hidden';

    if (!mobileCtaQuery.matches) {
      mobileCta.dataset.ctaState = nextState;
      return;
    }

    const heroBottom = heroSection?.getBoundingClientRect().bottom ?? 0;
    const packagesRect = packageSection?.getBoundingClientRect();
    const finalRect = finalCtaSection?.getBoundingClientRect();
    const inDecisionScene =
      Boolean(packagesRect && packagesRect.top < window.innerHeight * 0.72 && packagesRect.bottom > 0) ||
      Boolean(finalRect && finalRect.top < window.innerHeight * 0.8 && finalRect.bottom > 0);

    if (heroBottom > window.innerHeight * 0.18) {
      nextState = 'hidden';
    } else if (inDecisionScene) {
      nextState = 'expanded';
    } else {
      nextState = 'compact';
    }

    if (mobileCta.dataset.ctaState !== nextState) {
      mobileCta.dataset.ctaState = nextState;
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

  serviceLines.forEach((line) => {
    line.addEventListener('pointerenter', () => setActiveService(line));
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

  /* Current year */
  selectAll('[data-current-year]').forEach((item) => {
    item.textContent = String(new Date().getFullYear());
  });
});
