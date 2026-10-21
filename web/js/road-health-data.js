const DAY = 86400000;
const EARTH = 6371000;
const radians = value => value * Math.PI / 180;
const openStatuses = new Set(['pending', 'processing', 'review']);

// Backend timestamps without a zone are Tianjin local time.
export function roadTime(value) {
  const text = String(value || '').trim();
  if (!text || text === '--') return NaN;
  const local = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(:\d{2})?)?$/);
  return Date.parse(local ? `${local[1]}T${local[2] || '00:00'}${local[3] || ':00'}+08:00` : text);
}

export function roadPoint(order) {
  if ([order.latitude, order.longitude].some(value => value == null || String(value).trim() === '')) return null;
  const latitude = Number(order.latitude), longitude = Number(order.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

export function roadDistance(a, b) {
  const dLat = radians(b.latitude - a.latitude), dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return EARTH * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function roadType(order) {
  return String(order.title || order.eventType || '未分类事件').split(/[·•]/).at(-1).trim();
}

export function roadMedia(order, side) {
  return (Array.isArray(order?.[side]) ? order[side] : []).filter(item => item && ['image', 'video'].includes(item.kind) && /^(https?:\/\/|blob:|data:image\/)/i.test(item.url || ''));
}

export function canCompare(order) {
  return roadMedia(order, 'alertMedia').length > 0 && roadMedia(order, 'processedMedia').length > 0;
}

function typeKey(order) {
  const type = roadType(order).replace(/\s+/g, '');
  return /^(道路|道路安全|道路设施|道路病害|未分类事件|未知|事件.*)$/.test(type) ? '' : type;
}

// Multiple reports alone are not recurrence. Require an explicit, plausible
// completion timestamp, a later distinct event, the same detail type and proximity.
export function recurrencePairs(events, radius, now = Date.now()) {
  const completed = events.filter(event => event.status === 'completed' && typeKey(event)
    && Number.isFinite(roadTime(event.occurredAt)) && roadTime(event.finishAt) >= roadTime(event.occurredAt)
    && roadTime(event.finishAt) <= now);
  return events.flatMap(after => {
    const reported = roadTime(after.occurredAt);
    if (!Number.isFinite(reported) || reported > now || !typeKey(after)) return [];
    const before = completed.filter(event => String(event.id) !== String(after.id)
      && typeKey(event) === typeKey(after) && reported > roadTime(event.finishAt)
      && reported - roadTime(event.finishAt) <= 30 * DAY
      && roadDistance(event, after) <= radius)
      .sort((a, b) => roadTime(b.finishAt) - roadTime(a.finishAt))[0];
    return before ? [{ before, after, days: (reported - roadTime(before.finishAt)) / DAY, distance: roadDistance(before, after) }] : [];
  });
}

function bucket(point, radius) {
  const lat = radians(point.latitude), lng = radians(point.longitude);
  return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)].map(v => Math.floor(v * EARTH / radius));
}

export function buildRoadArchive(orders, { radius = 50, now = Date.now() } = {}) {
  radius = [50, 100, 200].includes(Number(radius)) ? Number(radius) : 50;
  const unique = new Map();
  for (const order of orders || []) {
    const rejected = [order.isValid, order.reviewStatus].some(value => value != null && Number(value) === 0);
    const lastReview = [...String(order.remarks || '').matchAll(/(?:人工判定\/审核结果|人工审核结果)：(不合格|合格|无效|有效)/g)].at(-1)?.[1];
    const returned = openStatuses.has(order.status) && lastReview === '不合格';
    if (order.category !== '道路' || (rejected && !returned)) continue;
    unique.set(String(order.id), order);
  }
  const roads = [...unique.values()];
  const located = roads.filter(roadPoint).sort((a, b) => (roadTime(a.occurredAt) || Infinity) - (roadTime(b.occurredAt) || Infinity) || String(a.id).localeCompare(String(b.id)));
  const groups = [], buckets = new Map();
  for (const event of located) {
    const point = roadPoint(event), cell = bucket(point, radius), candidates = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      for (const group of buckets.get([cell[0] + x, cell[1] + y, cell[2] + z].join(',')) || []) {
        const distance = roadDistance(group, point);
        if (distance <= radius) candidates.push({ group, distance });
      }
    }
    let group = candidates.sort((a, b) => a.distance - b.distance || a.group.id.localeCompare(b.group.id))[0]?.group;
    if (!group) {
      group = { id: String(event.id), ...point, events: [] };
      groups.push(group);
      const key = cell.join(',');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(group);
    }
    // Keep the first point as the anchor: A-near-B-near-C must not create an
    // unbounded chain of unrelated roads.
    group.events.push(event);
  }
  for (const group of groups) {
    group.events.sort((a, b) => (roadTime(b.occurredAt) || -Infinity) - (roadTime(a.occurredAt) || -Infinity) || String(a.id).localeCompare(String(b.id)));
    group.latest = group.events.reduce((latest, event) => Math.max(latest, roadTime(event.occurredAt) || 0), 0);
    group.openCount = group.events.filter(event => openStatuses.has(event.status)).length;
    group.completedCount = group.events.filter(event => event.status === 'completed').length;
    group.comparisonCount = group.events.filter(canCompare).length;
    group.pairs = recurrencePairs(group.events, radius, now);
    group.types = [...new Set(group.events.map(roadType))];
    group.name = group.events.map(event => String(event.location || '').trim()).find(location => location && !/^[\d\s.,+\-]+$/.test(location) && !/未上报|位置暂缺|未知/.test(location)) || `${group.types[0]}附近`;
  }
  groups.sort((a, b) => b.pairs.length - a.pairs.length || b.openCount - a.openCount || b.latest - a.latest || a.id.localeCompare(b.id));
  return { groups, radius, total: roads.length, located: located.length, unlocated: roads.length - located.length,
    recurring: groups.filter(group => group.pairs.length).length, comparable: located.filter(canCompare).length };
}

export function filterRoadGroups(groups, { keyword = '', filter = 'all' } = {}) {
  const search = keyword.trim().toLocaleLowerCase();
  return groups.filter(group => (!search || [group.name, group.longitude.toFixed(5), group.latitude.toFixed(5), ...group.events.flatMap(event => [event.id, event.title, event.eventType, event.location])].join(' ').toLocaleLowerCase().includes(search))
    && (filter !== 'recurring' || group.pairs.length > 0)
    && (filter !== 'open' || group.openCount > 0)
    && (filter !== 'comparable' || group.comparisonCount > 0));
}
