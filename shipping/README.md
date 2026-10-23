# NJ shipping locations

This directory owns all shipping generation code, tests, browser logic, and four generated GeoJSON datasets.

| File | Sources |
| --- | --- |
| shipping.geojson | New Jersey OSM shipping points and USGS post offices |
| shipping_extra.geojson | ATP UPS Stores and CVS UPS Access Points verified against CVS city pages |
| shipping_fedex.geojson | FedEx locator records collected by ATP |
| shipping_ups_boxes.geojson | Explicit UPS drop-box listings and numeric map coordinates from MailingLocations |

Install `osmium` and `beautifulsoup4`, then run from the repository root:

```sh
python shipping/test_fedex
python shipping/test_shipping_geometry
python shipping/test_mailinglocations
node shipping/test_shipping.cjs
python shipping/validate_data
```

The separate **Refresh NJ shipping locations** workflow downloads the OSM extract to `/tmp/new-jersey.osm.pbf`, runs all four importers, validates and commits the data, then publishes it with `shipping.js` at https://mbligh.github.io/mapping/shipping/.

Each importer writes beside its own script, so it also works from another working directory. The MailingLocations importer supports `--city-url`, `--cache-dir`, and `--output` for targeted checks. Its directory records retain source links, retrieval timestamps, and unverified freshness/position labels.

## Browser integration

```js
import {initShipping} from 'https://mbligh.github.io/mapping/shipping/shipping.js';
initShipping(map, maplibregl);
```

The page supplies checkboxes with IDs `shipping`, `fedex-boxes`, `ups-boxes`, and a status element `shipping-status`. The module resolves data relative to its own URL, restores layers after style changes, and merges conservative same-location matches while retaining source details. Drop boxes remain distinct from staffed counters. Tests can override `dataBaseUrl`.

Contour and shipping refreshes are independent; their Pages publishers preserve both datasets and serialize deployments.

