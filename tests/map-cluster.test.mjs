import test from 'node:test';
import assert from 'node:assert/strict';
import { createTencentMap, personnelOverview } from '../web/js/tencent-map.js';

function sdkFixture(t) {
  const previous = globalThis.window;
  const instances = {};
  class Events {
    handlers = new Map();
    on(name, handler) { this.handlers.set(name, handler); }
    off(name, handler) { if (this.handlers.get(name) === handler) this.handlers.delete(name); }
    emit(name, event) { this.handlers.get(name)?.(event); }
  }
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
  class MarkerStyle { constructor(options) { Object.assign(this, options); } }
  class MapView {
    constructor(container, options) { Object.assign(this, options); instances.map = this; }
    getZoom() { return this.zoom; }
    setZoom(zoom) { this.zoom = zoom; }
    setCenter(center) { this.center = center; }
    destroy() { this.destroyed = true; }
  }
  class MultiMarker extends Events {
    constructor(options) { super(); Object.assign(this, options); instances.marker = this; }
    setStyles(styles) { this.styles = styles; }
    setGeometries(geometries) { this.geometries = geometries; }
    setMap(map) { this.map = map; }
  }
  class MarkerCluster extends Events {
    clusters = [];
    constructor(options) { super(); Object.assign(this, options); instances.cluster = this; }
    setGeometries(geometries) { this.geometries = geometries; }
    getClusters() { return this.clusters; }
    // Feed SDK clustering results, rather than duplicating its algorithm.
    publish(groups) { this.clusters = groups; this.emit('cluster_changed'); }
    destroy() { this.destroyed = true; }
  }
  class InfoWindow {
    constructor(options) { Object.assign(this, options); instances.tooltip = this; }
    setContent(content) { this.content = content; return this; }
    setPosition(position) { this.position = position; return this; }
    open() { this.visible = true; }
    close() { this.visible = false; }
    setMap(map) { this.map = map; }
  }
  globalThis.window = { TMap: { LatLng, MarkerStyle, Map: MapView, MultiMarker, MarkerCluster, InfoWindow } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  return instances;
}

const orders = [
  { id: 'A', latitude: 39.061, longitude: 117.133, category: '道路', priority: '高' },
  { id: 'B', latitude: 39.062, longitude: 117.134, category: '机动车', priority: '中' },
  { id: 'invalid', latitude: 0, longitude: 0, category: '道路' },
];

test('aggregate numbers zoom into their area and expanded pins open the correct event', async t => {
  const sdk = sdkFixture(t);
  const opened = [];
  const controller = await createTencentMap({ container: { innerHTML: '' }, alerts: orders, onAlertClick: id => opened.push(id) });
  assert.equal(sdk.map.mapStyleId, 'DARK');
  assert.equal(sdk.cluster.geometries.length, 2);
  assert.equal(sdk.cluster.maxZoom, 17);
  assert.equal(sdk.cluster.enableDefaultStyle, false);
  const center = sdk.cluster.geometries[0].position;
  sdk.cluster.publish([{ center, geometries: sdk.cluster.geometries }]);
  const aggregate = sdk.marker.geometries[0];
  assert.equal(aggregate.properties.count, 2);
  assert.match(decodeURIComponent(sdk.marker.styles[aggregate.styleId].src), />2<\/text>/);
  sdk.marker.emit('click', { geometry: aggregate });
  assert.equal(sdk.map.center, center);
  assert.equal(sdk.map.zoom, 16);
  sdk.marker.emit('click', { geometry: aggregate });
  assert.equal(sdk.map.zoom, 18);
  assert.deepEqual(opened, []);
  sdk.cluster.publish(sdk.cluster.geometries.map(geometry => ({ center: geometry.position, geometries: [geometry] })));
  assert.deepEqual(sdk.marker.geometries.map(geometry => geometry.styleId), ['high', 'normal']);
  sdk.marker.emit('click', { geometry: sdk.marker.geometries[1] });
  assert.deepEqual(opened, ['B']);
  controller.destroy();
});

test('filters survive data refresh, empty results clear markers, and disposal releases the map', async t => {
  const sdk = sdkFixture(t);
  const controller = await createTencentMap({ container: { innerHTML: '' }, alerts: orders });
  const zoom = sdk.map.zoom;
  controller.setVisibleCategories(new Set(['道路']));
  assert.deepEqual(sdk.cluster.geometries.map(item => item.properties.id), ['A']);
  controller.updateAlerts([...orders, { ...orders[0], id: 'C' }]);
  assert.deepEqual(sdk.cluster.geometries.map(item => item.properties.id), ['A', 'C']);
  assert.equal(sdk.map.zoom, zoom);
  controller.setVisibleCategories(new Set());
  assert.deepEqual(sdk.cluster.geometries, []);
  assert.deepEqual(sdk.marker.geometries, []);
  controller.setVisibleCategories();
  assert.equal(sdk.cluster.geometries.length, 3);
  controller.focusAlert('C');
  assert.equal(sdk.map.zoom, 18);
  controller.updateAlerts([]);
  assert.deepEqual(sdk.marker.geometries, []);
  controller.destroy();
  controller.destroy();
  assert.equal(sdk.marker.map, null);
  assert.equal(sdk.map.destroyed, true);
  assert.equal(sdk.cluster.destroyed, true);
  assert.equal(sdk.cluster.handlers.size, 0);
  assert.equal(sdk.marker.handlers.size, 0);
});

test('personnel keep correct clicks, overview bounds and refresh lifecycle independently of event filters', async t => {
  const sdk = sdkFixture(t);
  const selected = [];
  const controller = await createTencentMap({ container: { innerHTML: '' }, alerts: orders, onPersonnelClick: person => selected.push(person) });
  const eventMarker = sdk.marker;
  const eventCluster = sdk.cluster;
  const person = { accountId: '1001', name: '张丽', latitude: 39.07, longitude: 117.11, status: 'online' };
  const other = { accountId: '1002', name: '李波', latitude: 42, longitude: 111, status: 'offline' };
  controller.updatePersonnel([person, other]);
  const personMarker = sdk.marker;
  const personCluster = sdk.cluster;
  const expand = () => personCluster.publish(personCluster.geometries.map(geometry => ({ center: geometry.position, geometries: [geometry] })));
  expand();
  assert.notEqual(personMarker, eventMarker);
  assert.notEqual(personCluster, eventCluster);
  assert.equal(personMarker.geometries.length, 2);
  assert.match(decodeURIComponent(personMarker.styles['person-1001'].src), />丽<\/text>/);
  assert.match(decodeURIComponent(personMarker.styles['person-1002'].src), />波<\/text>/);
  assert.equal(personMarker.styles['person-1001'].width, 30);
  assert.equal(eventCluster.geometries.length, 2);
  controller.setVisibleCategories(new Set());
  assert.deepEqual(eventMarker.geometries, []);
  assert.equal(personMarker.geometries.length, 2);
  controller.focusPersonnel();
  assert.ok(sdk.map.center.lat > 39.07 && sdk.map.center.lat < 42);
  assert.ok(sdk.map.center.lng > 111 && sdk.map.center.lng < 117.11);
  assert.ok(sdk.map.zoom >= 3 && sdk.map.zoom < 15);
  controller.focusPersonnel('1001');
  assert.equal(sdk.map.center.lat, 39.07);
  assert.equal(sdk.map.zoom, 15);
  const center = sdk.map.center;
  const moved = { ...person, latitude: 39.08, status: 'offline' };
  controller.updatePersonnel([moved, other]);
  expand();
  assert.equal(personMarker.geometries[0].position.lat, 39.08);
  assert.equal(sdk.map.center, center);
  personMarker.emit('click', { geometry: personMarker.geometries[1] });
  personMarker.emit('click', { geometry: personMarker.geometries[0] });
  assert.deepEqual(selected, [other, moved]);
  controller.updateAlerts([]);
  assert.equal(personMarker.geometries.length, 2);
  controller.updatePersonnel([other]);
  expand();
  assert.equal(personMarker.geometries[0].properties.accountId, '1002');
  assert.deepEqual(Object.keys(personMarker.styles), ['person-1002']);
  controller.updatePersonnel([]);
  assert.deepEqual(personMarker.geometries, []);
  controller.updatePersonnel([{ ...person, latitude: 91 }]);
  assert.deepEqual(personMarker.geometries, []);
  controller.destroy();
  assert.equal(personMarker.map, null);
  assert.equal(personMarker.handlers.size, 0);
  assert.equal(personCluster.destroyed, true);
  assert.equal(personCluster.handlers.size, 0);
  controller.updatePersonnel([person]);
  assert.deepEqual(personMarker.geometries, []);
});

test('nearby personnel aggregate, expand on click, and show escaped full names on hover', async t => {
  const sdk = sdkFixture(t);
  const selected = [];
  const controller = await createTencentMap({ container: { innerHTML: '' }, alerts: orders, onPersonnelClick: person => selected.push(person) });
  const people = [
    { accountId: '1', name: '李有才', latitude: 39.07, longitude: 117.11, status: 'online' },
    { accountId: '2', name: '<测试&姓名>', latitude: 39.0701, longitude: 117.1101, status: 'offline' },
  ];
  controller.updatePersonnel(people);
  const { marker, cluster, map } = sdk;
  const center = cluster.geometries[0].position;
  cluster.publish([{ center, geometries: cluster.geometries }]);
  assert.equal(marker.geometries.length, 1);
  const aggregate = marker.geometries[0];
  assert.equal(aggregate.properties.count, 2);
  const zoom = map.zoom;
  marker.emit('mouseover', { geometry: aggregate });
  assert.match(sdk.tooltip.content, /2 位人员/);
  marker.emit('click', { geometry: aggregate });
  assert.equal(map.center, center);
  assert.equal(map.zoom, zoom + 2);
  assert.deepEqual(selected, []);
  assert.equal(sdk.tooltip.visible, false);
  cluster.publish(cluster.geometries.map(geometry => ({ center: geometry.position, geometries: [geometry] })));
  marker.emit('mouseover', { geometry: marker.geometries[0] });
  assert.match(sdk.tooltip.content, /李有才/);
  assert.equal(sdk.tooltip.visible, true);
  marker.emit('mouseout', {});
  assert.equal(sdk.tooltip.visible, false);
  marker.emit('mouseover', { geometry: marker.geometries[1] });
  assert.match(sdk.tooltip.content, /&lt;测试&amp;姓名&gt;/);
  marker.emit('click', { geometry: marker.geometries[1] });
  assert.deepEqual(selected, [people[1]]);
  controller.updatePersonnel([]);
  assert.equal(sdk.tooltip.visible, false);
  assert.deepEqual(marker.geometries, []);
  controller.destroy();
  assert.equal(sdk.tooltip.map, null);
});

test('personnel overview spans China and the US across the Pacific and handles coincident coordinates', () => {
  const view = personnelOverview([{ latitude: 39, longitude: 111.823 }, { latitude: 37.421998, longitude: -122.084 }], 886, 840);
  assert.ok(view.longitude > 170 && view.longitude < 180);
  assert.equal(view.zoom, 3);
  const coincident = personnelOverview([{ latitude: 39, longitude: 117 }, { latitude: 39, longitude: 117 }], 390, 400);
  assert.equal(coincident.longitude, 117);
  assert.ok(Math.abs(coincident.latitude - 39) < 1e-6);
  assert.equal(coincident.zoom, 15);
});
