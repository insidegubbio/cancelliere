import { state } from './state.js';
import { loadConfig, saveConfig } from './api/storage.js';
import { updateVirtualIndexEntry, renameVirtualIndexEntry } from './api/virtualIndex.js';
import { loadTheme, applyTheme } from './ui/theme.js';
import { renderSetup } from './screens/setup.js';
import { renderList, refreshList, parentFolderOf, categoriesIndexUpsertArticle, categoriesIndexRemoveArticle } from './screens/list.js';
import { handleGithubCallback } from './api/oauth.js';
import { fetchFile, putFileRetrying, renameAndUpdateFileAtomic, bytesToBase64, base64ToBytes, createFolder, getAuthenticatedUser } from './api/github.js';
import { bodyToHtml, htmlToBody, bodyToPlainText, monumentiToBody } from './json/body.js';
import { createEmptyDocument } from './json/defaults.js';
import { Editor, createTiptapExtensions, TOOLBAR_GROUPS, EDITOR_ACTIONS, TOOLBAR_ACTIVE_CHECKS } from './editor/config.js';
import { el, escapeHtml, escapeAttr } from './ui/helpers.js';

const app = document.getElementById('app');
let editor = null;

function jsonToBase64(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));
  return bytesToBase64(bytes);
}

function bytesToJson(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function attempt(task, { onError } = {}) {
  try {
    await task();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: onError ? onError(e) : e.message };
  }
}

async function ensureUsername() {
  if (!state.config) return null;
  if (!state.config.username) {
    state.config.username = await getAuthenticatedUser(state.config);
  }
  return state.config.username;
}

function render() {
  if (state.screen === 'setup') return renderSetup(app, state.config, state.error, onConnect, render);
  if (state.screen === 'list') return renderList(app, render, onOpenFile, onSettings, onNewFile, onNewFolder);
  if (state.screen === 'editor') return renderEditor();
  app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--ink-soft)"><span class="spinner"></span></div>';
}

async function onConnect(cfg) {
  state.config = cfg;
  state.error = null;
  state.screen = 'list';
  await refreshList(render);
  ensureUsername();
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

  const result = await attempt(async () => {
    const { bytes, sha } = await fetchFile(state.config, file.path);
    const doc = bytesToJson(bytes);

    if (!doc.body?.length && doc.monumenti?.length) {
      doc.body = monumentiToBody(doc.monumenti);
    }

    try {
      bodyToHtml(doc.body);
    } catch (err) {
      throw new Error(`il contenuto non è nel formato atteso e non può essere aperto nell'editor (${err.message}).`);
    }

    state.current = { file, sha, doc };
  }, {
    onError: e => e.status === 404
      ? `"${file.slug || file.name}" non esiste più a questo percorso: probabilmente è stato rinominato o spostato da un altro utente nel frattempo. La lista è stata aggiornata, riprova dalla riga corretta.`
      : `Impossibile aprire il file: ${e.message}`,
  });

  state.busy = false;
  if (result.ok) {
    state.screen = 'editor';
    render();
  } else if (result.error.includes('non esiste più a questo percorso')) {
    state.categoriesIndex = null;
    await refreshList(render);
    state.error = result.error;
    render();
  } else {
    state.error = result.error;
    render();
  }
}

function onNewFile() {
  const name = prompt('Nome del nuovo file JSON (senza estensione):')?.trim();
  if (!name) return;

  const slug = name.toLowerCase().replace(/\s+/g, '-');

  const usingVirtual = !!state.categoriesIndex;
  const insideCategory = usingVirtual && !!(state.currentFolder && state.currentFolder.startsWith('cat:'));
  const categorySlug = insideCategory ? state.currentFolder.slice(4) : null;

  const folder = usingVirtual ? state.config.folder : (state.currentFolder || state.config.folder);
  const category = categorySlug || folder.split('/').pop();
  const categoryEntry = categorySlug ? (state.categoriesIndex || []).find(c => c.slug === categorySlug) : null;

  const doc = createEmptyDocument(slug, category);
  if (categoryEntry?.name) doc.category_name = categoryEntry.name;

  state.current = {
    file: {
      name: slug,
      slug,
      path: `${folder}/${slug}`,
      ...(categorySlug ? { categorySlug } : {}),
    },
    sha: null,
    doc,
  };
  state.screen = 'editor';
  render();
}

async function onNewFolder() {
  const usingVirtual = !!state.categoriesIndex;
  const insideCategory = usingVirtual && !!(state.currentFolder && state.currentFolder.startsWith('cat:'));

  if (usingVirtual && !insideCategory) {
    return onNewCategory();
  }

  const name = prompt('Nome della nuova cartella:')?.trim();
  if (!name) return;

  const folder = state.currentFolder || state.config.folder;
  const path = `${folder}/${name}`;

  state.actionBusy = true;
  state.error = null;
  state.info = null;
  render();

  const result = await attempt(async () => {
    await createFolder(state.config, path, `nuova cartella "${name}"`);
    state.dirs = [...state.dirs, { name, path }].sort((a, b) => a.name.localeCompare(b.name));
  }, { onError: e => `Impossibile creare la cartella: ${e.message}` });

  state.actionBusy = false;
  if (result.ok) state.info = `Cartella "${name}" creata.`;
  else state.error = result.error;
  render();
}

function onNewCategory() {
  const name = prompt('Nome della nuova categoria:')?.trim();
  if (!name) return;

  const slug = name.toLowerCase().replace(/\s+/g, '-');
  if (state.categoriesIndex.some(c => c.slug === slug)) {
    state.error = `Esiste già una categoria "${name}".`;
    render();
    return;
  }

  state.categoriesIndex = [...state.categoriesIndex, { slug, name, articles: [] }]
    .sort((a, b) => a.name.localeCompare(b.name));
  state.dirs = [...state.dirs, { name, path: `cat:${slug}`, slug, virtual: true }]
    .sort((a, b) => a.name.localeCompare(b.name));
  state.info = `Categoria "${name}" creata: diventa definitiva salvando il primo documento al suo interno.`;
  render();
}

function renderEditor() {
  const { file, doc } = state.current;
  app.innerHTML = '';

  const top = el(`
    <div class="editor-header">
      <div>
        <p class="eyebrow" style="margin-bottom:4px">${escapeHtml(state.config.folder)}/</p>
        <input class="filename-edit" id="f-filename" type="text" value="${escapeAttr(file.slug || file.name)}">
      </div>
      <button class="secondary" id="btn-back">&larr; Torna all'elenco</button>
    </div>
  `);
  app.appendChild(top);

  const titleRow = el(`
    <div class="field-row" style="margin:0 0 16px">
      <label class="eyebrow" for="f-title" style="display:block;margin-bottom:4px">Titolo</label>
      <input class="filename-edit" id="f-title" type="text" value="${escapeAttr(doc.title || '')}" style="width:100%">
    </div>
  `);
  app.appendChild(titleRow);

  const bannerHost = document.createElement('div');
  app.appendChild(bannerHost);

  function showBanner(type, message) {
    bannerHost.innerHTML = message ? `<div class="banner ${type}">${escapeHtml(message)}</div>` : '';
  }

  if (state.error) showBanner('error', state.error);
  else if (state.info) showBanner('ok', state.info);
  state.error = null;
  state.info = null;

  const toolbarHtml = TOOLBAR_GROUPS
    .map(group => group.map(btn => `<button class="icon" data-action="${btn.action}" title="${btn.title}">${btn.label}</button>`).join(''))
    .join('<div class="sep"></div>');
  const toolbar = el(`<div class="toolbar">${toolbarHtml}</div>`);
  app.appendChild(toolbar);

  const editorEl = document.createElement('div');
  editorEl.className = 'editor-surface';
  app.appendChild(editorEl);

  editor = new Editor({
    element: editorEl,
    extensions: createTiptapExtensions(),
    content: bodyToHtml(doc.body),
    autofocus: true,
  });

  toolbar.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => EDITOR_ACTIONS[btn.dataset.action]?.(editor));
  });

  const updateToolbarState = () => {
    toolbar.querySelectorAll('button[data-action]').forEach(btn => {
      const isActive = TOOLBAR_ACTIVE_CHECKS[btn.dataset.action];
      if (isActive) btn.classList.toggle('active', isActive(editor));
    });
  };
  editor.on('selectionUpdate', updateToolbarState);
  editor.on('transaction', updateToolbarState);

  const saveRow = el(`
    <div class="save-row">
      <input class="commit-msg" id="f-commit" type="text" placeholder="Messaggio di commit (opzionale)">
      <button class="btn-primary" id="btn-save">Salva su GitHub</button>
    </div>
  `);
  app.appendChild(saveRow);

  app.appendChild(el(`
    <footer class="note">
      Categoria, riepilogo e immagini restano invariati e vengono preservati così come sono nel file.
      Slug e titolo sono editabili qui sopra: il titolo aggiornato viene salvato sia nel campo "title" sia nei metadati (core_properties).
      Autore ultima modifica e data di modifica si aggiornano automaticamente a ogni salvataggio.
    </footer>
  `));

  top.querySelector('#btn-back').addEventListener('click', () => {
    editor.destroy();
    editor = null;
    state.current = null;
    state.error = null;
    state.info = null;
    state.screen = 'list';
    render();
  });

  document.getElementById('btn-save').addEventListener('click', () => saveFile(editor.getHTML(), showBanner));
}

async function saveFile(htmlContent, showBanner) {
  const rawName = document.getElementById('f-filename').value.trim();
  if (!rawName) { showBanner('error', 'Il nome del file non può essere vuoto.'); return; }

  const finalName = rawName.toLowerCase().endsWith('.json') ? rawName.slice(0, -5) : rawName;
  const commitMsgInput = document.getElementById('f-commit').value.trim();
  const rawTitle = document.getElementById('f-title').value.trim();

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Salvo…';

  let conflictWasResolved = false;
  const result = await attempt(async () => {
    const username = await ensureUsername();
    const { doc } = state.current;
    const cp = doc.core_properties || {};
    const now = new Date().toISOString();
    const body = htmlToBody(htmlContent);
    const fullText = bodyToPlainText(body);
    const finalTitle = rawTitle || doc.title || '';
    const wordCount = fullText.match(/\S+/g)?.length ?? 0;

    const newDoc = {
      ...doc,
      slug: finalName,
      title: finalTitle,
      body,
      full_text: fullText,
      word_count: wordCount,
      core_properties: {
        ...cp,
        last_modified_by: username || cp.last_modified_by || '',
        title: finalTitle,
        modified: now,
        revision: (cp.revision ?? 0) + 1,
      },
    };

    const base64 = jsonToBase64(newDoc);
    const usingVirtual = !!state.categoriesIndex;
    const folder = state.current.sha
      ? parentFolderOf(state.current.file.path)
      : (usingVirtual ? state.config.folder : (state.currentFolder || state.config.folder));
    const newPath = `${folder}/${finalName}`;
    const renaming = newPath !== state.current.file.path;
    const categorySlug = state.current.file.categorySlug || null;
    const oldSlug = state.current.file.slug || state.current.file.name;

    const commitMsg = commitMsgInput
      || (state.current.sha
        ? (renaming ? `rinomina "${oldSlug}" in "${finalName}"` : `aggiorna "${finalName}"`)
        : `crea "${finalName}"`);

    let newSha;
    if (renaming && state.current.sha) {
      const renameResult = await renameAndUpdateFileAtomic(state.config, state.current.file.path, newPath, base64, commitMsg);
      newSha = renameResult.sha;
    } else if (state.current.sha) {
      const { data } = await putFileRetrying(state.config, newPath, base64, commitMsg, state.current.sha);
      newSha = data?.content?.sha ?? null;
      conflictWasResolved = false;
    } else {
      const { data: created } = await putFileRetrying(state.config, newPath, base64, commitMsg, null);
      newSha = created?.content?.sha ?? null;
    }

    if (categorySlug && state.categoriesIndex) {
      const destCat = state.categoriesIndex.find(c => c.slug === categorySlug);
      const meta = {
        slug: finalName,
        title: finalTitle,
        summary: newDoc.summary || '',
        word_count: wordCount,
        category: categorySlug,
        category_name: destCat?.name || newDoc.category_name || '',
      };
      if (renaming && state.current.sha) {
        renameVirtualIndexEntry(state.config, state.current.file.path, newPath, newSha, meta);
      } else {
        updateVirtualIndexEntry(state.config, newPath, newSha, meta);
      }
      if (renaming) categoriesIndexRemoveArticle(categorySlug, oldSlug);
      categoriesIndexUpsertArticle(categorySlug, meta.category_name, {
        slug: meta.slug,
        title: meta.title,
        summary: meta.summary,
        category: meta.category,
        word_count: meta.word_count,
      });
    }

    state.current.file = { name: finalName, slug: finalName, path: newPath, ...(categorySlug ? { categorySlug } : {}) };
    state.current.sha = newSha;
    state.current.doc = newDoc;
  }, { onError: e => `Salvataggio non riuscito: ${e.message}` });

  btn.disabled = false;
  btn.textContent = 'Salva su GitHub';

  if (result.ok) {
    showBanner('ok', conflictWasResolved
      ? `"${finalName}" salvato con successo (il file era stato modificato altrove nel frattempo: la tua versione ha sovrascritto quella più recente).`
      : `"${finalName}" salvato con successo.`);
  } else {
    showBanner('error', result.error);
  }
}

async function boot() {
  const theme = await loadTheme();
  await applyTheme(theme);

  try {
    const oauthResult = await handleGithubCallback();
    if (oauthResult) {
      const { token, draft } = oauthResult;
      const cfg = {
        owner: draft.owner || '',
        repo: draft.repo || '',
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
  if (cfg && cfg.token) {
    state.config = cfg;
    state.screen = 'list';
    await refreshList(render);
    ensureUsername();
  } else if (cfg) {
    state.config = cfg;
    state.screen = 'setup';
    render();
  } else {
    state.screen = 'setup';
    render();
  }
}

boot();
