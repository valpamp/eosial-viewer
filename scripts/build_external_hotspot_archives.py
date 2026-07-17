"""Build compact daily external hotspot archives for the EOSIAL Viewer."""
from __future__ import annotations
import argparse, json, shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
START = date(2025, 6, 1)

def day_from_name(path: Path) -> date | None:
    import re
    m = re.search(r'(20\d{2})(\d{2})(\d{2})', path.name)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r'(20\d{2})(\d{3})', path.name)
    if m:
        return date(int(m[1]), 1, 1) + timedelta(days=int(m[2])-1)
    return None

def day_column(gdf, names):
    cols = {c.lower(): c for c in gdf.columns}
    for name in names:
        if name.lower() in cols:
            return pd.to_datetime(gdf[cols[name.lower()]], errors='coerce', utc=True).dt.date
    return pd.Series([pd.NaT] * len(gdf))

def normalize_firms(gdf):
    cols = {c.lower(): c for c in gdf.columns}
    def col(name, default=None): return gdf[cols[name]] if name in cols else default
    out = gdf.copy()
    out['DATASET'] = 'FIRMS'
    out['acq_date'] = col('acq_date', '')
    out['acq_time'] = col('acq_time', '')
    out['product'] = col('version', '')
    out['satellite'] = col('satellite', '')
    out['frp'] = col('frp', 0)
    return out

def normalize_s3(gdf, source):
    out = gdf.copy()
    out['DATASET'] = 'S3'
    out['SOURCE_FILE'] = source.name
    return out

def write_archive(name, groups, output, incremental=False):
    directory = output / (name + '_archive')
    directory.mkdir(parents=True, exist_ok=True)
    manifest_path = output / f'{name}_archive_manifest.json'
    existing = {} if not incremental or not manifest_path.exists() else {item['key']: item for item in json.loads(manifest_path.read_text(encoding='utf-8')).get('chunks', [])}
    entries = existing
    keep = set(existing[item]['path'].split('/')[-1] for item in existing)
    for day, frames in sorted(groups.items()):
        frame = pd.concat(frames, ignore_index=True)
        gdf = gpd.GeoDataFrame(frame, geometry='geometry', crs=frames[0].crs or 'EPSG:4326')
        path = directory / f'{name}_{day:%Y%m%d}.fgb'
        gdf.to_file(path, driver='FlatGeobuf')
        keep.add(path.name)
        entries[day.isoformat()] = {'key': day.isoformat(), 'path': f'{name}_archive/{path.name}', 'format': 'fgb',
                        'start': datetime.combine(day, datetime.min.time(), timezone.utc).isoformat(),
                        'end': datetime.combine(day, datetime.max.time(), timezone.utc).isoformat(),
                        'count': len(gdf)}
    if not incremental:
        for path in directory.glob('*.fgb'):
            if path.name not in keep: path.unlink()
    manifest_path.write_text(json.dumps(
        {'generated': datetime.now(timezone.utc).isoformat(), 'format':'fgb', 'chunks':[entries[key] for key in sorted(entries)]}, indent=2), encoding='utf-8')

def build_firms(archive_source, nrt_source, output, incremental=False):
    groups = {}
    for path in ([] if incremental else archive_source.glob('fire_archive_*.shp')):
        gdf = normalize_firms(gpd.read_file(path))
        dates = day_column(gdf, ('acq_date',))
        for day, frame in gdf.groupby(dates):
            if pd.notna(day) and day >= START: groups.setdefault(day, []).append(frame)
    recent_floor = datetime.now(timezone.utc).date() - timedelta(days=7)
    for path in nrt_source.glob('*.fgb'):
        day = day_from_name(path)
        if day and day >= START and (not incremental or day >= recent_floor): groups.setdefault(day, []).append(normalize_firms(gpd.read_file(path)))
    write_archive('firms', groups, output, incremental)

def build_s3(source, output, incremental=False):
    groups = {}
    for path in source.rglob('*.fgb'):
        day = day_from_name(path)
        if day and day >= START and (not incremental or day >= datetime.now(timezone.utc).date() - timedelta(days=7)): groups.setdefault(day, []).append(normalize_s3(gpd.read_file(path), path))
    write_archive('s3', groups, output, incremental)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--output-dir', type=Path, default=ROOT/'data'/'fire')
    p.add_argument('--firms-archive-source', type=Path, default=Path(r'F:\Valerio\dfdi\data\hotspots\ITA'))
    p.add_argument('--firms-nrt-source', type=Path, default=Path(r'X:\ftp\cufa\FIRMS_NRT\ITA\firms\fgb'))
    p.add_argument('--s3-source', type=Path, default=Path(r'X:\ftp\cufa\S3_NRT\S3_FRP_CROPS'))
    p.add_argument('--dataset', choices=('firms','s3','all'), default='all')
    p.add_argument('--incremental', action='store_true', help='Refresh only the latest seven daily chunks.')
    a=p.parse_args(); a.output_dir.mkdir(parents=True, exist_ok=True)
    if a.dataset in ('firms','all'): build_firms(a.firms_archive_source, a.firms_nrt_source, a.output_dir, a.incremental)
    if a.dataset in ('s3','all'): build_s3(a.s3_source, a.output_dir, a.incremental)
if __name__ == '__main__': main()