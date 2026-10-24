// CI installs the pinned runtime libraries and serves a local bundle for offline map QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {build} = require('esbuild');
const {chromium} = require('playwright');
(async () => {
  const root = __dirname;
  const aliases = {
    'https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs': 'maplibre-gl',
    'https://esm.sh/terra-draw@1.24.2': 'terra-draw',
    'https://esm.sh/terra-draw-maplibre-gl-adapter@1.1.2': 'terra-draw-maplibre-gl-adapter'
  };
  const bundle = await build({entryPoints:[path.join(root,'editor.js')],bundle:true,write:false,format:'esm',plugins:[{name:'local-cdn-dependencies',setup(builder){builder.onResolve({filter:/^https:/}, args => ({path:require.resolve(aliases[args.path])}));}}]});
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/editor.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(pathname==='/basemaps.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({center:[-74.771,40.692],zoom:14,defaultBasemap:'a',basemaps:[{id:'a',name:'First',style:'/a.json'},{id:'b',name:'Second',style:'/b.json'}]}));return;}
    if(['/a.json','/b.json'].includes(pathname)){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':pathname==='/a.json'?'#eff3ef':'#ddeedd'}}]}));return;}
    const file=path.join(root,pathname==='/'?'index.html':path.basename(pathname));
    if(!fs.existsSync(file)){res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.mjs')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(e.message));
  const fixture={type:'FeatureCollection',source:'keep this',features:[{type:'Feature',id:42,properties:{name:'Gate',nested:{test:true},mode:'user-mode'},geometry:{type:'Point',coordinates:[-74.771,40.692]}},{type:'Feature',properties:null,geometry:{type:'LineString',coordinates:[[-74.773,40.691],[-74.769,40.693]]}}]};
  await page.addInitScript(({fixture})=>{
    window.__fixture=fixture;window.__writes=[];window.__saveFails=false;
    const handle={name:'layer.geojson',getFile:async()=>new File([JSON.stringify(window.__fixture)],'layer.geojson'),createWritable:async()=>({write:async text=>{if(window.__saveFails)throw new Error('Simulated disk error');window.__pending=text;},close:async()=>window.__writes.push(window.__pending),abort:async()=>{}})};
    window.showOpenFilePicker=async()=>[handle];window.showSaveFilePicker=async()=>handle;
  },{fixture});
  await page.route('https://unpkg.com/**',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(require.resolve('maplibre-gl/dist/maplibre-gl.css'),'utf8')}));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>!document.getElementById('open').disabled);
    await page.click('#open'); await page.waitForFunction(()=>document.querySelectorAll('#features option').length===2);
    await page.click('#save'); await page.waitForFunction(()=>window.__writes.length===1);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(window.__writes[0])),fixture);
    await page.selectOption('#features',{index:0});
    await page.fill('#name','Renamed gate');
    await page.selectOption('#basemap','b');
    await page.waitForFunction(()=>!document.getElementById('basemap').disabled);
    assert.equal(await page.locator('#features option').count(),2);
    await page.click('#save'); await page.waitForFunction(()=>window.__writes.length===2);
    const renamed=await page.evaluate(()=>JSON.parse(window.__writes[1]));
    assert.equal(renamed.features[0].properties.name,'Renamed gate');
    assert.equal(renamed.features[0].properties.mode,'user-mode');
    assert.equal(renamed.features[0].id,42);
    await page.click('[data-mode="point"]'); await page.mouse.click(850,550);
    await page.waitForFunction(()=>document.querySelectorAll('#features option').length===3);
    await page.click('[data-mode="linestring"]');
    await page.mouse.click(650,350);await page.mouse.click(700,400);await page.mouse.dblclick(760,450);
    await page.click('[data-mode="select"]');
    await page.waitForFunction(()=>document.querySelectorAll('#features option').length===4);
    await page.click('#save');await page.waitForFunction(()=>window.__writes.length===3);
    const drawn=await page.evaluate(()=>JSON.parse(window.__writes[2]));
    assert.equal(drawn.features.length,4);assert.equal(drawn.features[3].geometry.type,'LineString');
    await page.selectOption('#features',{index:2});await page.click('#delete');
    assert.equal(await page.locator('#features option').count(),3);
    // Failed writes must retain dirty state and the current layer.
    await page.evaluate(()=>window.__saveFails=true);await page.click('#save');
    await page.waitForFunction(()=>document.getElementById('error').textContent.includes('Simulated disk error'));
    assert.match(await page.locator('#filename').textContent(),/Unsaved/);
    await page.evaluate(()=>{window.__fixture={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[]}}]};});
    page.once('dialog',dialog=>dialog.accept());await page.click('#open');
    await page.waitForFunction(()=>document.getElementById('error').textContent.includes('only Point'));
    assert.equal(await page.locator('#features option').count(),3);
    assert.deepEqual(pageErrors,[]);
    console.log('Browser checks passed: open/save round trip, properties, basemap restoration, points, trails, deletion, failed saves, rejected imports.');
  } catch(error) {await page.screenshot({path:'editor-test-failure.png',fullPage:true});throw error;}
  finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
