#!/usr/bin/env python3
"""
Pre-compute LFMC statistics for all COGs listed in manifest.json.

For each AOI / polygon / date, loads the COG with rasterio, masks nodata
pixels, and computes mean, median, Q25, Q75 over all valid pixels. Results
are written to data/lfmc/stats.json.

The EOSIAL Viewer loads this file at startup and uses it for timeseries
charts instead of downloading full COGs — critical for large AOIs like
Europe where individual files are 14–16 MB.

Usage:
    python precompute_stats.py
    python precompute_stats.py --force

Re-run whenever new COGs are added or manifest.json changes.
"""

import argparse
import json
import os
import sys

import numpy as np

try:
    import rasterio
except ImportError:
    sys.exit("ERROR: rasterio is required.  pip install rasterio")


# ── Configuration ─────────────────────────────────────────────────────────────

# Root of the web project (contains data/, scripts/, etc.)
WEB_ROOT = r"F:\Valerio\eosial-viewer"

# Legacy uint8 COGs used 255 as nodata, while some background pixels were
# written as 254. New uint16 COGs use their explicit nodata metadata only.
LEGACY_UINT8_NODATA = 255
LEGACY_UINT8_BACKGROUND = 254


# ── Helpers ───────────────────────────────────────────────────────────────────

def compute_stats(tif_path):
    """Return {mean, median, q25, q75, count} for valid pixels, or None on error."""
    try:
        with rasterio.open(tif_path) as src:
            data = src.read(1).astype(np.float32)
            nodata = src.nodata
            dtype = src.dtypes[0]
    except Exception as e:
        print(f"    [ERROR reading] {e}")
        return None

    valid_mask = np.isfinite(data) & (data >= 0)
    if nodata is not None and np.isfinite(nodata):
        valid_mask &= data != nodata
    if dtype == "uint8" and nodata == LEGACY_UINT8_NODATA:
        valid_mask &= data < LEGACY_UINT8_BACKGROUND

    valid = data[valid_mask]
    if len(valid) == 0:
        return None

    return {
        "mean":   float(np.mean(valid)),
        "median": float(np.median(valid)),
        "q25":    float(np.percentile(valid, 25)),
        "q75":    float(np.percentile(valid, 75)),
        "count":  int(len(valid)),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Pre-compute LFMC raster statistics.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Recompute existing stats entries instead of skipping them.",
    )
    args = parser.parse_args()

    manifest_path = os.path.join(WEB_ROOT, "data", "lfmc", "manifest.json")
    stats_path    = os.path.join(WEB_ROOT, "data", "lfmc", "stats.json")
    data_root     = os.path.join(WEB_ROOT, "data")

    if not os.path.exists(manifest_path):
        sys.exit(f"ERROR: manifest not found: {manifest_path}")

    with open(manifest_path) as f:
        manifest = json.load(f)

    # Load existing stats so we can skip already-computed entries
    if os.path.exists(stats_path):
        with open(stats_path) as f:
            stats = json.load(f)
        print(f"[STATS] Loaded existing stats from {stats_path}")
    else:
        stats = {}

    total   = 0
    skipped = 0
    errors  = 0

    for aoi_key, aoi in manifest["aois"].items():
        if aoi_key not in stats:
            stats[aoi_key] = {}

        for poly_key, poly in aoi["polygons"].items():
            if poly_key not in stats[aoi_key]:
                stats[aoi_key][poly_key] = {}

            dates = poly["dates"]
            print(f"\n  {aoi_key}/{poly_key}: {len(dates)} dates")

            for date_str, rel_path in sorted(dates.items()):
                # Skip already-computed dates
                if date_str in stats[aoi_key][poly_key] and not args.force:
                    skipped += 1
                    continue

                tif_path = os.path.join(data_root, rel_path.replace("/", os.sep))
                if not os.path.exists(tif_path):
                    print(f"    {date_str}: MISSING — {rel_path}")
                    errors += 1
                    continue

                s = compute_stats(tif_path)
                if s:
                    stats[aoi_key][poly_key][date_str] = s
                    total += 1
                    print(f"    {date_str}: mean={s['mean']:.1f}  "
                          f"median={s['median']:.1f}  "
                          f"q25={s['q25']:.1f}  q75={s['q75']:.1f}  "
                          f"n={s['count']:,}")
                else:
                    print(f"    {date_str}: no valid pixels")
                    errors += 1

    with open(stats_path, "w") as f:
        json.dump(stats, f, separators=(",", ":"))

    print(f"\n[STATS] Done.  Computed: {total},  Skipped (existing): {skipped},  "
          f"Errors/missing: {errors}")
    print(f"[STATS] Written to: {stats_path}")


if __name__ == "__main__":
    main()
