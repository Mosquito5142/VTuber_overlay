import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { BUILTIN_ACTIONS, DEFAULT_PORT } from '../public/shared/constants.js';
import {
  ConfigError, buildBindings, createAvatar, defaultAvatarConfig, listAvatars, loadAvatar, loadSettings,
  saveAvatarConfig, saveFrame, saveSettings, scanFrames,
} from './config.js';
import { createHotkeys } from './hotkeys.js';
import { readBody, redirect, sendJson, serveFile } from './http-util.js';
import { createState } from './state.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const MAX_JSON_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const CONFIG_ROUTE = /^\/api\/avatars\/([^/]+)\/config$/;
const IMAGE_ROUTE = /^\/api\/avatars\/([^/]+)\/images\/([^/]+)\/([^/]+)$/;

export async function startServer({ root = PROJECT_ROOT, port = DEFAULT_PORT, host = '127.0.0.1', hotkeys = true, log = console.log } = {}) {
  const avatarsDir = path.join(root, 'avatars');
  const settingsFile = path.join(root, 'settings.json');
  const state = createState();
  const loadedSettings = await loadSettings(settingsFile);
  let settings = loadedSettings.settings;
  const settingsWarnings = loadedSettings.warnings;
  let avatarWarnings = [];
  let current = { name: null, config: null, files: {}, imageRev: 0 };
  let bindings = new Map();
  let hotkeyStatus = { ok: false, error: 'ปิดปุ่มลัด global อยู่' };
  let actualPort = port;
  const clients = new Set();

  const isAllowedOrigin = (origin) => !origin || origin === `http://127.0.0.1:${actualPort}` || origin === `http://localhost:${actualPort}`;

  function send(ws, message) {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  function broadcast(message, role) {
    for (const client of clients) if (!role || client.role === role) send(client.ws, message);
  }

  const configMessage = () => ({ type: 'config', avatar: current.name, config: current.config, files: current.files, imageRev: current.imageRev });

  function statusMessage() {
    const warnings = [...settingsWarnings, ...avatarWarnings];
    if (!current.name) warnings.push('ยังไม่มีตัวละคร กด "＋ ตัวละครใหม่" ในหน้าควบคุม');
    else if (!current.files.default?.includes('idle')) warnings.push('ยังไม่มีรูป default / เงียบ (idle.png) ตัวละครจะไม่แสดงจนกว่าจะอัปโหลด');
    const avatars = [...clients].filter((c) => c.role === 'avatar').length;
    return { type: 'status', hotkeys: hotkeyStatus, avatars, warnings };
  }

  const pushStatus = () => broadcast(statusMessage(), 'studio');

  function applyConfig(config) {
    current.config = config;
    bindings = buildBindings(config);
  }

  async function activate(name) {
    avatarWarnings = [];
    let loaded;
    try {
      loaded = await loadAvatar(avatarsDir, name);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      // ไฟล์ตั้งค่าเสีย: ยังแสดงรูปได้ แต่ไม่มีสีหน้า/ปุ่มลัดจนกว่าจะบันทึกใหม่
      avatarWarnings = error.errors.map((e) => `${name}: ${e}`);
      loaded = { config: defaultAvatarConfig(name), files: await scanFrames(path.join(avatarsDir, name)) };
    }
    current = { name, config: null, files: loaded.files, imageRev: current.imageRev + 1 };
    applyConfig(loaded.config);
    state.setAvatar(name, loaded.config);
    broadcast(configMessage());
    pushStatus();
  }

  function handleCombo(combo) {
    const binding = bindings.get(combo);
    if (!binding) return;
    if (binding.type === 'expression') state.triggerExpression(binding.name);
    else broadcast({ type: 'play', action: binding.name });
  }

  state.onChange((snapshot) => broadcast({ type: 'state', ...snapshot }));

  async function readJsonBody(req) {
    return JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString('utf8'));
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'GET') {
      if (pathname === '/') return redirect(res, 302, '/studio/');
      if (pathname === '/studio' || pathname === '/avatar') return redirect(res, 301, `${pathname}/`);
      if (pathname === '/api/avatars') return sendJson(res, 200, { avatars: await listAvatars(avatarsDir), active: current.name });
      if (pathname === '/api/avatar') return sendJson(res, 200, configMessage());
      if (pathname === '/api/settings') return sendJson(res, 200, settings);
      const served = pathname.startsWith('/avatars/')
        ? await serveFile(res, avatarsDir, pathname.slice('/avatars/'.length))
        : await serveFile(res, PUBLIC_DIR, pathname.slice(1));
      if (!served) sendJson(res, 404, { errors: ['ไม่พบ'] });
      return undefined;
    }

    if (!isAllowedOrigin(req.headers.origin)) return sendJson(res, 403, { errors: ['ไม่อนุญาตให้เว็บอื่นแก้ค่า'] });

    if (req.method === 'POST' && pathname === '/api/avatars') {
      const body = await readJsonBody(req);
      await createAvatar(avatarsDir, body?.name);
      return sendJson(res, 201, { avatars: await listAvatars(avatarsDir) });
    }

    if (req.method === 'PUT' && pathname === '/api/settings') {
      const body = await readJsonBody(req);
      const wanted = body?.activeAvatar ?? null;
      if (wanted !== null && !(await listAvatars(avatarsDir)).includes(wanted)) throw new ConfigError([`ไม่พบตัวละคร ${wanted}`]);
      settings = await saveSettings(settingsFile, body);
      if (settings.activeAvatar && settings.activeAvatar !== current.name) await activate(settings.activeAvatar);
      return sendJson(res, 200, settings);
    }

    const configMatch = req.method === 'PUT' && pathname.match(CONFIG_ROUTE);
    if (configMatch) {
      const name = configMatch[1];
      const saved = await saveAvatarConfig(avatarsDir, name, await readJsonBody(req));
      if (name === current.name) {
        applyConfig(saved);
        avatarWarnings = [];
        state.updateExpressions(saved);
        broadcast(configMessage());
        pushStatus();
      }
      return sendJson(res, 200, saved);
    }

    const imageMatch = req.method === 'PUT' && pathname.match(IMAGE_ROUTE);
    if (imageMatch) {
      const [, name, expression, frame] = imageMatch;
      await saveFrame(avatarsDir, name, expression, frame, await readBody(req, MAX_IMAGE_BYTES));
      if (name === current.name) {
        current.files = await scanFrames(path.join(avatarsDir, name));
        current.imageRev += 1;
        broadcast(configMessage());
        pushStatus();
      }
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { errors: ['ไม่พบ'] });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) return;
      if (error instanceof ConfigError) sendJson(res, 400, { errors: error.errors });
      else if (error.code === 'TOO_LARGE') sendJson(res, 413, { errors: ['ไฟล์ใหญ่เกินไป (สูงสุด 10 MB)'] });
      else if (error instanceof SyntaxError || error instanceof URIError) sendJson(res, 400, { errors: ['ข้อมูลที่ส่งมาไม่ถูกต้อง'] });
      else {
        log(error);
        sendJson(res, 500, { errors: ['เกิดข้อผิดพลาดใน server ดูรายละเอียดในหน้าต่างสีดำ'] });
      }
    });
  });

  function handleMessage(client, message) {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'hello') {
      if (message.role !== 'studio' && message.role !== 'avatar') return;
      client.role = message.role;
      send(client.ws, configMessage());
      send(client.ws, { type: 'state', ...state.snapshot() });
      pushStatus();
      return;
    }
    if (client.role !== 'studio') return;
    if (message.type === 'voice') state.setTalking(message.talking === true);
    else if (message.type === 'expression' && typeof message.name === 'string') state.triggerExpression(message.name);
    else if (message.type === 'action' && BUILTIN_ACTIONS.includes(message.name)) broadcast({ type: 'play', action: message.name });
  }

  function onConnection(ws) {
    const client = { ws, role: null };
    clients.add(client);
    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      handleMessage(client, message);
    });
    ws.on('close', () => {
      clients.delete(client);
      // หน้าควบคุมปิดหมด = ไม่มีใครฟังไมค์ ให้หุบปากไว้
      if (client.role === 'studio' && ![...clients].some((c) => c.role === 'studio')) state.setTalking(false);
      if (client.role === 'avatar') pushStatus();
    });
  }

  const names = await listAvatars(avatarsDir);
  const initial = names.includes(settings.activeAvatar) ? settings.activeAvatar : names[0];
  if (initial) await activate(initial);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  actualPort = server.address().port;

  // สร้างหลัง listen สำเร็จเท่านั้น: ws ส่งต่อ 'error' ของ http server ไปที่ wss
  // ถ้าสร้างก่อนแล้วพอร์ตชน จะกลายเป็น error ที่ไม่มีใครรับและโปรแกรมล่ม
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, verifyClient: ({ origin }) => isAllowedOrigin(origin) });
  wss.on('connection', onConnection);

  let hotkeyHandle = null;
  if (hotkeys) {
    hotkeyHandle = createHotkeys({ onCombo: handleCombo });
    hotkeyStatus = await hotkeyHandle.start();
    if (!hotkeyStatus.ok) log(hotkeyStatus.error);
  }

  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    state,
    async close() {
      hotkeyHandle?.stop();
      state.dispose();
      for (const client of clients) client.ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
