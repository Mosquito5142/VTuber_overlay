const KEY_PATTERN = /^(F([1-9]|1[0-9]|2[0-4])|[A-Z]|[0-9])$/;
const MODIFIER_ALIASES = { ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift' };

export function parseKey(text) {
  if (typeof text !== 'string') return null;
  const parts = text.split('+').map((part) => part.trim()).filter(Boolean);
  const combo = { ctrl: false, alt: false, shift: false, key: null };
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      if (combo[modifier]) return null;
      combo[modifier] = true;
      continue;
    }
    if (combo.key) return null;
    const key = part.toUpperCase();
    if (!KEY_PATTERN.test(key)) return null;
    combo.key = key;
  }
  return combo.key ? combo : null;
}

export function formatKey(combo) {
  return [combo.ctrl && 'Ctrl', combo.alt && 'Alt', combo.shift && 'Shift', combo.key].filter(Boolean).join('+');
}

export function normalizeKey(text) {
  const combo = parseKey(text);
  return combo ? formatKey(combo) : null;
}

export function keyFromBrowserEvent(event) {
  const { code } = event;
  let key = null;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  if (!key) return null;
  return formatKey({ ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, key });
}
