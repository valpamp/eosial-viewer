"""Prepare static Terrarium XYZ terrain tiles from Copernicus GLO-90.

Source downloads are cached outside published data. Requires the project conda
geospatial stack plus Pillow. Does not update fire data or publish anything.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import math
from pathlib import Path
import time
from urllib.request import urlopen
import numpy as np
from osgeo import gdal
from PIL import Image

gdal.UseExceptions()
ROOT = Path(__file__).resolve().parents[1]
SPAN = 40075016.68557849
HALF = SPAN / 2

def tile_range(bounds, zoom):
    west, south, east, north = bounds
    n = 2 ** zoom
    def x(lon): return (lon + 180) / 360 * n
    def y(lat): return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return range(math.floor(x(west)), math.ceil(x(east))), range(math.floor(y(north)), math.ceil(y(south)))

def tile_bounds(x, y, zoom):
    width = SPAN / 2 ** zoom
    return (-HALF + x * width, HALF - (y + 1) * width, -HALF + (x + 1) * width, HALF - y * width)

def encode_terrarium(heights):
    # One-metre encoding precision avoids implying sub-metre source accuracy.
    values = np.clip(np.rint(heights), -32768, 32767).astype(np.int32) + 32768
    return np.stack((values // 256, values % 256, np.zeros_like(values)), axis=-1).astype(np.uint8)

def download(base, name, cache):
    dest = cache / (name + '.tif')
    if dest.exists():
        ds = gdal.Open(str(dest))
        if ds.RasterXSize > 0:
            return dest
    temp = dest.with_suffix('.download')
    for attempt in range(3):
        try:
            with urlopen(base + '/' + name + '/' + name + '.tif', timeout=90) as response, temp.open('wb') as output:
                while block := response.read(1024 * 1024): output.write(block)
            dataset = gdal.Open(str(temp))
            dataset.GetRasterBand(1).Checksum()
            dataset = None
            temp.replace(dest)
            return dest
        except Exception:
            if attempt == 2: raise
            time.sleep(attempt + 1)
    raise RuntimeError(name)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-zoom', type=int, default=10)
    parser.add_argument('--cache-dir', type=Path, default=ROOT / 'tmp' / 'terrain-glo90')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data' / 'terrain' / 'glo90')
    args = parser.parse_args()
    if not 0 <= args.max_zoom <= 11: parser.error('max-zoom must be between 0 and 11')
    metadata = json.loads((ROOT / 'data' / 'terrain' / 'glo90.json').read_text(encoding='utf-8'))
    cache = args.cache_dir.resolve()
    output = args.output_dir.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    names = metadata['tiles']
    paths = []
    print(f"Preparing {len(names)} GLO-90 source tiles; cache: {cache}", flush=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = [pool.submit(download, metadata['sourceUrl'], name, cache) for name in names]
        for index, job in enumerate(as_completed(jobs), 1):
            paths.append(str(job.result()))
            if index % 20 == 0 or index == len(names): print(f'Sources ready: {index}/{len(names)}', flush=True)
    vrt_path = cache / 'italy.vrt'
    vrt = gdal.BuildVRT(str(vrt_path), sorted(paths), resolution='highest')
    if vrt is None: raise RuntimeError('Could not build source mosaic')
    xr, yr = tile_range(metadata['bounds'], args.max_zoom)
    left, bottom, _, _ = tile_bounds(xr.start, yr.stop - 1, args.max_zoom)
    _, _, right, top = tile_bounds(xr.stop - 1, yr.start, args.max_zoom)
    pixel = SPAN / (2 ** args.max_zoom * 256)
    warped_path = cache / f'italy-z{args.max_zoom}.tif'
    print('Reprojecting GLO-90 to the web terrain grid...', flush=True)
    warped = gdal.Warp(str(warped_path), vrt, format='GTiff', dstSRS='EPSG:3857',
        outputBounds=(left, bottom, right, top), xRes=pixel, yRes=pixel,
        resampleAlg='bilinear', dstNodata=-9999, multithread=True,
        creationOptions=['TILED=YES', 'COMPRESS=DEFLATE', 'PREDICTOR=3', 'BIGTIFF=IF_SAFER'], warpMemoryLimit=128)
    if warped is None: raise RuntimeError('Could not reproject terrain')
    warped.FlushCache()
    # Read bounded windows; GDAL fills the remainder of coastal/ocean tiles.
    print('Encoding terrain pyramid...', flush=True)
    count = 0
    for zoom in range(args.max_zoom + 1):
        xs, ys = tile_range(metadata['bounds'], zoom)
        for x in xs:
            directory = output / str(zoom) / str(x)
            directory.mkdir(parents=True, exist_ok=True)
            for y in ys:
                tile = gdal.Warp('', warped, format='MEM', dstSRS='EPSG:3857', outputBounds=tile_bounds(x, y, zoom),
                    width=256, height=256, resampleAlg='average', dstNodata=-9999)
                heights = tile.ReadAsArray()
                heights = np.where(np.isfinite(heights) & (heights != -9999), heights, 0)
                dest = directory / f'{y}.png'
                temp = dest.with_suffix('.png.tmp')
                Image.fromarray(encode_terrarium(heights)).save(temp, format='PNG', optimize=False)
                temp.replace(dest)
                count += 1
        print(f'Zoom {zoom} complete; {count} tiles', flush=True)
    manifest = {
        'tilejson': '3.0.0', 'name': metadata['name'], 'tiles': ['{z}/{x}/{y}.png'],
        'bounds': metadata['bounds'], 'minzoom': 0, 'maxzoom': args.max_zoom,
        'encoding': 'terrarium', 'tileSize': 256, 'sourceResolutionMeters': 90,
        'encodedHeightPrecisionMeters': 1, 'verticalDatum': metadata['verticalDatum'],
        'attribution': metadata['attribution'], 'licenseUrl': metadata['licenseUrl'],
        'tileCount': count,
    }
    temp = output / 'tiles.json.tmp'
    temp.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    temp.replace(output / 'tiles.json')
    total = sum(p.stat().st_size for p in output.rglob('*.png'))
    print(f'Prepared {count} tiles, {total / 1024**2:.1f} MiB in {output}', flush=True)

if __name__ == '__main__': main()
