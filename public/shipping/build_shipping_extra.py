#!/usr/bin/env python3
"""Fetch All The Places NJ UPS/CVS candidates and verify CVS UPS Access Points."""
import json, re, time, urllib.request, urllib.parse
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from bs4 import BeautifulSoup

OUT=(Path(__file__).resolve().parent / 'shipping_extra.geojson')
API='https://data.alltheplaces.xyz/runs/latest/output/'
HEADERS={'User-Agent':'Personal NJ shipping map research (contact via github.com/mbligh/mapping)'}
def fetch(url, timeout=45):
    req=urllib.request.Request(url,headers=HEADERS)
    with urllib.request.urlopen(req,timeout=timeout) as r:return r.read()
def features_for(name):
    # Per-spider endpoint avoids downloading the full weekly archive.
    for candidate in (name, name+'_us'):
        try:
            obj=json.loads(fetch(API+candidate+'.geojson'))
            fs=obj.get('features',[])
            if fs:
                print(f'ATP {candidate}: {len(fs)} features')
                return fs
        except Exception as e:
            print(f'ATP {candidate} unavailable: {e}')
    return []
def nj(f):
    p=f.get('properties') or {}
    state=str(p.get('addr:state') or p.get('state') or '').strip().upper()
    if state in ('NJ','NEW JERSEY'):return True
    # Coordinates are only a fallback for missing state; NJ bounds are approximate.
    if state:return False
    g=f.get('geometry') or {}
    c=g.get('coordinates') or []
    return len(c)>=2 and -75.57<=c[0]<=-73.88 and 38.88<=c[1]<=41.36
def normal(s):
    s=re.sub(r'[^A-Z0-9 ]',' ',str(s or '').upper())
    for a,b in [('STREET','ST'),('AVENUE','AVE'),('ROAD','RD'),('BOULEVARD','BLVD'),('HIGHWAY','HWY'),('ROUTE','RT'),('NORTH','N'),('SOUTH','S'),('EAST','E'),('WEST','W')]:
        s=re.sub(r'\b'+a+r'\b',b,s)
    return ' '.join(s.split())
def addr(p):
    # ATP uses a combined street_address; OSM-style records split the fields.
    if p.get('addr:street_address'):
        return str(p['addr:street_address']).strip()
    return ' '.join(str(p.get(k) or '') for k in ('addr:housenumber','addr:street')).strip()
def as_feature(f,carrier,name,source):
    p=f.get('properties') or {}
    return {'type':'Feature','geometry':f['geometry'],'properties':{
        'carrier':carrier,'name':name,'address':' '.join(filter(None,[addr(p),p.get('addr:city'),p.get('addr:state'),p.get('addr:postcode')])),
        'hours':p.get('opening_hours') or '','source':source,'osm':'',
        'website':p.get('website') or ''}}
def cvs_page(city):
    slug=urllib.parse.quote(city.strip().replace(' ','-'),safe='-')
    url='https://www.cvs.com/store-locator/cvs-pharmacy-locations/New-Jersey/'+slug+'/ups-access-point'
    try:
        html=fetch(url,timeout=25).decode('utf-8','replace')
        soup=BeautifulSoup(html,'html.parser')
        text=soup.get_text('\n',strip=True)
        if 'UPS' not in text.upper():return []
        # Address heading is followed by city, state and ZIP on CVS city pages.
        pattern=r'(?im)^([0-9][^\n]{3,100})\n'+re.escape(city)+r',?\s*NJ,?\s*(\d{5})\b'
        return [(normal(a),zipc) for a,zipc in re.findall(pattern,text)]
    except Exception as e:
        print(f'CVS {city}: {e}')
        raise RuntimeError(f'CVS verification unavailable for {city}') from e


def preserve_verified_cvs(current,previous):
    if previous.get('type')!='FeatureCollection':
        raise ValueError('Invalid previous shipping extras')
    verified=[f for f in previous.get('features',[]) if
              f.get('properties',{}).get('carrier')=='CVS UPS' and
              f['properties'].get('source')=='CVS UPS Access Point page + All The Places coordinates']
    if not verified:
        raise ValueError('CVS unavailable and no previously verified CVS records; refusing incomplete data')
    retained=[{**f,'properties':{**f['properties'],
               'verification':'Previously verified CVS UPS access point; live verification unavailable'}} for f in verified]
    return [f for f in current if f['properties'].get('carrier')!='CVS UPS']+retained

def main():
    ups=features_for('the_ups_store')
    if not ups:ups=features_for('ups_store')
    cvs=features_for('cvs')
    if not cvs:cvs=features_for('cvs_pharmacy')
    if not ups or not cvs:
        raise SystemExit('Missing ATP UPS Store or CVS spider; refusing to publish incomplete dataset')
    
    out=[]
    for f in ups:
        if nj(f) and (f.get('geometry') or {}).get('type')=='Point':
            out.append(as_feature(f,'All The Places','The UPS Store (ATP)','All The Places: UPS Store'))
    candidates=defaultdict(list)
    for f in cvs:
        if not nj(f) or (f.get('geometry') or {}).get('type')!='Point':continue
        p=f.get('properties') or {}
        city=str(p.get('addr:city') or '').strip()
        if city:candidates[city].append(f)
    print(f'ATP NJ UPS Stores: {len(out)}; NJ CVS candidates: {sum(map(len,candidates.values()))} across {len(candidates)} cities')
    matched=0
    checked=0
    failed=False
    for city,stores in sorted(candidates.items()):
        try:
            addresses=cvs_page(city)
        except RuntimeError:
            failed=True
            break
        checked+=1
        for f in stores:
            p=f.get('properties') or {}
            a=normal(addr(p));z=str(p.get('addr:postcode') or '')[:5]
            if not a or not z:continue
            if any(z==zipc and SequenceMatcher(None,a,other).ratio()>=0.83 for other,zipc in addresses):
                out.append(as_feature(f,'CVS UPS','CVS UPS Access Point','CVS UPS Access Point page + All The Places coordinates'))
                matched+=1
        time.sleep(0.2)
    print(f'CVS cities checked: {checked}; confirmed UPS Access Points: {matched}')
    if len(out)<10:
        raise SystemExit('Too few ATP UPS Store locations; refusing to overwrite existing data')
    if failed:
        out=preserve_verified_cvs(out,json.loads(OUT.read_text()))
        print('::warning::Live CVS verification unavailable; retained previously verified CVS records with an explicit verification label',flush=True)
    elif matched==0:
        raise SystemExit('CVS verification produced no matches; refusing to publish incomplete data')
    OUT.write_text(json.dumps({'type':'FeatureCollection','features':out},separators=(',',':')))
    print(f'Wrote {len(out)} ATP and CVS locations')

if __name__=='__main__':
    main()

