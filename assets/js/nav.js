/* Shared header behavior: the mobile hamburger and the nav dropdowns.
   Dropdowns open on hover/focus via CSS; the click handling below is for
   touch and for pinning one open. */
(function () {
  var t = document.querySelector('.nav-toggle');
  var n = document.getElementById('site-nav');
  if (t && n) {
    t.addEventListener('click', function () {
      var open = n.classList.toggle('open');
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  var groups = document.querySelectorAll('.nav-group');
  if (!groups.length) return;
  function setOpen(g, open) {
    g.classList.toggle('open', open);
    var b = g.querySelector('.nav-group-btn');
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeAll(except) {
    Array.prototype.forEach.call(groups, function (g) {
      if (g !== except) setOpen(g, false);
    });
  }
  Array.prototype.forEach.call(groups, function (g) {
    var b = g.querySelector('.nav-group-btn');
    if (!b) return;
    b.addEventListener('click', function (ev) {
      var open = !g.classList.contains('open');
      closeAll(g);
      setOpen(g, open);
      ev.stopPropagation();
    });
  });
  document.addEventListener('click', function (ev) {
    var inside = false;
    Array.prototype.forEach.call(groups, function (g) {
      if (g.contains(ev.target)) inside = true;
    });
    if (!inside) closeAll(null);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeAll(null);
  });
})();
