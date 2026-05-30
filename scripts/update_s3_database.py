"""
Update the web-facing Sentinel-3 NRT hotspot database.

The Sentinel-3 post-processor is expected to write daily or recent FlatGeobuf
hotspot files. This script publishes only a recent window plus a lightweight
manifest consumed by the hotspot viewer.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_SOURCE_DIR = Path(r"X:\ftp\cufa\S3_NRT\S3_FRP_CROPS")
DEFAULT_WEB_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_NAME = "s3_manifest.json"
UPDATE_STATE = "s3_update_state.json"
RECENT_DIR = "s3"


def try_import_geopandas():
    try:
        import geopandas as gpd  # type: ignore

        return gpd
    except ImportError:
        return None


def parse_date_from_name(path: Path) -> date | None:
    stem = path.stem
    for match in re.finditer(r"(20\d{2})[-_]?(\d{2})[-_]?(\d{2})", stem):
        try:
            return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            pass
    for match in re.finditer(r"(20\d{2})(\d{3})(?!\d)", stem):
        try:
            return date(int(match.group(1)), 1, 1) + timedelta(days=int(match.group(2)) - 1)
        except ValueError:
            pass
    return None


def iter_dates(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def date_tokens(day: date) -> set[str]:
    return {
        f"{day.year}{day.timetuple().tm_yday:03d}",
        day.strftime("%Y%m%d"),
        day.strftime("%Y-%m-%d"),
        day.strftime("%Y_%m_%d"),
    }


def find_recent_source_files(source_dir: Path, start: date, end: date) -> list[Path]:
    wanted: set[str] = set()
    for day in iter_dates(start, end):
        wanted.update(date_tokens(day))
    matches = []
    for path in source_dir.rglob("*.fgb"):
        parsed = parse_date_from_name(path)
        if parsed and start <= parsed <= end:
            matches.append(path)
        elif any(token in path.stem for token in wanted):
            matches.append(path)
        elif parsed is None:
            modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).date()
            if start <= modified <= end:
                matches.append(path)
    return sorted(set(matches), key=lambda p: (parse_date_from_name(p) or date.min, p.name))


def parse_s3_datetime(row: Any) -> datetime | None:
    def first(*names: str):
        for name in names:
            if name in row and row.get(name) not in (None, ""):
                return row.get(name)
        lower = {str(k).lower(): k for k in row.keys()}
        for name in names:
            key = lower.get(name.lower())
            if key is not None and row.get(key) not in (None, ""):
                return row.get(key)
        return None

    iso_value = first("DATETIME", "datetime", "timestamp", "ACQ_DATETIME", "acq_datetime")
    if iso_value:
        text = str(iso_value).strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(text).astimezone(timezone.utc)
        except ValueError:
            pass

    date_value = first("OBS_DATE", "obs_date", "DATE", "date", "acq_date", "ACQ_DATE")
    time_value = first("OBS_TIME", "obs_time", "TIME", "time", "acq_time", "ACQ_TIME") or "0000"
    if date_value in (None, ""):
        return None
    text_date = str(date_value).strip()
    text_time = str(time_value).strip().zfill(4)
    formats = (
        "%Y-%m-%d %H%M",
        "%Y/%m/%d %H%M",
        "%Y%m%d %H%M",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
    )
    for fmt in formats:
        try:
            return datetime.strptime(f"{text_date} {text_time}", fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def infer_satellite(path: Path, summary: dict[str, Any]) -> str | None:
    text = path.name.upper()
    if "S3B" in text or "SENTINEL-3B" in text:
        return "S3B"
    if "S3A" in text or "SENTINEL-3A" in text:
        return "S3A"
    satellites = summary.get("satellites") or {}
    if satellites:
        return sorted(satellites, key=satellites.get, reverse=True)[0]
    return None


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def read_file_summary(path: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "path": path,
        "count": 0,
        "start": None,
        "end": None,
        "satellites": {},
        "products": {},
        "latest_by_satellite": {},
    }
    day = parse_date_from_name(path)
    if day:
        summary["start"] = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        summary["end"] = datetime.combine(day, datetime.max.time(), tzinfo=timezone.utc)

    gpd = try_import_geopandas()
    if gpd is None:
        return summary

    gdf = gpd.read_file(path)
    summary["count"] = int(len(gdf))
    if gdf.empty:
        return summary

    lower = {str(c).lower(): c for c in gdf.columns}
    satellite_col = lower.get("satellite") or lower.get("platform") or lower.get("mission")
    product_col = lower.get("product")

    datetimes: list[datetime] = []
    latest_by_satellite: dict[str, datetime] = {}
    for _, row in gdf.iterrows():
        dt = parse_s3_datetime(row)
        if not dt:
            continue
        datetimes.append(dt)
        sat = str(row.get(satellite_col) or infer_satellite(path, summary) or "S3") if satellite_col else (infer_satellite(path, summary) or "S3")
        if sat not in latest_by_satellite or dt > latest_by_satellite[sat]:
            latest_by_satellite[sat] = dt

    if datetimes:
        summary["start"] = min(datetimes)
        summary["end"] = max(datetimes)
    if satellite_col:
        summary["satellites"] = {str(k): int(v) for k, v in gdf[satellite_col].value_counts(dropna=False).items()}
    else:
        sat = infer_satellite(path, summary)
        if sat:
            summary["satellites"] = {sat: int(len(gdf))}
    if product_col:
        summary["products"] = {str(k): int(v) for k, v in gdf[product_col].value_counts(dropna=False).items()}
    summary["latest_by_satellite"] = latest_by_satellite
    return summary


def write_manifest(output_dir: Path, copied: list[dict[str, Any]], recent_days: int) -> None:
    files = []
    latest: datetime | None = None
    latest_by_satellite: dict[str, datetime] = {}
    total_count = 0

    for item in copied:
        summary = item["summary"]
        rel = f"{RECENT_DIR}/{item['dest'].name}"
        count = int(summary.get("count") or 0)
        total_count += count
        end = summary.get("end")
        if end and (latest is None or end > latest):
            latest = end
        for sat, dt in (summary.get("latest_by_satellite") or {}).items():
            if sat not in latest_by_satellite or dt > latest_by_satellite[sat]:
                latest_by_satellite[sat] = dt
        files.append(
            {
                "path": rel,
                "format": "fgb",
                "label": item["dest"].stem,
                "date": parse_date_from_name(item["dest"]).isoformat() if parse_date_from_name(item["dest"]) else None,
                "start": iso(summary.get("start")),
                "end": iso(summary.get("end")),
                "count": count,
                "satellites": summary.get("satellites") or {},
                "products": summary.get("products") or {},
            }
        )

    generated = datetime.now(timezone.utc).isoformat()
    manifest = {
        "generated": generated,
        "source": "Sentinel-3 SLSTR NRT external dataset",
        "format": "fgb",
        "recent_days": recent_days,
        "latest_hotspot": iso(latest),
        "feature_count": total_count,
        "files": files,
    }
    (output_dir / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    state = {
        "generated": generated,
        "latest_hotspot": manifest["latest_hotspot"],
        "latest_by_satellite": {k: iso(v) for k, v in sorted(latest_by_satellite.items())},
        "feature_count": total_count,
        "files": [f["path"] for f in files],
    }
    (output_dir / UPDATE_STATE).write_text(json.dumps(state, indent=2), encoding="utf-8")


def clean_stale_outputs(output_dir: Path, keep: set[str]) -> None:
    s3_dir = output_dir / RECENT_DIR
    if not s3_dir.exists():
        return
    for path in s3_dir.glob("*.fgb"):
        if path.name not in keep:
            path.unlink()


def run_once(args: argparse.Namespace) -> None:
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    s3_dir = output_dir / RECENT_DIR
    if not source_dir.exists():
        raise FileNotFoundError(f"Sentinel-3 source directory does not exist: {source_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    s3_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.now(timezone.utc).date()
    end = today + timedelta(days=args.lookahead_days)
    start = today - timedelta(days=args.recent_days - 1)
    files = sorted(source_dir.rglob("*.fgb")) if args.full_rebuild else find_recent_source_files(source_dir, start, end)

    print(
        f"Publishing {len(files)} Sentinel-3 FlatGeobuf file(s) from {source_dir} "
        f"for {start.isoformat()} to {end.isoformat()}.",
        flush=True,
    )

    copied: list[dict[str, Any]] = []
    for path in files:
        dest = s3_dir / path.name
        if not dest.exists() or path.stat().st_mtime > dest.stat().st_mtime or path.stat().st_size != dest.stat().st_size:
            shutil.copy2(path, dest)
        summary = read_file_summary(dest)
        copied.append({"source": path, "dest": dest, "summary": summary})

    clean_stale_outputs(output_dir, {item["dest"].name for item in copied})
    write_manifest(output_dir, copied, args.recent_days)
    print(f"Wrote {MANIFEST_NAME} and {UPDATE_STATE}.", flush=True)

    if args.git:
        commit_and_push(args.repo_root.resolve(), output_dir, args.git_exe)


def commit_and_push(repo_root: Path, output_dir: Path, git_exe: str) -> None:
    rel_output = output_dir.relative_to(repo_root) if output_dir.is_relative_to(repo_root) else output_dir
    status = subprocess.run(
        [git_exe, "-C", str(repo_root), "status", "--porcelain", "--", str(rel_output)],
        check=True,
        capture_output=True,
        text=True,
    )
    if not status.stdout.strip():
        print("No Sentinel-3 file changes to commit.", flush=True)
        return
    git_add_path = str(output_dir.relative_to(repo_root)) if output_dir.is_relative_to(repo_root) else str(output_dir)
    subprocess.run([git_exe, "-C", str(repo_root), "add", "-A", "--", git_add_path], check=True)
    message = "Auto-update Sentinel-3 hotspots " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subprocess.run([git_exe, "-C", str(repo_root), "commit", "-m", message], check=True)
    subprocess.run([git_exe, "-C", str(repo_root), "push"], check=True)
    print("Committed and pushed Sentinel-3 hotspot updates.", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update Sentinel-3 NRT hotspot files for EOSIAL Viewer.")
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_WEB_ROOT / "data" / "fire")
    parser.add_argument("--recent-days", type=int, default=4)
    parser.add_argument("--lookahead-days", type=int, default=1)
    parser.add_argument("--full-rebuild", action="store_true")
    parser.add_argument("--git", action="store_true")
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_WEB_ROOT)
    parser.add_argument("--git-exe", default="git")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--interval-minutes", type=float, default=30.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    while True:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Updating Sentinel-3 database", flush=True)
        run_once(args)
        if not args.watch:
            return 0
        time.sleep(max(1.0, args.interval_minutes * 60.0))


if __name__ == "__main__":
    raise SystemExit(main())
