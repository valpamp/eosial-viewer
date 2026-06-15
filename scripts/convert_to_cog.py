#!/usr/bin/env python3
"""
Convert LFMC inference GeoTIFFs to Cloud Optimized GeoTIFFs (COGs).

Reads the LFMC inference output directory structure, rounds values to
nearest integer, reprojects to EPSG:4326, and writes compressed COGs
into the web data directory.

Usage:
    python convert_to_cog.py
    python convert_to_cog.py --overwrite

Configure the paths below before running.
"""

import argparse
import os
import re
import sys
import shutil
import numpy as np

try:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import calculate_default_transform, reproject
except ImportError:
    sys.exit("ERROR: rasterio is required.  pip install rasterio")


# ── Configuration ─────────────────────────────────────────────────────────────

# Path to the LFMC inference run directory
# LFMC_RUN_DIR = r"F:\Valerio\lfmc\lfmc_inference_output\viirs_Europe"
LFMC_RUN_DIR = r"U:/ftp/fireurisk/lfmc/products/viirs_vnp09h1/europe"

# AOI identifier (used in output path)
AOI_NAME = "Europe"
# AOI_NAME = "Western USA"

# Output root inside the web project's data\lfmc\cogs\ folder
COG_OUTPUT_DIR = r"F:\Valerio\eosial-viewer\data\lfmc\cogs"

# Nodata value used in the source LFMC TIFs
NODATA = -9999

# Output as uint16 so grass LFMC can keep the full 0-400% range.
LFMC_OUTPUT_MAX = 400
NODATA_OUT = 65535

# ── Helpers ───────────────────────────────────────────────────────────────────

_DATE_RE = re.compile(r'(\d{4})-?(\d{2})-?(\d{2})')
_MERGED_RE = re.compile(r'_merged\.tif$', re.IGNORECASE)

def detect_layout(run_dir):
    """Return (is_multi, poly_names) — same logic as inference script."""
    top = [d for d in os.listdir(run_dir)
           if os.path.isdir(os.path.join(run_dir, d))]
    is_multi = any(not (len(d) == 4 and d.isdigit()) for d in top
                   if d not in ('visualize', 'viz'))
    if is_multi:
        polys = sorted(d for d in top if d not in ('visualize', 'viz'))
    else:
        polys = ['']
    return is_multi, polys


def best_tif_per_date(poly_dir):
    """Return {date_str: tif_path} — prefer merged, else single."""
    tifs_by_date = {}      # date -> list of paths
    merged_by_date = {}    # date -> merged path

    for root, dirs, files in os.walk(poly_dir):
        dirs[:] = [d for d in dirs if d not in ('visualize', 'viz')]
        for fname in files:
            if not fname.lower().endswith('.tif'):
                continue
            m = _DATE_RE.search(fname)
            if not m:
                continue
            d = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            fpath = os.path.join(root, fname)
            if _MERGED_RE.search(fname):
                merged_by_date[d] = fpath
            else:
                tifs_by_date.setdefault(d, []).append(fpath)

    result = {}
    all_dates = sorted(set(list(tifs_by_date.keys()) + list(merged_by_date.keys())))
    for d in all_dates:
        if d in merged_by_date:
            result[d] = merged_by_date[d]
        elif d in tifs_by_date:
            result[d] = tifs_by_date[d][0]
    return result


def convert_one(src_path, dst_path):
    """Convert a single LFMC TIF to a COG (EPSG:4326, uint16, DEFLATE)."""
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)

    with rasterio.open(src_path) as src:
        # Calculate transform for EPSG:4326
        dst_crs = 'EPSG:4326'
        transform, width, height = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds)

        profile = src.profile.copy()
        profile.update(
            driver='GTiff',
            crs=dst_crs,
            transform=transform,
            width=width,
            height=height,
            dtype='uint16',
            nodata=NODATA_OUT,
            compress='deflate',
            tiled=True,
            blockxsize=256,
            blockysize=256,
        )

        # Write to a temp file first, then build overviews
        tmp_path = dst_path + '.tmp.tif'
        with rasterio.open(tmp_path, 'w', **profile) as dst:
            for band in range(1, src.count + 1):
                data = np.empty((height, width), dtype=np.float32)
                reproject(
                    source=rasterio.band(src, band),
                    destination=data,
                    src_transform=src.transform,
                    src_crs=src.crs,
                    dst_transform=transform,
                    dst_crs=dst_crs,
                    resampling=Resampling.nearest,
                )
                valid = np.isfinite(data) & (data >= 0)
                src_nodata = src.nodata if src.nodata is not None else NODATA
                if src_nodata is not None and np.isfinite(src_nodata):
                    valid &= data != src_nodata

                out = np.full((height, width), NODATA_OUT, dtype=np.uint16)
                out[valid] = np.clip(
                    np.round(data[valid]), 0, LFMC_OUTPUT_MAX
                ).astype(np.uint16)
                dst.write(out, band)

        # Add overviews for COG performance
        with rasterio.open(tmp_path, 'r+') as dst:
            overview_levels = [
                level for level in (2, 4, 8, 16)
                if dst.width // level >= 2 and dst.height // level >= 2
            ]
            if overview_levels:
                dst.build_overviews(overview_levels, Resampling.nearest)
                dst.update_tags(ns='rio_overview', resampling='nearest')

        # Copy with COG layout (internal tiling + overview interleaving)
        # rasterio's copy with driver='COG' handles this if available
        try:
            with rasterio.open(tmp_path) as src2:
                rasterio.shutil.copy(src2, dst_path, driver='COG',
                                     compress='deflate')
            os.remove(tmp_path)
        except Exception:
            # If COG driver not available, the tiled DEFLATE TIF is fine
            shutil.move(tmp_path, dst_path)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Convert LFMC GeoTIFFs to web COGs.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Rebuild existing COGs instead of skipping them.",
    )
    args = parser.parse_args()

    run_dir = LFMC_RUN_DIR
    if not os.path.isdir(run_dir):
        sys.exit(f"ERROR: directory not found: {run_dir}")

    is_multi, polys = detect_layout(run_dir)
    print(f"[COG] Run dir: {run_dir}")
    print(f"[COG] Layout: {'multi-polygon' if is_multi else 'single'}")
    print(f"[COG] Polygons: {polys}")

    total = 0
    skipped = 0

    for poly in polys:
        poly_dir = os.path.join(run_dir, poly) if poly else run_dir
        date_tifs = best_tif_per_date(poly_dir)

        poly_label = poly or 'single'
        print(f"\n  Polygon '{poly_label}': {len(date_tifs)} dates")

        for date_str, src_path in sorted(date_tifs.items()):
            out_dir = os.path.join(COG_OUTPUT_DIR, AOI_NAME, poly_label)
            out_path = os.path.join(out_dir, date_str + '.tif')

            if os.path.exists(out_path) and not args.overwrite:
                skipped += 1
                continue

            print(f"    {date_str} → {os.path.relpath(out_path, COG_OUTPUT_DIR)}")
            try:
                convert_one(src_path, out_path)
                total += 1
            except Exception as e:
                print(f"    [ERROR] {e}")

    print(f"\n[COG] Done. Converted: {total}, Skipped (existing): {skipped}")


if __name__ == '__main__':
    main()
