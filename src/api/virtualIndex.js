import { fetchTreeRecursive, fetchBlobJson } from './github.js';

const CACHE_PREFIX = 'cancelliere:vindex:';

function cacheKey(cfg) {
  return `${CACHE_PREFIX}${cfg.owner}/${cfg.repo}@${cfg.branch}/${cfg.folder}`;
}

function loadCache(cfg) {
  try {
    const raw = localStorage.getItem(cacheKey(cfg));
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveCache(cfg, cache) {
  try {
    localStorage.setItem(cacheKey(cfg), JSON.stringify(cache));
  } catch (_) {
  }
}

function slugFromPath(path) {
  const name = path.split('/').pop();
  return name.toLowerCase().endsWith('.json') ? name.slice(0, -5) : name;
}

function metaFromDoc(path, doc) {
  const slug = doc?.slug || slugFromPath(path);
  return {
    slug,
    title: doc?.title || slug,
    summary: doc?.summary || '',
    word_count: doc?.word_count || 0,
    category: doc?.category || '',
    category_name: doc?.category_name || '',
  };
}

async function fetchWithConcurrency(items, worker, concurrency, onProgress) {
  let cursor = 0;
  let done = 0;
  const total = items.length;

  async function run() {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
      done++;
      if (onProgress) onProgress(done, total);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, run);
  await Promise.all(runners);
}

export async function buildVirtualIndex(cfg, { forceRefresh = false, onProgress } = {}) {
  const { entries } = await fetchTreeRecursive(cfg, cfg.folder, { forceRefresh });
  const cache = loadCache(cfg);
  const nextCache = {};
  const toFetch = [];

  entries.forEach(entry => {
    const cached = cache[entry.path];
    if (cached && cached.sha === entry.sha) {
      nextCache[entry.path] = cached;
    } else {
      toFetch.push(entry);
    }
  });

  await fetchWithConcurrency(toFetch, async entry => {
    try {
      const doc = await fetchBlobJson(cfg, entry.sha);
      nextCache[entry.path] = { sha: entry.sha, ...metaFromDoc(entry.path, doc) };
    } catch (_) {
      nextCache[entry.path] = { sha: entry.sha, ...metaFromDoc(entry.path, null) };
    }
  }, 12, onProgress);

  saveCache(cfg, nextCache);
  return indexFromCache(nextCache);
}

function indexFromCache(cache) {
  const bySlug = new Map();
  Object.entries(cache).forEach(([path, item]) => {
    const slug = item.category || '';
    const name = item.category_name || (slug || 'Senza categoria');
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, name, articles: [] });
    bySlug.get(slug).articles.push({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      category: item.category,
      word_count: item.word_count,
      _path: path,
    });
  });

  const categories = Array.from(bySlug.values());
  categories.forEach(c => c.articles.sort((a, b) => (a.title || '').localeCompare(b.title || '')));
  categories.sort((a, b) => a.name.localeCompare(b.name));
  return categories;
}

export function updateVirtualIndexEntry(cfg, path, sha, meta) {
  const cache = loadCache(cfg);
  cache[path] = { sha, ...meta };
  saveCache(cfg, cache);
}

export function renameVirtualIndexEntry(cfg, oldPath, newPath, sha, meta) {
  const cache = loadCache(cfg);
  delete cache[oldPath];
  cache[newPath] = { sha, ...meta };
  saveCache(cfg, cache);
}

export function removeVirtualIndexEntry(cfg, path) {
  const cache = loadCache(cfg);
  delete cache[path];
  saveCache(cfg, cache);
}
