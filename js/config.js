/*
 * Optional deployment configuration.
 *
 * Keep this as "data" when the site and data are deployed together.
 * For GitHub Pages deployments near the artifact size limit, host data
 * elsewhere and set this to the external base URL, for example:
 *
 *   window.EOSIAL_DATA_URL = 'https://example.com/eosial-data';
 */
window.EOSIAL_DATA_URL = window.EOSIAL_DATA_URL || 'data';

// Optional static host containing terrain tiles and tiles.json.
// The default follows EOSIAL_DATA_URL + '/terrain/glo90'.
// window.EOSIAL_TERRAIN_URL = 'https://example.com/terrain/glo90';
