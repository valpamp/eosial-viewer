"""
Update the web-facing NASA FIRMS NRT hotspot database.

The FIRMS post-processor already creates daily FlatGeobuf files. This script
keeps the website copy small by publishing only recent daily files and a
manifest consumed by the hotspot viewer.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_SOURCE_DIR = Path(r"X:\ftp\cufa\FIRMS_NRT\ITA\firms\fgb")
DEFAULT_WEB_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_NAME = "firms_manifest.json"
UPDATE_STATE = "firms_update_state.json"
RECENT_DIR = "firms"


def try_import_geopandas():
    try:
        import geopandas as gpd  # type: ignore

        return gpd
    except ImportError:
        return None


def parse_doy_from_name(path: Path) -> date | None:
    import re

    for match in re.finditer(r"(20\d{2})(\d{3})", path.stem):
        year = int(match.group(1))
        doy = int(match.group(2))
        try:
            return date(year, 1, 1) + timedelta(days=doy - 1)
        except ValueError:
            continue
    return None


def iter_dates(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def date_to_doy(day: date) -> str:
    return f"{day.year}{day.timetuple().tm_yday:03d}"


def find_recent_source_files(source_dir: Path, start: date, end: date) -> list[Path]:
    wanted = {date_to_doy(day) for day in iter_dates(start, end)}
    matches: list[Path] = []
    for path in source_dir.glob("*.fgb"):
        if any(doy in path.stem for doy in wanted):
            matches.append(path)
    return sorted(matches, key=lambda p: (parse_doy_from_name(p) or date.min, p.name))


def read_file_summary(path: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "path": path,
        "count": 0,
        "start": None,
        "end": None,
        "products": {},
        "satellites": {},
        "latest_by_product": {},
    }
    gpd = try_import_geopandas()
    if gpd is None:
        day = parse_doy_from_name(path)
        if day:
            start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
            end = datetime.combine(day, datetime.max.time(), tzinfo=timezone.utc)
            summary["start"] = start
            summary["end"] = end
        return summary

    gdf = gpd.read_file(path)
    summary["count"] = int(len(gdf))
    if gdf.empty:
        return summary

    date_col = "acq_date" if "acq_date" in gdf.columns else None
    time_col = "acq_time" if "acq_time" in gdf.columns else None
    product_col = "product" if "product" in gdf.columns else None
    satellite_col = "satellite" if "satellite" in gdf.columns else None

    datetimes: list[datetime] = []
    latest_by_product: dict[str, datetime] = {}
    for _, row in gdf.iterrows():
        dt = parse_firms_datetime(row.get(date_col), row.get(time_col)) if date_col and time_col else None
        if dt:
            datetimes.append(dt)
            product = str(row.get(product_col) or "unknown") if product_col else "unknown"
            if product not in latest_by_product or dt > latest_by_product[product]:
                latest_by_product[product] = dt

    if datetimes:
        summary["start"] = min(datetimes)
        summary["end"] = max(datetimes)
    summary["latest_by_product"] = latest_by_product
    if product_col:
        summary["products"] = {str(k): int(v) for k, v in gdf[product_col].value_counts(dropna=False).items()}
    if satellite_col:
        summary["satellites"] = {str(k): int(v) for k, v in gdf[satellite_col].value_counts(dropna=False).items()}
    return summary


def parse_firms_datetime(date_value: Any, time_value: Any) -> datetime | None:
    if date_value in (None, "") or time_value in (None, ""):
        return None
    text_date = str(date_value).strip()
    text_time = str(time_value).strip().zfill(4)
    for fmt in ("%Y-%m-%d %H%M", "%Y/%m/%d %H%M"):
        try:
            return datetime.strptime(f"{text_date} {text_time}", fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if ":" in text_time:
        try:
            return datetime.fromisoformat(f"{text_date}T{text_time}").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def write_manifest(output_dir: Path, copied: list[dict[str, Any]], recent_days: int) -> None:
    files = []
    latest_by_product: dict[str, datetime] = {}
    latest: datetime | None = None
    total_count = 0

    for item in copied:
        summary = item["summary"]
        rel = f"{RECENT_DIR}/{item['dest'].name}"
        count = int(summary.get("count") or 0)
        total_count += count
        end = summary.get("end")
        if end and (latest is None or end > latest):
            latest = end
        for product, dt in (summary.get("latest_by_product") or {}).items():
            if product not in latest_by_product or dt > latest_by_product[product]:
                latest_by_product[product] = dt
        files.append(
            {
                "path": rel,
                "format": "fgb",
                "label": item["dest"].stem,
                "date": parse_doy_from_name(item["dest"]).isoformat() if parse_doy_from_name(item["dest"]) else None,
                "start": iso(summary.get("start")),
                "end": iso(summary.get("end")),
                "count": count,
                "products": summary.get("products") or {},
                "satellites": summary.get("satellites") or {},
            }
        )

    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": "NASA FIRMS NRT external dataset",
        "format": "fgb",
        "recent_days": recent_days,
        "latest_hotspot": iso(latest),
        "feature_count": total_count,
        "files": files,
    }
    (output_dir / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    state = {
        "generated": manifest["generated"],
        "latest_hotspot": manifest["latest_hotspot"],
        "latest_by_product": {k: iso(v) for k, v in sorted(latest_by_product.items())},
        "feature_count": total_count,
        "files": [f["path"] for f in files],
    }
    (output_dir / UPDATE_STATE).write_text(json.dumps(state, indent=2), encoding="utf-8")


def clean_stale_outputs(output_dir: Path, keep: set[str]) -> None:
    firms_dir = output_dir / RECENT_DIR
    if not firms_dir.exists():
        return
    for path in firms_dir.glob("*.fgb"):
        if path.name not in keep:
            path.unlink()


def run_once(args: argparse.Namespace) -> None:
    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    firms_dir = output_dir / RECENT_DIR
    if not source_dir.exists():
        raise FileNotFoundError(f"FIRMS source directory does not exist: {source_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    firms_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.now(timezone.utc).date()
    end = today + timedelta(days=args.lookahead_days)
    start = today - timedelta(days=args.recent_days - 1)
    if args.full_rebuild:
        files = sorted(source_dir.glob("*.fgb"))
    else:
        files = find_recent_source_files(source_dir, start, end)

    print(
        f"Publishing {len(files)} FIRMS daily FlatGeobuf file(s) from {source_dir} "
        f"for {start.isoformat()} to {end.isoformat()}.",
        flush=True,
    )

    copied: list[dict[str, Any]] = []
    for path in files:
        dest = firms_dir / path.name
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
        print("No FIRMS file changes to commit.", flush=True)
        return
    git_add_path = str(output_dir.relative_to(repo_root)) if output_dir.is_relative_to(repo_root) else str(output_dir)
    subprocess.run([git_exe, "-C", str(repo_root), "add", "-A", "--", git_add_path], check=True)
    message = "Auto-update FIRMS hotspots " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subprocess.run([git_exe, "-C", str(repo_root), "commit", "-m", message], check=True)
    subprocess.run([git_exe, "-C", str(repo_root), "push"], check=True)
    print("Committed and pushed FIRMS aggregate updates.", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update NASA FIRMS NRT hotspot files for EOSIAL Viewer.")
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR, help="Directory containing daily FIRMS .fgb files.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_WEB_ROOT / "data" / "fire", help="Website data/fire directory.")
    parser.add_argument("--recent-days", type=int, default=4, help="Number of recent UTC days to publish.")
    parser.add_argument("--lookahead-days", type=int, default=1, help="Include this many future UTC days in the filename scan.")
    parser.add_argument("--full-rebuild", action="store_true", help="Publish all FIRMS .fgb files in the source directory.")
    parser.add_argument("--git", action="store_true", help="Commit and push changed FIRMS files.")
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_WEB_ROOT, help="Git repository root for --git.")
    parser.add_argument("--git-exe", default="git", help="Path to git executable for --git.")
    parser.add_argument("--watch", action="store_true", help="Run continuously.")
    parser.add_argument("--interval-minutes", type=float, default=30.0, help="Watch interval in minutes.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    while True:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Updating FIRMS database", flush=True)
        run_once(args)
        if not args.watch:
            return 0
        time.sleep(max(1.0, args.interval_minutes * 60.0))


if __name__ == "__main__":
    raise SystemExit(main())
