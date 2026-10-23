import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatKey, keyFromBrowserEvent, normalizeKey, parseKey } from '../public/shared/keys.js';

test('parseKey reads function keys, letters and digits', () => {
  assert.deepEqual(parseKey('F1'), { ctrl: false, alt: false, shift: false, key: 'F1' });
  assert.deepEqual(parseKey('f24'), { ctrl: false, alt: false, shift: false, key: 'F24' });
  assert.deepEqual(parseKey('h'), { ctrl: false, alt: false, shift: false, key: 'H' });
  assert.deepEqual(parseKey('7'), { ctrl: false, alt: false, shift: false, key: '7' });
});

test('parseKey reads modifiers in any order and case', () => {
  assert.deepEqual(parseKey('alt+ctrl+h'), { ctrl: true, alt: true, shift: false, key: 'H' });
  assert.deepEqual(parseKey('Control + Shift + F5'), { ctrl: true, alt: false, shift: true, key: 'F5' });
});

test('parseKey rejects bad input', () => {
  for (const bad of ['', 'Ctrl', 'F25', 'F0', 'Ctrl+Ctrl+A', 'A+B', 'Space', 'Enter', null, 42]) {
    assert.equal(parseKey(bad), null, `expected null for ${String(bad)}`);
  }
});

test('formatKey and normalizeKey use canonical order', () => {
  assert.equal(formatKey({ ctrl: true, alt: true, shift: true, key: 'X' }), 'Ctrl+Alt+Shift+X');
  assert.equal(normalizeKey('shift+alt+x'), 'Alt+Shift+X');
  assert.equal(normalizeKey('f2'), 'F2');
  assert.equal(normalizeKey('nope'), null);
});

test('keyFromBrowserEvent maps KeyboardEvent.code', () => {
  const ev = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  assert.equal(keyFromBrowserEvent(ev('F3')), 'F3');
  assert.equal(keyFromBrowserEvent(ev('KeyA', { ctrlKey: true })), 'Ctrl+A');
  assert.equal(keyFromBrowserEvent(ev('Digit9', { altKey: true, shiftKey: true })), 'Alt+Shift+9');
  assert.equal(keyFromBrowserEvent(ev('ShiftLeft', { shiftKey: true })), null);
  assert.equal(keyFromBrowserEvent(ev('Space')), null);
});
