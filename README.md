# EOSIAL Active Fire Viewer

Interactive web viewer for active fire detections and satellite wildfire management products, developed at the **EOSIAL Laboratory** (Earth Observation Satellite Images Applications Lab), Sapienza University of Rome.

**Live demo:** [https://valpamp.github.io/eosial-viewer](https://valpamp.github.io/eosial-viewer)

## Features

- **Fire hotspots** - Near-real-time active fire detections from MSG/MTG satellites (SFIDE algorithm), plus external FIRMS, Sentinel-3, and official EUMETSAT MTG-FIR comparison layers
- **Timeseries queries** - Draw a rectangle to chart active fire FRP over time, with table, CSV, and PNG export
- **Distance measurement** - Multi-segment ruler tool with metric readout
- **Location search** - Geocoding via OpenStreetMap Nominatim
- **Multiple basemaps** - CartoDB Light/Dark, OpenStreetMap, Google Satellite, OpenTopoMap
- **Dark mode** - Full UI dark theme toggle
- **Shareable permalinks** - URLs preserve the map view, time interval, visible hotspot sources, selected satellites, and filter values

## Quick start

The viewer is a static site - no build step or server required.

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
|-- index.html                  # Main page
|-- css/style.css               # All styles (light + dark mode)
|-- js/
|   |-- config.js               # Optional deployment data URL override
|   |-- utils.js                # Shared utilities, colormaps, pub/sub
|   |-- app.js                  # Map init, toolbar, sidebar, query tools
|   |-- timeseries.js           # Chart.js timeseries modal
|   `-- layers/
|       `-- fire-hotspots.js    # Fire detection markers
|-- data/
|   `-- fire/
|       |-- sfide_aggregate_72h.fgb       # Recent fire hotspot detections
|       |-- sfide_archive_manifest.json   # SFIDE archive index
|       `-- archive/sfide_YYYY_Www.fgb    # Rolling one-year weekly chunks
|-- scripts/
`-- images/
    `-- EOSIAL_banner.png
```

## Data pipeline

### Fire hotspots

The website looks for fire files in this order: FlatGeobuf (`.fgb`), zipped Shapefile (`.zip`), GeoPackage (`.gpkg`), GeoJSON (`.geojson`), then JSON (`.json`). The normal layout is:

- `sfide_aggregate_72h.*` - a small rolling subset used for the initial lightweight load.
- `sfide_archive_manifest.json` - index of SFIDE archive chunks.
- `archive/sfide_YYYY_Www.*` - rolling one-year SFIDE archive split by ISO week by default, loaded only when a selected time window needs older detections.
- `firms_manifest.json`, `s3_manifest.json`, `mtg_fir_manifest.json` - external comparison layer indexes.
- `firms/`, `s3/`, `mtg_fir/` - recent external hotspot files published for the website.

Run the updater once:

```bash
python scripts/update_sfide_database.py --source-dir U:\ftp\sfide\ITA
```

Or keep it running every 30 minutes:

```bash
python scripts/update_sfide_database.py --source-dir U:\ftp\sfide\ITA --watch --interval-minutes 30 --git
```

The script scans SFIDE outputs recursively, accepts `.fgb`, `.geojson`, `.json`, `.gpkg`, `.shp`, and zipped shapefiles, deduplicates detections, prunes records older than one year, writes the 72-hour aggregate, and splits the one-year archive into weekly chunks by default to stay comfortably below GitHub's file-size limits. Use `--archive-period day` for the safest/smallest chunks or `--archive-period month` for the older behavior. With `--git`, it commits and pushes changed fire files so GitHub Pages redeploys. FlatGeobuf output requires `geopandas`/`pyogrio`; GeoJSON-only operation works with the Python standard library by using `--output-format geojson`.

For Windows Task Scheduler, use the batch wrapper instead of `--watch`:

```text
Program/script: F:\Valerio\eosial-viewer\scripts\run_sfide_update.bat
Start in:       F:\Valerio\eosial-viewer
Trigger:        Repeat every 30 minutes
```

The wrapper writes progress and errors to `logs/sfide_update.log`. During long first runs, watch for lines like `Processing hotspot files: [########--------------------] 120/480 ... ETA 12m 30s`.

Hotspot features should contain Point geometry and these properties where available:

| Property | Description |
|--------|-----------|
| `DATETIME` | Detection timestamp (UTC) |
| `SATELLITE` | Source satellite (e.g. MSG, MTG) |
| `CONFIDENCE` | Detection confidence (%) |
| `FRP_WOOSTER` or `FRP_MODIS` | Fire Radiative Power (MW) |

The layer loads this file on init and renders points as clustered markers. To update the data, replace the GeoJSON and redeploy.

## Dependencies

All libraries are loaded from CDNs - no `npm install` required:

| Library | Purpose |
|-------|-------|
| [Leaflet](https://leafletjs.com/) | Map framework |
| [Leaflet.draw](https://leaflet.github.io/Leaflet.draw/) | Rectangle drawing for polygon queries |
| [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) | Fire hotspot clustering |
| [Chart.js](https://www.chartjs.org/) | Timeseries charts |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first styling |

The SFIDE updater can read/write GeoJSON with the standard library; FlatGeobuf, Shapefile, and GeoPackage support require **geopandas** and a vector I/O backend such as **pyogrio** (`pip install geopandas pyogrio`).

## Publishing

Hosted on **GitHub Pages** - every push to `main` triggers an automatic redeploy.

GitHub Pages deploys a single artifact and warns/fails when that artifact is
larger than 1 GB. This limit applies to the total published site, not only to
individual files. If deployment fails with an artifact larger than 1 GB, the
usual cause is accumulated raster/product history rather than a single hotspot database file. The current active-fire-only deployment removes `data/lfmc/` from the published site.

Recommended deployment pattern for larger operational datasets:

1. Publish the static viewer code with GitHub Pages.
2. Host any future heavy data folders on external static
   storage such as the EOSIAL server, S3/R2-compatible object storage, or
   another HTTP-accessible file server.
3. Set the external data base URL in `js/config.js` before deploying:

   ```js
   window.EOSIAL_DATA_URL = 'https://example.com/eosial-viewer-data';
   ```

The external data host should preserve the same relative layout currently used
under `data/`, for example `fire/sfide_aggregate_72h.fgb` and the archive manifests. Keep `window.EOSIAL_DATA_URL = 'data'` for
local testing or small deployments where the website and data are published
together. If the data is served from a different domain, enable CORS for the
viewer origin; future COG hosting should also support HTTP range requests.

Short-term GitHub Pages-only workarounds are to prune old heavy raster products or publish fewer AOIs. The fire hotspot updater already
splits the SFIDE archive into weekly chunks by default, which helps avoid large
individual hotspot files, but it does not solve a total artifact-size excess
caused by heavy raster history.

## Citation

If you use this software or data in your work, please cite this repository. GitHub shows a "Cite this repository" button on the sidebar - powered by the included [`CITATION.cff`](CITATION.cff) file.

## License

- **Code** (HTML, CSS, JavaScript, Python scripts): [MIT License](LICENSE)
- **Data** (GeoTIFFs, COGs, GeoJSON, manifests): [CC BY 4.0](DATA_LICENSE) - you must give appropriate credit when using or redistributing the data.

## Contact

**Valerio Pampanoni, PhD**
EOSIAL Laboratory, School of Aerospace Engineering, Sapienza University of Rome
[valerio.pampanoni@uniroma1.it](mailto:valerio.pampanoni@uniroma1.it) - [LinkedIn](https://it.linkedin.com/in/valerio-pampanoni)
