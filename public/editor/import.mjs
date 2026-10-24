import {kml as toGeoJSON} from 'https://esm.sh/@tmcw/togeojson@7.1.2';
import {unzipSync} from 'https://esm.sh/fflate@0.8.2';

export function myMapsURL(input) {
  const url = new URL(input, location.href);
  if (!/^(https?):$/.test(url.protocol)) throw new Error('Only HTTP(S) URLs are supported.');
  if (['google.com', 'www.google.com'].includes(url.hostname) && url.pathname.startsWith('/maps/d/')) {
    const mid = url.searchParams.get('mid');
    if (!mid) throw new Error('Google My Maps URL has no mid parameter.');
    return new URL('https://www.google.com/maps/d/kml?mid=' + encodeURIComponent(mid) + '&forcekml=1');
  }
  return url;
}
function parseKML(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Invalid KML XML.');
  const root = xml.documentElement;
  if (root.localName !== 'kml') throw new Error('Expected a KML document.');
  const child = (node, name) => [...node.children].find(e => e.localName === name);
  const value = (node, name) => child(node, name)?.textContent?.trim();
  const styles = {};
  for (const element of xml.getElementsByTagName('*')) {
    if (['Style', 'StyleMap'].includes(element.localName) && element.id) {
      styles[element.id] = new XMLSerializer().serializeToString(element);
    }
  }
  const folderFor = placemark => {
    const names = [];
    for (let node = placemark.parentElement; node && node !== root; node = node.parentElement)
      if (node.localName === 'Folder') names.unshift(value(node, 'name') || '');
    return names;
  };
  const placemarks = [...xml.getElementsByTagName('*')].filter(e => e.localName === 'Placemark');
  const collection = toGeoJSON(xml);
  const features = [];
  for (const feature of collection.features) {
    const properties = feature.properties || {};
    const placemark = placemarks.find(p => p.id && p.id === feature.id) || placemarks[features.length];
    if (placemark) {
      const folders = folderFor(placemark);
      if (folders.length) { properties.kmlFolders = folders; properties.kmlLayer = folders[0]; }
      const styleUrl = value(placemark, 'styleUrl');
      if (styleUrl) properties.kmlStyleUrl = styleUrl;
      const inline = child(placemark, 'Style');
      if (inline) properties.kmlInlineStyle = new XMLSerializer().serializeToString(inline);
      const extended = child(placemark, 'ExtendedData');
      if (extended) properties.kmlExtendedData = new XMLSerializer().serializeToString(extended);
    }
    const geometries = feature.geometry?.type === 'GeometryCollection' ? feature.geometry.geometries : [feature.geometry];
    for (const geometry of geometries) {
      if (!geometry) continue;
      if (geometry.type === 'MultiPoint') {
        for (const point of geometry.coordinates) features.push({type:'Feature', properties:{...properties}, geometry:{type:'Point',coordinates:point.slice(0,2)}});
      } else if (geometry.type === 'MultiLineString') {
        for (const line of geometry.coordinates) features.push({type:'Feature',properties:{...properties},geometry:{type:'LineString',coordinates:line.map(p=>p.slice(0,2))}});
      } else if (geometry.type === 'Point' || geometry.type === 'LineString') {
        features.push({type:'Feature',properties:{...properties},geometry:{...geometry,coordinates:geometry.type === 'Point' ? geometry.coordinates.slice(0,2) : geometry.coordinates.map(p=>p.slice(0,2))}});
      }
    }
  }
  const documentNode = [...root.children].find(e => e.localName === 'Document');
  return {type:'FeatureCollection',name:documentNode && value(documentNode,'name'),kmlStyles:styles,features};
}
export async function importGeoData(bytes, filename) {
  const lower = filename.toLowerCase().split('?')[0];
  let data = bytes;
  if (lower.endsWith('.kmz') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const entries = unzipSync(bytes);
    const name = Object.keys(entries).find(n => n.toLowerCase() === 'doc.kml') || Object.keys(entries).find(n => n.toLowerCase().endsWith('.kml'));
    if (!name) throw new Error('KMZ archive contains no KML file.');
    data = entries[name];
  }
  const text = new TextDecoder().decode(data);
  if (lower.endsWith('.kml') || lower.endsWith('.kmz') || /^\s*(<\?xml[^>]*>\s*)?<kml[\s>]/i.test(text)) return parseKML(text);
  return JSON.parse(text);
}
