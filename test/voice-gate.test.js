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
