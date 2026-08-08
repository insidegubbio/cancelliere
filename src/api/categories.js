import { fetchFile } from './github.js';

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
      const { bytes } = await fetchFile(cfg, path);
      const str = new TextDecoder().decode(bytes);
      const data = JSON.parse(str);
      if (looksLikeCategoriesIndex(data)) {
        return { path, categories: data };
      }
    } catch (_) {
    }
  }
  return null;
}
