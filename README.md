# New Jersey contour tiles

Builds 10-foot **vertical-interval** contours from the NJOGIS statewide **10-foot horizontal-resolution** bare-earth DEM and publishes `contours.pmtiles` on GitHub Pages.

The initial workflow defaults to a **60,000 × 60,000 ft pilot** around Tewksbury (EPSG:6527 bounds `390000 650000 450000 710000`). It is **not yet all northern New Jersey**. This bounds parameter can be expanded after validating the initial run.

## Setup

1. In repository Settings → Pages, choose **GitHub Actions** as the deployment source.
2. Run **Extract NJ contour vectors** to download DEM data and generate 10-foot contour geometry. This uploads a compressed `contour-vectors` artifact retained for 90 days.
3. After successful extraction, **Build NJ contour PMTiles** runs automatically, downloads the artifact, and publishes the PMTiles file. You can also manually dispatch this workflow with the extraction run ID to rebuild tiles without extracting vectors again.
4. Once deployed, the archive is at https://mbligh.github.io/mapping/contours.pmtiles.

Changing tile zoom/simplification settings requires only rerunning the PMTiles workflow with a retained extraction run ID. Changing the geographic extent or contour geometry requires rerunning extraction.

## Output

Vector source layer: `contours`. Properties: `elevation_ft` (10-foot increments) and `major` (100-foot index contours).

Suggested MapLibre intervals by zoom: 100 ft (10–11), 50 ft (12–13), 20 ft (14–15), 10 ft (16+). All are multiples of the 10-foot base interval.

## Source

[NJOGIS statewide 10-ft DEM ImageServer](https://maps.nj.gov/arcgis/rest/services/Elevation/NJ_10ft_DEM/ImageServer). The service uses EPSG:6527 horizontal coordinates in US survey feet and elevations in feet. Source data are LiDAR-derived.

**Attribution:** This map/publication/report was developed using New Jersey Department of Environmental Protection Geographic Information System digital data, but this secondary product has not been verified by NJDEP and is not state-authorized or endorsed.

## Limitations

This is an initial, unverified build pipeline. Adjacent processing patches overlap by one DEM pixel and contour lines are clipped to their assigned patch interiors. The build uses a regional rectangle rather than an administrative county boundary. PMTiles HTTP byte-range serving must be tested on the deployed URL; Cloudflare R2 may be needed if GitHub Pages does not support it reliably.

## Shipping datasets

Shipping scripts, data, regression checks, and the browser module are in [shipping/](shipping/README.md). A separate **Refresh NJ shipping locations** workflow refreshes all sources and publishes them at https://mbligh.github.io/mapping/shipping/.

