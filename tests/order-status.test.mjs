import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderStatus, orderRingGeometry, orderRingCallouts } from '../web/js/order-status.js';

test('realistic two-state totals retain both zero-count stages without fake segments', () => {
  const model = buildOrderStatus(Array.from({ length: 46 }, (_, index) => ({ id: index, status: index < 38 ? 'pending' : 'processing' })));
  assert.equal(model.total, 46);
  assert.deepEqual(model.groups.map(group => group.count), [38, 8, 0, 0]);
  assert.equal(model.groups[0].percent.toFixed(1), '82.6');
  assert.equal(model.groups[1].percent.toFixed(1), '17.4');
  assert.equal(model.unknown, 0);
});

test('empty and unknown-only data have no percentages; each real order belongs to one stage', () => {
  for (const rows of [[], [{ status: 'unknown' }]]) assert.ok(buildOrderStatus(rows).groups.every(group => group.percent === 0));
  const model = buildOrderStatus(['pending', 'processing', 'review', 'completed', 'other'].map(status => ({ status })));
  assert.equal(model.total, 5); assert.equal(model.knownTotal, 4); assert.equal(model.unknown, 1);
  assert.equal(model.groups.reduce((total, group) => total + group.percent, 0), 100);
});

test('a full ring keeps a separate inner contour and has no radial seam', () => {
  const geometry = orderRingGeometry(-Math.PI / 2, Math.PI * 1.5);
  assert.equal((geometry.top.match(/M /g) || []).length, 2);
  assert.equal((geometry.top.match(/A 101 57/g) || []).length, 2);
  assert.equal((geometry.top.match(/A 51 29/g) || []).length, 2);
  assert.equal(geometry.edge, '');
  assert.ok(geometry.outerWall.length > 0 && geometry.innerWall.length > 0);
});

test('zero, tiny and nearly complete annular sectors remain finite with a hole', () => {
  assert.equal(orderRingGeometry(0, 0).top, '');
  for (const fraction of [0.0001, 0.08, 0.5, 0.826, 0.9999]) {
    const shape = orderRingGeometry(-Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2);
    assert.match(shape.top, /A 51 29/);
    assert.ok(!JSON.stringify(shape).match(/NaN|Infinity/));
  }
});

test('crowded labels stay separated and zero states do not acquire callouts', () => {
  const rows = [1, 1.05, 1.08, 1.09].map((middle, key) => ({ key, middle, anchor: [200, 100], count: 1 }));
  rows.push({ key: 'empty', middle: 1, anchor: [200, 100], count: 0 });
  const labels = orderRingCallouts(rows).sort((a, b) => a.y - b.y);
  assert.equal(labels.length, 4);
  assert.ok(labels.every(label => label.y >= 28 && label.y <= 190));
  labels.slice(1).forEach((label, index) => assert.ok(label.y - labels[index].y >= 30));
});
