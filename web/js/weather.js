// Fixed service area; independent of map panning and business APIs.
export const WEATHER_LOCATION = { name: '天津', latitude: 39.084158, longitude: 117.200983 };
export function weatherLabel(code) {
  if (code === 0) return ['晴', '☀'];
  if ([1, 2].includes(code)) return ['多云', '🌤'];
  if (code === 3) return ['阴', '☁'];
  if ([45, 48].includes(code)) return ['雾', '🌫'];
  if ([51, 53, 55].includes(code)) return ['毛毛雨', '🌦'];
  if ([56, 57, 66, 67].includes(code)) return ['冻雨', '🌧'];
  if ([61, 63, 65].includes(code)) return ['雨', '🌧'];
  if ([71, 73, 75, 77].includes(code)) return ['雪', '❄'];
  if ([80, 81, 82].includes(code)) return ['阵雨', '🌦'];
  if ([85, 86].includes(code)) return ['阵雪', '❄'];
  if ([95, 96, 99].includes(code)) return ['雷雨', '⛈'];
  return ['未知', '—'];
}
// Shared vector icons keep the summary and detail view consistent on every OS.
function weatherIcon(code) {
  const sun = '<g stroke="#f6c66b"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></g>';
  const cloud = '<path d="M6.5 16h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.2 1A3.5 3.5 0 0 0 6.5 16Z"/>';
  let shape = cloud;
  if (code === 0) shape = sun;
  else if ([1, 2].includes(code)) shape = `<g transform="translate(-1 -3) scale(.8)">${sun}</g>${cloud}`;
  else if ([45, 48].includes(code)) shape = `${cloud}<path d="M4 19h16M7 22h10"/>`;
  else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) shape = `${cloud}<path d="m8 19-1 3m6-3-1 3m6-3-1 3"/>`;
  else if ([71, 73, 75, 77, 85, 86].includes(code)) shape = `${cloud}<path d="M8 19v3m-1.3-2.3 2.6 1.6m0-1.6-2.6 1.6M17 19v3m-1.3-2.3 2.6 1.6m0-1.6-2.6 1.6"/>`;
  else if ([95, 96, 99].includes(code)) shape = `${cloud}<path stroke="#f6c66b" d="m13 17-3 3h4l-3 3"/>`;
  else if (code !== 3) shape = '<path d="M7 12h10"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shape}</svg>`;
}
export function parseForecast(data) {
  const daily = data?.daily;
  if (!Array.isArray(daily?.time) || daily.time.length < 7) throw new Error('预报数据不完整');
  const numeric = (value, precision = 0) => typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(precision)) : null;
  return daily.time.slice(0, 7).map((date, i) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('预报日期无效');
    const time = field => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(daily[field]?.[i] || '') ? daily[field][i].slice(11) : '—';
    return { rainTotal: numeric(daily.precipitation_sum?.[i], 1), wind: numeric(daily.wind_speed_10m_max?.[i], 1), uv: numeric(daily.uv_index_max?.[i], 1), sunrise: time('sunrise'), sunset: time('sunset'), date, code: daily.weather_code?.[i], high: numeric(daily.temperature_2m_max?.[i]), low: numeric(daily.temperature_2m_min?.[i]), rain: numeric(daily.precipitation_probability_max?.[i]) };
  });
}
export function forecastUrl() {
  const query = new URLSearchParams({ latitude: WEATHER_LOCATION.latitude, longitude: WEATHER_LOCATION.longitude, daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset', wind_speed_unit: 'kmh', timezone: 'Asia/Shanghai', forecast_days: '7' });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}
const value = n => n == null ? '—' : n;
function dayName(date) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  return date === today ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(`${date}T12:00:00+08:00`));
}
export function mountWeather(root) {
  if (!root) return null;
  root.innerHTML = `<div class="weather-heading"><b>${WEATHER_LOCATION.name} · 未来 7 天</b><button type="button" data-weather-open aria-haspopup="dialog">查看详情 ↗</button></div><div class="weather-days"></div><p class="weather-status" role="status"></p>`;
  const dialog = document.createElement('dialog');
  dialog.className = 'weather-dialog';
  dialog.setAttribute('aria-labelledby', 'weather-title');
  dialog.innerHTML = `<header class="weather-dialog-head"><div><p>路网巡检 · 天气参考</p><h2 id="weather-title">${WEATHER_LOCATION.name}七天天气预报</h2></div><button type="button" data-weather-close aria-label="关闭天气详情">×</button></header><div class="weather-dialog-content"><nav class="weather-date-picker" aria-label="选择预报日期"></nav><div class="weather-detail"></div></div><footer><span class="weather-updated" role="status"></span><button type="button" data-weather-refresh>刷新天气</button><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a></footer>`;
  document.body.append(dialog);
  const events = new AbortController();
  const on = (element, type, fn) => element.addEventListener(type, fn, { signal: events.signal });
  const content = root.querySelector('.weather-days');
  const status = root.querySelector('.weather-status');
  const picker = dialog.querySelector('.weather-date-picker');
  const detail = dialog.querySelector('.weather-detail');
  const refreshButton = dialog.querySelector('[data-weather-refresh]');
  let days = [], selected = 0, loadedAt = 0, pending = false, destroyed = false, requestController, opener;
  function renderDetail() {
    picker.innerHTML = days.map((day, i) => `<button type="button" data-weather-select="${i}" aria-pressed="${i === selected}"><b>${dayName(day.date)}</b><span>${day.date.slice(5).replace('-', '/')}</span></button>`).join('');
    const day = days[selected];
    if (!day) { detail.innerHTML = `<p class="weather-empty">${pending ? '正在获取天气预报…' : '天气暂不可用，请点击下方刷新天气重试。'}</p>`; return; }
    const [label] = weatherLabel(day.code);
    const icon = weatherIcon(day.code);
    detail.innerHTML = `<div class="weather-detail-hero"><span aria-hidden="true">${icon}</span><div><p>${day.date} · ${dayName(day.date)}</p><h3>${label}</h3><b>${value(day.high)}° <small>/ ${value(day.low)}°</small></b><p>最高温 / 最低温</p></div></div><dl class="weather-facts"><div><dt>降水概率</dt><dd>${value(day.rain)}<small>%</small></dd></div><div><dt>累计降水</dt><dd>${value(day.rainTotal)}<small>mm</small></dd></div><div><dt>最大风速</dt><dd>${value(day.wind)}<small>km/h</small></dd></div><div><dt>最大紫外线指数</dt><dd>${value(day.uv)}</dd></div><div><dt>日出</dt><dd>${day.sunrise}</dd></div><div><dt>日落</dt><dd>${day.sunset}</dd></div></dl><p class="weather-note">天津当地时间 · 预报会随气象变化更新，请结合现场情况安排巡检。</p>`;
  }
  function renderSummary() {
    content.innerHTML = days.map((day, i) => {
      const [label] = weatherLabel(day.code);
      return `<button type="button" class="weather-day" data-weather-day="${i}" aria-haspopup="dialog" title="${day.date} · ${label}" aria-label="查看${day.date}${label}天气详情，最高${value(day.high)}度，最低${value(day.low)}度，降水概率${value(day.rain)}%"><span>${dayName(day.date)}</span><span class="weather-icon" aria-hidden="true">${weatherIcon(day.code)}</span><b>${value(day.high)}°<small>/${value(day.low)}°</small></b><span class="weather-rain">${value(day.rain)}%</span></button>`;
    }).join('');
  }
  function setStatus(message) { status.textContent = message; dialog.querySelector('.weather-updated').textContent = message; }
  async function refresh() {
    if (pending || destroyed) return;
    pending = true; refreshButton.disabled = true;
    setStatus('正在更新天气…');
    content.setAttribute('aria-busy', 'true');
    if (!days.length) renderDetail();
    requestController = new AbortController();
    const timeout = setTimeout(() => requestController.abort(), 12000);
    try {
      const response = await fetch(forecastUrl(), { signal: requestController.signal });
      if (!response.ok) throw new Error('天气服务暂不可用');
      const result = parseForecast(await response.json());
      if (destroyed) return;
      const previousDate = days[selected]?.date;
      days = result; selected = Math.max(0, days.findIndex(day => day.date === previousDate)); loadedAt = Date.now();
      renderSummary(); renderDetail();
      setStatus(`最高 / 最低 · 降水概率 · ${new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', hour:'2-digit', minute:'2-digit' }).format(new Date())} 更新`);
      refreshButton.textContent = '刷新天气';
    } catch {
      if (destroyed) return;
      setStatus(days.length ? '更新失败 · 当前为上次预报，请重试' : '天气暂不可用 · 点击详情重试');
      refreshButton.textContent = '重试';
    } finally {
      clearTimeout(timeout); pending = false;
      if (!destroyed) { refreshButton.disabled = false; content.removeAttribute('aria-busy'); if (!days.length) renderDetail(); }
    }
  }
  function open(index, button) {
    selected = index; opener = button; renderDetail(); dialog.showModal();
    dialog.querySelector('[data-weather-close]').focus();
  }
  on(root, 'click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    open(Number(button.dataset.weatherDay || 0), button);
  });
  on(picker, 'click', event => {
    const button = event.target.closest('[data-weather-select]');
    if (!button) return;
    selected = Number(button.dataset.weatherSelect); renderDetail();
    picker.querySelector(`[data-weather-select="${selected}"]`).focus();
  });
  on(dialog.querySelector('[data-weather-close]'), 'click', () => dialog.close());
  on(dialog, 'click', event => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
  });
  on(dialog, 'close', () => {
    if (!destroyed) (opener?.isConnected ? opener : root.querySelector('[data-weather-open]')).focus();
  });
  on(refreshButton, 'click', refresh);
  const refreshIfDue = () => { if (!document.hidden && Date.now() - loadedAt >= 30 * 60 * 1000) refresh(); };
  const timer = setInterval(refreshIfDue, 60 * 1000);
  on(document, 'visibilitychange', refreshIfDue);
  refresh();
  return { destroy() { destroyed = true; clearInterval(timer); requestController?.abort(); events.abort(); dialog.remove(); root.innerHTML = ''; } };
}

