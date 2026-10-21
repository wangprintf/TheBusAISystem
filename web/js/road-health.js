import { buildRoadArchive, filterRoadGroups, roadTime, roadType, roadMedia, canCompare } from './road-health-data.js';
import { WORK_ORDER_STATUS } from './types.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => {
  const time = typeof value === 'number' ? value : roadTime(value);
  return Number.isFinite(time) && time > 0 ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(time).replaceAll('/', '.') : '时间未记录';
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  road: '<path d="m8 3-4 18M16 3l4 18M12 3v3m0 4v4m0 4v3"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  repeat: '<path d="M20 7H8a5 5 0 0 0-5 5m17-5-4-4m4 4-4 4M4 17h12a5 5 0 0 0 5-5M4 17l4-4m-4 4 4 4"/>',
  compare: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 3v18m-6-5 3-4 3 3m3-3 3-3 3 5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}[name] || ''}</svg>`;

export function mountRoadHealth(container, initialOrders, { onRefresh, onOpenOrder, resolveLocation } = {}) {
  let orders = initialOrders, archive = buildRoadArchive(orders), selectedId = archive.groups[0]?.id, eventId = null;
  let keyword = '', filter = 'all', destroyed = false, refreshBusy = false, requestVersion = 0;
  let mediaIndex = { alertMedia: 0, processedMedia: 0 }, mode = 'side';
  const listeners = new AbortController(), addresses = new Map();
  const filters = [['all', '全部点位'], ['recurring', '疑似复发'], ['open', '待处置'], ['comparable', '可对比']];
  container.innerHTML = `<section class="road-health" aria-label="道路健康档案工作台">
    <div class="rh-stats" data-rh-stats></div>
    <div class="rh-toolbar"><label class="rh-search">${icon('search')}<input type="search" data-rh-search aria-label="搜索道路档案" placeholder="搜索地点、病害类型或事件编号" /></label><div class="rh-filters" aria-label="档案筛选">${filters.map(([key, label]) => `<button type="button" data-rh-filter="${key}" aria-pressed="${key === filter}">${label}</button>`).join('')}</div><div class="rh-toolbar-actions"><label class="rh-radius">附近范围 <select data-rh-radius aria-label="附近归档范围"><option value="50">50 米</option><option value="100">100 米</option><option value="200">200 米</option></select></label><button class="rh-button" type="button" data-rh-refresh>${icon('refresh')} 更新档案</button></div></div>
    <p class="rh-status" data-rh-status role="status" aria-live="polite"></p>
    <div class="rh-layout"><aside class="rh-sites"><div class="rh-section-heading"><h3>附近点位</h3><span data-rh-count></span></div><div class="rh-site-list" data-rh-list></div><p class="rh-scope-note" data-rh-scope></p></aside><div class="rh-detail" data-rh-detail></div></div>
    <footer class="rh-footnote">按空间邻近归档，不代表精确路段或同一病害；无告警不等于道路健康。疑似复发需结合现场证据人工确认。</footer>
    <dialog class="rh-viewer" aria-label="影像原图"><header><b>影像查看</b><button type="button" data-rh-close-viewer aria-label="关闭影像">×</button></header><div data-rh-viewer-content></div></dialog>
  </section>`;
  const root = container.querySelector('.road-health');
  const detail = root.querySelector('[data-rh-detail]'), list = root.querySelector('[data-rh-list]');
  const viewer = root.querySelector('.rh-viewer');
  const currentGroup = () => archive.groups.find(group => group.id === selectedId);
  const currentEvent = () => currentGroup()?.events.find(event => String(event.id) === eventId);
  function pauseVideos(node) { node.querySelectorAll('video').forEach(video => video.pause()); }
  function paintStats() {
    const stats = [['pin', '归档点位', archive.groups.length, '处', '按附近范围归集', 'cyan'], ['road', '关联事件', archive.located, '条', `${archive.unlocated} 条缺少有效坐标`, 'blue'], ['repeat', '疑似复发点位', archive.recurring, '处', '完工后 30 天内再次上报', 'amber'], ['compare', '可对比工单', archive.comparable, '条', '同时具备报警与处理材料', 'mint']];
    root.querySelector('[data-rh-stats]').innerHTML = stats.map(([symbol, label, value, unit, note, tone]) => `<article class="rh-stat ${tone}"><div><span>${label}</span>${icon(symbol)}</div><strong>${value}<small>${unit}</small></strong><p>${note}</p></article>`).join('');
    root.querySelector('[data-rh-scope]').textContent = `已返回 ${archive.total} 条道路类事件；${archive.unlocated} 条因坐标缺失或无效未归档。`;
  }
  function paintList(force = false) {
    const groups = filterRoadGroups(archive.groups, { keyword, filter });
    const previous = selectedId;
    if (!groups.some(group => group.id === selectedId)) selectedId = groups[0]?.id;
    root.querySelector('[data-rh-count]').textContent = `${groups.length} / ${archive.groups.length}`;
    list.innerHTML = groups.map((group, index) => `<button type="button" class="rh-site" data-rh-site="${esc(group.id)}" aria-pressed="${group.id === selectedId}"><div class="rh-site-top"><span class="rh-site-number">${String(index + 1).padStart(2, '0')}</span><span class="rh-tag ${group.pairs.length ? 'amber' : group.openCount ? 'blue' : 'mint'}">${group.pairs.length ? '疑似复发' : group.openCount ? '待处置' : group.completedCount === group.events.length ? '已完工记录' : '状态待核实'}</span></div><b>${esc(group.name)}</b><small>${group.longitude.toFixed(5)}, ${group.latitude.toFixed(5)}</small><div class="rh-site-bottom"><span>${group.events.length} 条事件 · ${group.openCount} 条待处置</span><span aria-hidden="true">↗</span></div></button>`).join('') || '<div class="rh-empty"><b>没有匹配的点位</b><p>尝试调整筛选条件，或更新事件数据。</p><button type="button" class="rh-button" data-rh-reset>重置筛选</button></div>';
    root.querySelectorAll('[data-rh-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rhFilter === filter)));
    if (force || previous !== selectedId || !detail.children.length) paintDetail();
  }
  function paintDetail() {
    pauseVideos(detail);
    const group = currentGroup();
    if (!group) {
      eventId = null;
      detail.innerHTML = `<div class="rh-empty rh-empty-large">${icon('road')}<h3>${archive.total ? '暂无可展示的道路档案' : '等待道路巡检记录'}</h3><p>${archive.unlocated === archive.total && archive.total ? '当前道路事件缺少有效坐标，暂时无法按附近位置归档。' : '选择左侧点位，查看事件时间轴和处理前后材料。'}</p></div>`;
      return;
    }
    if (!group.events.some(event => String(event.id) === eventId)) {
      const relatedRepair = group.pairs.find(pair => canCompare(pair.before))?.before;
      eventId = String((relatedRepair || group.events.find(canCompare) || group.events[0]).id);
    }
    mediaIndex = { alertMedia: 0, processedMedia: 0 };
    const pair = group.pairs[0], completed = group.events.filter(event => event.status === 'completed');
    const missingFinish = completed.filter(event => !Number.isFinite(roadTime(event.finishAt)) || roadTime(event.finishAt) < roadTime(event.occurredAt)).length;
    detail.innerHTML = `<section class="rh-dossier"><header class="rh-dossier-head"><div><div class="rh-eyebrow">${icon('pin')} 附近点位档案</div><h2 data-rh-address>${esc(addresses.get(group.id) || group.name)}</h2><p>中心坐标 ${group.longitude.toFixed(5)}, ${group.latitude.toFixed(5)} <span>· 附近 ${archive.radius} 米</span></p></div><div class="rh-dossier-count"><b>${group.events.length}</b><span>次事件记录</span></div></header>
      <div class="rh-insight ${pair ? 'has-recurrence' : ''}">${icon(pair ? 'repeat' : 'clock')}<div><strong>${pair ? `发现 ${group.pairs.length} 条疑似复发记录` : '持续关注该点位的处置进展'}</strong><p>${pair ? `同类事件在完工后 ${pair.days < 1 ? '不足 1' : Math.floor(pair.days)} 天再次上报，相距约 ${Math.round(pair.distance)} 米。请对照时间轴核查。` : `${group.openCount} 条事件待处置，${completed.length} 条有已完成状态。${missingFinish ? `${missingFinish} 条缺少可信完工时间，暂不参与复发判断。` : '当前记录未触发复发规则。'}`}</p></div>${pair ? `<button type="button" data-rh-event="${esc(pair.after.id)}" class="rh-button">查看新事件 ↗</button>` : ''}</div>
      <section class="rh-compare-section"><div class="rh-section-heading"><div><h3>${icon('compare')} 处置前后对比</h3><p>同一工单的两组材料 · 供人工复核</p></div><div class="rh-mode"><button type="button" data-rh-mode="side">并排</button><button type="button" data-rh-mode="swipe">滑动对比</button></div></div><div class="rh-event-selector"><label>对比工单 <select data-rh-event-select aria-label="选择对比工单">${group.events.map(event => `<option value="${esc(event.id)}" ${String(event.id) === eventId ? 'selected' : ''}>#${esc(event.id)} · ${esc(roadType(event))}${canCompare(event) ? ' · 可对比' : ''}</option>`).join('')}</select></label><button type="button" class="rh-link" data-rh-open-order>查看工单 ↗</button></div><div data-rh-comparison></div></section>
      <div class="rh-detail-bottom"><section class="rh-timeline-section"><div class="rh-section-heading"><h3>${icon('clock')} 事件时间轴</h3><span>最近上报优先</span></div><div class="rh-timeline">${group.events.map(event => {
        const recurring = group.pairs.find(item => String(item.after.id) === String(event.id));
        return `<button type="button" class="rh-timeline-event" data-rh-event="${esc(event.id)}" aria-pressed="${String(event.id) === eventId}"><span class="rh-timeline-dot ${recurring ? 'amber' : event.status === 'completed' ? 'mint' : 'blue'}"></span><time>${esc(date(event.occurredAt))}</time><span class="rh-timeline-title"><b>${esc(roadType(event))}</b><span class="rh-tag ${recurring ? 'amber' : ''}">${recurring ? '疑似复发' : esc(WORK_ORDER_STATUS[event.status] || '状态未知')}</span></span><small>#${esc(event.id)}${recurring ? ` · 关联已完工事件 #${esc(recurring.before.id)}` : ''}</small>${event.status === 'completed' ? `<small>完工时间：${esc(date(event.finishAt))}</small>` : ''}<span class="rh-timeline-evidence">报警材料 ${roadMedia(event, 'alertMedia').length} 份 <i>／</i> 处理材料 ${roadMedia(event, 'processedMedia').length} 份</span></button>`;
      }).join('')}</div></section><aside class="rh-context"><h3>档案概览</h3><dl><div><dt>最近上报</dt><dd>${date(group.latest)}</dd></div><div><dt>涉及类型</dt><dd>${group.types.map(esc).join('、')}</dd></div><div><dt>可对比工单</dt><dd>${group.comparisonCount} 条</dd></div><div><dt>已完成事件</dt><dd>${completed.length} 条</dd></div></dl><div class="rh-rule"><b>疑似复发如何判定？</b><p>同类事件在可信完工时间之后 30 天内再次上报，且两次位置相距不超过 ${archive.radius} 米。</p><p>位置邻近不代表同一病害，结果仅供复核参考。</p></div></aside></div>
    </section>`;
    paintComparison();
    if (resolveLocation && !addresses.has(group.id)) {
      const version = ++requestVersion;
      Promise.resolve().then(() => resolveLocation(group.latitude, group.longitude)).then(address => {
        if (destroyed) return;
        addresses.set(group.id, address || group.name);
        if (version === requestVersion && currentGroup()?.id === group.id) detail.querySelector('[data-rh-address]').textContent = addresses.get(group.id);
      }).catch(() => {});
    }
  }
  function mediaPanel(event, side, label) {
    const items = roadMedia(event, side), index = mediaIndex[side] % (items.length || 1), item = items[index];
    return `<section class="rh-media-panel"><header><span>${label}</span><small>${items.length ? `${index + 1} / ${items.length} · ${item.kind === 'video' ? '视频' : '图片'}` : '暂无材料'}</small></header><div class="rh-media-stage">${item ? item.kind === 'video' ? `<video src="${esc(item.url)}" controls preload="metadata" aria-label="${label}"></video>` : `<button type="button" data-rh-enlarge="${side}" aria-label="放大${label}"><img src="${esc(item.url)}" alt="${label} · 事件 ${esc(event.id)}" /></button>` : `<div class="rh-media-empty">${icon('compare')}<b>${side === 'alertMedia' ? '暂无报警影像' : event.processedMediaLoadFailed ? '处理材料暂不可用' : '等待处理材料'}</b><span>${side === 'alertMedia' ? '当前事件未提供图片或视频' : event.processedMediaLoadFailed ? '读取失败，请更新档案后重试' : '处理材料上传后可进行对比'}</span></div>`}</div><footer><span>${side === 'alertMedia' ? `上报 ${esc(date(event.occurredAt))}` : `完工 ${esc(date(event.finishAt))}`}</span>${items.length > 1 ? `<div><button type="button" data-rh-media="${side}" data-step="-1" aria-label="上一份${label}">‹</button><button type="button" data-rh-media="${side}" data-step="1" aria-label="下一份${label}">›</button></div>` : ''}</footer></section>`;
  }
  function paintComparison() {
    const event = currentEvent(), host = detail.querySelector('[data-rh-comparison]');
    if (!event || !host) return;
    pauseVideos(host);
    const before = roadMedia(event, 'alertMedia')[mediaIndex.alertMedia], after = roadMedia(event, 'processedMedia')[mediaIndex.processedMedia];
    const canSwipe = before?.kind === 'image' && after?.kind === 'image';
    if (!canSwipe) mode = 'side';
    detail.querySelectorAll('[data-rh-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.rhMode === mode));
      button.disabled = button.dataset.rhMode === 'swipe' && !canSwipe;
      button.title = button.disabled ? '两侧均为图片时可滑动对比' : '';
    });
    host.innerHTML = mode === 'side' ? `<div class="rh-media-grid">${mediaPanel(event, 'alertMedia', '报警材料')}${mediaPanel(event, 'processedMedia', '处理后材料')}</div>` : `<div class="rh-swipe" style="--split:50%"><img src="${esc(after.url)}" alt="处理后材料" /><img class="rh-swipe-before" src="${esc(before.url)}" alt="报警材料" /><div class="rh-swipe-labels"><span>报警材料</span><span>处理后材料</span></div><div class="rh-swipe-divider" aria-hidden="true"><span>↔</span></div></div><label class="rh-swipe-control">拖动查看两侧影像<input type="range" min="0" max="100" value="50" data-rh-swipe aria-label="影像分割位置" /><output>50%</output></label><p class="rh-comparison-note">画面未做几何对齐，请结合拍摄角度判断；重叠差异不代表病害变化。</p>`;
  }
  function selectEvent(id) {
    if (!currentGroup()?.events.some(event => String(event.id) === id)) return;
    eventId = id;
    mediaIndex = { alertMedia: 0, processedMedia: 0 };
    detail.querySelector('[data-rh-event-select]').value = id;
    detail.querySelectorAll('.rh-timeline-event').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rhEvent === id)));
    paintComparison();
  }
  async function refresh() {
    if (refreshBusy || !onRefresh) return;
    refreshBusy = true;
    const button = root.querySelector('[data-rh-refresh]'), status = root.querySelector('[data-rh-status]');
    button.disabled = true;
    status.textContent = '正在更新道路档案…';
    try {
      const next = await onRefresh();
      if (destroyed) return;
      orders = next;
      archive = buildRoadArchive(orders, { radius: archive.radius });
      paintStats(); paintList(true);
      status.textContent = `已更新 · ${date(Date.now())}`;
    } catch (error) { if (!destroyed) status.textContent = `更新失败，保留上次档案：${error.message || '请稍后重试'}`; }
    finally { refreshBusy = false; if (!destroyed) button.disabled = false; }
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-rh-site')) { selectedId = button.dataset.rhSite; eventId = null; paintList(true); }
    else if (button.hasAttribute('data-rh-filter')) { filter = button.dataset.rhFilter; paintList(); }
    else if (button.hasAttribute('data-rh-reset')) { filter = 'all'; keyword = ''; root.querySelector('[data-rh-search]').value = ''; paintList(); }
    else if (button.hasAttribute('data-rh-event')) selectEvent(button.dataset.rhEvent);
    else if (button.hasAttribute('data-rh-mode')) { mode = button.dataset.rhMode; paintComparison(); }
    else if (button.hasAttribute('data-rh-media')) {
      const side = button.dataset.rhMedia, count = roadMedia(currentEvent(), side).length;
      mediaIndex[side] = (mediaIndex[side] + Number(button.dataset.step) + count) % count;
      paintComparison();
    } else if (button.hasAttribute('data-rh-enlarge')) {
      const side = button.dataset.rhEnlarge, item = roadMedia(currentEvent(), side)[mediaIndex[side]];
      const img = document.createElement('img'); img.src = item.url; img.alt = side === 'alertMedia' ? '报警材料原图' : '处理后材料原图';
      viewer.querySelector('[data-rh-viewer-content]').replaceChildren(img); viewer.showModal();
    } else if (button.hasAttribute('data-rh-close-viewer')) viewer.close();
    else if (button.hasAttribute('data-rh-refresh')) refresh();
    else if (button.hasAttribute('data-rh-open-order')) onOpenOrder?.(eventId);
  }, { signal: listeners.signal });
  root.addEventListener('input', event => {
    if (event.target.hasAttribute('data-rh-search')) { keyword = event.target.value; paintList(); }
    if (event.target.hasAttribute('data-rh-swipe')) {
      detail.querySelector('.rh-swipe').style.setProperty('--split', `${event.target.value}%`);
      detail.querySelector('output').textContent = `${event.target.value}%`;
    }
  }, { signal: listeners.signal });
  root.addEventListener('change', event => {
    if (event.target.hasAttribute('data-rh-radius')) { archive = buildRoadArchive(orders, { radius: Number(event.target.value) }); paintStats(); paintList(true); }
    if (event.target.hasAttribute('data-rh-event-select')) selectEvent(event.target.value);
  }, { signal: listeners.signal });
  root.addEventListener('error', event => {
    if (!['IMG', 'VIDEO'].includes(event.target.tagName)) return;
    const media = event.target, message = document.createElement('span');
    message.className = 'rh-media-failed'; message.textContent = '材料加载失败，请更新档案后重试';
    media.replaceWith(message);
  }, { capture: true, signal: listeners.signal });
  paintStats(); paintList(true);
  return { destroy() { destroyed = true; requestVersion++; listeners.abort(); pauseVideos(root); if (viewer.open) viewer.close(); } };
}
