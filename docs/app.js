let registry = [];

async function initDocs() {
  try {
    const res = await fetch('registry.json');
    registry = await res.json();
    renderNavigation(registry);
    renderComponents(registry);
    setupSearch();
    setupMobileMenu();
  } catch (err) {
    console.error('Failed to load component registry:', err);
  }
}

function setupMobileMenu() {
  const toggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!toggle || !sidebar) return;

  function closeSidebar() {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
  }

  function openSidebar() {
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  if (backdrop) {
    backdrop.addEventListener('click', closeSidebar);
  }

  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 860 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
        closeSidebar();
      }
    }
  });

  sidebar.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 860) {
        closeSidebar();
      }
    });
  });
}

function renderNavigation(items) {
  const navList = document.getElementById('componentNavList');
  if (!navList) return;
  navList.innerHTML = items
    .map(
      (c) =>
        `<li><a href="#comp-${c.name}" onclick="highlightNav(this)">${c.name}</a></li>`
    )
    .join('');

  // Re-attach drawer close handler on mobile for dynamically rendered links
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  navList.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 860 && sidebar) {
        sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.remove('active');
      }
    });
  });
}

function renderComponents(items) {
  const container = document.getElementById('componentsContainer');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-secondary); background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: var(--radius-lg);">
        <p style="font-size: 15px; font-weight: 500;">No components found matching your search.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items
    .map((c) => {
      const fileKeys = Object.keys(c.contents || {});
      const activeFile = fileKeys[0] || '';
      const activeContent = escapeHtml(c.contents[activeFile] || '');

      const labelsHtml = (c.labels || []).length
        ? `<div class="labels-tag-list">
             ${c.labels.map((l) => `<span class="label-pill" title="${escapeHtml(l.value)}">🏷️ ${escapeHtml(l.fullName)}</span>`).join('')}
           </div>`
        : '';

      return `
        <article class="comp-card" id="comp-${c.name}">
          <div class="comp-header">
            <div class="comp-title-group">
              <h3>${c.name}</h3>
              <p class="comp-desc">${escapeHtml(c.description || '')}</p>
              ${labelsHtml}
            </div>
            <div class="comp-actions">
              <div class="code-box">
                <code>npx sf-lwc add ${c.name}</code>
                <button class="mini-copy" onclick="copyText('npx sf-lwc add ${c.name}', this)">Copy</button>
              </div>
            </div>
          </div>
          <div class="comp-body">
            <div class="tab-nav">
              ${fileKeys
                .map(
                  (f, idx) =>
                    `<button class="tab-btn ${idx === 0 ? 'active' : ''}" onclick="switchTab('${c.name}', '${f}', this)">${f.split('/').pop()}</button>`
                )
                .join('')}
            </div>
            <div class="code-viewer">
              <pre><code id="code-${c.name}">${activeContent}</code></pre>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

window.switchTab = function (compName, fileName, btn) {
  const comp = registry.find((c) => c.name === compName);
  if (!comp) return;

  const codeEl = document.getElementById(`code-${compName}`);
  if (codeEl) {
    codeEl.textContent = comp.contents[fileName] || '';
  }

  const parent = btn.parentElement;
  parent.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
};

function setupSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  input.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = registry.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q) ||
        (c.labels || []).some((l) => l.fullName.toLowerCase().includes(q))
    );
    renderComponents(filtered);
  });
}

window.copyText = function (text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    showToast();
    if (btnElement) {
      const origText = btnElement.innerText;
      btnElement.innerText = 'Copied!';
      btnElement.classList.add('copied');
      setTimeout(() => {
        btnElement.innerText = origText;
        btnElement.classList.remove('copied');
      }, 1800);
    }
  }).catch(() => {
    showToast();
  });
};

function showToast() {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.highlightNav = function (link) {
  document.querySelectorAll('.nav-section a').forEach((a) => a.classList.remove('active'));
  link.classList.add('active');
};

document.addEventListener('DOMContentLoaded', initDocs);
