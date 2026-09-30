import { TENCENT_MAP_CONFIG } from './config.js';
import { personnelPinSource } from './personnel-location.js';

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

function clusterSource(count, size) {
  const center = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="blue" x2="0" y2="1"><stop stop-color="#4e9aff"/><stop offset="1" stop-color="#2861f1"/></linearGradient></defs><circle cx="${center}" cy="${center}" r="${center - 2}" fill="url(#blue)" stroke="#fff" stroke-width="3"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="${count > 999 ? 17 : 20}" font-weight="700">${count}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function loadTencentMapSdk(key) {
  if (window.TMap?.MarkerCluster) return Promise.resolve(window.TMap);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://map.qq.com/api/gljs?v=1.exp&libraries=tools&key=${encodeURIComponent(key)}`;
    script.async = true;
    script.dataset.tencentMapSdk = 'true';
    script.onload = () => window.TMap?.MarkerCluster
      ? resolve(window.TMap)
      : (sdkPromise = null, reject(new Error('地图聚合组件未加载，请检查 Web JS API 授权后重试')));
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
  return { available: false, setVisibleCategories() {}, updateAlerts() {}, focusAlert() {}, updatePersonnel() {}, focusPersonnel() {}, destroy() {} };
}

export async function createTencentMap({ container, alerts = [], onAlertClick, onPersonnelClick }) {
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
  let points = alerts.filter(hasCoordinates);
  const center = points.length ? mapCenter(points) : (hasCoordinates(TENCENT_MAP_CONFIG.center)
    ? TENCENT_MAP_CONFIG.center
    : { latitude: 30.261, longitude: 120.192 });
  let map;
  let marker;
  let cluster;
  let personnelMarker;
  let personnel = [];
  let personnelStyleSignature = '';
  let disposed = false;
  let visibleCategories;
  const clusterMaxZoom = 17;
  const clusterGroups = new Map();
  const styles = {
    high: new TMap.MarkerStyle({ width: 34, height: 46, anchor: { x: 17, y: 46 }, src: pinSource('#ff5b65') }),
    normal: new TMap.MarkerStyle({ width: 34, height: 46, anchor: { x: 17, y: 46 }, src: pinSource('#ffd05b') }),
  };
  try {
    map = new TMap.Map(container, {
      center: new TMap.LatLng(Number(center.latitude), Number(center.longitude)),
      zoom: points.length ? zoomForPoints(points) : TENCENT_MAP_CONFIG.zoom,
    });
    marker = new TMap.MultiMarker({
      map,
      styles,
    });
    cluster = new TMap.MarkerCluster({
      map,
      geometries: [],
      minimumClusterSize: 2,
      gridSize: 70,
      averageCenter: true,
      maxZoom: clusterMaxZoom,
      zoomOnClick: false,
      enableDefaultStyle: false,
    });
  } catch (error) {
    marker?.setMap(null);
    cluster?.destroy();
    map?.destroy();
    showMessage(container, '腾讯地图初始化失败', `${error.message || '地图服务拒绝初始化'}。请确认 Key 类型为 Web 端 JavaScript API，并在腾讯位置服务的域名白名单中加入 localhost。`, 'error');
    return emptyController();
  }
  const renderClusters = () => {
    if (disposed) return;
    clusterGroups.clear();
    let stylesChanged = false;
    const geometries = cluster.getClusters().flatMap((group, index) => {
      const count = group.geometries.length;
      if (!count) return [];
      if (count === 1) {
        const geometry = group.geometries[0];
        return [{ ...geometry, styleId: geometry.properties.severity === '高' ? 'high' : 'normal' }];
      }
      const id = `cluster-${index}`;
      const styleId = `count-${count}`;
      if (!styles[styleId]) {
        const size = Math.max(48, String(count).length * 12 + 20);
        styles[styleId] = new TMap.MarkerStyle({ width: size, height: size, anchor: { x: size / 2, y: size / 2 }, src: clusterSource(count, size) });
        stylesChanged = true;
      }
      clusterGroups.set(id, group);
      return [{ id, styleId, position: group.center, properties: { clusterId: id, count } }];
    });
    if (stylesChanged) marker.setStyles(styles);
    marker.setGeometries(geometries);
  };
  const updateGeometries = () => {
    if (disposed) return;
    const visiblePoints = points.filter(point => !visibleCategories || visibleCategories.has(point.category));
    cluster.setGeometries(visiblePoints.map(point => ({
      id: point.id,
      position: new TMap.LatLng(Number(point.latitude), Number(point.longitude)),
      properties: { id: point.id, severity: point.priority || point.severity },
    })));
    // Empty data may not emit cluster_changed; clear old overlays immediately.
    if (!visiblePoints.length) { clusterGroups.clear(); marker.setGeometries([]); }
  };
  const onMarkerClick = event => {
    const properties = event.geometry?.properties;
    const group = clusterGroups.get(properties?.clusterId);
    if (group) {
      map.setCenter(group.center);
      map.setZoom(Math.min(clusterMaxZoom + 1, map.getZoom() + 2));
    } else if (properties?.id != null) onAlertClick?.(properties.id);
  };
  cluster.on('cluster_changed', renderClusters);
  marker.on('click', onMarkerClick);
  updateGeometries();
  const onPersonnelMarkerClick = event => {
    const person = personnel.find(item => item.accountId === event.geometry?.properties?.accountId);
    if (person && !disposed) onPersonnelClick?.(person);
  };

  return {
    available: true,
    updatePersonnel(next = []) {
      if (disposed) return;
      personnel = next.filter(person => person.accountId && hasCoordinates(person));
      if (!personnel.length) { personnelMarker?.setGeometries([]); return; }
      const sources = personnel.map(person => [person.accountId, personnelPinSource(person)]);
      if (!personnelMarker) {
        // Personnel stay separate from work-order clustering and category filters.
        personnelMarker = new TMap.MultiMarker({ map, zIndex: 10, styles: {} });
        personnelMarker.on('click', onPersonnelMarkerClick);
      }
      const signature = JSON.stringify(sources);
      if (signature !== personnelStyleSignature) {
        personnelMarker.setStyles(Object.fromEntries(sources.map(([id, src]) => [
          `person-${id}`, new TMap.MarkerStyle({ width: 64, height: 82, anchor: { x: 32, y: 73 }, src }),
        ])));
        personnelStyleSignature = signature;
      }
      personnelMarker.setGeometries(personnel.map(person => ({
        id: `person-${person.accountId}`, styleId: `person-${person.accountId}`,
        position: new TMap.LatLng(person.latitude, person.longitude),
        properties: { accountId: person.accountId },
      })));
    },
    focusPersonnel(accountId) {
      if (!personnel.length || disposed) return;
      if (accountId != null || personnel.length === 1) {
        const person = accountId == null ? personnel[0] : personnel.find(item => item.accountId === accountId);
        if (!person) return;
        map.setCenter(new TMap.LatLng(person.latitude, person.longitude));
        map.setZoom(15);
        return;
      }
      const view = personnelOverview(personnel, container.clientWidth || 800, container.clientHeight || 600);
      map.setCenter(new TMap.LatLng(view.latitude, view.longitude));
      map.setZoom(view.zoom);
    },
    setVisibleCategories(categories) { visibleCategories = categories ? new Set(categories) : undefined; updateGeometries(); },
    updateAlerts(nextAlerts = []) {
      points = nextAlerts.filter(hasCoordinates);
      updateGeometries();
    },
    focusAlert(id) {
      const point = points.find(item => item.id === id);
      if (!point) return;
      map.setCenter(new TMap.LatLng(Number(point.latitude), Number(point.longitude)));
      map.setZoom(clusterMaxZoom + 1);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      cluster.off('cluster_changed', renderClusters);
      marker.off('click', onMarkerClick);
      personnelMarker?.off('click', onPersonnelMarkerClick);
      personnelMarker?.setMap(null);
      cluster.destroy();
      marker.setMap(null);
      map.destroy();
      clusterGroups.clear();
    },
  };
}

// Fit the shortest longitude arc so locations on both sides of the date line
// do not center the map over the opposite side of the world. Tencent's minimum
// zoom is 3; the roster keeps each person reachable on smaller viewports.
export function personnelOverview(people, width, height) {
  const longitudes = people.map(person => (person.longitude + 360) % 360).sort((a, b) => a - b);
  let gap = -1;
  let start = 0;
  for (let i = 0; i < longitudes.length; i++) {
    const next = longitudes[(i + 1) % longitudes.length] + (i === longitudes.length - 1 ? 360 : 0);
    if (next - longitudes[i] > gap) { gap = next - longitudes[i]; start = next % 360; }
  }
  const longitudeSpan = 360 - gap;
  const longitude = ((start + longitudeSpan / 2 + 180) % 360) - 180;
  const ys = people.map(person => {
    const radians = Math.max(-85, Math.min(85, person.latitude)) * Math.PI / 180;
    return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2;
  });
  const south = Math.max(...ys);
  const north = Math.min(...ys);
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - north - south))) * 180 / Math.PI;
  const scale = Math.min(
    Math.max(100, width - 160) / (256 * Math.max(longitudeSpan / 360, 1e-9)),
    Math.max(100, height - 160) / (256 * Math.max(south - north, 1e-9)),
  );
  return { latitude, longitude, zoom: Math.max(3, Math.min(15, Math.floor(Math.log2(scale)))) };
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
