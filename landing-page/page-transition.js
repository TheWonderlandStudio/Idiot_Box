/* Shared page-shift: same-origin .html links go through the wipe curtain */
(function () {
  // entering page — covered black, lift curtain on load
  // if wipe has intro video (1st loading), hold curtain so video plays as starting animation
  function reveal() {
    const introVideo = document.querySelector('.wipe.has-intro-video .wipe-video');
    if (introVideo) {
      if (introVideo.paused) { introVideo.play().catch(() => {}); }
      // let starting video play ~2.8s, then lift
      setTimeout(function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            document.body.classList.remove('is-entering');
            // stop intro video after curtain lifts to save cpu
            setTimeout(function () {
              if (!document.body.classList.contains('is-entering')) { introVideo.pause(); }
            }, 900);
          });
        });
      }, 2800);
      return;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.body.classList.remove('is-entering');
      });
    });
  }
  if (document.readyState === 'complete') reveal();
  else window.addEventListener('load', reveal);

  // leaving page — drop curtain, then navigate mid-cover
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href$=".html"]');
    if (!a) return;
    const url = new URL(a.getAttribute('href'), location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname) return;
    e.preventDefault();
    if (document.body.classList.contains('is-leaving')) return;
    document.body.classList.add('is-leaving');
    // music duck + swoosh, phir smooth navigate
    try { if (window.__pageLeave) window.__pageLeave(); } catch (err) {}
    setTimeout(function () { location.href = a.href; }, 850);
  });
})();
