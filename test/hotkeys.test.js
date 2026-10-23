import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildKeyNameMap, comboFromEvent, createHotkeys } from '../src/hotkeys.js';

const FakeKeys = { F1: 59, F2: 60, A: 30, H: 35, 1: 2, Ctrl: 29, Space: 57 };

function fakeModule() {
  const hook = new EventEmitter();
  hook.started = false;
  hook.start = () => { hook.started = true; };
  hook.stop = () => { hook.started = false; };
  return { uIOhook: hook, UiohookKey: FakeKeys };
}

test('buildKeyNameMap keeps only supported keys', () => {
  const map = buildKeyNameMap(FakeKeys);
  assert.equal(map.get(59), 'F1');
  assert.equal(map.get(30), 'A');
  assert.equal(map.get(2), '1');
  assert.equal(map.has(57), false);
  assert.equal(map.has(29), false);
});

test('comboFromEvent adds modifiers in canonical order', () => {
  const map = buildKeyNameMap(FakeKeys);
  assert.equal(comboFromEvent({ keycode: 35, ctrlKey: true, altKey: true, shiftKey: false }, map), 'Ctrl+Alt+H');
  assert.equal(comboFromEvent({ keycode: 57, ctrlKey: false, altKey: false, shiftKey: false }, map), null);
});

test('start hooks keydown, ignores auto-repeat until keyup, and stop unhooks', async () => {
  const mod = fakeModule();
  const combos = [];
  const hotkeys = createHotkeys({ onCombo: (c) => combos.push(c), load: async () => mod });
  assert.deepEqual(await hotkeys.start(), { ok: true });
  assert.equal(mod.uIOhook.started, true);
  const press = { keycode: 59, ctrlKey: false, altKey: false, shiftKey: false };
  mod.uIOhook.emit('keydown', press);
  mod.uIOhook.emit('keydown', press);
  mod.uIOhook.emit('keyup', press);
  mod.uIOhook.emit('keydown', press);
  assert.deepEqual(combos, ['F1', 'F1']);
  hotkeys.stop();
  assert.equal(mod.uIOhook.started, false);
});

test('start reports a Thai error instead of throwing when the module fails', async () => {
  const hotkeys = createHotkeys({ onCombo: () => {}, load: async () => { throw new Error('boom'); } });
  const result = await hotkeys.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /ปุ่มลัด global ใช้ไม่ได้: boom/);
});

test('works when the module only has a default export (CommonJS interop)', async () => {
  const mod = fakeModule();
  const hotkeys = createHotkeys({ onCombo: () => {}, load: async () => ({ default: mod }) });
  assert.deepEqual(await hotkeys.start(), { ok: true });
  hotkeys.stop();
});
