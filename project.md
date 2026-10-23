# Mapping

## Requirements

- Maintain New Jersey mapping datasets and their reproducible build pipelines.
- Keep contour extraction, contour tile generation, and shipping refreshes in separate GitHub Actions workflows.
- Keep shipping code, regression checks, browser module, and generated GeoJSON together in `shipping/`.
- Refresh shipping from OSM, USGS National Map, All The Places, CVS verification pages, and MailingLocations. Preserve provenance and conservative deduplication.
- Publish shipping assets at `https://mbligh.github.io/mapping/shipping/` without removing existing contour tiles.
- Commit generated shipping data after successful validation.

## Implementation

Contour scripts remain in `scripts/`. Extraction creates an intermediate artifact; the contour workflow turns it into `contours.pmtiles`.

Shipping importers write their four GeoJSON files beside the scripts, independent of the caller's working directory. `shipping/shipping.js` owns browser loading, merging, controls, styling, and popups; the map in `mbligh/tools` imports this module.

`.github/workflows/shipping.yml` runs shipping regression checks, refreshes all shipping sources, validates the results, commits data to the current branch, and deploys Pages. It retains the existing published contour archive. The contour publisher includes the tracked shipping assets when deploying. Both use the same Pages concurrency group to prevent one deployment from overwriting another.

Shipping runs weekly on Sunday at 09:25 UTC, on shipping changes to `main`, or manually. MailingLocations requests are throttled and cached for six days. Directory freshness and exact box positions remain unverified, and are identified in feature properties/popups.

