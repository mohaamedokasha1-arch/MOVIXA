/* MOVIXA public interactions */
(function () {
  'use strict';

  /* sticky header shadow */
  const header = document.getElementById('siteHeader');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* mobile menu */
  const menuToggle = document.getElementById('menuToggle');
  const mobileNav = document.getElementById('mobileNav');
  if (menuToggle && mobileNav) {
    menuToggle.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* flash dismiss */
  document.querySelectorAll('.flash-close').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.flash-wrap').remove());
  });
  setTimeout(() => {
    document.querySelectorAll('.flash-wrap').forEach((el) => { el.style.display = 'none'; });
  }, 6000);

  /* hero slider */
  const slider = document.getElementById('heroSlider');
  if (slider) {
    const slides = Array.from(slider.querySelectorAll('.hero-slide'));
    const dots = Array.from(slider.querySelectorAll('.hero-dot'));
    let idx = 0, timer = null;
    const go = (n) => {
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('active', i === idx));
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    };
    const auto = () => { clearInterval(timer); if (slides.length > 1) timer = setInterval(() => go(idx + 1), 7000); };
    dots.forEach((d) => d.addEventListener('click', () => { go(parseInt(d.dataset.go, 10)); auto(); }));
    const prev = slider.querySelector('.hero-prev'), next = slider.querySelector('.hero-next');
    if (prev) prev.addEventListener('click', () => { go(idx - 1); auto(); });
    if (next) next.addEventListener('click', () => { go(idx + 1); auto(); });
    slider.addEventListener('mouseenter', () => clearInterval(timer));
    slider.addEventListener('mouseleave', auto);
    auto();
  }

  /* carousels */
  document.querySelectorAll('.carousel-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(btn.dataset.target);
      if (row) row.scrollBy({ left: parseInt(btn.dataset.dir, 10) * 440, behavior: 'smooth' });
    });
  });

  /* search overlay */
  const overlay = document.getElementById('searchOverlay');
  const openBtn = document.getElementById('searchOpen');
  const closeBtn = document.getElementById('searchClose');
  const input = document.getElementById('searchInput');
  const suggest = document.getElementById('searchSuggest');
  const openSearch = () => {
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => input && input.focus(), 50);
  };
  const closeSearch = () => {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };
  if (openBtn) openBtn.addEventListener('click', openSearch);
  if (closeBtn) closeBtn.addEventListener('click', closeSearch);
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSearch(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSearch(); closeTrailer(); }
    if ((e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) || ((e.metaKey || e.ctrlKey) && e.key === 'k')) {
      e.preventDefault(); openSearch();
    }
  });
  /* autocomplete */
  let debounce = null;
  if (input && suggest) {
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 2) { suggest.innerHTML = ''; return; }
      debounce = setTimeout(async () => {
        try {
          const res = await fetch('/api/suggest?q=' + encodeURIComponent(q));
          const data = await res.json();
          suggest.innerHTML = (data.results || []).map((r) =>
            `<a class="suggest-row" href="/${r.type === 'movie' ? 'movie' : 'series'}/${r.slug}">` +
            (r.poster_image ? `<img src="${r.poster_image}" alt="" loading="lazy">` : '') +
            `<div><strong>${escapeHtml(r.title)}</strong><small>${r.type} ${r.year ? '· ' + r.year : ''}</small></div></a>`
          ).join('');
        } catch (e) { /* offline */ }
      }, 250);
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* trailer modal */
  const trailerBtn = document.getElementById('trailerBtn');
  const trailerModal = document.getElementById('trailerModal');
  const trailerClose = document.getElementById('trailerClose');
  function closeTrailer() {
    if (!trailerModal) return;
    trailerModal.classList.remove('open');
    trailerModal.setAttribute('aria-hidden', 'true');
    const frame = trailerModal.querySelector('iframe');
    if (frame) frame.removeAttribute('src');
    document.body.style.overflow = '';
  }
  if (trailerBtn && trailerModal) {
    trailerBtn.addEventListener('click', () => {
      const frame = trailerModal.querySelector('iframe');
      if (frame && frame.dataset.src) frame.src = frame.dataset.src + '?autoplay=1&rel=0';
      trailerModal.classList.add('open');
      trailerModal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    });
  }
  if (trailerClose) trailerClose.addEventListener('click', closeTrailer);
  if (trailerModal) trailerModal.addEventListener('click', (e) => { if (e.target === trailerModal) closeTrailer(); });

  /* copy link buttons */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text.startsWith('http') ? text : location.origin + text);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = btn.classList.contains('share-btn') ? 'Copy Link' : 'Copy URL'; }, 1500);
      } catch (e) {
        prompt('Copy this link:', text);
      }
    });
  });
})();
