import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ConfigError, DEFAULT_SETTINGS, buildBindings, createAvatar, defaultAvatarConfig, listAvatars, loadAvatar,
  loadSettings, saveAvatarConfig, saveFrame, saveSettings, scanFrames, validateAvatarConfig, validateSettings,
} from '../src/config.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const valid = () => ({
  version: 1,
  name: 'my-char',
  expressions: {
    happy: { key: 'f1', mode: 'timed', seconds: 4 },
    angry: { key: 'Alt+ctrl+A', mode: 'toggle' },
  },
  actions: { jump: { key: 'F5' } },
  motion: { breathe: true, talkBounce: 8, blinkEvery: [2, 6] },
});

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'avata-config-'));
}

test('valid config is accepted and keys are normalised', () => {
  const result = validateAvatarConfig(valid());
  assert.equal(result.ok, true);
  assert.equal(result.value.expressions.happy.key, 'F1');
  assert.equal(result.value.expressions.angry.key, 'Ctrl+Alt+A');
  assert.equal(result.value.expressions.angry.seconds, undefined);
});

test('missing motion fields get defaults and null keys are allowed', () => {
  const result = validateAvatarConfig({ version: 1, name: 'a', expressions: { x: { key: null, mode: 'toggle' } } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.motion, { breathe: true, talkBounce: 8, blinkEvery: [2, 6] });
  assert.equal(result.value.expressions.x.key, null);
});

test('rejects bad configs with Thai messages', () => {
  const cases = [
    [(c) => { c.expressions.default = { mode: 'toggle' }; }, 'default'],
    [(c) => { c.expressions.angry.key = 'F1'; }, 'ซ้ำ'],
    [(c) => { c.actions.jump.key = 'F1'; }, 'ซ้ำ'],
    [(c) => { c.expressions.happy.mode = 'forever'; }, 'mode'],
    [(c) => { c.expressions.happy.seconds = 0; }, 'seconds'],
    [(c) => { c.expressions['Bad Name'] = { mode: 'toggle' }; }, 'ชื่อ'],
    [(c) => { c.actions.dance = {}; }, 'dance'],
    [(c) => { c.motion.talkBounce = 99; }, 'talkBounce'],
    [(c) => { c.motion.blinkEvery = [6, 2]; }, 'blinkEvery'],
    [(c) => { c.expressions.happy.key = 'Space'; }, 'ปุ่มลัด'],
    [(c) => { c.version = 2; }, 'version'],
  ];
  for (const [mutate, needle] of cases) {
    const input = valid();
    mutate(input);
    const result = validateAvatarConfig(input);
    assert.equal(result.ok, false, `expected failure for ${needle}`);
    assert.ok(result.errors.some((e) => e.includes(needle)), `${needle} not in ${result.errors.join(' | ')}`);
  }
});

test('validateSettings fills defaults and checks ranges', () => {
  assert.deepEqual(validateSettings({}).value, DEFAULT_SETTINGS);
  assert.equal(validateSettings({ voice: { threshold: 2 } }).ok, false);
  assert.equal(validateSettings({ activeAvatar: '../x' }).ok, false);
  assert.equal(validateSettings({ activeAvatar: 'me', voice: { releaseMs: 300 } }).value.voice.releaseMs, 300);
});

test('buildBindings maps canonical keys to expressions and actions', () => {
  const { value } = validateAvatarConfig(valid());
  const bindings = buildBindings(value);
  assert.deepEqual(bindings.get('F1'), { type: 'expression', name: 'happy' });
  assert.deepEqual(bindings.get('Ctrl+Alt+A'), { type: 'expression', name: 'angry' });
  assert.deepEqual(bindings.get('F5'), { type: 'action', name: 'jump' });
});

test('createAvatar, saveFrame, scanFrames and loadAvatar work together', async () => {
  const dir = await tempDir();
  try {
    const created = await createAvatar(dir, 'me');
    assert.deepEqual(created.config, defaultAvatarConfig('me'));
    await saveFrame(dir, 'me', 'default', 'idle', PNG);
    await saveFrame(dir, 'me', 'happy', 'talk', PNG);
    assert.deepEqual(await scanFrames(path.join(dir, 'me')), { default: ['idle'], happy: ['talk'] });
    assert.deepEqual(await listAvatars(dir), ['me']);
    const loaded = await loadAvatar(dir, 'me');
    assert.equal(loaded.config.name, 'me');
    await assert.rejects(createAvatar(dir, 'me'), ConfigError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveFrame rejects non-PNG data and bad names', async () => {
  const dir = await tempDir();
  try {
    await createAvatar(dir, 'me');
    await assert.rejects(saveFrame(dir, 'me', 'default', 'idle', Buffer.from('not a png')), ConfigError);
    await assert.rejects(saveFrame(dir, 'me', '..', 'idle', PNG), ConfigError);
    await assert.rejects(saveFrame(dir, 'me', 'default', 'smile', PNG), ConfigError);
    await assert.rejects(saveFrame(dir, 'ghost', 'default', 'idle', PNG), ConfigError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveAvatarConfig keeps the old file when the new config is invalid', async () => {
  const dir = await tempDir();
  try {
    await createAvatar(dir, 'me');
    const saved = await saveAvatarConfig(dir, 'me', valid());
    assert.equal(saved.name, 'me');
    const bad = valid();
    bad.expressions.happy.mode = 'nope';
    await assert.rejects(saveAvatarConfig(dir, 'me', bad), ConfigError);
    const onDisk = JSON.parse(await readFile(path.join(dir, 'me', 'avatar.json'), 'utf8'));
    assert.equal(onDisk.expressions.happy.mode, 'timed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadAvatar reports broken JSON and missing avatars as ConfigError', async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, 'broken'), { recursive: true });
    await writeFile(path.join(dir, 'broken', 'avatar.json'), '{ nope');
    await assert.rejects(loadAvatar(dir, 'broken'), ConfigError);
    await assert.rejects(loadAvatar(dir, 'ghost'), ConfigError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadSettings falls back to defaults with a warning', async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, 'settings.json');
    assert.deepEqual(await loadSettings(file), { settings: DEFAULT_SETTINGS, warnings: [] });
    await writeFile(file, JSON.stringify({ voice: { threshold: 5 } }));
    const loaded = await loadSettings(file);
    assert.deepEqual(loaded.settings, DEFAULT_SETTINGS);
    assert.equal(loaded.warnings.length, 1);
    const saved = await saveSettings(file, { activeAvatar: 'me', voice: { threshold: 0.2 } });
    assert.equal(saved.voice.threshold, 0.2);
    assert.deepEqual((await loadSettings(file)).settings, saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
