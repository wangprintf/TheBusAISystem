import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoverPinState } from '../web/js/hover-pin.js';

function fixture() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const callbacks = [];
  const changes = [];
  const state = createHoverPinState({
    schedule(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); callbacks.push(fn); return id; },
    cancel(id) { timers.delete(id); },
    onChange(value) { changes.push(value); },
  });
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  return { state, advance, timers, callbacks, changes };
}

test('pins only after a continuous full second on the same source', () => {
  const { state, advance } = fixture();
  state.enter('normal slice'); advance(999);
  assert.equal(state.snapshot().phase, 'preview');
  advance(1); assert.deepEqual(state.snapshot(), { phase: 'pinned', source: 'normal slice' });
});

test('leaving before one second closes immediately, regardless of destination', () => {
  for (const duration of [0, 350, 999]) {
    const { state, advance, timers } = fixture();
    state.enter('abnormal legend'); advance(duration); state.leave('abnormal legend');
    assert.equal(state.snapshot().phase, 'hidden'); assert.equal(timers.size, 0);
    advance(1500); assert.equal(state.snapshot().phase, 'hidden');
  }
});

test('moving into the popup cancels rather than extends a preview', () => {
  const { state, advance } = fixture();
  state.enter('slice'); advance(500); state.cancelPreview(); advance(1000);
  assert.equal(state.snapshot().phase, 'hidden');
});

test('moving to another control starts a fresh second, including the same-status legend', () => {
  const { state, advance } = fixture();
  state.enter('normal slice'); advance(750); state.leave('normal slice'); state.enter('normal legend');
  advance(999); assert.equal(state.snapshot().phase, 'preview');
  advance(1); assert.deepEqual(state.snapshot(), { phase: 'pinned', source: 'normal legend' });
});

test('focus or click on the same hovered control neither bypasses nor restarts the timer', () => {
  const { state, advance, changes } = fixture();
  state.enter('pending'); advance(350); state.enter('pending');
  advance(649); assert.equal(state.snapshot().phase, 'preview');
  advance(1); assert.equal(state.snapshot().phase, 'pinned');
  assert.deepEqual(changes.map(value => value.phase), ['preview', 'pinned']);
});

test('pinned state ignores leaving, outside dismissal and other controls until explicit close', () => {
  const { state, advance } = fixture();
  state.enter('processing'); advance(1000);
  state.leave('processing'); state.cancelPreview(); state.enter('completed'); advance(2000);
  assert.deepEqual(state.snapshot(), { phase: 'pinned', source: 'processing' });
  state.close(); assert.equal(state.snapshot().phase, 'hidden');
  state.enter('completed'); advance(999); assert.equal(state.snapshot().phase, 'preview');
});

test('late callbacks cannot pin after leaving, switching or destroying the chart', () => {
  const { state, advance, callbacks, timers } = fixture();
  state.enter('first'); state.leave('first'); state.enter('second');
  callbacks[0](); assert.deepEqual(state.snapshot(), { phase: 'preview', source: 'second' });
  state.destroy(); callbacks[1](); state.enter('third'); advance(2000);
  assert.equal(state.snapshot().phase, 'hidden'); assert.equal(timers.size, 0);
});

test('device and work-order popups have independent countdowns and close buttons', () => {
  const device = fixture(); const order = fixture();
  device.state.enter('device'); device.advance(1000);
  order.state.enter('order'); order.advance(500);
  device.state.close(); order.advance(500);
  assert.equal(device.state.snapshot().phase, 'hidden');
  assert.equal(order.state.snapshot().phase, 'pinned');
});
