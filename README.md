# EOSIAL Viewer

Interactive web viewer for satellite-derived environmental variables, developed at the **EOSIAL Laboratory** (Earth Observation Satellite Images Applications Lab), Sapienza University of Rome.

**Live demo:** [https://valpamp.github.io/eosial-viewer](https://valpamp.github.io/eosial-viewer)

## Features

- **Fire hotspots** — Near-real-time active fire detections from MSG/MTG satellites (SFIDE algorithm), displayed as clustered markers and loaded by default over Italy
- **LFMC layer** — Live Fuel Moisture Content maps rendered from Cloud Optimized GeoTIFFs (COGs), with date slider, animated playback, and multiple colormaps
- **Timeseries queries** — Click a point or draw a rectangle to chart LFMC over time, with PNG export
- **Distance measurement** — Multi-segment ruler tool with metric readout
- **Location search** — Geocoding via OpenStreetMap Nominatim
- **Multiple basemaps** — CartoDB Light/Dark, OpenStreetMap, Google Satellite, OpenTopoMap
- **Dark mode** — Full UI dark theme toggle
- **Shareable permalinks** — URLs encode map view, AOI, and date

## Quick start

The viewer is a static site — no build step or server required.

1. **Clone the repository**
   ```bash
   git clone https://github.com/valpamp/eosial-viewer.git
   cd eosial-viewer
   ```

2. **Serve locally** (any static server works)
   ```bash
   # Python
   python -m http.server 8000

   # Node
   npx serve .
   ```

3. **Open** `http://localhost:8000` in your browser.

## Python environment

The website itself is static, but the data update and preprocessing scripts use
Python geospatial libraries. The recommended setup is conda with conda-forge:

```bash
conda env create -f environment.yml
conda activate eosial-viewer
```

`requirements.txt` is provided as a pip fallback, but conda is preferred on
Windows because it installs a consistent GDAL/rasterio/geopandas stack.

## Project structure

```
eosial-viewer/
├── index.html                  # Main page
├── css/style.css               # All styles (light + dark mode)
├── js/
│   ├── utils.js                # Shared utilities, colormaps, pub/sub
│   ├── app.js                  # Map init, toolbar, sidebar, query tools
│   ├── timeseries.js           # Chart.js timeseries modal
│   └── layers/
│       ├── lfmc.js             # LFMC raster layer (COG loading + rendering)
│       └── fire-hotspots.js    # Fire detection markers
├── data/
│   ├── lfmc/
│   │   ├── manifest.json       # Index of available AOIs, polygons, dates
│   │   └── cogs/               # Cloud Optimized GeoTIFFs (uint8, DEFLATE)
│   └── fire/
│       ├── sfide_aggregate_72h.fgb       # Recent fire hotspot detections
│       ├── sfide_archive_manifest.json   # Monthly archive index
│       └── archive/sfide_YYYY_MM.fgb     # Rolling one-year monthly chunks
├── scripts/
│   ├── convert_to_cog.py       # Convert LFMC inference TIFs → COGs
│   └── generate_manifest.py    # Scan COGs directory → manifest.json
└── images/
    └── EOSIAL_banner.png
```

## Data pipeline

### LFMC

1. Run LFMC inference (external) to produce GeoTIFF outputs.
2. **Convert to COGs:**
   ```bash
   python scripts/convert_to_cog.py
   ```
   Reprojects to EPSG:4326, rounds to uint8 (0–254, 255 = nodata), compresses with DEFLATE, and adds overviews.
3. **Generate manifest:**
   ```bash
   python scripts/generate_manifest.py
   ```
   Scans `data/lfmc/cogs/` and writes `data/lfmc/manifest.json`.

### Fire hotspots

The website looks for fire files in this order: FlatGeobuf (`.fgb`), zipped Shapefile (`.zip`), GeoPackage (`.gpkg`), GeoJSON (`.geojson`), then JSON (`.json`). The normal layout is:

- `sfide_aggregate_72h.*` — a small rolling subset used for the initial lightweight load.
- `sfide_archive_manifest.json` — index of monthly archive chunks.
- `archive/sfide_YYYY_MM.*` — rolling one-year archive split by month, loaded only when a selected time window needs older detections.

Run the updater once:

```bash
python scripts/update_sfide_database.py --source-dir U:\ftp\sfide\ITA
```

Or keep it running every 30 minutes:

```bash
python scripts/update_sfide_database.py --source-dir U:\ftp\sfide\ITA --watch --interval-minutes 30 --git
```

The script scans SFIDE outputs recursively, accepts `.fgb`, `.geojson`, `.json`, `.gpkg`, `.shp`, and zipped shapefiles, deduplicates detections, prunes records older than one year, writes the 72-hour aggregate, and splits the one-year archive into monthly chunks to stay below GitHub's 100 MB file limit. With `--git`, it commits and pushes changed fire files so GitHub Pages redeploys. FlatGeobuf output requires `geopandas`/`pyogrio`; GeoJSON-only operation works with the Python standard library by using `--output-format geojson`.

For Windows Task Scheduler, use the batch wrapper instead of `--watch`:

```text
Program/script: F:\Valerio\eosial-viewer\scripts\run_sfide_update.bat
Start in:       F:\Valerio\eosial-viewer
Trigger:        Repeat every 30 minutes
```

The wrapper writes progress and errors to `logs/sfide_update.log`. During long first runs, watch for lines like `Processing hotspot files: [########--------------------] 120/480 ... ETA 12m 30s`.

Hotspot features should contain Point geometry and these properties where available:

| Property | Description |
|----------|-------------|
| `DATETIME` | Detection timestamp (UTC) |
| `SATELLITE` | Source satellite (e.g. MSG, MTG) |
| `CONFIDENCE` | Detection confidence (%) |
| `FRP_WOOSTER` or `FRP_MODIS` | Fire Radiative Power (MW) |

The layer loads this file on init and renders points as clustered markers. To update the data, replace the GeoJSON and redeploy.

## Dependencies

All libraries are loaded from CDNs — no `npm install` required:

| Library | Purpose |
|---------|---------|
| [Leaflet](https://leafletjs.com/) | Map framework |
| [georaster-layer-for-leaflet](https://github.com/GeoTIFF/georaster-layer-for-leaflet) | COG rendering |
| [Leaflet.draw](https://leaflet.github.io/Leaflet.draw/) | Rectangle drawing for polygon queries |
| [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) | Fire hotspot clustering |
| [Chart.js](https://www.chartjs.org/) | Timeseries charts |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first styling |

Python LFMC scripts require **rasterio** and **numpy** (`pip install rasterio numpy`).
The SFIDE updater can read/write GeoJSON with the standard library; FlatGeobuf, Shapefile, and GeoPackage support require **geopandas** and a vector I/O backend such as **pyogrio** (`pip install geopandas pyogrio`).

## Publishing

Hosted on **GitHub Pages** — every push to `main` triggers an automatic redeploy.

To self-host or fork: serve the repository root with any static file server. COG data files must be included. If the dataset grows beyond ~500 MB, consider hosting COGs on external object storage and updating `DATA_BASE` in `js/app.js`.

## Citation

If you use this software or data in your work, please cite this repository. GitHub shows a "Cite this repository" button on the sidebar — powered by the included [`CITATION.cff`](CITATION.cff) file.

## License

- **Code** (HTML, CSS, JavaScript, Python scripts): [MIT License](LICENSE)
- **Data** (GeoTIFFs, COGs, GeoJSON, manifests): [CC BY 4.0](DATA_LICENSE) — you must give appropriate credit when using or redistributing the data.

## Contact

**Valerio Pampanoni, PhD**
EOSIAL Laboratory, School of Aerospace Engineering, Sapienza University of Rome
[valerio.pampanoni@uniroma1.it](mailto:valerio.pampanoni@uniroma1.it) · [LinkedIn](https://it.linkedin.com/in/valerio-pampanoni)
