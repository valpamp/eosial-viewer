# EOSIAL Viewer

Interactive web viewer for satellite-derived environmental variables, developed at the **EOSIAL Laboratory** (Earth Observation Satellite Images Applications Lab), Sapienza University of Rome.

**Live demo:** *coming soon — see [Publishing](#publishing) below*

## Features

- **LFMC layer** — Live Fuel Moisture Content maps rendered from Cloud Optimized GeoTIFFs (COGs), with date slider, animated playback, and multiple colormaps
- **Fire hotspots** — Near-real-time active fire detections from MSG/MTG satellites (SFIDE algorithm), displayed as clustered markers
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
   git clone https://github.com/YOUR_USERNAME/eosial-viewer.git
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
│   └── lfmc/
│       ├── manifest.json       # Index of available AOIs, polygons, dates
│       └── cogs/               # Cloud Optimized GeoTIFFs (uint8, DEFLATE)
├── scripts/
│   ├── convert_to_cog.py       # Convert LFMC inference TIFs → COGs
│   └── generate_manifest.py    # Scan COGs directory → manifest.json
└── images/
    └── EOSIAL_banner.png
```

## Data pipeline

1. **Run LFMC inference** (external) to produce GeoTIFF outputs.
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

Python scripts require **rasterio** and **numpy** (`pip install rasterio numpy`).

## Publishing

The simplest option is **GitHub Pages**:

1. Push to a public GitHub repository.
2. Go to **Settings → Pages → Source: Deploy from branch → main / root**.
3. The site goes live at `https://YOUR_USERNAME.github.io/eosial-viewer/`.

COG data files must be committed to the repository. Current total is ~33 MB (12 dates, Iberia AOI). If the dataset grows beyond ~500 MB, consider hosting COGs on external object storage and updating `DATA_BASE` in `js/app.js`.

## Citation

If you use this software or data in your work, please cite this repository. GitHub shows a "Cite this repository" button on the sidebar — powered by the included [`CITATION.cff`](CITATION.cff) file.

## License

- **Code** (HTML, CSS, JavaScript, Python scripts): [MIT License](LICENSE)
- **Data** (GeoTIFFs, COGs, GeoJSON, manifests): [CC BY 4.0](DATA_LICENSE) — you must give appropriate credit when using or redistributing the data.

## Contact

**Valerio Pampanoni, PhD**
EOSIAL Laboratory, School of Aerospace Engineering, Sapienza University of Rome
[valerio.pampanoni@uniroma1.it](mailto:valerio.pampanoni@uniroma1.it) · [LinkedIn](https://it.linkedin.com/in/valerio-pampanoni)
