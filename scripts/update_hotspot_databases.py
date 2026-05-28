"""
Update all web-facing hotspot databases for EOSIAL Viewer.

This is the operational entry point for scheduled updates. It updates the
native SFIDE database and the external NASA FIRMS NRT database in one run, then
optionally commits/pushes the combined data/fire changes.
"""

from __future__ import annotations

import argparse
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import update_firms_database
import update_sfide_database


DEFAULT_WEB_ROOT = Path(__file__).resolve().parents[1]


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
        print("No hotspot database changes to commit.", flush=True)
        return

    try:
        git_add_path = str(output_dir.relative_to(repo_root))
    except ValueError:
        git_add_path = str(output_dir)
    subprocess.run([git_exe, "-C", str(repo_root), "add", "-A", "--", git_add_path], check=True)
    message = "Auto-update hotspot databases " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subprocess.run([git_exe, "-C", str(repo_root), "commit", "-m", message], check=True)
    subprocess.run([git_exe, "-C", str(repo_root), "push"], check=True)
    print("Committed and pushed hotspot database updates.", flush=True)


def run_once(args: argparse.Namespace) -> None:
    output_dir = args.output_dir.resolve()

    sfide_args = argparse.Namespace(
        source_dir=args.sfide_source_dir,
        output_dir=output_dir,
        output_format=args.output_format,
        also_geojson=args.also_geojson,
        copy_to=None,
        git=False,
        repo_root=args.repo_root,
        git_exe=args.git_exe,
        full_rebuild=args.full_rebuild_sfide,
        incremental_overlap_hours=args.incremental_overlap_hours,
        incremental_lookahead_hours=args.incremental_lookahead_hours,
        incremental_window_hours=args.incremental_window_hours,
        progress_interval_seconds=args.progress_interval_seconds,
    )

    print("Updating SFIDE hotspots...", flush=True)
    update_sfide_database.run_once(sfide_args)

    firms_source = args.firms_source_dir.resolve()
    if firms_source.exists():
        firms_args = argparse.Namespace(
            source_dir=firms_source,
            output_dir=output_dir,
            recent_days=args.firms_recent_days,
            lookahead_days=args.firms_lookahead_days,
            full_rebuild=args.full_rebuild_firms,
            git=False,
            repo_root=args.repo_root,
            git_exe=args.git_exe,
            watch=False,
            interval_minutes=args.interval_minutes,
        )
        print("Updating NASA FIRMS NRT hotspots...", flush=True)
        update_firms_database.run_once(firms_args)
    else:
        print(f"WARNING: FIRMS source path not found; skipping FIRMS update: {firms_source}", flush=True)

    if args.git:
        commit_and_push(args.repo_root.resolve(), output_dir, args.git_exe)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update SFIDE and NASA FIRMS hotspot databases for EOSIAL Viewer.")
    parser.add_argument("--sfide-source-dir", type=Path, default=update_sfide_database.DEFAULT_SOURCE_DIR)
    parser.add_argument("--firms-source-dir", type=Path, default=update_firms_database.DEFAULT_SOURCE_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_WEB_ROOT / "data" / "fire")
    parser.add_argument("--output-format", choices=("fgb", "geojson"), default="fgb")
    parser.add_argument("--also-geojson", action="store_true")
    parser.add_argument("--git", action="store_true")
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_WEB_ROOT)
    parser.add_argument("--git-exe", default="git")
    parser.add_argument("--full-rebuild-sfide", action="store_true")
    parser.add_argument("--full-rebuild-firms", action="store_true")
    parser.add_argument("--firms-recent-days", type=int, default=4)
    parser.add_argument("--firms-lookahead-days", type=int, default=1)
    parser.add_argument("--incremental-overlap-hours", type=float, default=6.0)
    parser.add_argument("--incremental-lookahead-hours", type=float, default=3.0)
    parser.add_argument("--incremental-window-hours", type=float, default=96.0)
    parser.add_argument("--progress-interval-seconds", type=float, default=5.0)
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--interval-minutes", type=float, default=30.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    while True:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Updating hotspot databases", flush=True)
        run_once(args)
        if not args.watch:
            return 0
        time.sleep(max(1.0, args.interval_minutes * 60.0))


if __name__ == "__main__":
    raise SystemExit(main())
