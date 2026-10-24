# Shared point-location quality library

`mapping_quality` is a standard-library-only Python package shared by mapping feeders. It separates source parsing from address normalization, independent reference matching, coordinate arbitration, provenance, and quality summaries. There are no carrier names or carrier-specific merge rules in the package. It never merges, hides, or deletes input records.

## API

```python
from mapping_quality import clean_features
from mapping_quality.nj import NJAddressPoints

resolver = NJAddressPoints('/tmp/mapping-location-quality')
cleaned, report = clean_features(features, resolver, max_shift_m=250)
```

The core accepts GeoJSON points with `properties.address_parts` containing `street`, `city`, `state`, and `postcode`. It also reads ATP's `addr:*` properties and common `street`/`street_address`, `city`, `region`/`state`, and `postcode` fields. The resolver interface is `resolve_many(addresses) -> {Address: list[Reference]}`. Alternative reference providers can implement it without changing the matching engine. Network I/O and caching are isolated in `nj.py`; the matching engine is deterministic and tested offline.

## Arbitration policy

1. Normalize case, punctuation, common street types/directions, units for building-level matching, state labels, and ZIP+4. Keep complete source addresses in the input properties. House numbers, road direction, and street type remain part of the exact match.
2. Query NJ's statewide address points independently of the source coordinates. Fetch all relevant candidates and paginate completely before trusting a result. Only active, valid NJ points are considered.
3. Match the full normalized street address and state. Prefer matching ZIP and postal locality to disambiguate duplicate street addresses. Postal labels are not absolute requirements: the Oldwick post office uses `Oldwick 08858` while NJ's rooftop record uses `Whitehouse Station 08889`. If multiple equally supported candidates are more than 100 metres apart, do not choose one by proximity to the suspect coordinates.
4. Prefer structure/rooftop references, then entrances/access points, then parcels. Unclassified or street-range-only estimates do not override source coordinates. This provider does not use Census interpolation, town centroids, or ZIP centroids.
5. Keep source coordinates within 250 metres of the matched reference. Correct more distant points to the independently resolved address point, explicitly labeled as an **estimated address position**, not the surveyed box/store entrance. The distance is configurable.
6. Keep separate source IDs, pickup schedules, indoor/lobby distinctions, and business attributes even when several points share an address. Corrections are positional, not entity deduplication.
7. Unresolved or unavailable lookups retain the best existing position with a quality label. Previously corrected input points retain their correction if rechecked during an outage. Cached positive reference answers remain usable when the service is unavailable, with `reference_stale=true`. There is no manual-review queue or publication dependency on human intervention.

`properties.location_quality` records the engine version, status (`checked`, `corrected`, `unresolved`), reason, original coordinates, matched reference coordinates/ID/source/placement, displacement, postal-label differences, and stale-cache status. `position_quality` is a plain-text display label; corrections also set `coordinate_source`. Repeated cleanup preserves original coordinates and correction provenance. A later authoritative reference can restore the original position when appropriate.

These checks validate position against an address reference. They do not establish that a business/box still exists, that a street address is correct, or that collection times are current. Existing feeder-specific classification and service verification remain in the feeders.

## CLI and pipeline

```sh
python scripts/clean_locations points.geojson --dry-run
python scripts/clean_locations public/shipping/*.geojson \
    --source 'All The Places' --source MailingLocations \
    --cache-dir /tmp/mapping-location-quality
```

Without `--source`, all input points are selected. A source option is a case-insensitive substring and may be repeated. The CLI resolves all selected addresses in one pass across all files, sharing requests and cache entries. It stages outputs after parsing and cleaning all inputs, replaces each output file atomically, and embeds a collection-level `location_quality` summary in each GeoJSON. Standard output reports aggregate and per-file counts. `--dry-run` performs the same lookups without changing input files.

The shipping workflow runs this pass after the USPS, FedEx, UPS/CVS, and MailingLocations feeders and before validation/commit/release. The feeders retain structured address components for the shared pass; OSM and USGS records are excluded by source selection. All four existing GeoJSON files and the release format remain in use. The map shows the position-check label and estimated-position provenance in popups.

The NJ provider queries at most 100 address keys per batch, with three workers. Responses are cached by normalized house number/street stem, independently of per-record postal-label disambiguation. Positive answers expire after 30 days; no-match answers after seven days. Failed/partial responses are never stored as no-match answers. After three failed batches, queued requests are cancelled to avoid spending the whole run retrying an unavailable service. Cache errors and unresolved coverage remain visible in the report. GitHub Actions restores/saves the derived cache between runs; this cache can be deleted and rebuilt and requires no database service.

The public reference is [NJ's statewide address-point service](https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/AddressPoints/FeatureServer/0), maintained by NJ OGIS. The [NJGIN address-data description](https://www.nj.gov/njgin/edata/addresses/) explains its origins and building-footprint placement. This is independent of ATP's USPS/FedEx/UPS locator coordinates.

## Tests

```sh
python -m unittest discover -s tests -p test_location_quality.py
```

Tests cover the real Oldwick/Whitehouse Station postal-label conflict; preserving nearby positions and separate boxes; exact-address ambiguity; wrong house numbers/directions/types/states; weak references; non-mutation; repeatability and restoring original coordinates; shared caches; stale-cache fallback; failures without cache; negative-cache expiry; incomplete/repeated pagination; and retired references. Shipping's existing importer, browser, and dataset tests remain in the workflow.
