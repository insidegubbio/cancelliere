import { el, escapeHtml } from '../ui/helpers.js';
import { themeToggleBtn } from '../ui/theme.js';
import { saveConfig, clearConfig } from '../api/storage.js';

export function renderSetup(app, prefill, err, onConnect, render) {
  app.innerHTML = '';

  const header = el(`
    <div class="topbar">
      <div>
        <p class="eyebrow">cancelliere</p>
        <h1 class="title" style="margin-bottom:0">Collega il repository</h1>
      </div>
      <div class="topbar-actions"></div>
    </div>
  `);
  header.querySelector('.topbar-actions').appendChild(themeToggleBtn(render));
  app.appendChild(header);

  if (err) app.appendChild(el(`<div class="banner error">${escapeHtml(err)}</div>`));

  const card = el(`
    <div class="card">
      <label for="f-owner">Proprietario del repository (utente o organizzazione)</label>
      <input id="f-owner" type="text" placeholder="es. mario-rossi">

      <label for="f-repo">Nome del repository</label>
      <input id="f-repo" type="text" placeholder="es. documenti-team">

      <div class="row">
        <div>
          <label for="f-branch">Branch</label>
          <input id="f-branch" type="text" placeholder="main">
        </div>
        <div>
          <label for="f-folder">Cartella radice</label>
          <input id="f-folder" type="text" placeholder="docs">
        </div>
      </div>

      <label for="f-token">Personal Access Token GitHub</label>
      <input id="f-token" type="password" placeholder="github_pat_...">
      <p class="hint">
        Consigliato: crea un <strong>fine-grained token</strong> su GitHub, Settings, Developer settings,
        limitato solo a questo repository, con permesso <em>Contents: Read and write</em>.
        Il token viene salvato solo per il tuo account.
      </p>

      <label class="remember-row" for="f-remember">
        <input id="f-remember" type="checkbox" checked>
        Ricorda i dati di accesso su questo dispositivo
      </label>

      <div class="actions">
        <button id="btn-connect">Connetti</button>
        <button class="secondary" id="btn-forget" style="font-size:12px;padding:8px 14px">Dimentica dati salvati</button>
      </div>
    </div>
  `);
  app.appendChild(card);

  // prefill
  if (prefill) {
    card.querySelector('#f-owner').value  = prefill.owner  ?? '';
    card.querySelector('#f-repo').value   = prefill.repo   ?? '';
    card.querySelector('#f-branch').value = prefill.branch ?? 'main';
    card.querySelector('#f-folder').value = prefill.folder ?? 'docs';
    card.querySelector('#f-token').value  = prefill.token  ?? '';
    if (prefill.token) card.querySelector('#f-remember').checked = true;
  } else {
    card.querySelector('#f-branch').value = 'main';
    card.querySelector('#f-folder').value = 'docs';
  }

  card.querySelector('#btn-connect').addEventListener('click', async () => {
    const cfg = {
      owner:  card.querySelector('#f-owner').value.trim(),
      repo:   card.querySelector('#f-repo').value.trim(),
      branch: card.querySelector('#f-branch').value.trim() || 'main',
      folder: card.querySelector('#f-folder').value.trim().replace(/^\/+|\/+$/g, '') || 'docs',
      token:  card.querySelector('#f-token').value.trim(),
    };
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      renderSetup(app, cfg, 'Compila proprietario, repository e token prima di continuare.', onConnect, render);
      return;
    }
    const remember = card.querySelector('#f-remember').checked;
    if (remember) await saveConfig(cfg); else await clearConfig();
    onConnect(cfg);
  });

  card.querySelector('#btn-forget').addEventListener('click', async () => {
    await clearConfig();
    renderSetup(app, null, null, onConnect, render);
  });
}
