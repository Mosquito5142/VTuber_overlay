# Avata-Overlay PNGtuber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PNGtuber character that moves its mouth with the microphone, blinks and breathes by itself, switches expressions on global hotkeys, and shows in OBS as a transparent Browser Source.

**Architecture:** A local Node.js server (`127.0.0.1:5180`) owns all state and relays it over WebSocket. The studio page (Chrome/Edge, kept open) listens to the mic through an `AudioWorklet` and edits settings. The avatar page (OBS Browser Source) only renders. Pure logic (voice gate, frame fallback, expression state, config validation, key names) lives in small modules with unit tests.

**Tech Stack:** Node.js ≥ 18 (ESM), `ws`, `uiohook-napi`, plain HTML/CSS/JS (no build step), `node --test`.

Spec: `docs/superpowers/specs/2026-10-23-pngtuber-avatar-design.md`

## Global Constraints

- Node.js ≥ 18, `"type": "module"`, no build step, no frontend framework.
- Server listens on `127.0.0.1` only; default port **5180**; `--port` flag overrides.
- Runtime dependencies are only `ws` and `uiohook-napi`.
- All user-facing text (UI, errors, console) is Thai.
- Avatar, expression and folder names match `/^[a-z0-9][a-z0-9-]{0,31}$/`; `default` is the always-present base expression and must not appear in `expressions`.
- Frame files: `idle.png`, `talk.png`, `blink.png`, `blink-talk.png`; PNG only; 10 MB max per upload.
- Built-in actions: `jump`, `shake`, `spin`, `wobble` (CSS only).
- Tests run with `npm test` (`node --test "test/*.test.js"`).
- Do not modify anything in `../Animated-Overlay`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

```
Avata-Overlay/
  package.json
  start.bat                     one-click launcher (Windows)
  README.md                     Thai usage guide
  OBS-SETUP.md                  phase 0: OBS setup + manual checklist
  scripts/make-sample.js        draws the sample avatar PNGs (pure Node)
  src/
    cli.js                      parse args, create sample if needed, start server, open browser
    server.js                   HTTP + WebSocket hub, wires state/config/hotkeys
    http-util.js                sendJson, serveFile, readBody
    state.js                    talking / expression / timers (pure)
    config.js                   validate + load/save avatar.json, settings.json, frames
    hotkeys.js                  uiohook-napi wrapper → canonical combo strings
  public/
    shared/constants.js         FRAME_NAMES, FRAME_CHAIN, BUILTIN_ACTIONS, NAME_PATTERN, DEFAULT_PORT
    shared/keys.js              parse/format hotkey strings (server + browser)
    shared/voice-gate.js        level → talking with threshold + release (pure)
    shared/frames.js            pick a frame file with fallback (pure)
    shared/renderer.js          DOM renderer: frames, blink, breathe, bounce, actions
    shared/renderer.css
    shared/socket.js            reconnecting WebSocket client
    avatar/index.html, avatar.js           OBS page
    studio/index.html, studio.css, studio.js   control page shell, mic, status
    studio/api.js               fetch helpers
    studio/mic.js               getUserMedia + AudioWorklet
    studio/level-worklet.js     RMS on the audio thread
    studio/editor.js            avatar / images / expressions / actions / motion UI
  test/*.test.js
```

## WebSocket protocol (reference for every task)

All messages are JSON `{ "type": ... }`.

| type | direction | fields |
|---|---|---|
| `hello` | client → server | `role`: `"studio"` or `"avatar"` |
| `voice` | studio → server | `level` (0–1), `talking` (bool) |
| `expression` | studio → server | `name` (`"default"` returns to normal) |
| `action` | studio → server | `name` (one of BUILTIN_ACTIONS) |
| `state` | server → all | `talking`, `expression`, `avatar`, `revision` |
| `play` | server → all | `action` |
| `config` | server → all | `avatar` (string or null), `config` (validated avatar.json or null), `files` (`{ [expr]: frameName[] }`), `imageRev` (number) |
| `status` | server → studio | `hotkeys: { ok, error? }`, `avatars` (connected avatar pages), `warnings` (string[]) |

Only clients with role `studio` may send `voice`, `expression`, `action`. Unknown types are ignored.

---

### Task 1: Project scaffold, shared constants and hotkey names

**Files:**
- Create: `package.json`
- Modify: `.gitignore`
- Create: `public/shared/constants.js`
- Create: `public/shared/keys.js`
- Test: `test/keys.test.js`

**Interfaces:**
- Produces: `FRAME_NAMES`, `FRAME_CHAIN`, `BUILTIN_ACTIONS`, `NAME_PATTERN`, `DEFAULT_PORT` from `constants.js`; `parseKey(text) → {ctrl, alt, shift, key} | null`, `formatKey(combo) → string`, `normalizeKey(text) → string | null`, `keyFromBrowserEvent(event) → string | null` from `keys.js`. Canonical combo format is `Ctrl+Alt+Shift+KEY` (modifiers in that order), KEY is `F1`–`F24`, `A`–`Z` or `0`–`9`.

- [ ] **Step 1: Create `package.json` and update `.gitignore`**

`package.json`:
```json
{
  "name": "avata-overlay",
  "version": "0.1.0",
  "description": "ตัวละคร PNGtuber ขยับตามเสียงไมค์ สำหรับใส่ใน OBS",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "node src/cli.js",
    "sample": "node scripts/make-sample.js",
    "test": "node --test \"test/*.test.js\""
  },
  "engines": {
    "node": ">=18"
  }
}
```

`.gitignore` (replace whole file):
```
node_modules/
.superpowers/
avatars/
settings.json
```

- [ ] **Step 2: Create `public/shared/constants.js`**

```js
export const FRAME_NAMES = ['idle', 'talk', 'blink', 'blink-talk'];

// ลำดับไฟล์ที่ลองหาในแต่ละสีหน้า ถ้าไม่มีไฟล์แรกก็ใช้ตัวถัดไป
export const FRAME_CHAIN = {
  idle: ['idle'],
  talk: ['talk', 'idle'],
  blink: ['blink', 'idle'],
  'blink-talk': ['blink-talk', 'talk', 'idle'],
};

export const BUILTIN_ACTIONS = ['jump', 'shake', 'spin', 'wobble'];

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const DEFAULT_PORT = 5180;
```

- [ ] **Step 3: Write the failing test `test/keys.test.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `public/shared/keys.js`

- [ ] **Step 5: Implement `public/shared/keys.js`**

```js
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 5 tests

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore public/shared/constants.js public/shared/keys.js test/keys.test.js
git commit -m "feat: scaffold project with shared constants and hotkey names"
```

---

### Task 2: Voice gate

**Files:**
- Create: `public/shared/voice-gate.js`
- Test: `test/voice-gate.test.js`

**Interfaces:**
- Produces: `createVoiceGate({ threshold = 0.08, releaseMs = 150 }) → { update(level: number, nowMs: number) → boolean, setOptions({ threshold?, releaseMs? }), talking: boolean }`. Opens when `level >= threshold`; closes only after `releaseMs` with no level at/above threshold.

- [ ] **Step 1: Write the failing test `test/voice-gate.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceGate } from '../public/shared/voice-gate.js';

test('opens at the threshold', () => {
  const gate = createVoiceGate({ threshold: 0.1, releaseMs: 150 });
  assert.equal(gate.update(0.05, 0), false);
  assert.equal(gate.update(0.1, 33), true);
  assert.equal(gate.talking, true);
});

test('stays open during the release time, then closes', () => {
  const gate = createVoiceGate({ threshold: 0.1, releaseMs: 150 });
  gate.update(0.5, 0);
  assert.equal(gate.update(0, 100), true);
  assert.equal(gate.update(0, 149), true);
  assert.equal(gate.update(0, 150), false);
});

test('does not flicker when the level wobbles around the threshold', () => {
  const gate = createVoiceGate({ threshold: 0.1, releaseMs: 150 });
  const results = [];
  for (let t = 0; t <= 1000; t += 50) results.push(gate.update(t % 100 === 0 ? 0.12 : 0.08, t));
  assert.ok(results.every(Boolean));
});

test('setOptions changes threshold and release', () => {
  const gate = createVoiceGate({ threshold: 0.1, releaseMs: 150 });
  gate.setOptions({ threshold: 0.3 });
  assert.equal(gate.update(0.2, 0), false);
  gate.setOptions({ releaseMs: 0 });
  gate.update(0.5, 10);
  assert.equal(gate.update(0, 10), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `voice-gate.js`

- [ ] **Step 3: Implement `public/shared/voice-gate.js`**

```js
export function createVoiceGate({ threshold = 0.08, releaseMs = 150 } = {}) {
  let talking = false;
  let lastLoudAt = -Infinity;
  return {
    update(level, now) {
      if (level >= threshold) {
        talking = true;
        lastLoudAt = now;
      } else if (talking && now - lastLoudAt >= releaseMs) {
        talking = false;
      }
      return talking;
    },
    setOptions(options) {
      if (typeof options.threshold === 'number') threshold = options.threshold;
      if (typeof options.releaseMs === 'number') releaseMs = options.releaseMs;
    },
    get talking() {
      return talking;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add public/shared/voice-gate.js test/voice-gate.test.js
git commit -m "feat: add voice gate with threshold and release delay"
```

---

### Task 3: Frame selection with fallback

**Files:**
- Create: `public/shared/frames.js`
- Test: `test/frames.test.js`

**Interfaces:**
- Consumes: `FRAME_CHAIN` from `constants.js`.
- Produces: `wantedFrame({ talking, blinking }) → 'idle'|'talk'|'blink'|'blink-talk'`; `resolveFrame(files, expression, frame) → 'expr/name.png' | null` where `files` is `{ [expression]: frameName[] }`. Order: expression's chain, then `default`'s chain; `null` only when `default/idle` is missing too.

- [ ] **Step 1: Write the failing test `test/frames.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrame, wantedFrame } from '../public/shared/frames.js';

test('wantedFrame combines talking and blinking', () => {
  assert.equal(wantedFrame({ talking: false, blinking: false }), 'idle');
  assert.equal(wantedFrame({ talking: true, blinking: false }), 'talk');
  assert.equal(wantedFrame({ talking: false, blinking: true }), 'blink');
  assert.equal(wantedFrame({ talking: true, blinking: true }), 'blink-talk');
});

const full = { default: ['idle', 'talk', 'blink', 'blink-talk'], happy: ['idle', 'talk'], shock: ['idle'] };

test('uses the exact frame when it exists', () => {
  assert.equal(resolveFrame(full, 'default', 'blink-talk'), 'default/blink-talk.png');
  assert.equal(resolveFrame(full, 'happy', 'talk'), 'happy/talk.png');
});

test('falls back inside the same expression first', () => {
  assert.equal(resolveFrame(full, 'happy', 'blink'), 'happy/idle.png');
  assert.equal(resolveFrame(full, 'happy', 'blink-talk'), 'happy/talk.png');
  assert.equal(resolveFrame(full, 'shock', 'talk'), 'shock/idle.png');
});

test('falls back to default when the expression has nothing', () => {
  assert.equal(resolveFrame(full, 'angry', 'talk'), 'default/talk.png');
  assert.equal(resolveFrame({ default: ['idle'] }, 'angry', 'blink-talk'), 'default/idle.png');
});

test('talk falls back to idle, blink to idle when missing', () => {
  const minimal = { default: ['idle'] };
  assert.equal(resolveFrame(minimal, 'default', 'talk'), 'default/idle.png');
  assert.equal(resolveFrame(minimal, 'default', 'blink'), 'default/idle.png');
});

test('returns null when there is no default idle', () => {
  assert.equal(resolveFrame({}, 'default', 'idle'), null);
  assert.equal(resolveFrame({ happy: ['talk'] }, 'default', 'idle'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `frames.js`

- [ ] **Step 3: Implement `public/shared/frames.js`**

```js
import { FRAME_CHAIN } from './constants.js';

export function wantedFrame({ talking, blinking }) {
  if (blinking) return talking ? 'blink-talk' : 'blink';
  return talking ? 'talk' : 'idle';
}

export function resolveFrame(files, expression, frame) {
  const chain = FRAME_CHAIN[frame] ?? FRAME_CHAIN.idle;
  const order = expression === 'default' ? ['default'] : [expression, 'default'];
  for (const expr of order) {
    const available = files[expr] ?? [];
    for (const name of chain) {
      if (available.includes(name)) return `${expr}/${name}.png`;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/shared/frames.js test/frames.test.js
git commit -m "feat: pick avatar frames with fallback order"
```

---

### Task 4: Expression state

**Files:**
- Create: `src/state.js`
- Test: `test/state.test.js`

**Interfaces:**
- Produces: `createState({ setTimeout?, clearTimeout? }) → { snapshot() → { talking, expression, avatar, revision }, onChange(fn) → unsubscribe, setTalking(bool), setAvatar(name, config), updateExpressions(config), triggerExpression(name) → boolean, dispose() }`. `revision` increases by 1 on every emitted change. `config.expressions` is the validated shape from Task 5 (`{ [name]: { key, mode: 'timed'|'toggle', seconds? } }`).

- [ ] **Step 1: Write the failing test `test/state.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';

function fakeTimers() {
  let now = 0;
  let nextId = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      nextId += 1;
      pending.set(nextId, { fn, at: now + ms });
      return nextId;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
    get count() {
      return pending.size;
    },
  };
}

const config = {
  expressions: {
    happy: { key: 'F1', mode: 'timed', seconds: 4 },
    shock: { key: 'F3', mode: 'timed', seconds: 2 },
    angry: { key: 'F2', mode: 'toggle' },
  },
};

function setup() {
  const timers = fakeTimers();
  const state = createState(timers);
  const changes = [];
  state.onChange((s) => changes.push(s));
  state.setAvatar('me', config);
  return { timers, state, changes };
}

test('setAvatar resets to default and emits', () => {
  const { state, changes } = setup();
  assert.deepEqual(state.snapshot(), { talking: false, expression: 'default', avatar: 'me', revision: 1 });
  assert.equal(changes.length, 1);
});

test('setTalking emits only on change', () => {
  const { state, changes } = setup();
  state.setTalking(true);
  state.setTalking(true);
  state.setTalking(false);
  assert.equal(changes.length, 3);
  assert.equal(state.snapshot().talking, false);
});

test('timed expression returns to default after its seconds', () => {
  const { state, timers } = setup();
  assert.equal(state.triggerExpression('happy'), true);
  assert.equal(state.snapshot().expression, 'happy');
  timers.advance(3999);
  assert.equal(state.snapshot().expression, 'happy');
  timers.advance(1);
  assert.equal(state.snapshot().expression, 'default');
});

test('re-triggering a timed expression restarts its timer', () => {
  const { state, timers } = setup();
  state.triggerExpression('happy');
  timers.advance(3000);
  state.triggerExpression('happy');
  timers.advance(3000);
  assert.equal(state.snapshot().expression, 'happy');
  timers.advance(1000);
  assert.equal(state.snapshot().expression, 'default');
});

test('switching expression cancels the previous timer', () => {
  const { state, timers } = setup();
  state.triggerExpression('happy');
  state.triggerExpression('angry');
  assert.equal(timers.count, 0);
  timers.advance(10000);
  assert.equal(state.snapshot().expression, 'angry');
});

test('toggle expression turns on then off', () => {
  const { state } = setup();
  state.triggerExpression('angry');
  assert.equal(state.snapshot().expression, 'angry');
  state.triggerExpression('angry');
  assert.equal(state.snapshot().expression, 'default');
});

test('default always works, unknown names are rejected', () => {
  const { state } = setup();
  state.triggerExpression('angry');
  assert.equal(state.triggerExpression('default'), true);
  assert.equal(state.snapshot().expression, 'default');
  assert.equal(state.triggerExpression('nope'), false);
});

test('updateExpressions drops a removed current expression', () => {
  const { state } = setup();
  state.triggerExpression('angry');
  state.updateExpressions({ expressions: { happy: config.expressions.happy } });
  assert.equal(state.snapshot().expression, 'default');
});

test('revision increases with every change', () => {
  const { state } = setup();
  const before = state.snapshot().revision;
  state.setTalking(true);
  state.triggerExpression('angry');
  assert.equal(state.snapshot().revision, before + 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `src/state.js`

- [ ] **Step 3: Implement `src/state.js`**

```js
export function createState({ setTimeout: setTimer = globalThis.setTimeout, clearTimeout: clearTimer = globalThis.clearTimeout } = {}) {
  let talking = false;
  let expression = 'default';
  let avatar = null;
  let expressions = {};
  let revision = 0;
  let timer = null;
  const listeners = new Set();

  const snapshot = () => ({ talking, expression, avatar, revision });

  function emit() {
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function cancelTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function setExpression(name) {
    cancelTimer();
    if (expression !== name) {
      expression = name;
      emit();
    }
  }

  return {
    snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTalking(value) {
      const next = Boolean(value);
      if (next !== talking) {
        talking = next;
        emit();
      }
    },
    setAvatar(name, config) {
      cancelTimer();
      avatar = name;
      expressions = config?.expressions ?? {};
      expression = 'default';
      emit();
    },
    updateExpressions(config) {
      expressions = config?.expressions ?? {};
      if (expression !== 'default' && !expressions[expression]) setExpression('default');
    },
    triggerExpression(name) {
      if (name === 'default') {
        setExpression('default');
        return true;
      }
      const definition = expressions[name];
      if (!definition) return false;
      if (definition.mode === 'toggle') {
        setExpression(expression === name ? 'default' : name);
        return true;
      }
      setExpression(name);
      timer = setTimer(() => {
        timer = null;
        setExpression('default');
      }, definition.seconds * 1000);
      return true;
    },
    dispose() {
      cancelTimer();
      listeners.clear();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state.js test/state.test.js
git commit -m "feat: add expression state with timed and toggle modes"
```

---

### Task 5: Config validation and storage

**Files:**
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: `BUILTIN_ACTIONS`, `FRAME_NAMES`, `NAME_PATTERN` from `constants.js`; `normalizeKey` from `keys.js`.
- Produces:
  - `class ConfigError extends Error { errors: string[] }`
  - `DEFAULT_SETTINGS` = `{ activeAvatar: null, voice: { threshold: 0.08, releaseMs: 150, deviceId: null } }`
  - `defaultAvatarConfig(name) → config`
  - `validateAvatarConfig(input) → { ok: true, value } | { ok: false, errors }` (keys normalised to canonical form, missing `motion` fields filled with defaults)
  - `validateSettings(input) → { ok, value | errors }`
  - `buildBindings(config) → Map<comboString, { type: 'expression'|'action', name }>`
  - `listAvatars(avatarsDir) → Promise<string[]>` (sorted)
  - `scanFrames(avatarDir) → Promise<{ [expr]: frameName[] }>`
  - `loadAvatar(avatarsDir, name) → Promise<{ config, files }>` (throws `ConfigError`)
  - `createAvatar(avatarsDir, name) → Promise<{ config, files }>`
  - `saveAvatarConfig(avatarsDir, name, input) → Promise<config>`
  - `saveFrame(avatarsDir, name, expression, frame, buffer) → Promise<void>`
  - `loadSettings(file) → Promise<{ settings, warnings: string[] }>`
  - `saveSettings(file, input) → Promise<settings>`

- [ ] **Step 1: Write the failing test `test/config.test.js`**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `src/config.js`

- [ ] **Step 3: Implement `src/config.js`**

```js
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_ACTIONS, FRAME_NAMES, NAME_PATTERN } from '../public/shared/constants.js';
import { normalizeKey } from '../public/shared/keys.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NAME_RULE = 'ใช้ได้เฉพาะ a-z, 0-9 และ - (ไม่เกิน 32 ตัว)';

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
  if (typeof input.name !== 'string' || !NAME_PATTERN.test(input.name)) errors.push(`ชื่อตัวละคร${NAME_RULE}`);
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
      if (!NAME_PATTERN.test(name)) { errors.push(`${owner}: ชื่อ${NAME_RULE}`); continue; }
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
  if (activeAvatar !== null && (typeof activeAvatar !== 'string' || !NAME_PATTERN.test(activeAvatar))) errors.push('activeAvatar ไม่ถูกต้อง');
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
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) throw new ConfigError([`${label} "${name}" ${NAME_RULE}`]);
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
    return entries.filter((e) => e.isDirectory() && NAME_PATTERN.test(e.name)).map((e) => e.name).sort();
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
    if (!entry.isDirectory() || !NAME_PATTERN.test(entry.name)) continue;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: validate and store avatar config, settings and frames"
```

---

### Task 6: Global hotkeys

**Files:**
- Create: `src/hotkeys.js`
- Test: `test/hotkeys.test.js`
- Modify: `package.json` (dependency added by npm)

**Interfaces:**
- Consumes: `formatKey` from `keys.js`.
- Produces: `buildKeyNameMap(UiohookKey) → Map<keycode, 'F1'|'A'|'0'…>`; `comboFromEvent(event, keyNames) → string | null`; `createHotkeys({ onCombo, load? }) → { start() → Promise<{ ok: true } | { ok: false, error: string }>, stop() }`. Held keys fire once until released (no auto-repeat).

- [ ] **Step 1: Install the dependency**

Run: `npm install uiohook-napi@^1.5.4`
Expected: `added 1 package` (prebuilt binary for Windows x64, no compiler needed). `package.json` now has `"dependencies": { "uiohook-napi": "^1.5.x" }`.

- [ ] **Step 2: Write the failing test `test/hotkeys.test.js`**

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `src/hotkeys.js`

- [ ] **Step 4: Implement `src/hotkeys.js`**

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Smoke-check the real module loads**

Run: `node -e "import('uiohook-napi').then(m => console.log(typeof (m.uIOhook ?? m.default.uIOhook).start, (m.UiohookKey ?? m.default.UiohookKey).F1))"`
Expected: `function 59`. If the number differs that is fine; it must not be `undefined`. If `UiohookKey['1']` style digits are missing in this version, note it — `buildKeyNameMap` already skips missing names.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/hotkeys.js test/hotkeys.test.js
git commit -m "feat: add global hotkeys via uiohook-napi"
```

---

### Task 7: Sample avatar generator

**Files:**
- Create: `scripts/make-sample.js`
- Test: `test/make-sample.test.js`

**Interfaces:**
- Consumes: `validateAvatarConfig` from `src/config.js`.
- Produces: `encodePng(width, height, rgbaBuffer) → Buffer`; `writeSample(dir, { size = 1000 }) → Promise<void>` that writes `avatar.json`, `default/{idle,talk,blink,blink-talk}.png`, `happy/{idle,talk}.png`, `shock/idle.png`. Running `npm run sample` writes `avatars/sample` (refuses to overwrite unless `--force`).

- [ ] **Step 1: Write the failing test `test/make-sample.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodePng, writeSample } from '../scripts/make-sample.js';
import { scanFrames, validateAvatarConfig } from '../src/config.js';

test('encodePng writes a valid PNG header and IEND chunk', () => {
  const png = encodePng(2, 3, Buffer.alloc(2 * 3 * 4, 255));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 3);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  assert.equal(png.toString('ascii', png.length - 8, png.length - 4), 'IEND');
  assert.equal(png.readUInt32BE(png.length - 4), 0xae426082);
});

test('writeSample creates a complete, valid avatar', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'avata-sample-'));
  try {
    await writeSample(dir, { size: 120 });
    const config = JSON.parse(await readFile(path.join(dir, 'avatar.json'), 'utf8'));
    assert.equal(validateAvatarConfig(config).ok, true);
    assert.deepEqual(await scanFrames(dir), {
      default: ['idle', 'talk', 'blink', 'blink-talk'],
      happy: ['idle', 'talk'],
      shock: ['idle'],
    });
    const idle = await readFile(path.join(dir, 'default', 'idle.png'));
    assert.equal(idle.readUInt32BE(16), 120);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `scripts/make-sample.js`

- [ ] **Step 3: Implement `scripts/make-sample.js`**

```js
// วาดตัวละครตัวอย่าง (avatars/sample) ด้วย Node ล้วน ไว้ทดลองระบบก่อนมีรูปของตัวเอง
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const SUBSAMPLES = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

const OUTLINE = [43, 33, 64];
const SKIN = [255, 217, 184];
const HAIR = [90, 61, 138];
const SHIRT = [108, 140, 255];
const WHITE = [255, 255, 255];
const TONGUE = [255, 122, 138];
const CHEEK = [255, 157, 176];

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function createCanvas(size) {
  const data = Buffer.alloc(size * size * 4);
  const scale = size / 1000;

  function blend(x, y, [r, g, b], alpha) {
    const i = (y * size + x) * 4;
    const below = data[i + 3] / 255;
    const out = alpha + below * (1 - alpha);
    data[i] = Math.round((r * alpha + data[i] * below * (1 - alpha)) / out);
    data[i + 1] = Math.round((g * alpha + data[i + 1] * below * (1 - alpha)) / out);
    data[i + 2] = Math.round((b * alpha + data[i + 2] * below * (1 - alpha)) / out);
    data[i + 3] = Math.round(out * 255);
  }

  // พิกัดทั้งหมดออกแบบไว้บนผืน 1000×1000 แล้วย่อขยายตาม size
  function ellipse(cx, cy, rx, ry, color, opacity = 1) {
    [cx, cy, rx, ry] = [cx * scale, cy * scale, rx * scale, ry * scale];
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(size - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(size - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        let hits = 0;
        for (const [sx, sy] of SUBSAMPLES) {
          const dx = (x + sx - cx) / rx;
          const dy = (y + sy - cy) / ry;
          if (dx * dx + dy * dy <= 1) hits += 1;
        }
        if (hits) blend(x, y, color, (hits / SUBSAMPLES.length) * opacity);
      }
    }
  }

  return { data, ellipse };
}

function drawCharacter(size, { eyes, mouth, cheeks = false }) {
  const { data, ellipse } = createCanvas(size);
  ellipse(500, 930, 270, 190, OUTLINE);
  ellipse(500, 930, 258, 178, SHIRT);
  ellipse(500, 470, 300, 285, OUTLINE);
  ellipse(500, 430, 290, 262, HAIR);
  ellipse(500, 505, 268, 228, SKIN);

  for (const x of [395, 605]) {
    if (eyes === 'open') {
      ellipse(x, 500, 34, 46, OUTLINE);
      ellipse(x + 10, 485, 11, 13, WHITE);
    } else if (eyes === 'closed') {
      ellipse(x, 510, 38, 7, OUTLINE);
    } else {
      ellipse(x, 505, 16, 16, OUTLINE);
    }
  }
  if (cheeks) {
    ellipse(335, 585, 42, 22, CHEEK, 0.7);
    ellipse(665, 585, 42, 22, CHEEK, 0.7);
  }

  if (mouth === 'closed') ellipse(500, 615, 40, 8, OUTLINE);
  else if (mouth === 'open') {
    ellipse(500, 622, 46, 36, OUTLINE);
    ellipse(500, 642, 26, 14, TONGUE);
  } else if (mouth === 'smile') {
    ellipse(500, 612, 70, 28, OUTLINE);
    ellipse(500, 596, 76, 24, SKIN);
  } else if (mouth === 'smile-open') {
    ellipse(500, 622, 70, 46, OUTLINE);
    ellipse(500, 650, 36, 16, TONGUE);
  } else if (mouth === 'o') {
    ellipse(500, 635, 30, 40, OUTLINE);
  }
  return encodePng(size, size, data);
}

const FRAMES = {
  default: {
    idle: { eyes: 'open', mouth: 'closed' },
    talk: { eyes: 'open', mouth: 'open' },
    blink: { eyes: 'closed', mouth: 'closed' },
    'blink-talk': { eyes: 'closed', mouth: 'open' },
  },
  happy: {
    idle: { eyes: 'open', mouth: 'smile', cheeks: true },
    talk: { eyes: 'open', mouth: 'smile-open', cheeks: true },
  },
  shock: {
    idle: { eyes: 'small', mouth: 'o' },
  },
};

const SAMPLE_CONFIG = {
  version: 1,
  name: 'sample',
  expressions: {
    happy: { key: 'F1', mode: 'timed', seconds: 4 },
    shock: { key: 'F2', mode: 'timed', seconds: 2 },
  },
  actions: { jump: { key: 'F5' }, shake: { key: 'F6' } },
  motion: { breathe: true, talkBounce: 8, blinkEvery: [2, 6] },
};

export async function writeSample(dir, { size = 1000 } = {}) {
  for (const [expression, frames] of Object.entries(FRAMES)) {
    await mkdir(path.join(dir, expression), { recursive: true });
    for (const [frame, look] of Object.entries(frames)) {
      await writeFile(path.join(dir, expression, `${frame}.png`), drawCharacter(size, look));
    }
  }
  // ชื่อจริงมาจากชื่อโฟลเดอร์เสมอ (loadAvatar เขียนทับ) จึงใส่ sample ไว้ได้เลย
  await writeFile(path.join(dir, 'avatar.json'), `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.join(root, 'avatars', 'sample');
  const exists = await stat(dir).then(() => true, () => false);
  if (exists && !process.argv.includes('--force')) {
    console.log('มี avatars/sample อยู่แล้ว (ใช้ npm run sample -- --force ถ้าต้องการวาดใหม่)');
    return;
  }
  await writeSample(dir);
  console.log('สร้างตัวละครตัวอย่างที่ avatars/sample แล้ว');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Generate the real sample and look at it**

Run: `npm run sample`
Expected: `สร้างตัวละครตัวอย่างที่ avatars/sample แล้ว`. Open `avatars/sample/default/talk.png` and `avatars/sample/happy/idle.png` in an image viewer: a round purple-haired face on a transparent background, mouth open / smiling with pink cheeks.

- [ ] **Step 6: Commit**

```bash
git add scripts/make-sample.js test/make-sample.test.js
git commit -m "feat: generate a sample avatar with pure Node PNG drawing"
```

---

### Task 8: Server (HTTP + WebSocket) and CLI

**Files:**
- Create: `src/http-util.js`
- Create: `src/server.js`
- Create: `src/cli.js`
- Test: `test/server.test.js`
- Modify: `package.json` (dependency added by npm)

**Interfaces:**
- Consumes: `createState` (Task 4); everything listed from `config.js` (Task 5); `createHotkeys` (Task 6); `writeSample` (Task 7); constants.
- Produces: `startServer({ root?, port = 5180, host = '127.0.0.1', hotkeys = true, log = console.log }) → Promise<{ port, url, state, close() }>`. Rejects with `error.code === 'EADDRINUSE'` when the port is taken.
- HTTP API:
  - `GET /` → 302 `/studio/`; `GET /studio`, `/avatar` → 301 with trailing slash
  - `GET /api/avatars` → `{ avatars: string[], active: string|null }`
  - `GET /api/avatar` → the `config` message object
  - `GET /api/settings` → settings
  - `POST /api/avatars` body `{ name }` → 201 `{ avatars }`
  - `PUT /api/settings` body settings → 200 settings (activates `activeAvatar` if it changed)
  - `PUT /api/avatars/:name/config` body config → 200 saved config
  - `PUT /api/avatars/:name/images/:expr/:frame` body PNG bytes → 200 `{ ok: true }`
  - `GET /avatars/...` → files under `avatars/`; other `GET` paths → files under `public/`
  - Errors: 400 `{ errors: string[] }` (validation / bad JSON), 403 (foreign `Origin` on non-GET), 404, 413 (too large), 500
- WebSocket at `/ws` as described in the protocol table.

- [ ] **Step 1: Install the dependency**

Run: `npm install ws@^8.18.0`
Expected: `added 1 package`

- [ ] **Step 2: Write the failing test `test/server.test.js`**

```js
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

    const traversal = await request('GET', `${ctx.server.url}/avatars/..%2F..%2Fpackage.json`);
    assert.equal(traversal.status, 404);

    const badJson = await request('PUT', `${ctx.server.url}/api/settings`, { body: '{nope', headers: { 'Content-Type': 'application/json' } });
    assert.equal(badJson.status, 400);
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
```

Note: the `GET /` test will 404 instead of 302 only if routing is wrong; `public/` does not need to exist yet for these tests.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `src/server.js`

- [ ] **Step 4: Implement `src/http-util.js`**

```js
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

export function redirect(res, status, location) {
  res.writeHead(status, { Location: location });
  res.end();
}

// คืน true ถ้าส่งไฟล์แล้ว, false ถ้าไม่พบหรือ path พยายามออกนอก baseDir
export async function serveFile(res, baseDir, relativePath) {
  const base = path.resolve(baseDir);
  let full = path.resolve(base, relativePath);
  if (full !== base && !full.startsWith(base + path.sep)) return false;
  let info;
  try {
    info = await stat(full);
    if (info.isDirectory()) {
      full = path.join(full, 'index.html');
      info = await stat(full);
    }
  } catch {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  createReadStream(full).pipe(res);
  return true;
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('body too large');
        error.code = 'TOO_LARGE';
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
```

- [ ] **Step 5: Implement `src/server.js`**

```js
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
  const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ origin }) => isAllowedOrigin(origin) });
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all files). If the `EADDRINUSE` test hangs, check that `server.once('error', reject)` is registered before `listen`.

- [ ] **Step 7: Implement `src/cli.js`**

```js
#!/usr/bin/env node
import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../public/shared/constants.js';
import { writeSample } from '../scripts/make-sample.js';
import { listAvatars } from './config.js';
import { startServer } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, open: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') options.port = Number(argv[++i]);
    else if (argv[i] === '--no-open') options.open = false;
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    console.error('--port ต้องเป็นตัวเลข 1–65535');
    process.exit(1);
  }
  return options;
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, () => {});
}

const options = parseArgs(process.argv.slice(2));
const avatarsDir = path.join(ROOT, 'avatars');
if ((await listAvatars(avatarsDir)).length === 0) {
  await writeSample(path.join(avatarsDir, 'sample'));
  console.log('สร้างตัวละครตัวอย่าง (avatars/sample) ให้ทดลองใช้แล้ว');
}

try {
  const server = await startServer({ root: ROOT, port: options.port });
  console.log('\n Avata-Overlay พร้อมแล้ว');
  console.log(`   หน้าควบคุม:      ${server.url}/studio/`);
  console.log(`   URL สำหรับ OBS: ${server.url}/avatar/`);
  console.log('\n เปิดหน้าต่างนี้ค้างไว้ตลอดตอนสตรีม (กด Ctrl+C เพื่อปิด)\n');
  if (options.open) openBrowser(`${server.url}/studio/`);
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n พอร์ต ${options.port} ถูกโปรแกรมอื่นใช้อยู่ (หรือเปิด Avata-Overlay ซ้อนไว้แล้ว)`);
    console.error(' ปิดโปรแกรมนั้นก่อน หรือเปลี่ยนพอร์ตด้วย: npm start -- --port 5181');
    console.error(' ถ้าเปลี่ยนพอร์ต ต้องแก้ URL ใน OBS ให้ตรงด้วย\n');
    process.exit(1);
  }
  throw error;
}
```

- [ ] **Step 8: Smoke-run the CLI**

Run: `node src/cli.js --no-open` (in a terminal tab, leave running)
Expected: prints `Avata-Overlay พร้อมแล้ว` with both URLs, no hotkey error on Windows. In another shell: `curl -s http://127.0.0.1:5180/api/avatar` returns JSON with `"avatar":"sample"`. Run the same command again in a third shell: it prints the Thai port-in-use message and exits 1. Stop both with Ctrl+C.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/http-util.js src/server.js src/cli.js test/server.test.js
git commit -m "feat: add local server with WebSocket hub, config API and CLI"
```

---

### Task 9: Renderer and the OBS avatar page

**Files:**
- Create: `public/shared/renderer.css`
- Create: `public/shared/renderer.js`
- Create: `public/shared/socket.js`
- Create: `public/avatar/index.html`
- Create: `public/avatar/avatar.js`

**Interfaces:**
- Consumes: `resolveFrame`, `wantedFrame` (Task 3); `BUILTIN_ACTIONS`; WebSocket protocol.
- Produces:
  - `createRenderer(container) → { setModel({ avatar, config, files, imageRev }), setState({ talking, expression }), play(actionName), destroy() }`
  - `connectSocket({ role, onMessage, onOpen?, onClose?, retryMs = 2000 }) → { send(message), close() }` — sends `hello` on every (re)connect.

No automated test (DOM-only); verified manually in Step 6. All decision logic it uses is already unit-tested in Tasks 2–3.

- [ ] **Step 1: Create `public/shared/renderer.css`**

```css
.av-root { position: relative; width: 100%; height: 100%; transform-origin: 50% 100%; }
.av-root.av-breathe { animation: av-breathe 3s ease-in-out infinite; }
.av-bounce { width: 100%; height: 100%; transform: translateY(0); transition: transform 80ms ease-out; }
.av-bounce.av-talking { transform: translateY(calc(var(--av-talk-bounce, 8px) * -1)); }
.av-action { position: relative; width: 100%; height: 100%; transform-origin: 50% 100%; }
.av-frame { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; visibility: hidden; user-select: none; }
.av-frame.av-visible { visibility: visible; }

@keyframes av-breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.02); } }

.av-play-jump { animation: av-jump 600ms ease-out; }
@keyframes av-jump {
  0%, 100% { transform: translateY(0); }
  40% { transform: translateY(-18%); }
  70% { transform: translateY(0); }
  85% { transform: translateY(-4%); }
}

.av-play-shake { animation: av-shake 500ms linear; }
@keyframes av-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4%); }
  40% { transform: translateX(4%); }
  60% { transform: translateX(-3%); }
  80% { transform: translateX(3%); }
}

.av-play-spin { animation: av-spin 700ms ease-in-out; transform-origin: 50% 50%; }
@keyframes av-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.av-play-wobble { animation: av-wobble 800ms ease-in-out; }
@keyframes av-wobble {
  0%, 100% { transform: scale(1, 1); }
  25% { transform: scale(1.12, 0.88); }
  50% { transform: scale(0.92, 1.08); }
  75% { transform: scale(1.04, 0.96); }
}
```

- [ ] **Step 2: Create `public/shared/renderer.js`**

```js
import { BUILTIN_ACTIONS } from './constants.js';
import { resolveFrame, wantedFrame } from './frames.js';

const BLINK_MS = 120;

export function createRenderer(container) {
  const root = document.createElement('div');
  root.className = 'av-root';
  const bounce = document.createElement('div');
  bounce.className = 'av-bounce';
  const action = document.createElement('div');
  action.className = 'av-action';
  bounce.append(action);
  root.append(bounce);
  container.append(root);

  let model = null;
  let talking = false;
  let expression = 'default';
  let blinking = false;
  let images = new Map();
  let visible = null;
  let blinkTimer = null;
  let generation = 0;

  function rebuildImages() {
    generation += 1;
    const owner = generation;
    action.replaceChildren();
    images = new Map();
    visible = null;
    if (!model?.avatar) return;
    for (const [expr, frames] of Object.entries(model.files)) {
      for (const frame of frames) {
        const rel = `${expr}/${frame}.png`;
        const img = document.createElement('img');
        img.className = 'av-frame';
        img.alt = '';
        img.draggable = false;
        // รูปเสีย: ตัดออกจากรายการแล้วให้ลำดับสำรองเลือกรูปอื่นแทน
        img.addEventListener('error', () => {
          if (owner !== generation) return;
          model.files[expr] = (model.files[expr] ?? []).filter((f) => f !== frame);
          img.remove();
          images.delete(rel);
          if (visible === img) visible = null;
          update();
        });
        img.src = `/avatars/${encodeURIComponent(model.avatar)}/${rel}?v=${model.imageRev}`;
        action.append(img);
        images.set(rel, img);
      }
    }
  }

  function update() {
    if (!model?.avatar) return;
    const rel = resolveFrame(model.files, expression, wantedFrame({ talking, blinking }));
    const img = (rel && images.get(rel)) ?? null;
    if (img === visible) return;
    visible?.classList.remove('av-visible');
    img?.classList.add('av-visible');
    visible = img;
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    const range = model?.config?.motion?.blinkEvery;
    if (!range) return;
    const wait = (range[0] + Math.random() * (range[1] - range[0])) * 1000;
    blinkTimer = setTimeout(() => {
      blinking = true;
      update();
      blinkTimer = setTimeout(() => {
        blinking = false;
        update();
        scheduleBlink();
      }, BLINK_MS);
    }, wait);
  }

  function applyMotion() {
    const motion = model?.config?.motion;
    root.classList.toggle('av-breathe', Boolean(motion?.breathe));
    bounce.style.setProperty('--av-talk-bounce', `${motion?.talkBounce ?? 0}px`);
  }

  action.addEventListener('animationend', () => {
    action.className = 'av-action';
  });

  return {
    setModel(next) {
      const needImages = !model || next.avatar !== model.avatar || next.imageRev !== model.imageRev;
      model = { avatar: next.avatar, config: next.config, files: structuredClone(next.files ?? {}), imageRev: next.imageRev };
      if (needImages) rebuildImages();
      applyMotion();
      scheduleBlink();
      update();
    },
    setState(next) {
      talking = Boolean(next.talking);
      expression = next.expression ?? 'default';
      bounce.classList.toggle('av-talking', talking);
      update();
    },
    play(name) {
      if (!BUILTIN_ACTIONS.includes(name)) return;
      action.className = 'av-action';
      void action.offsetWidth; // เริ่มแอนิเมชันใหม่แม้เป็นท่าเดิม
      action.classList.add(`av-play-${name}`);
    },
    destroy() {
      clearTimeout(blinkTimer);
      root.remove();
    },
  };
}
```

Note: `setModel` without an image change keeps the existing `<img>` elements but replaces `model.files` with a fresh copy, so a frame removed by an `error` handler comes back on the next config message. That is acceptable: the browser will fire `error` again and remove it.

- [ ] **Step 3: Create `public/shared/socket.js`**

```js
export function connectSocket({ role, onMessage, onOpen = () => {}, onClose = () => {}, retryMs = 2000 }) {
  let ws = null;
  let closed = false;
  let timer = null;

  function open() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role }));
      onOpen();
    });
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      onMessage(message);
    });
    ws.addEventListener('close', () => {
      onClose();
      if (!closed) timer = setTimeout(open, retryMs);
    });
  }

  open();
  return {
    send(message) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
```

- [ ] **Step 4: Create `public/avatar/index.html`**

```html
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>Avata-Overlay · Avatar</title>
  <link rel="stylesheet" href="/shared/renderer.css">
  <style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
    #stage { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="stage"></div>
  <script type="module" src="/avatar/avatar.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create `public/avatar/avatar.js`**

```js
import { createRenderer } from '/shared/renderer.js';
import { connectSocket } from '/shared/socket.js';

const renderer = createRenderer(document.getElementById('stage'));
let last = { talking: false, expression: 'default' };

connectSocket({
  role: 'avatar',
  onMessage(message) {
    if (message.type === 'config') renderer.setModel(message);
    else if (message.type === 'state') {
      last = message;
      renderer.setState(message);
    } else if (message.type === 'play') renderer.play(message.action);
  },
  onClose() {
    // server หลุด: ค้างภาพล่าสุดไว้แต่หุบปาก ไม่ให้ปากค้างอ้าบนสตรีม
    renderer.setState({ ...last, talking: false });
  },
});
```

- [ ] **Step 6: Verify in the browser**

1. Run `node src/cli.js --no-open` in a terminal tab.
2. Open `http://127.0.0.1:5180/avatar/` in Chrome. Expected: the sample face on a white page (the page is transparent; white is Chrome's backdrop), breathing gently and blinking every 2–6 s.
3. In the DevTools console of that page run:
   ```js
   const ws = new WebSocket('ws://127.0.0.1:5180/ws');
   ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', role: 'studio' })); ws.send(JSON.stringify({ type: 'voice', level: 1, talking: true })); };
   ```
   Expected: the mouth opens and the character lifts ~8 px. Then run `ws.send(JSON.stringify({ type: 'expression', name: 'happy' }))` — smile with pink cheeks, back to normal after 4 s. `ws.send(JSON.stringify({ type: 'action', name: 'jump' }))` — jumps once. `ws.close()` — mouth closes.
4. Stop the server with Ctrl+C. Expected: the avatar page keeps showing the face with the mouth closed. Start the server again; within ~2 s the page reconnects (DevTools Network → WS shows a new connection).

- [ ] **Step 7: Commit**

```bash
git add public/shared/renderer.css public/shared/renderer.js public/shared/socket.js public/avatar
git commit -m "feat: render the avatar with blink, breathe, bounce and actions for OBS"
```

---

### Task 10: Studio shell, microphone and status

**Files:**
- Create: `public/studio/index.html`
- Create: `public/studio/studio.css`
- Create: `public/studio/api.js`
- Create: `public/studio/level-worklet.js`
- Create: `public/studio/mic.js`
- Create: `public/studio/studio.js`

**Interfaces:**
- Consumes: `createRenderer`, `connectSocket` (Task 9); `createVoiceGate` (Task 2); HTTP API (Task 8).
- Produces:
  - `api.getSettings()`, `api.saveSettings(settings)`, `api.listAvatars()`, `api.createAvatar(name)`, `api.saveConfig(name, config)`, `api.uploadFrame(name, expression, frame, file)` — all return parsed JSON, throw `Error` with `.errors: string[]` on non-2xx.
  - `listMics() → Promise<{ id, label }[]>`; `startMic({ deviceId, onLevel, onEnded }) → Promise<{ context: AudioContext, label: string, stop() }>`. `onLevel(level)` gets 0–1 about 30 times per second, computed on the audio thread so it keeps running when the tab is in the background.
  - `studio.js` leaves `<section id="editor">` empty; Task 11 fills it.

- [ ] **Step 1: Create `public/studio/index.html`**

```html
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Avata-Overlay Studio</title>
  <link rel="stylesheet" href="/shared/renderer.css">
  <link rel="stylesheet" href="/studio/studio.css">
</head>
<body>
  <header class="statusbar">
    <strong>Avata-Overlay</strong>
    <span class="pill" id="st-server" data-ok="no">server …</span>
    <span class="pill" id="st-mic" data-ok="no">ไมค์ …</span>
    <span class="pill" id="st-hotkeys" data-ok="no">ปุ่มลัด …</span>
    <span class="pill" id="st-avatars" data-ok="no">OBS: 0</span>
    <button id="copy-obs" type="button">คัดลอก URL สำหรับ OBS</button>
  </header>
  <div id="warnings" class="warnings" hidden></div>
  <main class="layout">
    <section class="preview-col">
      <div class="preview checker"><div id="preview"></div></div>
      <section class="panel">
        <h2>ไมค์</h2>
        <label class="row">อุปกรณ์ <select id="mic-device"></select></label>
        <div class="meter" id="meter" title="คลิกเพื่อตั้งเกณฑ์เริ่มพูด">
          <div id="meter-fill"></div>
          <div id="meter-threshold"></div>
        </div>
        <label class="row">เกณฑ์เริ่มพูด <input id="threshold" type="range" min="0" max="1" step="0.01"> <output id="threshold-out"></output></label>
        <label class="row">หน่วงปิดปาก <input id="release" type="range" min="0" max="1000" step="10"> <output id="release-out"></output></label>
        <p class="hint">พูดปกติแล้วดูแถบสีเขียว ตั้งเส้นสีแดงให้อยู่เหนือเสียงรบกวนตอนเงียบ</p>
      </section>
    </section>
    <section class="editor-col" id="editor"></section>
  </main>
  <script type="module" src="/studio/studio.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/studio/studio.css`**

```css
:root {
  --bg: #15131c; --panel: #1f1c29; --line: #332f44; --text: #ece9f5; --muted: #9a94b0;
  --ok: #3ccf91; --bad: #ff6b6b; --warn: #ffcc4d; --accent: #8c7bff;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, "Segoe UI", Tahoma, sans-serif; }
button, select, input { font: inherit; color: inherit; }
button { background: var(--line); border: 1px solid transparent; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button.danger:hover { border-color: var(--bad); }
button.key.waiting { background: var(--accent); color: #fff; }
select, input[type="text"], input:not([type]), input[type="number"] { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; }
input[type="number"] { width: 5.5em; }

.statusbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); }
.statusbar strong { margin-right: 8px; }
.statusbar button { margin-left: auto; }
.pill { padding: 2px 10px; border-radius: 999px; font-size: 13px; background: var(--line); }
.pill[data-ok="yes"] { background: color-mix(in srgb, var(--ok) 25%, transparent); color: var(--ok); }
.pill[data-ok="no"] { background: color-mix(in srgb, var(--bad) 20%, transparent); color: var(--bad); }

.warnings { margin: 12px 16px 0; padding: 10px 14px; border-radius: 8px; background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
.errors { padding: 10px 14px; border-radius: 8px; background: color-mix(in srgb, var(--bad) 18%, transparent); color: var(--bad); }

.layout { display: grid; grid-template-columns: minmax(280px, 420px) 1fr; gap: 16px; padding: 16px; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
.preview-col, .editor-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.panel h2 { margin: 0; font-size: 16px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.row .name { min-width: 6em; }
.hint { margin: 0; color: var(--muted); font-size: 13px; }

.checker { background-color: #fff; background-image: linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; }
.preview { aspect-ratio: 1; border-radius: 12px; overflow: hidden; }
#preview { width: 100%; height: 100%; }

.meter { position: relative; height: 18px; border-radius: 9px; background: var(--bg); overflow: hidden; cursor: pointer; }
#meter-fill { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--ok); }
#meter-threshold { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--bad); }

.frames { border-collapse: collapse; width: 100%; }
.frames th, .frames td { padding: 4px; text-align: center; font-weight: normal; }
.frames tbody th { text-align: left; }
.slot { display: grid; place-items: center; width: 84px; height: 84px; border-radius: 8px; border: 2px dashed var(--line); cursor: pointer; color: #555; font-size: 13px; margin: auto; overflow: hidden; }
.slot.filled { border-style: solid; }
.slot img { width: 100%; height: 100%; object-fit: contain; }
```

- [ ] **Step 3: Create `public/studio/api.js`**

```js
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
```

- [ ] **Step 4: Create `public/studio/level-worklet.js`**

```js
// ทำงานบนเธรดเสียงของเบราว์เซอร์ จึงไม่ถูกลดความเร็วตอนแท็บถูกย่อหรืออยู่เบื้องหลัง
class LevelMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0;
    this.count = 0;
    this.window = Math.round(sampleRate / 30);
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) this.sum += channel[i] * channel[i];
      this.count += channel.length;
      if (this.count >= this.window) {
        this.port.postMessage(Math.sqrt(this.sum / this.count));
        this.sum = 0;
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor('level-meter', LevelMeter);
```

- [ ] **Step 5: Create `public/studio/mic.js`**

```js
export async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default').map((d) => ({ id: d.deviceId, label: d.label || 'ไมค์' }));
}

export async function startMic({ deviceId, onLevel, onEnded }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
  const context = new AudioContext();
  await context.audioWorklet.addModule('/studio/level-worklet.js');
  const source = context.createMediaStreamSource(stream);
  const meter = new AudioWorkletNode(context, 'level-meter');
  // RMS ของเสียงพูดมักอยู่ราว 0.01–0.2 ใช้รากที่สองให้แถบระดับเสียงอ่านง่ายขึ้น
  meter.port.onmessage = (event) => onLevel(Math.min(1, Math.sqrt(event.data)));
  source.connect(meter);
  meter.connect(context.destination); // ไม่มีเสียงออก (worklet ไม่เขียน output) แต่ทำให้ worklet ทำงานต่อเนื่อง
  const [track] = stream.getAudioTracks();
  track.addEventListener('ended', () => onEnded?.());
  return {
    context,
    label: track.label,
    async stop() {
      meter.port.onmessage = null;
      source.disconnect();
      meter.disconnect();
      for (const t of stream.getTracks()) t.stop();
      await context.close();
    },
  };
}
```

- [ ] **Step 6: Create `public/studio/studio.js`**

```js
import { createRenderer } from '/shared/renderer.js';
import { connectSocket } from '/shared/socket.js';
import { createVoiceGate } from '/shared/voice-gate.js';
import { api } from '/studio/api.js';
import { listMics, startMic } from '/studio/mic.js';

const $ = (id) => document.getElementById(id);
const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const preview = createRenderer($('preview'));
let settings = await api.getSettings();
const gate = createVoiceGate(settings.voice);
let mic = null;
let micWarning = null;
let serverWarnings = [];

function setPill(id, ok, text, title = '') {
  const el = $(id);
  el.textContent = text;
  el.dataset.ok = ok ? 'yes' : 'no';
  el.title = title;
}

function renderWarnings() {
  const all = micWarning ? [micWarning, ...serverWarnings] : serverWarnings;
  const box = $('warnings');
  box.hidden = all.length === 0;
  box.replaceChildren(...all.map((text) => Object.assign(document.createElement('div'), { textContent: `⚠ ${text}` })));
}

const socket = connectSocket({
  role: 'studio',
  onOpen() {
    setPill('st-server', true, 'server ✓');
  },
  onClose() {
    setPill('st-server', false, 'server หลุด — กำลังต่อใหม่', 'เปิด start.bat ไว้หรือยัง?');
  },
  onMessage(message) {
    if (message.type === 'config') preview.setModel(message);
    else if (message.type === 'state') preview.setState(message);
    else if (message.type === 'play') preview.play(message.action);
    else if (message.type === 'status') {
      setPill('st-hotkeys', message.hotkeys.ok, message.hotkeys.ok ? 'ปุ่มลัด ✓' : 'ปุ่มลัดใช้ไม่ได้', message.hotkeys.error ?? '');
      setPill('st-avatars', message.avatars > 0, `OBS: ${message.avatars}`, 'จำนวนหน้า /avatar ที่เปิดอยู่ (เช่นใน OBS)');
      serverWarnings = message.warnings;
      renderWarnings();
    }
  },
});

const saveSettingsSoon = debounce(async () => {
  try {
    settings = await api.saveSettings(settings);
  } catch (error) {
    serverWarnings = [...serverWarnings, error.message];
    renderWarnings();
  }
}, 400);

// ---- ไมค์ ----

function onLevel(level) {
  const talking = gate.update(level, performance.now());
  socket.send({ type: 'voice', level, talking });
  $('meter-fill').style.width = `${level * 100}%`;
}

function setMicOk() {
  micWarning = null;
  setPill('st-mic', true, `ไมค์ ✓ ${mic?.label ?? ''}`);
  renderWarnings();
}

function setMicProblem(text) {
  micWarning = text;
  setPill('st-mic', false, 'ไมค์ ✗');
  renderWarnings();
  socket.send({ type: 'voice', level: 0, talking: false });
}

async function fillMicList() {
  const select = $('mic-device');
  const mics = await listMics();
  select.replaceChildren(
    new Option('ไมค์หลักของเครื่อง', ''),
    ...mics.map((m) => new Option(m.label, m.id)),
  );
  select.value = mics.some((m) => m.id === settings.voice.deviceId) ? settings.voice.deviceId : '';
}

async function restartMic() {
  await mic?.stop();
  mic = null;
  try {
    try {
      mic = await startMic({ deviceId: settings.voice.deviceId, onLevel, onEnded: () => setMicProblem('ไมค์หลุด — เสียบกลับแล้วระบบจะลองใหม่เอง') });
    } catch (error) {
      if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
      mic = await startMic({ deviceId: null, onLevel, onEnded: () => setMicProblem('ไมค์หลุด — เสียบกลับแล้วระบบจะลองใหม่เอง') });
    }
    if (mic.context.state === 'suspended') {
      setMicProblem('คลิกที่ใดก็ได้ในหน้านี้ 1 ครั้งเพื่อเปิดไมค์');
      window.addEventListener('pointerdown', async () => {
        await mic.context.resume();
        setMicOk();
      }, { once: true });
    } else {
      setMicOk();
    }
    await fillMicList();
  } catch (error) {
    setMicProblem(error.name === 'NotAllowedError'
      ? 'เบราว์เซอร์ยังไม่ได้รับอนุญาตให้ใช้ไมค์ — กดไอคอนข้างช่อง URL เลือก "อนุญาต" ไมโครโฟน แล้วรีเฟรชหน้า'
      : `เปิดไมค์ไม่ได้: ${error.message}`);
  }
}

navigator.mediaDevices.addEventListener('devicechange', () => {
  if (micWarning) restartMic();
  else fillMicList();
});

$('mic-device').addEventListener('change', (event) => {
  settings.voice.deviceId = event.target.value || null;
  saveSettingsSoon();
  restartMic();
});

function showVoiceSettings() {
  const { threshold, releaseMs } = settings.voice;
  $('threshold').value = threshold;
  $('threshold-out').textContent = threshold.toFixed(2);
  $('release').value = releaseMs;
  $('release-out').textContent = `${releaseMs} ms`;
  $('meter-threshold').style.left = `${threshold * 100}%`;
}

function setVoice(patch) {
  settings.voice = { ...settings.voice, ...patch };
  gate.setOptions(settings.voice);
  showVoiceSettings();
  saveSettingsSoon();
}

$('threshold').addEventListener('input', (event) => setVoice({ threshold: Number(event.target.value) }));
$('release').addEventListener('input', (event) => setVoice({ releaseMs: Number(event.target.value) }));
$('meter').addEventListener('pointerdown', (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const threshold = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  setVoice({ threshold: Math.round(threshold * 100) / 100 });
});

$('copy-obs').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/avatar/`);
  const button = $('copy-obs');
  button.textContent = 'คัดลอกแล้ว ✓';
  setTimeout(() => { button.textContent = 'คัดลอก URL สำหรับ OBS'; }, 1500);
});

showVoiceSettings();
restartMic();
```

- [ ] **Step 7: Verify in the browser**

1. Run `node src/cli.js` (opens `/studio/` automatically). Allow the microphone when Chrome asks.
2. Expected: pills show `server ✓`, `ไมค์ ✓ <device name>`, `ปุ่มลัด ✓`, `OBS: 0`; the sample face is in the preview; the green meter moves when you speak; the mouth opens while you talk and closes ~150 ms after you stop.
3. Drag the threshold slider and click inside the meter — the red line moves; reload the page — the values are kept (`settings.json` exists in the project root).
4. Open `http://127.0.0.1:5180/avatar/` in a **separate Chrome window** — the pill becomes `OBS: 1`. Minimise the studio window, keep talking while watching the avatar window. Expected: the mouth still follows your voice with no visible delay. If it lags or stops, record that in the task report — the spec's fallback (capture the mic in Node) would become a new task; do not implement it inside this task.
5. Unplug/disable the mic (or pick a device then remove it): yellow warning appears; plug back in: warning clears by itself.
6. Click `คัดลอก URL สำหรับ OBS` and paste somewhere: `http://127.0.0.1:5180/avatar/`.

- [ ] **Step 8: Commit**

```bash
git add public/studio
git commit -m "feat: add studio page with AudioWorklet mic, voice gate and status bar"
```

---

### Task 11: Studio editor (avatars, images, expressions, hotkeys, motion)

**Files:**
- Create: `public/studio/editor.js`
- Modify: `public/studio/studio.js`

**Interfaces:**
- Consumes: `api` (Task 10); `BUILTIN_ACTIONS`, `FRAME_NAMES`, `NAME_PATTERN` (Task 1); `keyFromBrowserEvent` (Task 1); server's `config` message (Task 8).
- Produces: `createEditor(container, { api, send(message), onSelectAvatar(name) → Promise }) → { setModel(configMessage), setAvatars(names: string[]) }`. The editor auto-saves `avatar.json` 300 ms after each change and shows server validation errors in a red box.

- [ ] **Step 1: Create `public/studio/editor.js`**

```js
import { BUILTIN_ACTIONS, FRAME_NAMES, NAME_PATTERN } from '/shared/constants.js';
import { keyFromBrowserEvent } from '/shared/keys.js';

const FRAME_LABELS = { idle: 'เงียบ', talk: 'พูด', blink: 'หลับตา', 'blink-talk': 'พูด+หลับตา' };
const ACTION_LABELS = { jump: 'กระโดด', shake: 'สั่น', spin: 'หมุน', wobble: 'เด้งดึ๋ง' };
const NAME_HINT = 'ใช้ได้เฉพาะ a-z, 0-9 และ - (ไม่เกิน 32 ตัว)';

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else if (value === true) el.setAttribute(name, '');
    else if (value !== false && value != null) el.setAttribute(name, value);
  }
  el.append(...children.flat().filter((child) => child != null && child !== false));
  return el;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function createEditor(container, { api, send, onSelectAvatar }) {
  let model = null;
  let draft = null;
  let avatars = [];
  let errors = [];
  let capturing = null;

  const setErrors = (error) => {
    errors = error.errors?.length ? error.errors : [error.message];
    render();
  };

  const saveSoon = debounce(async () => {
    if (!model?.avatar || !draft) return;
    try {
      await api.saveConfig(model.avatar, draft);
      errors = [];
      render();
    } catch (error) {
      setErrors(error);
    }
  }, 300);

  function change(mutate) {
    mutate(draft);
    render();
    saveSoon();
  }

  window.addEventListener('keydown', (event) => {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    const { apply } = capturing;
    if (event.key === 'Escape') {
      capturing = null;
      apply(null);
      return;
    }
    const key = keyFromBrowserEvent(event);
    if (!key) return; // กดแค่ Ctrl/Alt/Shift ยังไม่จบ รอปุ่มหลัก
    capturing = null;
    apply(key);
  }, true);

  const panel = (title, ...children) => h('section', { class: 'panel' }, h('h2', {}, title), ...children);

  function keyButton(id, key, apply) {
    const waiting = capturing?.id === id;
    return h('button', {
      type: 'button',
      class: waiting ? 'key waiting' : 'key',
      onclick: () => { capturing = { id, apply }; render(); },
    }, waiting ? 'กดปุ่มที่ต้องการ… (Esc = ล้าง)' : key ? `ปุ่ม: ${key}` : 'ตั้งปุ่มลัด');
  }

  function avatarPanel() {
    const nameInput = h('input', { placeholder: 'ชื่อใหม่ เช่น my-char', maxlength: 32 });
    const create = async () => {
      const name = nameInput.value.trim().toLowerCase();
      if (!NAME_PATTERN.test(name)) {
        errors = [`ชื่อตัวละคร${NAME_HINT}`];
        render();
        return;
      }
      try {
        avatars = (await api.createAvatar(name)).avatars;
        errors = [];
        await onSelectAvatar(name);
      } catch (error) {
        setErrors(error);
      }
    };
    return panel('ตัวละคร',
      h('div', { class: 'row' },
        h('select', { onchange: (event) => onSelectAvatar(event.target.value).catch(setErrors) },
          avatars.map((name) => h('option', { value: name, selected: name === model?.avatar }, name))),
        nameInput,
        h('button', { type: 'button', onclick: create }, '＋ ตัวละครใหม่')));
  }

  async function upload(expression, frame, file) {
    if (!file) return;
    if (file.type !== 'image/png') {
      errors = ['รองรับเฉพาะไฟล์ PNG (พื้นใส)'];
      render();
      return;
    }
    try {
      await api.uploadFrame(model.avatar, expression, frame, file);
      errors = [];
    } catch (error) {
      setErrors(error);
    }
  }

  function frameSlot(expression, frame) {
    const has = model.files[expression]?.includes(frame);
    const required = expression === 'default' && frame === 'idle';
    return h('label', {
      class: has ? 'slot checker filled' : 'slot',
      title: `${expression} / ${FRAME_LABELS[frame]} — คลิกหรือลากไฟล์ PNG มาวาง`,
      ondragover: (event) => event.preventDefault(),
      ondrop: (event) => {
        event.preventDefault();
        upload(expression, frame, event.dataTransfer.files[0]);
      },
    },
    has
      ? h('img', { src: `/avatars/${encodeURIComponent(model.avatar)}/${expression}/${frame}.png?v=${model.imageRev}`, alt: '' })
      : h('span', {}, required ? 'จำเป็น ＋' : '＋'),
    h('input', { type: 'file', accept: 'image/png', hidden: true, onchange: (event) => upload(expression, frame, event.target.files[0]) }));
  }

  function imagesPanel() {
    const rows = ['default', ...Object.keys(draft.expressions)];
    return panel('รูปภาพ',
      h('table', { class: 'frames' },
        h('thead', {}, h('tr', {}, h('th', {}, 'สีหน้า'), FRAME_NAMES.map((frame) => h('th', {}, FRAME_LABELS[frame])))),
        h('tbody', {}, rows.map((expression) => h('tr', {},
          h('th', {}, expression),
          FRAME_NAMES.map((frame) => h('td', {}, frameSlot(expression, frame))))))),
      h('p', { class: 'hint' }, 'PNG พื้นใส ขนาดเท่ากันทุกรูป ตัวละครอยู่ตำแหน่งเดียวกัน ขั้นต่ำต้องมี default / เงียบ ช่องที่ว่างจะใช้รูปสำรองให้อัตโนมัติ'));
  }

  function expressionRow(name, def) {
    return h('div', { class: 'row' },
      h('strong', { class: 'name' }, name),
      h('select', {
        onchange: (event) => change((d) => {
          const mode = event.target.value;
          d.expressions[name] = mode === 'timed' ? { key: def.key, mode, seconds: def.seconds ?? 3 } : { key: def.key, mode };
        }),
      },
      h('option', { value: 'timed', selected: def.mode === 'timed' }, 'แสดงชั่วคราว'),
      h('option', { value: 'toggle', selected: def.mode === 'toggle' }, 'กดเปิด / กดปิด')),
      def.mode === 'timed'
        ? h('label', {},
          h('input', { type: 'number', min: 0.5, max: 60, step: 0.5, value: def.seconds, onchange: (event) => change((d) => { d.expressions[name].seconds = Number(event.target.value); }) }),
          ' วินาที')
        : null,
      keyButton(`expression:${name}`, def.key, (key) => change((d) => { if (d.expressions[name]) d.expressions[name].key = key; })),
      h('button', { type: 'button', onclick: () => send({ type: 'expression', name }) }, 'ทดลอง'),
      h('button', { type: 'button', class: 'danger', onclick: () => change((d) => { delete d.expressions[name]; }) }, 'ลบ'));
  }

  function expressionsPanel() {
    const nameInput = h('input', { placeholder: 'ชื่อสีหน้า เช่น happy', maxlength: 32 });
    const add = () => {
      const name = nameInput.value.trim().toLowerCase();
      if (name === 'default' || !NAME_PATTERN.test(name) || draft.expressions[name]) {
        errors = [`ชื่อสีหน้า${NAME_HINT} ห้ามซ้ำ และห้ามใช้ default`];
        render();
        return;
      }
      change((d) => { d.expressions[name] = { key: null, mode: 'timed', seconds: 3 }; });
    };
    return panel('สีหน้า',
      Object.entries(draft.expressions).map(([name, def]) => expressionRow(name, def)),
      h('div', { class: 'row' },
        nameInput,
        h('button', { type: 'button', onclick: add }, '＋ เพิ่มสีหน้า'),
        h('button', { type: 'button', onclick: () => send({ type: 'expression', name: 'default' }) }, 'กลับสีหน้าปกติ')),
      h('p', { class: 'hint' }, 'แนะนำปุ่ม F1–F12 หรือกดคู่กับ Ctrl/Alt เพื่อไม่ให้ชนปุ่มที่ใช้เล่นเกม'));
  }

  function actionsPanel() {
    return panel('ท่า (ไม่ต้องมีรูปเพิ่ม)', BUILTIN_ACTIONS.map((name) => {
      const def = draft.actions[name];
      return h('div', { class: 'row' },
        h('label', { class: 'name' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(def),
            onchange: (event) => change((d) => {
              if (event.target.checked) d.actions[name] = { key: null };
              else delete d.actions[name];
            }),
          }),
          ` ${ACTION_LABELS[name]}`),
        def ? keyButton(`action:${name}`, def.key, (key) => change((d) => { if (d.actions[name]) d.actions[name].key = key; })) : null,
        h('button', { type: 'button', onclick: () => send({ type: 'action', name }) }, 'ทดลอง'));
    }));
  }

  function motionPanel() {
    const motion = draft.motion;
    const bounceOut = h('output', {}, `${motion.talkBounce}px`);
    return panel('ขยับอัตโนมัติ',
      h('label', { class: 'row' },
        h('input', { type: 'checkbox', checked: motion.breathe, onchange: (event) => change((d) => { d.motion.breathe = event.target.checked; }) }),
        ' หายใจ'),
      h('label', { class: 'row' }, 'เด้งตอนพูด ',
        h('input', {
          type: 'range', min: 0, max: 40, step: 1, value: motion.talkBounce,
          oninput: (event) => { bounceOut.textContent = `${event.target.value}px`; },
          onchange: (event) => change((d) => { d.motion.talkBounce = Number(event.target.value); }),
        }),
        bounceOut),
      h('label', { class: 'row' }, 'กระพริบตาทุก ',
        h('input', { type: 'number', min: 0.5, max: 30, step: 0.5, value: motion.blinkEvery[0], onchange: (event) => change((d) => { d.motion.blinkEvery = [Number(event.target.value), d.motion.blinkEvery[1]]; }) }),
        ' ถึง ',
        h('input', { type: 'number', min: 0.5, max: 30, step: 0.5, value: motion.blinkEvery[1], onchange: (event) => change((d) => { d.motion.blinkEvery = [d.motion.blinkEvery[0], Number(event.target.value)]; }) }),
        ' วินาที'));
  }

  function render() {
    const errorBox = errors.length ? h('div', { class: 'errors' }, errors.map((text) => h('div', {}, `✗ ${text}`))) : null;
    if (!model?.avatar || !draft) {
      container.replaceChildren(...[errorBox, avatarPanel()].filter(Boolean));
      return;
    }
    container.replaceChildren(...[errorBox, avatarPanel(), imagesPanel(), expressionsPanel(), actionsPanel(), motionPanel()].filter(Boolean));
  }

  return {
    setModel(message) {
      const unchanged = model && draft
        && message.avatar === model.avatar
        && message.imageRev === model.imageRev
        && JSON.stringify(message.config) === JSON.stringify(draft);
      model = message;
      if (unchanged) return; // ข้อความยืนยันการบันทึกของเราเอง ไม่ต้องวาดใหม่ (กันช่องกรอกเสียโฟกัส)
      draft = message.config ? structuredClone(message.config) : null;
      render();
    },
    setAvatars(names) {
      avatars = names;
      render();
    },
  };
}
```

- [ ] **Step 2: Wire the editor into `public/studio/studio.js`**

Add the import after the other imports:

```js
import { createEditor } from '/studio/editor.js';
```

Replace the line `const preview = createRenderer($('preview'));` with:

```js
const preview = createRenderer($('preview'));
const editor = createEditor($('editor'), {
  api,
  send: (message) => socket.send(message),
  onSelectAvatar: selectAvatar,
});
```

In the `onMessage` handler, replace `if (message.type === 'config') preview.setModel(message);` with:

```js
    if (message.type === 'config') {
      preview.setModel(message);
      editor.setModel(message);
    }
```

Add this function just above the `// ---- ไมค์ ----` comment (function declarations are hoisted, so `createEditor` can receive it before this line runs):

```js
async function selectAvatar(name) {
  settings = await api.saveSettings({ ...settings, activeAvatar: name });
  editor.setAvatars((await api.listAvatars()).avatars);
}
```

At the end of the file, after `restartMic();`, add:

```js
editor.setAvatars((await api.listAvatars()).avatars);
```

- [ ] **Step 3: Verify in the browser**

With `node src/cli.js` running and `/studio/` open (reload it):
1. The editor column shows ตัวละคร (select = `sample`), รูปภาพ table with thumbnails for default (4) / happy (2) / shock (1), สีหน้า rows `happy` (F1, 4 s) and `shock` (F2, 2 s), ท่า with กระโดด/สั่น ticked, ขยับอัตโนมัติ.
2. Click `ทดลอง` on happy → preview smiles for 4 s. Click ทดลอง on หมุน → preview spins once.
3. Click `ปุ่ม: F1` on happy, press `F2` → red box: `สีหน้า shock: ปุ่ม F2 ซ้ำกับสีหน้า happy` (or the reverse owner order). Press the button again and choose `F3` → error clears; `avatars/sample/avatar.json` now has `"key": "F3"` for happy.
4. Switch to a game or Notepad window and press `F3` → the preview (and `/avatar/` if open) smiles. Press `F5` → jump.
5. Add expression `angry`, set mode `กดเปิด / กดปิด`, set key `F4`; a new `angry` row appears in รูปภาพ. Drag `avatars/sample/shock/idle.png` from Explorer into angry / เงียบ → thumbnail appears; press F4 twice → angry on, then off.
6. Drag a `.jpg` file into a slot → red box `รองรับเฉพาะไฟล์ PNG (พื้นใส)`.
7. Create a new avatar `test-2` → select switches to it, warning `ยังไม่มีรูป default / เงียบ` appears, preview empty. Upload any PNG into default / เงียบ → warning disappears, preview shows it. Switch back to `sample`.
8. Untick หายใจ, set เด้งตอนพูด to 20, blink 1–2 s → preview reacts after each change; reload the page → values kept.
9. Edit `avatars/sample/avatar.json` by hand to contain `{ nope`, restart the server → the studio shows a yellow warning naming `sample/avatar.json` and the character still shows with no expressions. Fix it by setting any value in the editor (this re-saves a valid file) and confirm the warning clears.

- [ ] **Step 4: Run the automated tests**

Run: `npm test`
Expected: PASS (no regressions)

- [ ] **Step 5: Commit**

```bash
git add public/studio/editor.js public/studio/studio.js
git commit -m "feat: add studio editor for avatars, images, expressions, hotkeys and motion"
```

---

### Task 12: Launcher, README and OBS setup guide

**Files:**
- Create: `start.bat`
- Create: `README.md`
- Create: `OBS-SETUP.md`

**Interfaces:**
- Consumes: `npm start` (Task 8), URLs `/studio/` and `/avatar/`.
- Produces: user documentation; no code interfaces.

- [ ] **Step 1: Create `start.bat`** (save as UTF-8; `chcp 65001` makes Thai text display)

```bat
@echo off
chcp 65001 >nul
rem ดับเบิลคลิกไฟล์นี้เพื่อเปิด Avata-Overlay
cd /d "%~dp0"
title Avata-Overlay

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ไม่พบ Node.js ในเครื่อง
  echo  กำลังเปิดหน้าดาวน์โหลด ให้ติดตั้งรุ่น LTS แล้วดับเบิลคลิก start.bat อีกครั้ง
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

set NEED_INSTALL=
if not exist "node_modules\ws" set NEED_INSTALL=1
if not exist "node_modules\uiohook-napi" set NEED_INSTALL=1
if defined NEED_INSTALL (
  echo.
  echo  กำลังติดตั้งส่วนประกอบ ^(ครั้งแรกใช้เวลาสักครู่ ต้องต่ออินเทอร์เน็ต^) ...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  ติดตั้งไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง
    pause
    exit /b 1
  )
)

echo.
echo  กำลังเปิด Avata-Overlay ... เบราว์เซอร์จะเปิดหน้าควบคุมขึ้นมาเอง
echo  เปิดหน้าต่างนี้ค้างไว้ตลอดตอนสตรีม
echo.
call npm start
pause
```

- [ ] **Step 2: Create `README.md`**

````markdown
# Avata-Overlay

ตัวการ์ตูนแบบ PNGtuber สำหรับสตรีมเกมโดยไม่ต้องมีกล้อง ปากขยับตามเสียงไมค์ กระพริบตาและหายใจเอง กดปุ่มลัดเปลี่ยนสีหน้าได้ระหว่างเล่นเกม แล้วใส่เข้า OBS เป็นพื้นหลังโปร่งใส

ตั้งค่า OBS ครั้งแรกดูที่ **[OBS-SETUP.md](OBS-SETUP.md)**

## ติดตั้งและเปิดใช้งาน

ต้องมี [Node.js](https://nodejs.org) รุ่น LTS (18 ขึ้นไป)

- **Windows:** ดับเบิลคลิก **`start.bat`** ครั้งแรกจะติดตั้งส่วนประกอบให้เอง แล้วเปิดหน้าควบคุมในเบราว์เซอร์
- **ใช้คำสั่งเอง:** `npm install` ครั้งเดียว แล้ว `npm start`

| หน้า | ใช้ทำอะไร |
|---|---|
| `http://127.0.0.1:5180/studio/` | หน้าควบคุม เปิดค้างไว้ใน Chrome/Edge ตลอดตอนสตรีม (ย่อหน้าต่างได้) |
| `http://127.0.0.1:5180/avatar/` | ใส่ใน OBS เป็น Browser Source |

> หน้าต่างสีดำ (Terminal) และหน้าควบคุมต้องเปิดค้างไว้ ถ้าปิดหน้าควบคุม ตัวละครจะหุบปากค้างไว้ (ไม่หายจากจอ)

ครั้งแรกระบบจะสร้างตัวละครตัวอย่าง `sample` ให้ทดลองใช้ได้ทันที

## เตรียมรูปตัวละครของตัวเอง

- PNG พื้นใส ขนาดเท่ากันทุกรูป (แนะนำ 1000×1000) ตัวละครอยู่ตำแหน่งเดียวกันทุกรูป
- ขั้นต่ำ 2 รูป: **เงียบ** (หุบปาก) และ **พูด** (อ้าปาก)
- เพิ่มได้: **หลับตา** และ **พูด+หลับตา** เพื่อให้กระพริบตา

| ช่อง | ใช้ตอน | ถ้าไม่มี |
|---|---|---|
| เงียบ | เงียบ ตาเปิด | ต้องมีในสีหน้า default |
| พูด | กำลังพูด | ใช้รูปเงียบ (ตัวยังเด้งตามเสียง) |
| หลับตา | กระพริบตาตอนเงียบ | ไม่กระพริบ |
| พูด+หลับตา | กระพริบตาตอนพูด | ใช้รูปพูด |

สีหน้าอื่น (เช่น happy) ใส่รูปไม่ครบก็ได้ ช่องที่ว่างจะใช้รูปจาก default แทน

## ใช้หน้าควบคุม

1. **ตัวละคร:** เลือกตัวที่ใช้ หรือพิมพ์ชื่อภาษาอังกฤษตัวเล็ก (a-z, 0-9, -) แล้วกด ＋ ตัวละครใหม่
2. **รูปภาพ:** ลากไฟล์ PNG มาวางในช่อง หรือคลิกช่องเพื่อเลือกไฟล์
3. **ไมค์:** เลือกไมค์ พูดดูแถบสีเขียว แล้วตั้งเส้นสีแดงให้อยู่เหนือเสียงรบกวนตอนเงียบ (คลิกบนแถบได้เลย) ถ้าปากปิดเร็วเกินระหว่างพูด ให้เพิ่ม "หน่วงปิดปาก"
4. **สีหน้า:** เพิ่มชื่อสีหน้า เลือกแบบ
   - **แสดงชั่วคราว:** กดแล้วแสดงตามวินาทีที่ตั้ง แล้วกลับหน้าปกติ (กดซ้ำระหว่างนั้น = นับเวลาใหม่)
   - **กดเปิด / กดปิด:** กดครั้งแรกเปิด กดอีกครั้งกลับหน้าปกติ
5. **ปุ่มลัด:** กด "ตั้งปุ่มลัด" แล้วกดปุ่มที่ต้องการ (Esc = ล้าง) ใช้ได้ F1–F24, A–Z, 0–9 และกดคู่ Ctrl/Alt/Shift ได้ ปุ่มลัดทำงานแม้กำลังเล่นเกมอยู่
6. **ท่า:** ติ๊กท่าที่ต้องการ (กระโดด สั่น หมุน เด้งดึ๋ง) แล้วตั้งปุ่มลัด ไม่ต้องมีรูปเพิ่ม
7. **ขยับอัตโนมัติ:** เปิด/ปิดการหายใจ ความแรงการเด้งตอนพูด และช่วงเวลากระพริบตา

ทุกอย่างบันทึกเองทันที ถ้ามีกล่องสีแดงแปลว่าค่าที่ใส่ใช้ไม่ได้ (เช่น ปุ่มลัดซ้ำ) แก้ตามข้อความแล้วจะบันทึกเอง

## แก้ปัญหา

| อาการ | วิธีแก้ |
|---|---|
| แถบ "ไมค์ ✗" | กดไอคอนข้างช่อง URL เลือกอนุญาตไมโครโฟน แล้วรีเฟรช |
| ปากไม่ขยับตอนเล่นเกม | อย่าปิดแท็บหน้าควบคุม (ย่อได้) ตรวจว่าแถบสถานะยังเป็น "ไมค์ ✓" |
| ปุ่มลัดไม่ทำงานในเกม | ถ้าเปิดอีมูเลเตอร์แบบ Run as administrator ต้องเปิด `start.bat` แบบ Run as administrator ด้วย |
| "พอร์ต 5180 ถูกใช้อยู่" | ปิดหน้าต่าง Avata-Overlay ที่เปิดซ้อนไว้ หรือรัน `npm start -- --port 5181` แล้วแก้ URL ใน OBS ให้ตรง |
| แถบเหลืองบอกว่า avatar.json เสีย | แก้ค่าอะไรก็ได้ในหน้าควบคุม ระบบจะบันทึกไฟล์ใหม่ที่ถูกต้องให้ |

## สำหรับนักพัฒนา

```bash
npm test              # unit + integration tests
npm run sample        # สร้าง avatars/sample ใหม่ (เพิ่ม -- --force เพื่อเขียนทับ)
```

ไฟล์ของผู้ใช้ (`avatars/`, `settings.json`) ไม่ถูกเก็บใน git ถ้าต้องการสำรองตัวละคร ให้คัดลอกโฟลเดอร์ `avatars/` ไว้เอง
````

- [ ] **Step 3: Create `OBS-SETUP.md`**

```markdown
# ตั้งค่า OBS สำหรับสตรีมเกมด้วยตัวการ์ตูน

ทำตามทีละขั้นครั้งแรกครั้งเดียว OBS จะจำค่าไว้

## 1. ติดตั้ง OBS Studio

1. ดาวน์โหลดจาก https://obsproject.com (ฟรี) แล้วติดตั้ง
2. เปิดครั้งแรกจะมี Auto-Configuration Wizard ให้เลือก **Optimize for streaming** แล้วกด Next ตามที่โปรแกรมแนะนำ

## 2. สร้าง Scene เกม

1. ช่อง **Scenes** (ล่างซ้าย) กด **+** ตั้งชื่อ `เกม`
2. ช่อง **Sources** กด **+** → **Window Capture** ตั้งชื่อ `จอเกม`
3. ช่อง Window เลือกหน้าต่าง MuMu หรือ LDPlayer
4. Capture Method เลือก **Windows 10 (1903 and up)** ถ้าจอดำให้ลองเปลี่ยนเป็นแบบอื่น
5. คลิกขวาที่ `จอเกม` → **Transform → Fit to screen**

## 3. ตั้งไมค์

1. **Settings → Audio → Mic/Auxiliary Audio** เลือกไมค์ตัวเดียวกับที่เลือกในหน้าควบคุม
2. ใน **Audio Mixer** กดฟันเฟืองของ Mic/Aux → **Filters** → **+** → **Noise Suppression** (เลือก RNNoise)
3. พูดทดสอบ แถบในช่อง Audio Mixer ควรขึ้นถึงช่วงสีเหลืองตอนพูดดัง ไม่ถึงสีแดง

## 4. ใส่ตัวการ์ตูน

1. ดับเบิลคลิก `start.bat` ให้หน้าควบคุมเปิดขึ้นมา แล้วกด **คัดลอก URL สำหรับ OBS**
2. ใน OBS ช่อง **Sources** กด **+** → **Browser** ตั้งชื่อ `ตัวการ์ตูน`
3. วาง URL `http://127.0.0.1:5180/avatar/` ในช่อง URL
4. Width `1000` Height `1000`
5. ติ๊ก **Refresh browser when scene becomes active**
6. ลบข้อความในช่อง **Custom CSS** ให้ว่าง (ค่าเริ่มต้นของ OBS ทำให้พื้นหลังใสอยู่แล้ว)
7. กด OK แล้วลากตัวการ์ตูนไปไว้มุมจอ ย่อขนาดด้วยการลากมุมกรอบสีแดง
8. ให้ `ตัวการ์ตูน` อยู่เหนือ `จอเกม` ในรายการ Sources
9. แถบสถานะในหน้าควบคุมจะขึ้น **OBS: 1**

## 5. ตั้งค่าสตรีม

1. **Settings → Stream** เลือกแพลตฟอร์ม (YouTube / Twitch / Facebook ฯลฯ) แล้วกด Connect Account หรือวาง Stream Key จากหน้าเว็บแพลตฟอร์ม
2. **Settings → Output** ค่าเริ่มต้นสำหรับเน็ตบ้านทั่วไป
   - Video Bitrate: `4500 Kbps` (เน็ตอัปโหลดช้ากว่า 10 Mbps ให้ลดเหลือ `2500`)
   - Encoder: เลือกแบบที่มีคำว่า **NVENC** (การ์ดจอ NVIDIA), **AMF** (AMD) หรือ **QuickSync** (Intel) ถ้ามี จะไม่กินแรงเครื่องตอนเล่นเกม
3. **Settings → Video**
   - Output (Scaled) Resolution: `1280x720`
   - Common FPS Values: `30`

## 6. อัดทดลองก่อนไลฟ์จริง

กด **Start Recording** อัดสัก 1–2 นาทีระหว่างเล่นเกมและพูด แล้วไล่ตามรายการนี้:

- [ ] พื้นหลังรอบตัวการ์ตูนใส ไม่มีกรอบขาวหรือดำ
- [ ] ปากขยับตามเสียงขณะเกมอยู่หน้าสุด และหน้าควบคุมถูกย่ออยู่ ไม่ช้ากว่าเสียงจนรู้สึกได้
- [ ] ตัวการ์ตูนกระพริบตาและหายใจตอนเงียบ
- [ ] กดปุ่มลัดระหว่างเล่นเกม (เช่น F1) แล้วสีหน้าเปลี่ยน และกลับหน้าปกติเอง
- [ ] กดปุ่มลัดท่า (เช่น F5) แล้วตัวการ์ตูนกระโดด
- [ ] ปิดหน้าต่างสีดำแล้วเปิด `start.bat` ใหม่ระหว่างอัด ตัวการ์ตูนยังอยู่บนจอ และกลับมาขยับเองภายในไม่กี่วินาที
- [ ] เสียงในคลิปที่อัดได้ยินชัด ไม่มีเสียงซ่า

ผ่านครบแล้วกด **Start Streaming** ได้เลย
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, all test files (keys, voice-gate, frames, state, config, hotkeys, make-sample, server)

- [ ] **Step 5: Verify the launcher from a clean install**

1. Close any running server. Delete `node_modules`, `avatars` and `settings.json`.
2. Double-click `start.bat`. Expected: Thai text displays correctly, `npm install` runs, the sample avatar is created, the studio opens in the browser with all pills green after allowing the mic.

- [ ] **Step 6: Run the manual checklist**

Go through section 6 of `OBS-SETUP.md` with OBS installed. Record each item as pass/fail in the task report. Any fail is a bug for a follow-up task, not something to patch silently here.

- [ ] **Step 7: Commit**

```bash
git add start.bat README.md OBS-SETUP.md
git commit -m "docs: add launcher, Thai README and OBS setup guide"
```
