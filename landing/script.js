// ===== AiTeam Landing — Interactions =====
(function () {
  // Year
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  // Nav scroll state
  var nav = document.getElementById('nav');
  var onScroll = function () {
    if (window.scrollY > 24) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Reveal on scroll
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e, i) {
        if (e.isIntersecting) {
          // small stagger for siblings sharing a parent
          setTimeout(function () { e.target.classList.add('in'); }, (i % 6) * 70);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // Count-up stats
  var nums = document.querySelectorAll('.stat-num');
  var animateNum = function (el) {
    var target = parseFloat(el.getAttribute('data-target')) || 0;
    var suffix = el.getAttribute('data-suffix') || '';
    var dur = 1400;
    var start = null;
    // special: 0 -> ∞
    var isInfinite = target === 0;
    if (isInfinite) { el.textContent = '∞'; return; }
    var step = function (ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      var val = Math.round(target * eased);
      el.textContent = val + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    var sio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { animateNum(e.target); sio.unobserve(e.target); }
      });
    }, { threshold: 0.6 });
    nums.forEach(function (el) { sio.observe(el); });
  } else {
    nums.forEach(animateNum);
  }

  // Parallax-ish floating chips on mousemove (desktop)
  if (window.matchMedia('(min-width: 861px)').matches) {
    var chips = document.querySelectorAll('.chip');
    document.addEventListener('mousemove', function (ev) {
      var cx = (ev.clientX / window.innerWidth - 0.5);
      var cy = (ev.clientY / window.innerHeight - 0.5);
      chips.forEach(function (c, i) {
        var depth = (i + 1) * 8;
        c.style.transform = 'translate(' + (cx * depth) + 'px,' + (cy * depth) + 'px)';
      });
    });
  }
})();
