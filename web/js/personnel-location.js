import { hasMapCoordinates } from './map-activity.js';
import { PERSONNEL_NAMES } from './personnel-names.js';

export function avatarText(profile = {}) {
  return Array.from(String(profile.name || '用户').trim()).at(-1) || '用';
}

export function personnelLocations(rows, session = {}) {
  return rows.flatMap(row => {
    const accountId = String(row?.id ?? '').trim();
    if (!accountId || !hasMapCoordinates(row)) return [];
    const isCurrent = accountId === String(session.accountId ?? '').trim();
    const name = [row.name, isCurrent ? session.name : '', PERSONNEL_NAMES[accountId]]
      .map(value => String(value || '').trim()).find(Boolean) || '';
    return [{
      accountId, isCurrent,
      name: name || '未登记姓名',
      avatar: name ? avatarText({ name }) : '待',
      department: String(row.department || (isCurrent ? session.department : '') || '未提供部门').trim(),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      locatedAt: String(row.laocation_time || row.location_time || '').trim(),
      status: String(row.status ?? '').trim() === '1' ? 'online' : String(row.status ?? '').trim() === '0' ? 'offline' : 'unknown',
    }];
  });
}

export function personnelPinSource(person) {
  const name = String(person.name || '未登记姓名');
  const nameLength = Array.from(name).length;
  const fontSize = nameLength <= 2 ? 18 : nameLength === 3 ? 13 : 10;
  const glyph = name.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
  const outline = person.status === 'offline' ? '#8598ae' : '#3478f6';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="82" viewBox="0 0 64 82"><defs><linearGradient id="avatar" x2="0" y2="1"><stop stop-color="#dce9ff"/><stop offset="1" stop-color="#c6dcff"/></linearGradient></defs><ellipse cx="32" cy="73" rx="17" ry="6" fill="#3478f6" fill-opacity=".15" stroke="${outline}" stroke-width="2"/><path d="M32 3C16.5 3 4 15.5 4 31c0 18 28 40 28 40s28-22 28-40C60 15.5 47.5 3 32 3Z" fill="#fff" stroke="${outline}" stroke-width="3"/><circle cx="32" cy="30" r="21" fill="url(#avatar)"/><text x="32" y="30" dy=".35em" text-anchor="middle" fill="#3478f6" font-family="Microsoft YaHei,Arial,sans-serif" font-size="${fontSize}"${nameLength >= 4 ? ' textLength="39" lengthAdjust="spacingAndGlyphs"' : ''} font-weight="700">${glyph}</text><circle cx="49" cy="47" r="5" fill="${person.status === 'online' ? '#22cfa0' : '#8598ae'}" stroke="#fff" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const statusText = person => ({ online: '在线', offline: '离线 · 最后位置', unknown: '状态未知' }[person.status]);

/** Refresh all personnel while preserving the user's map view and selection. */
export function mountPersonnelLocation({ container, controller, loadLocations }) {
  const root = document.createElement('div');
  root.className = 'personnel-map-control';
  root.innerHTML = `<section class="personnel-map-details" aria-label="人员定位信息" hidden><header><button type="button" class="personnel-map-back" aria-label="返回人员列表" hidden>‹</button><strong></strong><button type="button" data-close-personnel aria-label="关闭定位信息">×</button></header><div class="personnel-map-list" aria-label="全部已定位人员"></div><div class="personnel-map-person" hidden><span data-personnel-account></span><span data-personnel-department></span><span data-personnel-status></span><span data-personnel-time></span><span data-personnel-coordinates></span></div></section><button type="button" class="personnel-map-locate" aria-expanded="false" disabled><span class="personnel-map-avatar" aria-hidden="true">⌖</span><span data-personnel-label aria-live="polite">定位加载中…</span></button>`;
  container.append(root);
  const details = root.querySelector('.personnel-map-details');
  const button = root.querySelector('.personnel-map-locate');
  const label = root.querySelector('[data-personnel-label]');
  const list = root.querySelector('.personnel-map-list');
  const info = root.querySelector('.personnel-map-person');
  const back = root.querySelector('.personnel-map-back');
  let people = [];
  let selectedId = null;
  let disposed = false;
  let pending = false;
  let focusedInitially = false;

  function renderDetails() {
    const person = people.find(item => item.accountId === selectedId);
    list.hidden = Boolean(person);
    info.hidden = !person;
    back.hidden = !person;
    if (!person) {
      selectedId = null;
      details.querySelector('strong').textContent = `全部人员（${people.length}）`;
      return;
    }
    details.querySelector('strong').textContent = `${person.name}${person.isCurrent ? ' · 我' : ''}`;
    details.querySelector('[data-personnel-account]').textContent = `账号：${person.accountId}`;
    details.querySelector('[data-personnel-department]').textContent = person.department;
    details.querySelector('[data-personnel-status]').textContent = statusText(person);
    details.querySelector('[data-personnel-time]').textContent = `定位时间：${person.locatedAt || '未记录'}`;
    details.querySelector('[data-personnel-coordinates]').textContent = `经纬度：${person.longitude.toFixed(6)}, ${person.latitude.toFixed(6)}`;
  }
  function showDetails(person) {
    if (disposed || !people.some(item => item.accountId === person?.accountId)) return;
    selectedId = person.accountId;
    renderDetails();
    details.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  }
  function closeDetails() { details.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  function showList() { selectedId = null; renderDetails(); details.hidden = false; button.setAttribute('aria-expanded', 'true'); }
  button.addEventListener('click', () => { controller.focusPersonnel(); showList(); });
  back.addEventListener('click', showList);
  details.querySelector('[data-close-personnel]').addEventListener('click', closeDetails);
  list.addEventListener('click', event => {
    const id = event.target.closest('[data-personnel-id]')?.dataset.personnelId;
    const person = people.find(item => item.accountId === id);
    if (person) { controller.focusPersonnel(id); showDetails(person); }
  });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { closeDetails(); button.focus(); } });
  for (const type of ['pointerdown', 'click', 'dblclick', 'wheel']) root.addEventListener(type, event => event.stopPropagation());

  async function refresh() {
    if (disposed || pending) return;
    pending = true;
    try {
      const next = await loadLocations();
      if (disposed) return;
      people = next;
      controller.updatePersonnel(people);
      button.disabled = !people.length;
      label.textContent = people.length ? `全部人员 · ${people.length}` : '暂无人员定位';
      button.title = people.length ? `查看全部 ${people.length} 位人员的位置` : '尚无人员上报有效坐标';
      const scrollTop = list.scrollTop;
      list.replaceChildren(...people.map(person => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'personnel-map-row';
        row.dataset.personnelId = person.accountId;
        const avatar = document.createElement('span');
        avatar.className = 'personnel-map-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = person.avatar;
        const identity = document.createElement('span');
        const name = document.createElement('b');
        name.textContent = `${person.name}${person.isCurrent ? ' · 我' : ''}`;
        const status = document.createElement('small');
        status.textContent = `${person.accountId} · ${statusText(person)}`;
        identity.append(name, status);
        row.append(avatar, identity);
        return row;
      }));
      list.scrollTop = scrollTop;
      renderDetails();
      if (!people.length) closeDetails();
      if (people.length && !focusedInitially) { controller.focusPersonnel(); focusedInitially = true; }
    } catch (error) {
      if (disposed) return;
      people = [];
      selectedId = null;
      controller.updatePersonnel([]);
      button.disabled = true;
      label.textContent = '位置读取失败';
      button.title = `人员位置读取失败：${error?.message || '网络连接异常'}，将自动重试`;
      list.replaceChildren();
      closeDetails();
    } finally { pending = false; }
  }
  void refresh();
  const timer = setInterval(refresh, 10000);
  return {
    showDetails,
    destroy() { disposed = true; clearInterval(timer); root.remove(); },
  };
}
