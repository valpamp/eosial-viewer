"""
Update the web-facing SFIDE hotspot databases.

The script scans a SFIDE output directory, reads supported vector files, keeps a
archive beginning at a configurable UTC date plus a 72-hour subset, and writes both aggregates into
the website's data/fire directory. Run it every 30 minutes with --watch, or via
Windows Task Scheduler / cron.

Supported input formats:
  - GeoJSON / JSON without optional dependencies
  - FlatGeobuf, Shapefile, zipped Shapefile, and GeoPackage with geopandas

FlatGeobuf output is preferred for the website. The 72-hour file is written as
a single aggregate, while the one-year archive is split into weekly files by
default with a small manifest so GitHub Pages never has to host a single giant
vector file.
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
UPDATE_STATE = "sfide_update_state.json"
DEFAULT_ARCHIVE_PERIOD = "week"
DEFAULT_ARCHIVE_START_DATE = "2025-06-01"


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


def feature_satellite(feature: dict[str, Any]) -> str:
    value = (feature.get("properties") or {}).get("SATELLITE")
    return str(value).strip() if value not in (None, "") else "UNKNOWN"


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


def infer_datetime_from_path(path: Path) -> datetime | None:
    text = str(path)
    candidates: list[str] = []
    stem = path.stem
    candidates.extend([stem, text])

    import re

    for candidate in candidates:
        for match in re.finditer(r"(20\d{2})[^\d]?([01]\d)[^\d]?([0-3]\d)(?:[^\d]?([0-2]\d)[^\d]?([0-5]\d)(?:[^\d]?([0-5]\d))?)?", candidate):
            year, month, day, hour, minute, second = match.groups()
            try:
                return datetime(
                    int(year),
                    int(month),
                    int(day),
                    int(hour or 0),
                    int(minute or 0),
                    int(second or 0),
                    tzinfo=timezone.utc,
                )
            except ValueError:
                continue
    return None


def source_file_may_contain_new_data(path: Path, start_date: datetime | None) -> bool:
    if start_date is None:
        return True

    inferred = infer_datetime_from_path(path)
    if inferred is not None:
        return inferred >= start_date - timedelta(days=1)

    try:
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        return modified >= start_date
    except OSError:
        return True


def iter_days(start_date: datetime, end_date: datetime):
    day = datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc)
    last_day = datetime(end_date.year, end_date.month, end_date.day, tzinfo=timezone.utc)
    while day <= last_day:
        yield day
        day += timedelta(days=1)


def find_date_directories(source_dir: Path, start_date: datetime, end_date: datetime) -> list[Path]:
    dirs: list[Path] = []
    for day in iter_days(start_date, end_date):
        path = source_dir / f"{day.year:04d}" / f"{day.month:02d}" / f"{day.day:02d}"
        if path.is_dir():
            dirs.append(path)
    return dirs


def find_source_files(
    source_dir: Path,
    output_dir: Path,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> list[Path]:
    output_dir = output_dir.resolve()
    files: list[Path] = []
    search_roots = [source_dir]
    if start_date and end_date:
        date_dirs = find_date_directories(source_dir, start_date, end_date)
        if date_dirs:
            search_roots = date_dirs
            print(
                f"Using dated source folders: {len(date_dirs)} day folder(s) "
                f"from {start_date:%Y-%m-%d} to {end_date:%Y-%m-%d}",
                flush=True,
            )
        else:
            print(
                "No /YYYY/MM/DD folders found for requested incremental range; no source files to scan.",
                flush=True,
            )
            return []

    for root in search_roots:
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            try:
                if output_dir in path.resolve().parents:
                    continue
            except OSError:
                pass
            if not source_file_may_contain_new_data(path, start_date):
                continue
            files.append(path)
    return sorted(set(files))


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


def collect_features(
    source_dir: Path,
    output_dir: Path,
    progress_interval_seconds: float,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    satellite_start_dates: dict[str, datetime] | None = None,
) -> list[dict[str, Any]]:
    gpd = try_import_geopandas()
    print(f"Finding SFIDE vector files in {source_dir}...", flush=True)
    files = find_source_files(source_dir, output_dir, start_date, end_date)
    if start_date:
        print(
            f"Scanning {len(files)} SFIDE vector files in {source_dir} "
            f"from {start_date.strftime('%Y-%m-%d %H:%M UTC')}"
            f"{' to ' + end_date.strftime('%Y-%m-%d %H:%M UTC') if end_date else ''}",
            flush=True,
        )
    else:
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
            dt = parse_feature_date(feature["properties"])
            if start_date and dt and dt < start_date:
                continue
            if end_date and dt and dt > end_date:
                continue
            if satellite_start_dates and dt:
                sat_start = satellite_start_dates.get(feature_satellite(feature))
                if sat_start and dt < sat_start:
                    continue
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


def archive_key(feature: dict[str, Any], archive_period: str) -> str:
    dt = parse_feature_date(feature["properties"])
    if dt is None:
        return "unknown"
    if archive_period == "day":
        return dt.strftime("%Y_%m_%d")
    if archive_period == "week":
        iso = dt.isocalendar()
        return f"{iso.year:04d}_W{iso.week:02d}"
    return dt.strftime("%Y_%m")


def archive_label(key: str) -> str:
    if key == "unknown":
        return "Unknown date"
    if "_W" in key:
        return key.replace("_W", " week ")
    return key.replace("_", "-")


def group_by_archive_period(features: list[dict[str, Any]], archive_period: str) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for feature in features:
        grouped.setdefault(archive_key(feature, archive_period), []).append(feature)
    return dict(sorted(grouped.items()))


def choose_existing_data_path(output_dir: Path, rel_or_base: str) -> Path | None:
    path = output_dir / rel_or_base
    if path.exists():
        return path

    base = output_dir / rel_or_base
    for suffix in (".fgb", ".geojson", ".json", ".gpkg", ".zip", ".shp"):
        candidate = base.with_suffix(suffix)
        if candidate.exists():
            return candidate
    return None


def existing_archive_paths(output_dir: Path) -> list[Path]:
    manifest_path = output_dir / ARCHIVE_MANIFEST
    paths: list[Path] = []
    if manifest_path.exists():
        with manifest_path.open("r", encoding="utf-8") as src:
            manifest = json.load(src)
        for month in manifest.get("months", []):
            files = month.get("files", {})
            for key in ("fgb", "geojson", "json", "gpkg", "zip", "shp"):
                rel = files.get(key)
                if rel:
                    path = output_dir / rel
                    if path.exists():
                        paths.append(path)
                        break

    if paths:
        return paths

    archive_dir = output_dir / "archive"
    if archive_dir.exists():
        paths.extend(sorted(archive_dir.glob("sfide_*.fgb")))
        paths.extend(sorted(archive_dir.glob("sfide_*.geojson")))
        paths.extend(sorted(archive_dir.glob("sfide_*.json")))

    for base in ("sfide_aggregate_1Y", "sfide_aggregate_72h"):
        path = choose_existing_data_path(output_dir, base)
        if path:
            paths.append(path)
    return paths


def load_existing_database(output_dir: Path) -> list[dict[str, Any]]:
    if not output_dir.exists():
        return []

    gpd = try_import_geopandas()
    features_by_id: dict[str, dict[str, Any]] = {}
    paths = existing_archive_paths(output_dir)
    if not paths:
        print("No existing SFIDE web database found; running a full rebuild.", flush=True)
        return []

    print(f"Loading existing SFIDE web database from {len(paths)} file(s)...", flush=True)
    skipped = 0
    for path in paths:
        try:
            features = read_features(path, gpd)
        except Exception as exc:
            skipped += 1
            print(f"Warning: skipped existing database file {path}: {exc}", file=sys.stderr, flush=True)
            continue
        for feature in features:
            features_by_id[feature_id(feature)] = feature

    print(
        f"Loaded {len(features_by_id)} existing unique detections"
        f"{f' ({skipped} existing file(s) skipped)' if skipped else ''}.",
        flush=True,
    )
    return sorted(
        features_by_id.values(),
        key=lambda feature: parse_feature_date(feature["properties"]) or datetime.min.replace(tzinfo=timezone.utc),
    )


def latest_feature_date(features: list[dict[str, Any]]) -> datetime | None:
    dates = [parse_feature_date(feature["properties"]) for feature in features]
    dates = [date for date in dates if date]
    return max(dates) if dates else None


def latest_feature_dates_by_satellite(features: list[dict[str, Any]]) -> dict[str, datetime]:
    latest: dict[str, datetime] = {}
    for feature in features:
        dt = parse_feature_date(feature["properties"])
        if not dt:
            continue
        sat = feature_satellite(feature)
        if sat not in latest or dt > latest[sat]:
            latest[sat] = dt
    return latest


def merge_feature_lists(*feature_lists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    features_by_id: dict[str, dict[str, Any]] = {}
    for features in feature_lists:
        for feature in features:
            features_by_id[feature_id(feature)] = feature
    return sorted(
        features_by_id.values(),
        key=lambda feature: parse_feature_date(feature["properties"]) or datetime.min.replace(tzinfo=timezone.utc),
    )


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


def write_archive_manifest(output_dir: Path, months: list[dict[str, Any]], output_format: str, archive_period: str) -> None:
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "format": output_format,
        "archive_period": archive_period,
        "months": months,
    }
    path = output_dir / ARCHIVE_MANIFEST
    print(f"Writing {path.name} ({len(months)} {archive_period} archive chunks)...", flush=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent, suffix=".json") as tmp:
        json.dump(payload, tmp, indent=2)
        temp_name = tmp.name
    os.replace(temp_name, path)
    print(f"Finished {path.name}", flush=True)


def get_writers(output_format: str, also_geojson: bool) -> list[tuple[str, Any]]:
    writers = []
    if output_format == "fgb":
        writers.append((".fgb", write_flatgeobuf))
    elif output_format == "geojson":
        writers.append((".geojson", write_geojson))
    else:
        raise ValueError(f"Unsupported output format: {output_format}")

    if also_geojson and output_format != "geojson":
        writers.append((".geojson", write_geojson))
    return writers


def read_archive_manifest(output_dir: Path) -> dict[str, Any]:
    path = output_dir / ARCHIVE_MANIFEST
    if not path.exists():
        return {"generated": None, "format": None, "months": []}
    with path.open("r", encoding="utf-8") as src:
        return json.load(src)


def read_update_state(output_dir: Path) -> dict[str, Any]:
    path = output_dir / UPDATE_STATE
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as src:
            return json.load(src)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Warning: could not read {path.name}: {exc}", file=sys.stderr, flush=True)
        return {}


def parse_state_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_state_satellite_dates(state: dict[str, Any]) -> dict[str, datetime]:
    raw = state.get("latest_by_satellite") or {}
    if not isinstance(raw, dict):
        return {}
    parsed: dict[str, datetime] = {}
    for sat, value in raw.items():
        dt = parse_state_datetime(value)
        if dt:
            parsed[str(sat)] = dt
    return parsed


def write_update_state(
    output_dir: Path,
    features: list[dict[str, Any]],
    output_format: str,
    archive_period: str,
    feature_count: int | None = None,
    latest: datetime | None = None,
    latest_by_satellite: dict[str, datetime] | None = None,
) -> None:
    latest = latest or latest_feature_date(features)
    latest_by_satellite = latest_by_satellite or latest_feature_dates_by_satellite(features)
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "latest_hotspot": latest.isoformat() if latest else None,
        "latest_by_satellite": {
            sat: dt.isoformat()
            for sat, dt in sorted(latest_by_satellite.items())
        },
        "feature_count": len(features) if feature_count is None else feature_count,
        "format": output_format,
        "archive_period": archive_period,
        "archive_manifest": ARCHIVE_MANIFEST,
    }
    path = output_dir / UPDATE_STATE
    print(f"Writing {path.name}...", flush=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent, suffix=".json") as tmp:
        json.dump(payload, tmp, indent=2)
        temp_name = tmp.name
    os.replace(temp_name, path)


def choose_month_existing_path(output_dir: Path, month_entry: dict[str, Any]) -> Path | None:
    files = month_entry.get("files", {})
    for key in ("fgb", "geojson", "json", "gpkg", "zip", "shp"):
        rel = files.get(key)
        if rel:
            path = output_dir / rel
            if path.exists():
                return path
    return None


def read_existing_features_from_path(path: Path | None) -> list[dict[str, Any]]:
    if not path or not path.exists():
        return []
    return read_features(path, try_import_geopandas())


def make_month_entry(
    key: str,
    month_features: list[dict[str, Any]],
    files: dict[str, str],
) -> dict[str, Any]:
    dates = [parse_feature_date(f["properties"]) for f in month_features]
    dates = [d for d in dates if d]
    return {
        "key": key,
        "label": archive_label(key),
        "start": min(dates).isoformat() if dates else None,
        "end": max(dates).isoformat() if dates else None,
        "count": len(month_features),
        "files": files,
    }


def write_outputs(
    features: list[dict[str, Any]],
    output_dir: Path,
    output_format: str,
    also_geojson: bool,
    archive_period: str,
    archive_start: datetime,
) -> None:
    now = datetime.now(timezone.utc)
    seventy_two_hours_ago = now - timedelta(hours=72)

    one_year = [f for f in features if (parse_feature_date(f["properties"]) or now) >= archive_start]
    last_72h = [f for f in one_year if (parse_feature_date(f["properties"]) or now) >= seventy_two_hours_ago]

    writers = get_writers(output_format, also_geojson)

    for suffix, writer in writers:
        writer(last_72h, output_dir / f"sfide_aggregate_72h{suffix}")

    archive_dir = output_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    months_payload: list[dict[str, Any]] = []
    keep_paths: set[Path] = set()
    grouped = group_by_archive_period(one_year, archive_period)

    for key, month_features in grouped.items():
        files: dict[str, str] = {}
        for suffix, writer in writers:
            path = archive_dir / f"sfide_{key}{suffix}"
            writer(month_features, path)
            keep_paths.add(path.resolve())
            files[suffix.lstrip(".")] = "archive/" + path.name
        months_payload.append(make_month_entry(key, month_features, files))

    remove_stale_archive_files(archive_dir, keep_paths)
    remove_legacy_one_year_aggregates(output_dir)
    write_archive_manifest(output_dir, months_payload, output_format, archive_period)

    print(
        f"Wrote {len(last_72h)} hotspots from the last 72 hours and "
        f"{len(one_year)} one-year hotspots split across {len(grouped)} {archive_period} archive files.",
        flush=True,
    )
    write_update_state(output_dir, one_year, output_format, archive_period)


def write_incremental_outputs(
    new_features: list[dict[str, Any]],
    output_dir: Path,
    output_format: str,
    also_geojson: bool,
    latest_by_satellite: dict[str, datetime],
    archive_period: str,
    archive_start: datetime,
) -> None:
    now = datetime.now(timezone.utc)
    seventy_two_hours_ago = now - timedelta(hours=72)
    writers = get_writers(output_format, also_geojson)

    manifest = read_archive_manifest(output_dir)
    manifest_period = manifest.get("archive_period") or "month"
    if manifest.get("months") and manifest_period != archive_period:
        print(
            f"Archive period changed from {manifest_period} to {archive_period}; "
            "rechunking existing SFIDE archive once.",
            flush=True,
        )
        existing_features = load_existing_database(output_dir)
        write_outputs(
            merge_feature_lists(existing_features, new_features),
            output_dir,
            output_format,
            also_geojson,
            archive_period,
            archive_start,
        )
        return

    month_entries: dict[str, dict[str, Any]] = {
        month.get("key"): month
        for month in manifest.get("months", [])
        if month.get("key")
    }

    new_one_year = [
        f for f in new_features
        if (parse_feature_date(f["properties"]) or now) >= archive_start
    ]
    new_last_72h = [
        f for f in new_one_year
        if (parse_feature_date(f["properties"]) or now) >= seventy_two_hours_ago
    ]

    existing_72h = read_existing_features_from_path(choose_existing_data_path(output_dir, "sfide_aggregate_72h"))
    last_72h = [
        f for f in merge_feature_lists(existing_72h, new_last_72h)
        if (parse_feature_date(f["properties"]) or now) >= seventy_two_hours_ago
    ]
    for suffix, writer in writers:
        writer(last_72h, output_dir / f"sfide_aggregate_72h{suffix}")

    archive_dir = output_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    updated_months = 0

    for key, incoming in group_by_archive_period(new_one_year, archive_period).items():
        existing_path = choose_month_existing_path(output_dir, month_entries.get(key, {}))
        existing_month = read_existing_features_from_path(existing_path)
        month_features = [
            f for f in merge_feature_lists(existing_month, incoming)
            if (parse_feature_date(f["properties"]) or now) >= archive_start
        ]
        files: dict[str, str] = {}
        for suffix, writer in writers:
            path = archive_dir / f"sfide_{key}{suffix}"
            writer(month_features, path)
            files[suffix.lstrip(".")] = "archive/" + path.name
        month_entries[key] = make_month_entry(key, month_features, files)
        updated_months += 1

    active_months: list[dict[str, Any]] = []
    stale_paths: set[Path] = set()
    for key, entry in sorted(month_entries.items()):
        end = parse_state_datetime(entry.get("end"))
        if end and end < archive_start:
            for rel in (entry.get("files") or {}).values():
                stale_paths.add((output_dir / rel).resolve())
            continue
        active_months.append(entry)

    for path in stale_paths:
        if path.exists():
            path.unlink()
            print(f"Removed stale archive file {path.name}", flush=True)

    remove_legacy_one_year_aggregates(output_dir)
    write_archive_manifest(output_dir, active_months, output_format, archive_period)
    updated_satellites = dict(latest_by_satellite)
    for sat, dt in latest_feature_dates_by_satellite(new_features).items():
        if sat not in updated_satellites or dt > updated_satellites[sat]:
            updated_satellites[sat] = dt
    latest = max(updated_satellites.values()) if updated_satellites else None
    feature_count = sum(int(entry.get("count") or 0) for entry in active_months)
    write_update_state(
        output_dir,
        [],
        output_format,
        archive_period,
        feature_count=feature_count,
        latest=latest,
        latest_by_satellite=updated_satellites,
    )

    print(
        f"Incremental update wrote {len(last_72h)} hotspots in the 72h aggregate "
        f"and refreshed {updated_months} {archive_period} archive chunk(s).",
        flush=True,
    )


def run_once(args: argparse.Namespace) -> None:
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    archive_start = datetime.strptime(args.archive_start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    archive_end = datetime.now(timezone.utc) + timedelta(hours=args.incremental_lookahead_hours)
    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")

    if args.full_rebuild:
        print(f"Full rebuild requested; scanning source data from {archive_start:%Y-%m-%d} to {archive_end:%Y-%m-%d}.", flush=True)
        features = collect_features(source_dir, output_dir, args.progress_interval_seconds, archive_start, archive_end)
        write_outputs(features, output_dir, args.output_format, args.also_geojson, args.archive_period, archive_start)
    else:
        state = read_update_state(output_dir)
        latest_existing = parse_state_datetime(state.get("latest_hotspot"))
        latest_by_satellite = parse_state_satellite_dates(state)
        if latest_existing:
            print(
                f"Loaded incremental state from {UPDATE_STATE}: "
                f"latest hotspot {latest_existing.strftime('%Y-%m-%d %H:%M UTC')} "
                f"across {len(latest_by_satellite)} satellite(s).",
                flush=True,
            )
            if not latest_by_satellite:
                print(f"{UPDATE_STATE} has no per-satellite timestamps; bootstrapping them once.", flush=True)
                existing_features = load_existing_database(output_dir)
                latest_by_satellite = latest_feature_dates_by_satellite(existing_features)
                if latest_by_satellite:
                    write_update_state(output_dir, existing_features, args.output_format, args.archive_period)
        else:
            print(f"No usable {UPDATE_STATE}; bootstrapping state from existing web database.", flush=True)
            existing_features = load_existing_database(output_dir)
            latest_existing = latest_feature_date(existing_features)
            latest_by_satellite = latest_feature_dates_by_satellite(existing_features)
            if latest_existing:
                write_update_state(output_dir, existing_features, args.output_format, args.archive_period)

        if latest_existing is None:
            print("No existing hotspot timestamp found; rebuilding from the configured archive start date.", flush=True)
            features = collect_features(source_dir, output_dir, args.progress_interval_seconds, archive_start, archive_end)
            write_outputs(features, output_dir, args.output_format, args.also_geojson, args.archive_period, archive_start)
        else:
            recent_floor = datetime.now(timezone.utc) - timedelta(hours=args.incremental_window_hours)
            satellite_start_dates = {
                sat: max(dt - timedelta(hours=args.incremental_overlap_hours), recent_floor)
                for sat, dt in latest_by_satellite.items()
            }
            start_date = min(satellite_start_dates.values()) if satellite_start_dates else latest_existing - timedelta(hours=args.incremental_overlap_hours)
            end_date = datetime.now(timezone.utc) + timedelta(hours=args.incremental_lookahead_hours)
            print(
                "Latest known hotspot: "
                f"{latest_existing.strftime('%Y-%m-%d %H:%M UTC')}; "
                f"searching source data from {start_date.strftime('%Y-%m-%d %H:%M UTC')} "
                f"to {end_date.strftime('%Y-%m-%d %H:%M UTC')} "
                f"({len(satellite_start_dates)} satellite-specific lower bound(s), "
                f"{args.incremental_window_hours:g}h recent window).",
                flush=True,
            )
            new_features = collect_features(
                source_dir,
                output_dir,
                args.progress_interval_seconds,
                start_date,
                end_date,
                satellite_start_dates,
            )
            write_incremental_outputs(
                new_features,
                output_dir,
                args.output_format,
                args.also_geojson,
                latest_by_satellite,
                args.archive_period,
                archive_start,
            )

    if args.copy_to:
        copy_to = args.copy_to.resolve()
        copy_to.mkdir(parents=True, exist_ok=True)
        for path in list(output_dir.glob("sfide_aggregate_72h.*")) + [output_dir / ARCHIVE_MANIFEST, output_dir / UPDATE_STATE]:
            if path.exists():
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
    parser.add_argument("--also-geojson", action="store_true", help="Also write GeoJSON copies of 72h and archive files.")
    parser.add_argument(
        "--archive-period",
        choices=("day", "week", "month"),
        default=DEFAULT_ARCHIVE_PERIOD,
        help="Time chunk size for the SFIDE archive. Weekly is the default to keep GitHub Pages files small.",
    )
    parser.add_argument(
        "--archive-start-date",
        default=DEFAULT_ARCHIVE_START_DATE,
        help="Keep archive hotspots from this UTC date onward (YYYY-MM-DD).",
    )
    parser.add_argument("--copy-to", type=Path, help="Optional extra directory to receive the aggregate files.")
    parser.add_argument("--git", action="store_true", help="Commit and push changed aggregate files after each update.")
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_WEB_ROOT, help="Git repository root for --git.")
    parser.add_argument("--git-exe", default="git", help="Path to git executable for --git.")
    parser.add_argument(
        "--full-rebuild",
        action="store_true",
        help=f"Ignore {UPDATE_STATE} and rebuild by scanning the full source tree.",
    )
    parser.add_argument(
        "--incremental-overlap-hours",
        type=float,
        default=6.0,
        help="When updating incrementally, rescan this many hours before the newest existing hotspot.",
    )
    parser.add_argument(
        "--incremental-lookahead-hours",
        type=float,
        default=3.0,
        help="When updating incrementally, scan dated source folders up to this many hours after current UTC time.",
    )
    parser.add_argument(
        "--incremental-window-hours",
        type=float,
        default=96.0,
        help="Maximum recent source window for normal incremental runs; inactive satellites cannot force older scans.",
    )
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
