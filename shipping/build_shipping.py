#!/usr/bin/env python3
"""Generate a compact NJ shipping GeoJSON from a Geofabrik OSM PBF."""
import json
import osmium
import urllib.parse
import urllib.request
from pathlib import Path

OUT=(Path(__file__).resolve().parent / 'shipping.geojson')
features=[]
seen=set()

def closed(t):
    # Lifecycle prefixes describe former businesses, not active shipping sites.
    if any(k.startswith(('disused:', 'abandoned:', 'was:', 'demolished:', 'removed:')) for k in t):
        if any(k.split(':',1)[-1] in ('shop','amenity','brand','name','operator','shipping','post_office') for k in t if ':' in k):
            return True
    if t.get('disused')=='yes' or t.get('abandoned')=='yes' or t.get('shop') in ('vacant','closed'):
        return True
    if str(t.get('opening_hours','')).strip().lower() in ('closed','off','no'):
        return True
    return False

def classify(t):
    vals=' '.join(str(t.get(k,'')) for k in ('brand','operator','name','post_office:brand','post_office:operator','parcel_mail_in:operator','parcel_pickup:operator')).lower()
    if 'fedex' in vals or 'fed ex' in vals: return 'FedEx'
    if 'ups' in vals.split() or 'united parcel service' in vals or 'ups store' in vals: return 'UPS'
    return None

def representative_point(coords):
    """Use an area's centroid, rather than an arbitrary corner of its outline."""
    if not coords:return None
    if len(coords)>=4 and coords[0]==coords[-1]:
        # Translate first to avoid cancellation with tiny geographic polygons.
        lon,lat=coords[0]
        points=[(x-lon,y-lat) for x,y in coords]
        area=xsum=ysum=0.0
        for (x1,y1),(x2,y2) in zip(points,points[1:]):
            cross=x1*y2-x2*y1
            area+=cross;xsum+=(x1+x2)*cross;ysum+=(y1+y2)*cross
        if abs(area)>1e-16:
            return (lon+xsum/(3*area),lat+ysum/(3*area))
    # Open ways and degenerate outlines retain their previous representative.
    return coords[len(coords)//2]

class Handler(osmium.SimpleHandler):
    def add(self,kind,obj,location):
        t=dict(obj.tags)
        if closed(t):return
        carrier=classify(t)
        if not carrier or not location or not location.valid(): return
        key=(kind,obj.id)
        if key in seen:return
        seen.add(key)
        address=' '.join(filter(None,(t.get('addr:housenumber'),t.get('addr:street'),t.get('addr:city'))))
        features.append({'type':'Feature','geometry':{'type':'Point','coordinates':[round(location.lon,6),round(location.lat,6)]},'properties':{'carrier':carrier,'name':t.get('name') or t.get('brand') or carrier,'address':address,'hours':t.get('opening_hours',''),'osm':f'{kind}/{obj.id}','source':'OpenStreetMap','brand':t.get('brand',''),'shop':t.get('shop',''),'location_type':'drop_box' if t.get('amenity')=='post_box' else 'staffed'}})
    def node(self,n):
        self.add('node',n,n.location)
    def way(self,w):
        # Only resolve full geometry for shipping sites in the statewide extract.
        t=dict(w.tags)
        if closed(t) or not classify(t):return
        try:
            locations=[n.location for n in w.nodes]
            if not locations or not all(loc.valid() for loc in locations):return
            point=representative_point([(loc.lon,loc.lat) for loc in locations])
            loc=osmium.osm.Location(*point)
        except (IndexError,RuntimeError):return
        self.add('way',w,loc)
    def relation(self,r):
        pass

Handler().apply_file('/tmp/new-jersey.osm.pbf',locations=True)
# USGS National Map replaces OSM post offices entirely.
BASE='https://carto.nationalmap.gov/arcgis/rest/services/structures/MapServer/38/query'
offset=0
post_count=0
while True:
    params=urllib.parse.urlencode({
        'where':"STATE='NJ' AND FCODE=78006",
        'outFields':'OBJECTID,NAME,ADDRESS,CITY,STATE,ZIPCODE',
        'returnGeometry':'true','outSR':'4326','f':'geojson',
        'resultOffset':str(offset),'resultRecordCount':'1000',
        'orderByFields':'OBJECTID ASC'
    })
    with urllib.request.urlopen(BASE+'?'+params,timeout=90) as response:
        batch=json.load(response)
    if 'error' in batch:raise RuntimeError(str(batch['error']))
    items=batch.get('features',[])
    for item in items:
        p=item.get('properties') or {}
        geom=item.get('geometry')
        if not geom or geom.get('type')!='Point':continue
        features.append({'type':'Feature','geometry':geom,'properties':{
            'carrier':'Post office','name':p.get('NAME') or 'USPS Post Office',
            'address':' '.join(filter(None,[p.get('ADDRESS'),p.get('CITY'),p.get('STATE'),p.get('ZIPCODE')])),
            'hours':'','osm':'','source':'USGS National Map'}})
        post_count+=1
    offset+=len(items)
    if len(items)<1000:break
if post_count<100:raise RuntimeError(f'USGS returned only {post_count} NJ post offices; refusing incomplete dataset')
print(f'USGS: {post_count} NJ post offices')

OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')))
print(f'Wrote {len(features)} shipping locations')


