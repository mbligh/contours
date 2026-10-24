import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readLayer, writeLayer, parseProperties} from './model.mjs';
const point = {type:'Feature',id:17,properties:{name:'Gate',mode:'a user property',selected:true,nested:{a:1}},geometry:{type:'Point',coordinates:[-74,40]},custom:'keep'};
const trail = {type:'Feature',properties:null,geometry:{type:'LineString',coordinates:[[-74,40],[-74.1,40.1]]}};
const fixture = {type:'FeatureCollection',attribution:'source',features:[point,trail]};
test('round trip preserves IDs, null and nested properties, foreign members and geometry', () => {
  const {metadata,records,features} = readLayer(fixture, (() => {let i=0;return () => `internal-${++i}`;})());
  assert.deepEqual(writeLayer(metadata,records,features),fixture);
  assert.deepEqual(fixture.features[0],point);
});
test('edits and deletions export only real features, with no editor state or stale bounds', () => {
  const input = structuredClone(fixture); input.bbox=[0,0,1,1]; input.features[0].bbox=[0,0,1,1];
  const {metadata,records,features} = readLayer(input, (() => {let i=0;return () => `internal-${++i}`;})());
  const moved = {...features[0],geometry:{type:'Point',coordinates:[-75,41]}};
  const result=writeLayer(metadata,records,[moved,{...moved,id:'guide',properties:{mode:'select',selectionPoint:true}}, {...moved,id:'draft',properties:{mode:'point',currentlyDrawing:true}}]);
  assert.equal(result.features.length,1); assert.equal(result.features[0].id,17);
  assert.deepEqual(result.features[0].geometry.coordinates,[-75,41]);
  assert.equal(result.bbox,undefined); assert.equal(result.features[0].properties.mode,'a user property');
});
test('new features get stable IDs and properties edited independently', () => {
  const {metadata,records,features}=readLayer({type:'FeatureCollection',features:[]});
  features.push({type:'Feature',id:'new-point',properties:{mode:'point'},geometry:point.geometry});
  records.set('new-point',{type:'Feature',id:'new-point',properties:parseProperties('{"name":"New gate"}')});
  assert.equal(writeLayer(metadata,records,features).features[0].properties.name,'New gate');
});
test('rejects unsupported or malformed data without mutating input', () => {
  for (const geometry of [{type:'Polygon',coordinates:[]},{type:'Point',coordinates:[0,91]},{type:'Point',coordinates:[0,0,10]},{type:'LineString',coordinates:[[0,0]]},{type:'LineString',coordinates:[[0,0],[Infinity,0]]}]) {
    const input={type:'FeatureCollection',features:[{...point,geometry}]}; const before=structuredClone(input);
    assert.throws(()=>readLayer(input),/Feature 1/); assert.deepEqual(input,before);
  }
  assert.throws(()=>readLayer({type:'FeatureCollection'}));
  assert.throws(()=>parseProperties('[]'));
});
