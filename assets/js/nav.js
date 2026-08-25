/* Shared header behavior: the mobile hamburger and the Activities dropdown.
   The dropdown opens on hover/focus via CSS; the click handling below is for
   touch and for pinning it open. */
(function () {
  var t = document.querySelector('.nav-toggle');
  var n = document.getElementById('site-nav');
  if (t && n) {
    t.addEventListener('click', function () {
      var open = n.classList.toggle('open');
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  var g = document.querySelector('.nav-group');
  var b = document.querySelector('.nav-group-btn');
  if (!g || !b) return;
  function setOpen(open) {
    g.classList.toggle('open', open);
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  b.addEventListener('click', function (ev) {
    setOpen(!g.classList.contains('open'));
    ev.stopPropagation();
  });
  document.addEventListener('click', function (ev) {
    if (g.classList.contains('open') && !g.contains(ev.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && g.classList.contains('open')) setOpen(false);
  });
})();
