import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMapActivity, hasMapCoordinates, activityAxisMaximum, smoothActivityPath } from '../web/js/map-activity.js';

const now = new Date(2026, 8, 15, 12);
const located = occurredAt => ({ occurredAt, latitude: 39.06, longitude: 117.13 });

test('series use the exact map populations and group current records by reporting date', () => {
  const orders = [located('2026-09-09 00:00:00'), located('2026-09-15 10:00:00'), { ...located('2026-09-15 10:00:00'), latitude: 0 }, located('2026-09-01 08:00:00'), located('invalid')];
  const alerts = ['pending', 'valid', 'false', 'dispatched'].map(status => ({ occurredAt: '2026-09-15 10:00:00', status }));
  // A pending alert without coordinates still belongs to the existing pending badge.
  alerts.push({ occurredAt: '2026-09-10 11:00:00', status: 'pending' });
  const model = buildMapActivity(orders, alerts, now);
  assert.deepEqual(model.totals, { located: 4, pending: 2 });
  assert.equal(model.days[0].located, 1);
  assert.equal(model.days[1].pending, 1);
  assert.equal(model.days.at(-1).located, 1);
  assert.equal(model.days.at(-1).pending, 1);
  assert.equal(model.days.reduce((sum, day) => sum + day.located, 0), 2);
});

test('seven local calendar days include boundaries and ignore missing or out-of-window dates', () => {
  const dates = ['2026-09-08 23:59:59', '2026-09-09 00:00:00', '2026-09-15 23:59:59', '2026-09-16 00:00:00', '', 'invalid'];
  const model = buildMapActivity(dates.map(located), [], now);
  assert.equal(model.days.length, 7);
  assert.equal(model.days[0].date, '2026-09-09');
  assert.equal(model.days.at(-1).label, '今日');
  assert.equal(model.days.reduce((sum, day) => sum + day.located, 0), 2);
  const boundary = new Date(2026, 11, 31, 23, 30);
  const rollover = buildMapActivity([located(boundary.toISOString())], [], new Date(2027, 0, 2));
  assert.equal(rollover.days[0].date, '2026-12-27');
  assert.equal(rollover.days.find(day => day.date === '2026-12-31').located, 1);
});

test('invalid coordinates are excluded and changing a pending state updates both badge and curve', () => {
  for (const [latitude, longitude] of [[0, 117], [null, 117], [91, 117], [39, 181], ['invalid', 117]]) assert.equal(hasMapCoordinates({ latitude, longitude }), false);
  assert.equal(hasMapCoordinates({ latitude: '39.06', longitude: '117.13' }), true);
  const alert = { occurredAt: '2026-09-15 12:00:00', status: 'pending' };
  assert.equal(buildMapActivity([], [alert], now).days.at(-1).pending, 1);
  alert.status = 'dispatched';
  const after = buildMapActivity([], [alert], now);
  assert.equal(after.totals.pending, 0);
  assert.equal(after.days.at(-1).pending, 0);
});

test('empty data is truthful and both series determine a readable integer axis', () => {
  const empty = buildMapActivity([], [], now);
  assert.deepEqual(empty.totals, { located: 0, pending: 0 });
  assert.ok(empty.days.every(day => !day.located && !day.pending));
  for (const count of [0, 1, 7, 19, 83, 1234]) {
    const maximum = activityAxisMaximum([{ located: 1, pending: count }]);
    assert.ok(maximum >= count && maximum > 0 && Number.isInteger(maximum / 4));
  }
});

test('smooth curve passes through each measurement without overshooting spikes or zero values', () => {
  for (const values of [[0, 0, 0, 0], [0, 100, 0, 50, 0], [1, 2, 30, 31, 90], [90, 31, 30, 2, 1]]) {
    const points = values.map((y, index) => ({ x: index * 100, y }));
    const path = smoothActivityPath(points);
    const segments = [...path.matchAll(/C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)/g)];
    assert.equal(segments.length, points.length - 1);
    segments.forEach((segment, index) => {
      const [, x1, y1, x2, y2, x, y] = segment.map(Number);
      assert.equal(x, points[index + 1].x); assert.equal(y, points[index + 1].y);
      assert.ok(x1 > points[index].x && x2 < x);
      const low = Math.min(values[index], values[index + 1]), high = Math.max(values[index], values[index + 1]);
      assert.ok(y1 >= low && y1 <= high && y2 >= low && y2 <= high);
    });
  }
  assert.equal(smoothActivityPath([]), '');
});
