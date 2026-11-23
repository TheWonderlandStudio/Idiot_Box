/* Docs browser — loads the docs/ tree from the repository, renders markdown
   files in-page. Sidebar shows the folder tree with extension-less names. */
(function () {
  'use strict';

  var REPO = 'TheWonderlandStudio/Idiot_Box';
  var BRANCH = 'main';
  var DOC_PREFIX = 'docs/';
  var DOC_RE = /\.(md|mdx)$/i;
  var TREE_KEY = 'ibx-docs-tree-v1';
  var TREE_TTL = 10 * 60 * 1000;
  var DEFAULT_DOC = 'docs/README.md';

  var treeEl = document.getElementById('docs-tree');
  var bodyEl = document.getElementById('doc-body');
  var pathEl = document.getElementById('doc-path');

  var filesByPath = null; // path -> true
  var currentPath = null;
  var treePromise = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ---------- tree loading (GitHub git-trees API, cached 10 min) ---------- */
  function fetchTree() {
    if (treePromise) return treePromise;
    treePromise = (function () {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(TREE_KEY) || 'null'); } catch (e) {}
      if (cached && cached.t && cached.files && Date.now() - cached.t < TREE_TTL) {
        return Promise.resolve(cached.files);
      }
      return fetch('https://api.github.com/repos/' + REPO + '/git/trees/' + BRANCH + '?recursive=1')
        .then(function (res) {
          if (!res.ok) throw new Error('tree request failed (' + res.status + ')');
          return res.json();
        })
        .then(function (data) {
          if (data.truncated) throw new Error('tree truncated');
          var files = (data.tree || [])
            .filter(function (n) {
              return n.type === 'blob' && n.path.indexOf(DOC_PREFIX) === 0 && DOC_RE.test(n.path);
            })
            .map(function (n) { return n.path; })
            .sort();
          if (!files.length) throw new Error('no docs found');
          try {
            localStorage.setItem(TREE_KEY, JSON.stringify({ t: Date.now(), files: files }));
          } catch (e) { /* storage full/blocked — cache is best-effort */ }
          return files;
        });
    })();
    return treePromise;
  }

  /* ---------- sidebar ---------- */
  function buildTree(paths) {
    var root = { dirs: {}, files: [] };
    paths.forEach(function (p) {
      var rel = p.slice(DOC_PREFIX.length);
      var parts = rel.split('/');
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] };
        node = node.dirs[parts[i]];
      }
      node.files.push({ name: parts[parts.length - 1].replace(DOC_RE, ''), path: p });
    });
    return root;
  }

  function renderNode(node, el) {
    node.files.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (f) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'doc-link';
        btn.textContent = f.name;
        btn.dataset.path = f.path;
        btn.addEventListener('click', function () { openDoc(f.path); });
        el.appendChild(btn);
      });
    Object.keys(node.dirs).sort().forEach(function (dir) {
      var det = document.createElement('details');
      var sum = document.createElement('summary');
      sum.textContent = dir;
      det.appendChild(sum);
      var inner = document.createElement('div');
      inner.className = 'doc-dir';
      renderNode(node.dirs[dir], inner);
      det.appendChild(inner);
      el.appendChild(det);
    });
  }

  function renderSidebar() {
    treeEl.innerHTML = '<div class="doc-loading">Loading tree…</div>';
    fetchTree().then(function (paths) {
      var map = {};
      paths.forEach(function (p) { map[p] = true; });
      filesByPath = map;
      treeEl.innerHTML = '';
      renderNode(buildTree(paths), treeEl);
      loadFromHash();
    }).catch(function () {
      treeEl.innerHTML = '<div class="doc-error">Couldn\'t load the docs tree. ' +
        '<a href="https://github.com/' + REPO + '/tree/' + BRANCH + '/' + DOC_PREFIX + '" target="_blank" rel="noopener">Browse on GitHub</a></div>';
      if (!currentPath) loadDoc(DEFAULT_DOC, null);
    });
  }

  function setActive(path) {
    var activeBtn = null;
    treeEl.querySelectorAll('.doc-link').forEach(function (b) {
      var on = b.dataset.path === path;
      b.classList.toggle('active', on);
      if (on) activeBtn = b;
    });
    if (activeBtn) {
      var d = activeBtn.closest('details');
      while (d) {
        d.open = true;
        d = d.parentElement.closest('details');
      }
    }
  }

  /* ---------- routing ---------- */
  function slugFor(path) {
    return path.slice(DOC_PREFIX.length).replace(DOC_RE, '');
  }

  function findPath(slug) {
    if (!filesByPath) return null;
    var clean = String(slug || '').replace(/^docs\//, '').replace(DOC_RE, '');
    if (!clean) return null;
    var withMd = DOC_PREFIX + clean + '.md';
    if (filesByPath[withMd]) return withMd;
    var withMdx = DOC_PREFIX + clean + '.mdx';
    if (filesByPath[withMdx]) return withMdx;
    return null;
  }

  function openDoc(path, anchor) {
    var target = '#/' + slugFor(path) + (anchor ? '#' + anchor : '');
    if (location.hash === target) {
      if (currentPath !== path) loadDoc(path, anchor);
    } else {
      location.hash = target; // hashchange drives the load
    }
  }

  function loadFromHash() {
    if (!filesByPath) return; // tree not ready yet — renderSidebar calls us after
    var raw = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    var parts = raw.split('#');
    var slug = parts[0] || '';
    var anchor = parts.slice(1).join('#') || null;
    var path = findPath(slug) || (slug ? null : DEFAULT_DOC);
    if (!path) {
      loadDoc(DEFAULT_DOC, null);
      return;
    }
    loadDoc(path, anchor);
  }

  /* ---------- document rendering ---------- */
  function stripFrontmatter(text) {
    return String(text || '')
      .replace(/^\uFEFF/, '')
      .replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  }

  // MDX component transform — regex-based, zero-dep (ported from the app's
  // editor preview). Turns <Callout>, <Note>, <Card>, <Steps>… into styled HTML
  // before marked runs; unknown PascalCase tags become labelled blocks.
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderInnerMd(mdText) {
    try {
      return marked.parse(String(mdText == null ? '' : mdText).trim(), { async: false, gfm: true, breaks: false });
    } catch (e) {
      return escapeHtml(mdText);
    }
  }

  function transformMdxJsx(src) {
    let text = String(src == null ? '' : src);
    let hasComp = false;

    text = text.replace(/<Callout(?:\s+type=["']([^"']*)["'])?(?:\s+title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/Callout>/gi, function (_, type, title, body) {
      hasComp = true;
      const t = (type || 'info').toLowerCase();
      const heading = title || (t.charAt(0).toUpperCase() + t.slice(1));
      return '\n<div class="mdx-callout mdx-callout--' + escapeAttr(t) + '"><div class="mdx-callout__head"><span class="mdx-callout__badge">' + escapeHtml(heading) + '</span></div><div class="mdx-callout__body">' + renderInnerMd(body) + '</div></div>\n';
    });

    const alertTags = ['Note', 'Tip', 'Warning', 'Caution', 'Important', 'Info'];
    alertTags.forEach(function (tag) {
      const reg = new RegExp('<' + tag + '(?:\\s+title=["\']([^"\']*)["\'])?[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
      text = text.replace(reg, function (_, title, body) {
        hasComp = true;
        const t = tag.toLowerCase();
        const heading = title || tag;
        return '\n<div class="mdx-callout mdx-callout--' + escapeAttr(t) + '"><div class="mdx-callout__head"><span class="mdx-callout__badge">' + escapeHtml(heading) + '</span></div><div class="mdx-callout__body">' + renderInnerMd(body) + '</div></div>\n';
      });
    });

    text = text.replace(/<Card(?=[\s>])(?:\s+title=["']([^"']*)["'])?(?:\s+href=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/Card>/gi, function (_, title, href, body) {
      hasComp = true;
      const linkStart = href ? '<a href="' + escapeAttr(href) + '" class="mdx-card__link" target="_blank" rel="noreferrer noopener">' : '';
      const linkEnd = href ? '</a>' : '';
      return '\n<div class="mdx-card">' + linkStart + '<div class="mdx-card__title">' + escapeHtml(title || 'Card') + '</div><div class="mdx-card__body">' + renderInnerMd(body) + '</div>' + linkEnd + '</div>\n';
    });

    text = text.replace(/<(?:Cards|CardGroup)[^>]*>([\s\S]*?)<\/(?:Cards|CardGroup)>/gi, function (_, body) {
      hasComp = true;
      return '\n<div class="mdx-cards">\n' + body + '\n</div>\n';
    });

    text = text.replace(/<Steps[^>]*>([\s\S]*?)<\/Steps>/gi, function (_, body) {
      hasComp = true;
      return '\n<div class="mdx-steps">\n' + body + '\n</div>\n';
    });

    text = text.replace(/<Step(?:\s+title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/Step>/gi, function (_, title, body) {
      hasComp = true;
      return '\n<div class="mdx-step"><div class="mdx-step__head"><span class="mdx-step__title">' + escapeHtml(title || 'Step') + '</span></div><div class="mdx-step__body">' + renderInnerMd(body) + '</div></div>\n';
    });

    text = text.replace(/<Accordion(?:\s+title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/Accordion>/gi, function (_, title, body) {
      hasComp = true;
      return '\n<details class="mdx-accordion"><summary class="mdx-accordion__summary">' + escapeHtml(title || 'Details') + '</summary><div class="mdx-accordion__body">' + renderInnerMd(body) + '</div></details>\n';
    });

    text = text.replace(/<Badge(?:\s+variant=["']([^"']*)["'])?(?:\s+text=["']([^"']*)["'])?[^>]*>(.*?)<\/Badge>/gi, function (_, variant, textProp, inner) {
      hasComp = true;
      const val = (inner || textProp || '').trim();
      return '<span class="mdx-badge mdx-badge--' + escapeAttr((variant || 'default').toLowerCase()) + '">' + escapeHtml(val) + '</span>';
    });
    text = text.replace(/<Badge(?:\s+variant=["']([^"']*)["'])?\s+text=["']([^"']*)["'][^>]*\/>/gi, function (_, variant, textProp) {
      hasComp = true;
      return '<span class="mdx-badge mdx-badge--' + escapeAttr((variant || 'default').toLowerCase()) + '">' + escapeHtml(textProp) + '</span>';
    });

    // Generic custom block tags (PascalCase) — last, after the known ones
    text = text.replace(/<([A-Z][a-zA-Z0-9_.-]*)([^>]*)>([\s\S]*?)<\/\1>/g, function (_, tagName, attrs, body) {
      hasComp = true;
      return '\n<div class="mdx-custom-block" data-component="' + escapeAttr(tagName) + '"><div class="mdx-custom-block__badge">&lt;' + escapeHtml(tagName) + '&gt;</div><div class="mdx-custom-block__body">' + renderInnerMd(body) + '</div></div>\n';
    });
    text = text.replace(/<([A-Z][a-zA-Z0-9_.-]*)([^>]*?)\/>/g, function (_, tagName) {
      hasComp = true;
      return '<span class="mdx-custom-chip" title="Custom MDX component">&lt;' + escapeHtml(tagName) + ' /&gt;</span>';
    });

    return { text: text, hasComp: hasComp };
  }

  function sanitizeHtml(html) {
    if (!window.DOMPurify) return html;
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['details', 'summary', 'svg', 'path'],
      ADD_ATTR: ['target', 'rel', 'class', 'style', 'data-component', 'data-lang', 'title', 'width', 'height'],
    });
  }

  function scrollToAnchor(anchor) {
    if (!anchor) return;
    var el = document.getElementById(anchor);
    if (el) el.scrollIntoView({ block: 'start' });
  }

  function resolveDocLink(href) {
    // relative to the current doc's directory; returns {path, anchor} or null
    if (!currentPath || !filesByPath) return null;
    var parts = href.split('#');
    var filePart = parts[0];
    var anchor = parts.slice(1).join('#') || null;
    if (!filePart) return null;
    var dir = currentPath.slice(0, currentPath.lastIndexOf('/'));
    var segs = (dir + '/' + filePart).split('/');
    var out = [];
    segs.forEach(function (s) {
      if (!s || s === '.') return;
      if (s === '..') { out.pop(); return; }
      out.push(s);
    });
    var norm = out.join('/');
    if (!filesByPath[norm]) return null;
    return { path: norm, anchor: anchor };
  }

  function wireLinks() {
    bodyEl.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (/^(https?:|mailto:|#)/i.test(href)) return; // external, mailto, in-page anchor
      var target = resolveDocLink(href);
      if (!target) return;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        openDoc(target.path, target.anchor);
      });
    });
  }

  function loadDoc(path, anchor) {
    if (currentPath === path) {
      scrollToAnchor(anchor);
      return;
    }
    currentPath = path;
    setActive(path);
    pathEl.textContent = path;
    bodyEl.innerHTML = '<div class="doc-loading">Loading ' + esc(path) + '…</div>';
    if (location.hash !== '#/' + slugFor(path)) {
      try { history.replaceState(null, '', '#/' + slugFor(path)); } catch (e) {}
    }
    var requested = path;
    fetch('https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/' + path)
      .then(function (res) {
        if (!res.ok) throw new Error('fetch failed (' + res.status + ')');
        return res.text();
      })
      .then(function (text) {
        if (currentPath !== requested) return; // stale response
        var md = stripFrontmatter(text);
        var isMdx = /\.mdx$/i.test(requested);
        var html;
        if (isMdx && window.marked) {
          html = marked.parse(transformMdxJsx(md).text, { async: false, gfm: true, breaks: false });
        } else if (window.marked) {
          html = marked.parse(md, { async: false, gfm: true, breaks: false });
        } else {
          html = '<pre>' + esc(md) + '</pre>';
        }
        bodyEl.innerHTML = sanitizeHtml(html);
        wireLinks();
        if (anchor) {
          requestAnimationFrame(function () { scrollToAnchor(anchor); });
        } else {
          document.querySelector('.docs-main').scrollTop = 0;
        }
      })
      .catch(function () {
        if (currentPath !== requested) return;
        bodyEl.innerHTML = '<div class="doc-error">Couldn\'t load ' + esc(path) + '. ' +
          '<a href="https://github.com/' + REPO + '/blob/' + BRANCH + '/' + path + '" target="_blank" rel="noopener">Open on GitHub</a></div>';
      });
  }

  /* ---------- shell ---------- */
  function initShell() {
    var video = document.getElementById('docs-bg');
    if (video) {
      video.play().catch(function () {});
      video.addEventListener('canplay', function () { video.play().catch(function () {}); });
    }

    // hamburger menu (mobile), same as the other pages
    var bg = document.querySelector('.background');
    var btn = document.querySelector('.hamburger');
    var panel = document.getElementById('menu-panel');
    if (btn && panel) {
      function setOpen(open) {
        bg.classList.toggle('menu-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(!bg.classList.contains('menu-open'));
      });
      panel.addEventListener('click', function (e) {
        if (e.target.closest('a')) setOpen(false);
      });
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.menu-panel') && !e.target.closest('.hamburger')) setOpen(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setOpen(false);
      });
    }

    window.addEventListener('hashchange', loadFromHash);

    // mobile docs drawer — slides the sidebar in over the article
    var docsBtn = document.querySelector('.docs-menu-btn');
    var docsBackdrop = document.querySelector('.docs-backdrop');
    if (docsBtn && docsBackdrop) {
      function setDocsOpen(open) {
        bg.classList.toggle('docs-menu-open', open);
        docsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      docsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setDocsOpen(!bg.classList.contains('docs-menu-open'));
      });
      docsBackdrop.addEventListener('click', function () { setDocsOpen(false); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setDocsOpen(false);
      });
      treeEl.addEventListener('click', function (e) {
        if (e.target.closest('.doc-link')) setDocsOpen(false);
      });
    }

    renderSidebar();
  }

  initShell();
})();
