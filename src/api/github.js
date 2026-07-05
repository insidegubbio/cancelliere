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
export async function putFile(cfg, path, base64Content, commitMessage, sha) {
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
}

/**
 * Delete a file on GitHub.
 */
export async function deleteFile(cfg, path, sha, commitMessage) {
  const res = await fetch(`${apiBase(cfg)}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...ghHeaders(cfg.token) },
    body: JSON.stringify({ message: commitMessage, sha, branch: cfg.branch }),
  });
  if (!res.ok) {
    const errBody = await safeJson(res);
    throw new Error(errorMessage(res.status, errBody));
  }
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
