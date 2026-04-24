"""
Update the web-facing SFIDE hotspot databases.

The script scans a SFIDE output directory, reads supported vector files, keeps a
rolling one-year archive plus a 72-hour subset, and writes both aggregates into
the website's data/fire directory. Run it every 30 minutes with --watch, or via
Windows Task Scheduler / cron.

Supported input formats:
  - GeoJSON / JSON without optional dependencies
  - FlatGeobuf, Shapefile, zipped Shapefile, and GeoPackage with geopandas

FlatGeobuf output is preferred for the website. The 72-hour file is written as
a single aggregate, while the one-year archive is split into monthly files with
a small manifest so GitHub Pages never has to host a single giant vector file.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SUPPORTED_EXTENSIONS = {".fgb", ".geojson", ".json", ".gpkg", ".shp", ".zip"}
DEFAULT_SOURCE_DIR = Path(r"U:\ftp\sfide\ITA")
DEFAULT_WEB_ROOT = Path(__file__).resolve().parents[1]
PROGRESS_BAR_WIDTH = 28
ARCHIVE_MANIFEST = "sfide_archive_manifest.json"


def try_import_geopandas():
    try:
        import geopandas as gpd  # type: ignore

        return gpd
    except ImportError:
        return None


def parse_feature_date(props: dict[str, Any]) -> datetime | None:
    value = first_value(
        props,
        "DATETIME",
        "datetime",
        "DateTime",
        "TIMESTAMP",
        "timestamp",
        "ACQ_DATETIME",
        "acq_datetime",
    )
    if value is None:
        value = combine_date_time(props)
    if value is None:
        return None

    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None

    text = str(value).strip()
    if not text:
        return None

    formats = (
        "%Y/%m/%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y%m%d%H%M",
        "%Y%m%d%H%M%S",
    )
    normalized = text.rstrip("Z")
    for fmt in formats:
        try:
            return datetime.strptime(normalized, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def combine_date_time(props: dict[str, Any]) -> str | None:
    date = first_value(props, "ACQ_DATE", "acq_date", "DATE", "date")
    time_value = first_value(props, "ACQ_TIME", "acq_time", "TIME", "time")
    if date is None or time_value is None:
        return None
    time_text = str(time_value).strip().zfill(4)
    return f"{date} {time_text[:2]}:{time_text[2:4]}"


def first_value(props: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in props and props[key] not in (None, ""):
            return props[key]
    return None


def feature_id(feature: dict[str, Any]) -> str:
    props = feature.get("properties", {})
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or ["", ""]
    lon = props.get("LONGITUDE", coords[0] if len(coords) > 0 else "")
    lat = props.get("LATITUDE", coords[1] if len(coords) > 1 else "")
    return "|".join(
        str(part)
        for part in (
            props.get("SATELLITE", ""),
            round_float(lat),
            round_float(lon),
            props.get("DATETIME", ""),
            props.get("FRP_WOOSTER", props.get("FRP_MODIS", "")),
            props.get("TYPE", ""),
        )
    )


def round_float(value: Any) -> Any:
    try:
        return round(float(value), 6)
    except (TypeError, ValueError):
        return value


def normalize_feature(feature: dict[str, Any]) -> dict[str, Any] | None:
    if not feature:
        return None
    props = dict(feature.get("properties") or {})
    geometry = feature.get("geometry")
    if not geometry and "geometry" in props:
        geometry = props.pop("geometry")

    if geometry and geometry.get("type") == "Point":
        coords = geometry.get("coordinates") or []
        if len(coords) >= 2:
            props.setdefault("LONGITUDE", coords[0])
            props.setdefault("LATITUDE", coords[1])

    lat = to_float(props.get("LATITUDE"))
    lon = to_float(props.get("LONGITUDE"))
    if lat is None or lon is None:
        return None

    props["LATITUDE"] = lat
    props["LONGITUDE"] = lon
    for key in ("CONFIDENCE", "FRP_WOOSTER", "FRP_MODIS", "BRIGHT_MIR", "BRIGHT_TIR", "TYPE"):
        if key in props:
            numeric = to_float(props[key])
            if numeric is not None:
                props[key] = int(numeric) if key == "TYPE" else numeric

    dt = parse_feature_date(props)
    if dt is None:
        return None
    props["DATETIME"] = dt.strftime("%Y/%m/%d %H:%M")

    return {
        "type": "Feature",
        "geometry": geometry or {"type": "Point", "coordinates": [lon, lat]},
        "properties": props,
    }


def to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def find_source_files(source_dir: Path, output_dir: Path) -> list[Path]:
    output_dir = output_dir.resolve()
    files: list[Path] = []
    for path in source_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        try:
            if output_dir in path.resolve().parents:
                continue
        except OSError:
            pass
        files.append(path)
    return sorted(files)


def read_features(path: Path, gpd: Any) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix in {".geojson", ".json"}:
        with path.open("r", encoding="utf-8") as src:
            data = json.load(src)
        if data.get("type") == "FeatureCollection":
            raw = data.get("features", [])
        elif data.get("type") == "Feature":
            raw = [data]
        else:
            raw = []
        return [f for f in (normalize_feature(feature) for feature in raw) if f]

    if gpd is None:
        raise RuntimeError(
            f"{path.name} requires geopandas. Install geopandas/pyogrio or export SFIDE as GeoJSON."
        )

    frame = gpd.read_file(path)
    if frame.empty:
        return []
    if frame.crs and frame.crs.to_epsg() != 4326:
        frame = frame.to_crs("EPSG:4326")
    return [f for f in (normalize_feature(feature) for feature in frame.iterfeatures()) if f]


def format_duration(seconds: float | None) -> str:
    if seconds is None or seconds < 0:
        return "--:--"
    seconds = int(round(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes, seconds = divmod(rem, 60)
    if hours:
        return f"{hours:d}h {minutes:02d}m {seconds:02d}s"
    return f"{minutes:02d}m {seconds:02d}s"


def print_progress(
    label: str,
    done: int,
    total: int,
    started_at: float,
    detail: str = "",
) -> None:
    if total <= 0:
        print(f"{label}: no files to process", flush=True)
        return

    elapsed = time.monotonic() - started_at
    fraction = min(1.0, max(0.0, done / total))
    filled = int(round(PROGRESS_BAR_WIDTH * fraction))
    bar = "#" * filled + "-" * (PROGRESS_BAR_WIDTH - filled)
    rate = done / elapsed if elapsed > 0 else 0.0
    eta = (total - done) / rate if rate > 0 else None
    message = (
        f"{label}: [{bar}] {done}/{total} ({fraction * 100:5.1f}%) "
        f"elapsed {format_duration(elapsed)} ETA {format_duration(eta)}"
    )
    if detail:
        message += f" | {detail}"
    print(message, flush=True)


def collect_features(source_dir: Path, output_dir: Path, progress_interval_seconds: float) -> list[dict[str, Any]]:
    gpd = try_import_geopandas()
    print(f"Finding SFIDE vector files in {source_dir}...", flush=True)
    files = find_source_files(source_dir, output_dir)
    print(f"Scanning {len(files)} SFIDE vector files in {source_dir}", flush=True)

    features_by_id: dict[str, dict[str, Any]] = {}
    skipped = 0
    raw_features = 0
    started_at = time.monotonic()
    last_progress_at = 0.0
    print_progress("Processing hotspot files", 0, len(files), started_at)

    for index, path in enumerate(files, start=1):
        detail = path.name
        try:
            features = read_features(path, gpd)
        except Exception as exc:
            skipped += 1
            print(f"Warning: skipped {path}: {exc}", file=sys.stderr, flush=True)
            features = []
            detail = f"skipped {path.name}"
        raw_features += len(features)
        before = len(features_by_id)
        for feature in features:
            features_by_id[feature_id(feature)] = feature
        added = len(features_by_id) - before
        detail = f"{detail}; features {len(features)}, new unique {added}, total unique {len(features_by_id)}"

        now = time.monotonic()
        if (
            index == 1
            or index == len(files)
            or now - last_progress_at >= progress_interval_seconds
        ):
            print_progress("Processing hotspot files", index, len(files), started_at, detail)
            last_progress_at = now

    print(
        f"Finished reading {len(files)} files: {raw_features} usable detections, "
        f"{len(features_by_id)} unique, {skipped} skipped.",
        flush=True,
    )

    print("Sorting detections by timestamp...", flush=True)
    sorted_features = sorted(
        features_by_id.values(),
        key=lambda feature: parse_feature_date(feature["properties"]) or datetime.min.replace(tzinfo=timezone.utc),
    )
    print(f"Sorting complete: {len(sorted_features)} unique detections ready.", flush=True)
    return sorted_features


def write_geojson(features: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"type": "FeatureCollection", "features": features}
    print(f"Writing {path.name} ({len(features)} features)...", flush=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent, suffix=".geojson") as tmp:
        json.dump(payload, tmp, separators=(",", ":"))
        temp_name = tmp.name
    os.replace(temp_name, path)
    print(f"Finished {path.name}", flush=True)


def write_flatgeobuf(features: list[dict[str, Any]], path: Path) -> None:
    gpd = try_import_geopandas()
    if gpd is None:
        raise RuntimeError("FlatGeobuf output requires geopandas. Use --output-format geojson as a fallback.")

    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Writing {path.name} ({len(features)} features)...", flush=True)
    if features:
        frame = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    else:
        frame = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")

    fd, temp_name = tempfile.mkstemp(dir=path.parent, suffix=".fgb")
    os.close(fd)
    try:
        frame.to_file(temp_name, driver="FlatGeobuf")
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    print(f"Finished {path.name}", flush=True)


def month_key(feature: dict[str, Any]) -> str:
    dt = parse_feature_date(feature["properties"])
    if dt is None:
        return "unknown"
    return dt.strftime("%Y_%m")


def month_label(key: str) -> str:
    if key == "unknown":
        return "Unknown date"
    return key.replace("_", "-")


def group_by_month(features: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for feature in features:
        grouped.setdefault(month_key(feature), []).append(feature)
    return dict(sorted(grouped.items()))


def remove_stale_archive_files(archive_dir: Path, keep_paths: set[Path]) -> None:
    if not archive_dir.exists():
        return
    for path in archive_dir.glob("sfide_*.fgb"):
        if path.resolve() not in keep_paths:
            path.unlink()
            print(f"Removed stale archive file {path.name}", flush=True)
    for path in archive_dir.glob("sfide_*.geojson"):
        if path.resolve() not in keep_paths:
            path.unlink()
            print(f"Removed stale archive file {path.name}", flush=True)


def remove_legacy_one_year_aggregates(output_dir: Path) -> None:
    for suffix in (".fgb", ".geojson", ".json", ".gpkg", ".zip"):
        path = output_dir / f"sfide_aggregate_1Y{suffix}"
        if path.exists():
            path.unlink()
            print(f"Removed legacy oversized archive aggregate {path.name}", flush=True)


def write_archive_manifest(output_dir: Path, months: list[dict[str, Any]], output_format: str) -> None:
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "format": output_format,
        "months": months,
    }
    path = output_dir / ARCHIVE_MANIFEST
    print(f"Writing {path.name} ({len(months)} monthly chunks)...", flush=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent, suffix=".json") as tmp:
        json.dump(payload, tmp, indent=2)
        temp_name = tmp.name
    os.replace(temp_name, path)
    print(f"Finished {path.name}", flush=True)


def write_outputs(features: list[dict[str, Any]], output_dir: Path, output_format: str, also_geojson: bool) -> None:
    now = datetime.now(timezone.utc)
    one_year_ago = now - timedelta(days=365)
    seventy_two_hours_ago = now - timedelta(hours=72)

    one_year = [f for f in features if (parse_feature_date(f["properties"]) or now) >= one_year_ago]
    last_72h = [f for f in one_year if (parse_feature_date(f["properties"]) or now) >= seventy_two_hours_ago]

    writers = []
    if output_format == "fgb":
        writers.append((".fgb", write_flatgeobuf))
    elif output_format == "geojson":
        writers.append((".geojson", write_geojson))
    else:
        raise ValueError(f"Unsupported output format: {output_format}")

    if also_geojson and output_format != "geojson":
        writers.append((".geojson", write_geojson))

    for suffix, writer in writers:
        writer(last_72h, output_dir / f"sfide_aggregate_72h{suffix}")

    archive_dir = output_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    months_payload: list[dict[str, Any]] = []
    keep_paths: set[Path] = set()
    grouped = group_by_month(one_year)

    for key, month_features in grouped.items():
        files: dict[str, str] = {}
        for suffix, writer in writers:
            path = archive_dir / f"sfide_{key}{suffix}"
            writer(month_features, path)
            keep_paths.add(path.resolve())
            files[suffix.lstrip(".")] = "archive/" + path.name
        dates = [parse_feature_date(f["properties"]) for f in month_features]
        dates = [d for d in dates if d]
        months_payload.append({
            "key": key,
            "label": month_label(key),
            "start": min(dates).isoformat() if dates else None,
            "end": max(dates).isoformat() if dates else None,
            "count": len(month_features),
            "files": files,
        })

    remove_stale_archive_files(archive_dir, keep_paths)
    remove_legacy_one_year_aggregates(output_dir)
    write_archive_manifest(output_dir, months_payload, output_format)

    print(
        f"Wrote {len(last_72h)} hotspots from the last 72 hours and "
        f"{len(one_year)} one-year hotspots split across {len(grouped)} monthly archive files.",
        flush=True,
    )


def run_once(args: argparse.Namespace) -> None:
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")

    features = collect_features(source_dir, output_dir, args.progress_interval_seconds)
    write_outputs(features, output_dir, args.output_format, args.also_geojson)

    if args.copy_to:
        copy_to = args.copy_to.resolve()
        copy_to.mkdir(parents=True, exist_ok=True)
        for path in list(output_dir.glob("sfide_aggregate_72h.*")) + [output_dir / ARCHIVE_MANIFEST]:
            shutil.copy2(path, copy_to / path.name)
        archive_copy = copy_to / "archive"
        archive_copy.mkdir(parents=True, exist_ok=True)
        for path in (output_dir / "archive").glob("sfide_*.*"):
            shutil.copy2(path, archive_copy / path.name)
        print(f"Copied aggregate files to {copy_to}", flush=True)

    if args.git:
        commit_and_push(args.repo_root.resolve(), output_dir, args.git_exe)


def commit_and_push(repo_root: Path, output_dir: Path, git_exe: str) -> None:
    try:
        rel_output = output_dir.relative_to(repo_root)
    except ValueError:
        rel_output = output_dir
    status = subprocess.run(
        [git_exe, "-C", str(repo_root), "status", "--porcelain", "--", str(rel_output)],
        check=True,
        capture_output=True,
        text=True,
    )
    if not status.stdout.strip():
        print("No aggregate file changes to commit.", flush=True)
        return

    try:
        git_add_path = str(output_dir.relative_to(repo_root))
    except ValueError:
        git_add_path = str(output_dir)
    subprocess.run([git_exe, "-C", str(repo_root), "add", "-A", "--", git_add_path], check=True)
    message = "Auto-update SFIDE hotspots " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subprocess.run([git_exe, "-C", str(repo_root), "commit", "-m", message], check=True)
    subprocess.run([git_exe, "-C", str(repo_root), "push"], check=True)
    print("Committed and pushed aggregate updates.", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update SFIDE fire hotspot aggregate files for EOSIAL Viewer.")
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR, help="Directory containing SFIDE outputs.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_WEB_ROOT / "data" / "fire",
        help="Website data/fire directory.",
    )
    parser.add_argument("--output-format", choices=("fgb", "geojson"), default="fgb", help="Primary website format.")
    parser.add_argument("--also-geojson", action="store_true", help="Also write GeoJSON copies of 72h and monthly archive files.")
    parser.add_argument("--copy-to", type=Path, help="Optional extra directory to receive the aggregate files.")
    parser.add_argument("--git", action="store_true", help="Commit and push changed aggregate files after each update.")
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_WEB_ROOT, help="Git repository root for --git.")
    parser.add_argument("--git-exe", default="git", help="Path to git executable for --git.")
    parser.add_argument(
        "--progress-interval-seconds",
        type=float,
        default=5.0,
        help="How often to print file-processing progress.",
    )
    parser.add_argument("--watch", action="store_true", help="Run continuously.")
    parser.add_argument("--interval-minutes", type=float, default=30.0, help="Watch interval in minutes.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    while True:
        started = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{started}] Updating SFIDE database", flush=True)
        run_once(args)
        if not args.watch:
            return 0
        time.sleep(max(1.0, args.interval_minutes * 60.0))


if __name__ == "__main__":
    raise SystemExit(main())
