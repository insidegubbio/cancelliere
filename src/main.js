import { state } from './state.js';
import { loadConfig } from './api/storage.js';
import { loadTheme, applyTheme } from './ui/theme.js';
import { renderSetup } from './screens/setup.js';
import { renderList, refreshList } from './screens/list.js';
import { fetchFile, putFile, bytesToBase64 } from './api/github.js';
import { buildDocx } from './docx/builder.js';
import mammoth from 'mammoth';

const app = document.getElementById('app');

function render() {
  if (state.screen === 'setup') {
    renderSetup(app, state.config, state.error, onConnect, render);
    return;
  }
  if (state.screen === 'list') {
    renderList(app, render, onOpenFile, onSettings, onNewFile);
    return;
  }
  if (state.screen === 'editor') {
    renderEditor();
    return;
  }
  // loading
  app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--ink-soft)"><span class="spinner"></span></div>';
}

// callbacks
async function onConnect(cfg) {
  state.config = cfg;
  state.error = null;
  state.screen = 'list';
  await refreshList(render);
}

function onSettings() {
  state.error = null;
  state.info = null;
  state.screen = 'setup';
  render();
}

// open file
async function onOpenFile(file) {
  state.busy = true;
  state.error = null;
  state.info = null;
  render();

  try {
    const { bytes, sha } = await fetchFile(state.config, file.path);
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
    state.current = { file, sha, html: result.value };
    state.screen = 'editor';
    render();
  } catch (e) {
    state.error = `Impossibile aprire il file: ${e.message}`;
    state.busy = false;
    render();
  }
}

// new file
function onNewFile() {
  const name = prompt('Nome del nuovo documento (senza estensione):');
  if (!name || !name.trim()) return;
  const finalName = name.trim().toLowerCase().endsWith('.docx') ? name.trim() : name.trim() + '.docx';
  const folder = state.currentFolder || state.config.folder;
  state.current = {
    file: { name: finalName, path: `${folder}/${finalName}` },
    sha: null,
    html: '<p></p>',
  };
  state.screen = 'editor';
  render();
}

// editor
function renderEditor() {
  const { file, html } = state.current;
  app.innerHTML = '';

  // topbar
  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  topbar.innerHTML = `
    <div>
      <p class="eyebrow">Modifica documento</p>
      <h1 class="title" style="margin-bottom:0">${escapeHtml(file.name)}</h1>
    </div>
    <div class="topbar-actions">
      <button class="secondary" id="btn-back">← Indietro</button>
      <button id="btn-save">Salva su GitHub</button>
    </div>
  `;
  app.appendChild(topbar);

  if (state.error) {
    const banner = document.createElement('div');
    banner.className = 'banner error';
    banner.textContent = state.error;
    app.appendChild(banner);
  }
  if (state.info) {
    const banner = document.createElement('div');
    banner.className = 'banner ok';
    banner.textContent = state.info;
    app.appendChild(banner);
  }

  // editor surface
  const card = document.createElement('div');
  card.className = 'card';

  const surface = document.createElement('div');
  surface.className = 'editor-surface';
  surface.contentEditable = 'true';
  surface.innerHTML = html;
  card.appendChild(surface);
  app.appendChild(card);

  // footer note
  const note = document.createElement('footer');
  note.className = 'note';
  note.textContent = 'Formattazione supportata: H1–H3, grassetto, corsivo, sottolineato, elenchi. Tabelle e immagini non vengono conservate.';
  app.appendChild(note);

  // events
  topbar.querySelector('#btn-back').addEventListener('click', () => {
    state.current = null;
    state.error = null;
    state.info = null;
    state.screen = 'list';
    render();
  });

  topbar.querySelector('#btn-save').addEventListener('click', () => saveFile(surface));
}

async function saveFile(surface) {
  state.error = null;
  state.info = null;

  const btn = document.getElementById('btn-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvo…'; }

  try {
    const bytes = await buildDocx(surface);
    const base64 = bytesToBase64(bytes);
    const { file, sha } = state.current;
    const msg = sha ? `Aggiorna ${file.name}` : `Crea ${file.name}`;
    const res = await putFile(state.config, file.path, base64, msg, sha);
    // update sha for next save
    state.current.sha = res?.content?.sha ?? sha;
    state.info = `"${file.name}" salvato con successo.`;
  } catch (e) {
    state.error = `Salvataggio non riuscito: ${e.message}`;
  }

  render();
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

//boot
async function boot() {
  const theme = await loadTheme();
  await applyTheme(theme);

  const cfg = await loadConfig();
  if (cfg) {
    state.config = cfg;
    state.screen = 'list';
    await refreshList(render);
  } else {
    state.screen = 'setup';
    render();
  }
}

boot();
