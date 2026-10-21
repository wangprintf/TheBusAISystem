import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadArchive, filterRoadGroups, roadTime, roadPoint, canCompare, roadMedia } from '../web/js/road-health-data.js';

const now = Date.parse('2026-10-20T12:00:00+08:00');
const image = { kind: 'image', url: 'https://example.test/evidence.jpg' };
const event = (id, extra = {}) => ({ id, category: '道路', title: '道路病害 · 路面坑洼', latitude: 39.1, longitude: 117.2,
  occurredAt: '2026-10-18 09:00:00', status: 'pending', alertMedia: [], processedMedia: [], ...extra });

test('archives only road events, deduplicates IDs, counts unusable coordinates and does not mutate input', () => {
  const rows = [event('a'), event('b', { longitude: 117.2001 }), event('far', { longitude: 117.21 }),
    event('missing', { latitude: null }), event('blank', { longitude: '' }), event('zero', { longitude: 0 }),
    event('invalid', { isValid: 0 }), event('car', { category: '机动车' }), event('a')];
  const original = structuredClone(rows);
  const result = buildRoadArchive(rows, { now });
  assert.equal(result.total, 6);
  assert.equal(result.located, 3);
  assert.equal(result.unlocated, 3);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].events.length, 2);
  assert.deepEqual(rows, original);
  assert.equal(roadPoint({ latitude: 91, longitude: 117 }), null);
});

test('fixed anchors prevent a chain of nearby reports from merging distant sites; radius changes are deterministic', () => {
  const rows = [event('a', { latitude: 39.10000 }), event('b', { latitude: 39.10035 }), event('c', { latitude: 39.10070 })];
  assert.equal(buildRoadArchive(rows, { radius: 50 }).groups.length, 2);
  assert.equal(buildRoadArchive(rows, { radius: 100 }).groups.length, 1);
  assert.deepEqual(buildRoadArchive(rows).groups, buildRoadArchive([...rows].reverse()).groups);
  assert.equal(buildRoadArchive(rows, { radius: -1 }).radius, 50);
});

test('a same-detail report after an explicit completion produces an auditable recurrence pair', () => {
  const rows = [event('fixed', { occurredAt: '2026-10-10 09:00:00', status: 'completed', finishAt: '2026-10-12 12:00:00' }), event('new')];
  const result = buildRoadArchive(rows, { now });
  assert.equal(result.recurring, 1);
  assert.equal(result.groups[0].pairs[0].before.id, 'fixed');
  assert.equal(result.groups[0].pairs[0].after.id, 'new');
  assert.equal(result.groups[0].pairs[0].days, 5.875);
});

test('missing completion, wrong chronology, different defect, generic category and old or future reports do not prove recurrence', () => {
  const fixed = event('fixed', { occurredAt: '2026-10-10 09:00:00', status: 'completed', finishAt: '2026-10-12 12:00:00' });
  const cases = [
    [{ ...fixed, finishAt: '' }, event('new')],
    [{ ...fixed, finishAt: '2026-10-09 09:00:00' }, event('new')],
    [fixed, event('new', { occurredAt: '2026-10-11 09:00:00' })],
    [fixed, event('new', { title: '道路病害 · 井盖缺失' })],
    [{ ...fixed, title: '道路病害' }, event('new', { title: '道路病害' })],
    [{ ...fixed, occurredAt: '2026-08-01 09:00:00', finishAt: '2026-08-02 12:00:00' }, event('new')],
    [fixed, event('new', { occurredAt: '2026-10-21 09:00:00' })],
    [{ ...fixed, status: 'processing' }, event('new')],
  ];
  for (const rows of cases) assert.equal(buildRoadArchive(rows, { now }).recurring, 0, JSON.stringify(rows));
});

test('two events in one anchor area still require pairwise proximity for recurrence', () => {
  const rows = [event('anchor', { occurredAt: '2026-10-01 10:00:00', title: '道路设施 · 护栏损坏' }),
    event('fixed', { latitude: 39.09960, occurredAt: '2026-10-10 09:00:00', status: 'completed', finishAt: '2026-10-12 12:00:00' }),
    event('new', { latitude: 39.10040 })];
  const result = buildRoadArchive(rows, { now });
  assert.equal(result.groups.length, 1);
  assert.equal(result.recurring, 0);
});

test('comparison requires both media sets on the same order and keeps returned work orders', () => {
  const rows = [event('before', { alertMedia: [image] }), event('after', { processedMedia: [image] }),
    event('both', { alertMedia: [image], processedMedia: [image] }),
    event('rework', { isValid: 0, remarks: '人工判定/审核结果：不合格', status: 'pending' }),
    event('later-invalid', { isValid: 0, remarks: '人工判定/审核结果：不合格；人工判定/审核结果：无效' })];
  const result = buildRoadArchive(rows, { now });
  assert.equal(result.total, 4);
  assert.equal(result.comparable, 1);
  assert.equal(canCompare(rows[0]), false);
  assert.equal(roadMedia(event('unsafe', { alertMedia: [{ kind: 'image', url: 'javascript:alert(1)' }] }), 'alertMedia').length, 0);
});

test('filters search IDs and coordinates and combine with recurrence/open/comparable state', () => {
  const result = buildRoadArchive([event('id-123', { alertMedia: [image], processedMedia: [image] }), event('other', { longitude: 117.3, status: 'completed' })], { now });
  assert.equal(filterRoadGroups(result.groups, { keyword: 'ID-123', filter: 'comparable' }).length, 1);
  assert.equal(filterRoadGroups(result.groups, { keyword: '117.30000', filter: 'open' }).length, 0);
  assert.equal(filterRoadGroups(result.groups, { filter: 'recurring' }).length, 0);
  assert.equal(buildRoadArchive([]).groups.length, 0);
  assert.equal(roadTime('2026-10-20 08:30:00'), Date.parse('2026-10-20T00:30:00Z'));
  assert.ok(Number.isNaN(roadTime('--')));
});
