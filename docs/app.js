/* sf-lwc docs */
(function () {
  'use strict';

  let registry = [];
  let observer = null;
  const MOBILE_BP = 900;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------------------------------------------ *
   * Utilities
   * ------------------------------------------------------------------ */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const normalize = (s) => String(s || '').replace(/\r\n/g, '\n');
  const baseName = (p) => p.split('/').pop();

  /* ------------------------------------------------------------------ *
   * Theme
   * ------------------------------------------------------------------ */
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
      try { localStorage.setItem('sf-lwc-theme', theme); } catch (e) { /* ignore */ }
    }
    $$('[data-theme-set]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme))
    );
    $$('[data-theme-toggle]').forEach((b) =>
      b.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')
    );
  }

  /* ------------------------------------------------------------------ *
   * Syntax highlighting (small, dependency-free)
   * ------------------------------------------------------------------ */
  const JS_KEYWORDS = new Set((
    'import export from default class extends const let var function return if else for while do ' +
    'new this super static get set async await try catch finally throw typeof instanceof in of ' +
    'null undefined true false switch case break continue'
  ).split(' '));

  function span(cls, text) {
    return '<span class="tk-' + cls + '">' + esc(text) + '</span>';
  }

  function hlMarkup(src) {
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[A-Za-z][^>]*>/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      const t = m[0];
      out += t.startsWith('<!--') || t.startsWith('<?') ? span('com', t) : hlTag(t);
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  function hlTag(tag) {
    const m = tag.match(/^(<\/?)([\w:.-]+)([\s\S]*?)(\/?>)$/);
    if (!m) return esc(tag);
    const attrRe = /([^\s=\/"'{}<>]+)(\s*=\s*)?("[^"]*"|'[^']*'|\{[^}]*\})?/g;
    let attrs = '';
    let last = 0;
    let a;
    while ((a = attrRe.exec(m[3]))) {
      attrs += esc(m[3].slice(last, a.index));
      attrs += span('attr', a[1]);
      if (a[2]) attrs += esc(a[2]);
      if (a[3]) attrs += a[3][0] === '{' ? span('fn', a[3]) : span('str', a[3]);
      last = attrRe.lastIndex;
      if (a[0] === '') attrRe.lastIndex++;
    }
    attrs += esc(m[3].slice(last));
    return span('tag', m[1] + m[2]) + attrs + span('tag', m[4]);
  }

  function hlJs(src) {
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(@[A-Za-z_]\w*)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += span('com', m[1]);
      else if (m[2]) out += span('str', m[2]);
      else if (m[3]) out += span('dec', m[3]);
      else if (m[4]) out += span('num', m[4]);
      else if (m[5]) out += JS_KEYWORDS.has(m[5]) ? span('kw', m[5]) : span('fn', m[5]);
      else if (m[6]) out += JS_KEYWORDS.has(m[6]) ? span('kw', m[6]) : esc(m[6]);
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  function hlCss(src) {
    const re = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[\w-]+)|(--[\w-]+|[a-zA-Z-]+)(?=\s*:\s)|(#[0-9a-fA-F]{3,8}\b)|([.#]?[a-zA-Z_][\w-]*)|(-?\d*\.?\d+(?:px|rem|em|%|vh|vw|ms|s|deg|fr)?)/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += span('com', m[1]);
      else if (m[2]) out += span('str', m[2]);
      else if (m[3]) out += span('kw', m[3]);
      else if (m[4]) out += span('attr', m[4]);
      else if (m[5]) out += span('num', m[5]);
      else if (m[6]) out += esc(m[6]);
      else if (m[7]) out += span('num', m[7]);
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  function highlight(code, fileName) {
    const src = normalize(code);
    const name = fileName.toLowerCase();
    if (name.endsWith('.html') || name.endsWith('.xml')) return hlMarkup(src);
    if (name.endsWith('.js')) return hlJs(src);
    if (name.endsWith('.css')) return hlCss(src);
    return esc(src);
  }

  /* ------------------------------------------------------------------ *
   * Hero: "what this adds to your project", built from the registry
   * ------------------------------------------------------------------ */
  function renderHero(name) {
    const comp = registry.find((c) => c.name === name) || registry[0];
    const tree = $('#heroTree');
    const cmd = $('#quickCommand');
    const picker = $('#heroPicker');
    if (!comp || !tree || !cmd) return;

    cmd.textContent = 'npx sf-lwc add ' + comp.name;

    const rows = [];
    (comp.files || []).forEach((f) => {
      const i = f.lastIndexOf('/');
      const dir = i >= 0 ? f.slice(0, i + 1) : '';
      const file = i >= 0 ? f.slice(i + 1) : f;
      rows.push(
        '<li><span class="g" aria-hidden="true">+</span>' +
        '<span class="path"><span class="p">' + esc(dir) + '</span><span class="f">' + esc(file) + '</span></span>' +
        '<span class="n"></span></li>'
      );
    });

    const depCount = Object.keys(comp.dependencies || {}).length;
    if (depCount) {
      rows.push(
        '<li><span class="g" aria-hidden="true">+</span><span class="path"><span class="f">Dependencies</span></span>' +
        '<span class="n">' + depCount + ' added</span></li>'
      );
    }
    const labelCount = (comp.labels || []).length;
    if (labelCount) {
      rows.push(
        '<li><span class="g mod" aria-hidden="true">~</span><span class="path"><span class="f">Custom labels</span></span>' +
        '<span class="n">' + labelCount + ' merged</span></li>'
      );
    }
    rows.push(
      '<li><span class="g mod" aria-hidden="true">~</span><span class="path"><span class="f">sf-lwc.lock.json</span></span>' +
      '<span class="n">records ' + esc(comp.name) + '@' + esc(comp.version || '') + '</span></li>'
    );

    tree.innerHTML = rows.map((r, i) => r.replace('<li>', '<li style="--i:' + i + '">')).join('');

    if (picker) {
      picker.hidden = registry.length < 2;
      picker.innerHTML =
        '<span class="lbl">Preview</span>' +
        registry
          .map((c) =>
            '<button class="chip" type="button" data-hero="' + esc(c.name) + '" aria-pressed="' +
            (c.name === comp.name) + '">' + esc(c.name) + '</button>'
          )
          .join('');
    }
  }

  /* ------------------------------------------------------------------ *
   * Navigation and catalog
   * ------------------------------------------------------------------ */
  function renderNav(items) {
    const list = $('#componentNavList');
    const count = $('#navCount');
    if (!list) return;
    if (count) count.textContent = registry.length ? String(registry.length) : '';
    list.innerHTML = items.length
      ? items.map((c) => '<li><a href="#comp-' + esc(c.name) + '">' + esc(c.name) + '</a></li>').join('')
      : '<li class="nav-empty">No matches</li>';
  }

  function noteHtml(note) {
    return esc(note).replace(/(&lt;[\s\S]*?&gt;)/g, '<code>$1</code>');
  }

  function renderComponent(c) {
    const files = c.files || Object.keys(c.contents || {});
    const labels = c.labels || [];
    const notes = c.notes || [];
    const deps = Object.keys(c.dependencies || {});

    const depsHtml = deps.length
      ? '<p class="depends">Requires ' +
        deps.map((d) =>
          registry.some((r) => r.name === d)
            ? '<a href="#comp-' + esc(d) + '">' + esc(d) + '</a>'
            : esc(d)
        ).join(', ') + '</p>'
      : '';

    const usageHtml = notes.length
      ? '<div><h4>Usage</h4>' + notes.map((n) => '<p class="usage-note">' + noteHtml(n) + '</p>').join('') + '</div>'
      : '';

    const labelsHtml = labels.length
      ? '<div><h4>Custom labels</h4><ul class="labels">' +
        labels.map((l) =>
          '<li><div class="row"><span class="k">' + esc(l.fullName) + '</span><span class="v">' + esc(l.value) + '</span></div>' +
          (l.shortDescription ? '<p class="d">' + esc(l.shortDescription) + '</p>' : '') + '</li>'
        ).join('') + '</ul></div>'
      : '';

    const filesHtml = files.length
      ? '<div><h4>Installed files</h4><ul class="installed-files">' +
        files.map((f) => '<li><code>' + esc(f) + '</code></li>').join('') +
        '</ul></div>'
      : '';

    const infoHtml = usageHtml || labelsHtml || filesHtml ? '<div class="info">' + usageHtml + labelsHtml + filesHtml + '</div>' : '';
    const installCmd = 'npx sf-lwc add ' + c.name;

    return (
      '<article class="comp" id="comp-' + esc(c.name) + '">' +
        '<header>' +
          '<div class="comp-title"><h3>' + esc(c.name) + '</h3>' +
            (c.apiVersion ? '<span class="tag">API ' + esc(c.apiVersion) + '</span>' : '') +
          '</div>' +
          (c.description ? '<p class="comp-desc">' + esc(c.description) + '</p>' : '') +
          depsHtml +
        '</header>' +
        '<div class="snippet comp-install"><span class="ps" aria-hidden="true">$</span><code>' + esc(installCmd) + '</code>' +
          '<button class="btn-copy" type="button" data-copy="' + esc(installCmd) + '">Copy</button></div>' +
        infoHtml +
      '</article>'
    );
  }

  function renderComponents(items, query) {
    const container = $('#componentsContainer');
    const countEl = $('#resultCount');
    if (!container) return;

    if (countEl) {
      countEl.textContent = query
        ? items.length + ' of ' + registry.length + ' components match “' + query + '”'
        : registry.length + (registry.length === 1 ? ' component' : ' components');
    }

    if (!items.length) {
      container.innerHTML =
        '<div class="empty"><strong>No components match your search</strong>' +
        'Try a component name, a label, or a word from its description.' +
        '<br><button type="button" data-action="clear-search">Clear search</button></div>';
      return;
    }
    container.innerHTML = items.map(renderComponent).join('');
  }

  /* ------------------------------------------------------------------ *
   * Scroll spy
   * ------------------------------------------------------------------ */
  function setActive(id) {
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
  }

  function observeSections() {
    if (!('IntersectionObserver' in window)) return;
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
      },
      { rootMargin: '-12% 0px -78% 0px' }
    );
    ['overview', 'cli-reference'].forEach((id) => { const el = document.getElementById(id); if (el) observer.observe(el); });
    $$('.comp').forEach((el) => observer.observe(el));
  }

  /* ------------------------------------------------------------------ *
   * Search
   * ------------------------------------------------------------------ */
  function applySearch(raw) {
    const q = raw.toLowerCase().trim();
    const items = !q
      ? registry
      : registry.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description || '').toLowerCase().includes(q) ||
          (c.labels || []).some((l) => l.fullName.toLowerCase().includes(q))
        );
    renderNav(items);
    renderComponents(items, raw.trim());
    observeSections();
  }

  /* ------------------------------------------------------------------ *
   * Copy + toast
   * ------------------------------------------------------------------ */
  let toastTimer;
  function showToast(msg) {
    const toast = $('#toast');
    if (!toast) return;
    $('#toastText').textContent = msg || 'Copied to clipboard';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text, btn) {
    const done = (ok) => {
      showToast(ok ? 'Copied to clipboard' : 'Copy failed. Select the text and copy manually.');
      if (ok && btn) {
        const original = btn.dataset.label || btn.textContent;
        btn.dataset.label = original;
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1600);
      }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
    } else {
      done(fallbackCopy(text));
    }
  }

  /* ------------------------------------------------------------------ *
   * Tabs
   * ------------------------------------------------------------------ */
  function selectTab(tab) {
    const comp = registry.find((c) => c.name === tab.dataset.comp);
    const viewer = tab.closest('.viewer');
    if (!comp || !viewer) return;
    $$('.tab', viewer).forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    const pre = $('pre', viewer);
    $('code', pre).innerHTML = highlight(comp.contents[tab.dataset.file] || '', tab.dataset.file);
    pre.scrollTop = 0;
    pre.scrollLeft = 0;
  }

  /* ------------------------------------------------------------------ *
   * Mobile drawer
   * ------------------------------------------------------------------ */
  function setMenu(open) {
    const sidebar = $('#sidebar');
    const scrim = $('#scrim');
    const toggle = $('#menuToggle');
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (scrim) scrim.classList.toggle('show', open);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */
  function bindEvents() {
    document.addEventListener('click', (e) => {
      const t = e.target;

      const copyBtn = t.closest('.btn-copy');
      if (copyBtn) {
        let text = copyBtn.dataset.copy;
        if (copyBtn.dataset.copyTarget) {
          const el = document.getElementById(copyBtn.dataset.copyTarget);
          text = el ? el.textContent : '';
        } else if (copyBtn.dataset.copyFile) {
          const viewer = copyBtn.closest('.viewer');
          const tab = $('.tab[aria-selected="true"]', viewer);
          const comp = registry.find((c) => c.name === copyBtn.dataset.copyFile);
          text = comp && tab ? normalize(comp.contents[tab.dataset.file]) : '';
        }
        if (text) copyText(text, copyBtn);
        return;
      }

      const tab = t.closest('.tab');
      if (tab) { selectTab(tab); return; }

      const chip = t.closest('.chip');
      if (chip) { renderHero(chip.dataset.hero); return; }

      const setBtn = t.closest('[data-theme-set]');
      if (setBtn) { applyTheme(setBtn.dataset.themeSet, true); return; }

      if (t.closest('[data-theme-toggle]')) {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
        return;
      }

      if (t.closest('[data-action="clear-search"]')) {
        const input = $('#searchInput');
        if (input) { input.value = ''; input.focus(); }
        applySearch('');
        return;
      }

      const navLink = t.closest('.nav a');
      if (navLink) {
        const id = (navLink.getAttribute('href') || '').slice(1);
        if (id) setActive(id);
        if (window.innerWidth <= MOBILE_BP) setMenu(false);
      }
    });

    // Arrow-key navigation between file tabs
    document.addEventListener('keydown', (e) => {
      const tab = e.target.closest && e.target.closest('.tab');
      if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const tabs = $$('.tab', tab.closest('.tabs'));
        const i = tabs.indexOf(tab);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        selectTab(next);
        e.preventDefault();
        return;
      }

      if (e.key === 'Escape') {
        setMenu(false);
        const input = $('#searchInput');
        if (document.activeElement === input) input.blur();
      }

      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && !e.metaKey && !e.ctrlKey) {
        const input = $('#searchInput');
        if (input) {
          if (window.innerWidth <= MOBILE_BP) setMenu(true);
          input.focus();
          e.preventDefault();
        }
      }
    });

    const input = $('#searchInput');
    if (input) input.addEventListener('input', (e) => applySearch(e.target.value));

    const toggle = $('#menuToggle');
    if (toggle) toggle.addEventListener('click', () => setMenu(!$('#sidebar').classList.contains('open')));
    const scrim = $('#scrim');
    if (scrim) scrim.addEventListener('click', () => setMenu(false));

    window.addEventListener('resize', () => { if (window.innerWidth > MOBILE_BP) setMenu(false); });
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  async function init() {
    applyTheme(currentTheme(), false);
    bindEvents();

    try {
      const res = await fetch('registry.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      registry = await res.json();
    } catch (err) {
      console.error('Failed to load component registry:', err);
      const container = $('#componentsContainer');
      if (container) {
        container.innerHTML =
          '<div class="empty"><strong>Could not load the component registry</strong>' +
          'If you opened this page straight from disk, serve the folder instead, for example ' +
          '<code>npx serve docs</code>.</div>';
      }
      return;
    }

    renderHero((registry.find((c) => c.name === 'modal') || registry[0] || {}).name);
    renderNav(registry);
    renderComponents(registry, '');
    observeSections();

    // Honor a deep link such as #comp-modal once the catalog exists
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
