"""Numeric and coverage checks for the GLO-90 terrain preparation."""
import importlib.util
import math
from pathlib import Path
import unittest
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('terrain_builder', ROOT / 'scripts' / 'build_terrain_tiles.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class TerrainChecks(unittest.TestCase):
    def test_terrarium_round_trip_preserves_negative_and_positive_heights(self):
        heights = np.array([[-430., 0., 0.4, 1.6, 2912., 4808.]])
        rgb = builder.encode_terrarium(heights).astype(np.int32)
        decoded = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
        np.testing.assert_allclose(decoded, np.rint(heights))

    def test_adjacent_tiles_share_identical_boundaries(self):
        west = builder.tile_bounds(550, 380, 10)
        east = builder.tile_bounds(551, 380, 10)
        south = builder.tile_bounds(550, 381, 10)
        self.assertEqual(west[2], east[0])
        self.assertEqual(west[1], south[3])

    def test_published_terrain_contains_real_gran_sasso_relief(self):
        zoom, lon, lat = 10, 13.56, 42.45
        n = 2**zoom
        x = (lon + 180) / 360 * n
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        tile = ROOT / 'data' / 'terrain' / 'glo90' / str(zoom) / str(math.floor(x)) / f'{math.floor(y)}.png'
        rgb = np.asarray(Image.open(tile)).astype(np.int32)
        pixel = rgb[min(255, int((y % 1) * 256)), min(255, int((x % 1) * 256))]
        height = pixel[0] * 256 + pixel[1] + pixel[2] / 256 - 32768
        self.assertGreater(height, 500)
        self.assertLess(height, 4000)

if __name__ == '__main__': unittest.main()
