# NJ USPS collection-box source comparison

Read-only investigation on October 23, 2026, before changing shipping inputs or the map. Full measurements and source-file provenance are in [comparison.json](comparison.json).

## Results

| Measure | ATP dedicated USPS collection-box output | Overture 2026-10-21.0 Infrastructure |
| --- | ---: | ---: |
| NJ collection-box records | 5,812, all USPS | 481 across all carriers |
| Explicit USPS identification | 5,812 | 198 |
| Collection times on explicitly identified USPS records | 5,812 | 63 |
| Indoor/lobby boxes explicitly tagged | 1,358 | Not used as a selection filter |

All 481 Overture Infrastructure records identify OpenStreetMap as their source. Carrier tags identify 198 USPS, 35 UPS, 33 FedEx, 11 other operators, and 204 without an identifiable carrier. The 198 explicitly identified USPS features are a conservative subset: some untagged features may also be USPS. ATP's total includes indoor/lobby collection boxes, so it is not a count of blue street boxes alone.

Overture Places was checked separately: 471,560 NJ point records. None of its AllThePlaces source record IDs matched the feature IDs in the current ATP USPS collection-box output. A broad name/category/website search found 1,332 postal-related candidates; narrowing names and categories to mailbox/collection-box terms left 36 candidates, including post offices, shipping counters, mailbox-rental businesses, and ambiguous USPS records. Those candidates are listed in the JSON. They are not evidence of a comprehensive collection-box inventory. Places also lacks collection-time and raw source-tag columns in this release.

This supports using ATP's dedicated USPS output as the primary collection-box source. Overture's inclusion of ATP does not mean the complete USPS box output has been imported into Places. Zero source-ID matches is a snapshot comparison, not proof that no collection box is represented under another provider or category.

## Overlap checks

At 25/50/100 metres, 179/214/240 ATP boxes have a nearby explicitly identified USPS feature in Overture. In the reverse direction, 149/165/175 of Overture's 198 USPS features have a nearby ATP box. These are directional, potentially many-to-one proximity candidates, not verified duplicates.

Thirty explicitly identified USPS features have a `ref` that exactly matches an ATP box. All 30 have collection times in both sources; 16 have identical strings and 14 have different strings. Different formatting or genuine schedule differences can both cause mismatches; this check does not establish which source is correct. The remaining 23 explicit Overture USPS features without an ATP point within 100 metres merit inspection, rather than automatic addition or removal.

## Method and limits

- Resolve the latest Overture release from its official STAC catalog; this run pins `2026-10-21.0`.
- Use STAC extents to select all files intersecting the NJ envelope, then Parquet row-group bounding-box statistics to select byte ranges. Check HTTP range status, boundaries, lengths, and Parquet footer signatures before reading.
- Select Infrastructure records with `class = post_box`; scan all Places records in the same area. Clip both sources' point geometries to the same Census 2024 1:500,000 New Jersey state polygon, excluding neighboring states. All 5,812 NJ-labelled ATP points also fall inside that boundary.
- Classify Infrastructure conservatively from operator/brand identifiers and names. Match exact source IDs, exact USPS box references, and spherical nearest-neighbor distances separately.
- Record source URLs, source-file sizes, Parquet footer hashes, boundary hash, and the complete ATP download SHA-256 in the JSON. Raw downloads and research extracts are scratch files, not production shipping files.
- Counts measure the published datasets, not an on-site audit. Features near a generalized state boundary or with incorrect coordinates can be affected. Overture and ATP snapshots have different collection dates, and nearby points can represent different boxes. An ATP ID mismatch alone is not proof of absence.

ATP snapshot SHA-256: `d0a9d1553d178b257111afb73cc14294612942911a981ecf8339912869b3750c`.

Sources: [ATP USPS boxes](https://data.alltheplaces.xyz/runs/latest/output/usps_collection_boxes.geojson), [Overture STAC](https://stac.overturemaps.org/catalog.json), [Overture Infrastructure schema](https://docs.overturemaps.org/schema/reference/base/infrastructure/), [Census boundary](https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip).

## Reproduce

```sh
python -m pip install -r research/usps/requirements.txt
python research/usps/compare_sources --release 2026-10-21.0 --work-dir /tmp/usps-check
```

The script downloads ATP's current output, the boundary ZIP, and Overture's STAC index; it retrieves only relevant Parquet row groups over HTTPS. Downloads and derived extracts are cached within the work directory. Use a new work directory to check current ATP data; repeat the original snapshot with `--atp-file` pointing to a retained file matching the hash above. Optional `--stac-file` and `--boundary-file` reuse downloaded inputs. Output is `<work-dir>/<release>/comparison.json`; broader postal candidates are saved beside it for inspection. Pinning Overture alone does not pin ATP's moving `latest` endpoint.

This investigation changes no shipping files, public map files, or workflows.
