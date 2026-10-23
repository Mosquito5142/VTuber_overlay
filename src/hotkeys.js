import { formatKey } from '../public/shared/keys.js';

export function buildKeyNameMap(UiohookKey) {
  const map = new Map();
  const names = [];
  for (let i = 1; i <= 24; i += 1) names.push(`F${i}`);
  names.push(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  for (const name of names) {
    if (UiohookKey[name] !== undefined) map.set(UiohookKey[name], name);
  }
  return map;
}

export function comboFromEvent(event, keyNames) {
  const key = keyNames.get(event.keycode);
  if (!key) return null;
  return formatKey({ ctrl: Boolean(event.ctrlKey), alt: Boolean(event.altKey), shift: Boolean(event.shiftKey), key });
}

export function createHotkeys({ onCombo, load = () => import('uiohook-napi') }) {
  let hook = null;
  const held = new Set();
  return {
    async start() {
      try {
        const loaded = await load();
        const { uIOhook, UiohookKey } = loaded.uIOhook ? loaded : loaded.default;
        const keyNames = buildKeyNameMap(UiohookKey);
        uIOhook.on('keydown', (event) => {
          // กดค้างแล้ว Windows ส่ง keydown ซ้ำ ให้นับครั้งเดียวจนกว่าจะปล่อยปุ่ม
          if (held.has(event.keycode)) return;
          held.add(event.keycode);
          const combo = comboFromEvent(event, keyNames);
          if (combo) onCombo(combo);
        });
        uIOhook.on('keyup', (event) => held.delete(event.keycode));
        uIOhook.start();
        hook = uIOhook;
        return { ok: true };
      } catch (error) {
        return { ok: false, error: `ปุ่มลัด global ใช้ไม่ได้: ${error.message}` };
      }
    },
    stop() {
      if (hook) {
        hook.stop();
        hook = null;
      }
      held.clear();
    },
  };
}
