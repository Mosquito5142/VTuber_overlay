import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/server.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'avata-server-'));
  const charDir = path.join(root, 'avatars', 'test-char');
  await mkdir(path.join(charDir, 'default'), { recursive: true });
  await writeFile(path.join(charDir, 'default', 'idle.png'), PNG);
  await writeFile(path.join(root, 'secret.txt'), 'top secret');
  await writeFile(path.join(charDir, 'avatar.json'), JSON.stringify({
    version: 1, name: 'test-char', expressions: { happy: { key: 'F1', mode: 'toggle' } }, actions: {}, motion: {},
  }));
  const server = await startServer({ root, port: 0, hotkeys: false, log: () => {} });
  return {
    root,
    server,
    async teardown() {
      await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function connect(baseUrl, role) {
  const ws = new WebSocket(`${baseUrl.replace('http://', 'ws://')}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  const client = {
    waitFor(match, ms = 2000) {
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), ms);
        waiters.push({ match, resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
      });
    },
    clear() { inbox.length = 0; },
    send(msg) { ws.send(JSON.stringify(msg)); },
    close() { ws.close(); },
  };
  return new Promise((resolve, reject) => {
    ws.once('open', () => { client.send({ type: 'hello', role }); resolve(client); });
    ws.once('error', reject);
  });
}

function request(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* ไม่ใช่ JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const jsonBody = (value) => ({ body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } });
const isState = (match) => (m) => m.type === 'state' && Object.entries(match).every(([k, v]) => m[k] === v);

test('avatar page gets config and state after hello', async () => {
  const ctx = await setup();
  try {
    const avatar = await connect(ctx.server.url, 'avatar');
    const config = await avatar.waitFor((m) => m.type === 'config');
    assert.equal(config.avatar, 'test-char');
    assert.deepEqual(config.files, { default: ['idle'] });
    await avatar.waitFor(isState({ expression: 'default', talking: false }));
    avatar.close();
  } finally {
    await ctx.teardown();
  }
});

test('studio voice and expression reach the avatar; studio leaving closes the mouth', async () => {
  const ctx = await setup();
  try {
    const avatar = await connect(ctx.server.url, 'avatar');
    await avatar.waitFor((m) => m.type === 'state');
    const studio = await connect(ctx.server.url, 'studio');
    await studio.waitFor((m) => m.type === 'state');
    avatar.clear();

    studio.send({ type: 'voice', level: 0.5, talking: true });
    await avatar.waitFor(isState({ talking: true }));

    studio.send({ type: 'expression', name: 'happy' });
    await avatar.waitFor(isState({ expression: 'happy' }));

    studio.send({ type: 'action', name: 'jump' });
    await avatar.waitFor((m) => m.type === 'play' && m.action === 'jump');

    avatar.clear();
    studio.close();
    await avatar.waitFor(isState({ talking: false }));
    avatar.close();
  } finally {
    await ctx.teardown();
  }
});

test('avatar pages cannot drive the state', async () => {
  const ctx = await setup();
  try {
    const avatar = await connect(ctx.server.url, 'avatar');
    await avatar.waitFor((m) => m.type === 'state');
    avatar.send({ type: 'voice', level: 1, talking: true });
    avatar.send({ type: 'expression', name: 'happy' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(ctx.server.state.snapshot().talking, false);
    assert.equal(ctx.server.state.snapshot().expression, 'default');
    avatar.close();
  } finally {
    await ctx.teardown();
  }
});

test('studio gets status with the connected avatar count and warnings', async () => {
  const ctx = await setup();
  try {
    const studio = await connect(ctx.server.url, 'studio');
    const first = await studio.waitFor((m) => m.type === 'status');
    assert.equal(first.hotkeys.ok, false);
    assert.equal(first.avatars, 0);
    const avatar = await connect(ctx.server.url, 'avatar');
    await studio.waitFor((m) => m.type === 'status' && m.avatars === 1);
    avatar.close();
    await studio.waitFor((m) => m.type === 'status' && m.avatars === 0);
    studio.close();
  } finally {
    await ctx.teardown();
  }
});

test('config API validates, saves and broadcasts', async () => {
  const ctx = await setup();
  try {
    const avatar = await connect(ctx.server.url, 'avatar');
    await avatar.waitFor((m) => m.type === 'config');
    const url = `${ctx.server.url}/api/avatars/test-char/config`;

    const bad = await request('PUT', url, jsonBody({ version: 1, expressions: { default: { mode: 'toggle' } } }));
    assert.equal(bad.status, 400);
    assert.ok(bad.json.errors.some((e) => e.includes('default')));

    const good = await request('PUT', url, jsonBody({ version: 1, expressions: { angry: { key: 'f2', mode: 'toggle' } } }));
    assert.equal(good.status, 200);
    assert.equal(good.json.expressions.angry.key, 'F2');
    const pushed = await avatar.waitFor((m) => m.type === 'config' && m.config.expressions.angry);
    assert.equal(pushed.avatar, 'test-char');
    const onDisk = JSON.parse(await readFile(path.join(ctx.root, 'avatars', 'test-char', 'avatar.json'), 'utf8'));
    assert.deepEqual(Object.keys(onDisk.expressions), ['angry']);
    avatar.close();
  } finally {
    await ctx.teardown();
  }
});

test('image upload accepts PNG only and bumps imageRev', async () => {
  const ctx = await setup();
  try {
    const avatar = await connect(ctx.server.url, 'avatar');
    const before = await avatar.waitFor((m) => m.type === 'config');
    const url = `${ctx.server.url}/api/avatars/test-char/images/default/talk`;

    const bad = await request('PUT', url, { body: 'hello', headers: { 'Content-Type': 'image/png' } });
    assert.equal(bad.status, 400);

    const good = await request('PUT', url, { body: PNG, headers: { 'Content-Type': 'image/png' } });
    assert.equal(good.status, 200);
    const after = await avatar.waitFor((m) => m.type === 'config' && m.files.default.includes('talk'));
    assert.ok(after.imageRev > before.imageRev);

    const served = await request('GET', `${ctx.server.url}/avatars/test-char/default/talk.png`);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    avatar.close();
  } finally {
    await ctx.teardown();
  }
});

test('creating and switching avatars via the API', async () => {
  const ctx = await setup();
  try {
    const created = await request('POST', `${ctx.server.url}/api/avatars`, jsonBody({ name: 'second' }));
    assert.equal(created.status, 201);
    assert.deepEqual(created.json.avatars, ['second', 'test-char']);

    const dup = await request('POST', `${ctx.server.url}/api/avatars`, jsonBody({ name: 'second' }));
    assert.equal(dup.status, 400);

    const avatar = await connect(ctx.server.url, 'avatar');
    await avatar.waitFor((m) => m.type === 'config');
    const switched = await request('PUT', `${ctx.server.url}/api/settings`, jsonBody({ activeAvatar: 'second' }));
    assert.equal(switched.status, 200);
    await avatar.waitFor((m) => m.type === 'config' && m.avatar === 'second');

    const missing = await request('PUT', `${ctx.server.url}/api/settings`, jsonBody({ activeAvatar: 'ghost' }));
    assert.equal(missing.status, 400);

    const list = await request('GET', `${ctx.server.url}/api/avatars`);
    assert.equal(list.json.active, 'second');
    avatar.close();
  } finally {
    await ctx.teardown();
  }
});

test('rejects writes from other websites and serves pages', async () => {
  const ctx = await setup();
  try {
    const foreign = await request('PUT', `${ctx.server.url}/api/settings`, {
      ...jsonBody({ activeAvatar: null }), headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    });
    assert.equal(foreign.status, 403);

    const root = await request('GET', `${ctx.server.url}/`);
    assert.equal(root.status, 302);
    assert.equal(root.headers.location, '/studio/');

    for (const escape of ['..%2Fsecret.txt', '..%5Csecret.txt']) {
      const traversal = await request('GET', `${ctx.server.url}/avatars/${escape}`);
      assert.equal(traversal.status, 404, escape);
    }

    const badJson = await request('PUT', `${ctx.server.url}/api/settings`, { body: '{nope', headers: { 'Content-Type': 'application/json' } });
    assert.equal(badJson.status, 400);
  } finally {
    await ctx.teardown();
  }
});

test('oversized JSON body gets 413 instead of a connection reset', async () => {
  const ctx = await setup();
  try {
    const big = JSON.stringify({ activeAvatar: null, pad: 'x'.repeat(70 * 1024) });
    const res = await request('PUT', `${ctx.server.url}/api/settings`, { body: big, headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 413);
    assert.ok(Array.isArray(res.json.errors));
  } finally {
    await ctx.teardown();
  }
});

test('websocket upgrade from a foreign origin is rejected', async () => {
  const ctx = await setup();
  try {
    const ws = new WebSocket(`${ctx.server.url.replace('http://', 'ws://')}/ws`, { origin: 'http://evil.example' });
    let opened = false;
    ws.on('open', () => { opened = true; });
    const status = await new Promise((resolve, reject) => {
      ws.once('unexpected-response', (req, res) => { res.resume(); resolve(res.statusCode); });
      ws.once('error', reject);
    });
    assert.equal(status, 401); // ws ตอบ 401 เมื่อ verifyClient ปฏิเสธ
    assert.equal(opened, false);
  } finally {
    await ctx.teardown();
  }
});

test('a second server on the same port fails with EADDRINUSE', async () => {
  const ctx = await setup();
  try {
    await assert.rejects(
      startServer({ root: ctx.root, port: ctx.server.port, hotkeys: false, log: () => {} }),
      (error) => error.code === 'EADDRINUSE',
    );
  } finally {
    await ctx.teardown();
  }
});

test('an oversized websocket frame does not crash the server', async () => {
  const ctx = await setup();
  try {
    const studio = await connect(ctx.server.url, 'studio');
    await studio.waitFor((m) => m.type === 'state');
    studio.send({ type: 'voice', pad: 'x'.repeat(20 * 1024) });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const res = await fetch(`${ctx.server.url}/api/avatar`);
    assert.equal(res.status, 200);
    const again = await connect(ctx.server.url, 'studio');
    await again.waitFor((m) => m.type === 'state');
    again.close();
  } finally {
    await ctx.teardown();
  }
});

test('mouth closes when voice messages stop while talking', async () => {
  const ctx = await setup();
  try {
    const avatar = await connect(ctx.server.url, 'avatar');
    await avatar.waitFor((m) => m.type === 'state');
    const studio = await connect(ctx.server.url, 'studio');
    await studio.waitFor((m) => m.type === 'state');
    avatar.clear();
    studio.send({ type: 'voice', level: 0.5, talking: true });
    await avatar.waitFor(isState({ talking: true }));
    await avatar.waitFor(isState({ talking: false }), 1500);
    studio.close();
    avatar.close();
  } finally {
    await ctx.teardown();
  }
});
