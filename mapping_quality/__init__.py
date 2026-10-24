"""Reusable, deterministic address/coordinate arbitration for point feeders.

No carrier-specific logic, HTTP calls, file writes, or review queue lives here.
Resolvers supply independently obtained Reference objects keyed by Address.
"""
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
import math
import re

VERSION = 1
SUFFIXES = {'ROAD':'RD','STREET':'ST','AVENUE':'AVE','BOULEVARD':'BLVD',
            'DRIVE':'DR','LANE':'LN','COURT':'CT','PLACE':'PL','TERRACE':'TER',
            'CIRCLE':'CIR','PARKWAY':'PKWY','HIGHWAY':'HWY','TURNPIKE':'TPKE',
            'TRAIL':'TRL','SQUARE':'SQ','PLAZA':'PLZ','ROUTE':'RT',
            'NORTH':'N','SOUTH':'S','EAST':'E','WEST':'W'}


def words(value):
    return ' '.join(re.sub(r'[^A-Z0-9 -]', ' ', str(value or '').upper()).split())


def street_key(value):
    text = words(str(value or '').replace('#',' UNIT '))
    text = re.sub(r'\b(?:SUITE|STE|UNIT|APT|APARTMENT|ROOM|RM|FLOOR|FL)\b.*$', '', text).strip()
    tokens = [SUFFIXES.get(token, token) for token in text.split()]
    text = ' '.join(tokens)
    return re.sub(r'\bUS (?:HWY|RT)\b', 'US', text)


def locality_key(value):
    text = words(value)
    return re.sub(r'\b(?:TOWNSHIP|BOROUGH|CITY|TOWN|VILLAGE|TWP|BORO)\b', '', text).strip()


def coordinates(feature):
    geometry = feature.get('geometry') or {}
    point = geometry.get('coordinates') or []
    if (geometry.get('type') != 'Point' or len(point) != 2
            or not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in point)
            or not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90)):
        raise ValueError('Expected finite WGS84 Point coordinates')
    return list(point)


def distance(a, b):
    x, y, X, Y = map(math.radians, [*a, *b])
    h = math.sin((Y-y)/2)**2 + math.cos(y)*math.cos(Y)*math.sin((X-x)/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


@dataclass(frozen=True)
class Address:
    street: str
    city: str = ''
    state: str = 'NJ'
    postcode: str = ''

    @classmethod
    def from_properties(cls, p):
        parts = p.get('address_parts') or {}
        street = parts.get('street') or p.get('addr:street_address') or p.get('street_address') or p.get('street')
        if not street:
            street = ' '.join(str(p.get(k) or '') for k in ('addr:housenumber', 'addr:street')).strip()
        city = parts.get('city') or p.get('addr:city') or p.get('city') or ''
        state = parts.get('state') or p.get('addr:state') or p.get('state') or p.get('region') or ''
        postcode = parts.get('postcode') or p.get('addr:postcode') or p.get('postcode') or ''
        state='NJ' if words(state)=='NEW JERSEY' else words(state)
        if state.startswith('US-') and len(state)==5:state=state[3:]
        return cls(str(street or ''), str(city), state, str(postcode)[:5])

    @property
    def key(self):
        return (street_key(self.street), locality_key(self.city), self.state, self.postcode)

    @property
    def query(self):
        """House number and street stem for a broad NJ query, not a match rule."""
        text = street_key(self.street)
        match = re.match(r'^(\d+)\s+(.+)$', text)
        if not match or '-' in match[1]:
            return None
        tokens = match[2].split()
        if len(tokens)>1 and tokens[-1] in set(SUFFIXES.values()):tokens=tokens[:-1]
        # Query both normalized and spelled-out forms for road names such as
        # "North Avenue". Exact complete-address matching happens afterwards.
        variants=[tokens]
        if len(tokens)>1 and tokens[0] in ('N','S','E','W'):variants.append(tokens[1:])
        if len(tokens)>1 and tokens[-1] in ('N','S','E','W'):variants.append(tokens[:-1])
        stems={match[2]}
        for variant in variants:
            stems.add(' '.join(variant))
            stems.add(' '.join(next((k for k,v in SUFFIXES.items() if v==t),t) for t in variant))
        return (int(match[1]), tuple(sorted(stems)))


@dataclass(frozen=True)
class Reference:
    address: Address
    point: tuple
    source: str
    record_id: str
    placement: str
    primary: bool = True
    stale: bool = False

    @property
    def rank(self):
        text = self.placement.lower()
        if 'rooftop' in text or 'structure' in text or 'building' in text:
            return 3
        if 'entrance' in text or 'access' in text:
            return 2
        if 'parcel' in text:
            return 1
        return 0


def choose_reference(address, candidates):
    """Ignore source coordinates when selecting an independent address match."""
    matches = [r for r in candidates if r.address.state==address.state
               and street_key(r.address.street)==street_key(address.street) and r.rank>0]
    if not matches:
        return None, 'no_address_match'
    # City/ZIP are disambiguators, not absolute requirements: USPS PO-box ZIPs
    # and municipal delivery labels can differ, as at Oldwick/Whitehouse Station.
    def locality_score(r):
        return (bool(address.postcode and address.postcode==r.address.postcode),
                bool(address.city and locality_key(address.city)==locality_key(r.address.city)))
    best_locality=max(map(locality_score,matches))
    best=[r for r in matches if locality_score(r)==best_locality]
    # Never choose one of two distant Main St addresses by record order or by
    # proximity to the very coordinates being checked.
    if any(distance(a.point,b.point)>100 for a in best for b in best):
        return None, 'ambiguous_address_match'
    return min(best, key=lambda r:(-r.rank,not r.primary,r.record_id)), 'matched'


def clean_features(features, resolver, *, selected=None, max_shift_m=250):
    """Return cleaned copies and a quality summary. Never merge/drop records.

    resolver.resolve_many(addresses) -> {Address: [Reference,...]}; all matching
    candidates must be supplied, not just one arbitrarily chosen geocode.
    """
    if not math.isfinite(max_shift_m) or max_shift_m<0:
        raise ValueError('max_shift_m must be finite and non-negative')
    selected = selected or (lambda f:True)
    indices = [i for i,f in enumerate(features) if selected(f)]
    for i in indices:
        coordinates(features[i])
    addresses = {i:Address.from_properties(features[i].get('properties') or {}) for i in indices}
    supported=getattr(resolver,'supported_states',None)
    eligible = sorted({a for a in addresses.values() if a.state and a.query and (supported is None or a.state in supported)}, key=lambda a:a.key)
    references = resolver.resolve_many(eligible)
    output = list(features)
    counts = Counter()
    for i in indices:
        f = deepcopy(features[i])
        p = f.setdefault('properties', {})
        current = coordinates(f)
        old = p.get('location_quality')
        # Re-running over an already cleaned file must not relabel a corrected
        # coordinate as an original observation or lose its audit trail.
        original = old.get('original_coordinates',current) if isinstance(old,dict) else current
        a = addresses[i]
        reference, reason = choose_reference(a,references.get(a,[])) if a in references else (None,'reference_unavailable' if a in eligible else 'missing_or_unsupported_address')
        if reference is None:
            if isinstance(old,dict) and old.get('status')=='corrected':
                status = 'corrected'
                info = {**old, 'reference_check':reason, 'reference_stale':True}
            else:
                status = 'unresolved'
                info = {'version':VERSION,'status':status,'reason':reason,'original_coordinates':original,
                        'original_coordinate_source':p.get('coordinate_source')}
        else:
            shift = distance(original, reference.point)
            status = 'corrected' if shift>max_shift_m else 'checked'
            info = {'version':VERSION,'status':status,'reason':'independent_address_point',
                    'original_coordinates':original,'reference_coordinates':list(reference.point),
                    'original_coordinate_source':old.get('original_coordinate_source') if isinstance(old,dict) else p.get('coordinate_source'),
                    'reference_source':reference.source,'reference_id':reference.record_id,
                    'reference_placement':reference.placement,'reference_stale':reference.stale,
                    'distance_m':round(shift,1),'address_match':street_key(a.street),
                    'postal_label_differs':bool(a.postcode and a.postcode!=reference.address.postcode)}
            if status=='corrected':
                f['geometry']={'type':'Point','coordinates':list(reference.point)}
                p['coordinate_source']=f'{reference.source} ({reference.placement}); estimated address position'
            elif isinstance(old,dict) and old.get('status')=='corrected':
                f['geometry']={'type':'Point','coordinates':list(original)}
                if info['original_coordinate_source'] is None:p.pop('coordinate_source',None)
                else:p['coordinate_source']=info['original_coordinate_source']
        p['location_quality']=info
        p['position_quality']={'corrected':'Corrected to an independent address point; estimated position',
                               'checked':'Source position retained; agrees with an independent address point',
                               'unresolved':'No unambiguous address reference; source position retained'}[status]
        if info.get('reference_stale'):p['position_quality']+=' (cached reference)'
        counts[status]+=1
        output[i]=f
    return output, {'version':VERSION,'policy':{'max_shift_m':max_shift_m},'selected':len(indices),
                    'unique_addresses':len(eligible),'counts':dict(counts),
                    'resolver':getattr(resolver,'summary',{})}
