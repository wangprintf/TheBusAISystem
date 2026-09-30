import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPriorityTrend, priorityAxisMaximum, priorityDaySummary} from '../web/js/priority-trend.js';

const now = new Date(2026, 8, 13, 12);
test('daily stacked counts include every priority, zero days and unknown values', () => {
  const events = ['高', '高', '高', '中', '低', '普通', null].map(priority_level => ({report_time: '2026-09-12 11:00:00', priority_level}));
  events.push({report_time: '2026-09-13 10:00:00', priority_level: '高'});
  const days = buildPriorityTrend(events, now);
  assert.equal(days.length, 7);
  assert.equal(days[0].date, '2026-09-07');
  assert.equal(days[6].label, '今日');
  assert.equal(days[0].total, 0);
  assert.deepEqual(days[5].counts, {high: 3, medium: 1, low: 1, unknown: 2});
  assert.equal(days[5].total, 7);
  assert.equal(days[6].total, 1);
  for (const day of days) assert.equal(Object.values(day.counts).reduce((a, b) => a + b, 0), day.total);
});

test('range includes start-of-day and excludes next day, earlier records and invalid timestamps', () => {
  const events = ['2026-09-07 00:00:00', '2026-09-13 23:59:59', '2026-09-14 00:00:00', '2026-09-06 23:59:59', 'invalid', ''].map(report_time => ({report_time, priority_level: '高'}));
  const days = buildPriorityTrend(events, now);
  assert.equal(days[0].total, 1);
  assert.equal(days[6].total, 1);
  assert.equal(days.reduce((sum, day) => sum + day.total, 0), 2);
});

test('year/month rollover and offset timestamps use the same local calendar as the dashboard', () => {
  const current = new Date(2027, 0, 2, 12);
  const eventTime = new Date(2026, 11, 31, 23, 30);
  const days = buildPriorityTrend([{report_time: eventTime.toISOString(), priority_level: ' 中 '}], current);
  assert.equal(days[0].date, '2026-12-27');
  assert.equal(days.find(day => day.date === '2026-12-31').counts.medium, 1);
});

test('axis uses integer ticks, covers all totals, and stays nonzero for empty data', () => {
  for (const count of [0, 1, 3, 7, 13, 50, 123, 9000]) {
    const maximum = priorityAxisMaximum([{total: count}]);
    assert.ok(maximum >= count && maximum > 0);
    assert.ok(Number.isInteger(maximum / 4));
  }
});

test('tooltip summary lists all three priorities even when counts are zero', () => {
  const day = buildPriorityTrend([{report_time: '2026-09-13 10:00:00', priority_level: '高'}], now).at(-1);
  const summary = priorityDaySummary(day);
  assert.match(summary, /总计 1 条/);
  for (const phrase of ['高 1 条', '中 0 条', '低 0 条']) assert.ok(summary.includes(phrase));
  assert.ok(!summary.includes('未分级'));
});

test('API uses the same event rows for totals and priority stacks without extra HTTP reads', async t => {
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = {getItem: () => '{"token":"chart-test"}'};
  t.after(() => { if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; });
  let calls = 0;
  const today = new Date();
  const timestamp = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')} 10:00:00`;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    return new Response(JSON.stringify(new URL(url).pathname === '/api/devices' ? [] : ['高','高','中','低'].map((priority_level,id) => ({id, report_time:timestamp, priority_level, is_valid: id === 0 ? 0 : null}))));
  });
  const {api} = await import('../web/js/api.js?priority-test');
  const dashboard = await api.getDashboard();
  assert.equal(calls, 2);
  assert.deepEqual(dashboard.trend, dashboard.priorityTrend.map(day => day.total));
  assert.deepEqual(dashboard.priorityTrend.at(-1).counts, {high:2, medium:1, low:1, unknown:0});
});
