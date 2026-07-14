import { el, escapeHtml, escapeAttr } from '../ui/helpers.js';
import { themeToggleBtn } from '../ui/theme.js';
import { listFolder, renameFileAtomic, deleteFile, renameFolderAtomic, searchFiles, createFolder } from '../api/github.js';
import { state } from '../state.js';
import mammoth from 'mammoth';

export function renderList(app, render, onOpenFile, onSettings, onNewFile, onNewFolder) {
  app.innerHTML = '';

  // breadcrumb
  const rootFolder    = state.config.folder;
  const currentFolder = state.currentFolder || rootFolder;
  const segments      = currentFolder.split('/');
  const rootIdx       = segments.indexOf(rootFolder.split('/').pop());
  const crumbSegments = segments.slice(rootIdx >= 0 ? rootIdx : 0);

  let breadcrumbHtml = '';
  crumbSegments.forEach((seg, i) => {
    const isLast = i === crumbSegments.length - 1;
    if (isLast) {
      breadcrumbHtml += `<span style="color:var(--ink);font-weight:600">${escapeHtml(seg)}</span>`;
    } else {
      const pathUpTo = segments.slice(0, (rootIdx >= 0 ? rootIdx : 0) + i + 1).join('/');
      breadcrumbHtml += `<button class="link-btn breadcrumb-nav" data-path="${escapeAttr(pathUpTo)}" style="font-size:13px">${escapeHtml(seg)}</button>`;
      breadcrumbHtml += `<span style="color:var(--ink-soft);margin:0 4px">/</span>`;
    }
  });

  const top = el(`
    <div class="topbar">
      <div>
        <p class="eyebrow">${escapeHtml(state.config.owner)}/${escapeHtml(state.config.repo)} &middot; ${escapeHtml(state.config.branch)}</p>
        <div style="display:flex;align-items:baseline;gap:4px;flex-wrap:wrap">${breadcrumbHtml}</div>
      </div>
      <div class="topbar-actions">
        <span id="theme-slot"></span>
        <button class="link-btn" id="btn-settings">cambia repository</button>
      </div>
    </div>
  `);
  top.querySelector('#theme-slot').replaceWith(themeToggleBtn(render));
  top.querySelectorAll('.breadcrumb-nav').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.path, render))
  );
  app.appendChild(top);

  // banners
  if (state.error) app.appendChild(el(`<div class="banner error">${escapeHtml(state.error)}</div>`));
  if (state.info)  app.appendChild(el(`<div class="banner ok">${escapeHtml(state.info)}</div>`));

  // search bar
  const searchWrap = el(`
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input type="text" id="f-search" class="search-input" placeholder="Cerca per nome…" value="${escapeAttr(state.searchQuery || '')}" autocomplete="off">
      <button class="link-btn search-clear" id="btn-search-clear" style="display:${state.searchQuery ? '' : 'none'}">Cancella</button>
    </div>
  `);
  if (state.busy) {
    searchWrap.querySelectorAll('input, button').forEach(elm => elm.disabled = true);
  }
  app.appendChild(searchWrap);

  // file list card
  const card = el(`<div class="card"></div>`);
  renderListBody(card, render, onOpenFile);
  app.appendChild(card);

  const searchInput = searchWrap.querySelector('#f-search');
  const searchClear = searchWrap.querySelector('#btn-search-clear');
  searchInput.addEventListener('input', () => {
    state.searchQuery = searchInput.value;
    searchClear.style.display = state.searchQuery ? '' : 'none';
    scheduleSearch(render, card, onOpenFile);
  });
  searchClear.addEventListener('click', () => {
    state.searchQuery = '';
    state.searchDirs = [];
    state.searchFiles = [];
    state.searchTruncated = false;
    state.searching = false;
    searchInput.value = '';
    searchClear.style.display = 'none';
    renderListBody(card, render, onOpenFile);
    searchInput.focus();
  });

  const actions = el(`
    <div class="actions">
      <button class="secondary" id="btn-refresh">Aggiorna elenco</button>
      <button class="secondary" id="btn-new-folder">📁 Nuova cartella</button>
      <button class="secondary" id="btn-new">Nuovo documento</button>
    </div>
  `);
  if (state.actionBusy) {
    actions.querySelectorAll('button').forEach(b => b.disabled = true);
  }
  app.appendChild(actions);

  app.appendChild(el(`
    <footer class="note">
      L'editor gestisce testo, titoli (H1–H3), grassetto, corsivo, sottolineato ed elenchi.
      Tabelle, immagini e formattazioni avanzate presenti nel file originale non vengono conservate se il documento viene salvato da qui.
    </footer>
  `));

  top.querySelector('#btn-settings').addEventListener('click', onSettings);
  document.getElementById('btn-refresh').addEventListener('click', () => refreshList(render));
  document.getElementById('btn-new-folder').addEventListener('click', onNewFolder);
  document.getElementById('btn-new').addEventListener('click', onNewFile);
}

function renderListBody(card, render, onOpenFile) {
  card.innerHTML = '';

  const query      = (state.searchQuery || '').trim();
  const searchMode = query.length > 0;
  const dirs  = searchMode ? state.searchDirs  : state.dirs;
  const files = searchMode ? state.searchFiles : state.files;

  if (state.busy || (searchMode && state.searching)) {
    const label = searchMode ? 'Cerco in tutte le sottocartelle…' : 'Carico i file dal repository…';
    card.appendChild(el(`<div class="empty"><span class="spinner"></span>${label}</div>`));
  } else if (!dirs.length && !files.length) {
    const msg = searchMode
      ? `Nessun risultato per "${escapeHtml(query)}".`
      : `Nessun file .docx trovato in questa cartella.`;
    card.appendChild(el(`<div class="empty">${msg}</div>`));
  } else {
    if (searchMode && state.searchTruncated) {
      card.appendChild(el(`
        <div class="banner error">Il repository è troppo grande: la ricerca potrebbe non coprire tutti i file.</div>
      `));
    }

    const ul = el(`<ul class="file-list"></ul>`);

    // directories
    dirs.forEach(d => {
      const row = buildDirRow(d, render);
      if (state.actionBusy) {
        row.querySelectorAll('button, input').forEach(elm => elm.disabled = true);
      }
      ul.appendChild(row);
    });

    // .docx files
    files.forEach(f => {
      const row = buildFileRow(f, render, onOpenFile);
      if (state.actionBusy) {
        row.querySelectorAll('button, input').forEach(elm => elm.disabled = true);
      }
      ul.appendChild(row);
    });

    card.appendChild(ul);
  }
}

// search recursive
let searchSeq = 0;
let searchDebounceTimer = null;

function scheduleSearch(render, card, onOpenFile) {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

  const query = (state.searchQuery || '').trim();
  if (!query) {
    searchSeq++; // invalidate any in-flight search
    state.searching = false;
    state.searchDirs = [];
    state.searchFiles = [];
    state.searchTruncated = false;
    renderListBody(card, render, onOpenFile);
    return;
  }

  searchDebounceTimer = setTimeout(() => runSearch(render, card, onOpenFile), 300);
  // show the spinner right away, even before the debounce fires
  state.searching = true;
  renderListBody(card, render, onOpenFile);
}

async function runSearch(render, card, onOpenFile) {
  const seq = ++searchSeq;
  const query = (state.searchQuery || '').trim();
  const rootFolder = state.currentFolder || state.config.folder;

  state.searching = true;
  renderListBody(card, render, onOpenFile);

  try {
    const { dirs, files, truncated } = await searchFiles(state.config, rootFolder, query);
    if (seq !== searchSeq) return; // a newer search (or a clear) has since started, discard this one
    state.searchDirs = dirs;
    state.searchFiles = files;
    state.searchTruncated = truncated;
  } catch (e) {
    if (seq !== searchSeq) return;
    state.error = e.message;
  }
  if (seq !== searchSeq) return;
  state.searching = false;
  renderListBody(card, render, onOpenFile);
}

function buildFileRow(f, render, onOpenFile) {
  const row = el(`
    <li class="file-row" data-path="${escapeAttr(f.path)}">
      <div style="flex:1;min-width:0">
        <div class="file-name" style="display:flex;align-items:center;gap:7px">
          <span style="font-size:17px;line-height:1;flex-shrink:0">📄</span>
          <span class="file-label">${escapeHtml(f.name)}</span>
          <input class="rename-input" type="text" value="${escapeAttr(f.name)}"
            style="display:none;flex:1;font-size:14px;font-family:inherit;padding:4px 8px;
                   border:1.5px solid var(--accent);border-radius:var(--radius-xs);
                   background:var(--surface);color:var(--ink);">
        </div>
        <div class="file-path">${escapeHtml(f.path)}</div>
      </div>
      <div class="row-actions" style="display:flex;gap:6px;flex-shrink:0">
        <button class="secondary btn-rename" title="Rinomina">✏️</button>
        <button class="secondary btn-delete" title="Elimina">🗑️</button>
        <button class="secondary btn-open">Apri</button>
      </div>
      <div class="rename-actions" style="display:none;gap:6px;flex-shrink:0">
        <button class="btn-rename-confirm">✓ Rinomina</button>
        <button class="secondary btn-rename-cancel">Annulla</button>
      </div>
      <div class="delete-actions" style="display:none;gap:6px;flex-shrink:0;align-items:center">
        <span style="font-size:13px;color:var(--danger)">Eliminare definitivamente?</span>
        <button class="danger btn-delete-confirm">Elimina</button>
        <button class="secondary btn-delete-cancel">Annulla</button>
      </div>
    </li>
  `);

  const label        = row.querySelector('.file-label');
  const input        = row.querySelector('.rename-input');
  const rowActions   = row.querySelector('.row-actions');
  const renameActions = row.querySelector('.rename-actions');
  const deleteActions = row.querySelector('.delete-actions');
  const btnConfirm   = row.querySelector('.btn-rename-confirm');
  const btnCancel    = row.querySelector('.btn-rename-cancel');

  row.querySelector('.btn-open').addEventListener('click', () => onOpenFile(f));

  row.querySelector('.btn-rename').addEventListener('click', () => {
    label.style.display = 'none';
    input.style.display = '';
    rowActions.style.display = 'none';
    renameActions.style.display = 'flex';
    input.focus();
    input.select();
  });

  const cancelRename = () => {
    input.value = f.name;
    label.style.display = '';
    input.style.display = 'none';
    rowActions.style.display = 'flex';
    renameActions.style.display = 'none';
  };

  btnCancel.addEventListener('click', cancelRename);
  btnConfirm.addEventListener('click', () => renameFile(f, input.value.trim(), row, render));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  btnConfirm.click();
    if (e.key === 'Escape') cancelRename();
  });

  row.querySelector('.btn-delete').addEventListener('click', () => {
    rowActions.style.display = 'none';
    deleteActions.style.display = 'flex';
  });
  row.querySelector('.btn-delete-cancel').addEventListener('click', () => {
    deleteActions.style.display = 'none';
    rowActions.style.display = 'flex';
  });
  row.querySelector('.btn-delete-confirm').addEventListener('click', () => deleteFileAction(f, row, render));

  return row;
}

function buildDirRow(d, render) {
  const row = el(`
    <li class="file-row" data-path="${escapeAttr(d.path)}">
      <div style="flex:1;min-width:0">
        <div class="file-name" style="display:flex;align-items:center;gap:7px">
          <span style="font-size:17px;line-height:1;flex-shrink:0">📁</span>
          <span class="dir-label">${escapeHtml(d.name)}</span>
          <input class="rename-input" type="text" value="${escapeAttr(d.name)}"
            style="display:none;flex:1;font-size:14px;font-family:inherit;padding:4px 8px;
                   border:1.5px solid var(--accent);border-radius:var(--radius-xs);
                   background:var(--surface);color:var(--ink);">
        </div>
      </div>
      <div class="row-actions" style="display:flex;gap:6px;flex-shrink:0">
        <button class="secondary btn-rename-dir" title="Rinomina cartella">✏️</button>
        <button class="secondary btn-open-dir">Apri cartella</button>
      </div>
      <div class="rename-actions" style="display:none;gap:6px;flex-shrink:0">
        <button class="btn-rename-confirm">✓ Rinomina</button>
        <button class="secondary btn-rename-cancel">Annulla</button>
      </div>
    </li>
  `);

  const label        = row.querySelector('.dir-label');
  const input        = row.querySelector('.rename-input');
  const rowActions   = row.querySelector('.row-actions');
  const renameActions = row.querySelector('.rename-actions');
  const btnConfirm   = row.querySelector('.btn-rename-confirm');
  const btnCancel    = row.querySelector('.btn-rename-cancel');

  row.querySelector('.btn-open-dir').addEventListener('click', () => navigate(d.path, render));

  row.querySelector('.btn-rename-dir').addEventListener('click', () => {
    label.style.display = 'none';
    input.style.display = '';
    rowActions.style.display = 'none';
    renameActions.style.display = 'flex';
    input.focus();
    input.select();
  });

  const cancelRename = () => {
    input.value = d.name;
    label.style.display = '';
    input.style.display = 'none';
    rowActions.style.display = 'flex';
    renameActions.style.display = 'none';
  };

  btnCancel.addEventListener('click', cancelRename);
  btnConfirm.addEventListener('click', () => renameFolder(d, input.value.trim(), row, render));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  btnConfirm.click();
    if (e.key === 'Escape') cancelRename();
  });

  return row;
}

// actions
let refreshSeq = 0;

export async function refreshList(render) {
  const seq = ++refreshSeq;
  state.busy = true;
  state.error = null;
  state.info = null;
  render();
  try {
    const { dirs, files } = await listFolder(state.config, state.currentFolder || state.config.folder);
    if (seq !== refreshSeq) return; // a newer refresh has since started, discard this one
    state.dirs = dirs;
    state.files = files;
  } catch (e) {
    if (seq !== refreshSeq) return;
    state.error = e.message;
  }
  if (seq !== refreshSeq) return;
  state.busy = false;
  render();
}

// parent folder of a path, e.g. "docs/a/b.docx" -> "docs/a"
export function parentFolderOf(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function removeFileEverywhere(path) {
  state.files = state.files.filter(x => x.path !== path);
  state.searchFiles = state.searchFiles.filter(x => x.path !== path);
}

function removeDirEverywhere(path) {
  state.dirs = state.dirs.filter(x => x.path !== path);
  state.searchDirs = state.searchDirs.filter(x => x.path !== path);
}

function replaceFileEverywhere(oldPath, updatedFile) {
  const query         = (state.searchQuery || '').trim().toLowerCase();
  const currentFolder = state.currentFolder || state.config.folder;

  state.files = state.files.filter(x => x.path !== oldPath);
  if (parentFolderOf(updatedFile.path) === currentFolder) {
    state.files = state.files.concat([updatedFile]).sort((a, b) => a.name.localeCompare(b.name));
  }

  state.searchFiles = state.searchFiles.filter(x => x.path !== oldPath);
  if (query && updatedFile.name.toLowerCase().includes(query)) {
    state.searchFiles = state.searchFiles.concat([updatedFile]).sort((a, b) => a.name.localeCompare(b.name));
  }
}

function replaceDirEverywhere(oldPath, updatedDir) {
  const query         = (state.searchQuery || '').trim().toLowerCase();
  const currentFolder = state.currentFolder || state.config.folder;

  state.dirs = state.dirs.filter(x => x.path !== oldPath);
  if (parentFolderOf(updatedDir.path) === currentFolder) {
    state.dirs = state.dirs.concat([updatedDir]).sort((a, b) => a.name.localeCompare(b.name));
  }

  state.searchDirs = state.searchDirs.filter(x => x.path !== oldPath);
  if (query && updatedDir.name.toLowerCase().includes(query)) {
    state.searchDirs = state.searchDirs.concat([updatedDir]).sort((a, b) => a.name.localeCompare(b.name));
  }
}

function navigate(path, render) {
  state.currentFolder = path;
  state.searchQuery = '';
  refreshList(render);
}

async function renameFile(file, newName, rowEl, render) {
  if (!newName) { state.error = 'Il nome non può essere vuoto.'; render(); return; }

  const finalName = newName.toLowerCase().endsWith('.docx') ? newName : newName + '.docx';
  if (finalName === file.name) {
    rowEl.querySelector('.file-label').style.display = '';
    rowEl.querySelector('.rename-input').style.display = 'none';
    rowEl.querySelector('.row-actions').style.display = 'flex';
    rowEl.querySelector('.rename-actions').style.display = 'none';
    return;
  }

  if (state.actionBusy) return; // an operation is already running elsewhere in the list

  // the file's own parent folder, not necessarily the folder currently being
  // browsed (a rename can be triggered from a recursive search result)
  const folder  = parentFolderOf(file.path);
  const newPath = `${folder}/${finalName}`;

  state.actionBusy = true;
  rowEl.querySelectorAll('button').forEach(b => b.disabled = true);
  rowEl.querySelector('.btn-rename-confirm').textContent = '…';
  render();

  try {
    // a rename doesn't change the file's bytes, so reuse the blob sha
    await renameFileAtomic(state.config, file.path, newPath, file.sha, `chore: rinomina "${file.name}" in "${finalName}"`);

    // update the lists in place rather than re-fetching them from github
    replaceFileEverywhere(file.path, { ...file, name: finalName, path: newPath });
    state.info = `"${file.name}" rinominato in "${finalName}".`;
  } catch (e) {
    state.error = `Rinomina non riuscita: ${e.message}`;
  }
  state.actionBusy = false;
  render();
}

async function deleteFileAction(file, rowEl, render) {
  if (state.actionBusy) return;

  state.actionBusy = true;
  rowEl.querySelectorAll('button').forEach(b => b.disabled = true);
  rowEl.querySelector('.btn-delete-confirm').textContent = '…';
  render();

  try {
    await deleteFile(state.config, file.path, file.sha, `chore: elimina "${file.name}"`);

    removeFileEverywhere(file.path);
    state.info = `"${file.name}" eliminato.`;
  } catch (e) {
    state.error = `Eliminazione non riuscita: ${e.message}`;
  }
  state.actionBusy = false;
  render();
}

async function renameFolder(dir, newName, rowEl, render) {
  if (!newName) { state.error = 'Il nome non può essere vuoto.'; render(); return; }
  if (newName === dir.name) {
    rowEl.querySelector('.dir-label').style.display = '';
    rowEl.querySelector('.rename-input').style.display = 'none';
    rowEl.querySelector('.row-actions').style.display = 'flex';
    rowEl.querySelector('.rename-actions').style.display = 'none';
    return;
  }

  if (state.actionBusy) return;

  const parent  = parentFolderOf(dir.path);
  const newPath = `${parent}/${newName}`;

  state.actionBusy = true;
  rowEl.querySelectorAll('button').forEach(b => b.disabled = true);
  rowEl.querySelector('.btn-rename-confirm').textContent = '…';
  render();

  try {
    await renameFolderAtomic(state.config, dir.path, newPath, `chore: rinomina cartella "${dir.name}" in "${newName}"`);

    replaceDirEverywhere(dir.path, { ...dir, name: newName, path: newPath });
    state.info = `Cartella "${dir.name}" rinominata in "${newName}".`;
  } catch (e) {
    state.error = `Rinomina cartella non riuscita: ${e.message}`;
  }
  state.actionBusy = false;
  render();
}
