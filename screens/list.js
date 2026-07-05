import { el, escapeHtml, escapeAttr } from '../ui/helpers.js';
import { themeToggleBtn } from '../ui/theme.js';
import { listFolder, fetchFile, putFile, deleteFile, bytesToBase64 } from '../api/github.js';
import { state } from '../state.js';
import mammoth from 'mammoth';

export function renderList(app, render, onOpenFile, onSettings, onNewFile) {
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

  // file list card
  const card = el(`<div class="card"></div>`);

  if (state.busy) {
    card.appendChild(el(`<div class="empty"><span class="spinner"></span>Carico i file dal repository…</div>`));
  } else if (!state.dirs.length && !state.files.length) {
    card.appendChild(el(`<div class="empty">Nessun file .docx trovato in questa cartella.</div>`));
  } else {
    const ul = el(`<ul class="file-list"></ul>`);

    // directories
    state.dirs.forEach(d => {
      const row = el(`
        <li class="file-row">
          <div>
            <div class="file-name" style="display:flex;align-items:center;gap:7px">
              <span style="font-size:17px;line-height:1">📁</span>
              <span>${escapeHtml(d.name)}</span>
            </div>
          </div>
          <button class="secondary">Apri cartella</button>
        </li>
      `);
      row.querySelector('button').addEventListener('click', () => navigate(d.path, render));
      ul.appendChild(row);
    });

    // .docx files
    state.files.forEach(f => {
      const row = buildFileRow(f, render, onOpenFile);
      ul.appendChild(row);
    });

    card.appendChild(ul);
  }
  app.appendChild(card);

  const actions = el(`
    <div class="actions">
      <button class="secondary" id="btn-refresh">Aggiorna elenco</button>
      <button class="secondary" id="btn-new">Nuovo documento</button>
    </div>
  `);
  app.appendChild(actions);

  app.appendChild(el(`
    <footer class="note">
      L'editor gestisce testo, titoli (H1–H3), grassetto, corsivo, sottolineato ed elenchi.
      Tabelle, immagini e formattazioni avanzate presenti nel file originale non vengono conservate se il documento viene salvato da qui.
    </footer>
  `));

  top.querySelector('#btn-settings').addEventListener('click', onSettings);
  document.getElementById('btn-refresh').addEventListener('click', () => refreshList(render));
  document.getElementById('btn-new').addEventListener('click', onNewFile);
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
        <button class="secondary btn-open">Apri</button>
      </div>
      <div class="rename-actions" style="display:none;gap:6px;flex-shrink:0">
        <button class="btn-rename-confirm">✓ Rinomina</button>
        <button class="secondary btn-rename-cancel">Annulla</button>
      </div>
    </li>
  `);

  const label        = row.querySelector('.file-label');
  const input        = row.querySelector('.rename-input');
  const rowActions   = row.querySelector('.row-actions');
  const renameActions = row.querySelector('.rename-actions');
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

  return row;
}

// actions
export async function refreshList(render) {
  state.busy = true;
  state.error = null;
  state.info = null;
  render();
  try {
    const { dirs, files } = await listFolder(state.config, state.currentFolder || state.config.folder);
    state.dirs = dirs;
    state.files = files;
  } catch (e) {
    state.error = e.message;
  }
  state.busy = false;
  render();
}

function navigate(path, render) {
  state.currentFolder = path;
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

  const folder  = state.currentFolder || state.config.folder;
  const newPath = `${folder}/${finalName}`;

  rowEl.querySelectorAll('button').forEach(b => b.disabled = true);
  rowEl.querySelector('.btn-rename-confirm').textContent = '…';

  try {
    const { bytes, sha } = await fetchFile(state.config, file.path);
    const base64 = bytesToBase64(bytes);

    await putFile(state.config, newPath, base64, `Rinomina ${file.name} in ${finalName}`);
    await deleteFile(state.config, file.path, sha, `Rimuove ${file.name} (rinominato in ${finalName})`);

    state.info = `"${file.name}" rinominato in "${finalName}".`;
    await refreshList(render);
  } catch (e) {
    state.error = `Rinomina non riuscita: ${e.message}`;
    rowEl.querySelectorAll('button').forEach(b => b.disabled = false);
    rowEl.querySelector('.btn-rename-confirm').textContent = '✓ Rinomina';
    render();
  }
}
