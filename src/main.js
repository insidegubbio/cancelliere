import { state } from './state.js';
import { loadConfig } from './api/storage.js';
import { loadTheme, applyTheme } from './ui/theme.js';
import { renderSetup } from './screens/setup.js';
import { renderList, refreshList } from './screens/list.js';
import { fetchFile, putFile, renameAndUpdateFileAtomic, bytesToBase64, createFolder } from './api/github.js';
import { buildDocx } from './docx/builder.js';
import { el, escapeHtml, escapeAttr } from './ui/helpers.js';
import mammoth from 'mammoth';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';

const app = document.getElementById('app');

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
  // loading
  app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--ink-soft)"><span class="spinner"></span></div>';
}

//  callbacks
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
    const result = await mammoth.convertToHtml(
      { arrayBuffer: bytes.buffer },
      { convertImage: mammoth.images.imgElement(image => {
          return image.read('base64').then(data => ({
            src: `data:${image.contentType};base64,${data}`,
          }));
        })
      }
    );
    // images lost sadly
    const hasImages = result.value.includes('<img');
    state.current = { file, sha, html: result.value, hasImages };
    state.busy = false;
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

// new folder
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

// editor screen
function renderEditor() {
  const { file, html } = state.current;
  app.innerHTML = '';

  // header
  const top = el(`
    <div class="editor-header">
      <div>
        <p class="eyebrow" style="margin-bottom:2px">${escapeHtml(state.config.folder)}/</p>
        <input class="filename-edit" id="f-filename" type="text" value="${escapeAttr(file.name)}">
      </div>
      <button class="secondary" id="btn-back">&larr; Torna all'elenco</button>
    </div>
  `);
  app.appendChild(top);

  if (state.error) app.appendChild(el(`<div class="banner error">${escapeHtml(state.error)}</div>`));
  if (state.info)  app.appendChild(el(`<div class="banner ok">${escapeHtml(state.info)}</div>`));
  if (state.current?.hasImages) app.appendChild(el(`<div class="banner warn">⚠️ Questo documento contiene immagini che non verranno conservate al salvataggio.</div>`));

  // toolbar
  const toolbar = el(`
    <div class="toolbar">
      <button class="icon" data-action="bold" title="Grassetto"><b>B</b></button>
      <button class="icon" data-action="italic" title="Corsivo"><i>I</i></button>
      <button class="icon" data-action="underline" title="Sottolineato"><u>U</u></button>
      <div class="sep"></div>
      <button class="icon" data-action="h1" title="Titolo 1">H1</button>
      <button class="icon" data-action="h2" title="Titolo 2">H2</button>
      <button class="icon" data-action="h3" title="Titolo 3">H3</button>
      <button class="icon" data-action="p" title="Paragrafo">P</button>
      <div class="sep"></div>
      <button class="icon" data-action="ul" title="Elenco puntato">&bull; &bull;</button>
      <button class="icon" data-action="ol" title="Elenco numerato">1.2.</button>
      <div class="sep"></div>
      <button class="icon" data-action="table" title="Inserisci tabella">⊞</button>
      <button class="icon" data-action="addRowAfter" title="Aggiungi riga">+↓</button>
      <button class="icon" data-action="addColumnAfter" title="Aggiungi colonna">+→</button>
      <button class="icon" data-action="deleteRow" title="Elimina riga">−↓</button>
      <button class="icon" data-action="deleteColumn" title="Elimina colonna">−→</button>
      <button class="icon" data-action="deleteTable" title="Elimina tabella">⊠</button>
    </div>
  `);
  app.appendChild(toolbar);

  // editor container
  const editorEl = document.createElement('div');
  editorEl.className = 'editor-surface';
  app.appendChild(editorEl);

  // init Tiptap
  const editor = new Editor({
    element: editorEl,
    extensions: [
      StarterKit,
      Underline,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: html,
    autofocus: true,
  });

  // toolbar actions
  toolbar.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      const chain = editor.chain().focus();
      if (a === 'bold')          chain.toggleBold().run();
      else if (a === 'italic')   chain.toggleItalic().run();
      else if (a === 'underline') chain.toggleUnderline().run();
      else if (a === 'h1')       chain.toggleHeading({ level: 1 }).run();
      else if (a === 'h2')       chain.toggleHeading({ level: 2 }).run();
      else if (a === 'h3')       chain.toggleHeading({ level: 3 }).run();
      else if (a === 'p')        chain.setParagraph().run();
      else if (a === 'ul')       chain.toggleBulletList().run();
      else if (a === 'ol')       chain.toggleOrderedList().run();
      else if (a === 'table')    chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      else if (a === 'addRowAfter')    chain.addRowAfter().run();
      else if (a === 'addColumnAfter') chain.addColumnAfter().run();
      else if (a === 'deleteRow')      chain.deleteRow().run();
      else if (a === 'deleteColumn')   chain.deleteColumn().run();
      else if (a === 'deleteTable')    chain.deleteTable().run();
    });
  });

  // update toolbar active states
  editor.on('selectionUpdate', () => updateToolbar(editor, toolbar));
  editor.on('transaction',     () => updateToolbar(editor, toolbar));

  // save row
  const saveRow = el(`
    <div class="save-row">
      <input class="commit-msg" id="f-commit" type="text" placeholder="Messaggio di commit (opzionale)">
      <button id="btn-save">Salva su GitHub</button>
    </div>
  `);
  app.appendChild(saveRow);

  app.appendChild(el(`
    <footer class="note">
      L'editor gestisce testo, titoli (H1–H3), grassetto, corsivo, sottolineato, elenchi e tabelle.
      Le immagini non vengono conservate al salvataggio.
    </footer>
  `));

  top.querySelector('#btn-back').addEventListener('click', () => {
    editor.destroy();
    state.current = null;
    state.error = null;
    state.info = null;
    state.screen = 'list';
    render();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    // pass the editor html to savefile instead of a dom surface
    saveFile(editor.getHTML());
  });
}

function updateToolbar(editor, toolbar) {
  const map = {
    bold:      () => editor.isActive('bold'),
    italic:    () => editor.isActive('italic'),
    underline: () => editor.isActive('underline'),
    h1:        () => editor.isActive('heading', { level: 1 }),
    h2:        () => editor.isActive('heading', { level: 2 }),
    h3:        () => editor.isActive('heading', { level: 3 }),
    p:         () => editor.isActive('paragraph'),
    ul:        () => editor.isActive('bulletList'),
    ol:        () => editor.isActive('orderedList'),
  };
  toolbar.querySelectorAll('button[data-action]').forEach(btn => {
    const check = map[btn.dataset.action];
    if (check) btn.classList.toggle('active', check());
  });
}

async function saveFile(htmlContent) {
  state.error = null;
  state.info = null;

  const newName = document.getElementById('f-filename').value.trim();
  if (!newName) { state.error = 'Il nome del file non può essere vuoto.'; render(); return; }
  const finalName = newName.toLowerCase().endsWith('.docx') ? newName : newName + '.docx';

  const commitMsgInput = document.getElementById('f-commit').value.trim();
  const message = commitMsgInput || `chore: update "${finalName}"`;

  const btn = document.getElementById('btn-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvo…'; }

  try {
    const bytes = await buildDocx(htmlContent);
    const base64 = bytesToBase64(bytes);

    const folder = state.currentFolder || state.config.folder;
    const newPath = `${folder}/${finalName}`;
    const renaming = newPath !== state.current.file.path;

    if (renaming) {
      if (state.current.sha) {
        // existing file so rename + save content in one commit.
        const commitMsg = commitMsgInput || `chore: rinomina "${state.current.file.name}" in "${finalName}"`;
        const { sha: newSha } = await renameAndUpdateFileAtomic(state.config, state.current.file.path, newPath, base64, commitMsg);
        state.current.sha = newSha;
      } else {
        // brand new, unsaved file so just create it.
        const createRes = await putFile(state.config, newPath, base64, message, null);
        state.current.sha = createRes?.content?.sha ?? null;
      }
      state.current.file = { name: finalName, path: newPath };
    } else {
      const res = await putFile(state.config, newPath, base64, message, state.current.sha);
      state.current.sha = res?.content?.sha ?? state.current.sha;
    }
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
