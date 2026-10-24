# Mapping

## Requirements

- Maintain New Jersey mapping datasets and their reproducible build pipelines.
- Keep contour extraction, contour tile generation, and shipping refreshes in separate GitHub Actions workflows.
- Keep shipping code, regression checks, browser module, and generated GeoJSON together in `public/shipping/`.
- Refresh shipping from OSM, USGS National Map, All The Places, CVS verification pages, and MailingLocations. Include ATP's dedicated NJ USPS collection-box output directly in `shipping.geojson`, preserving collection times, indoor/lobby indicators, notes, and source box IDs. Preserve provenance and conservative deduplication.
- Publish shipping assets at `https://mbligh.github.io/mapping/shipping/` without removing existing contour tiles.
- Commit generated shipping data after successful validation.

## Implementation

Contour scripts remain in `scripts/`. Extraction publishes compressed contour geometry, its checksum, and extraction parameters as a versioned `contour-vectors` Release; the contour workflow turns that geometry into `contours.pmtiles`. Vector releases have no automatic expiry.

Shipping importers write their four GeoJSON files beside the scripts under `public/shipping/`, independent of the caller's working directory. The entire shipping directory lives under `public/` so raw-checkout HTTP servers can serve the module and its data without symlinks. The shipping workflow packages releases relative to `public/`, preserving the existing `shipping/` archive paths and published URLs. Pages also runs the shipping browser regression checks, including resolution of the demo's relative import to the tracked module. `public/shipping/shipping.js` owns browser loading, merging, controls, styling, and popups; the map in `public/maplibre-demo/` imports this module via `../shipping/shipping.js`.

After the OSM/USGS base build, `public/shipping/build_usps` appends USPS collection boxes from ATP. It filters NJ, checks geometry and unique source references, and refuses incomplete inputs before atomically replacing the shared file. The MapLibre demo has an independent **USPS collection boxes** checkbox with smaller blue points; the existing shipping checkbox continues to show staffed locations and post offices. Popups distinguish collection times from opening hours and show indoor/lobby indicators and notes. USPS boxes use the existing shared shipping source and remain separate from colocated post offices and other carriers. No Overture source is used.

Dataset builds never deploy Pages. Shipping validates and commits refreshed data, then publishes a versioned release containing `dataset.tar.gz` and `manifest.json`. Contours independently builds PMTiles from the retained vector Release and publishes the same release format. The manifest records the exact source commit, workflow run, file checksums, and archive checksum. Releases remain drafts until all assets are uploaded. Tags follow `dataset-<shipping|contours|contour-vectors>-<run-id>-<attempt>`; these generated tags are reserved for this pipeline.

**Publish mapping pages** is the sole Pages publisher. It selects the newest complete shipping and PMTiles release (vectors are build inputs, not website files), verifies checksums and archive paths, and assembles a fresh `.pages/` staging directory. Static website files are maintained in `public/` and copied into the site root, preserving subdirectories and dotfiles. The old `site/` directory has been removed. `mapping-build.json` and `.nojekyll` are reserved publisher files.

Publishing runs after successful dataset builds, on `public/` or publisher changes, on release publication/edit/deletion, manually, or through `repository_dispatch` with type `mapping-release-assets-updated`. A check at minutes 7, 22, 37 and 52 detects direct asset uploads/replacements, which have no native Actions event. GitHub may delay scheduled runs. It compares release/asset metadata and static-file hashes with the published manifest; unchanged inputs skip deployment. The manifest must be updated along with an archive when replacing assets. Missing initial dataset releases leave the existing site intact until both are available; corrupt releases fail publication.

Only after a successful Pages deployment, cleanup retains the deployed release and its two preceding complete versions separately for shipping and contours. It deletes older generated releases, their assets, and matching tags. Releases created while deployment was running are preserved, as are unrelated releases and incomplete drafts. All Pages runs share one concurrency group with cancellation disabled. Failed build or deployment steps never run cleanup.

Shipping runs weekly on Sunday at 09:25 UTC, on shipping changes to `main`, or manually. MailingLocations requests are throttled and cached for six days. Directory freshness and exact box positions remain unverified, and are identified in feature properties/popups.

Unavailable live CVS verification retains the previously verified CVS access points with an explicit verification-status label while refreshing ATP UPS Stores. It never promotes new CVS candidates on failed verification, and rejects absent verified history or successful verification producing zero matches. This keeps independent carrier additions publishable during CVS outages without silently dropping existing CVS points.

Contour extraction still automatically triggers the PMTiles workflow on success. That build pins the exact extraction run/attempt's vector tag. Manual PMTiles builds accept `vector_release_tag`; leaving it blank reuses the newest complete vector release. The PMTiles manifest records the vector release ID and full input manifest. Downloads validate the release archive and each file before decompressing and checking the vector checksum. Push-triggered PMTiles builds with no initial vector releases defer to the successful extraction trigger; manual builds and missing explicit tags fail clearly.

Vector retention runs only after a PMTiles release has successfully been produced: retain the consumed vector version and its two predecessors, preserving any newer concurrent releases. Shipping and PMTiles continue to expire independently after successful Pages deployment. No contour geometry is stored as an expiring Actions artifact.

Before Pages assembly, `scripts/public_directory_indexes` generates an `index.html` at the root of `public/` and in every subdirectory that has no authored index. Listings contain relative, URL-encoded links to that directory's files and child directories plus a parent link; labels are HTML-escaped. Generation includes nested directories and preserves existing index pages, including an authored site-root homepage. Tests cover the generated root listing, recursive links, and preservation of authored root and nested pages without any `site/` fixtures. Generated indexes exist only in the build workspace and their hashes participate in the existing publication-change detection. Generator and regression-test changes trigger only the Pages workflow, without dataset rebuilds.

The MapLibre demo lives at `public/maplibre-demo/index.html` and is published by **Publish mapping pages** at `https://mapping.mbligh.org/maplibre-demo/`. Its shipping module and contour archive use relative URLs, so both the custom domain and the repository Pages path work. Shipping data URLs resolve relative to `shipping.js`. Surveillance remains at the separate `mbligh/surveillance` Pages site; OpenFreeMap, NJ ArcGIS services, and pinned CDN dependencies keep their existing URLs. The former `mbligh/tools/maplibre-demo/index.html` is a redirect preserving query strings and fragments. Demo changes trigger only the mapping Pages publisher.

## Configured GeoJSON overlays

`public/geosources.json` is a top-level array of toggleable point-overlay groups. Each group has a `name` (the existing `layer` key is also supported) and a non-empty `data` array. Each dataset has a `file` URL relative to geosources.json, a MapLibre `type` (`circle` by default, or `symbol`), and optional MapLibre `paint`, `layout`, `filter`, `minzoom`, and `maxzoom`. File extensions are optional; URLs must match actual filenames. Dataset `id` values may be descriptive but internal IDs are generated to prevent collisions with built-in overlays.

`public/maplibre-demo/geosources.js` fetches the config once, creates one initially unchecked checkbox per group using its title, and installs every dataset in a checked group as a separately styled GeoJSON source/layer. GeoJSON is requested only when a group is enabled. Disabling hides all its layers; switching basemaps restores checked overlays. Point popups show feature properties as text. Configuration errors appear beside the controls; malformed groups do not block other groups. Existing shipping, surveillance, parcels, and contours retain their specialized controls and loading logic. The panel scrolls when controls exceed the viewport.

To add an overlay, put its GeoJSON under `public/` and add its group/dataset entry to `public/geosources.json`; no JavaScript or HTML change is required. For example:

```json
[
  {
    "name": "Stores",
    "data": [
      {
        "id": "costco",
        "file": "geojson/costco",
        "type": "circle",
        "paint": {"circle-color": "#ff0000", "circle-radius": 5}
      }
    ]
  }
]
```

Pages runs `node scripts/test_geosources.cjs` to check the committed config, grouped toggles, URL resolution, styles, popups, error handling, and basemap restoration. Config and GeoJSON updates trigger only Pages publication.

## Shared location quality

`mapping_quality/` is a reusable standard-library Python package for address normalization, independent address-point matching, coordinate arbitration, and quality/provenance reporting. Its pure matching engine accepts an injected resolver; the NJ provider batches public statewide address-point queries and caches complete results across feeders and workflow runs. It never chooses a reference based on suspect source coordinates or merges separate source IDs. Strong unique address matches correct displacements over 250 metres; nearby observations stay intact. Ambiguous/missing references keep the current position with an explicit quality label, and stale successful cache entries remain usable during service outages. No manual intervention is required.

The USPS, FedEx, UPS/CVS, and MailingLocations feeders preserve structured address components. `scripts/clean_locations` runs one shared pass across their outputs before shipping validation, commit, and release, targeting directory sources while leaving OSM/USGS observations unchanged. Each GeoJSON embeds per-point provenance and a collection-level quality summary, preserving the existing release member set. The cache is derived, rebuildable data stored in GitHub Actions cache, not a separate database. The hosted adapter batches full-address spelling variants, automatically splits rejected queries, and avoids expensive string functions on the remote table. Changes to the library, CLI, or offline tests trigger shipping rebuilds; push-triggered builds cancel superseded shipping builds, while scheduled/manual runs queue and Pages deployments remain serialized. See `mapping_quality/README.md` for the API, matching policy, failure behavior, and tests.

## Source research

`research/usps/` contains a read-only, reproducible comparison of NJ USPS collection boxes from ATP and Overture Infrastructure/Places. It records release/input provenance, state-boundary selection, conservative carrier classification, exact ID/reference matches, and proximity candidates. Its scratch downloads and extracts do not modify shipping inputs or public assets; research changes do not trigger dataset refreshes. See `research/usps/README.md` and `comparison.json` for the October 23, 2026 findings.

## Overture Places extraction

`scripts/overture` accepts repeated `--name` arguments. Extraction runs one query per name on a shared DuckDB connection and concatenates the resulting features into one GeoJSON FeatureCollection, in argument order. Each query retains the state, exact-name, category, and confidence filters. After combining results, same-name points within 100 feet are deduplicated using spherical distance. Names match after case folding and whitespace normalization. The highest-confidence record wins, with original order breaking ties; its coordinates and attributes are preserved intact. Missing/empty names are not merged. Records are compared to retained points, so transitive chains cannot extend the radius. Surviving records retain query order. `--dedupe-distance-feet` changes the radius; `0` disables this step. Diagnostics remain on stderr. Category discovery does not deduplicate its aggregate counts. Category-only extraction still runs one query; category discovery retains its combined-name query to avoid double-counting. The output retains release/licensing metadata and the existing combined-name default filename.

Example: `scripts/overture --name Costco --name "Home Depot" -o stores.geojson`. Use `-o -` (or `--output -`) to write the GeoJSON to stdout for piping or redirection; progress and diagnostics remain on stderr. Stdout is left open and no file named `-` is created.

Run `python scripts/test_overture` for offline CLI regression checks using a simulated remote DuckDB connection; these do not download Overture data.
