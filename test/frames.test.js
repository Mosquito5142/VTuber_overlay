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
