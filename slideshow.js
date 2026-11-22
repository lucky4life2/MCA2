/* slideshow.js — homepage image slideshow
   Include this script only on index.html.
   If the .slideshow element doesn't exist on the page,
   this script exits immediately and does nothing.        */

document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('.slideshow');
  if (!container) return;   // slideshow not on this page — bail out

  const slides   = container.querySelectorAll('.slide');
  const dotsWrap = document.querySelector('.slideshow-dots');

  if (slides.length === 0) return;  // no slides added yet — bail out

  let current  = 0;
  let timer    = null;
  const DELAY  = 4000;  // ms between auto-advances — change freely

  // ── Build dot indicators ──────────────────────────────────────
  if (dotsWrap) {
    slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'slideshow-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
      dot.addEventListener('click', () => goTo(i));
      dotsWrap.appendChild(dot);
    });
  }

  // ── Core navigation ──────────────────────────────────────────
  // Direction classes drive the directional slide animation in style.css:
  // forward (next / auto-advance / dot to the right) enters from the right,
  // backward from the left. `viaSwipe` swaps in the spring easing for
  // flick-triggered changes. Classes are cleared at the start of every
  // navigation so only the slide activated by this call is affected.
  function goTo(index, viaSwipe) {
    const target = (index + slides.length) % slides.length;
    let dir = null;
    if (target !== current) {
      if (target === 0 && current === slides.length - 1) dir = 'next';
      else if (target === slides.length - 1 && current === 0) dir = 'prev';
      else dir = target > current ? 'next' : 'prev';
    }
    container.classList.remove('mca-dir-next', 'mca-dir-prev', 'mca-swipe');
    if (dir) container.classList.add(dir === 'next' ? 'mca-dir-next' : 'mca-dir-prev');
    if (viaSwipe) container.classList.add('mca-swipe');

    slides[current].classList.remove('active');
    updateDot(current, false);

    current = target;

    slides[current].classList.add('active');
    updateDot(current, true);
  }

  function updateDot(index, on) {
    if (!dotsWrap) return;
    const dots = dotsWrap.querySelectorAll('.slideshow-dot');
    if (dots[index]) dots[index].classList.toggle('active', on);
  }

  function next(viaSwipe) { goTo(current + 1, viaSwipe); }
  function prev(viaSwipe) { goTo(current - 1, viaSwipe); }

  // ── Auto-play ────────────────────────────────────────────────
  function startTimer() { timer = setInterval(next, DELAY); }
  function stopTimer()  { clearInterval(timer); }

  startTimer();

  // Warm the cache for the remaining slides: they are display:none with
  // loading="lazy", so without this the first auto-advance can show a
  // blank slide while the image starts downloading. This runs after
  // parsing, so it never competes with first paint.
  slides.forEach((s, i) => {
    if (i === 0) return;
    const img = s.querySelector('img');
    const src = img && img.getAttribute('src');
    if (src) { const pre = new Image(); pre.src = src; }
  });

  // Pause on hover so users can look at a slide without it flipping
  container.addEventListener('mouseenter', stopTimer);
  container.addEventListener('mouseleave', startTimer);

  // ── Arrow buttons ────────────────────────────────────────────
  const prevBtn = container.querySelector('.slideshow-btn.prev');
  const nextBtn = container.querySelector('.slideshow-btn.next');

  if (prevBtn) prevBtn.addEventListener('click', () => { stopTimer(); prev(); startTimer(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { stopTimer(); next(); startTimer(); });

  // ── Keyboard support (left / right arrow keys) ───────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { stopTimer(); prev(); startTimer(); }
    if (e.key === 'ArrowRight') { stopTimer(); next(); startTimer(); }
  });

  // ── Touch / swipe support (velocity-aware flicks) ────────────────
  // A fast flick advances the slideshow even over a short distance; a slow
  // drag still needs the 40px threshold. Velocity is px/ms over the whole
  // gesture: a 25px flick in 40ms (~0.6 px/ms) counts, a 25px slow drag
  // doesn't. Flick-triggered changes get the spring easing (viaSwipe).
  let touchStartX = 0;
  let touchStartT = 0;
  container.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartT = performance.now();
  }, { passive: true });
  container.addEventListener('touchend',   e => {
    const endX = e.changedTouches[0].clientX;
    const dist = touchStartX - endX; // >0 = swiped left = next slide
    const dt = Math.max(performance.now() - touchStartT, 1);
    const flick = Math.abs(dist) / dt > 0.5; // >0.5 px/ms counts as a flick
    if (flick || Math.abs(dist) > 40) {          // minimum swipe distance
      stopTimer();
      dist > 0 ? next(true) : prev(true);
      startTimer();
    }
  });
});
