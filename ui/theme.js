import { el } from './helpers.js';

export async function loadTheme() {
  try {
    const res = await window.storage.get('theme-pref', false);
    if (res?.value) return res.value;
  } catch (_) {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export async function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : '');
  try { await window.storage.set('theme-pref', t, false); } catch (_) {}
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Returns a themed toggle button.
*/
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
