# New Jersey contour tiles

Builds 10-foot **vertical-interval** contours from the NJOGIS statewide **10-foot horizontal-resolution** bare-earth DEM and publishes `contours.pmtiles` on GitHub Pages.

The initial workflow defaults to a **60,000 × 60,000 ft pilot** around Tewksbury (EPSG:6527 bounds `390000 650000 450000 710000`). It is **not yet all northern New Jersey**. This bounds parameter can be expanded after validating the initial run.

## Setup

1. In repository Settings → Pages, choose **GitHub Actions** as the deployment source.
2. Run **Extract NJ contour vectors** to download DEM data and generate 10-foot contour geometry. This publishes a versioned `contour-vectors` Release containing compressed geometry, checksums, and extraction parameters, with no automatic expiry.
3. After successful extraction, **Build NJ contour PMTiles** runs automatically, downloads that exact vector release, and stores the PMTiles file in a versioned GitHub Release. **Publish mapping pages** then deploys it with shipping and static files. You can also manually dispatch this workflow with an optional `vector_release_tag` to rebuild tiles without extracting vectors again; blank uses the latest complete vector release.
4. Once deployed, the archive is at https://mbligh.github.io/mapping/contours.pmtiles.

Changing tile zoom/simplification settings requires only rerunning the PMTiles workflow using a retained vector release. Changing the geographic extent or contour geometry requires rerunning extraction.

## Output

Vector source layer: `contours`. Properties: `elevation_ft` (10-foot increments) and `major` (100-foot index contours).

Suggested MapLibre intervals by zoom: 100 ft (10–11), 50 ft (12–13), 20 ft (14–15), 10 ft (16+). All are multiples of the 10-foot base interval.

## Source

[NJOGIS statewide 10-ft DEM ImageServer](https://maps.nj.gov/arcgis/rest/services/Elevation/NJ_10ft_DEM/ImageServer). The service uses EPSG:6527 horizontal coordinates in US survey feet and elevations in feet. Source data are LiDAR-derived.

**Attribution:** This map/publication/report was developed using New Jersey Department of Environmental Protection Geographic Information System digital data, but this secondary product has not been verified by NJDEP and is not state-authorized or endorsed.

## Limitations

This is an initial, unverified build pipeline. Adjacent processing patches overlap by one DEM pixel and contour lines are clipped to their assigned patch interiors. The build uses a regional rectangle rather than an administrative county boundary. PMTiles HTTP byte-range serving must be tested on the deployed URL; Cloudflare R2 may be needed if GitHub Pages does not support it reliably.

## Shipping datasets

Shipping scripts, data, regression checks, and the browser module are in [shipping/](shipping/README.md). A separate **Refresh NJ shipping locations** workflow refreshes all sources and produces a versioned Release. **Publish mapping pages** serves the combined site, including shipping at https://mbligh.github.io/mapping/shipping/.

## Pages publishing and retention

**Publish mapping pages** is the only workflow that deploys the site. Contour and shipping builds remain independent and store their completed outputs as non-expiring Release assets (`dataset.tar.gz` and `manifest.json`). The publisher downloads the latest complete release of each, checks their SHA-256 checksums, and assembles the site.

To add a page or file, commit it under `public/`: `public/example.html` becomes `https://mbligh.github.io/mapping/example.html`. All nested files and dotfiles are included. Static website content is maintained in `public/`. Dataset paths are `contours.pmtiles` and `shipping/`. The publisher reserves `.nojekyll` and `mapping-build.json`.

Successful dataset builds trigger publishing automatically. Release events and changes to static files also trigger it. Direct asset uploads/replacements are detected by a check every 15 minutes (subject to GitHub scheduling delays); unchanged inputs do not redeploy. Integrations can send `repository_dispatch` type `mapping-release-assets-updated` for an immediate check. Archives and their checksum manifests must stay consistent.

After successful deployment, the publisher keeps three complete versions per dataset and deletes older generated releases, assets, and tags. It preserves newer releases created during deployment and does not touch unrelated releases or draft uploads. Failed deployments never expire versions. See [project.md](project.md) for implementation details. Contour vectors also use versioned Release assets. After successfully producing PMTiles, the build keeps three vector versions independently of shipping and PMTiles retention. Each PMTiles release records the vector release it consumed.

The root of `public/` and every subdirectory get automatically generated directory listings, recursively. For example, `/geojson/` lists the files and child folders under `public/geojson/`. Existing `index.html` pages in `public/`, including an authored homepage, are preserved. Listings are generated during publishing, so no index files need to be committed manually.

## Interactive map

Open [the MapLibre demo](https://mapping.mbligh.org/maplibre-demo/). Its source is [public/maplibre-demo/index.html](public/maplibre-demo/index.html); changes publish through **Publish mapping pages**, independently of dataset builds. Shipping and contours load from this site's relative paths. Surveillance loads from the separate surveillance site. The former URL under `mbligh.github.io/tools/maplibre-demo/` has a redirect in the tools repository.
