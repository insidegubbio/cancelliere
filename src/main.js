import { state } from './state.js';
import { loadConfig } from './api/storage.js';
import { loadTheme, applyTheme } from './ui/theme.js';
import { renderSetup } from './screens/setup.js';
import { renderList, refreshList } from './screens/list.js';
import { fetchFile, putFile, bytesToBase64 } from './api/github.js';
import { buildDocx } from './docx/builder.js';
import { el, escapeHtml, escapeAttr } from './ui/helpers.js';
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

// editor screen
function renderEditor() {
  const { file, html } = state.current;
  app.innerHTML = \'\';

  const top = el(`
    <div class="editor-header">
      <div>
        <p class="eyebrow" style="margin-bottom:2px">${escapeHtml(state.config.folder)}/</p>
        <input class="filename-edit" id="f-filename" type="text" value="${escapeAttr(file.name)}">
      </div>
      <button class="secondary" id="btn-back">&larr; Torna all\'elenco</button>
    </div>
  `);
  app.appendChild(top);

  if (state.error) app.appendChild(el(`<div class="banner error">${escapeHtml(state.error)}</div>`));
  if (state.info)  app.appendChild(el(`<div class="banner ok">${escapeHtml(state.info)}</div>`));

  const toolbar = el(`
    <div class="toolbar">
      <button class="icon" data-cmd="bold" title="Grassetto"><b>B</b></button>
      <button class="icon" data-cmd="italic" title="Corsivo"><i>I</i></button>
      <button class="icon" data-cmd="underline" title="Sottolineato"><u>U</u></button>
      <div class="sep"></div>
      <button class="icon" data-block="h1" title="Titolo 1">H1</button>
      <button class="icon" data-block="h2" title="Titolo 2">H2</button>
      <button class="icon" data-block="h3" title="Titolo 3">H3</button>
      <button class="icon" data-block="p" title="Paragrafo normale">P</button>
      <div class="sep"></div>
      <button class="icon" data-cmd="insertUnorderedList" title="Elenco puntato">&bull; &bull;</button>
      <button class="icon" data-cmd="insertOrderedList" title="Elenco numerato">1.2.</button>
    </div>
  `);
  app.appendChild(toolbar);

  const surface = el(`<div class="editor-surface" contenteditable="true"></div>`);
  surface.innerHTML = html;
  app.appendChild(surface);

  toolbar.querySelectorAll(\'button[data-cmd]\').forEach(btn => {
    btn.addEventListener(\'click\', () => {
      surface.focus();
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });
  toolbar.querySelectorAll(\'button[data-block]\').forEach(btn => {
    btn.addEventListener(\'click\', () => {
      surface.focus();
      document.execCommand(\'formatBlock\', false, btn.dataset.block);
    });
  });

  const saveRow = el(`
    <div class="save-row">
      <input class="commit-msg" id="f-commit" type="text" placeholder="Messaggio di commit (opzionale)">
      <button id="btn-save">Salva su GitHub</button>
    </div>
  `);
  app.appendChild(saveRow);

  app.appendChild(el(`
    <footer class="note">
      L\'editor gestisce testo, titoli (H1&ndash;H3), grassetto, corsivo, sottolineato ed elenchi.
      Tabelle, immagini e formattazioni avanzate non vengono conservate.
    </footer>
  `));

  top.querySelector(\'#btn-back\').addEventListener(\'click\', () => {
    state.current = null;
    state.error = null;
    state.info = null;
    state.screen = \'list\';
    render();
  });

  document.getElementById(\'btn-save\').addEventListener(\'click\', () => saveFile(surface));
}

async function saveFile(surface) {
  state.error = null;
  state.info = null;

  const newName = document.getElementById(\'f-filename\').value.trim();
  if (!newName) { state.error = \'Il nome del file non può essere vuoto.\'; render(); return; }
  const finalName = newName.toLowerCase().endsWith(\'.docx\') ? newName : newName + \'.docx\';

  const commitMsgInput = document.getElementById(\'f-commit\').value.trim();
  const defaultMsg = `chore: update "${finalName}"`;
  const message = commitMsgInput || defaultMsg;

  const btn = document.getElementById(\'btn-save\');
  if (btn) { btn.disabled = true; btn.textContent = \'Salvo…\'; }

  try {
    const bytes = await buildDocx(surface);
    const base64 = bytesToBase64(bytes);

    const folder = state.currentFolder || state.config.folder;
    const newPath = `${folder}/${finalName}`;
    const renaming = newPath !== state.current.file.path;

    const res = await putFile(state.config, newPath, base64, message, renaming ? null : state.current.sha);
    state.current.sha = res?.content?.sha ?? state.current.sha;
    state.current.file = { name: finalName, path: newPath };
    state.info = `"${finalName}" salvato con successo.`;
  } catch (e) {
    state.error = `Salvataggio non riuscito: ${e.message}`;
  }

  render();
}

// boot
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
