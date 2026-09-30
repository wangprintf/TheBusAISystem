import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeviceHealth, deviceState, deviceReason, deviceSliceGeometry } from '../web/js/device-health.js';
import { dashboardOrderQueue } from '../web/js/dashboard-orders.js';

test('device states stay disjoint and preserve unrecognized records explicitly', () => {
  const rows = ['正常', '在线', ' ONLINE ', '异常', 'warning', 'abnormal', '离线', 'offline', '未知', ''].map((status, id) => ({ id, status }));
  const model = buildDeviceHealth(rows);
  assert.deepEqual(model.groups.map(group => group.count), [3, 3, 2]);
  assert.equal(model.unknown, 2);
  assert.equal(model.total, 10);
  assert.equal(model.groups.reduce((sum, group) => sum + group.percent, 0), 100);
  assert.equal(deviceState({ status: '异常', abnormalInfo: '异常下线' }), 'abnormal');
});

test('empty and single-state distributions do not create fake sectors or NaN', () => {
  assert.ok(buildDeviceHealth([]).groups.every(group => group.percent === 0));
  const model = buildDeviceHealth([{ status: '离线' }]);
  assert.deepEqual(model.groups.map(group => group.percent), [0, 0, 100]);
  assert.equal(model.groups[2].color, '#94a0ae');
});

test('abnormal reasons use reported values and explicitly state missing reasons', () => {
  assert.equal(deviceReason({ status: '异常', abnormalInfo: ' 摄像头信号丢失 ' }), '摄像头信号丢失');
  assert.equal(deviceReason({ status: '异常', abnormalInfo: '  ' }), '暂未上报异常原因');
  assert.match(deviceReason({ status: '离线' }), /设备离线/);
});

test('a full pie has two top arcs, visible depth and no radial seam', () => {
  const geometry = deviceSliceGeometry(-Math.PI / 2, 1.5 * Math.PI);
  assert.equal((geometry.top.match(/A /g) || []).length, 2);
  assert.ok(!geometry.top.includes('L'));
  assert.ok(geometry.wall.includes('A 111 56'));
  assert.equal(geometry.edge, '');
  assert.deepEqual(geometry.label, [170, 83]);
});

test('zero and very small slices remain finite; rear slices have no front wall', () => {
  assert.equal(deviceSliceGeometry(0, 0).top, '');
  assert.equal(deviceSliceGeometry(-Math.PI / 2, 0).wall, '');
  for (const fraction of [0.0001, 0.1, 0.5, 0.9999]) {
    const geometry = deviceSliceGeometry(-Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2);
    assert.ok(geometry.top.endsWith('Z'));
    assert.ok(!JSON.stringify(geometry).match(/NaN|Infinity/));
  }
});

test('work order queue favors unfinished urgent work without mutating the source', () => {
  const rows = [
    { id: 'done', status: 'completed', priority: '高' },
    { id: 'low', status: 'pending', priority: '低' },
    { id: 'older', status: 'processing', priority: '中', occurredAt: '2026-09-12 12:00:00' },
    { id: 'newer', status: 'review', priority: '中', occurredAt: '2026-09-13 12:00:00' },
    { id: 'urgent', status: 'pending', priority: '高' },
  ];
  assert.deepEqual(dashboardOrderQueue(rows).map(row => row.id), ['urgent', 'newer', 'older', 'low', 'done']);
  assert.equal(rows[0].id, 'done');
  assert.equal(dashboardOrderQueue(Array.from({ length: 12 }, (_, id) => ({ id }))).length, 6);
});
