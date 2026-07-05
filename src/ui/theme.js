import { el } from './helpers.js';

const THEME_KEY = 'theme-pref';

export async function loadTheme() {
  try {
    const val = localStorage.getItem(THEME_KEY);
    if (val) return val;
  } catch (_) {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export async function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : '');
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function themeToggleBtn(onToggle) {
  const isDark = currentTheme() === 'dark';
  const btn = el(`
    <button class="theme-toggle" title="Cambia tema">
      <span>${isDark ? '☀️' : '🌙'}</span>
      <span>${isDark ? 'Chiaro' : 'Scuro'}</span>
    </button>
  `);
  btn.addEventListener('click', async () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    await applyTheme(next);
    onToggle();
  });
  return btn;
}
