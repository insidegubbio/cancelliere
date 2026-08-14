import { el, escapeHtml, escapeAttr } from '../ui/helpers.js';
import { themeToggleBtn } from '../ui/theme.js';
import { listFolder, renameAndUpdateFileAtomic, deleteFile, renameFolderAtomic, searchFiles, createFolder, fetchFile, putFileRetrying, bytesToBase64 } from '../api/github.js';
import { buildVirtualIndex, updateVirtualIndexEntry, renameVirtualIndexEntry, removeVirtualIndexEntry } from '../api/virtualIndex.js';
import { state } from '../state.js';

export function renderList(app, render, onOpenFile, onSettings, onNewFile, onNewFolder) {
  app.innerHTML = '';

  const usingVirtual = !!state.categoriesIndex;
  const insideCategory = usingVirtual && !!(state.currentFolder && state.currentFolder.startsWith('cat:'));

  const top = el(`
    <div class="topbar">
      <div>
        <p class="eyebrow">${escapeHtml(state.config.owner)}/${escapeHtml(state.config.repo)} &middot; ${escapeHtml(state.config.branch)}</p>
        <div id="breadcrumb-slot" class="breadcrumb"></div>
      </div>
      <div class="topbar-actions">
        <span id="theme-slot"></span>
        <button class="link-btn" id="btn-settings">cambia repository</button>
      </div>
    </div>
  `);

  top.querySelector('#theme-slot').replaceWith(themeToggleBtn(render));

  const bc = top.querySelector('#breadcrumb-slot');

  if (usingVirtual) {
    const crumbs = [{ label: 'Documenti', path: null }];
    if (insideCategory) {
      const slug = state.currentFolder.slice(4);
      const cat = state.categoriesIndex.find(c => c.slug === slug);
      crumbs.push({ label: cat ? cat.name : slug, path: state.currentFolder });
    }
    crumbs.forEach((c, i) => {
      const isLast = i === crumbs.length - 1;
      if (!isLast) {
        const btn = el(`<button class="breadcrumb-btn">${escapeHtml(c.label)}</button>`);
        btn.addEventListener('click', () => navigate(c.path, render));
        bc.appendChild(btn);
        bc.appendChild(el(`<span class="breadcrumb-sep">/</span>`));
      } else {
        bc.appendChild(el(`<span class="breadcrumb-btn active">${escapeHtml(c.label)}</span>`));
      }
    });
  } else {
    const rootFolder    = state.config.folder;
    const currentFolder = state.currentFolder || rootFolder;
    const segments      = currentFolder.split('/');
    const rootIdx       = segments.indexOf(rootFolder.split('/').pop());
    const crumbSegments = segments.slice(rootIdx >= 0 ? rootIdx : 0);

    crumbSegments.forEach((seg, i) => {
      const isLast = i === crumbSegments.length - 1;
      if (!isLast) {
        const pathUpTo = segments.slice(0, (rootIdx >= 0 ? rootIdx : 0) + i + 1).join('/');
        const btn = el(`<button class="breadcrumb-btn" data-path="${escapeAttr(pathUpTo)}">${escapeHtml(seg)}</button>`);
        btn.addEventListener('click', () => navigate(btn.dataset.path, render));
        bc.appendChild(btn);
        bc.appendChild(el(`<span class="breadcrumb-sep">/</span>`));
      } else {
        bc.appendChild(el(`<span class="breadcrumb-btn active">${escapeHtml(seg)}</span>`));
      }
    });
  }

  app.appendChild(top);

  if (state.error) app.appendChild(el(`<div class="banner error">${escapeHtml(state.error)}</div>`));
  if (state.info)  app.appendChild(el(`<div class="banner ok">${escapeHtml(state.info)}</div>`));

  const pageHeader = el(`
    <div class="page-header">
      <div>
        <h1 class="title" style="margin:0 0 4px">Documenti</h1>
        <p style="font-size:13px;color:var(--muted-foreground);margin:0" id="file-count-label"></p>
      </div>
      <div class="page-header-actions">
        ${insideCategory ? '' : `
        <button class="btn-outline" id="btn-new-folder">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
          <span class="hide-xs">Nuova cartella</span>
        </button>`}
        ${(!usingVirtual || insideCategory) ? `
        <button class="btn-primary" id="btn-new">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuovo documento
        </button>` : ''}
      </div>
    </div>
  `);
  app.appendChild(pageHeader);

  const searchWrap = el(`
    <div class="search-wrap">
      <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="f-search" class="search-input" placeholder="Cerca per nome…" value="${escapeAttr(state.searchQuery || '')}" autocomplete="off">
      <button class="link-btn search-clear" id="btn-search-clear" style="display:${state.searchQuery ? '' : 'none'}">Cancella</button>
    </div>
  `);
  if (state.busy) searchWrap.querySelectorAll('input,button').forEach(e => e.disabled = true);
  app.appendChild(searchWrap);

  const card = el(`<div class="file-card"></div>`);
  renderListBody(card, render, onOpenFile);
  app.appendChild(card);

  const countLabel = pageHeader.querySelector('#file-count-label');
  const total = (state.files || []).length + (state.dirs || []).length;
  const nested = usingVirtual ? insideCategory : (state.currentFolder || state.config.folder) !== state.config.folder;
  if (state.busy && state.indexProgress) {
    countLabel.textContent = `Costruisco l'indice dagli articoli… ${state.indexProgress.done}/${state.indexProgress.total}`;
  } else {
    countLabel.textContent = state.busy ? 'Caricamento…' : `${total} element${total === 1 ? 'o' : 'i'}${nested ? ' in questa cartella' : ''}`;
  }

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

  const actionsBar = el(`
    <div class="actions-bar">
      <button class="btn-ghost" id="btn-refresh">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0018.49 15"/></svg>
        Aggiorna
      </button>
    </div>
  `);
  if (state.actionBusy) actionsBar.querySelectorAll('button').forEach(b => b.disabled = true);
  app.appendChild(actionsBar);

  app.appendChild(el(usingVirtual
    ? `<footer class="note">Le categorie qui sopra sono ricostruite leggendo il campo "category" scritto dentro ciascun articolo: non esiste più un indice separato da tenere sincronizzato. Creare, rinominare, spostare o eliminare un documento aggiorna sia GitHub sia questa vista immediatamente.</footer>`
    : `<footer class="note">I file sono salvati come slug senza estensione nel repository GitHub.</footer>`));

  top.querySelector('#btn-settings').addEventListener('click', onSettings);
  actionsBar.querySelector('#btn-refresh').addEventListener('click', () => refreshList(render, { forceReload: true }));
  const newFolderBtn = pageHeader.querySelector('#btn-new-folder');
  if (newFolderBtn) newFolderBtn.addEventListener('click', onNewFolder);
  const newFileBtn = pageHeader.querySelector('#btn-new');
  if (newFileBtn) newFileBtn.addEventListener('click', onNewFile);
}

function renderListBody(card, render, onOpenFile) {
  card.innerHTML = '';

  const query      = (state.searchQuery || '').trim();
  const searchMode = query.length > 0;
  const dirs  = searchMode ? state.searchDirs  : state.dirs;
  const files = searchMode ? state.searchFiles : state.files;

  if (state.busy || (searchMode && state.searching)) {
    const label = searchMode ? 'Cerco…' : (state.indexProgress ? `Costruisco l'indice dagli articoli… ${state.indexProgress.done}/${state.indexProgress.total}` : 'Carico i documenti dal repository…');
    card.appendChild(el(`<div class="empty"><span class="spinner"></span>${label}</div>`));
    return;
  }

  if (!dirs.length && !files.length) {
    const msg = searchMode
      ? `Nessun risultato per &ldquo;${escapeHtml(query)}&rdquo;.`
      : `Nessun documento trovato in questa cartella.`;
    card.appendChild(el(`<div class="empty">${msg}</div>`));
    return;
  }

  if (searchMode && state.searchTruncated) {
    card.appendChild(el(`<div class="banner error" style="margin:12px 16px 0">Il repository è troppo grande: la ricerca potrebbe non coprire tutti i file.</div>`));
  }

  const ul = el(`<ul class="file-list"></ul>`);
  dirs.forEach(d => {
    const row = buildDirRow(d, render, onOpenFile);
    if (state.actionBusy) row.querySelectorAll('button,input').forEach(e => e.disabled = true);
    ul.appendChild(row);
  });
  files.forEach(f => {
    const row = buildFileRow(f, render, onOpenFile);
    if (state.actionBusy) row.querySelectorAll('button,input').forEach(e => e.disabled = true);
    ul.appendChild(row);
  });
  card.appendChild(ul);
}

let searchSeq = 0;
let searchDebounceTimer = null;

function scheduleSearch(render, card, onOpenFile) {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  const query = (state.searchQuery || '').trim();
  if (!query) {
    searchSeq++;
    state.searching = false;
    state.searchDirs = [];
    state.searchFiles = [];
    state.searchTruncated = false;
    renderListBody(card, render, onOpenFile);
    return;
  }
  searchDebounceTimer = setTimeout(() => runSearch(render, card, onOpenFile), 300);
  state.searching = true;
  renderListBody(card, render, onOpenFile);
}

function virtualSearch(query) {
  const q = query.trim().toLowerCase();
  const dirs = [];
  const files = [];
  (state.categoriesIndex || []).forEach(c => {
    if ((c.name || '').toLowerCase().includes(q)) {
      dirs.push({ name: c.name, path: `cat:${c.slug}`, slug: c.slug, virtual: true });
    }
    (c.articles || []).forEach(a => {
      const title = a.title || a.slug;
      if (title.toLowerCase().includes(q) || (a.slug || '').toLowerCase().includes(q)) {
        files.push({
          name: title,
          path: `${state.config.folder}/${a.slug}`,
          slug: a.slug,
          categorySlug: c.slug,
        });
      }
    });
  });
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { dirs, files };
}

async function runSearch(render, card, onOpenFile) {
  const seq = ++searchSeq;
  const query = (state.searchQuery || '').trim();
  state.searching = true;
  renderListBody(card, render, onOpenFile);
  try {
    if (state.categoriesIndex) {
      const { dirs, files } = virtualSearch(query);
      if (seq !== searchSeq) return;
      state.searchDirs = dirs;
      state.searchFiles = files;
      state.searchTruncated = false;
    } else {
      const rootFolder = state.currentFolder || state.config.folder;
      const { dirs, files, truncated } = await searchFiles(state.config, rootFolder, query);
      if (seq !== searchSeq) return;
      state.searchDirs = dirs;
      state.searchFiles = files;
      state.searchTruncated = truncated;
    }
  } catch (e) {
    if (seq !== searchSeq) return;
    state.error = e.message;
  }
  if (seq !== searchSeq) return;
  state.searching = false;
  renderListBody(card, render, onOpenFile);
}

function iconSvg(name) {
  const icons = {
    pencil: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    move:   `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="9 12 12 15 15 12"/><line x1="12" y1="9" x2="12" y2="15"/></svg>`,
    trash:  `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    doc:    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    chevron:`<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  };
  return icons[name] || '';
}

function buildFileRow(f, render, onOpenFile) {
  const row = document.createElement('li');
  row.className = 'file-row';
  row.dataset.path = f.path;

  const virtualMode = !!state.categoriesIndex;
  const renameDefault = f.slug || f.name;

  const icon = el(`<span class="file-row-icon" style="color:var(--muted-foreground)">${iconSvg('doc')}</span>`);
  const body = el(`
    <div class="file-row-body">
      <div class="file-row-name" id="label-${escapeAttr(f.path)}">${escapeHtml(f.name)}</div>
      <div class="file-row-path">${escapeHtml(f.path)}</div>
    </div>
  `);

  const actions = el(`
    <div class="file-row-actions">
      <button class="btn-icon btn-rename" title="Rinomina file">${iconSvg('pencil')}</button>
      <button class="btn-icon btn-move" title="Sposta">${iconSvg('move')}</button>
      <button class="btn-icon btn-icon-danger btn-delete" title="Elimina">${iconSvg('trash')}</button>
    </div>
  `);

  const openBtn = el(`<button class="btn-outline btn-open" style="padding:6px 14px;font-size:13px;flex-shrink:0">Apri</button>`);

  row.appendChild(icon);
  row.appendChild(body);
  row.appendChild(actions);
  row.appendChild(openBtn);

  openBtn.addEventListener('click', () => onOpenFile(f));

  let mode = 'idle';

  const setMode = (m) => {
    mode = m;
    actions.style.display = m === 'idle' ? '' : 'none';
    openBtn.style.display = m === 'idle' ? '' : 'none';

    row.querySelectorAll('.inline-rename, .inline-delete, .inline-move').forEach(e => e.remove());

    if (m === 'rename') {
      const wrap = el(`
        <div class="inline-rename rename-input-wrap">
          <input class="rename-input" type="text" value="${escapeAttr(renameDefault)}" spellcheck="false">
          <button class="btn-outline" style="padding:5px 12px;font-size:13px">✓</button>
          <button class="btn-ghost" style="padding:5px 10px;font-size:13px">✕</button>
        </div>
      `);
      row.appendChild(wrap);
      const input = wrap.querySelector('input');
      const ok = wrap.querySelectorAll('button')[0];
      const cancel = wrap.querySelectorAll('button')[1];
      input.focus(); input.select();
      ok.addEventListener('click', () => renameFile(f, input.value.trim(), row, render));
      cancel.addEventListener('click', () => setMode('idle'));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') cancel.click(); });
    }

    if (m === 'delete') {
      const wrap = el(`
        <div class="inline-delete delete-confirm-wrap">
          <span>Eliminare definitivamente?</span>
          <button class="btn-outline" style="padding:5px 12px;font-size:13px;border-color:color-mix(in srgb,var(--destructive) 40%,transparent);color:var(--destructive)">Elimina</button>
          <button class="btn-ghost" style="padding:5px 10px;font-size:13px">Annulla</button>
        </div>
      `);
      row.appendChild(wrap);
      wrap.querySelectorAll('button')[0].addEventListener('click', () => deleteFileAction(f, row, render));
      wrap.querySelectorAll('button')[1].addEventListener('click', () => setMode('idle'));
    }

    if (m === 'move') {
      if (virtualMode) showMoveCategoryDialog(f, render);
      else showMoveDialog(f, render);
      mode = 'idle';
    }
  };

  actions.querySelector('.btn-rename').addEventListener('click', (e) => { e.stopPropagation(); setMode('rename'); });
  const moveBtn = actions.querySelector('.btn-move');
  if (moveBtn) moveBtn.addEventListener('click', (e) => { e.stopPropagation(); setMode('move'); });
  actions.querySelector('.btn-delete').addEventListener('click', (e) => { e.stopPropagation(); setMode('delete'); });

  return row;
}

function buildDirRow(d, render, onOpenFile) {
  const row = document.createElement('li');
  row.className = 'file-row';
  row.dataset.path = d.path;

  const icon = el(`<span class="file-row-icon" style="color:var(--muted-foreground)">${iconSvg('folder')}</span>`);
  const body = el(`
    <div class="file-row-body" style="cursor:pointer">
      <div class="file-row-name">${escapeHtml(d.name)}</div>
    </div>
  `);
  body.addEventListener('click', () => navigate(d.path, render));

  const showRenameDir = !d.virtual;

  const actions = el(`
    <div class="file-row-actions">
      ${showRenameDir ? `<button class="btn-icon btn-rename-dir" title="Rinomina cartella">${iconSvg('pencil')}</button>` : ''}
    </div>
  `);

  const openBtn = el(`
    <button class="btn-ghost" style="flex-shrink:0;color:var(--muted-foreground);padding:6px 8px">
      ${iconSvg('chevron')}
    </button>
  `);
  openBtn.addEventListener('click', () => navigate(d.path, render));

  row.appendChild(icon);
  row.appendChild(body);
  row.appendChild(actions);
  row.appendChild(openBtn);

  const renameDirBtn = actions.querySelector('.btn-rename-dir');
  if (renameDirBtn) {
    renameDirBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.style.display = 'none';
      openBtn.style.display = 'none';
      const wrap = el(`
        <div class="inline-rename rename-input-wrap">
          <input class="rename-input" type="text" value="${escapeAttr(d.name)}" spellcheck="false">
          <button class="btn-outline" style="padding:5px 12px;font-size:13px">✓</button>
          <button class="btn-ghost" style="padding:5px 10px;font-size:13px">✕</button>
        </div>
      `);
      row.appendChild(wrap);
      const input = wrap.querySelector('input');
      const ok = wrap.querySelectorAll('button')[0];
      const cancel = wrap.querySelectorAll('button')[1];
      input.focus(); input.select();
      const cancelFn = () => { wrap.remove(); actions.style.display = ''; openBtn.style.display = ''; };
      cancel.addEventListener('click', cancelFn);
      ok.addEventListener('click', () => renameFolder(d, input.value.trim(), row, render));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') cancelFn(); });
    });
  }

  return row;
}

function showMoveDialog(file, render) {
  const allDirs = [...(state.dirs || []), ...(state.searchDirs || [])];
  const rootFolder = state.currentFolder || state.config.folder;

  const overlay = el(`<div class="dialog-overlay"></div>`);
  const box = el(`
    <div class="dialog-box">
      <h2 class="dialog-title">Sposta &ldquo;${escapeHtml(file.name)}&rdquo;</h2>
      <p style="font-size:13px;color:var(--muted-foreground);margin:0 0 14px">Scegli la cartella di destinazione:</p>
      <div id="move-dir-list" style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;max-height:220px;overflow-y:auto"></div>
      <div class="dialog-footer">
        <button class="btn-outline" id="move-cancel">Annulla</button>
      </div>
    </div>
  `);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const list = box.querySelector('#move-dir-list');
  const options = [{ name: rootFolder.split('/').pop(), path: rootFolder }, ...allDirs.filter(d => d.path !== parentFolderOf(file.path))];

  if (!options.length) {
    list.innerHTML = `<div style="padding:16px;text-align:center;font-size:13px;color:var(--muted-foreground)">Nessuna cartella disponibile.</div>`;
  } else {
    options.forEach(dir => {
      const btn = el(`
        <button style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border:none;border-bottom:1px solid var(--border);background:none;font-family:inherit;font-size:14px;cursor:pointer;color:var(--foreground);text-align:left;transition:background .1s">
          ${iconSvg('folder')} ${escapeHtml(dir.name)}
        </button>
      `);
      btn.addEventListener('mouseenter', () => btn.style.background = 'var(--muted)');
      btn.addEventListener('mouseleave', () => btn.style.background = '');
      btn.addEventListener('click', () => {
        overlay.remove();
        moveFile(file, dir.path, render);
      });
      list.appendChild(btn);
    });
    if (list.lastChild) list.lastChild.style.borderBottom = 'none';
  }

  box.querySelector('#move-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showMoveCategoryDialog(file, render) {
  const cats = (state.categoriesIndex || []).filter(c => c.slug !== file.categorySlug);

  const overlay = el(`<div class="dialog-overlay"></div>`);
  const box = el(`
    <div class="dialog-box">
      <h2 class="dialog-title">Sposta &ldquo;${escapeHtml(file.name)}&rdquo;</h2>
      <p style="font-size:13px;color:var(--muted-foreground);margin:0 0 14px">Scegli la categoria di destinazione:</p>
      <div id="move-dir-list" style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;max-height:220px;overflow-y:auto"></div>
      <div class="dialog-footer">
        <button class="btn-outline" id="move-cancel">Annulla</button>
      </div>
    </div>
  `);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const list = box.querySelector('#move-dir-list');

  if (!cats.length) {
    list.innerHTML = `<div style="padding:16px;text-align:center;font-size:13px;color:var(--muted-foreground)">Nessuna altra categoria disponibile.</div>`;
  } else {
    cats.forEach(cat => {
      const btn = el(`
        <button style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border:none;border-bottom:1px solid var(--border);background:none;font-family:inherit;font-size:14px;cursor:pointer;color:var(--foreground);text-align:left;transition:background .1s">
          ${iconSvg('folder')} ${escapeHtml(cat.name)}
        </button>
      `);
      btn.addEventListener('mouseenter', () => btn.style.background = 'var(--muted)');
      btn.addEventListener('mouseleave', () => btn.style.background = '');
      btn.addEventListener('click', () => {
        overlay.remove();
        moveFileToCategory(file, cat.slug, render);
      });
      list.appendChild(btn);
    });
    if (list.lastChild) list.lastChild.style.borderBottom = 'none';
  }

  box.querySelector('#move-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

let refreshSeq = 0;

export async function refreshList(render, { forceReload = false } = {}) {
  const seq = ++refreshSeq;
  state.busy = true;
  state.error = null;
  state.info = null;
  state.indexProgress = null;
  render();
  try {
    if (forceReload) {
      state.categoriesIndex = null;
    }
    if (state.categoriesIndex === null) {
      const top = await listFolder(state.config, state.config.folder);
      if (seq !== refreshSeq) return;
      const looksVirtual = !top.dirs.length && top.files.length > 0;
      if (looksVirtual) {
        state.categoriesIndex = await buildVirtualIndex(state.config, {
          forceRefresh: forceReload,
          onProgress: (done, total) => {
            if (seq !== refreshSeq) return;
            state.indexProgress = { done, total };
            if (done === total || done % 15 === 0) render();
          },
        });
      } else {
        state.categoriesIndex = false;
        if (!state.currentFolder || state.currentFolder === state.config.folder) {
          state.dirs = top.dirs;
          state.files = top.files;
        }
      }
      if (seq !== refreshSeq) return;
    }
    if (state.categoriesIndex) {
      applyVirtualFolder();
    } else if (state.currentFolder && state.currentFolder !== state.config.folder) {
      const { dirs, files } = await listFolder(state.config, state.currentFolder);
      if (seq !== refreshSeq) return;
      state.dirs = dirs;
      state.files = files;
    }
  } catch (e) {
    if (seq !== refreshSeq) return;
    state.error = e.message;
  }
  if (seq !== refreshSeq) return;
  state.indexProgress = null;
  state.busy = false;
  render();
}

function applyVirtualFolder() {
  const cats = state.categoriesIndex;
  if (!state.currentFolder || !state.currentFolder.startsWith('cat:')) {
    state.currentFolder = null;
    state.dirs = cats
      .map(c => ({ name: c.name, path: `cat:${c.slug}`, slug: c.slug, virtual: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    state.files = [];
    return;
  }
  const slug = state.currentFolder.slice(4);
  const cat = cats.find(c => c.slug === slug);
  state.dirs = [];
  state.files = (cat?.articles || [])
    .map(a => ({
      name: a.title || a.slug,
      path: `${state.config.folder}/${a.slug}`,
      slug: a.slug,
      categorySlug: slug,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function categoriesIndexUpsertArticle(categorySlug, categoryName, article) {
  if (!state.categoriesIndex) return;
  let cat = state.categoriesIndex.find(c => c.slug === categorySlug);
  if (!cat) {
    cat = { slug: categorySlug, name: categoryName || categorySlug || 'Senza categoria', articles: [] };
    state.categoriesIndex = [...state.categoriesIndex, cat].sort((a, b) => a.name.localeCompare(b.name));
  } else if (categoryName && cat.name !== categoryName) {
    cat.name = categoryName;
  }
  cat.articles = [...(cat.articles || []).filter(a => a.slug !== article.slug), article]
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

export function categoriesIndexRemoveArticle(categorySlug, slug) {
  if (!state.categoriesIndex) return;
  const cat = state.categoriesIndex.find(c => c.slug === categorySlug);
  if (!cat) return;
  cat.articles = (cat.articles || []).filter(a => a.slug !== slug);
}

export function parentFolderOf(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function removeFileEverywhere(path) {
  state.files = state.files.filter(x => x.path !== path);
  state.searchFiles = state.searchFiles.filter(x => x.path !== path);
}

function replaceFileEverywhere(oldPath, updatedFile) {
  const query         = (state.searchQuery || '').trim().toLowerCase();
  const currentFolder = state.currentFolder || state.config.folder;
  state.files = state.files.filter(x => x.path !== oldPath);
  if (state.categoriesIndex ? true : parentFolderOf(updatedFile.path) === currentFolder) {
    state.files = [...state.files, updatedFile].sort((a, b) => a.name.localeCompare(b.name));
  }
  state.searchFiles = state.searchFiles.filter(x => x.path !== oldPath);
  if (query && updatedFile.name.toLowerCase().includes(query)) {
    state.searchFiles = [...state.searchFiles, updatedFile].sort((a, b) => a.name.localeCompare(b.name));
  }
}

function replaceDirEverywhere(oldPath, updatedDir) {
  const currentFolder = state.currentFolder || state.config.folder;
  state.dirs = state.dirs.filter(x => x.path !== oldPath);
  if (parentFolderOf(updatedDir.path) === currentFolder) {
    state.dirs = [...state.dirs, updatedDir].sort((a, b) => a.name.localeCompare(b.name));
  }
  state.searchDirs = state.searchDirs.filter(x => x.path !== oldPath);
}

function navigate(path, render) {
  state.currentFolder = path;
  state.searchQuery = '';
  refreshList(render);
}

async function ensureFileSha(file) {
  if (file.sha) return file.sha;
  const { sha } = await fetchFile(state.config, file.path);
  return sha;
}

async function recoverStaleList(render) {
  state.categoriesIndex = null;
  await refreshList(render);
}

function staleItemMessage(label) {
  return `"${label}" non esiste più a questo percorso: probabilmente è stato rinominato, spostato o eliminato da un altro utente nel frattempo. La lista è stata aggiornata.`;
}

async function renameFile(file, newName, rowEl, render) {
  if (!newName) { state.error = 'Il nome non può essere vuoto.'; render(); return; }
  const currentSlug = file.slug || file.name;
  if (newName === currentSlug) { render(); return; }
  if (state.actionBusy) return;

  const folder  = parentFolderOf(file.path);
  const newPath = `${folder}/${newName}`;

  state.actionBusy = true;
  render();

  try {
    const { bytes } = await fetchFile(state.config, file.path);
    let base64;
    let meta = null;
    try {
      const doc = JSON.parse(new TextDecoder().decode(bytes));
      doc.slug = newName;
      base64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(doc, null, 2)));
      meta = {
        slug: newName,
        title: doc.title || newName,
        summary: doc.summary || '',
        word_count: doc.word_count || 0,
        category: doc.category || '',
        category_name: doc.category_name || '',
      };
    } catch (_) {
      base64 = bytesToBase64(bytes);
    }
    const commitMessage = `chore: rinomina "${currentSlug}" in "${newName}"`;
    const { sha: newSha } = await renameAndUpdateFileAtomic(state.config, file.path, newPath, base64, commitMessage);

    if (state.categoriesIndex && meta) {
      renameVirtualIndexEntry(state.config, file.path, newPath, newSha, meta);
      if (file.categorySlug) categoriesIndexRemoveArticle(file.categorySlug, currentSlug);
      categoriesIndexUpsertArticle(meta.category, meta.category_name, {
        slug: meta.slug,
        title: meta.title,
        summary: meta.summary,
        category: meta.category,
        word_count: meta.word_count,
      });
    }

    replaceFileEverywhere(file.path, { ...file, path: newPath, slug: newName, name: file.categorySlug ? file.name : newName });
    state.info = `"${currentSlug}" rinominato in "${newName}".`;
  } catch (e) {
    state.actionBusy = false;
    if (e.status === 404) {
      await recoverStaleList(render);
      state.error = staleItemMessage(currentSlug);
    } else {
      state.error = `Rinomina non riuscita: ${e.message}`;
    }
    render();
    return;
  }
  state.actionBusy = false;
  render();
}

async function deleteFileAction(file, rowEl, render) {
  if (state.actionBusy) return;
  state.actionBusy = true;
  render();
  try {
    const sha = await ensureFileSha(file);
    await deleteFile(state.config, file.path, sha, `chore: elimina "${file.name}"`);
    if (state.categoriesIndex) {
      removeVirtualIndexEntry(state.config, file.path);
      if (file.categorySlug) categoriesIndexRemoveArticle(file.categorySlug, file.slug || file.name);
    }
    removeFileEverywhere(file.path);
    state.info = `"${file.name}" eliminato.`;
  } catch (e) {
    state.actionBusy = false;
    if (e.status === 404) {
      await recoverStaleList(render);
      state.error = staleItemMessage(file.name);
    } else {
      state.error = `Eliminazione non riuscita: ${e.message}`;
    }
    render();
    return;
  }
  state.actionBusy = false;
  render();
}

async function moveFile(file, destFolder, render) {
  if (state.actionBusy) return;
  const newPath = `${destFolder}/${file.name}`;
  if (newPath === file.path) return;

  state.actionBusy = true;
  state.error = null;
  state.info = null;
  render();

  try {
    const { bytes } = await fetchFile(state.config, file.path);
    const base64 = bytesToBase64(bytes);
    await renameAndUpdateFileAtomic(state.config, file.path, newPath, base64, `chore: sposta "${file.name}" in "${destFolder}"`);
    removeFileEverywhere(file.path);
    state.info = `"${file.name}" spostato in "${destFolder}".`;
  } catch (e) {
    state.actionBusy = false;
    if (e.status === 404) {
      await recoverStaleList(render);
      state.error = staleItemMessage(file.name);
    } else {
      state.error = `Spostamento non riuscito: ${e.message}`;
    }
    render();
    return;
  }
  state.actionBusy = false;
  render();
}

async function moveFileToCategory(file, destSlug, render) {
  if (state.actionBusy) return;
  if (!state.categoriesIndex) return;
  if (destSlug === file.categorySlug) return;

  const destCat = state.categoriesIndex.find(c => c.slug === destSlug);
  if (!destCat) return;

  const slug = file.slug || file.name;

  state.actionBusy = true;
  state.error = null;
  state.info = null;
  render();

  try {
    const { bytes, sha } = await fetchFile(state.config, file.path);
    let base64;
    let meta;
    try {
      const doc = JSON.parse(new TextDecoder().decode(bytes));
      doc.category = destSlug;
      doc.category_name = destCat.name || '';
      base64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(doc, null, 2)));
      meta = {
        slug,
        title: doc.title || file.name,
        summary: doc.summary || '',
        word_count: doc.word_count || 0,
        category: destSlug,
        category_name: destCat.name || '',
      };
    } catch (_) {
      base64 = bytesToBase64(bytes);
      meta = { slug, title: file.name, summary: '', word_count: 0, category: destSlug, category_name: destCat.name || '' };
    }

    const { data } = await putFileRetrying(state.config, file.path, base64, `chore: sposta "${file.name}" nella categoria "${destCat.name}"`, sha);
    const newSha = data?.content?.sha ?? sha;

    updateVirtualIndexEntry(state.config, file.path, newSha, meta);
    if (file.categorySlug) categoriesIndexRemoveArticle(file.categorySlug, slug);
    categoriesIndexUpsertArticle(destSlug, destCat.name, {
      slug: meta.slug,
      title: meta.title,
      summary: meta.summary,
      category: meta.category,
      word_count: meta.word_count,
    });

    removeFileEverywhere(file.path);
    state.info = `"${file.name}" spostato nella categoria "${destCat.name}".`;
  } catch (e) {
    state.actionBusy = false;
    if (e.status === 404) {
      await recoverStaleList(render);
      state.error = staleItemMessage(file.name);
    } else {
      state.error = `Spostamento non riuscito: ${e.message}`;
    }
    render();
    return;
  }
  state.actionBusy = false;
  render();
}

async function renameFolder(dir, newName, rowEl, render) {
  if (!newName || newName === dir.name) { render(); return; }
  if (state.actionBusy) return;

  const parent  = parentFolderOf(dir.path);
  const newPath = `${parent}/${newName}`;

  state.actionBusy = true;
  render();

  try {
    await renameFolderAtomic(state.config, dir.path, newPath, `chore: rinomina cartella "${dir.name}" in "${newName}"`);
    replaceDirEverywhere(dir.path, { ...dir, name: newName, path: newPath });
    state.info = `Cartella "${dir.name}" rinominata in "${newName}".`;
  } catch (e) {
    state.actionBusy = false;
    if (e.status === 404) {
      await recoverStaleList(render);
      state.error = staleItemMessage(dir.name);
    } else {
      state.error = `Rinomina cartella non riuscita: ${e.message}`;
    }
    render();
    return;
  }
  state.actionBusy = false;
  render();
}
