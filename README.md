# EOSIAL Active Fire Viewer

EOSIAL Active Fire Viewer is an interactive web GIS for exploring and comparing satellite active-fire detections over Italy. It is developed and maintained by the **EOSIAL Laboratory** (Earth Observation Satellite Images Applications Lab), School of Aerospace Engineering, Sapienza University of Rome.

**Live viewer:** [https://valpamp.github.io/eosial-viewer/](https://valpamp.github.io/eosial-viewer/)

The application is focused exclusively on active-fire products. It combines EOSIAL detections from geostationary Meteosat imagery with independent products from NASA, Copernicus, and EUMETSAT.

## Data sources

| Dataset | Satellites and products | Provenance |
| --- | --- | --- |
| **SFIDE** | MSG-HRIT, MSG-RSS, and MTG-I1 FCI | Detections produced by EOSIAL from [MSG SEVIRI Level 1.5](https://user.eumetsat.int/resources/user-guides/msg-high-rate-seviri-level-1-5-data-guide) and [MTG FCI Level 1c](https://user.eumetsat.int/resources/user-guides/mtg-fci-level-1c-data-guide) imagery using the SFIDE algorithm. These are not the operational EUMETSAT fire product. |
| **NASA FIRMS** | MODIS Terra/Aqua Collection 6.1 and VIIRS Suomi-NPP, NOAA-20, and NOAA-21 Collection 2 | External near-real-time and archived detections distributed by [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/). |
| **Sentinel-3** | Sentinel-3A and Sentinel-3B SLSTR Standard, Alternative, and 500 m SWIR detections | External detections extracted from the [Sentinel-3 SLSTR Level-2 FRP product](https://sentiwiki.copernicus.eu/web/slstr-products). |
| **MTG-FIR** | Official MTG-I1 FCI Level-2 Active Fire Monitoring product | External operational product distributed by EUMETSAT. See the [MTG-FIR data guide](https://user.eumetsat.int/resources/user-guides/mtg-fci-l2-fir-data-guide). |

SFIDE is enabled by default. NASA FIRMS, Sentinel-3, and MTG-FIR are marked as external comparison datasets and remain disabled until selected.

## Main features

- **Tabbed dataset controls** - switch between source-specific controls without changing layer visibility; each source has a separate activation checkbox.
- **Satellite and product selection** - compare MSG and MTG SFIDE detections, MODIS and VIIRS platforms, Sentinel-3 retrieval streams, and official MTG-FIR results.
- **Dataset-specific filters** - SFIDE fire class, confidence, and FRP; MODIS numeric confidence; VIIRS categorical confidence; Sentinel-3 retrieval and confidence; and MTG-FIR result/probability controls.
- **UTC time filtering** - presets for 6, 12, 24, and 72 hours, 7 days, all data, or a custom range. The default is the latest 6 hours.
- **Clear source symbology** - satellite-specific colors, SFIDE fire-type shapes, majority-vote cluster shapes, and FRP-dependent styling.
- **Pixel-footprint display** - detailed views automatically show MSG/MTG native-grid footprints, FIRMS scan/track footprints, and Sentinel-3 projected IFOV approximations.
- **Polygon analysis** - draw a rectangular query area and inspect its detections as an animation, graph, or paginated table.
- **Animation and export** - timestamp-by-timestamp playback, optional persistence, editable UTC range, frame duration, title, opacity, and FRP labels. Export is available as WebM and, in supported browsers, MP4/H.264.
- **Scientific graphing** - separate satellite series, cumulative FRP in MW, geostationary time-series lines, polar-orbiter markers, readable UTC ticks, PNG export, and CSV export.
- **Table view** - 50 detections per page, selectable output fields, chronological navigation, and CSV download.
- **Map utilities** - OpenStreetMap, Google Hybrid, and OpenTopoMap basemaps; search; distance measurement; map-image export; dark mode; and optional administrative boundaries.
- **Shareable state** - URLs preserve map position, time range, active datasets, selected products, and filters.
- **Responsive interface** - desktop controls and a compact mobile bottom sheet with touch-compatible rectangle drawing.
- **Viewer guide** - an in-application walkthrough introduces filters and the Animation/Graph/Table workflow.

### Default view

- SFIDE enabled; external datasets disabled
- latest 6 hours relative to current UTC time
- minimum SFIDE confidence of 40%
- minimum SFIDE FRP of 20 MW
- minimum FIRMS and Sentinel-3 FRP of 0 MW when enabled

## Local use

The viewer is a static site. It has no JavaScript build step, but it should be opened through an HTTP server so browser data requests work correctly.

```bash
git clone https://github.com/valpamp/eosial-viewer.git
cd eosial-viewer
python -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/). Node can be used instead:

```bash
npx serve .
```

## Project structure

```text
eosial-viewer/
|-- index.html                       # Application shell and dialogs
|-- css/style.css                    # Desktop, mobile, light, and dark styles
|-- js/
|   |-- app.js                       # Map, tools, layers, and shared state
|   |-- config.js                    # Optional external data URL override
|   |-- fire-animation.js            # Interactive and exported animations
|   |-- mobile-ui.js                 # Mobile bottom-sheet interface
|   |-- onboarding.js                # Viewer guide
|   |-- timeseries.js                # Animation/graph/table result window
|   |-- utils.js                     # Shared helpers and event bus
|   `-- layers/
|       |-- admin-boundaries.js      # Administrative overlays
|       |-- fire-hotspots.js         # Loading, filtering, and queries
|       `-- pixel-grids.js           # Native grids and polar footprints
|-- data/
|   |-- boundaries/                  # Natural Earth and ISTAT layers
|   |-- fire/                        # Recent data, archives, and manifests
|   `-- pixel-grids/                 # Compact MSG/MTG grid metadata
|-- images/                          # EOSIAL and Sapienza branding
|-- scripts/                         # Database builders and updater
|-- environment.yml
`-- requirements.txt
```

## Fire data layout

The browser loads recent files first and requests archive chunks only when the selected interval needs them.

```text
data/fire/
|-- sfide_aggregate_72h.fgb
|-- sfide_archive_manifest.json
|-- archive/sfide_YYYY_Www.fgb
|-- firms_manifest.json
|-- firms/FIRMS_ITA_YYYYDDD.fgb
|-- firms_archive_manifest.json
|-- firms_archive/firms_YYYYMMDD.fgb
|-- s3_manifest.json
|-- s3/*.fgb
|-- s3_archive_manifest.json
|-- s3_archive/s3_YYYYMMDD.fgb
|-- mtg_fir_manifest.json
|-- mtg_fir/*.fgb
`-- *_update_state.json
```

- SFIDE history begins on `2025-06-01` and is split into ISO-week chunks by default.
- FIRMS and Sentinel-3 historical data are published as daily chunks.
- Recent manifests keep initial page loads small.
- State files remember the latest processed detections so normal updates inspect only relevant recent source folders and files.

The SFIDE reader accepts FlatGeobuf, GeoJSON/JSON, GeoPackage, Shapefile, and zipped Shapefile inputs. FlatGeobuf is the normal web-facing format.

## Updating the databases

Database creation and maintenance use Python geospatial libraries.

### Environment

```bash
conda env create -f environment.yml
conda activate eosial-viewer
```

Conda with conda-forge is recommended on Windows for a consistent GDAL/geopandas stack. `requirements.txt` is available as a pip fallback.

### Incremental update

Use the combined updater for routine operation:

```bash
python scripts/update_hotspot_databases.py --git
```

It updates SFIDE, NASA FIRMS, Sentinel-3, their maintained archives, and recent MTG-FIR data. It then commits changes under `data/fire/` and pushes them for publication. Scheduled runs require a working non-interactive SSH deploy key with write access.

Source locations can be overridden with:

```text
--sfide-source-dir
--firms-source-dir
--firms-archive-source-dir
--s3-source-dir
--mtg-fir-source-dir
--output-dir
```

Run `python scripts/update_hotspot_databases.py --help` for all options.

### Full rebuild

Use a full rebuild only for initial creation or intentional replacement of the histories:

```powershell
python scripts\update_hotspot_databases.py --full-rebuild-sfide --full-rebuild-firms --full-rebuild-s3 --full-rebuild-mtg-fir --git
```

Normal scheduled updates should not use full-rebuild flags.

### Windows Task Scheduler

```text
Program/script: F:\Valerio\eosial-viewer\scripts\run_sfide_update.bat
Start in:       F:\Valerio\eosial-viewer
Trigger:        Repeat every 30 minutes
```

Progress and errors are appended to `logs/sfide_update.log`. The wrapper activates the `eosial-viewer` conda environment and runs the combined updater despite its historical filename.

## Hotspot properties

Fields vary by provider, but normalized records use these properties where available:

| Property | Meaning |
| --- | --- |
| `DATETIME` | Acquisition or detection timestamp in UTC |
| `DATASET` | SFIDE, FIRMS, S3, or MTG_FIR |
| `SATELLITE` | Normalized satellite/sensor identifier |
| `PRODUCT` | Product description |
| `FRP_WOOSTER` / `FRP_MODIS` | Fire Radiative Power in MW |
| `CONFIDENCE` | Numeric confidence when supplied |
| `TYPE` | SFIDE fire class |
| `S3_RETRIEVAL` | Sentinel-3 Standard, Alternative, or SWIR stream |
| `FIRE_RESULT` / `FIRE_PROBABILITY` | MTG-FIR result and probability |

The updater normalizes provider naming differences and deduplicates detections before publication.

## Browser dependencies

Runtime libraries are loaded from CDNs; no `npm install` is required.

| Library | Purpose |
| --- | --- |
| [Leaflet](https://leafletjs.com/) | Web map framework |
| [MapLibre GL JS](https://maplibre.org/) | Optional 3D terrain (loaded on demand) |
| [Leaflet.draw](https://leaflet.github.io/Leaflet.draw/) | Rectangle query tool |
| [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) | Hotspot clustering |
| [FlatGeobuf](https://flatgeobuf.org/) | Web vector loading |
| [Chart.js](https://www.chartjs.org/) | Scientific time-series charts |
| [html2canvas](https://html2canvas.hertzen.com/) | Map and animation rendering |
| [Tailwind CSS](https://tailwindcss.com/) | Application-shell styling |

MP4 export depends on browser MediaRecorder support for H.264 and is normally available in current Microsoft Edge or Google Chrome. WebM remains the fallback.

## Phone controls

On screens up to 760px wide, use the bottom dock to open observation times, dataset filters or additional layers. Dataset filters appear in a vertical list: the checkbox controls map visibility, while the dataset name opens its filters without changing visibility. The active row says "Editing". Visibility changes leave the current filter panel in place. Source controls have at least 44px touch targets, and the filter sheet scrolls vertically to fit smaller phones. Wider screens retain the compact horizontal dataset bar.

## Optional 3D terrain

Click **3D** in the map toolbar to drape the selected fire footprints over terrain. Dataset, satellite, time, confidence and FRP filters are shared with 2D. Click a footprint for details. Repeated observations of the same pixel share one footprint; its popup shows the strongest FRP representative and observation count. Missing pixel geometry appears as a point, and approximate sensor footprints remain approximate.

Use **Gran Sasso** or **Etna** to inspect relief, right-drag to rotate/tilt, and **Return to 2D** (or Escape) to resume normal tools. **Place labels** overlays Google place names and roads above the imagery. Labels start off; the checkbox retains your choice when switching between 2D and 3D until the page is refreshed. Label tiles are requested only when enabled, and fire footprints stay above them. Height defaults to 1x; 1.5x and 2x exaggeration are optional. The camera location is preserved when returning to 2D. WebGL is required; MapLibre loads only when 3D is opened.

Coverage is Italy and surrounding land (6-20 E, 35-48 N), using Copernicus GLO-90 source elevations and a Google Satellite basemap (imagery without road labels). The static Terrarium pyramid contains 2,805 256px PNG tiles at zooms 0-10, about 82 MiB. At zoom 10, the web grid spacing is approximately 100-125 m on the ground; closer views interpolate those heights. GLO-90 is a nominal 90 m digital surface model, including vegetation and structures. Terrain does not improve fire detection geolocation. See [terrain provenance and terms](data/terrain/README.md).

Additional layers, rectangle analysis, animation and exports remain in 2D. This first 3D mode uses its own basemap and does not reproduce those overlays.

Tiles are served from `data/terrain/glo90`. To host them separately, configure a CORS-enabled static host in `js/config.js`:

~~~js
window.EOSIAL_TERRAIN_URL = 'https://example.com/terrain/glo90';
~~~

The directory must contain `tiles.json` and the `{z}/{x}/{y}.png` paths. If using an external EOSIAL_DATA_URL without a separate terrain URL, include terrain alongside the other data. No API key or runtime elevation service is needed.

Rebuild using the project conda environment (GDAL and Pillow required):

~~~text
conda activate eosial-viewer
python scripts/build_terrain_tiles.py
~~~

Source files and intermediate rasters are cached under ignored `tmp/terrain-glo90`; allow several GB of local disk space. The source list and extent are recorded in `data/terrain/glo90.json`. Optional `--max-zoom 11` gives a finer rendering grid and larger package without increasing source resolution. Use a separate `--output-dir` when comparing builds.


## Publishing

The LFMC raster collection belongs to the planned companion raster viewer and is excluded from this repository's current site. This workstation keeps the removed data, manifest, statistics and update state under ignored `tmp/lfmc-companion/data/lfmc/` for migration. Configure LFMC updater scripts to target the companion repository before resuming publication. The active-fire page does not load `js/layers/lfmc.js`; its legacy module and preparation scripts are retained for reuse.

Fire updaters change recent files and the affected archive chunks incrementally. A Pages deployment still publishes a complete snapshot of the tracked site, including unchanged archives and terrain tiles. Git ignore rules prevent removed LFMC data from being added again. Removing files from the current revision does not erase them from Git history. Historical data should eventually move to separate static storage if the active-fire package approaches the Pages size limit.

The repository is designed for static publication on GitHub Pages. The tracked `.nojekyll` file bypasses Jekyll because no site-generation step is required.

GitHub Pages artifacts have a total size limit. Keep archives chunked and avoid large monolithic aggregates. If the data outgrow Pages, host `data/` on CORS-enabled static/object storage and set the base URL in `js/config.js`:

```js
window.EOSIAL_DATA_URL = 'https://example.com/eosial-viewer-data';
```

The external host must preserve the paths below `data/`, including `fire/`, `boundaries/`, and `pixel-grids/`. Keep `window.EOSIAL_DATA_URL = 'data'` when code and data are served together.

## Citation

If you use the viewer or SFIDE data in scientific work, cite this repository and the relevant source products. GitHub exposes the repository citation through [`CITATION.cff`](CITATION.cff).

## License

- **Code:** [MIT License](LICENSE)
- **Repository data:** [CC BY 4.0](DATA_LICENSE)

External NASA, Copernicus, and EUMETSAT products retain their provider attribution and applicable terms.

## Contact

**Valerio Pampanoni, PhD**<br>
EOSIAL Laboratory, School of Aerospace Engineering, Sapienza University of Rome<br>
[valerio.pampanoni@uniroma1.it](mailto:valerio.pampanoni@uniroma1.it) | [LinkedIn](https://it.linkedin.com/in/valerio-pampanoni)

## Regression checks

Run the focused loading, query, validation, escaping and search checks with Node:

~~~text
node --test tests/viewer-regressions.cjs tests/terrain-regressions.cjs
~~~

An optional real-browser smoke check uses synthetic fire data and the normal CDN libraries:

~~~text
node tests/browser-smoke.cjs
~~~

It defaults to the local Windows Chromium installation. Set EOSIAL_TEST_BROWSER to another Chromium executable if needed. The check starts a loopback HTTP server and a hidden browser with a temporary profile; it does not change the fire databases.

Failed data loads now show an incomplete-coverage warning and a retry button. Polygon CSV exports include a coverage-warning row when the selected data are incomplete. Location searches run when Enter is pressed.

Terrain encoding and tile alignment checks (in the project conda environment):

~~~text
python -m unittest discover -s tests -p test_terrain_tiles.py
~~~

The browser smoke also verifies real local terrain elevation, shared filters, footprint popups and desktop/mobile mode switching. It uses synthetic fire detections and a local basemap fixture; it is not a live-provider integration test.
