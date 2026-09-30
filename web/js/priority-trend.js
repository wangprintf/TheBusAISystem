export const PRIORITY_SERIES = Object.freeze([
  { key: 'high', label: '高', color: '#ff5b65' },
  { key: 'medium', label: '中', color: '#ffd05b' },
  { key: 'low', label: '低', color: '#18c8df' },
  { key: 'unknown', label: '未分级', color: '#859caf' },
]);

// Use the same full event list as the dashboard, including reviewed events.
// Unknown priorities remain explicit so every event is included in the totals.
export function buildPriorityTrend(events, now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + index);
    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      label: index === 6 ? '今日' : `${date.getMonth() + 1}/${date.getDate()}`,
      start: date.getTime(),
      end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime(),
      total: 0,
      counts: Object.fromEntries(PRIORITY_SERIES.map(series => [series.key, 0])),
    };
  });
  for (const event of events) {
    const time = Date.parse(String(event.report_time ?? event.occurredAt ?? '').trim().replace(' ', 'T'));
    const day = days.find(item => time >= item.start && time < item.end);
    if (!day) continue;
    const priority = String(event.priority_level ?? event.priority ?? event.severity ?? '').trim();
    const series = PRIORITY_SERIES.find(item => item.label === priority) || PRIORITY_SERIES.at(-1);
    day.counts[series.key] += 1;
    day.total += 1;
  }
  return days.map(({ start, end, ...day }) => day);
}

export function priorityAxisMaximum(days) {
  const max = Math.max(0, ...days.map(day => day.total));
  const rawStep = Math.max(1, max / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= rawStep) * magnitude;
  return step * 4;
}

export function priorityDaySummary(day, includeUnknown = day.counts.unknown > 0) {
  return `${day.date}，总计 ${day.total} 条；${PRIORITY_SERIES.filter(series => includeUnknown || series.key !== 'unknown').map(series => `${series.label} ${day.counts[series.key]} 条`).join('，')}`;
}

let chartSequence = 0;
export function mountPriorityTrend(container, initialDays) {
  if (!container) return null;
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const events = new view.AbortController();
  const tooltipId = `priority-trend-tooltip-${++chartSequence}`;
  const legend = PRIORITY_SERIES.map(series => `<span data-legend="${series.key}"><i style="background:${series.color}"></i>${series.label}</span>`).join('');
  const segments = PRIORITY_SERIES.map(series => `<span data-segment="${series.key}" style="background:${series.color}"></span>`).join('');
  container.innerHTML = `<div class="priority-legend" aria-label="事件优先级图例">${legend}</div><div class="priority-plot"><div class="priority-grid" aria-hidden="true">${[0, 1, 2, 3, 4].map(index => `<div style="bottom:${index * 25}%"><span data-tick="${index}"></span></div>`).join('')}</div><div class="priority-columns">${Array.from({ length: 7 }, (_, index) => `<button class="priority-column" type="button" data-day-index="${index}"><span class="priority-stack" aria-hidden="true">${segments}</span><span class="priority-date" aria-hidden="true"></span></button>`).join('')}</div><span class="priority-empty" hidden>近 7 日暂无事件</span></div>`;
  const tooltip = doc.createElement('div');
  tooltip.id = tooltipId;
  tooltip.className = 'priority-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  tooltip.innerHTML = `<strong class="priority-tooltip-date"></strong><div class="priority-tooltip-total"><span>总计</span><b></b></div><div class="priority-tooltip-breakdown">${PRIORITY_SERIES.map(series => `<div data-tooltip-priority="${series.key}"><span><i style="background:${series.color}"></i>${series.label}</span><b></b></div>`).join('')}</div>`;
  doc.body.append(tooltip);
  const columns = [...container.querySelectorAll('.priority-column')];
  const ticks = [...container.querySelectorAll('[data-tick]')];
  const peak = container.closest('.trend-panel')?.querySelector('[data-priority-peak]');
  let days = initialDays;
  let activeDate = null;
  let anchor = null;
  let unknownVisible = false;

  function positionTooltip() {
    if (!anchor) return;
    const bounds = tooltip.getBoundingClientRect();
    const margin = 12;
    let left = anchor.x + margin;
    if (left + bounds.width > view.innerWidth - margin) left = anchor.x - bounds.width - margin;
    tooltip.style.left = `${Math.max(margin, Math.min(left, view.innerWidth - bounds.width - margin))}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(anchor.y + margin, view.innerHeight - bounds.height - margin))}px`;
  }
  function paintTooltip(day) {
    tooltip.querySelector('.priority-tooltip-date').textContent = `${day.date.replaceAll('-', '/')} · 事件分布`;
    tooltip.querySelector('.priority-tooltip-total b').textContent = `${day.total} 条`;
    for (const series of PRIORITY_SERIES) {
      const row = tooltip.querySelector(`[data-tooltip-priority="${series.key}"]`);
      row.hidden = series.key === 'unknown' && !unknownVisible;
      row.querySelector('b').textContent = `${day.counts[series.key]} 条`;
    }
    positionTooltip();
  }
  function hide() {
    activeDate = null;
    tooltip.hidden = true;
    columns.forEach(column => { column.classList.remove('is-active'); column.removeAttribute('aria-describedby'); });
  }
  function show(column, point) {
    const day = days[Number(column.dataset.dayIndex)];
    if (!day) return;
    const rect = column.getBoundingClientRect();
    anchor = point || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 };
    activeDate = day.date;
    columns.forEach(item => { item.classList.toggle('is-active', item === column); item.removeAttribute('aria-describedby'); });
    column.setAttribute('aria-describedby', tooltipId);
    tooltip.hidden = false;
    paintTooltip(day);
  }
  function update(nextDays) {
    days = nextDays;
    const maximum = priorityAxisMaximum(days);
    unknownVisible = days.some(day => day.counts.unknown > 0);
    container.querySelector('[data-legend="unknown"]').hidden = !unknownVisible;
    if (peak) peak.textContent = `峰值 ${Math.max(0, ...days.map(day => day.total))}`;
    ticks.forEach((tick, index) => { tick.textContent = String(maximum * index / 4); });
    columns.forEach((column, index) => {
      const day = days[index];
      column.setAttribute('aria-label', priorityDaySummary(day, unknownVisible));
      column.querySelector('.priority-date').textContent = day.label;
      column.classList.toggle('is-empty', day.total === 0);
      for (const series of PRIORITY_SERIES) column.querySelector(`[data-segment="${series.key}"]`).style.height = `${day.counts[series.key] / maximum * 100}%`;
      column.classList.toggle('is-active', day.date === activeDate);
    });
    container.querySelector('.priority-empty').hidden = days.some(day => day.total > 0);
    if (activeDate) {
      const active = days.find(day => day.date === activeDate);
      if (active) {
        columns.forEach((column, index) => { if (days[index].date === activeDate) column.setAttribute('aria-describedby', tooltipId); else column.removeAttribute('aria-describedby'); });
        paintTooltip(active);
      } else hide();
    }
  }
  for (const column of columns) {
    column.addEventListener('pointermove', event => show(column, { x: event.clientX, y: event.clientY }), { signal: events.signal });
    column.addEventListener('focus', () => show(column), { signal: events.signal });
    column.addEventListener('click', () => show(column), { signal: events.signal });
    column.addEventListener('blur', hide, { signal: events.signal });
    column.addEventListener('keydown', event => {
      if (event.key === 'Escape') { hide(); return; }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const index = Number(column.dataset.dayIndex) + (event.key === 'ArrowLeft' ? -1 : 1);
      columns[(index + columns.length) % columns.length].focus();
    }, { signal: events.signal });
  }
  container.addEventListener('pointerleave', hide, { signal: events.signal });
  view.addEventListener('scroll', hide, { capture: true, signal: events.signal });
  view.addEventListener('resize', hide, { signal: events.signal });
  update(initialDays);
  return { update, destroy() { events.abort(); tooltip.remove(); } };
}
