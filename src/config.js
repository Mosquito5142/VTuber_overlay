import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_ACTIONS, FRAME_NAMES, isValidName } from '../public/shared/constants.js';
import { normalizeKey } from '../public/shared/keys.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NAME_RULE = 'ใช้ได้เฉพาะ a-z, 0-9 และ - (ไม่เกิน 32 ตัว) และห้ามใช้ชื่อที่ Windows สงวน เช่น con, nul, aux, com1';

export class ConfigError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.errors = errors;
  }
}

export const DEFAULT_SETTINGS = Object.freeze({
  activeAvatar: null,
  voice: Object.freeze({ threshold: 0.08, releaseMs: 150, deviceId: null }),
});

export function defaultAvatarConfig(name) {
  return { version: 1, name, expressions: {}, actions: {}, motion: { breathe: true, talkBounce: 8, blinkEvery: [2, 6] } };
}

const isNumber = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateAvatarConfig(input) {
  if (!isPlainObject(input)) return { ok: false, errors: ['avatar.json ต้องเป็นออบเจกต์ JSON'] };
  const errors = [];
  if (input.version !== 1) errors.push('version ต้องเป็น 1');
  if (!isValidName(input.name)) errors.push(`ชื่อตัวละคร${NAME_RULE}`);
  const value = { version: 1, name: input.name, expressions: {}, actions: {}, motion: {} };
  const keyOwners = new Map();

  function claimKey(raw, owner) {
    if (raw === undefined || raw === null || raw === '') return null;
    const key = normalizeKey(raw);
    if (!key) {
      errors.push(`${owner}: ปุ่มลัด "${raw}" ใช้ไม่ได้ (ใช้ F1–F24, A–Z, 0–9 และ Ctrl/Alt/Shift)`);
      return null;
    }
    if (keyOwners.has(key)) {
      errors.push(`${owner}: ปุ่ม ${key} ซ้ำกับ${keyOwners.get(key)}`);
      return null;
    }
    keyOwners.set(key, owner);
    return key;
  }

  const expressions = input.expressions ?? {};
  if (!isPlainObject(expressions)) errors.push('expressions ต้องเป็นออบเจกต์');
  else {
    for (const [name, def] of Object.entries(expressions)) {
      const owner = `สีหน้า ${name}`;
      if (name === 'default') { errors.push('ห้ามใส่ default ใน expressions เพราะเป็นสีหน้าปกติอยู่แล้ว'); continue; }
      if (!isValidName(name)) { errors.push(`${owner}: ชื่อ${NAME_RULE}`); continue; }
      if (!isPlainObject(def)) { errors.push(`${owner}: ต้องเป็นออบเจกต์`); continue; }
      if (def.mode !== 'timed' && def.mode !== 'toggle') { errors.push(`${owner}: mode ต้องเป็น timed หรือ toggle`); continue; }
      const out = { key: claimKey(def.key, owner), mode: def.mode };
      if (def.mode === 'timed') {
        if (!isNumber(def.seconds, 0.5, 60)) errors.push(`${owner}: seconds ต้องอยู่ระหว่าง 0.5–60`);
        out.seconds = def.seconds;
      }
      value.expressions[name] = out;
    }
  }

  const actions = input.actions ?? {};
  if (!isPlainObject(actions)) errors.push('actions ต้องเป็นออบเจกต์');
  else {
    for (const [name, def] of Object.entries(actions)) {
      const owner = `ท่า ${name}`;
      if (!BUILTIN_ACTIONS.includes(name)) { errors.push(`${owner}: ไม่มีท่านี้ (มี ${BUILTIN_ACTIONS.join(', ')})`); continue; }
      if (!isPlainObject(def)) { errors.push(`${owner}: ต้องเป็นออบเจกต์`); continue; }
      value.actions[name] = { key: claimKey(def.key, owner) };
    }
  }

  const motion = input.motion ?? {};
  if (!isPlainObject(motion)) errors.push('motion ต้องเป็นออบเจกต์');
  else {
    const defaults = defaultAvatarConfig('x').motion;
    const breathe = motion.breathe ?? defaults.breathe;
    const talkBounce = motion.talkBounce ?? defaults.talkBounce;
    const blinkEvery = motion.blinkEvery ?? defaults.blinkEvery;
    if (typeof breathe !== 'boolean') errors.push('motion.breathe ต้องเป็น true หรือ false');
    if (!isNumber(talkBounce, 0, 40)) errors.push('motion.talkBounce ต้องอยู่ระหว่าง 0–40');
    const blinkOk = Array.isArray(blinkEvery) && blinkEvery.length === 2
      && isNumber(blinkEvery[0], 0.5, 30) && isNumber(blinkEvery[1], 0.5, 30) && blinkEvery[0] <= blinkEvery[1];
    if (!blinkOk) errors.push('motion.blinkEvery ต้องเป็น [ต่ำสุด, สูงสุด] วินาที อยู่ระหว่าง 0.5–30');
    value.motion = { breathe, talkBounce, blinkEvery: blinkOk ? [...blinkEvery] : blinkEvery };
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function validateSettings(input) {
  if (!isPlainObject(input)) return { ok: false, errors: ['settings.json ต้องเป็นออบเจกต์ JSON'] };
  const errors = [];
  const activeAvatar = input.activeAvatar ?? null;
  if (activeAvatar !== null && !isValidName(activeAvatar)) errors.push('activeAvatar ไม่ถูกต้อง');
  const voice = isPlainObject(input.voice) ? input.voice : {};
  const threshold = voice.threshold ?? DEFAULT_SETTINGS.voice.threshold;
  const releaseMs = voice.releaseMs ?? DEFAULT_SETTINGS.voice.releaseMs;
  const deviceId = voice.deviceId ?? null;
  if (!isNumber(threshold, 0, 1)) errors.push('voice.threshold ต้องอยู่ระหว่าง 0–1');
  if (!isNumber(releaseMs, 0, 2000)) errors.push('voice.releaseMs ต้องอยู่ระหว่าง 0–2000');
  if (deviceId !== null && typeof deviceId !== 'string') errors.push('voice.deviceId ต้องเป็นข้อความ');
  return errors.length ? { ok: false, errors } : { ok: true, value: { activeAvatar, voice: { threshold, releaseMs, deviceId } } };
}

export function buildBindings(config) {
  const bindings = new Map();
  for (const [name, def] of Object.entries(config.expressions)) if (def.key) bindings.set(def.key, { type: 'expression', name });
  for (const [name, def] of Object.entries(config.actions)) if (def.key) bindings.set(def.key, { type: 'action', name });
  return bindings;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeJsonAtomic(file, data) {
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temp, file);
}

function checkName(name, label = 'ชื่อตัวละคร') {
  if (!isValidName(name)) throw new ConfigError([`${label} "${name}" ${NAME_RULE}`]);
}

async function requireAvatarDir(avatarsDir, name) {
  checkName(name);
  const dir = path.join(avatarsDir, name);
  try {
    if ((await stat(dir)).isDirectory()) return dir;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  throw new ConfigError([`ไม่พบตัวละคร ${name}`]);
}

export async function listAvatars(avatarsDir) {
  try {
    const entries = await readdir(avatarsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && isValidName(e.name)).map((e) => e.name).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function scanFrames(avatarDir) {
  const files = {};
  let entries;
  try {
    entries = await readdir(avatarDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidName(entry.name)) continue;
    const names = await readdir(path.join(avatarDir, entry.name));
    const frames = FRAME_NAMES.filter((frame) => names.includes(`${frame}.png`));
    if (frames.length) files[entry.name] = frames;
  }
  return files;
}

export async function loadAvatar(avatarsDir, name) {
  const dir = await requireAvatarDir(avatarsDir, name);
  let raw;
  try {
    raw = await readJson(path.join(dir, 'avatar.json'));
  } catch {
    throw new ConfigError([`${name}/avatar.json ไม่ใช่ JSON ที่ถูกต้อง`]);
  }
  const result = validateAvatarConfig(isPlainObject(raw) ? { ...raw, name } : raw ?? defaultAvatarConfig(name));
  if (!result.ok) throw new ConfigError(result.errors);
  return { config: result.value, files: await scanFrames(dir) };
}

export async function createAvatar(avatarsDir, name) {
  checkName(name);
  const dir = path.join(avatarsDir, name);
  await mkdir(avatarsDir, { recursive: true });
  try {
    await mkdir(dir);
  } catch (error) {
    if (error.code === 'EEXIST') throw new ConfigError([`มีตัวละครชื่อ ${name} อยู่แล้ว`]);
    throw error;
  }
  await mkdir(path.join(dir, 'default'));
  await writeJsonAtomic(path.join(dir, 'avatar.json'), defaultAvatarConfig(name));
  return loadAvatar(avatarsDir, name);
}

export async function saveAvatarConfig(avatarsDir, name, input) {
  const dir = await requireAvatarDir(avatarsDir, name);
  const result = validateAvatarConfig(isPlainObject(input) ? { ...input, name } : input);
  if (!result.ok) throw new ConfigError(result.errors);
  await writeJsonAtomic(path.join(dir, 'avatar.json'), result.value);
  return result.value;
}

export async function saveFrame(avatarsDir, name, expression, frame, buffer) {
  checkName(expression, 'ชื่อสีหน้า');
  if (!FRAME_NAMES.includes(frame)) throw new ConfigError([`ไม่มีช่องรูป ${frame} (มี ${FRAME_NAMES.join(', ')})`]);
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ConfigError(['ไฟล์ต้องเป็น PNG']);
  }
  const dir = await requireAvatarDir(avatarsDir, name);
  await mkdir(path.join(dir, expression), { recursive: true });
  await writeFile(path.join(dir, expression, `${frame}.png`), buffer);
}

export async function loadSettings(file) {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  let raw;
  try {
    raw = await readJson(file);
  } catch {
    return { settings: defaults, warnings: ['settings.json อ่านไม่ได้ ใช้ค่าเริ่มต้นแทน'] };
  }
  if (raw === undefined) return { settings: defaults, warnings: [] };
  const result = validateSettings(raw);
  if (!result.ok) return { settings: defaults, warnings: result.errors.map((e) => `settings.json: ${e} (ใช้ค่าเริ่มต้นแทน)`) };
  return { settings: result.value, warnings: [] };
}

export async function saveSettings(file, input) {
  const result = validateSettings(input);
  if (!result.ok) throw new ConfigError(result.errors);
  await writeJsonAtomic(file, result.value);
  return result.value;
}
