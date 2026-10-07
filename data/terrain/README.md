# Copernicus GLO-90 terrain

The tiles in `glo90/` are modified Copernicus DEM GLO-90 elevations prepared for the viewer. Source: the public AWS Copernicus DEM GLO-90 COG collection, https://copernicus-dem-90m.s3.amazonaws.com/readme.html. The source list and rectangle used in this build are recorded in `glo90.json`.

Copernicus DEM is a digital surface model including vegetation, buildings and infrastructure. The source spacing is 3 arc seconds (nominally 90 m); elevations use EGM2008 orthometric heights. These heights are for terrain visualization, not fire geolocation or precise surveying.

Modifications made by this repository: mosaic 145 source tiles, bilinear reprojection to EPSG:3857, average downsampling to an XYZ pyramid (zooms 0-10), ocean/nodata values filled with zero, and Terrarium PNG encoding with integer metre heights. The highest web grid spacing is about 100-125 m on the ground across the coverage rectangle. This encoding precision is not an accuracy claim. Tile boundaries can include zero-filled land outside the selected source extent.

Attribution for modified products:

> Copernicus DEM GLO-90 (modified), © DLR e.V. 2010-2014 / © Airbus Defence and Space GmbH 2014-2018

These third-party derivatives retain the Copernicus DEM licence and are excluded from the repository's CC BY 4.0 data grant. Provider collection and licence information: https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model. The AWS source documentation links the applicable public-use terms. Retain provider attribution when redistributing the terrain.

Rebuild using `python scripts/build_terrain_tiles.py` in the project conda environment. The ignored `tmp/terrain-glo90/` directory holds source downloads and intermediate rasters. Only the prepared PNG tiles and `tiles.json` need to be hosted for the viewer. The viewer requests local static tiles because the source COG endpoint does not provide browser CORS access.
