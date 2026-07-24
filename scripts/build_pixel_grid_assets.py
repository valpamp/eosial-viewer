"""Build compact browser assets from native geostationary grid masks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from osgeo import gdal, osr

gdal.UseExceptions()


MTG_GRIDS = (
    ("MTG_FCI_LAND_MASK_1KM_ITA.tif", "mtg_fci_1km.json", "MTG-FCI", "FCI", 12),
    ("MTG_FCI_LAND_MASK_2KM_ITA.tif", "mtg_fir_2km.json", "MTG-FIR", "FCI", 11),
)

MSG_GRIDS = tuple(
    (
        f"MSG_{service}_LAND_MASK_{resolution}KM_ITA.tif",
        f"msg_{service.lower()}_{resolution}km.json",
        f"MSG-{service}",
        f"MSG_{service}",
        12 if resolution == 1 else 10,
    )
    for service in ("HRIT", "RSS")
    for resolution in (3,)
)


def encode_runs(mask: np.ndarray) -> list[list[list[int]]]:
    rows: list[list[list[int]]] = []
    for row in mask:
        active = np.flatnonzero(row == 1)
        row_runs: list[list[int]] = []
        if active.size:
            starts = active[np.r_[True, np.diff(active) > 1]]
            ends = active[np.r_[np.diff(active) > 1, True]]
            row_runs = [[int(start), int(end)] for start, end in zip(starts, ends)]
        rows.append(row_runs)
    return rows


def export_proj4(dataset: gdal.Dataset) -> str:
    spatial_ref = osr.SpatialReference()
    spatial_ref.ImportFromWkt(dataset.GetProjection())
    projection = spatial_ref.ExportToProj4().strip()
    if "+proj=geos" in projection and "+sweep=" not in projection:
        projection += " +sweep=y"
    return projection


def build_asset(
    source: Path,
    destination: Path,
    product: str,
    pixel_prefix: str,
    min_zoom: int,
) -> None:
    dataset = gdal.Open(str(source), gdal.GA_ReadOnly)
    if dataset is None:
        raise RuntimeError(f"Cannot open {source}")

    mask = dataset.GetRasterBand(1).ReadAsArray()
    transform = dataset.GetGeoTransform()
    metadata = dataset.GetMetadata()
    resolution = int(metadata.get("GRID_RESOLUTION_METRES", round(abs(transform[1]))))

    payload = {
        "schema": 1,
        "product": product,
        "pixel_prefix": pixel_prefix,
        "service": metadata.get("SERVICE", ""),
        "resolution_m": resolution,
        "min_zoom": min_zoom,
        "width": dataset.RasterXSize,
        "height": dataset.RasterYSize,
        "origin_x": transform[0],
        "origin_y": transform[3],
        "pixel_x": transform[1],
        "pixel_y": transform[5],
        "global_column_offset": int(metadata.get("GLOBAL_COLUMN_OFFSET", 0)),
        "global_row_offset": int(metadata.get("GLOBAL_ROW_OFFSET", 0)),
        "source_area": metadata.get("SOURCE_AREA", ""),
        "projection": export_proj4(dataset),
        "runs": encode_runs(mask),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=True),
        encoding="utf-8",
    )
    print(
        f"Wrote {destination} "
        f"({dataset.RasterXSize}x{dataset.RasterYSize}, "
        f"{int(np.count_nonzero(mask == 1))} active cells)"
    )


def build_group(source_dir: Path, output_dir: Path, specs: tuple[tuple, ...]) -> None:
    for source_name, output_name, product, pixel_prefix, min_zoom in specs:
        build_asset(
            source_dir / source_name,
            output_dir / output_name,
            product,
            pixel_prefix,
            min_zoom,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mtg_source_dir", type=Path)
    parser.add_argument("--msg-source-dir", type=Path)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/pixel-grids"),
    )
    args = parser.parse_args()

    build_group(args.mtg_source_dir, args.output_dir, MTG_GRIDS)
    if args.msg_source_dir:
        build_group(args.msg_source_dir, args.output_dir, MSG_GRIDS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())