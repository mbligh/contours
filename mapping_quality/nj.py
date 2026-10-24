"""Batched NJ statewide address-point resolver with a rebuildable disk cache."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

from . import Address, Reference, coordinates

SERVICE='https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/AddressPoints/FeatureServer/0'
FIELDS='OBJECTID,FULLADDR,POST_CODE,POST_COMM,PRIMARYPT,PLACEMENT,STATUS,SOURCE'


def fetch_json(url):
    parts=urllib.parse.urlsplit(url)
    # POST is a read-only ArcGIS query here; it avoids URL length limits for
    # batches of addresses. Keep the logical URL for injectable/offline tests.
    endpoint=urllib.parse.urlunsplit((parts.scheme,parts.netloc,parts.path,'',''))
    request=urllib.request.Request(endpoint,data=parts.query.encode(),headers={
        'User-Agent':'Mapping coordinate quality; github.com/mbligh/mapping',
        'Content-Type':'application/x-www-form-urlencoded'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request,timeout=60) as response:
                data=json.load(response)
            if 'error' in data:
                raise ValueError(str(data['error']))
            return data
        except Exception:
            if attempt==2:raise
            time.sleep(2**attempt)


class NJAddressPoints:
    """Candidate retrieval is broad; exact matching lives in the pure library.

    Successes (including no-match answers) are cached by query, separately from
    per-record city/ZIP disambiguation. Failed/partial requests are never cached.
    Stale successful answers are usable during an outage and marked as stale.
    """
    supported_states={'NJ'}

    def __init__(self,cache_dir,*,fetch=fetch_json,clock=time.time,batch_size=100,workers=3):
        self.cache=Path(cache_dir);self.cache.mkdir(parents=True,exist_ok=True)
        self.fetch=fetch;self.clock=clock;self.batch_size=batch_size;self.workers=workers
        self.summary={}

    def _path(self,key):
        digest=hashlib.sha256(json.dumps([SERVICE,1,key],sort_keys=True).encode()).hexdigest()
        return self.cache/(digest+'.json')

    def _read(self,key):
        try:
            data=json.loads(self._path(key).read_text())
            if (data.get('schema')!=1 or not isinstance(data.get('features'),list)
                    or not isinstance(data.get('fetched_at'),(int,float))):return None
            return data
        except (OSError,ValueError):return None

    def _query(self,keys):
        clauses=[]
        for number,stems in keys:
            values=','.join("'"+s.replace("'","''")+"'" for s in stems)
            clauses.append(f'(ADD_NUMBER={number} AND (UPPER(ST_NAME) IN ({values}) OR UPPER(LST_NAME) IN ({values})))')
        where=' OR '.join(clauses)
        features=[];offset=0;seen=set()
        while True:
            params={'where':where,'outFields':FIELDS,'outSR':4326,'f':'geojson',
                    'resultRecordCount':1000,'resultOffset':offset,'orderByFields':'OBJECTID ASC'}
            url=SERVICE+'/query?'+urllib.parse.urlencode(params)
            data=self.fetch(url)
            page=data.get('features')
            if not isinstance(page,list):raise ValueError('Invalid address-point response')
            for feature in page:
                ident=feature.get('id',feature.get('properties',{}).get('OBJECTID'))
                if ident is None or ident in seen:raise ValueError('Missing/repeated address-point ID during pagination')
                seen.add(ident)
            features.extend(page)
            if len(page)<1000 and not data.get('exceededTransferLimit'):break
            if not page:raise ValueError('Incomplete address-point pagination')
            offset+=len(page)
        return features

    def resolve_many(self,addresses):
        keys=sorted({a.query for a in addresses if a.query and a.state=='NJ'})
        cached={key:self._read(key) for key in keys}
        now=self.clock();missing=[];fresh=0;stale_keys=set();failed_keys=set();errors=[];failures=0
        for key in keys:
            value=cached[key]
            ttl=30*86400 if value and value['features'] else 7*86400
            if value and 0<=now-value['fetched_at']<ttl:fresh+=1
            else:missing.append(key)
        batches=[missing[i:i+self.batch_size] for i in range(0,len(missing),self.batch_size)]
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            pending={pool.submit(self._query,batch):batch for batch in batches}
            for future in as_completed(pending):
                batch=pending[future]
                try:
                    features=future.result()
                    # A completed query supplies every candidate for each key.
                    for key in batch:
                        matches=[f for f in features if Address(str(f['properties'].get('FULLADDR') or '')).query==key
                                 or self._shares_house_and_stem(f,key)]
                        value={'schema':1,'fetched_at':now,'features':matches}
                        path=self._path(key);temp=path.with_suffix('.tmp')
                        temp.write_text(json.dumps(value));temp.replace(path)
                        cached[key]=value
                except Exception as error:
                    failures+=1
                    if str(error):errors.append(str(error)[:300])
                    if failures==3:
                        for other in pending:other.cancel()
                    for key in batch:
                        if cached[key]:stale_keys.add(key)
                        else:failed_keys.add(key)
        result={}
        for address in addresses:
            key=address.query
            if key in failed_keys or key not in cached:continue
            candidates=[]
            for f in (cached[key] or {}).get('features',[]):
                p=f.get('properties') or {}
                if str(p.get('STATUS','')).upper() not in ('','A','ACTIVE'):continue
                try:point=coordinates(f)
                except ValueError:continue
                if not (-75.57<=point[0]<=-73.88 and 38.88<=point[1]<=41.36):continue
                candidates.append(Reference(Address(str(p.get('FULLADDR') or ''),str(p.get('POST_COMM') or ''),'NJ',str(p.get('POST_CODE') or '')[:5]),
                                            tuple(point),'NJ statewide address points',str(p.get('OBJECTID',f.get('id'))),
                                            str(p.get('PLACEMENT') or ''),p.get('PRIMARYPT')=='Y',key in stale_keys))
            result[address]=candidates
        self.summary={'provider':SERVICE,'cached_queries':fresh,'requested_queries':len(missing),
                      'stale_queries':len(stale_keys),'unavailable_queries':len(failed_keys),
                      'circuit_open':failures>=3,'errors':errors[:10]}
        return result

    @staticmethod
    def _shares_house_and_stem(feature,key):
        # The query already constrained the authoritative street-name fields.
        # FULLADDR may spell out "North" where a query normalized it to "N".
        query=Address(str(feature.get('properties',{}).get('FULLADDR') or '')).query
        return bool(query and query[0]==key[0] and set(query[1])&set(key[1]))
