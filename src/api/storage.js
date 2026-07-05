const CONFIG_KEY = 'github-config';
const THEME_KEY  = 'theme-pref';

export async function loadConfig() {
  try {
    const val = localStorage.getItem(CONFIG_KEY);
    if (val) return JSON.parse(val);
  } catch (_) {}
  return null;
}

export async function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export async function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

export async function loadThemePref() {
  return localStorage.getItem(THEME_KEY) ?? null;
}

export async function saveThemePref(t) {
  localStorage.setItem(THEME_KEY, t);
}
