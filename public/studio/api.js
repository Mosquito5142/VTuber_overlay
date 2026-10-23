async function request(method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errors = data.errors ?? [`เกิดข้อผิดพลาด (${res.status})`];
    const error = new Error(errors.join('\n'));
    error.errors = errors;
    throw error;
  }
  return data;
}

const json = (method, url, value) => request(method, url, JSON.stringify(value), { 'Content-Type': 'application/json' });
const avatarUrl = (name) => `/api/avatars/${encodeURIComponent(name)}`;

export const api = {
  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (settings) => json('PUT', '/api/settings', settings),
  listAvatars: () => request('GET', '/api/avatars'),
  createAvatar: (name) => json('POST', '/api/avatars', { name }),
  saveConfig: (name, config) => json('PUT', `${avatarUrl(name)}/config`, config),
  uploadFrame: (name, expression, frame, file) => request('PUT', `${avatarUrl(name)}/images/${encodeURIComponent(expression)}/${frame}`, file, { 'Content-Type': 'image/png' }),
};
