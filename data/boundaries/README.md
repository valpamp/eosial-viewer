# Administrative boundary assets

These FlatGeobuf files are optional map overlays and are loaded only when selected.

| File | Coverage | Source |
| --- | --- | --- |
| admin0_countries_10m.fgb | Worldwide countries, level 0 | Natural Earth Admin 0 Countries, 1:10m |
| admin1_italy_regions_2026.fgb | Italian regions, level 1 | ISTAT administrative boundaries, 1 January 2026 |
| admin2_italy_provinces_2026.fgb | Italian provinces, level 2 | ISTAT administrative boundaries, 1 January 2026 |

The Natural Earth geometry was repaired and simplified by 0.001 degrees with topology preserved to reduce the web payload. ISTAT layers were reprojected from EPSG:32632 to EPSG:4326. Published attributes are limited to display name and code.

Sources:

- https://www.naturalearthdata.com/downloads/10m-cultural-vectors/
- https://www.istat.it/notizia/confini-delle-unita-amministrative-a-fini-statistici-al-1-gennaio-2018-2/