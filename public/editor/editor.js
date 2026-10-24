import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs';
import {TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode, TerraDrawSelectMode} from 'https://esm.sh/terra-draw@1.24.2';
import {TerraDrawMapLibreGLAdapter} from 'https://esm.sh/terra-draw-maplibre-gl-adapter@1.1.2';
import {readLayer, writeLayer, parseProperties} from './model.mjs';

const el = id => document.getElementById(id);
const supportsFiles = !!(window.showOpenFilePicker && window.showSaveFilePicker && window.isSecureContext);
let map, draw, selected, fileHandle, fileName = 'Untitled.geojson';
let metadata = {type:'FeatureCollection'}, records = new Map();
let savedText = JSON.stringify({type:'FeatureCollection',features:[]});
let ready = false, suspended = false, busy = false, dirty = false;
let mode = 'select', styleRequest = 0;
function report(error) { if (error?.name !== 'AbortError') el('error').textContent = error?.message || String(error); }
function snapshot() { return draw ? draw.getSnapshot() : []; }
function layer() { return writeLayer(metadata, records, snapshot()); }
function geometryFeatures() { return snapshot().filter(f => ['point','linestring'].includes(f.properties?.mode) && !f.properties?.currentlyDrawing); }
function refresh() {
  if (suspended || !ready) return;
  dirty = JSON.stringify(layer()) !== savedText;
  // An unfinished drawing is also work that must be confirmed before replacing.
  dirty ||= snapshot().some(f => f.properties?.currentlyDrawing);
  el('filename').textContent = fileName + (dirty ? ' • Unsaved changes' : '');
  const features = geometryFeatures();
  el('features').replaceChildren(...features.map(f => {
    const option = document.createElement('option'); option.value = f.id;
    const name = records.get(f.id)?.properties?.name;
    option.textContent = (typeof name === 'string' && name) || (f.geometry.type === 'Point' ? 'Unnamed point' : 'Unnamed trail');
    option.selected = f.id === selected; return option;
  }));
  if (!features.some(f => f.id === selected)) showSelection(undefined);
}
function showSelection(id) {
  selected = id;
  const feature = geometryFeatures().find(f => f.id === id);
  const props = feature ? records.get(id)?.properties ?? {} : {};
  for (const key of ['name','description','properties','apply-properties','delete']) el(key).disabled = !feature || busy;
  el('name').value = typeof props.name === 'string' ? props.name : '';
  el('description').value = typeof props.description === 'string' ? props.description : '';
  el('properties').value = feature ? JSON.stringify(records.get(id)?.properties ?? {}, null, 2) : '';
  el('features').value = id ?? '';
}
function recordFor(id) {
  if (!records.has(id)) records.set(id, {type:'Feature', id, properties:{}});
  return records.get(id);
}
function chooseMode(next) {
  draw.setMode(next); mode = next;
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === next));
  el('status').textContent = next === 'point' ? 'Click the map to add a point.' : next === 'linestring' ? 'Click vertices; double-click to finish. Escape cancels.' : 'Select a feature to edit it.';
  refresh();
}
function setBusy(value) {
  busy = value;
  for (const id of ['new','open','save','save-as','basemap']) el(id).disabled = value || !ready;
  el('tools').disabled = value || !ready;
}
function confirmReplace() { return !dirty || window.confirm('Discard unsaved changes and replace the current layer?'); }
function checkFinished() {
  if (snapshot().some(f => f.properties?.currentlyDrawing)) throw new Error('Finish the current trail or press Escape before saving.');
}
async function installLayer(data) {
  // Add and check candidates first; a failed import leaves the existing layer intact.
  const next = readLayer(data);
  const previous = geometryFeatures().map(f => f.id);
  suspended = true;
  try {
    const result = draw.addFeatures(next.features);
    const invalid = result.filter(item => !item.valid);
    if (invalid.length) throw new Error('The drawing library could not load this file: ' + invalid.map(v => v.reason || 'invalid geometry').join('; '));
    draw.setMode('select'); mode = 'select';
    draw.removeFeatures(previous);
    metadata = next.metadata; records = next.records;
    savedText = JSON.stringify(layer());
    selected = undefined;
  } catch (error) {
    // A rejected candidate was never inserted. Only roll back IDs actually present,
    // otherwise removeFeatures masks the validation error with a missing-ID error.
    const candidates = new Set(next.features.map(f => f.id));
    const inserted = snapshot().filter(f => candidates.has(f.id)).map(f => f.id);
    if (inserted.length) draw.removeFeatures(inserted);
    throw error;
  } finally { suspended = false; }
  chooseMode('select'); showSelection(undefined); refresh();
  const points = geometryFeatures().flatMap(f => f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates);
  if (points.length) {
    const bounds = new maplibregl.LngLatBounds();
    for (const p of points) bounds.extend(p);
    map.fitBounds(bounds, {padding:45, maxZoom:17, duration:0});
  }
}
async function openFile(file, handle) {
  const data = JSON.parse(await file.text());
  await installLayer(data);
  fileHandle = handle; fileName = file.name;
  refresh(); el('status').textContent = 'Opened ' + fileName;
}
async function save(asNew = false) {
  if (busy) return;
  el('error').textContent = '';
  try {
    checkFinished();
    // File picker must be invoked directly from this click, before asynchronous work.
    const data = layer(); const text = JSON.stringify(data, null, 2) + '\n';
    let handle = fileHandle;
    setBusy(true);
    if (supportsFiles) {
      if (!handle || asNew) handle = await window.showSaveFilePicker({suggestedName:fileName});
      const writable = await handle.createWritable();
      try { await writable.write(text); await writable.close(); }
      catch (error) { await writable.abort().catch(() => {}); throw error; }
      fileHandle = handle; fileName = handle.name;
      el('status').textContent = 'Saved ' + fileName;
    } else {
      const url = URL.createObjectURL(new Blob([text], {type:'application/geo+json'}));
      const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      el('status').textContent = 'Downloaded ' + fileName + '. Replace your original file with this copy.';
    }
    savedText = JSON.stringify(data); refresh();
  } catch (error) { report(error); }
  finally { setBusy(false); showSelection(selected); }
}
el('save').onclick = () => save();
el('save-as').onclick = () => save(true);
el('new').onclick = async () => {
  if (!confirmReplace()) return;
  try { await installLayer({type:'FeatureCollection',features:[]}); fileHandle = undefined; fileName = 'Untitled.geojson'; refresh(); }
  catch (error) { report(error); }
};
el('open').onclick = async () => {
  if (!confirmReplace()) return;
  el('error').textContent = '';
  if (!supportsFiles) { el('file').value = ''; el('file').click(); return; }
  try { const [handle] = await window.showOpenFilePicker({multiple:false}); setBusy(true); await openFile(await handle.getFile(), handle); }
  catch (error) { report(error); }
  finally { setBusy(false); }
};
el('file').onchange = async event => {
  if (!event.target.files[0]) return;
  setBusy(true);
  try { await openFile(event.target.files[0], undefined); }
  catch (error) { report(error); }
  finally { setBusy(false); }
};
for (const button of document.querySelectorAll('[data-mode]')) button.onclick = () => chooseMode(button.dataset.mode);
el('features').onchange = event => {
  const id = event.target.value;
  chooseMode('select'); draw.selectFeature(id); showSelection(id);
};
for (const key of ['name','description']) el(key).oninput = event => {
  if (selected === undefined) return;
  const record = recordFor(selected); record.properties ??= {};
  record.properties[key] = event.target.value;
  el('properties').value = JSON.stringify(record.properties, null, 2); refresh();
};
el('apply-properties').onclick = () => {
  try { if (selected === undefined) return; recordFor(selected).properties = parseProperties(el('properties').value); el('error').textContent = ''; showSelection(selected); refresh(); }
  catch (error) { report(error); }
};
el('delete').onclick = () => {
  if (selected === undefined) return;
  const id = selected; draw.removeFeatures([id]); records.delete(id); showSelection(undefined); refresh();
};
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
el('file-help').textContent = supportsFiles
  ? 'Open a local GeoJSON file. Save writes back to that file; new layers use Save as. Files stay on your device.'
  : 'This browser opens files but saves a downloaded copy. Use desktop Chrome or Edge over HTTPS to save directly to the opened file.';
if (!supportsFiles) { el('save').textContent = 'Download'; el('save-as').hidden = true; }

async function boot() {
  const response = await fetch('./basemaps.json');
  if (!response.ok) throw new Error('Basemap configuration HTTP ' + response.status);
  const config = await response.json();
  if (!Array.isArray(config.basemaps) || !config.basemaps.length) throw new Error('basemaps.json needs at least one basemap.');
  map = new maplibregl.Map({container:'map', style:{version:8,sources:{},layers:[]}, center:config.center, zoom:config.zoom});
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({unit:'imperial'}));
  map.on('error', event => report(event.error || new Error('Map resource failed to load.')));
  const makeDraw = () => {
    draw = new TerraDraw({adapter:new TerraDrawMapLibreGLAdapter({map, coordinatePrecision:17}), modes:[
      new TerraDrawPointMode(), new TerraDrawLineStringMode(),
      new TerraDrawSelectMode({flags:{point:{feature:{draggable:true}}, linestring:{feature:{draggable:false,coordinates:{draggable:true,midpoints:{draggable:true},deletable:true}}}}})
    ]});
    draw.start(); draw.setMode('select');
    draw.on('change', () => refresh());
    draw.on('select', id => { if (!suspended) showSelection(id); });
    draw.on('deselect', () => { if (!suspended) showSelection(undefined); });
    draw.on('finish', () => { refresh(); });
  };
  await new Promise(resolve => map.once('load', resolve));
  makeDraw();
  for (const base of config.basemaps) { const option = document.createElement('option'); option.value = base.id; option.textContent = base.name; el('basemap').append(option); }
  async function changeBasemap(id) {
    const request = ++styleRequest;
    el('error').textContent = '';
    try {
      const base = config.basemaps.find(b => b.id === id);
      let style;
      if (base.style) { const r = await fetch(base.style); if (!r.ok) throw new Error('Basemap HTTP ' + r.status); style = await r.json(); }
      else style = {version:8,sources:{basemap:{type:'raster',tiles:base.tiles,tileSize:base.tileSize || 256,attribution:base.attribution || ''}},layers:[{id:'basemap',type:'raster',source:'basemap'}]};
      if (request !== styleRequest) return;
      checkFinished();
      const features = geometryFeatures();
      setBusy(true); suspended = true; draw.stop(); ready = false;
      map.once('style.load', () => {
        try { makeDraw(); const results = draw.addFeatures(features); if (results.some(r => !r.valid)) throw new Error('Could not restore editable features after switching basemap.'); ready = true; suspended = false; chooseMode(mode); refresh(); }
        catch (error) { report(error); }
        finally { setBusy(false); }
      });
      map.setStyle(style);
    } catch (error) { report(error); }
  }
  ready = true; setBusy(false); refresh();
  el('basemap').onchange = event => changeBasemap(event.target.value);
  el('basemap').value = config.defaultBasemap || config.basemaps[0].id;
  await changeBasemap(el('basemap').value);
}
boot().catch(report);
