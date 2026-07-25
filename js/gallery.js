/* ═══════════════════════════════════════════════════════════
   KARLCON gallery — deliberately built on a CSS transform:translateX
   carousel driven by a single `index` state, NOT native scrollLeft/
   scrollTo(). Native scroll + a scroll listener that also tries to
   sync state creates a feedback loop (the scroll handler fights the
   smooth-scroll animation and snaps position back to 0). Transform-
   based state has one source of truth, so that class of bug can't
   happen here.
   ═══════════════════════════════════════════════════════════ */
function Gallery(root, images){
  let index = 0;
  let startX = 0, dragX = 0, dragging = false, trackWidth = 0;

  const track = root.querySelector('.gal-track');
  const dotsEl = root.querySelector('.gal-dots');
  const thumbsEl = root.querySelector('.gal-thumbs');
  const counterEl = root.querySelector('.gal-counter');

  track.innerHTML = images.map((src,i) =>
    `<div class="gal-slide"><img src="${src}" alt="Photo ${i+1}" loading="${i===0?'eager':'lazy'}" draggable="false"></div>`
  ).join('');

  dotsEl.innerHTML = images.map((_,i) => `<button class="gal-dot" data-i="${i}" aria-label="Photo ${i+1}"></button>`).join('');
  thumbsEl.innerHTML = images.map((src,i) => `<button class="gal-thumb" data-i="${i}"><img src="${src}" alt="" draggable="false"></button>`).join('');

  function measure(){ trackWidth = root.querySelector('.gal-viewport').clientWidth; }

  function render(animate){
    track.style.transition = animate ? 'transform .45s cubic-bezier(.2,.7,.3,1)' : 'none';
    track.style.transform = `translateX(${-index * 100}%)`;
    [...dotsEl.children].forEach((d,i) => d.classList.toggle('on', i===index));
    [...thumbsEl.children].forEach((t,i) => t.classList.toggle('on', i===index));
    const activeThumb = thumbsEl.children[index];
    if (activeThumb) activeThumb.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
    if (counterEl) counterEl.textContent = `${index+1} / ${images.length}`;
  }

  function goTo(i, animate=true){
    index = Math.max(0, Math.min(images.length - 1, i));
    render(animate);
  }
  function next(){ goTo((index + 1) % images.length); }
  function prev(){ goTo((index - 1 + images.length) % images.length); }

  root.querySelector('.gal-next').addEventListener('click', next);
  root.querySelector('.gal-prev').addEventListener('click', prev);
  dotsEl.addEventListener('click', e => { const b = e.target.closest('.gal-dot'); if (b) goTo(+b.dataset.i); });
  thumbsEl.addEventListener('click', e => { const b = e.target.closest('.gal-thumb'); if (b) goTo(+b.dataset.i); });

  root.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  });
  root.setAttribute('tabindex', '0');

  // pointer drag / swipe — transform-only during drag, snap on release
  const viewport = root.querySelector('.gal-viewport');
  viewport.addEventListener('pointerdown', e => {
    dragging = true; startX = e.clientX; dragX = 0;
    track.style.transition = 'none';
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', e => {
    if (!dragging) return;
    dragX = e.clientX - startX;
    const pct = (dragX / trackWidth) * 100;
    track.style.transform = `translateX(${-index * 100 + pct}%)`;
  });
  function endDrag(){
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dragX) > trackWidth * 0.16){
      dragX < 0 ? next() : prev();
    } else {
      render(true);
    }
  }
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('pointerleave', () => { if (dragging) endDrag(); });

  window.addEventListener('resize', () => measure());
  measure();
  render(false);

  return { next, prev, goTo };
}
