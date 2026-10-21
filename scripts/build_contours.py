#!/usr/bin/env python3
"""Download float DEM patches from NJ ArcGIS ImageServer and contour them.
Coordinates and elevations are US survey feet (EPSG:6527, NAVD88).
"""
import argparse
import json
import math
import pathlib
import subprocess
import time
import urllib.parse
import urllib.request

SERVICE = "https://maps.nj.gov/arcgis/rest/services/Elevation/NJ_10ft_DEM/ImageServer/exportImage"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--bbox", nargs=4, type=int, required=True, metavar=("WEST","SOUTH","EAST","NORTH"))
    p.add_argument("--tile-feet", type=int, default=12000)
    p.add_argument("--output", default="build/contours.geojsonseq")
    args = p.parse_args()
    west, south, east, north = args.bbox
    if east <= west or north <= south:
        p.error("invalid bbox")
    out = pathlib.Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    tile_dir = out.parent / "dem-patches"
    tile_dir.mkdir(exist_ok=True)
    total = math.ceil((east-west)/args.tile_feet)*math.ceil((north-south)/args.tile_feet)
    index = 0
    with out.open("w") as target:
        for x in range(west, east, args.tile_feet):
            for y in range(south, north, args.tile_feet):
                index += 1
                # One sample overlap prevents contour gaps at patch boundaries.
                x2, y2 = min(x+args.tile_feet, east), min(y+args.tile_feet, north)
                bx = (x-10, y-10, x2+10, y2+10)
                width, height = round((bx[2]-bx[0])/10), round((bx[3]-bx[1])/10)
                params = urllib.parse.urlencode({
                    "bbox": ",".join(map(str,bx)), "bboxSR":6527, "imageSR":6527,
                    "size":f"{width},{height}", "format":"tiff", "pixelType":"F32",
                    "interpolation":"+RSP_Bilinear", "f":"image"
                })
                url = SERVICE + "?" + params
                tif = tile_dir / f"{x}_{y}.tif"
                print(f"[{index}/{total}] {x},{y}", flush=True)
                for attempt in range(4):
                    try:
                        with urllib.request.urlopen(url, timeout=120) as response:
                            data = response.read()
                        if len(data)<1000 or data[:2] not in (b"II",b"MM"):
                            raise ValueError(f"Unexpected image response: {data[:200]!r}")
                        tif.write_bytes(data)
                        break
                    except Exception:
                        if attempt == 3:
                            raise
                        time.sleep(3*(attempt+1))
                geojson = tile_dir / f"{x}_{y}.geojson"
                subprocess.run(["gdal_contour", "-f", "GeoJSON", "-a", "elevation_ft",
                    "-i", "10", str(tif), str(geojson)], check=True)
                features = json.loads(geojson.read_text()).get("features",[])
                for feature in features:
                    # Keep line geometry clipped to the non-overlapping tile interior.
                    # OGR's clipping avoids duplicated lines across neighboring patches.
                    feature["properties"] = {"elevation_ft":round(feature["properties"]["elevation_ft"])}
                    feature["properties"]["major"] = int(feature["properties"]["elevation_ft"] % 100 == 0)
                    target.write(json.dumps(feature,separators=(",",":"))+"\n")
                tif.unlink()
                geojson.unlink()
    print(f"Finished {total} patches: {out}")

if __name__ == "__main__":
    main()
