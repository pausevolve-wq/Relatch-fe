/* Relatch legal pages: reveal on scroll, table of contents tracking, copy-link buttons. No network calls. */
(function () {
  var d = document, root = d.documentElement;
  root.classList.add('js');
  // Smooth scrolling is switched on after load so a deep link lands in place instead of gliding.
  window.addEventListener('load', function () { setTimeout(function () { root.classList.add('smooth'); }, 50); });
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reveal blocks as they enter the viewport (everything is visible at once if motion is reduced).
  var items = [].slice.call(d.querySelectorAll('[data-reveal]'));
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    items.forEach(function (el) { io.observe(el); });
    // A deep link to #section must not land on an invisible section.
    if (location.hash) { var t = d.getElementById(location.hash.slice(1)); if (t) t.classList.add('in'); }
  }

  // Table of contents: highlight the section being read.
  var links = [].slice.call(d.querySelectorAll('[data-toc]'));
  var map = {};
  links.forEach(function (a) { map[a.getAttribute('data-toc')] = a; });
  var secs = [].slice.call(d.querySelectorAll('.doc section[id]'));
  function setOn(id) {
    links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-toc') === id); });
  }
  function spy() {
    var y = window.innerHeight * 0.28, cur = secs[0] && secs[0].id;
    secs.forEach(function (s) { if (s.getBoundingClientRect().top <= y) cur = s.id; });
    if (window.scrollY < 120) cur = null;
    setOn(cur);
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () { ticking = false; spy(); });
  }, { passive: true });
  window.addEventListener('resize', spy);
  spy();

  // On narrow screens the contents list starts folded.
  var det = d.querySelector('.toc-d');
  if (det && window.matchMedia('(max-width: 900px)').matches) det.removeAttribute('open');
  // On narrow screens, choosing a section folds the list again.
  links.forEach(function (a) {
    a.addEventListener('click', function () {
      if (det && window.matchMedia('(max-width: 900px)').matches) det.removeAttribute('open');
    });
  });

  // Copy a link to a section.
  d.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    var url = location.origin + location.pathname + b.getAttribute('data-copy');
    var done = function () {
      b.classList.add('done');
      setTimeout(function () { b.classList.remove('done'); }, 1200);
      history.replaceState(null, '', b.getAttribute('data-copy'));
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
    else done();
  });
})();
