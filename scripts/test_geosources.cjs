const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class Element {
  constructor(document) { this.ownerDocument = document; this.children = []; this.events = {}; this.checked = false; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  addEventListener(type, fn) { this.events[type] = fn; }
}
const document = {createElement() { return new Element(this); }, createTextNode(text) { return {textContent: text}; }};
function setup(loaded = true) {
  const sources = {}, layers = {}, events = {}, popups = [];
  const map = {
    loaded, isStyleLoaded() { return this.loaded; },
    getSource: id => sources[id], getLayer: id => layers[id],
    addSource(id, source) { sources[id] = source; this.loaded = false; },
    addLayer(layer) { layers[layer.id] = layer; },
    setLayoutProperty(id, key, value) { layers[id].layout[key] = value; },
    on(type, id, fn) { (events[type] ??= []).push({id: typeof id === 'string' ? id : null, fn: fn || id}); },
    emit(type, event = {}, id = null) { for (const entry of events[type] || []) if (entry.id === id) entry.fn(event); },
    getCanvas: () => ({style: {}})
  };
  const maplibre = {Popup: class {
    setLngLat() { return this; }
    setDOMContent(content) { popups.push(content); return this; }
    addTo() { return this; }
  }};
  return {map, maplibre, sources, layers, popups, container: new Element(document)};
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const modulePath = path.join(root, 'public/maplibre-demo/geosources.js');
  const {initGeoSources} = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(modulePath, 'utf8')).toString('base64'));
  const committed = JSON.parse(fs.readFileSync(path.join(root, 'public/geosources.json')));
  assert.ok(Array.isArray(committed), 'Config must be an array');
  for (const group of committed) {
    assert.equal(typeof (group.name ?? group.layer), 'string');
    assert.ok((group.name ?? group.layer).trim());
    assert.ok(Array.isArray(group.data) && group.data.length);
    for (const data of group.data) {
      assert.ok(typeof data.file === 'string' && data.file.trim());
      assert.ok(['circle', 'symbol'].includes(data.type ?? 'circle'));
      if (!/^(https?:)?\/\//.test(data.file)) {
        const local = path.resolve(root, 'public', data.file.replace(/^\//, ''));
        const geojson = JSON.parse(fs.readFileSync(local));
        assert.ok(['FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'GeometryCollection'].includes(geojson.type));
      }
    }
  }
  const config = [{layer: 'Stores', data: [
    {file: 'geojson/costco', paint: {'circle-color': '#ff0000', 'circle-radius': 5}},
    {file: 'geojson/farm', paint: {'circle-color': '#00ff00', 'circle-radius': 3}}
  ]}];
  const url = 'https://example.org/mapping/geosources.json';
  let requests = 0;
  global.fetch = async target => { requests++; assert.equal(target, url); return {ok: true, json: async () => config}; };
  const state = setup(false);
  await initGeoSources(state.map, state.maplibre, state.container, url);
  const label = state.container.children[0], check = label.children[0];
  assert.equal(label.children[1].textContent.trim(), config[0].name || config[0].layer);
  check.checked = true;
  check.events.change();
  assert.equal(Object.keys(state.sources).length, 0, 'Wait for initial basemap load');
  state.map.loaded = true;
  state.map.emit('style.load');
  assert.equal(Object.keys(state.sources).length, config[0].data.length);
  for (const [i, data] of config[0].data.entries()) {
    const id = `geosources-0-${i}`;
    assert.equal(state.sources[id].data, new URL(data.file, url).href, 'Resolve file against config, preserving repository path');
    assert.deepEqual(state.layers[id].paint, data.paint);
  }
  check.checked = false;
  check.events.change();
  assert.ok(Object.values(state.layers).every(layer => layer.layout.visibility === 'none'), 'Hide even while GeoJSON is loading');
  check.checked = true;
  check.events.change();
  assert.equal(requests, 1, 'Toggles reuse config and sources');
  const id = 'geosources-0-0';
  state.map.emit('click', {features: [{properties: {address: '<script>unsafe</script>'}}], lngLat: [0, 0]}, id);
  assert.equal(state.popups[0].children[1].textContent, 'address: <script>unsafe</script>', 'Popup uses text, not HTML');
  for (const key of Object.keys(state.sources)) delete state.sources[key];
  for (const key of Object.keys(state.layers)) delete state.layers[key];
  state.map.emit('style.load');
  assert.equal(Object.keys(state.layers).length, config[0].data.length, 'Recreate checked overlays after basemap replacement');
  state.map.emit('error', {sourceId: id, error: new Error('HTTP 404')});
  assert.match(state.container.children[1].textContent, /HTTP 404/);
  const second = setup();
  global.fetch = async () => ({ok: true, json: async () => [
    {name: 'Broken', data: []},
    {name: 'New group', data: [{file: 'geojson/another', type: 'symbol', layout: {'text-field': ['get', 'name']}}]}
  ]});
  await initGeoSources(second.map, second.maplibre, second.container, url);
  assert.match(second.container.children[0].textContent, /non-empty/);
  const toggle = second.container.children[1].children[0];
  assert.equal(second.container.children[1].children[1].textContent, ' New group');
  assert.equal(Object.keys(second.sources).length, 0, 'Unchecked groups load no GeoJSON');
  toggle.checked = true; toggle.events.change();
  assert.equal(second.layers['geosources-1-0'].type, 'symbol');
  const failed = setup();
  global.fetch = async () => ({ok: false, status: 404});
  await initGeoSources(failed.map, failed.maplibre, failed.container, url);
  assert.match(failed.container.children[0].textContent, /HTTP 404/);
  console.log('Configured layer controls, styling, URLs, popups, loading races, errors and basemap restoration passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
