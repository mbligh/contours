# Mapping

## Requirements

- Maintain New Jersey mapping datasets and their reproducible build pipelines.
- Keep contour extraction, contour tile generation, and shipping refreshes in separate GitHub Actions workflows.
- Keep shipping code, regression checks, browser module, and generated GeoJSON together in `shipping/`.
- Refresh shipping from OSM, USGS National Map, All The Places, CVS verification pages, and MailingLocations. Preserve provenance and conservative deduplication.
- Publish shipping assets at `https://mbligh.github.io/mapping/shipping/` without removing existing contour tiles.
- Commit generated shipping data after successful validation.

## Implementation

Contour scripts remain in `scripts/`. Extraction publishes compressed contour geometry, its checksum, and extraction parameters as a versioned `contour-vectors` Release; the contour workflow turns that geometry into `contours.pmtiles`. Vector releases have no automatic expiry.

Shipping importers write their four GeoJSON files beside the scripts, independent of the caller's working directory. `shipping/shipping.js` owns browser loading, merging, controls, styling, and popups; the map in `mbligh/tools` imports this module.

Dataset builds never deploy Pages. Shipping validates and commits refreshed data, then publishes a versioned release containing `dataset.tar.gz` and `manifest.json`. Contours independently builds PMTiles from the retained vector Release and publishes the same release format. The manifest records the exact source commit, workflow run, file checksums, and archive checksum. Releases remain drafts until all assets are uploaded. Tags follow `dataset-<shipping|contours|contour-vectors>-<run-id>-<attempt>`; these generated tags are reserved for this pipeline.

**Publish mapping pages** is the sole Pages publisher. It selects the newest complete shipping and PMTiles release (vectors are build inputs, not website files), verifies checksums and archive paths, and assembles a fresh `.pages/` staging directory. It copies all `site/` files and then all `public/` files into the site root, preserving subdirectories and dotfiles. `public/` overrides generated or legacy `site/` paths on collision. `mapping-build.json` and `.nojekyll` are reserved publisher files.

Publishing runs after successful dataset builds, on `public/`, `site/`, or publisher changes, on release publication/edit/deletion, manually, or through `repository_dispatch` with type `mapping-release-assets-updated`. A check at minutes 7, 22, 37 and 52 detects direct asset uploads/replacements, which have no native Actions event. GitHub may delay scheduled runs. It compares release/asset metadata and static-file hashes with the published manifest; unchanged inputs skip deployment. The manifest must be updated along with an archive when replacing assets. Missing initial dataset releases leave the existing site intact until both are available; corrupt releases fail publication.

Only after a successful Pages deployment, cleanup retains the deployed release and its two preceding complete versions separately for shipping and contours. It deletes older generated releases, their assets, and matching tags. Releases created while deployment was running are preserved, as are unrelated releases and incomplete drafts. All Pages runs share one concurrency group with cancellation disabled. Failed build or deployment steps never run cleanup.

Shipping runs weekly on Sunday at 09:25 UTC, on shipping changes to `main`, or manually. MailingLocations requests are throttled and cached for six days. Directory freshness and exact box positions remain unverified, and are identified in feature properties/popups.

Contour extraction still automatically triggers the PMTiles workflow on success. That build pins the exact extraction run/attempt's vector tag. Manual PMTiles builds accept `vector_release_tag`; leaving it blank reuses the newest complete vector release. The PMTiles manifest records the vector release ID and full input manifest. Downloads validate the release archive and each file before decompressing and checking the vector checksum. Push-triggered PMTiles builds with no initial vector releases defer to the successful extraction trigger; manual builds and missing explicit tags fail clearly.

Vector retention runs only after a PMTiles release has successfully been produced: retain the consumed vector version and its two predecessors, preserving any newer concurrent releases. Shipping and PMTiles continue to expire independently after successful Pages deployment. No contour geometry is stored as an expiring Actions artifact.

Before Pages assembly, `scripts/public_directory_indexes` generates an `index.html` in every subdirectory of `public/` that has no authored index in `public/` or the corresponding `site/` path. Listings contain relative, URL-encoded links to that directory's files and child directories plus a parent link; labels are HTML-escaped. Generation includes nested directories and never replaces existing index pages or the site-root homepage. Generated indexes exist only in the build workspace and their hashes participate in the existing publication-change detection. Generator and regression-test changes trigger only the Pages workflow, without dataset rebuilds.
