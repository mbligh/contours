const assert=require('node:assert/strict');
const fs=require('node:fs');
async function main(){
const source=fs.readFileSync(__dirname+'/shipping.js','utf8');
const {mergeShipping,initShipping}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const elements={};
const sources={},layers={},events={};
const map={
  getSource:id=>sources[id],getLayer:id=>layers[id],
  addSource(id,s){sources[id]={...s,setData(data){this.data=data;}};},
  addLayer(layer){layers[layer.id]=layer;},
  setLayoutProperty(id,k,v){(layers[id].layout??={})[k]=v;},
  isStyleLoaded:()=>true,
  on(type,layer,callback){if(typeof layer==='function')events[type]=layer;else events[type+':'+layer]=callback;},
};
const document={getElementById(id){return elements[id]??={checked:false,addEventListener(type,fn){this[type]=fn;}};}};
const feature=(carrier,name,address,coords=[-74.7,40.7],props={})=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{carrier,name,address,...props}});
const fedex=feature('FedEx','FedEx OnSite at Walgreens','12 Main Avenue Union NJ 07083',undefined,{host:'Walgreens',service_type:'FedEx OnSite',location_type:'staffed',source:'FedEx locator via All The Places',website:'https://local.fedex.com/example'});
const box=feature('FedEx','FedEx Drop Box','12 Main Avenue Union NJ 07083',undefined,{location_type:'drop_box',source:'FedEx locator via All The Places'});
const osm=feature('FedEx','Walgreens','12 Main Ave',undefined,{osm:'node/1',hours:'Mo-Fr 09:00-17:00',location_type:'staffed'});
global.document=document;
global.fetch=async url=>({ok:true,json:async()=>({type:'FeatureCollection',features:url.includes('shipping_fedex')?[fedex,box]:url.endsWith('/shipping.geojson')?[osm]:[]})});
const controller=initShipping(map,{}, {dataBaseUrl:'https://example.test/shipping/'});
const context={mergeShipping,installShipping:controller.install,loadShipping:controller.load};
Object.defineProperty(context,'fetch',{get:()=>global.fetch,set:value=>{global.fetch=value;}});
let result=context.mergeShipping([osm],[fedex,box]);
assert.equal(result.features.length,2,'Merge abbreviated address into staffed FedEx counter');
assert.equal(result.merged,1);
assert.equal(result.features[0].properties.osm,'node/1');
assert.equal(result.features[0].properties.hours,osm.properties.hours);
assert.match(result.features[0].properties.source,/OpenStreetMap/);
assert.equal(fedex.properties.osm,undefined,'Do not mutate input data across reloads');
result=context.mergeShipping([osm],[box]);
assert.equal(result.merged,0,'Never merge staffed counter into nearby drop box');
result=context.mergeShipping([{...osm,properties:{...osm.properties,address:'14 Main Ave'}}],[fedex]);
assert.equal(result.merged,0,'Conflicting house numbers must stay separate');
// A different nearby business must stay separate too.
const other=feature('FedEx','Independent Shipping Shop','14 Main Ave');
assert.equal(context.mergeShipping([other],[fedex]).merged,0);
const ups=feature('UPS','The UPS Store','32 Main Road',undefined,{osm:'way/2'});
const atp=feature('All The Places','The UPS Store (ATP)','32 Main Rd NJ',undefined,{source:'All The Places: UPS Store'});
result=context.mergeShipping([ups],[atp]);
assert.equal(result.merged,1,'Preserve UPS merging');
assert.equal(result.features[0].properties.carrier,'UPS');
assert.equal(context.mergeShipping([osm,{...osm,properties:{...osm.properties,osm:'way/3'}}],[fedex]).features.length,1,'Multiple OSM objects can describe one counter');
// Real Branchburg FedEx: the old outline corner was 64m away; its centroid is 5m away.
const branchburg=feature('FedEx','FedEx Office Ship Center','161 Meister Ave Branchburg NJ 08876',[-74.711877,40.6050633],{service_type:'FedEx Office Ship Center',location_type:'staffed',source:'FedEx locator via All The Places'});
const building=feature('FedEx','FedEx','',[-74.711913,40.60564],{osm:'way/756435518',shop:'copyshop',location_type:'staffed'});
assert.equal(context.mergeShipping([building],[branchburg]).merged,0,'Old corner falls outside conservative matching radius');
const centered={...building,geometry:{type:'Point',coordinates:[-74.711886,40.605108]}};
const branchburgResult=context.mergeShipping([centered],[branchburg]);
assert.equal(branchburgResult.features.length,1,'Centered building deduplicates with FedEx locator');
assert.equal(branchburgResult.features[0].properties.osm,'way/756435518');
assert.match(branchburgResult.features[0].properties.source,/OpenStreetMap/);
const upsBox=feature('UPS','Construction Specialists','3 Werner Way Lebanon NJ 08833',undefined,{location_type:'drop_box',service_type:'UPS Drop Box',source:'MailingLocations.com',verification:'Unverified directory listing',website:'https://www.mailinglocations.com/ups-39199-test-nj'});
const osmUpsBox=feature('UPS','UPS','3 Werner Way',[-74.70005,40.70005],{location_type:'drop_box',hours:'24/7',osm:'node/42'});
let upsBoxResult=context.mergeShipping([osmUpsBox],[upsBox]);
assert.equal(upsBoxResult.features.length,1);
assert.equal(upsBoxResult.features[0].properties.osm,'node/42');
assert.equal(upsBoxResult.features[0].geometry,osmUpsBox.geometry,'Prefer OSM physical-box position');
assert.equal(upsBoxResult.features[0].properties.hours,'24/7');
assert.equal(upsBoxResult.features[0].properties.website,upsBox.properties.website);
assert.equal(context.mergeShipping([osmUpsBox],[atp]).merged,0,'Never merge UPS box into a UPS Store');
assert.equal(context.mergeShipping([ups],[upsBox]).merged,0,'Never merge UPS Store into a box');
const distantBox={...osmUpsBox,geometry:{type:'Point',coordinates:[-74.71,40.71]}};
assert.equal(context.mergeShipping([distantBox],[upsBox]).merged,0,'Same address far away must stay separate');
async function check(){
  context.installShipping();
  assert.equal(layers['shipping-points'].layout.visibility,'none');
  assert.equal(layers['fedex-drop-boxes'].layout.visibility,'none');
  elements['fedex-boxes'].checked=true;
  context.installShipping();await context.loadShipping();
  assert.equal(layers['shipping-points'].layout.visibility,'none');
  assert.equal(layers['fedex-drop-boxes'].layout.visibility,'visible','Boxes work independently');
  assert.match(elements['shipping-status'].textContent,/1 FedEx drop boxes/);
  assert.equal(sources.shipping.data.features.length,2);
  elements.shipping.checked=true;elements['fedex-boxes'].checked=false;
  context.installShipping();await context.loadShipping();
  assert.equal(layers['shipping-points'].layout.visibility,'visible');
  assert.equal(layers['fedex-drop-boxes'].layout.visibility,'none');
  assert.match(elements['shipping-status'].textContent,/1 shipping locations/);
  // Reinstall after a basemap change preserves checkbox state.
  for(const key of Object.keys(layers))delete layers[key];
  for(const key of Object.keys(sources))delete sources[key];
  await events['style.load']();
  assert.equal(layers['shipping-points'].layout.visibility,'visible');
  assert.equal(layers['fedex-drop-boxes'].layout.visibility,'none');
  elements.shipping.checked=false;elements['ups-boxes'].checked=true;
  const originalFetch=context.fetch;
  context.fetch=async url=>url.includes('shipping_ups_boxes')?{ok:true,json:async()=>({type:'FeatureCollection',features:[upsBox]})}:originalFetch(url);
  context.installShipping();await context.loadShipping();
  assert.equal(layers['shipping-points'].layout.visibility,'none');
  assert.equal(layers['fedex-drop-boxes'].layout.visibility,'none');
  assert.equal(layers['ups-drop-boxes'].layout.visibility,'visible');
  assert.match(elements['shipping-status'].textContent,/1 UPS drop boxes/);
  console.log('Shipping merge, metadata, independent UPS/FedEx toggles and style reload checks passed');
}
await check();
}
main().catch(error=>{console.error(error);process.exitCode=1;});

