# New Jersey address lookup database

Download: **https://mapping.mbligh.org/njaddress.db** after the first successful
**Build NJ address database** and **Publish mapping pages** runs.

The independent build downloads NJOGIS's statewide NG911 file geodatabase from
https://geoapps.nj.gov/njgin/address/Addr_NG911.gdb.zip. It runs monthly on the
first day at 08:41 UTC (GitHub may delay scheduled runs), on address-build code
changes, or manually. It imports every address record; it does not deduplicate
subaddresses or filter by address status. Source files and generated databases
are build products and are not committed to Git.

## Schema

`addresses` has exactly these six source columns:

| Column | SQLite type | Meaning |
| --- | --- | --- |
| FULLADDR | TEXT | House number and street address, in source formatting |
| STATE | TEXT | State abbreviation |
| POST_COMM | TEXT | Postal community |
| POST_CODE | TEXT | ZIP code; leading zeros preserved |
| LONG_ | REAL | WGS84 longitude in degrees |
| LAT | REAL | WGS84 latitude in degrees |

SQLite's implicit `rowid` connects each row to `address_rtree`. Address records
without a complete coordinate pair are retained with null coordinates and are
omitted from the spatial index. `metadata` stores JSON-encoded source URL,
Last-Modified header, ZIP checksum/size, source layer, record count, attribution,
build time, and coordinate-system details. It contains no extra per-address data.

The database includes:

* `addresses_fulladdr`: `(FULLADDR COLLATE NOCASE, POST_CODE)`.
* `addresses_locality`: `(POST_COMM COLLATE NOCASE, FULLADDR COLLATE NOCASE)`.
* `address_rtree`: `(id, min_lon, max_lon, min_lat, max_lat)`.

The indexes support case-insensitive full-address, postal-community, and address
prefix lookups. They do not expand abbreviations or resolve spelling variants;
this is an address-point reference, not a fuzzy geocoder. Different source
records can have identical selected fields because unit information is omitted.

## Address queries

```sql
SELECT * FROM addresses
WHERE FULLADDR = '174 Lamington Road' COLLATE NOCASE
  AND POST_CODE = '08858';

SELECT * FROM addresses
WHERE POST_COMM = 'Oldwick' COLLATE NOCASE
  AND FULLADDR = '174 Lamington Road' COLLATE NOCASE;

SELECT * FROM addresses
WHERE FULLADDR LIKE '174 Lamington%';
```

Use parameters rather than string interpolation in applications. `FULLADDR`
does not include the city/state/ZIP; supply those separately where needed.

## Proximity queries

Use the R-tree to find candidates inside a longitude/latitude box:

```sql
SELECT a.*
FROM address_rtree AS r JOIN addresses AS a ON a.rowid = r.id
WHERE r.min_lon <= :east AND r.max_lon >= :west
  AND r.min_lat <= :north AND r.max_lat >= :south
  AND a.LONG_ BETWEEN :west AND :east
  AND a.LAT BETWEEN :south AND :north;
```

The final coordinate conditions remove false positives from R-tree floating
point rounding. For a circular radius or nearest points, calculate a bounding
box first, then compute great-circle distances for the returned candidates and
filter/sort them in the application. No SpatiaLite extension is needed. Ordinary
SQLite must have its standard R-tree module enabled.

## Builds and publication

```sh
sudo apt-get install python3-gdal
/usr/bin/python3 scripts/test_njaddress
/usr/bin/python3 scripts/build_njaddress
# Or reuse a downloaded source:
/usr/bin/python3 scripts/build_njaddress --source /path/to/Addr_NG911.gdb.zip
```

The default output is `build/njaddress/njaddress.db`. A report in
`build/njaddress-report.json` records provenance, source/import/index counts,
database size, and checksum. The statewide workflow requires at least 3,000,000
records and checks the import count against GDAL's source count. It validates
SQLite integrity, required columns and lookup indexes, R-tree integrity and
completeness, and containment of the original double-precision coordinates.
Failures leave any previous output/release intact. Tests exercise the real GDAL
GDB reader using a small synthetic geodatabase in the address workflow; local
tests skip only that integration test when GDAL is unavailable.

Versioned `dataset-njaddress-<run>-<attempt>` releases include `njaddress.db`,
`dataset.tar.gz`, and `manifest.json`. Draft releases become visible only after
all assets upload. The Pages assembler verifies archive/file checksums and the
SQLite database before deployment. The previous site remains available during
builds and failed deployments. Existing shipping/contour publication works before
the first address release exists; once built, addresses are included alongside
them. Following successful deployment, the existing retention policy keeps three
address releases independently of the other datasets.

Attribution: NJ Office of Information Technology, Office of GIS (NJOGIS).
The source is not survey data; address-point accuracy and completeness vary.
