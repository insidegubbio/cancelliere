import { escapeHtml } from '../ui/helpers.js';

const WORD_STYLE_TO_LEVEL = {
  'heading 1': 1,
  'heading 2': 2,
  'heading 3': 3,
  'heading 4': 3,
  'title': 1,
  'subtitle': 2,
};

function levelFromStyle(style) {
  if (!style) return null;
  return WORD_STYLE_TO_LEVEL[String(style).toLowerCase()] || null;
}

function normalizeTableRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    if (Array.isArray(row)) return row;
    if (row && Array.isArray(row.cells)) return row.cells;
    return [];
  });
}

function cellRunsFromContent(content) {
  return (Array.isArray(content) ? content : [])
    .map(p => Array.isArray(p?.runs) && p.runs.length ? p.runs : (p?.text ? [{ text: p.text }] : []))
    .filter(runs => runs.length);
}

export function bodyToHtml(body) {
  if (!Array.isArray(body) || body.length === 0) return '<p></p>';

  const chunks = [];
  let listBuffer = null; // { ordered, items: [runs] }

  function flushList() {
    if (!listBuffer) return;
    const tag = listBuffer.ordered ? 'ol' : 'ul';
    const items = listBuffer.items.map(runs => `<li>${runsToHtml(runs)}</li>`).join('');
    chunks.push(`<${tag}>${items}</${tag}>`);
    listBuffer = null;
  }

  body.forEach(block => {
    if (block?.type === 'table') {
      flushList();
      const rows = normalizeTableRows(block.rows);
      const rowsHtml = rows.map((row, ri) => {
        const cellsHtml = (row || []).map(cell => {
          const isHeader = cell?.header ?? (ri === 0);
          const tag = isHeader ? 'th' : 'td';
          if (Array.isArray(cell?.content)) {
            const paragraphsHtml = cellRunsFromContent(cell.content).map(runs => runsToHtml(runs)).filter(Boolean);
            return `<${tag}>${paragraphsHtml.join('<br>')}</${tag}>`;
          }
          const runs = cell?.runs || (cell?.text != null ? [{ text: cell.text }] : []);
          return `<${tag}>${runsToHtml(runs)}</${tag}>`;
        }).join('');
        return `<tr>${cellsHtml}</tr>`;
      }).join('');
      chunks.push(`<table><tbody>${rowsHtml}</tbody></table>`);
      return;
    }

    const runs = Array.isArray(block?.runs) && block.runs.length
      ? block.runs
      : (block?.text ? [{ text: block.text }] : []);

    if (block?.list) {
      const ordered = block.list.type === 'number' || block.list.ordered === true || block.list.numbered === true;
      if (!listBuffer || listBuffer.ordered !== ordered) {
        flushList();
        listBuffer = { ordered, items: [] };
      }
      listBuffer.items.push(runs);
      return;
    }

    flushList();

    const level = levelFromStyle(block?.style);
    if (level) {
      chunks.push(`<h${level}>${runsToHtml(runs)}</h${level}>`);
    } else {
      chunks.push(`<p>${runsToHtml(runs)}</p>`);
    }
  });

  flushList();
  return chunks.join('') || '<p></p>';
}

function runsToHtml(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return '';
  return runs.map(r => {
    let text = escapeHtml(r?.text ?? '').replace(/\n/g, '<br>');
    if (!text) return '';
    if (r?.bold) text = `<strong>${text}</strong>`;
    if (r?.italic) text = `<em>${text}</em>`;
    if (r?.underline) text = `<u>${text}</u>`;
    if (r?.strike) text = `<s>${text}</s>`;
    return text;
  }).join('');
}

export function htmlToBody(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const body = [];
  tmp.childNodes.forEach(node => nodeToBlocks(node, body));
  return body;
}

function blankParagraphExtras() {
  return {
    alignment: null,
    indentation: { left_pt: null, right_pt: null, first_line_pt: null },
    spacing: { before_pt: null, after_pt: null, line_spacing: null },
    hyperlinks: [],
    images: [],
  };
}

function makeParagraph(style, runs, list) {
  return {
    type: 'paragraph',
    style,
    text: runs.map(r => r.text ?? '').join(''),
    list: list || null,
    runs,
    ...blankParagraphExtras(),
  };
}

function nodeToBlocks(node, body) {
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();

  if (/^h[1-4]$/.test(tag)) {
    const level = Math.min(3, parseInt(tag[1], 10));
    body.push(makeParagraph(`Heading ${level}`, runsFromInline(node, {})));
  } else if (tag === 'ul' || tag === 'ol') {
    const ordered = tag === 'ol';
    node.querySelectorAll(':scope > li').forEach(li => {
      body.push(makeParagraph('Normal', runsFromInline(li, {}), { type: ordered ? 'number' : 'bullet', level: 0 }));
    });
  } else if (tag === 'table') {
    const rows = [];
    node.querySelectorAll('tr').forEach(tr => {
      const row = [];
      tr.querySelectorAll('th, td').forEach(cell => {
        const runs = runsFromInline(cell, {});
        row.push({ runs, text: runs.map(r => r.text ?? '').join(''), header: cell.tagName.toLowerCase() === 'th' });
      });
      rows.push(row);
    });
    body.push({ type: 'table', rows });
  } else if (tag === 'p' || tag === 'div') {
    body.push(makeParagraph('Normal', runsFromInline(node, {})));
  } else if (node.textContent.trim()) {
    body.push(makeParagraph('Normal', runsFromInline(node, {})));
  }
}

function runsFromInline(node, fmt) {
  let runs = [];
  node.childNodes.forEach(child => {
    if (child.nodeType === 3) {
      if (child.textContent) runs.push(makeRun(child.textContent, fmt));
      return;
    }
    if (child.nodeType !== 1) return;
    const t = child.tagName.toLowerCase();
    if (t === 'br') { runs.push(makeRun('\n', fmt)); return; }
    const newFmt = { ...fmt };
    if (t === 'strong' || t === 'b') newFmt.bold = true;
    if (t === 'em' || t === 'i') newFmt.italic = true;
    if (t === 'u') newFmt.underline = true;
    if (t === 's' || t === 'strike' || t === 'del') newFmt.strike = true;
    runs = runs.concat(runsFromInline(child, newFmt));
  });
  return runs;
}

function makeRun(text, fmt) {
  return {
    text,
    bold: fmt.bold || null,
    italic: fmt.italic || null,
    underline: fmt.underline || null,
    strike: fmt.strike || null,
    superscript: null,
    subscript: null,
    font_name: null,
    font_size_pt: null,
    color: null,
    highlight: null,
  };
}

export function bodyToPlainText(body) {
  if (!Array.isArray(body)) return '';
  return body
    .map(block => {
      if (block?.type === 'table') {
        const rows = normalizeTableRows(block.rows);
        return rows
          .map(row => (row || []).map(cell => {
            if (Array.isArray(cell?.content)) {
              return cellRunsFromContent(cell.content).map(runs => runsToPlain(runs)).filter(Boolean).join(' ');
            }
            return cell?.text ?? runsToPlain(cell?.runs);
          }).join(' \t '))
          .join('\n');
      }
      if (typeof block?.text === 'string' && block.text) return block.text;
      return runsToPlain(block?.runs);
    })
    .filter(Boolean)
    .join('\n\n');
}

function runsToPlain(runs) {
  if (!Array.isArray(runs)) return '';
  return runs.map(r => r?.text ?? '').join('');
}

export function monumentiToBody(monumenti) {
  if (!Array.isArray(monumenti) || monumenti.length === 0) return [];

  const cell = (text, header = false) => ({
    runs: [{ text: text || '' }],
    text: text || '',
    header,
  });

  const headerRow = [
    cell('Nome', true),
    cell('Percorso', true),
    cell('Valutazione', true),
    cell('Dettagli (visitabilità / coordinate / zona / periodo)', true),
  ];

  const rows = monumenti.map(m => ([
    cell(m.nome),
    cell(m.percorso),
    cell(m.valutazione),
    cell(m.visitabilita),
  ]));

  return [{ type: 'table', rows: [headerRow, ...rows] }];
}
