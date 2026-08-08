import { state } from './state.js';
import { loadConfig, saveConfig } from './api/storage.js';
import { loadTheme, applyTheme } from './ui/theme.js';
import { renderSetup } from './screens/setup.js';
import { renderList, refreshList, parentFolderOf } from './screens/list.js';
import { handleGithubCallback } from './api/oauth.js';
import { fetchFile, putFile, renameAndUpdateFileAtomic, bytesToBase64, base64ToBytes, createFolder } from './api/github.js';
import { el, escapeHtml, escapeAttr } from './ui/helpers.js';

const app = document.getElementById('app');

function emptyJsonDoc(slug, category) {
  const now = new Date().toISOString();
  return {
    slug: slug || '',
    title: '',
    summary: '',
    category: category || '',
    word_count: 0,
    category_name: '',
    full_text: '',
    body: [],
    images: [],
    core_properties: {
      title: '',
      subject: '',
      author: '',
      last_modified_by: '',
      created: now,
      modified: now,
      category: '',
      comments: '',
      keywords: '',
      language: '',
      revision: 0,
    },
  };
}

function jsonToBase64(obj) {
  const str = JSON.stringify(obj, null, 2);
  const bytes = new TextEncoder().encode(str);
  return bytesToBase64(bytes);
}

function bytesToJson(bytes) {
  const str = new TextDecoder().decode(bytes);
  return JSON.parse(str);
}

function render() {
  if (state.screen === 'setup') {
    renderSetup(app, state.config, state.error, onConnect, render);
    return;
  }
  if (state.screen === 'list') {
    renderList(app, render, onOpenFile, onSettings, onNewFile, onNewFolder);
    return;
  }
  if (state.screen === 'editor') {
    renderEditor();
    return;
  }
  app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--ink-soft)"><span class="spinner"></span></div>';
}

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

async function onOpenFile(file) {
  state.busy = true;
  state.error = null;
  state.info = null;
  render();

  try {
    const { bytes, sha } = await fetchFile(state.config, file.path);
    const doc = bytesToJson(bytes);
    state.current = { file, sha, doc };
    state.busy = false;
    state.screen = 'editor';
    render();
  } catch (e) {
    state.error = `Impossibile aprire il file: ${e.message}`;
    state.busy = false;
    render();
  }
}

function onNewFile() {
  const name = prompt('Nome del nuovo file JSON (senza estensione):');
  if (!name || !name.trim()) return;
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
  const finalName = slug.endsWith('.json') ? slug : slug + '.json';
  const folder = state.currentFolder || state.config.folder;
  const category = folder.split('/').pop();
  state.current = {
    file: { name: finalName, path: `${folder}/${finalName}` },
    sha: null,
    doc: emptyJsonDoc(slug.replace('.json', ''), category),
  };
  state.screen = 'editor';
  render();
}

async function onNewFolder() {
  const name = prompt('Nome della nuova cartella:');
  if (!name || !name.trim()) return;
  const folderName = name.trim();

  const folder = state.currentFolder || state.config.folder;
  const newFolderPath = `${folder}/${folderName}`;

  state.actionBusy = true;
  state.error = null;
  state.info = null;
  render();

  try {
    await createFolder(state.config, newFolderPath, `chore: crea cartella "${folderName}"`);
    state.dirs = [...state.dirs, { name: folderName, path: newFolderPath }]
      .sort((a, b) => a.name.localeCompare(b.name));
    state.info = `Cartella "${folderName}" creata.`;
  } catch (e) {
    state.error = `Impossibile creare la cartella: ${e.message}`;
  }
  state.actionBusy = false;
  render();
}

function renderEditor() {
  const { file, doc } = state.current;
  app.innerHTML = '';

  const top = el(`
    <div class="editor-header">
      <div>
        <p class="eyebrow" style="margin-bottom:4px">${escapeHtml(state.config.folder)}/</p>
        <input class="filename-edit" id="f-filename" type="text" value="${escapeAttr(file.name)}">
      </div>
      <button class="secondary" id="btn-back">&larr; Torna all'elenco</button>
    </div>
  `);
  app.appendChild(top);

  if (state.error) app.appendChild(el(`<div class="banner error">${escapeHtml(state.error)}</div>`));
  if (state.info)  app.appendChild(el(`<div class="banner ok">${escapeHtml(state.info)}</div>`));

  const cp = doc.core_properties || {};

  const fieldsCard = el(`
    <div style="background:var(--surface);border:1px solid var(--rule);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);margin-bottom:18px">
      <p class="meta-panel-title">Campi principali</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 18px">
        <div>
          <label for="f-slug">Slug</label>
          <input type="text" id="f-slug" value="${escapeAttr(doc.slug || '')}">
        </div>
        <div>
          <label for="f-title">Titolo</label>
          <input type="text" id="f-title" value="${escapeAttr(doc.title || '')}">
        </div>
        <div>
          <label for="f-category">Category (slug)</label>
          <input type="text" id="f-category" value="${escapeAttr(doc.category || '')}">
        </div>
        <div>
          <label for="f-category-name">Category name</label>
          <input type="text" id="f-category-name" value="${escapeAttr(doc.category_name || '')}">
        </div>
      </div>
      <div style="margin-top:12px">
        <label for="f-summary">Summary</label>
        <textarea id="f-summary" rows="3" style="width:100%;padding:10px 13px;border:1.5px solid var(--rule);border-radius:var(--radius-xs);background:var(--surface);font-family:inherit;font-size:14px;color:var(--ink);resize:vertical;line-height:1.6">${escapeHtml(doc.summary || '')}</textarea>
      </div>
      <div style="margin-top:12px">
        <label for="f-fulltext">Testo completo (full_text)</label>
        <textarea id="f-fulltext" rows="10" style="width:100%;padding:10px 13px;border:1.5px solid var(--rule);border-radius:var(--radius-xs);background:var(--surface);font-family:inherit;font-size:14px;color:var(--ink);resize:vertical;line-height:1.6">${escapeHtml(doc.full_text || '')}</textarea>
      </div>
    </div>
  `);
  app.appendChild(fieldsCard);

  const metaCard = el(`
    <div class="meta-panel" style="margin-bottom:18px">
      <p class="meta-panel-title">Core properties</p>
      <div class="meta-grid">
        <div class="meta-field">
          <label for="m-cp-author">Author</label>
          <input type="text" id="m-cp-author" value="${escapeAttr(cp.author || '')}">
        </div>
        <div class="meta-field">
          <label for="m-cp-last-modified-by">Last modified by</label>
          <input type="text" id="m-cp-last-modified-by" value="${escapeAttr(cp.last_modified_by || '')}">
        </div>
        <div class="meta-field">
          <label for="m-cp-title">Title (meta)</label>
          <input type="text" id="m-cp-title" value="${escapeAttr(cp.title || '')}">
        </div>
        <div class="meta-field">
          <label for="m-cp-subject">Subject</label>
          <input type="text" id="m-cp-subject" value="${escapeAttr(cp.subject || '')}">
        </div>
        <div class="meta-field">
          <label for="m-cp-category">Category (meta)</label>
          <input type="text" id="m-cp-category" value="${escapeAttr(cp.category || '')}">
        </div>
        <div class="meta-field">
          <label for="m-cp-keywords">Keywords</label>
          <input type="text" id="m-cp-keywords" value="${escapeAttr(cp.keywords || '')}">
        </div>
        <div class="meta-field">
          <label for="m-cp-language">Language</label>
          <input type="text" id="m-cp-language" value="${escapeAttr(cp.language || '')}">
        </div>
        <div class="meta-field">
          <label>Revisione</label>
          <div class="meta-readonly">${escapeHtml(String(cp.revision ?? 0))}</div>
        </div>
        <div class="meta-field">
          <label>Creato</label>
          <div class="meta-readonly">${escapeHtml(cp.created ? new Date(cp.created).toLocaleString('it-IT') : '—')}</div>
        </div>
        <div class="meta-field">
          <label>Modificato</label>
          <div class="meta-readonly" id="m-modified-display">${escapeHtml(cp.modified ? new Date(cp.modified).toLocaleString('it-IT') : '—')}</div>
        </div>
      </div>
      <div style="margin-top:12px">
        <label for="m-cp-comments">Commenti</label>
        <input type="text" id="m-cp-comments" value="${escapeAttr(cp.comments || '')}">
      </div>
    </div>
  `);
  app.appendChild(metaCard);

  const saveRow = el(`
    <div class="save-row">
      <input class="commit-msg" id="f-commit" type="text" placeholder="Messaggio di commit (opzionale)">
      <button id="btn-save">Salva su GitHub</button>
    </div>
  `);
  app.appendChild(saveRow);

  app.appendChild(el(`
    <footer class="note">
      Stai modificando un file JSON. I campi body e images vengono preservati intatti; modifica il testo completo nel campo full_text.
    </footer>
  `));

  top.querySelector('#btn-back').addEventListener('click', () => {
    state.current = null;
    state.error = null;
    state.info = null;
    state.screen = 'list';
    render();
  });

  document.getElementById('btn-save').addEventListener('click', () => saveFile());
}

function collectDoc() {
  const { doc } = state.current;
  const cp = doc.core_properties || {};
  const now = new Date().toISOString();

  const newDoc = {
    ...doc,
    slug:          document.getElementById('f-slug').value.trim(),
    title:         document.getElementById('f-title').value.trim(),
    summary:       document.getElementById('f-summary').value,
    category:      document.getElementById('f-category').value.trim(),
    category_name: document.getElementById('f-category-name').value.trim(),
    full_text:     document.getElementById('f-fulltext').value,
    core_properties: {
      ...cp,
      title:            document.getElementById('m-cp-title').value.trim(),
      subject:          document.getElementById('m-cp-subject').value.trim(),
      author:           document.getElementById('m-cp-author').value.trim(),
      last_modified_by: document.getElementById('m-cp-last-modified-by').value.trim(),
      modified:         now,
      category:         document.getElementById('m-cp-category').value.trim(),
      comments:         document.getElementById('m-cp-comments').value.trim(),
      keywords:         document.getElementById('m-cp-keywords').value.trim(),
      language:         document.getElementById('m-cp-language').value.trim(),
      revision:         (cp.revision ?? 0) + 1,
    },
  };
  newDoc.word_count = newDoc.full_text.trim().split(/\s+/).filter(Boolean).length;
  return newDoc;
}

async function saveFile() {
  state.error = null;
  state.info = null;

  const newName = document.getElementById('f-filename').value.trim();
  if (!newName) { state.error = 'Il nome del file non può essere vuoto.'; render(); return; }
  const finalName = newName.toLowerCase().endsWith('.json') ? newName : newName + '.json';

  const commitMsgInput = document.getElementById('f-commit').value.trim();
  const message = commitMsgInput || `chore: update "${finalName}"`;

  const btn = document.getElementById('btn-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvo…'; }

  try {
    const newDoc = collectDoc();
    const base64 = jsonToBase64(newDoc);

    const folder = state.current.sha
      ? parentFolderOf(state.current.file.path)
      : (state.currentFolder || state.config.folder);
    const newPath = `${folder}/${finalName}`;
    const renaming = newPath !== state.current.file.path;

    if (renaming) {
      if (state.current.sha) {
        const commitMsg = commitMsgInput || `chore: rinomina "${state.current.file.name}" in "${finalName}"`;
        const { sha: newSha } = await renameAndUpdateFileAtomic(state.config, state.current.file.path, newPath, base64, commitMsg);
        state.current.sha = newSha;
      } else {
        const createRes = await putFile(state.config, newPath, base64, message, null);
        state.current.sha = createRes?.content?.sha ?? null;
      }
      state.current.file = { name: finalName, path: newPath };
    } else {
      const res = await putFile(state.config, newPath, base64, message, state.current.sha);
      state.current.sha = res?.content?.sha ?? state.current.sha;
    }

    state.current.doc = newDoc;
    state.info = `"${finalName}" salvato con successo.`;
  } catch (e) {
    state.error = `Salvataggio non riuscito: ${e.message}`;
  }

  render();
}

async function boot() {
  const theme = await loadTheme();
  await applyTheme(theme);

  try {
    const oauthResult = await handleGithubCallback();
    if (oauthResult) {
      const { token, draft } = oauthResult;
      const cfg = {
        owner:  draft.owner  || '',
        repo:   draft.repo   || '',
        branch: draft.branch || 'main',
        folder: draft.folder || 'docs',
        token,
      };
      if (cfg.owner && cfg.repo) {
        if (draft.remember !== false) await saveConfig(cfg);
        await onConnect(cfg);
      } else {
        state.config = cfg;
        state.screen = 'setup';
        render();
      }
      return;
    }
  } catch (e) {
    state.error = e.message;
    state.screen = 'setup';
    render();
    return;
  }

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
