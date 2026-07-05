import JSZip from 'jszip';
import { escapeXml } from '../ui/helpers.js';

/**
 * converts the content of a contenteditable surface into a .docx Uint8Array.
 */
export async function buildDocx(surface) {
  const bodyXml = nodesToDocxXml(surface.childNodes);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="27"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:creator>Editor docx</dc:creator>
</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Editor docx</Application>
</Properties>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rootRels);
  const wordFolder = zip.folder('word');
  wordFolder.file('document.xml', documentXml);
  wordFolder.file('styles.xml', styles);
  wordFolder.folder('_rels').file('document.xml.rels', docRels);
  const propsFolder = zip.folder('docProps');
  propsFolder.file('core.xml', core);
  propsFolder.file('app.xml', appXml);

  return zip.generateAsync({ type: 'uint8array' });
}

// xml serializations
function nodesToDocxXml(nodes) {
  let xml = '';
  let sawBlock = false;
  nodes.forEach(node => {
    const out = blockNodeToXml(node);
    if (out !== null) { xml += out; sawBlock = true; }
  });
  return sawBlock ? xml : '<w:p/>';
}

function blockNodeToXml(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.textContent.trim()) return null;
    return paragraphXml(runsFromInline(node, {}));
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();

  if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
    const styleMap = { h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', h4: 'Heading3' };
    return paragraphXml(runsFromInline(node, {}), styleMap[tag]);
  }
  if (tag === 'p' || tag === 'div') return paragraphXml(runsFromInline(node, {}));
  if (tag === 'ul' || tag === 'ol') {
    let out = '';
    let counter = 1;
    Array.from(node.children).forEach(li => {
      if (li.tagName.toLowerCase() !== 'li') return;
      const prefix = tag === 'ol' ? `${counter++}. ` : '\u2022  ';
      out += paragraphXml(
        [{ text: prefix, bold: false, italic: false, underline: false }, ...runsFromInline(li, {})],
        'ListParagraph',
      );
    });
    return out;
  }
  if (tag === 'br') return null;
  if (['blockquote', 'section', 'article'].includes(tag)) return nodesToDocxXml(node.childNodes);
  if (node.textContent.trim()) return paragraphXml(runsFromInline(node, {}));
  return null;
}

function runsFromInline(node, fmt) {
  let runs = [];
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent === '') return;
      runs.push({ ...fmt, text: child.textContent });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        runs.push({ text: '\n', bold: !!fmt.bold, italic: !!fmt.italic, underline: !!fmt.underline });
        return;
      }
      const newFmt = { ...fmt };
      if (tag === 'strong' || tag === 'b') newFmt.bold = true;
      if (tag === 'em'     || tag === 'i') newFmt.italic = true;
      if (tag === 'u') newFmt.underline = true;
      runs = runs.concat(runsFromInline(child, newFmt));
    }
  });
  return runs;
}

function paragraphXml(runs, styleId) {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : '';
  if (!runs?.length) return `<w:p>${pPr}</w:p>`;
  let runsXml = '';
  runs.forEach(r => {
    if (r.text === undefined) return;
    String(r.text).split('\n').forEach((part, idx) => {
      if (idx > 0) runsXml += '<w:br/>';
      if (!part) return;
      runsXml += `<w:r>${runPropsXml(r)}<w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`;
    });
  });
  return runsXml ? `<w:p>${pPr}${runsXml}</w:p>` : `<w:p>${pPr}</w:p>`;
}

function runPropsXml(r) {
  let props = '';
  if (r.bold)      props += '<w:b/>';
  if (r.italic)    props += '<w:i/>';
  if (r.underline) props += '<w:u w:val="single"/>';
  return props ? `<w:rPr>${props}</w:rPr>` : '';
}
