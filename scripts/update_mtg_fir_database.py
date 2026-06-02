"""
Update the web-facing official EUMETSAT MTG-FIR hotspot database.

The MTG-FIR post-processor writes 10-minute FlatGeobuf granules under
Archive/YYYY/MM/DD. This script scans only a recent date window, aggregates
non-empty granules into daily FlatGeobuf files, and writes a lightweight
manifest consumed by the hotspot viewer.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_SOURCE_DIR = Path(r"X:\ftp\cufa\MTG_FIR\ITA\Archive")
DEFAULT_WEB_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_NAME = "mtg_fir_manifest.json"
UPDATE_STATE = "mtg_fir_update_state.json"
RECENT_DIR = "mtg_fir"
SATELLITE_ID = "MTG-FIR"


def try_import_geopandas():
    try:
        import geopandas as gpd  # type: ignore

        return gpd
    except ImportError:
        return None


def try_import_pandas():
    try:
        import pandas as pd  # type: ignore

        return pd
    except ImportError:
        return None


def iter_dates(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def parse_datetime_from_name(path: Path) -> datetime | None:
    for match in re.finditer(r"(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})", path.stem):
        try:
            return datetime(
                int(match.group(1)),
                int(match.group(2)),
                int(match.group(3)),
                int(match.group(4)),
                int(match.group(5)),
                tzinfo=timezone.utc,
            )
        except ValueError:
            continue
    return None


def parse_date_from_name(path: Path) -> date | None:
    dt = parse_datetime_from_name(path)
    return dt.date() if dt else None


def parse_mtg_time(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    for fmt in ("%Y%m%d%H%M%S", "%Y%m%d%H%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def source_day_dir(source_dir: Path, day: date) -> Path:
    return source_dir / f"{day.year:04d}" / f"{day.month:02d}" / f"{day.day:02d}"


def find_recent_source_files(source_dir: Path, start: date, end: date) -> list[Path]:
    files: list[Path] = []
    for day in iter_dates(start, end):
        day_dir = source_day_dir(source_dir, day)
        if day_dir.exists():
            files.extend(sorted(day_dir.glob("*.fgb")))
    return sorted(files, key=lambda p: (parse_datetime_from_name(p) or datetime.min.replace(tzinfo=timezone.utc), p.name))


def group_by_day(files: list[Path]) -> dict[date, list[Path]]:
    grouped: dict[date, list[Path]] = {}
    for path in files:
        day = parse_date_from_name(path)
        if not day:
            continue
        grouped.setdefault(day, []).append(path)
    return grouped


def summarize_gdf(gdf: Any, fallback_day: date) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "count": int(len(gdf)),
        "start": datetime.combine(fallback_day, datetime.min.time(), tzinfo=timezone.utc),
        "end": datetime.combine(fallback_day, datetime.max.time(), tzinfo=timezone.utc),
        "satellites": {SATELLITE_ID: int(len(gdf))},
        "fire_results": {},
    }
    if gdf.empty:
        return summary

    lower = {str(c).lower(): c for c in gdf.columns}
    start_col = lower.get("start_time")
    result_col = lower.get("fire_result")

    datetimes = []
    if start_col:
        for value in gdf[start_col]:
            dt = parse_mtg_time(value)
            if dt:
                datetimes.append(dt)
    if datetimes:
        summary["start"] = min(datetimes)
        summary["end"] = max(datetimes)
    if result_col:
        summary["fire_results"] = {str(k): int(v) for k, v in gdf[result_col].value_counts(dropna=False).items()}
    return summary


def aggregate_day(day: date, files: list[Path], dest: Path) -> dict[str, Any] | None:
    gpd = try_import_geopandas()
    pd = try_import_pandas()
    if gpd is None or pd is None:
        raise RuntimeError("MTG-FIR aggregation requires geopandas and pandas.")

    frames = []
    for path in files:
        gdf = gpd.read_file(path)
        if gdf.empty:
            continue
        gdf = gdf.copy()
        gdf["source_fgb"] = path.name
        frames.append(gdf)

    if not frames:
        if dest.exists():
            dest.unlink()
        return None

    merged = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=frames[0].crs or "EPSG:4326")
    if merged.crs is None:
        merged = merged.set_crs("EPSG:4326")
    elif str(merged.crs).upper() != "EPSG:4326":
        merged = merged.to_crs("EPSG:4326")

    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(dir=dest.parent, suffix=".fgb")
    os.close(fd)
    Path(temp_name).unlink(missing_ok=True)
    try:
        merged.to_file(temp_name, driver="FlatGeobuf")
        Path(temp_name).replace(dest)
    finally:
        Path(temp_name).unlink(missing_ok=True)

    return summarize_gdf(merged, day)


def write_manifest(output_dir: Path, published: list[dict[str, Any]], recent_days: int) -> None:
    files = []
    latest: datetime | None = None
    total_count = 0

    for item in published:
        summary = item["summary"]
        rel = f"{RECENT_DIR}/{item['dest'].name}"
        count = int(summary.get("count") or 0)
        total_count += count
        end = summary.get("end")
        if end and (latest is None or end > latest):
            latest = end
        files.append(
            {
                "path": rel,
                "format": "fgb",
                "label": item["dest"].stem,
                "date": item["day"].isoformat(),
                "start": iso(summary.get("start")),
                "end": iso(summary.get("end")),
                "count": count,
                "satellites": summary.get("satellites") or {},
                "fire_results": summary.get("fire_results") or {},
            }
        )

    generated = datetime.now(timezone.utc).isoformat()
    manifest = {
        "generated": generated,
        "source": "Official EUMETSAT MTG-FIR external dataset",
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
        "latest_by_satellite": {SATELLITE_ID: manifest["latest_hotspot"]},
        "feature_count": total_count,
        "files": [f["path"] for f in files],
    }
    (output_dir / UPDATE_STATE).write_text(json.dumps(state, indent=2), encoding="utf-8")


def clean_stale_outputs(output_dir: Path, keep: set[str]) -> None:
    mtg_dir = output_dir / RECENT_DIR
    if not mtg_dir.exists():
        return
    for path in mtg_dir.glob("*.fgb"):
        if path.name not in keep:
            path.unlink()


def run_once(args: argparse.Namespace) -> None:
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    mtg_dir = output_dir / RECENT_DIR
    if not source_dir.exists():
        raise FileNotFoundError(f"MTG-FIR source directory does not exist: {source_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    mtg_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.now(timezone.utc).date()
    end = today + timedelta(days=args.lookahead_days)
    start = today - timedelta(days=args.recent_days - 1)
    files = sorted(source_dir.rglob("*.fgb")) if args.full_rebuild else find_recent_source_files(source_dir, start, end)
    grouped = group_by_day(files)

    print(
        f"Publishing MTG-FIR daily FlatGeobuf aggregate(s) from {source_dir} "
        f"for {start.isoformat()} to {end.isoformat()} ({len(files)} source granules).",
        flush=True,
    )

    published: list[dict[str, Any]] = []
    for day in sorted(grouped):
        dest = mtg_dir / f"MTG_FIR_ITA_{day.strftime('%Y%m%d')}.fgb"
        summary = aggregate_day(day, grouped[day], dest)
        if summary is not None:
            published.append({"day": day, "dest": dest, "summary": summary})

    clean_stale_outputs(output_dir, {item["dest"].name for item in published})
    write_manifest(output_dir, published, args.recent_days)
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
        print("No MTG-FIR file changes to commit.", flush=True)
        return
    git_add_path = str(output_dir.relative_to(repo_root)) if output_dir.is_relative_to(repo_root) else str(output_dir)
    subprocess.run([git_exe, "-C", str(repo_root), "add", "-A", "--", git_add_path], check=True)
    message = "Auto-update MTG-FIR hotspots " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subprocess.run([git_exe, "-C", str(repo_root), "commit", "-m", message], check=True)
    subprocess.run([git_exe, "-C", str(repo_root), "push"], check=True)
    print("Committed and pushed MTG-FIR hotspot updates.", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update official EUMETSAT MTG-FIR NRT hotspot files for EOSIAL Viewer.")
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
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Updating MTG-FIR database", flush=True)
        run_once(args)
        if not args.watch:
            return 0
        time.sleep(max(1.0, args.interval_minutes * 60.0))


if __name__ == "__main__":
    raise SystemExit(main())
