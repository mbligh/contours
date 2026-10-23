# NJ shipping locations

This directory owns all shipping generation code, tests, browser logic, and four generated GeoJSON datasets.

| File | Sources |
| --- | --- |
| shipping.geojson | New Jersey OSM shipping points, USGS post offices, and ATP USPS collection boxes |
| shipping_extra.geojson | ATP UPS Stores and CVS UPS Access Points verified against CVS city pages |
| shipping_fedex.geojson | FedEx locator records collected by ATP |
| shipping_ups_boxes.geojson | Explicit UPS drop-box listings and numeric map coordinates from MailingLocations |

Install `osmium` and `beautifulsoup4`, then run from the repository root:

```sh
python shipping/test_fedex
python shipping/test_shipping_geometry
python shipping/test_mailinglocations
python shipping/test_usps
python shipping/test_shipping_extra
node shipping/test_shipping.cjs
python shipping/validate_data
```

The separate **Refresh NJ shipping locations** workflow downloads the OSM extract to `/tmp/new-jersey.osm.pbf`, runs the importers, validates and commits the data, then publishes a versioned shipping Release. The separate **Publish mapping pages** workflow assembles the shipping and contour releases with `public/` and deploys the site. Data and `shipping.js` are published at https://mapping.mbligh.org/shipping/.

Run `python shipping/build_usps` after `build_shipping.py` to append USPS collection boxes to the shared `shipping.geojson`. It reads ATP's dedicated `usps_collection_boxes` output, selects NJ, preserves collection times, indoor/lobby indicators, notes, and box IDs, and refuses incomplete or invalid results. An optional positional input file reuses a downloaded ATP snapshot. Refreshing replaces existing USPS boxes by their source references, preserving all other features; boxes remain distinct from post offices at the same address. Collection times are pickup schedules, not opening hours.

Each importer writes beside its own script, so it also works from another working directory. The MailingLocations importer supports `--city-url`, `--cache-dir`, and `--output` for targeted checks. Its directory records retain source links, retrieval timestamps, and unverified freshness/position labels.

If live CVS verification is unavailable, the extras importer refreshes UPS Stores and retains only the CVS access points already verified in the tracked dataset, marking their verification status as unavailable for this refresh. It adds no new CVS candidates in this case and fails if no verified CVS history exists. A successful live check with zero matches still fails validation.

## Browser integration

```js
import {initShipping} from 'https://mbligh.github.io/mapping/shipping/shipping.js';
initShipping(map, maplibregl);
```

The page supplies checkboxes with IDs `shipping`, `fedex-boxes`, `ups-boxes`, `usps-boxes`, and a status element `shipping-status`. USPS collection boxes use a separate blue point layer and checkbox backed by the shared shipping source. The module resolves data relative to its own URL, restores layers after style changes, and merges conservative same-location matches while retaining source details. Drop boxes remain distinct from staffed counters. Tests can override `dataBaseUrl`.

Contour and shipping refreshes are independent; the single Pages publisher assembles both datasets and serializes deployments.
