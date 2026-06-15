"""
Update the web-facing LFMC raster database.

This is the operational entry point for scheduled LFMC updates. It scans an
external LFMC product directory, converts new or changed GeoTIFFs to web COGs,
refreshes data/lfmc/manifest.json, updates statistics only for changed COGs,
and can optionally commit/push data/lfmc changes.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import convert_to_cog
import generate_manifest
import precompute_stats


DEFAULT_SOURCE_DIR = Path(r"U:\ftp\fireurisk\lfmc\products\viirs_vnp09h1\europe")
DEFAULT_WEB_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_AOI_NAME = "Europe"
UPDATE_STATE = "lfmc_update_state.json"


def file_signature(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "source_path": str(path),
        "source_mtime": stat.st_mtime,
        "source_size": stat.st_size,
    }


def same_signature(previous: dict[str, Any] | None, current: dict[str, Any]) -> bool:
    if not previous:
        return False
    return all(previous.get(key) == value for key, value in current.items())


def state_key(aoi_name: str, poly_name: str, date_str: str) -> str:
    return f"{aoi_name}/{poly_name}/{date_str}"


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


def write_json(path: Path, data: Any, *, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent, separators=None if indent else (",", ":"))
    os.replace(tmp_path, path)


def discover_sources(source_dir: Path) -> list[tuple[str, str, Path]]:
    is_multi, polys = convert_to_cog.detect_layout(str(source_dir))
    discovered: list[tuple[str, str, Path]] = []
    for poly in polys:
        poly_dir = source_dir / poly if poly else source_dir
        if not poly_dir.exists():
            continue
        poly_label = poly or "single"
        for date_str, src_path in sorted(convert_to_cog.best_tif_per_date(str(poly_dir)).items()):
            discovered.append((poly_label, date_str, Path(src_path)))
    return discovered


def rel_from_data(path: Path, data_root: Path) -> str:
    return str(path.relative_to(data_root)).replace("\\", "/")


def update_stats_for_changed(
    stats_path: Path,
    data_root: Path,
    aoi_name: str,
    changed: list[tuple[str, str, Path]],
) -> int:
    stats = load_json(stats_path, {})
    stats.setdefault(aoi_name, {})
    computed = 0

    for poly_name, date_str, cog_path in changed:
        stats[aoi_name].setdefault(poly_name, {})
        s = precompute_stats.compute_stats(str(cog_path))
        if not s:
            print(f"    {aoi_name}/{poly_name}/{date_str}: no valid LFMC pixels", flush=True)
            continue
        stats[aoi_name][poly_name][date_str] = s
        computed += 1
        rel = rel_from_data(cog_path, data_root)
        print(
            f"    stats {rel}: mean={s['mean']:.1f} median={s['median']:.1f} "
            f"q25={s['q25']:.1f} q75={s['q75']:.1f} n={s['count']:,}",
            flush=True,
        )

    write_json(stats_path, stats)
    return computed


def commit_and_push(repo_root: Path, lfmc_dir: Path, git_exe: str) -> None:
    try:
        rel_output = lfmc_dir.relative_to(repo_root)
    except ValueError:
        rel_output = lfmc_dir

    status = subprocess.run(
        [git_exe, "-C", str(repo_root), "status", "--porcelain", "--", str(rel_output)],
        check=True,
        capture_output=True,
        text=True,
    )
    if not status.stdout.strip():
        print("No LFMC database changes to commit.", flush=True)
        return

    subprocess.run([git_exe, "-C", str(repo_root), "add", "-A", "--", str(rel_output)], check=True)
    message = "Auto-update LFMC database " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subprocess.run([git_exe, "-C", str(repo_root), "commit", "-m", message], check=True)
    subprocess.run([git_exe, "-C", str(repo_root), "push"], check=True)
    print("Committed and pushed LFMC database updates.", flush=True)


def run_once(args: argparse.Namespace) -> None:
    source_dir = args.source_dir.resolve()
    web_root = args.web_root.resolve()
    data_root = web_root / "data"
    lfmc_dir = data_root / "lfmc"
    cog_root = args.cog_root.resolve() if args.cog_root else lfmc_dir / "cogs"
    manifest_path = args.manifest.resolve() if args.manifest else lfmc_dir / "manifest.json"
    stats_path = args.stats.resolve() if args.stats else lfmc_dir / "stats.json"
    state_path = args.state.resolve() if args.state else lfmc_dir / UPDATE_STATE

    if not source_dir.exists():
        raise FileNotFoundError(f"LFMC source path not found: {source_dir}")

    state = load_json(state_path, {"version": 1, "products": {}})
    products = state.setdefault("products", {})
    discovered = discover_sources(source_dir)
    print(f"[LFMC] Source: {source_dir}", flush=True)
    print(f"[LFMC] AOI: {args.aoi_name}", flush=True)
    print(f"[LFMC] Found {len(discovered)} dated product(s)", flush=True)

    changed: list[tuple[str, str, Path]] = []
    converted = 0
    skipped = 0
    stats_missing = not stats_path.exists()

    for poly_name, date_str, src_path in discovered:
        out_path = cog_root / args.aoi_name / poly_name / f"{date_str}.tif"
        sig = file_signature(src_path)
        key = state_key(args.aoi_name, poly_name, date_str)
        previous = products.get(key)
        if args.full_rebuild or not out_path.exists():
            needs_update = True
        elif same_signature(previous, sig):
            needs_update = False
        else:
            needs_update = src_path.stat().st_mtime > out_path.stat().st_mtime

        if not needs_update:
            if not same_signature(previous, sig):
                products[key] = sig
                products[key]["output_path"] = str(out_path)
            if stats_missing:
                changed.append((poly_name, date_str, out_path))
            skipped += 1
            continue

        print(
            f"    converting {src_path.name} -> {rel_from_data(out_path, data_root)}",
            flush=True,
        )
        convert_to_cog.convert_one(str(src_path), str(out_path))
        products[key] = sig
        products[key]["output_path"] = str(out_path)
        changed.append((poly_name, date_str, out_path))
        converted += 1

    state["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    state["source_dir"] = str(source_dir)
    write_json(state_path, state, indent=2)

    if converted or args.refresh_manifest:
        manifest = generate_manifest.scan_cogs(str(cog_root))
        write_json(manifest_path, manifest, indent=2)
        print(f"[LFMC] Manifest refreshed: {manifest_path}", flush=True)

    if changed:
        computed = update_stats_for_changed(stats_path, data_root, args.aoi_name, changed)
        print(f"[LFMC] Stats updated for {computed} COG(s)", flush=True)

    if args.full_rebuild and args.recompute_all_stats:
        print("[LFMC] Recomputing all LFMC stats...", flush=True)
        stats_args = argparse.Namespace(force=True)
        old_web_root = precompute_stats.WEB_ROOT
        try:
            precompute_stats.WEB_ROOT = str(web_root)
            precompute_stats.main_with_args(stats_args)
        finally:
            precompute_stats.WEB_ROOT = old_web_root

    print(f"[LFMC] Done. Converted: {converted}, skipped unchanged: {skipped}", flush=True)

    if args.git:
        commit_and_push(args.repo_root.resolve(), lfmc_dir, args.git_exe)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Incrementally update the LFMC web database.")
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--aoi-name", default=DEFAULT_AOI_NAME)
    parser.add_argument("--web-root", type=Path, default=DEFAULT_WEB_ROOT)
    parser.add_argument("--cog-root", type=Path, default=None)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--stats", type=Path, default=None)
    parser.add_argument("--state", type=Path, default=None)
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_WEB_ROOT)
    parser.add_argument("--git-exe", default="git")
    parser.add_argument("--git", action="store_true")
    parser.add_argument("--full-rebuild", action="store_true")
    parser.add_argument("--refresh-manifest", action="store_true")
    parser.add_argument(
        "--recompute-all-stats",
        action="store_true",
        help="With --full-rebuild, recompute stats for every manifest entry.",
    )
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--interval-minutes", type=float, default=30.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    while True:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Updating LFMC database", flush=True)
        run_once(args)
        if not args.watch:
            return 0
        time.sleep(max(1.0, args.interval_minutes * 60.0))


if __name__ == "__main__":
    raise SystemExit(main())
