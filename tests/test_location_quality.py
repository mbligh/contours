import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.parse

from mapping_quality import Address, Reference, choose_reference, clean_features, distance, street_key
from mapping_quality.nj import NJAddressPoints, InvalidQuery

OLDWICK=(-74.748041996261,40.665531511097186)
WRONG=(-74.737096,40.662367)


def feature(point=WRONG,ref='box-2',**parts):
    return {'type':'Feature','id':ref,'geometry':{'type':'Point','coordinates':list(point)},
            'properties':{'source':'USPS locator via All The Places','ref':ref,
                          'collection_times':'Mo-Fr 16:15; Sa 11:15','indoor':'yes',
                          'address_parts':{'street':'174 Lamington Rd','city':'Oldwick','state':'NJ','postcode':'08858',**parts}}}


def reference(point=OLDWICK,**kwargs):
    return Reference(Address('174 Lamington Road','Whitehouse Station','NJ','08889'),point,
                     'NJ statewide address points','629505','Structure - Rooftop',**kwargs)


class Resolver:
    def __init__(self,candidates):self.candidates=candidates;self.calls=[]
    def resolve_many(self,addresses):
        self.calls.append(addresses)
        return {a:self.candidates for a in addresses}


class Arbitration(unittest.TestCase):
    def test_oldwick_postal_alias_and_outlier(self):
        raw=feature();original=copy.deepcopy(raw)
        out,report=clean_features([raw],Resolver([reference()]))
        self.assertEqual(out[0]['geometry']['coordinates'],list(OLDWICK))
        self.assertEqual(raw,original,'Inputs must not be mutated')
        p=out[0]['properties'];self.assertEqual(p['collection_times'],raw['properties']['collection_times'])
        self.assertEqual(p['indoor'],'yes');self.assertEqual(out[0]['id'],'box-2')
        self.assertTrue(p['location_quality']['postal_label_differs'])
        self.assertEqual(p['location_quality']['original_coordinates'],list(WRONG))
        self.assertEqual(report['counts'],{'corrected':1})

    def test_nearby_position_kept_and_records_never_merged(self):
        a=feature((-74.7478523865,40.6660085756),'box-1')
        b=feature((-74.747856886,40.665998601),'box-3')
        out,report=clean_features([a,b],Resolver([reference()]))
        self.assertEqual(len(out),2)
        self.assertEqual([x['geometry'] for x in out],[a['geometry'],b['geometry']])
        self.assertEqual(report['unique_addresses'],1)
        self.assertEqual(report['counts'],{'checked':2})

    def test_repeated_cleanup_preserves_audit(self):
        out,_=clean_features([feature()],Resolver([reference()]))
        again,_=clean_features(out,Resolver([reference()]))
        self.assertEqual(out,again)

    def test_new_reference_can_restore_original(self):
        out,_=clean_features([feature()],Resolver([reference()]))
        restored,_=clean_features(out,Resolver([reference(WRONG)]))
        self.assertEqual(restored[0]['geometry']['coordinates'],list(WRONG))
        self.assertEqual(restored[0]['properties']['location_quality']['status'],'checked')
        self.assertNotIn('coordinate_source',restored[0]['properties'])

    def test_missing_lookup_never_hides_records(self):
        out,report=clean_features([feature()],Resolver([]))
        self.assertEqual(out[0]['geometry'],feature()['geometry'])
        self.assertEqual(report['counts'],{'unresolved':1})

    def test_existing_correction_survives_lookup_loss(self):
        out,_=clean_features([feature()],Resolver([reference()]))
        retained,_=clean_features(out,Resolver([]))
        self.assertEqual(retained[0]['geometry'],out[0]['geometry'])
        self.assertEqual(retained[0]['properties']['location_quality']['original_coordinates'],list(WRONG))

    def test_source_coordinate_does_not_break_ambiguous_tie(self):
        a=Address('174 Lamington Rd','Unknown','NJ','')
        other=Reference(Address('174 Lamington Road','Elsewhere','NJ','00000'),WRONG,'NJ','2','Structure - Rooftop')
        self.assertEqual(choose_reference(a,[reference(),other]),(None,'ambiguous_address_match'))

    def test_house_number_street_and_state_must_match(self):
        for address in [Address('176 Lamington Rd','Oldwick','NJ','08858'),Address('174 Lamington Ave','Oldwick','NJ','08858'),Address('174 Lamington Rd','Oldwick','NY','08858')]:
            self.assertIsNone(choose_reference(address,[reference()])[0])

    def test_postcode_disambiguates_same_address_in_two_towns(self):
        other=Reference(Address('174 Lamington Road','Elsewhere','NJ','00000'),WRONG,'NJ','2','Structure - Rooftop')
        a=Address('174 Lamington Rd','','NJ','08889')
        self.assertEqual(choose_reference(a,[reference(),other])[0],reference())

    def test_weak_street_interpolation_cannot_override_points(self):
        weak=Reference(reference().address,OLDWICK,'Census','1','Street range interpolation')
        out,_=clean_features([feature()],Resolver([weak]))
        self.assertEqual(out[0]['geometry'],feature()['geometry'])

    def test_selection_leaves_osm_alone(self):
        osm=feature();osm['properties']['source']='OpenStreetMap'
        resolver=Resolver([reference()])
        out,report=clean_features([osm,feature()],resolver,selected=lambda f:'All The Places' in f['properties']['source'])
        self.assertEqual(out[0],osm);self.assertEqual(report['selected'],1)

    def test_normalization_keeps_direction_and_handles_units(self):
        self.assertEqual(street_key('174 Lamington Road, Suite 5'),street_key('174 LAMINGTON RD #5'))
        self.assertNotEqual(street_key('174 N Main St'),street_key('174 S Main St'))
        self.assertIn('NORTH',Address('1 North Avenue').query[1])
        self.assertEqual(street_key('20 US Highway 22'),street_key('20 US Route 22'))

    def test_invalid_coordinates_fail_before_lookups(self):
        resolver=Resolver([reference()]);bad=feature();bad['geometry']['coordinates']=[True,40]
        with self.assertRaises(ValueError):clean_features([bad],resolver)
        self.assertFalse(resolver.calls)


def api_feature(ident=629505,point=OLDWICK):
    return {'type':'Feature','id':ident,'geometry':{'type':'Point','coordinates':list(point)},
            'properties':{'OBJECTID':ident,'FULLADDR':'174 Lamington Road','POST_CODE':'08889',
                          'POST_COMM':'Whitehouse Station','PRIMARYPT':'Y','PLACEMENT':'Structure - Rooftop','STATUS':'A'}}


class AddressCache(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.address=Address('174 Lamington Rd','Oldwick','NJ','08858')

    def test_batched_lookup_reuses_cache_across_feeders(self):
        calls=[]
        def fetch(url):calls.append(url);return {'features':[api_feature()]}
        a=NJAddressPoints(self.directory.name,fetch=fetch,clock=lambda:100)
        result=a.resolve_many([self.address,self.address])
        self.assertEqual(len(calls),1);self.assertEqual(result[self.address][0].point,OLDWICK)
        b=NJAddressPoints(self.directory.name,fetch=lambda _:self.fail('Cache should be shared'),clock=lambda:101)
        self.assertEqual(b.resolve_many([self.address])[self.address][0].record_id,'629505')

    def test_outage_uses_stale_positive_cache_and_marks_it(self):
        NJAddressPoints(self.directory.name,fetch=lambda _: {'features':[api_feature()]},clock=lambda:100).resolve_many([self.address])
        def fail(url):raise OSError('unavailable')
        resolver=NJAddressPoints(self.directory.name,fetch=fail,clock=lambda:100+31*86400)
        result=resolver.resolve_many([self.address]);self.assertTrue(result[self.address][0].stale)
        self.assertEqual(resolver.summary['stale_queries'],1)

    def test_failure_without_cache_is_not_cached_as_no_match(self):
        def fail(url):raise OSError('unavailable')
        resolver=NJAddressPoints(self.directory.name,fetch=fail)
        self.assertEqual(resolver.resolve_many([self.address]),{})
        self.assertFalse(list(Path(self.directory.name).glob('*.json')))

    def test_empty_success_has_shorter_cache_lifetime(self):
        NJAddressPoints(self.directory.name,fetch=lambda _: {'features':[]},clock=lambda:100).resolve_many([self.address])
        calls=[]
        resolver=NJAddressPoints(self.directory.name,fetch=lambda url:calls.append(url) or {'features':[api_feature()]},clock=lambda:100+8*86400)
        self.assertEqual(len(resolver.resolve_many([self.address])[self.address]),1)
        self.assertEqual(len(calls),1)

    def test_partial_pagination_is_not_cached(self):
        def fetch(url):
            offset=int(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['resultOffset'][0])
            if offset:raise OSError('second page unavailable')
            return {'features':[api_feature()], 'exceededTransferLimit':True}
        resolver=NJAddressPoints(self.directory.name,fetch=fetch)
        self.assertEqual(resolver.resolve_many([self.address]),{})
        self.assertFalse(list(Path(self.directory.name).glob('*.json')))

    def test_repeated_page_fails_instead_of_treating_partial_set_as_unique(self):
        resolver=NJAddressPoints(self.directory.name,fetch=lambda _: {'features':[api_feature()],'exceededTransferLimit':True})
        self.assertEqual(resolver.resolve_many([self.address]),{})

    def test_retired_references_are_ignored(self):
        f=api_feature();f['properties']['STATUS']='R'
        resolver=NJAddressPoints(self.directory.name,fetch=lambda _: {'features':[f]})
        self.assertEqual(resolver.resolve_many([self.address])[self.address],[])

    def test_oversized_expression_splits_and_keeps_all_successful_results(self):
        calls=[]
        other=Address('161 Meister Ave','Branchburg','NJ','08876')
        def fetch(url):
            where=urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['where'][0];calls.append(where)
            if '161 ' in where and '174 ' in where:raise InvalidQuery('expression too complex')
            if '161 ' in where:
                f=api_feature(2);f['properties']['FULLADDR']='161 Meister Avenue'
                return {'features':[f]}
            return {'features':[api_feature()]}
        result=NJAddressPoints(self.directory.name,fetch=fetch).resolve_many([self.address,other])
        self.assertEqual(len(calls),3)
        self.assertEqual(len(result[self.address]),1);self.assertEqual(len(result[other]),1)

    def test_flat_query_cross_product_is_filtered_before_caching(self):
        other=Address('161 Meister Ave','Branchburg','NJ','08876')
        false=api_feature(3);false['properties']['FULLADDR']='174 Meister Avenue'
        result=NJAddressPoints(self.directory.name,fetch=lambda _: {'features':[api_feature(),false]}).resolve_many([self.address,other])
        self.assertEqual(len(result[self.address]),1)
        self.assertEqual(result[other],[])

    def test_query_uses_full_address_spelling_variants_without_table_functions(self):
        queries=[]
        def fetch(url):
            queries.append(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['where'][0])
            return {'features':[api_feature()]}
        NJAddressPoints(self.directory.name,fetch=fetch).resolve_many([self.address])
        self.assertTrue(queries[0].startswith('ADD_NUMBER IN (174) AND FULLADDR IN ('))
        self.assertIn("'174 LAMINGTON ROAD'",queries[0])
        self.assertNotIn('UPPER(',queries[0])


class CliIntegration(unittest.TestCase):
    def test_shared_cache_two_feeders_dry_run_then_real_run(self):
        script=Path(__file__).resolve().parents[1]/'scripts/clean_locations'
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);cache=directory/'cache'
            address=Address.from_properties(feature()['properties'])
            NJAddressPoints(cache,fetch=lambda _: {'features':[api_feature()]}).resolve_many([address])
            files=[directory/'usps.geojson',directory/'fedex.geojson']
            for i,path in enumerate(files):
                f=feature(ref=str(i));f['properties']['source']='USPS ATP' if i==0 else 'FedEx ATP'
                path.write_text(json.dumps({'type':'FeatureCollection','features':[f]}))
            originals=[p.read_bytes() for p in files]
            command=[sys.executable,str(script),*map(str,files),'--cache-dir',str(cache),'--source','ATP']
            subprocess.run([*command,'--dry-run'],check=True,capture_output=True,timeout=10)
            self.assertEqual([p.read_bytes() for p in files],originals)
            subprocess.run(command,check=True,capture_output=True,timeout=10)
            for i,path in enumerate(files):
                result=json.loads(path.read_text())
                self.assertEqual(result['features'][0]['geometry']['coordinates'],list(OLDWICK))
                self.assertEqual(result['features'][0]['id'],str(i))
                self.assertEqual(result['location_quality']['counts'],{'corrected':1})
            before=[json.loads(p.read_text())['features'] for p in files]
            subprocess.run(command,check=True,capture_output=True,timeout=10)
            self.assertEqual([json.loads(p.read_text())['features'] for p in files],before)

    def test_bad_second_file_leaves_first_intact(self):
        script=Path(__file__).resolve().parents[1]/'scripts/clean_locations'
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/'a.json',Path(d)/'b.json'
            a.write_text(json.dumps({'type':'FeatureCollection','features':[feature()]}));original=a.read_bytes()
            b.write_text('{"type":"NotGeoJSON"}')
            result=subprocess.run([sys.executable,str(script),str(a),str(b)],capture_output=True,timeout=10)
            self.assertNotEqual(result.returncode,0);self.assertEqual(a.read_bytes(),original)


if __name__=='__main__':unittest.main()
