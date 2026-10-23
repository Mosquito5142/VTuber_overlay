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
