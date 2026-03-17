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
  function goTo(index) {
    slides[current].classList.remove('active');
    updateDot(current, false);

    current = (index + slides.length) % slides.length;

    slides[current].classList.add('active');
    updateDot(current, true);
  }

  function updateDot(index, on) {
    if (!dotsWrap) return;
    const dots = dotsWrap.querySelectorAll('.slideshow-dot');
    if (dots[index]) dots[index].classList.toggle('active', on);
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  // ── Auto-play ────────────────────────────────────────────────
  function startTimer() { timer = setInterval(next, DELAY); }
  function stopTimer()  { clearInterval(timer); }

  startTimer();

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

  // ── Touch / swipe support ────────────────────────────────────
  let touchStartX = 0;
  container.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  container.addEventListener('touchend',   e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {          // minimum swipe distance
      stopTimer();
      diff > 0 ? next() : prev();
      startTimer();
    }
  });
});
