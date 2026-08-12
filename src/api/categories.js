import { fetchFile, putFileRetrying, bytesToBase64 } from './github.js';

function candidatePaths(folder) {
  const clean = (folder || '').replace(/\/+$/, '');
  const parent = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
  const bases = [clean, parent, ''].filter((v, i, arr) => arr.indexOf(v) === i);
  const names = ['categories.json', 'categories', 'category.json'];
  const paths = [];
  bases.forEach(base => {
    names.forEach(name => {
      paths.push(base ? `${base}/${name}` : name);
    });
  });
  return [...new Set(paths)];
}

function looksLikeCategoriesIndex(data) {
  return Array.isArray(data) && data.every(c => c && typeof c === 'object' && Array.isArray(c.articles));
}

export async function loadCategoriesIndex(cfg) {
  for (const path of candidatePaths(cfg.folder)) {
    try {
      const { bytes, sha } = await fetchFile(cfg, path);
      const str = new TextDecoder().decode(bytes);
      const data = JSON.parse(str);
      if (looksLikeCategoriesIndex(data)) {
        return { path, categories: data, sha };
      }
    } catch (_) {
    }
  }
  return null;
}

export async function saveCategoriesIndex(cfg, path, categories, sha, commitMessage) {
  const base64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(categories, null, 2)));
  const { data } = await putFileRetrying(cfg, path, base64, commitMessage, sha);
  return data.content.sha;
}
