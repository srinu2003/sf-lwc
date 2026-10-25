let registry = [];

async function initDocs() {
  try {
    const res = await fetch('registry.json');
    registry = await res.json();
    renderNavigation(registry);
    renderComponents(registry);
    setupSearch();
  } catch (err) {
    console.error('Failed to load component registry:', err);
  }
}

function renderNavigation(items) {
  const navList = document.getElementById('componentNavList');
  navList.innerHTML = items
    .map(
      (c) =>
        `<li><a href="#comp-${c.name}" onclick="highlightNav(this)">${c.name} <span style="font-size:10px; color:var(--text-muted)">v${c.version}</span></a></li>`
    )
    .join('');
}

function renderComponents(items) {
  const container = document.getElementById('componentsContainer');
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
              <h3>${c.name} <span class="badge">v${c.version}</span></h3>
              <p class="comp-desc">${escapeHtml(c.description || '')}</p>
              ${labelsHtml}
            </div>
            <div class="comp-actions">
              <button class="copy-btn mini" onclick="copyText('npx sf-lwc add ${c.name}')">npx sf-lwc add ${c.name}</button>
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
  codeEl.textContent = comp.contents[fileName] || '';

  const parent = btn.parentElement;
  parent.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
};

function setupSearch() {
  const input = document.getElementById('searchInput');
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

window.copyText = function (text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast();
  });
};

function showToast() {
  const toast = document.getElementById('toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
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
