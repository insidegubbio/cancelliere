import { el, escapeHtml } from '../ui/helpers.js';
import { themeToggleBtn } from '../ui/theme.js';
import { saveConfig, clearConfig } from '../api/storage.js';
import { startGithubLogin } from '../api/oauth.js';

const GITHUB_MARK_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
  0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
  -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
  .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
  -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27
  1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95
  .29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
</svg>`;

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

      <label class="remember-row" for="f-remember">
        <input id="f-remember" type="checkbox" checked>
        Ricorda i dati di accesso su questo dispositivo
      </label>

      <button id="btn-github-login" class="btn-github">${GITHUB_MARK_SVG}<span>Accedi con GitHub</span></button>

      <div class="oauth-divider"><span>oppure</span></div>

      <button type="button" class="link-btn" id="btn-toggle-pat">Usa un Personal Access Token</button>

      <div id="pat-section" class="pat-section" hidden>
        <label for="f-token">Personal Access Token GitHub</label>
        <input id="f-token" type="password" placeholder="github_pat_...">
        <p class="hint">
          Consigliato: crea un <strong>fine-grained token</strong> su GitHub, Settings, Developer settings,
          limitato solo a questo repository, con permesso <em>Contents: Read and write</em>.
          Il token viene salvato solo per il tuo account.
        </p>
        <div class="actions">
          <button id="btn-connect">Connetti</button>
          <button class="secondary" id="btn-forget" style="font-size:12px;padding:8px 14px">Dimentica dati salvati</button>
        </div>
      </div>
    </div>
  `);
  app.appendChild(card);

  if (prefill) {
    card.querySelector('#f-owner').value  = prefill.owner  ?? '';
    card.querySelector('#f-repo').value   = prefill.repo   ?? '';
    card.querySelector('#f-branch').value = prefill.branch ?? 'main';
    card.querySelector('#f-folder').value = prefill.folder ?? 'docs';
    if (prefill.token) {
      card.querySelector('#f-token').value = prefill.token;
      card.querySelector('#f-remember').checked = true;
      card.querySelector('#pat-section').hidden = false;
    }
  } else {
    card.querySelector('#f-branch').value = 'main';
    card.querySelector('#f-folder').value = 'docs';
  }

  card.querySelector('#btn-toggle-pat').addEventListener('click', () => {
    const section = card.querySelector('#pat-section');
    section.hidden = !section.hidden;
  });

  card.querySelector('#btn-github-login').addEventListener('click', () => {
    const draft = {
      owner:  card.querySelector('#f-owner').value.trim(),
      repo:   card.querySelector('#f-repo').value.trim(),
      branch: card.querySelector('#f-branch').value.trim() || 'main',
      folder: card.querySelector('#f-folder').value.trim().replace(/^\/+|\/+$/g, '') || 'docs',
      remember: card.querySelector('#f-remember').checked,
    };
    startGithubLogin(draft);
  });

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
