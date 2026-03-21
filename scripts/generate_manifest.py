#!/usr/bin/env python3
"""
Generate the LFMC manifest.json for the EOSIAL Viewer.

Scans the data/lfmc/cogs/ directory and builds a JSON index of all
available AOIs, polygons, and dates.

Usage:
    python generate_manifest.py

Configure the paths below, or pass the COG root as an argument.
"""

import json
import os
import re
import sys

# ── Configuration ─────────────────────────────────────────────────────────────

COG_ROOT = r"F:\Valerio\eosial-viewer\data\lfmc\cogs"
MANIFEST_OUT = r"F:\Valerio\eosial-viewer\data\lfmc\manifest.json"

# Human-readable labels for known AOIs (optional, falls back to folder name)
AOI_LABELS = {
    "BA-ESP-AUG25": "Badajoz, Spain — Aug 2025",
    # Add more as needed
}

# ── Main ──────────────────────────────────────────────────────────────────────

_DATE_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})\.tif$', re.IGNORECASE)


def scan_cogs(cog_root):
    """Build the manifest dict by scanning the COG directory tree."""
    manifest = {"aois": {}}

    if not os.path.isdir(cog_root):
        print(f"WARNING: COG directory not found: {cog_root}")
        return manifest

    for aoi_name in sorted(os.listdir(cog_root)):
        aoi_dir = os.path.join(cog_root, aoi_name)
        if not os.path.isdir(aoi_dir):
            continue

        aoi_entry = {
            "label": AOI_LABELS.get(aoi_name, aoi_name),
            "polygons": {},
        }

        for poly_name in sorted(os.listdir(aoi_dir)):
            poly_dir = os.path.join(aoi_dir, poly_name)
            if not os.path.isdir(poly_dir):
                continue

            dates = {}
            for fname in sorted(os.listdir(poly_dir)):
                m = _DATE_RE.match(fname)
                if m:
                    date_str = m.group(1)
                    # Store path relative to data/ so the browser can resolve it
                    rel_path = os.path.relpath(
                        os.path.join(poly_dir, fname),
                        os.path.dirname(os.path.dirname(cog_root))  # -> data/
                    ).replace('\\', '/')
                    dates[date_str] = rel_path

            if dates:
                aoi_entry["polygons"][poly_name] = {"dates": dates}

        if aoi_entry["polygons"]:
            manifest["aois"][aoi_name] = aoi_entry

    return manifest


def main():
    cog_root = sys.argv[1] if len(sys.argv) > 1 else COG_ROOT
    out_path = sys.argv[2] if len(sys.argv) > 2 else MANIFEST_OUT

    print(f"[MANIFEST] Scanning: {cog_root}")
    manifest = scan_cogs(cog_root)

    # Summary
    n_aois = len(manifest["aois"])
    n_polys = sum(len(a["polygons"]) for a in manifest["aois"].values())
    n_dates = sum(
        len(p["dates"])
        for a in manifest["aois"].values()
        for p in a["polygons"].values()
    )
    print(f"[MANIFEST] Found: {n_aois} AOI(s), {n_polys} polygon(s), {n_dates} date(s)")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"[MANIFEST] Written: {out_path}")


if __name__ == '__main__':
    main()
