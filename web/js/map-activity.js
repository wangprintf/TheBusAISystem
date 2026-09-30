export const MAP_ACTIVITY_SERIES = Object.freeze([
  { key: 'located', label: '已定位事件', color: '#28dbc4' },
  { key: 'pending', label: '待处置告警', color: '#50a5ff' },
]);

export function hasMapCoordinates(record) {
  const latitude = Number(record?.latitude);
  const longitude = Number(record?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0 && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

// These are the same current records counted by the map badges, grouped by
// report date. Pending counts are not historical snapshots of the backlog.
export function buildMapActivity(orders, alerts, now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const days = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + index);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return { date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, label: index === 6 ? '今日' : `${start.getMonth() + 1}/${start.getDate()}`, start: +start, end: +end, located: 0, pending: 0 };
  });
  const records = { located: orders.filter(hasMapCoordinates), pending: alerts.filter(alert => alert.status === 'pending') };
  for (const series of MAP_ACTIVITY_SERIES) {
    for (const record of records[series.key]) {
      const time = Date.parse(String(record.occurredAt ?? record.report_time ?? '').trim().replace(' ', 'T'));
      const day = days.find(day => time >= day.start && time < day.end);
      if (day) day[series.key]++;
    }
  }
  return { totals: { located: records.located.length, pending: records.pending.length }, days: days.map(({ start, end, ...day }) => day) };
}

export function activityAxisMaximum(days) {
  const maximum = Math.max(0, ...days.flatMap(day => MAP_ACTIVITY_SERIES.map(series => day[series.key])));
  const rawStep = Math.max(1, maximum / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  return [1, 2, 5, 10].find(value => value * magnitude >= rawStep) * magnitude * 4;
}

// Shape-preserving cubic interpolation: no negative counts or invented peaks
// between daily measurements, including a zero on either side of a spike.
export function smoothActivityPath(points) {
  if (!points.length) return '';
  const format = value => Number(value.toFixed(3));
  const secants = points.slice(1).map((point, index) => (point.y - points[index].y) / (point.x - points[index].x));
  const slopes = points.map((_, index) => {
    if (!index) return secants[0] || 0;
    if (index === points.length - 1) return secants.at(-1) || 0;
    const a = secants[index - 1], b = secants[index];
    return a * b <= 0 ? 0 : 2 * a * b / (a + b);
  });
  let path = `M ${format(points[0].x)} ${format(points[0].y)}`;
  points.slice(1).forEach((end, index) => {
    const start = points[index];
    const third = (end.x - start.x) / 3;
    path += ` C ${format(start.x + third)} ${format(start.y + slopes[index] * third)}, ${format(end.x - third)} ${format(end.y - slopes[index + 1] * third)}, ${format(end.x)} ${format(end.y)}`;
  });
  return path;
}

let sequence = 0;
export function mountMapActivity(container, initialModel) {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const events = new view.AbortController();
  const id = `map-activity-${++sequence}`;
  container.innerHTML = `<div class="activity-chart-meta"><span>单位：条 · 按上报日期</span><div class="activity-legend">${MAP_ACTIVITY_SERIES.map(series => `<span><i style="--series-color:${series.color}"></i>${series.label}</span>`).join('')}</div></div><div class="activity-plot"><div class="activity-grid" aria-hidden="true">${[0, 1, 2, 3, 4].map(index => `<div style="bottom:${index * 25}%"><span data-activity-tick></span></div>`).join('')}</div><svg class="activity-curves" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><defs>${MAP_ACTIVITY_SERIES.map(series => `<linearGradient id="${id}-${series.key}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${series.color}" stop-opacity=".26"/><stop offset="1" stop-color="${series.color}" stop-opacity=".02"/></linearGradient>`).join('')}</defs>${MAP_ACTIVITY_SERIES.map(series => `<path data-activity-area="${series.key}" fill="url(#${id}-${series.key})"/>`).join('')}${MAP_ACTIVITY_SERIES.map(series => `<path data-activity-line="${series.key}" fill="none" stroke="${series.color}" vector-effect="non-scaling-stroke"/>`).join('')}</svg><div class="activity-columns">${Array.from({ length: 7 }, (_, index) => `<button class="activity-column" type="button" data-activity-day="${index}">${MAP_ACTIVITY_SERIES.map(series => `<i data-activity-dot="${series.key}" style="--series-color:${series.color}"></i>`).join('')}<span class="activity-date" aria-hidden="true"></span></button>`).join('')}</div><span class="activity-empty" hidden>近 7 日暂无事件</span></div>`;
  const tooltip = doc.createElement('div');
  tooltip.className = 'activity-tooltip'; tooltip.id = `${id}-tooltip`; tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.innerHTML = `<strong></strong>${MAP_ACTIVITY_SERIES.map(series => `<div data-activity-value="${series.key}"><span><i style="--series-color:${series.color}"></i>${series.label}</span><b></b></div>`).join('')}<small>按当日上报统计，待处置为当前状态</small>`;
  doc.body.append(tooltip);
  const columns = [...container.querySelectorAll('.activity-column')];
  let model = initialModel;
  let activeDate = null;
  let anchor = null;
  function position() {
    if (!anchor) return;
    const bounds = tooltip.getBoundingClientRect();
    const x = anchor.x + 12 + bounds.width < view.innerWidth ? anchor.x + 12 : anchor.x - bounds.width - 12;
    tooltip.style.left = `${Math.max(8, Math.min(x, view.innerWidth - bounds.width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(anchor.y - bounds.height - 12, view.innerHeight - bounds.height - 8))}px`;
  }
  function paintTooltip(day) {
    tooltip.querySelector('strong').textContent = `${day.date.replaceAll('-', '/')} · 事件态势`;
    for (const series of MAP_ACTIVITY_SERIES) tooltip.querySelector(`[data-activity-value="${series.key}"] b`).textContent = `${day[series.key]} 条`;
    position();
  }
  function hide() {
    activeDate = null; tooltip.hidden = true;
    columns.forEach(column => { column.classList.remove('is-active'); column.removeAttribute('aria-describedby'); });
  }
  function show(column, point) {
    const day = model.days[Number(column.dataset.activityDay)];
    const rect = column.getBoundingClientRect();
    anchor = point || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    activeDate = day.date;
    columns.forEach(item => { item.classList.toggle('is-active', item === column); item.removeAttribute('aria-describedby'); });
    column.setAttribute('aria-describedby', tooltip.id);
    tooltip.hidden = false; paintTooltip(day);
  }
  function update(nextModel) {
    model = nextModel;
    const maximum = activityAxisMaximum(model.days);
    container.querySelectorAll('[data-activity-tick]').forEach((tick, index) => { tick.textContent = maximum * index / 4; });
    for (const series of MAP_ACTIVITY_SERIES) {
      const points = model.days.map((day, index) => ({ x: (index + .5) * 1000 / model.days.length, y: 100 - day[series.key] / maximum * 100 }));
      const path = smoothActivityPath(points);
      container.querySelector(`[data-activity-line="${series.key}"]`).setAttribute('d', path);
      container.querySelector(`[data-activity-area="${series.key}"]`).setAttribute('d', `${path} L ${points.at(-1).x} 100 L ${points[0].x} 100 Z`);
    }
    columns.forEach((column, index) => {
      const day = model.days[index];
      column.querySelector('.activity-date').textContent = day.label;
      column.setAttribute('aria-label', `${day.date}，已定位事件 ${day.located} 条，待处置告警 ${day.pending} 条`);
      for (const series of MAP_ACTIVITY_SERIES) column.querySelector(`[data-activity-dot="${series.key}"]`).style.top = `${100 - day[series.key] / maximum * 100}%`;
      column.classList.toggle('is-active', day.date === activeDate);
      if (day.date === activeDate) column.setAttribute('aria-describedby', tooltip.id); else column.removeAttribute('aria-describedby');
    });
    container.querySelector('.activity-empty').hidden = model.days.some(day => day.located || day.pending);
    if (activeDate) { const day = model.days.find(day => day.date === activeDate); if (day) paintTooltip(day); else hide(); }
  }
  columns.forEach((column, index) => {
    column.addEventListener('pointermove', event => show(column, { x: event.clientX, y: event.clientY }), { signal: events.signal });
    column.addEventListener('focus', () => show(column), { signal: events.signal });
    column.addEventListener('click', () => show(column), { signal: events.signal });
    column.addEventListener('blur', hide, { signal: events.signal });
    column.addEventListener('keydown', event => {
      if (event.key === 'Escape') hide();
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); columns[(index + (event.key === 'ArrowLeft' ? -1 : 1) + columns.length) % columns.length].focus();
    }, { signal: events.signal });
  });
  container.addEventListener('pointerleave', hide, { signal: events.signal });
  view.addEventListener('scroll', hide, { capture: true, signal: events.signal });
  view.addEventListener('resize', hide, { signal: events.signal });
  update(initialModel);
  return { update, destroy() { events.abort(); tooltip.remove(); } };
}
