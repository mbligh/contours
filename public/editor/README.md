# GeoJSON editor

Open https://mapping.mbligh.org/editor/ to edit a single local GeoJSON file.

- **Open** loads one FeatureCollection. **New** starts an empty layer.
- **Add point** places markers. **Draw trail** creates a LineString: click vertices, then double-click to finish. Escape cancels an unfinished drawing.
- **Select / move** selects features and moves points. Select trails to move vertices, insert vertices by dragging midpoints, or delete vertices using the selection tool's context interaction. The feature list also selects features.
- Edit names/descriptions, or use **All properties** and **Apply properties** for arbitrary JSON attributes. Geometry styling is fixed in this first version.
- **Save** writes the opened file; **Save as** chooses another file. New files prompt for a location. There is no automatic saving.

Direct writes require a browser supporting the File System Access pickers (desktop Chrome/Edge over HTTPS or localhost). Other browsers use a file input and **Download** a replacement copy: they cannot overwrite the opened file automatically. The page does not write files in the GitHub repository or upload local data. To publish an edited overlay, commit the saved file under `public/` separately.

The editor accepts Point and LineString features with 2D longitude/latitude positions. Unsupported geometries, 3D coordinates and malformed files are rejected as a whole, leaving the current layer intact. Feature IDs, arbitrary properties (including null), and collection/feature foreign members are preserved; stale bounding boxes are omitted on save. Editor flags and temporary handles are never written into user properties. GPX/KML import, routing, undo/history and shared editing are outside this version's scope.

## Basemap configuration

Edit `basemaps.json` to set initial `center`, `zoom`, `defaultBasemap`, and available `basemaps`. Each basemap has an `id`, a `name`, and either:

- `style`: a URL to a MapLibre style JSON. It must permit browser CORS requests; use absolute URLs for resources referenced by that style.
- `tiles`: raster XYZ tile URLs, with optional `tileSize` and `attribution`.

The initial configuration includes NJ satellite imagery and OpenFreeMap Bright. Basemap switches preserve the editable layer. Finish or cancel a drawing before switching basemaps or saving.

## Checks

Run `node --test public/editor/test-model.mjs` for data preservation/validation checks. The Pages workflow also installs pinned libraries into a temporary directory and runs `test-browser.cjs` with Playwright. That check uses the actual MapLibre/Terra Draw libraries, locally bundled for testing, with an offline blank basemap and simulated file handles. It verifies drawing, import/export, property preservation, basemap switching, deletion and failure handling without relying on tile servers.
