import { TENCENT_MAP_CONFIG } from './config.js';

let sdkPromise = null;

function hasCoordinates(item) {
  return Number.isFinite(Number(item?.latitude)) && Number.isFinite(Number(item?.longitude));
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
  const center = hasCoordinates(TENCENT_MAP_CONFIG.center)
    ? TENCENT_MAP_CONFIG.center
    : (points[0] || { latitude: 30.261, longitude: 120.192 });
  const map = new TMap.Map(container, {
    center: new TMap.LatLng(Number(center.latitude), Number(center.longitude)),
    zoom: TENCENT_MAP_CONFIG.zoom,
  });
  const marker = new TMap.MultiMarker({
    map,
    styles: {
      high: new TMap.MarkerStyle({ width: 34, height: 46, anchor: { x: 17, y: 46 }, src: pinSource('#e9575d') }),
      normal: new TMap.MarkerStyle({ width: 34, height: 46, anchor: { x: 17, y: 46 }, src: pinSource('#eb9b24') }),
    },
  });
  const polyline = new TMap.MultiPolyline({
    map,
    styles: {
      route: new TMap.PolylineStyle({ color: '#3478f6', width: 6, borderWidth: 2, borderColor: '#ffffff', lineCap: 'round' }),
    },
    geometries: points.length > 1 ? [{
      id: 'inspection-route', styleId: 'route',
      paths: points.map(point => new TMap.LatLng(Number(point.latitude), Number(point.longitude))),
    }] : [],
  });

  const renderMarkers = (categories) => {
    const visiblePoints = points.filter(point => !categories || categories.has(point.category));
    marker.setGeometries(visiblePoints.map(point => ({
      id: point.id,
      styleId: point.severity === '高' ? 'high' : 'normal',
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
    destroy() { marker.setMap(null); polyline.setMap(null); },
  };
}
