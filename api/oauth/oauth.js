const GITHUB_CLIENT_ID = import.meta.env.GITHUB_CLIENT_ID;
const OAUTH_CALLBACK_URL = '/api/oauth/callback';

const STATE_KEY = 'gh_oauth_state';
const DRAFT_KEY = 'gh_oauth_draft';

export function startGithubLogin(draft) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft ?? {}));
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: window.location.origin + window.location.pathname,
    scope: 'repo',
    state,
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function handleGithubCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code) return null;

  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  window.history.replaceState({}, '', url.pathname);

  if (!returnedState || returnedState !== expectedState) {
    throw new Error('Stato OAuth non valido. Riprova il login con GitHub.');
  }

  const res = await fetch(OAUTH_CALLBACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Scambio del codice OAuth con GitHub fallito.');
  }

  const draftRaw = sessionStorage.getItem(DRAFT_KEY);
  sessionStorage.removeItem(DRAFT_KEY);
  const draft = draftRaw ? JSON.parse(draftRaw) : {};

  return { token: data.access_token, draft };
}
