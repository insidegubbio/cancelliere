/**
 * All GitHub REST API interactions.
 */

function ghHeaders(token) {
  return {
    'Authorization': 'token ' + token,
    'Accept': 'application/vnd.github+json',
  };
}

function apiBase(cfg) {
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function errorMessage(status, body) {
  const msg = body?.message ?? '';
  if (status === 401) return 'Token non valido o scaduto. Controlla il Personal Access Token.';
  if (status === 404) return `Repository o cartella non trovati (o il token non ha accesso). Dettaglio: ${msg}`;
  if (status === 403) return `Accesso negato dal token. Verifica i permessi (Contents: Read and write). Dettaglio: ${msg}`;
  return `Errore GitHub (${status}): ${msg}`;
}

async function safeJson(res) {
  try { return await res.json(); } catch (_) { return null; }
}

// we do all in lowercase
function normalizeCommitMessage(msg) {
  return (msg ?? '').toString().toLowerCase();
}

/**
 * All write operations (create/update/delete/rename) are funneled through this
 * queue so that at most one mutating request is in flight at any time.
 */
let writeQueue = Promise.resolve();
function enqueueWrite(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(() => {}, () => {});
  return run;
}

// list folder contents
export async function listFolder(cfg, folderPath) {
  const url = `${apiBase(cfg)}/contents/${encodePath(folderPath)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: ghHeaders(cfg.token) });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : [];
  return {
    dirs:  list.filter(f => f.type === 'dir').sort((a, b) => a.name.localeCompare(b.name)),
    files: list.filter(f => f.type === 'file' && f.name.toLowerCase().endsWith('.docx'))
               .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// fetch files raw bytes
export async function fetchFile(cfg, path) {
  const url = `${apiBase(cfg)}/contents/${encodePath(path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: ghHeaders(cfg.token) });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  const data = await res.json();
  let base64 = data.content;

  if (!base64 && data.sha) {
    const blobRes = await fetch(`${apiBase(cfg)}/git/blobs/${data.sha}`, { headers: ghHeaders(cfg.token) });
    if (!blobRes.ok) throw new Error('Impossibile leggere il contenuto del file (file troppo grande?).');
    const blobData = await blobRes.json();
    base64 = blobData.content;
  }

  return { bytes: base64ToBytes(base64), sha: data.sha };
}

// create/update file on github
export function putFile(cfg, path, base64Content, commitMessage, sha) {
  return enqueueWrite(async () => {
    const body = { message: normalizeCommitMessage(commitMessage), content: base64Content, branch: cfg.branch };
    if (sha) body.sha = sha;

    const res = await fetch(`${apiBase(cfg)}/contents/${encodePath(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ghHeaders(cfg.token) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await safeJson(res);
      throw new Error(errorMessage(res.status, errBody));
    }
    const data = await res.json();
    invalidateHeadCache(cfg);
    return data;
  });
}

/**
 * Delete a file on GitHub.
 */
export function deleteFile(cfg, path, sha, commitMessage) {
  return enqueueWrite(async () => {
    const res = await fetch(`${apiBase(cfg)}/contents/${encodePath(path)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...ghHeaders(cfg.token) },
      body: JSON.stringify({ message: normalizeCommitMessage(commitMessage), sha, branch: cfg.branch }),
    });
    if (!res.ok) {
      const errBody = await safeJson(res);
      throw new Error(errorMessage(res.status, errBody));
    }
    invalidateHeadCache(cfg);
  });
}

// --- Git Data API helpers, used to build a single-commit rename ---

const HEAD_CACHE_TTL_MS = 15000;
const headCache = new Map();
function repoKey(cfg) { return `${cfg.owner}/${cfg.repo}@${cfg.branch}`; }
function invalidateHeadCache(cfg) { headCache.delete(repoKey(cfg)); }

async function getHeadAndTree(cfg, { forceRefresh = false } = {}) {
  const key = repoKey(cfg);
  const cached = headCache.get(key);
  const cacheIsFresh = cached && (Date.now() - cached.cachedAt) < HEAD_CACHE_TTL_MS;
  if (!forceRefresh && cacheIsFresh) return cached;

  const res = await fetch(`${apiBase(cfg)}/commits/${encodeURIComponent(cfg.branch)}`, {
    headers: ghHeaders(cfg.token),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  const data = await res.json();
  const result = { headSha: data.sha, treeSha: data.commit.tree.sha, cachedAt: Date.now() };
  headCache.set(key, result);
  return result;
}

async function createBlob(cfg, base64Content) {
  const res = await fetch(`${apiBase(cfg)}/git/blobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ghHeaders(cfg.token) },
    body: JSON.stringify({ content: base64Content, encoding: 'base64' }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  return res.json();
}

async function createTree(cfg, baseTreeSha, entries) {
  const res = await fetch(`${apiBase(cfg)}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ghHeaders(cfg.token) },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  return res.json();
}

async function createCommit(cfg, message, treeSha, parentSha) {
  const res = await fetch(`${apiBase(cfg)}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ghHeaders(cfg.token) },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  return res.json();
}

async function updateRef(cfg, commitSha) {
  const res = await fetch(`${apiBase(cfg)}/git/refs/${encodeURIComponent('heads/' + cfg.branch)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...ghHeaders(cfg.token) },
    body: JSON.stringify({ sha: commitSha }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  return res.json();
}

/**
 * search for .docx files (and matching folders) by name, recursively
 */
export async function searchFiles(cfg, rootFolder, query) {
  const q = (query || '').trim().toLowerCase();
  const { treeSha } = await getHeadAndTree(cfg);
  const { tree, truncated } = await getRecursiveTree(cfg, treeSha);

  const prefix = rootFolder.endsWith('/') ? rootFolder : rootFolder + '/';
  const dirs = [];
  const files = [];

  (tree || []).forEach(entry => {
    if (entry.path !== rootFolder && !entry.path.startsWith(prefix)) return;
    const name = entry.path.split('/').pop();
    if (!name.toLowerCase().includes(q)) return;

    if (entry.type === 'tree') {
      dirs.push({ name, path: entry.path });
    } else if (entry.type === 'blob' && name.toLowerCase().endsWith('.docx')) {
      files.push({ name, path: entry.path, sha: entry.sha });
    }
  });

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return { dirs, files, truncated: !!truncated };
}

// full recursive listing of a tree
async function getRecursiveTree(cfg, treeSha) {
  const res = await fetch(`${apiBase(cfg)}/git/trees/${treeSha}?recursive=1`, {
    headers: ghHeaders(cfg.token),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  return res.json();
}

async function commitTreeChange(cfg, buildEntries, commitMessage) {
  const key = repoKey(cfg);
  const message = normalizeCommitMessage(commitMessage);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { headSha, treeSha } = await getHeadAndTree(cfg, { forceRefresh: attempt > 0 });
      const entries = await buildEntries(treeSha);
      const tree = await createTree(cfg, treeSha, entries);
      const commit = await createCommit(cfg, message, tree.sha, headSha);
      await updateRef(cfg, commit.sha);
      headCache.set(key, { headSha: commit.sha, treeSha: tree.sha, cachedAt: Date.now() });
      return commit;
    } catch (e) {
      lastErr = e;
      headCache.delete(key); // don't trust a cached value that just failed
      if (attempt < 3) await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Rename a file in a single commit, without downloading or re-uploading its content
 */
export function renameFileAtomic(cfg, oldPath, newPath, blobSha, commitMessage) {
  return enqueueWrite(async () => {
    const commit = await commitTreeChange(cfg, async () => [
      { path: newPath, mode: '100644', type: 'blob', sha: blobSha },
      { path: oldPath, mode: '100644', type: 'blob', sha: null },
    ], commitMessage);
    return { commit, sha: blobSha };
  });
}

/**
 * Rename + update a file's content in a single commit
 */
export function renameAndUpdateFileAtomic(cfg, oldPath, newPath, base64Content, commitMessage) {
  return enqueueWrite(async () => {
    const blob = await createBlob(cfg, base64Content);
    const commit = await commitTreeChange(cfg, async () => [
      { path: newPath, mode: '100644', type: 'blob', sha: blob.sha },
      { path: oldPath, mode: '100644', type: 'blob', sha: null },
    ], commitMessage);
    return { commit, sha: blob.sha };
  });
}

/**
 * Rename a folder in a single commit
 */
export function renameFolderAtomic(cfg, oldFolderPath, newFolderPath, commitMessage) {
  return enqueueWrite(async () => {
    const commit = await commitTreeChange(cfg, async (treeSha) => {
      const { tree, truncated } = await getRecursiveTree(cfg, treeSha);
      if (truncated) {
        throw new Error('La cartella contiene troppi file per essere rinominata in un\'unica operazione.');
      }

      const prefix = oldFolderPath.endsWith('/') ? oldFolderPath : oldFolderPath + '/';
      const matching = (tree || []).filter(entry => entry.type === 'blob' && entry.path.startsWith(prefix));
      if (!matching.length) {
        throw new Error('La cartella risulta vuota o non è stata trovata.');
      }

      const entries = [];
      matching.forEach(entry => {
        const suffix = entry.path.slice(prefix.length);
        entries.push({ path: `${newFolderPath}/${suffix}`, mode: entry.mode, type: 'blob', sha: entry.sha });
        entries.push({ path: entry.path, mode: entry.mode, type: 'blob', sha: null });
      });
      return entries;
    }, commitMessage);
    return { commit };
  });
}

// helpers
// create folder
export function createFolder(cfg, folderPath, commitMessage) {
  const placeholderPath = `${folderPath}/.gitkeep`;
  // empty file: base64 of ""
  return putFile(cfg, placeholderPath, '', commitMessage, null);
}

export function base64ToBytes(b64) {
  const clean = b64.replace(/\s/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
