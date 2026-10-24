// Keep editor bookkeeping outside user GeoJSON: arbitrary properties and IDs survive.
const clone = value => structuredClone(value);
export function readLayer(data, makeId = () => crypto.randomUUID()) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features))
    throw new Error('Open a GeoJSON FeatureCollection containing Points and LineStrings.');
  const records = new Map();
  const features = data.features.map((feature, index) => {
    const fail = message => { throw new Error(`Feature ${index + 1}: ${message}`); };
    if (feature?.type !== 'Feature') fail('expected a Feature.');
    if (feature.properties !== null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties)))
      fail('properties must be an object or null.');
    const geometry = feature.geometry;
    if (!['Point', 'LineString'].includes(geometry?.type)) fail('only Point and LineString geometry is supported.');
    const coords = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(coords) || (geometry.type === 'LineString' && coords.length < 2)) fail('a trail needs at least two positions.');
    for (const p of coords) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)
        fail('expected 2D [longitude, latitude] positions in geographic degrees.');
    }
    const id = makeId();
    records.set(id, clone(feature));
    return { type: 'Feature', id, properties: { mode: geometry.type === 'Point' ? 'point' : 'linestring' }, geometry: clone(geometry) };
  });
  const metadata = clone(data);
  delete metadata.features;
  delete metadata.bbox;
  return { metadata, records, features };
}
export function writeLayer(metadata, records, snapshot) {
  const features = snapshot.filter(f => ['point', 'linestring'].includes(f.properties?.mode)
    && !f.properties?.currentlyDrawing && !f.properties?.midPoint && !f.properties?.selectionPoint).map(f => {
    const original = records.get(f.id);
    const feature = original ? clone(original) : {type: 'Feature', id: f.id, properties: {}};
    feature.geometry = clone(f.geometry);
    delete feature.bbox;
    return feature;
  });
  return {...clone(metadata), type: 'FeatureCollection', features};
}
export function parseProperties(text) {
  const value = JSON.parse(text);
  if (value !== null && (typeof value !== 'object' || Array.isArray(value)))
    throw new Error('Properties must be a JSON object or null.');
  return value;
}
