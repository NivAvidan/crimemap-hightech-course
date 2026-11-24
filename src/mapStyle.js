// Dark "tactical" basemap built on OpenFreeMap vector tiles (OpenStreetMap data, no API key).
const NAME = ['coalesce', ['get', 'name:he'], ['get', 'name']];
const FONT = ['Noto Sans Regular'];
const FONT_B = ['Noto Sans Bold'];

// real-world width (meters) -> pixels, exponential with zoom (lat ~31.5)
const meters = (m) => ['interpolate', ['exponential', 2], ['zoom'], 8, Math.max(0.4, (m / 0.5) * Math.pow(2, 8 - 17) * 6), 13, Math.max(0.6, (m / 0.5) * Math.pow(2, 13 - 17) * 1.6), 17, m / 0.5, 22, (m / 0.5) * 32];

export const ROAD_WIDTH = { motorway: 16, trunk: 14, primary: 12, secondary: 10, tertiary: 8, minor: 6, service: 3.5, track: 3, path: 1.6, pedestrian: 4 };
const roadFilter = (classes) => ['all', ['match', ['get', 'class'], classes, true, false], ['!=', ['get', 'brunnel'], 'tunnel']];

function roadLayers() {
  const groups = [
    ['path', ['path', 'pedestrian', 'track'], 2, 14, '#22344a', '#5d7391'],
    ['service', ['service'], 3.5, 14, '#16263a', '#34465d'],
    ['minor', ['minor'], 6, 12, '#16263a', '#3a4d66'],
    ['tertiary', ['tertiary'], 8, 10, '#16263a', '#41566f'],
    ['secondary', ['secondary'], 10, 9, '#16263a', '#485f7b'],
    ['primary', ['primary'], 12, 7, '#16263a', '#506988'],
    ['trunk', ['trunk'], 14, 6, '#1a2c42', '#4d6788'],
    ['motorway', ['motorway'], 16, 5, '#1a2c42', '#587499'],
  ];
  const out = [];
  // casing = pavement / sidewalk strip
  for (const [id, cls, w, minzoom, casing] of groups) {
    if (id === 'path') continue;
    out.push({ id: `road-${id}-case`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: Math.max(minzoom, 13), filter: roadFilter(cls),
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8496ad', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15.5, 0.6], 'line-width': meters(w + 5) } });
  }
  for (const [id, cls, w, minzoom, , fill] of groups) {
    out.push({ id: `road-${id}`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom, filter: roadFilter(cls),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': fill, 'line-width': meters(w), ...(id === 'path' ? { 'line-dasharray': [2, 1.5] } : {}) } });
  }
  // lane markings at street level
  out.push({ id: 'road-marking', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 16, filter: roadFilter(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']),
    paint: { 'line-color': '#e8eef7', 'line-opacity': 0.55, 'line-width': meters(0.25), 'line-dasharray': [10, 14] } });
  out.push({ id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10, filter: ['==', ['get', 'class'], 'rail'],
    paint: { 'line-color': '#5b6f8a', 'line-width': 1.2, 'line-dasharray': [4, 3] } });
  return out;
}

export function buildStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© <a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | גבולות: הלמ"ס' },
    },
    sky: { 'sky-color': '#0a1c36', 'horizon-color': '#1d4b6b', 'fog-color': '#0b2038', 'fog-ground-blend': 0.6, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.8, 'atmosphere-blend': 0.6 },
    light: { anchor: 'viewport', color: '#dbeaff', intensity: 0.45, position: [1.3, 215, 38] },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b1727' } },
      { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: { 'fill-color': ['match', ['get', 'class'], ['wood', 'grass', 'farmland'], '#0e2a2b', 'sand', '#1c2330', '#0d1c2c'], 'fill-opacity': 0.7 } },
      { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 9, paint: { 'fill-color': ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], '#101f33', ['industrial', 'commercial', 'retail'], '#141f31', ['school', 'university', 'hospital'], '#15233a', '#0f1c2e'], 'fill-opacity': 0.8 } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#0f3330', 'fill-opacity': 0.6 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#041c33' } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 10, paint: { 'line-color': '#0a3558', 'line-width': 1.2 } },
      { id: 'aeroway', type: 'fill', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#1b2a40' } },
      ...roadLayers(),
      { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['<=', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': '#4f6b8d', 'line-width': 1, 'line-dasharray': [3, 2] } },
      // --- 3D buildings (OSM heights where available)
      { id: 'bld-flat', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 12.5, maxzoom: 14, paint: { 'fill-color': '#24384f', 'fill-opacity': 0.7 } },
      { id: 'bld-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13.5,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#3a4d66', 15, '#4a6282', 40, '#5f7fa6', 100, '#86aede', 200, '#b5d6ff'],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, ['coalesce', ['get', 'render_height'], 6]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
        } },
      // --- labels
      { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
        layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 13] },
        paint: { 'text-color': '#9db2cc', 'text-halo-color': '#06121f', 'text-halo-width': 1.4 } },
      { id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 10, filter: ['match', ['get', 'class'], ['village', 'suburb', 'neighbourhood', 'quarter', 'hamlet'], true, false],
        layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 11.5, 'text-max-width': 8 },
        paint: { 'text-color': '#a9bdd6', 'text-halo-color': '#06121f', 'text-halo-width': 1.4 } },
      { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 8, filter: ['==', ['get', 'class'], 'town'],
        layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10.5, 14, 15] },
        paint: { 'text-color': '#d3e4fe', 'text-halo-color': '#06121f', 'text-halo-width': 1.5 } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 5, filter: ['==', ['get', 'class'], 'city'],
        layout: { 'text-field': NAME, 'text-font': FONT_B, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 18], 'symbol-sort-key': ['coalesce', ['get', 'rank'], 10] },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#06121f', 'text-halo-width': 1.8 } },
      { id: 'place-country', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 7, filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': NAME, 'text-font': FONT_B, 'text-size': 13, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1 },
        paint: { 'text-color': '#7f95b3', 'text-halo-color': '#06121f', 'text-halo-width': 1.5 } },
    ],
  };
}

export const HEAT_STOPS = [[0.0, '#1de9ff'], [0.25, '#34d399'], [0.5, '#ffd600'], [0.75, '#ff9100'], [1, '#ff1744']];
export const NODATA_COLOR = '#3b4658';
export const ZERO_COLOR = '#12394a';
