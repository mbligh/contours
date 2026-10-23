export function mergeShipping(osm,extra){
    const radians=Math.PI/180;
    const distance=(a,b)=>{
      const [lon1,lat1]=a.geometry.coordinates,[lon2,lat2]=b.geometry.coordinates;
      const dlat=(lat2-lat1)*radians,dlon=(lon2-lon1)*radians;
      const h=Math.sin(dlat/2)**2+Math.cos(lat1*radians)*Math.cos(lat2*radians)*Math.sin(dlon/2)**2;
      return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
    };
    const normalize=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\b(STREET|ST)\b/g,'ST').replace(/\b(ROAD|RD)\b/g,'RD').replace(/\b(AVENUE|AVE)\b/g,'AVE').replace(/\b(ROUTE|RT)\b/g,'RT').replace(/\s+/g,' ').trim();
    const additions=extra.map(f=>({...f,properties:{...f.properties}}));
    const kept=[];
    let merged=0;
    for(const f of osm){
      const p=f.properties||{};
      if(!['UPS','FedEx'].includes(p.carrier)){kept.push(f);continue;}
      const candidates=additions.map(g=>({g,d:distance(f,g)})).filter(({g,d})=>{
        const q=g.properties;
        return d<=183&&(p.carrier==='UPS'
          ? (p.location_type==='drop_box' ? q.carrier==='UPS'&&q.location_type==='drop_box' : q.carrier==='All The Places')
          : q.carrier==='FedEx'&&(p.location_type||'staffed')===q.location_type);
      });
      const match=candidates.filter(({g,d})=>{
        const q=g.properties;
        const a=normalize(p.address),b=normalize(q.address);
        const sameAddress=a.length>=8&&b.length>=8&&(a===b||a.startsWith(b+' ')||b.startsWith(a+' '));
        if(p.carrier==='UPS'){
          if(p.location_type==='drop_box'){
            if(/^\d/.test(a)&&/^\d/.test(b)&&a.split(' ')[0]!==b.split(' ')[0])return false;
            return (sameAddress&&d<=100)||d<=20;
          }
          const storeName=/UPS STORE/i.test(p.name||'')||/UPS STORE/i.test(p.brand||'');
          return sameAddress||(storeName&&d<=50)||(storeName&&a&&b&&a.split(' ')[0]===b.split(' ')[0]);
        }
        // Nearby Walgreens/office counters can be distinct businesses. Require
        // an address match, or a matching host/facility name at close range.
        if(/^\d/.test(a)&&/^\d/.test(b)&&a.split(' ')[0]!==b.split(' ')[0])return false;
        const name=normalize(p.name),host=normalize(q.host);
        const sameHost=host&&name.includes(host);
        const facility=/^FedEx (Office|Ship Center)/.test(q.service_type||'')&&/FEDEX/.test(name);
        return sameAddress||(d<=30&&(sameHost||facility));
      }).sort((a,b)=>a.d-b.d)[0];
      if(!match){kept.push(f);continue;}
      merged++;
      const q=match.g.properties;
      if(p.carrier==='UPS'&&p.location_type==='drop_box'){
        // OSM maps the physical box; directory coordinates may be address-level.
        match.g.geometry=f.geometry;
        q.coordinate_source='OpenStreetMap';
        q.hours=p.hours||q.hours||'';
      }
      q.osm=[...new Set([...(q.osm||'').split(';'),p.osm].filter(Boolean))].join(';');
      if(!q.source.includes('OpenStreetMap'))q.source+=' + OpenStreetMap';
      for(const key of ['hours','address','website'])q[key]=q[key]||p[key]||'';
    }
    for(const f of additions){
      if(f.properties.carrier==='All The Places'){
        f.properties.carrier='UPS';f.properties.name='The UPS Store';
      }
    }
    return {features:[...kept,...additions],merged};
  }

export function initShipping(map,maplibregl,{dataBaseUrl}={}){
  const baseUrl=dataBaseUrl||new URL('./',import.meta.url).href;
  const dataUrl=file=>new URL(file,baseUrl).href;
  const empty={type:'FeatureCollection',features:[]};
  // Weekly shipping data, including USPS collection boxes in the shared file.
  const shippingCheck=document.getElementById('shipping');
  const shippingStatus=document.getElementById('shipping-status');
  const fedexBoxesCheck=document.getElementById('fedex-boxes');
  const upsBoxesCheck=document.getElementById('ups-boxes');
  const uspsBoxesCheck=document.getElementById('usps-boxes');
  const shippingEnabled=()=>shippingCheck.checked||fedexBoxesCheck.checked||upsBoxesCheck.checked||uspsBoxesCheck.checked;
  let shippingRequest=0;
  function installShipping(){
    if(!map.getSource('shipping'))map.addSource('shipping',{type:'geojson',data:empty});
    if(!map.getLayer('shipping-points'))map.addLayer({
      id:'shipping-points',type:'circle',source:'shipping',
      filter:['!=',['get','location_type'],'drop_box'],
      paint:{'circle-radius':7,'circle-color':['match',['get','carrier'],'UPS','#79512d','FedEx','#8051c8','Post office','#1675bf','CVS UPS','#1a9b75','#777'],
        'circle-stroke-color':'#fff','circle-stroke-width':1.5}
    });
    if(!map.getLayer('fedex-drop-boxes'))map.addLayer({
      id:'fedex-drop-boxes',type:'circle',source:'shipping',
      filter:['all',['==',['get','carrier'],'FedEx'],['==',['get','location_type'],'drop_box']],
      paint:{'circle-radius':4,'circle-color':'#8051c8','circle-stroke-color':'#fff','circle-stroke-width':1}
    });
    if(!map.getLayer('ups-drop-boxes'))map.addLayer({
      id:'ups-drop-boxes',type:'circle',source:'shipping',
      filter:['all',['==',['get','carrier'],'UPS'],['==',['get','location_type'],'drop_box']],
      paint:{'circle-radius':4,'circle-color':'#79512d','circle-stroke-color':'#fff','circle-stroke-width':1}
    });
    if(!map.getLayer('usps-collection-boxes'))map.addLayer({
      id:'usps-collection-boxes',type:'circle',source:'shipping',
      filter:['all',['==',['get','carrier'],'USPS'],['==',['get','location_type'],'drop_box']],
      paint:{'circle-radius':4,'circle-color':'#1675bf','circle-stroke-color':'#fff','circle-stroke-width':1}
    });
    map.setLayoutProperty('usps-collection-boxes','visibility',uspsBoxesCheck.checked?'visible':'none');
    map.setLayoutProperty('ups-drop-boxes','visibility',upsBoxesCheck.checked?'visible':'none');
    map.setLayoutProperty('shipping-points','visibility',shippingCheck.checked?'visible':'none');
    map.setLayoutProperty('fedex-drop-boxes','visibility',fedexBoxesCheck.checked?'visible':'none');
  }
  // Prefer locator coordinates/metadata while retaining matching OSM details.
  // FedEx boxes and staffed counters never merge with one another.
  async function loadShipping(){
    const request=++shippingRequest;
    if(!shippingEnabled()||!map.getSource('shipping'))return;
    shippingStatus.textContent='Loading NJ shipping locations…';
    try{
      const response=await fetch(dataUrl('shipping.geojson'));
      if(!response.ok)throw new Error('Shipping dataset unavailable (HTTP '+response.status+')');
      const data=await response.json();
      if(data.type!=='FeatureCollection')throw new Error('Invalid shipping GeoJSON');
      if(request!==shippingRequest||!shippingEnabled())return;
      const additions=[],warnings=[];
      for(const file of ['shipping_extra.geojson','shipping_fedex.geojson','shipping_ups_boxes.geojson']){
        try{
          const response=await fetch(dataUrl(file));
          if(!response.ok)throw new Error('HTTP '+response.status);
          const extra=await response.json();
          if(extra.type!=='FeatureCollection'||!Array.isArray(extra.features))throw new Error('Invalid GeoJSON');
          additions.push(...extra.features);
        }catch(e){warnings.push(file+': '+e.message);}
      }
      if(request!==shippingRequest||!shippingEnabled())return;
      const result=mergeShipping(data.features,additions);
      map.getSource('shipping').setData({type:'FeatureCollection',features:result.features});
      const countBoxes=carrier=>result.features.filter(f=>f.properties.carrier===carrier&&f.properties.location_type==='drop_box').length;
      const boxes=countBoxes('FedEx'),upsBoxes=countBoxes('UPS'),uspsBoxes=countBoxes('USPS');
      shippingStatus.textContent=[
        shippingCheck.checked?(result.features.length-boxes-upsBoxes-uspsBoxes)+' shipping locations':null,
        fedexBoxesCheck.checked?boxes+' FedEx drop boxes':null,
        upsBoxesCheck.checked?upsBoxes+' UPS drop boxes':null,
        uspsBoxesCheck.checked?uspsBoxes+' USPS collection boxes':null,
        result.merged+' duplicates merged',
        warnings.length?'Some data unavailable: '+warnings.join('; '):null
      ].filter(Boolean).join(' · ');
    }catch(e){if(request===shippingRequest)shippingStatus.textContent='Shipping data unavailable: '+e.message;}
  }
  function shippingChanged(){
    if(map.isStyleLoaded())installShipping();
    if(shippingEnabled())loadShipping();
    else{++shippingRequest;shippingStatus.textContent='';map.getSource('shipping')?.setData(empty);}
  }
  shippingCheck.addEventListener('change',shippingChanged);
  fedexBoxesCheck.addEventListener('change',shippingChanged);
  upsBoxesCheck.addEventListener('change',shippingChanged);
  uspsBoxesCheck.addEventListener('change',shippingChanged);
  function shippingPopup(e){
    if(!e.features?.length)return;
    const p=e.features[0].properties,container=document.createElement('div');
    for(const [label,key] of [['Carrier','carrier'],['Name','name'],['Type','service_type'],['Retailer','host'],['Address','address'],['Hours','hours'],['Collection times','collection_times'],['Indoor / lobby','indoor'],['Notes','note'],['Phone','phone'],['Verification','verification'],['Position','coordinate_source']]){
      if(!p[key])continue;
      const line=document.createElement('div'),strong=document.createElement('strong');
      strong.textContent=label+': ';line.append(strong,document.createTextNode(String(p[key])));container.append(line);
    }
    if(p.source){const line=document.createElement('div');line.textContent='Source: '+p.source;container.append(line);}
    function addLink(url,label){
      if(!/^https?:\/\//i.test(url||''))return;
      const line=document.createElement('div'),link=document.createElement('a');
      link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=label;line.append(link);container.append(line);
    }
    addLink(p.website,p.carrier==='USPS'?'View USPS locator':p.carrier==='FedEx'?'View FedEx location':p.source?.includes('MailingLocations')?'View directory listing':'View store details');
    for(const osm of (p.osm||'').split(';').filter(Boolean))addLink('https://www.openstreetmap.org/'+osm,'View OSM details');
    new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(container).addTo(map);
  }
  for(const layer of ['shipping-points','fedex-drop-boxes','ups-drop-boxes','usps-collection-boxes']){
    map.on('click',layer,shippingPopup);
    map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
  }

  async function restoreShipping(){
    installShipping();
    if(shippingEnabled())await loadShipping();
  }
  map.on('style.load',restoreShipping);
  if(map.isStyleLoaded())restoreShipping();
  return {install:installShipping,load:loadShipping};
}
