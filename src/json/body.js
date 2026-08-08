import { escapeHtml } from '../ui/helpers.js';
const HEADING_LEVELS = [1, 2, 3];

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
    const type = block?.type;

    if (type === 'list_item') {
      const ordered = !!block.ordered;
      if (!listBuffer || listBuffer.ordered !== ordered) {
        flushList();
        listBuffer = { ordered, items: [] };
      }
      listBuffer.items.push(block.runs || []);
      return;
    }

    flushList();

    if (type === 'heading') {
      const level = HEADING_LEVELS.includes(block.level) ? block.level : 1;
      chunks.push(`<h${level}>${runsToHtml(block.runs)}</h${level}>`);
    } else if (type === 'table') {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      const rowsHtml = rows.map((row, ri) => {
        const cellsHtml = (row || []).map(cell => {
          const isHeader = cell?.header ?? (ri === 0);
          const tag = isHeader ? 'th' : 'td';
          return `<${tag}>${runsToHtml(cell?.runs)}</${tag}>`;
        }).join('');
        return `<tr>${cellsHtml}</tr>`;
      }).join('');
      chunks.push(`<table><tbody>${rowsHtml}</tbody></table>`);
    } else {
      chunks.push(`<p>${runsToHtml(block?.runs)}</p>`);
    }
  });

  flushList();
  return chunks.join('') || '<p></p>';
}

function runsToHtml(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return '';
  return runs.map(r => {
    let text = escapeHtml(r?.text ?? '').replace(/\n/g, '<br>');
    if (r?.bold) text = `<strong>${text}</strong>`;
    if (r?.italic) text = `<em>${text}</em>`;
    if (r?.underline) text = `<u>${text}</u>`;
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

function nodeToBlocks(node, body) {
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();

  if (/^h[1-4]$/.test(tag)) {
    body.push({ type: 'heading', level: Math.min(3, parseInt(tag[1], 10)), runs: runsFromInline(node, {}) });
  } else if (tag === 'ul' || tag === 'ol') {
    const ordered = tag === 'ol';
    node.querySelectorAll(':scope > li').forEach(li => {
      body.push({ type: 'list_item', ordered, runs: runsFromInline(li, {}) });
    });
  } else if (tag === 'table') {
    const rows = [];
    node.querySelectorAll('tr').forEach(tr => {
      const row = [];
      tr.querySelectorAll('th, td').forEach(cell => {
        row.push({ runs: runsFromInline(cell, {}), header: cell.tagName.toLowerCase() === 'th' });
      });
      rows.push(row);
    });
    body.push({ type: 'table', rows });
  } else if (tag === 'p' || tag === 'div') {
    body.push({ type: 'paragraph', runs: runsFromInline(node, {}) });
  } else if (node.textContent.trim()) {
    body.push({ type: 'paragraph', runs: runsFromInline(node, {}) });
  }
}

function runsFromInline(node, fmt) {
  let runs = [];
  node.childNodes.forEach(child => {
    if (child.nodeType === 3) {
      if (child.textContent) runs.push({ ...fmt, text: child.textContent });
      return;
    }
    if (child.nodeType !== 1) return;
    const t = child.tagName.toLowerCase();
    if (t === 'br') { runs.push({ ...fmt, text: '\n' }); return; }
    const newFmt = { ...fmt };
    if (t === 'strong' || t === 'b') newFmt.bold = true;
    if (t === 'em' || t === 'i') newFmt.italic = true;
    if (t === 'u') newFmt.underline = true;
    runs = runs.concat(runsFromInline(child, newFmt));
  });
  return runs;
}

export function bodyToPlainText(body) {
  if (!Array.isArray(body)) return '';
  return body
    .map(block => {
      if (block?.type === 'table') {
        return (block.rows || [])
          .map(row => (row || []).map(cell => runsToPlain(cell?.runs)).join(' \t '))
          .join('\n');
      }
      return runsToPlain(block?.runs);
    })
    .filter(Boolean)
    .join('\n\n');
}

function runsToPlain(runs) {
  if (!Array.isArray(runs)) return '';
  return runs.map(r => r?.text ?? '').join('');
}
