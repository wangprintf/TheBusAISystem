// Isolated visual fixture: serves the real web layout with local test adapters.
// Business records use local adapters. The assistant uses the configured Dify URL;
// /agent-connected-preview substitutes a local iframe. /map-preview loads the real
// Tencent SDK with synthetic coordinates to check clustering and map rendering.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const publicFiles = new Set([
  '/web/road-health.css', '/web/js/road-health.js', '/web/js/road-health-data.js',
  '/tests/fixtures/road-health-bootstrap.js',
  '/web/navigation.css', '/web/weather.css', '/web/js/weather.js',
  '/web/js/order-assignment-sync.js',
  '/web/js/personnel-location.js',
  '/web/js/personnel-names.js',
  '/web/patrol-agent.css', '/web/js/patrol-agent.js', '/web/assets/patrol-agent.png',
  '/tests/fixtures/patrol-agent-bootstrap.js', '/tests/fixtures/patrol-agent-config.js',
  '/web/js/cos-direct.js',
  ...['styles', 'alert-styles', 'login', 'login-custom', 'app-custom', 'map-custom', 'device-health', 'order-status', 'hover-pin', 'map-activity', 'finish-upload', 'order-center'].map(name => `/web/${name}.css`),
  ...['app', 'types', 'priority-trend', 'device-health', 'dashboard-orders', 'order-status', 'hover-pin', 'map-activity', 'finish-upload', 'order-center', 'tencent-map', 'config'].map(name => `/web/js/${name}.js`),
  ...['dashboard-device-data', 'dashboard-device-map', 'dashboard-device-bootstrap', 'dashboard-order-bootstrap', 'dashboard-activity-bootstrap', 'hover-pin-browser', 'order-center-bootstrap', 'map-cluster-bootstrap'].map(name => `/tests/fixtures/${name}.js`),
]);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost').pathname;
    if (url === '/web/js/cos-direct-config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end('export const COS_DIRECT_CONFIG = {};'); return;
    }
    if (url === '/chatbot/local-fixture') {
      const html = await fs.readFile(path.join(root, 'tests/fixtures/patrol-agent-frame.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return;
    }
    if (url === '/hover-preview') {
      const html = await fs.readFile(path.join(root, 'tests/fixtures/hover-pin.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return;
    }
    if (url === '/preview' || url === '/health-preview' || url === '/order-preview' || url === '/activity-preview' || url === '/center-preview' || url === '/map-preview' || url === '/agent-preview' || url === '/agent-connected-preview') {
      let html = await fs.readFile(path.join(root, 'web/index.html'), 'utf8');
      html = html.replaceAll('href="./', 'href="/web/').replace(/<script type="module" src="\.\/js\/login\.js(?:\?[^"]*)?"><\/script>/, '<script type="importmap">{"imports":{"/web/js/api.js":"/tests/fixtures/dashboard-device-data.js","/web/js/tencent-map.js":"/tests/fixtures/dashboard-device-map.js"}}</script><script type="module" src="/tests/fixtures/dashboard-device-bootstrap.js"></script>');
      if (url.startsWith('/agent-')) html = html.replace('src="/tests/fixtures/dashboard-device-bootstrap.js"', 'src="/tests/fixtures/patrol-agent-bootstrap.js"');
      if (url === '/agent-connected-preview') html = html.replace('"imports":{', '"imports":{"/web/js/config.js":"/tests/fixtures/patrol-agent-config.js",');
      if (url === '/order-preview') html = html.replace('src="/tests/fixtures/dashboard-device-bootstrap.js"', 'src="/tests/fixtures/dashboard-order-bootstrap.js"');
      if (url === '/activity-preview') html = html.replace('src="/tests/fixtures/dashboard-device-bootstrap.js"', 'src="/tests/fixtures/dashboard-activity-bootstrap.js"');
      if (url === '/center-preview') html = html.replace('src="/tests/fixtures/dashboard-device-bootstrap.js"', 'src="/tests/fixtures/order-center-bootstrap.js"');
      if (url === '/health-preview') html = html.replace('src="/tests/fixtures/dashboard-device-bootstrap.js"', 'src="/tests/fixtures/road-health-bootstrap.js"');
      if (url === '/map-preview') html = html.replace(',"/web/js/tencent-map.js":"/tests/fixtures/dashboard-device-map.js"', '').replace('src="/tests/fixtures/dashboard-device-bootstrap.js"', 'src="/tests/fixtures/map-cluster-bootstrap.js"');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return;
    }
    if (!publicFiles.has(url)) { res.writeHead(404); res.end(); return; }
    const body = await fs.readFile(path.join(root, url));
    res.writeHead(200, { 'Content-Type': url.endsWith('.svg') ? 'image/svg+xml' : url.endsWith('.png') ? 'image/png' : url.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(500); res.end('Preview error'); }
});
server.listen(0, '127.0.0.1', () => console.log(`Dashboard preview: http://127.0.0.1:${server.address().port}/preview`));
