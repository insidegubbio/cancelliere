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

/**
 * All write operations (create/update/delete/rename) are funneled through this
 * queue so that at most one mutating request is in flight at any time.
 * Firing several writes back-to-back (e.g. renaming two files quickly) used to
 * race against each other and against `refreshList`, occasionally producing
 * "sha wasn't supplied" errors or a file list that didn't refresh correctly.
 * Serializing them removes the race entirely.
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
    const body = { message: commitMessage, content: base64Content, branch: cfg.branch };
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
    return res.json();
  });
}

/**
 * delete a file on github.
 */
export function deleteFile(cfg, path, sha, commitMessage) {
  return enqueueWrite(async () => {
    const res = await fetch(`${apiBase(cfg)}/contents/${encodePath(path)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...ghHeaders(cfg.token) },
      body: JSON.stringify({ message: commitMessage, sha, branch: cfg.branch }),
    });
    if (!res.ok) {
      const errBody = await safeJson(res);
      throw new Error(errorMessage(res.status, errBody));
    }
  });
}

// --- Git Data API helpers, used to build a single-commit rename ---
async function getBranchRef(cfg) {
  const res = await fetch(`${apiBase(cfg)}/git/ref/${encodeURIComponent('heads/' + cfg.branch)}`, {
    headers: ghHeaders(cfg.token),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  return res.json();
}

async function getCommit(cfg, sha) {
  const res = await fetch(`${apiBase(cfg)}/git/commits/${sha}`, { headers: ghHeaders(cfg.token) });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(errorMessage(res.status, body));
  }
  return res.json();
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
 * Rename a file in a single Git commit
 */
export function renameFileAtomic(cfg, oldPath, newPath, base64Content, commitMessage) {
  return enqueueWrite(async () => {
    // small retry loop
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ref = await getBranchRef(cfg);
        const headSha = ref.object.sha;
        const headCommit = await getCommit(cfg, headSha);
        const blob = await createBlob(cfg, base64Content);

        const tree = await createTree(cfg, headCommit.tree.sha, [
          { path: newPath, mode: '100644', type: 'blob', sha: blob.sha },
          { path: oldPath, mode: '100644', type: 'blob', sha: null },
        ]);

        const commit = await createCommit(cfg, commitMessage, tree.sha, headSha);
        await updateRef(cfg, commit.sha);
        return { commit, sha: blob.sha };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  });
}

// helpers
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
