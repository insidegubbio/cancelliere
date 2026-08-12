import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';

export function createTiptapExtensions() {
  return [
    StarterKit,
    Underline,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}

export const TOOLBAR_GROUPS = [
  [
    { action: 'bold', label: '<b>B</b>', title: 'Grassetto' },
    { action: 'italic', label: '<i>I</i>', title: 'Corsivo' },
    { action: 'underline', label: '<u>U</u>', title: 'Sottolineato' },
  ],
  [
    { action: 'h1', label: 'H1', title: 'Titolo 1' },
    { action: 'h2', label: 'H2', title: 'Titolo 2' },
    { action: 'h3', label: 'H3', title: 'Titolo 3' },
    { action: 'p', label: 'P', title: 'Paragrafo' },
  ],
  [
    { action: 'ul', label: '&bull; &bull;', title: 'Elenco puntato' },
    { action: 'ol', label: '1.2.', title: 'Elenco numerato' },
  ],
  [
    { action: 'table', label: '⊞', title: 'Inserisci tabella' },
    { action: 'addRowAfter', label: '+↓', title: 'Aggiungi riga' },
    { action: 'addColumnAfter', label: '+→', title: 'Aggiungi colonna' },
    { action: 'deleteRow', label: '−↓', title: 'Elimina riga' },
    { action: 'deleteColumn', label: '−→', title: 'Elimina colonna' },
    { action: 'deleteTable', label: '⊠', title: 'Elimina tabella' },
  ],
];

export const EDITOR_ACTIONS = {
  bold: e => e.chain().focus().toggleBold().run(),
  italic: e => e.chain().focus().toggleItalic().run(),
  underline: e => e.chain().focus().toggleUnderline().run(),
  h1: e => e.chain().focus().toggleHeading({ level: 1 }).run(),
  h2: e => e.chain().focus().toggleHeading({ level: 2 }).run(),
  h3: e => e.chain().focus().toggleHeading({ level: 3 }).run(),
  p: e => e.chain().focus().setParagraph().run(),
  ul: e => e.chain().focus().toggleBulletList().run(),
  ol: e => e.chain().focus().toggleOrderedList().run(),
  table: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  addRowAfter: e => e.chain().focus().addRowAfter().run(),
  addColumnAfter: e => e.chain().focus().addColumnAfter().run(),
  deleteRow: e => e.chain().focus().deleteRow().run(),
  deleteColumn: e => e.chain().focus().deleteColumn().run(),
  deleteTable: e => e.chain().focus().deleteTable().run(),
};

export const TOOLBAR_ACTIVE_CHECKS = {
  bold: e => e.isActive('bold'),
  italic: e => e.isActive('italic'),
  underline: e => e.isActive('underline'),
  h1: e => e.isActive('heading', { level: 1 }),
  h2: e => e.isActive('heading', { level: 2 }),
  h3: e => e.isActive('heading', { level: 3 }),
  p: e => e.isActive('paragraph'),
  ul: e => e.isActive('bulletList'),
  ol: e => e.isActive('orderedList'),
};

export { Editor };
