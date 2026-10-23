# Mapping

## Requirements

- Maintain New Jersey mapping datasets and their reproducible build pipelines.
- Keep contour extraction, contour tile generation, and shipping refreshes in separate GitHub Actions workflows.
- Keep shipping code, regression checks, browser module, and generated GeoJSON together in `shipping/`.
- Refresh shipping from OSM, USGS National Map, All The Places, CVS verification pages, and MailingLocations. Include ATP's dedicated NJ USPS collection-box output directly in `shipping.geojson`, preserving collection times, indoor/lobby indicators, notes, and source box IDs. Preserve provenance and conservative deduplication.
- Publish shipping assets at `https://mbligh.github.io/mapping/shipping/` without removing existing contour tiles.
- Commit generated shipping data after successful validation.

## Implementation

Contour scripts remain in `scripts/`. Extraction publishes compressed contour geometry, its checksum, and extraction parameters as a versioned `contour-vectors` Release; the contour workflow turns that geometry into `contours.pmtiles`. Vector releases have no automatic expiry.

Shipping importers write their four GeoJSON files beside the scripts, independent of the caller's working directory. `shipping/shipping.js` owns browser loading, merging, controls, styling, and popups; the map in `public/maplibre-demo/` imports this module via `../shipping/shipping.js`.

After the OSM/USGS base build, `shipping/build_usps` appends USPS collection boxes from ATP. It filters NJ, checks geometry and unique source references, and refuses incomplete inputs before atomically replacing the shared file. The MapLibre demo has an independent **USPS collection boxes** checkbox with smaller blue points; the existing shipping checkbox continues to show staffed locations and post offices. Popups distinguish collection times from opening hours and show indoor/lobby indicators and notes. USPS boxes use the existing shared shipping source and remain separate from colocated post offices and other carriers. No Overture source is used.

Dataset builds never deploy Pages. Shipping validates and commits refreshed data, then publishes a versioned release containing `dataset.tar.gz` and `manifest.json`. Contours independently builds PMTiles from the retained vector Release and publishes the same release format. The manifest records the exact source commit, workflow run, file checksums, and archive checksum. Releases remain drafts until all assets are uploaded. Tags follow `dataset-<shipping|contours|contour-vectors>-<run-id>-<attempt>`; these generated tags are reserved for this pipeline.

**Publish mapping pages** is the sole Pages publisher. It selects the newest complete shipping and PMTiles release (vectors are build inputs, not website files), verifies checksums and archive paths, and assembles a fresh `.pages/` staging directory. Static website files are maintained in `public/` and copied into the site root, preserving subdirectories and dotfiles. The old `site/` directory has been removed. `mapping-build.json` and `.nojekyll` are reserved publisher files.

Publishing runs after successful dataset builds, on `public/` or publisher changes, on release publication/edit/deletion, manually, or through `repository_dispatch` with type `mapping-release-assets-updated`. A check at minutes 7, 22, 37 and 52 detects direct asset uploads/replacements, which have no native Actions event. GitHub may delay scheduled runs. It compares release/asset metadata and static-file hashes with the published manifest; unchanged inputs skip deployment. The manifest must be updated along with an archive when replacing assets. Missing initial dataset releases leave the existing site intact until both are available; corrupt releases fail publication.

Only after a successful Pages deployment, cleanup retains the deployed release and its two preceding complete versions separately for shipping and contours. It deletes older generated releases, their assets, and matching tags. Releases created while deployment was running are preserved, as are unrelated releases and incomplete drafts. All Pages runs share one concurrency group with cancellation disabled. Failed build or deployment steps never run cleanup.

Shipping runs weekly on Sunday at 09:25 UTC, on shipping changes to `main`, or manually. MailingLocations requests are throttled and cached for six days. Directory freshness and exact box positions remain unverified, and are identified in feature properties/popups.

Contour extraction still automatically triggers the PMTiles workflow on success. That build pins the exact extraction run/attempt's vector tag. Manual PMTiles builds accept `vector_release_tag`; leaving it blank reuses the newest complete vector release. The PMTiles manifest records the vector release ID and full input manifest. Downloads validate the release archive and each file before decompressing and checking the vector checksum. Push-triggered PMTiles builds with no initial vector releases defer to the successful extraction trigger; manual builds and missing explicit tags fail clearly.

Vector retention runs only after a PMTiles release has successfully been produced: retain the consumed vector version and its two predecessors, preserving any newer concurrent releases. Shipping and PMTiles continue to expire independently after successful Pages deployment. No contour geometry is stored as an expiring Actions artifact.

Before Pages assembly, `scripts/public_directory_indexes` generates an `index.html` at the root of `public/` and in every subdirectory that has no authored index. Listings contain relative, URL-encoded links to that directory's files and child directories plus a parent link; labels are HTML-escaped. Generation includes nested directories and preserves existing index pages, including an authored site-root homepage. Tests cover the generated root listing, recursive links, and preservation of authored root and nested pages without any `site/` fixtures. Generated indexes exist only in the build workspace and their hashes participate in the existing publication-change detection. Generator and regression-test changes trigger only the Pages workflow, without dataset rebuilds.

The MapLibre demo lives at `public/maplibre-demo/index.html` and is published by **Publish mapping pages** at `https://mapping.mbligh.org/maplibre-demo/`. Its shipping module and contour archive use relative URLs, so both the custom domain and the repository Pages path work. Shipping data URLs resolve relative to `shipping.js`. Surveillance remains at the separate `mbligh/surveillance` Pages site; OpenFreeMap, NJ ArcGIS services, and pinned CDN dependencies keep their existing URLs. The former `mbligh/tools/maplibre-demo/index.html` is a redirect preserving query strings and fragments. Demo changes trigger only the mapping Pages publisher.

## Source research

`research/usps/` contains a read-only, reproducible comparison of NJ USPS collection boxes from ATP and Overture Infrastructure/Places. It records release/input provenance, state-boundary selection, conservative carrier classification, exact ID/reference matches, and proximity candidates. Its scratch downloads and extracts do not modify shipping inputs or public assets; research changes do not trigger dataset refreshes. See `research/usps/README.md` and `comparison.json` for the October 23, 2026 findings.
