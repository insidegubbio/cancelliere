const CONFIG_KEY = 'github-config';
const TOKEN_KEY  = 'github-token';
const THEME_KEY  = 'theme-pref';

export async function loadConfig() {
  try {
    const val = localStorage.getItem(CONFIG_KEY);
    if (!val) return null;
    const base = JSON.parse(val);
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    return { ...base, token };
  } catch (_) {}
  return null;
}

export async function saveConfig(cfg) {
  const { token, ...rest } = cfg;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(rest));
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export async function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function loadThemePref() {
  return localStorage.getItem(THEME_KEY) ?? null;
}

export async function saveThemePref(t) {
  localStorage.setItem(THEME_KEY, t);
}
