// Paginated PDF viewer — pages are pre-rendered JPGs in assets/img/pdf/<slug>/
(function () {
  document.querySelectorAll('.pdf-viewer').forEach(function (v) {
    var base = v.getAttribute('data-base');
    var total = parseInt(v.getAttribute('data-pages'), 10);
    var img = v.querySelector('.pdf-page');
    var prev = v.querySelector('.pdf-prev');
    var next = v.querySelector('.pdf-next');
    var count = v.querySelector('.pdf-count');
    var title = v.getAttribute('data-title') || 'Document';
    if (!img || !prev || !next || !count || !total) return;
    var cur = 1;

    function update() {
      img.src = base + '/page-' + cur + '.jpg';
      img.alt = title + ', page ' + cur + ' of ' + total;
      count.textContent = cur + ' / ' + total;
      prev.disabled = cur === 1;
      next.disabled = cur === total;
    }

    prev.addEventListener('click', function () { if (cur > 1) { cur--; update(); } });
    next.addEventListener('click', function () { if (cur < total) { cur++; update(); } });
    update();

    // Preload remaining pages so paging is instant
    for (var i = 2; i <= total; i++) { new Image().src = base + '/page-' + i + '.jpg'; }
  });
})();
