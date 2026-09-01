import { TENCENT_MAP_CONFIG } from './config.js';

let sdkPromise = null;
const reverseGeocodeCache = new Map();
const reverseGeocodePending = new Map();
let jsonpRequestId = 0;
let reverseGeocodeQuotaBlockedUntil = 0;

function hasCoordinates(item) {
  const latitude = Number(item?.latitude);
  const longitude = Number(item?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0 && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function pinSource(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46"><path fill="${color}" d="M17 0C7.6 0 0 7.6 0 17c0 12.8 17 29 17 29s17-16.2 17-29C34 7.6 26.4 0 17 0z"/><circle cx="17" cy="17" r="6" fill="#fff"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function loadTencentMapSdk(key) {
  if (window.TMap) return Promise.resolve(window.TMap);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.dataset.tencentMapSdk = 'true';
    script.onload = () => window.TMap ? resolve(window.TMap) : reject(new Error('腾讯地图脚本未正常加载'));
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('无法连接腾讯地图服务'));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function requestJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `__tencentGeocoder${++jsonpRequestId}`;
    const script = document.createElement('script');
    let settled = false;
    const timer = setTimeout(() => finish(new Error('腾讯地图服务响应超时')), 10000);
    const finish = (error, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
      if (error) reject(error);
      else resolve(payload);
    };
    window[callbackName] = payload => finish(null, payload);
    script.onerror = () => finish(new Error('无法连接腾讯地图服务'));
    script.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${callbackName}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

/** Resolve database coordinates through Tencent Maps WebService reverse geocoding. */
export async function reverseGeocode(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!hasCoordinates({ latitude: lat, longitude: lng })) return '';
  const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  if (reverseGeocodeCache.has(cacheKey)) return reverseGeocodeCache.get(cacheKey);
  if (Date.now() < reverseGeocodeQuotaBlockedUntil) throw new Error('腾讯地图逆地址解析今日额度已达上限，请稍后再试');
  if (reverseGeocodePending.has(cacheKey)) return reverseGeocodePending.get(cacheKey);
  const key = TENCENT_MAP_CONFIG.key.trim();
  if (!key) return '';
  const request = (async () => {
    const query = new URLSearchParams({
      location: `${lat},${lng}`,
      key,
      get_poi: '0',
    });
    try {
      const response = await requestJsonp(`https://apis.map.qq.com/ws/geocoder/v1/?${query}`);
      if (Number(response?.status) !== 0) throw new Error(response?.message || '逆地址解析失败');
      const address = response?.result?.formatted_addresses?.recommend
        || response?.result?.address
        || response?.result?.formatted_addresses?.rough
        || '';
      const placeName = String(address).trim();
      if (!placeName) throw new Error('未返回地点名称');
      reverseGeocodeCache.set(cacheKey, placeName);
      return placeName;
    } catch (error) {
      if (/额度|上限|quota|limit/i.test(error.message || '')) reverseGeocodeQuotaBlockedUntil = Date.now() + 24 * 60 * 60 * 1000;
      throw error;
    }
  })();
  reverseGeocodePending.set(cacheKey, request);
  try {
    return await request;
  } finally {
    reverseGeocodePending.delete(cacheKey);
  }
}

function showMessage(container, title, detail, tone = '') {
  container.innerHTML = `<div class="map-message ${tone}"><strong>${title}</strong><span>${detail}</span></div>`;
}

function emptyController() {
  return { setVisibleCategories() {}, focusAlert() {}, destroy() {} };
}

export async function createTencentMap({ container, alerts, onAlertClick }) {
  const key = TENCENT_MAP_CONFIG.key.trim();
  if (!key) {
    showMessage(container, '腾讯地图尚未配置', '请在 js/config.js 中填写腾讯位置服务的 Web 端 Key，详见 TENCENT_MAP_SETUP.md。', 'warning');
    return emptyController();
  }

  showMessage(container, '正在加载真实地图', '正在连接腾讯地图服务…');
  let TMap;
  try {
    TMap = await loadTencentMapSdk(key);
  } catch (error) {
    showMessage(container, '腾讯地图加载失败', `${error.message}。请检查 Key、域名白名单和网络连接。`, 'error');
    return emptyController();
  }

  container.innerHTML = '';
  const points = alerts.filter(hasCoordinates);
  const center = points.length ? mapCenter(points) : (hasCoordinates(TENCENT_MAP_CONFIG.center)
    ? TENCENT_MAP_CONFIG.center
    : { latitude: 30.261, longitude: 120.192 });
  const map = new TMap.Map(container, {
    center: new TMap.LatLng(Number(center.latitude), Number(center.longitude)),
    zoom: points.length ? zoomForPoints(points) : TENCENT_MAP_CONFIG.zoom,
  });
  const marker = new TMap.MultiMarker({
    map,
    styles: {
      high: new TMap.MarkerStyle({ width: 34, height: 46, anchor: { x: 17, y: 46 }, src: pinSource('#e9575d') }),
      normal: new TMap.MarkerStyle({ width: 34, height: 46, anchor: { x: 17, y: 46 }, src: pinSource('#eb9b24') }),
    },
  });
  const renderMarkers = (categories) => {
    const visiblePoints = points.filter(point => !categories || categories.has(point.category));
    marker.setGeometries(visiblePoints.map(point => ({
      id: point.id,
      styleId: ['高', '最高'].includes(point.severity) ? 'high' : 'normal',
      position: new TMap.LatLng(Number(point.latitude), Number(point.longitude)),
      properties: { id: point.id },
    })));
  };
  renderMarkers();
  marker.on('click', event => {
    const id = event.geometry?.properties?.id;
    if (id) onAlertClick?.(id);
  });

  return {
    setVisibleCategories(categories) { renderMarkers(categories); },
    focusAlert(id) {
      const point = points.find(item => item.id === id);
      if (!point) return;
      map.setCenter(new TMap.LatLng(Number(point.latitude), Number(point.longitude)));
      map.setZoom(16);
    },
    destroy() { marker.setMap(null); },
  };
}

function mapCenter(points) {
  const totals = points.reduce((sum, point) => ({
    latitude: sum.latitude + Number(point.latitude),
    longitude: sum.longitude + Number(point.longitude),
  }), { latitude: 0, longitude: 0 });
  return { latitude: totals.latitude / points.length, longitude: totals.longitude / points.length };
}

function zoomForPoints(points) {
  if (points.length < 2) return 15;
  const latitudes = points.map(point => Number(point.latitude));
  const longitudes = points.map(point => Number(point.longitude));
  const span = Math.max(Math.max(...latitudes) - Math.min(...latitudes), Math.max(...longitudes) - Math.min(...longitudes));
  if (span < 0.02) return 14;
  if (span < 0.08) return 12;
  if (span < 0.25) return 10;
  if (span < 0.8) return 8;
  return 6;
}
