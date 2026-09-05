/* Shared audio: per-page BGM + transition swoosh with smooth fade switch */
(function () {
  const TRACKS = {
    home: 'https://files.catbox.moe/zvie8s.mp3',
    chatlog: 'https://files.catbox.moe/sltghc.mp3',
    features: 'https://files.catbox.moe/zvie8s.mp3'
  };
  const SWOOSH = 'https://files.catbox.moe/u51u9u.mp3';
  const BGM_LEVEL = 0.35;

  const bgm = new Audio();
  bgm.loop = true;
  bgm.preload = 'auto';
  bgm.volume = 0;

  const swoosh = new Audio(SWOOSH);
  swoosh.preload = 'auto';
  swoosh.volume = 0.8;

  let pending = false;

  function fade(audio, to, ms) {
    return new Promise(function (resolve) {
      const from = audio.volume;
      if (from === to) return resolve();
      const steps = 20;
      const step = (to - from) / steps;
      const t = setInterval(function () {
        let v = audio.volume + step;
        if ((step > 0 && v >= to) || (step < 0 && v <= to)) {
          v = to;
          clearInterval(t);
          resolve();
        }
        audio.volume = Math.max(0, Math.min(1, v));
      }, Math.max(10, ms / steps));
    });
  }

  function fadeInBgm() {
    bgm.play().then(function () {
      fade(bgm, BGM_LEVEL, 1500).catch(function () {});
    }).catch(function () {
      // autoplay blocked — pehle user gesture ka wait
      pending = true;
    });
  }

  function unlock() {
    if (!pending) return;
    pending = false;
    bgm.play().then(function () {
      fade(bgm, BGM_LEVEL, 1500).catch(function () {});
    }).catch(function () {
      pending = true;
    });
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, unlock, { passive: true });
  });

  // page ke hisaab se BGM — <body data-bgm="home|chatlog|features">
  const key = (document.body && document.body.dataset.bgm) || 'home';
  bgm.src = TRACKS[key] || TRACKS.home;
  fadeInBgm();

  // page-transition isko call karta hai: music duck + swoosh, phir navigate
  window.__pageLeave = function () {
    try {
      fade(bgm, 0, 600).catch(function () {});
      swoosh.currentTime = 0;
      swoosh.play().catch(function () {});
    } catch (e) { /* silent — navigation phir bhi hoga */ }
  };
})();
