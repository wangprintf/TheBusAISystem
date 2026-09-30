export async function createTencentMap({ container, alerts = [], onAlertClick }) {
  container.innerHTML = '<div style="display:grid;align-content:center;gap:8px;height:100%;min-height:300px;padding:24px;background:repeating-linear-gradient(25deg,#0b2938 0px,#0b2938 2px,#0a2030 2px,#0a2030 44px);color:#77a8bd;font-size:13px"><p>腾讯地图区域 · 本地测试标记</p><div data-fixture-markers style="display:flex;flex-wrap:wrap;gap:8px"></div></div>';
  const markers = container.querySelector('[data-fixture-markers]');
  let points = alerts;
  let categories;
  function render() {
    markers.replaceChildren(...points.filter(point => Number(point.latitude) && Number(point.longitude) && (!categories || categories.has(point.category))).map(point => {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.textContent = `地图标记 ${point.id}`;
      marker.style.cssText = 'padding:8px;background:#163c50;color:#eefaff;border:1px solid #47768c;border-radius:4px;cursor:pointer';
      marker.onclick = () => onAlertClick?.(point.id);
      return marker;
    }));
  }
  render();
  return {
    updateAlerts(next = []) { points = next; render(); },
    setVisibleCategories(next) { categories = next; render(); },
    focusAlert() {},
    destroy() { container.replaceChildren(); },
  };
}
export async function reverseGeocode() { return ''; }
