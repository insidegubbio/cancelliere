const CONFIG_KEY = 'github-config';

export async function loadConfig() {
  try {
    const res = await window.storage.get(CONFIG_KEY, false);
    if (res?.value) return JSON.parse(res.value);
  } catch (_) {}
  return null;
}

export async function saveConfig(cfg) {
  await window.storage.set(CONFIG_KEY, JSON.stringify(cfg), false);
}

export async function clearConfig() {
  try { await window.storage.delete(CONFIG_KEY, false); } catch (_) {}
}
