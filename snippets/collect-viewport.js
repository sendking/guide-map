/**
 * Browser console helpers for collecting the exact viewport used by a screenshot.
 *
 * Use this at the same moment you take the map screenshot. The returned object
 * can be copied into config/*.viewport.json under the "viewport" key.
 */

export function collectMapLibreViewport(map, options = {}) {
  const center = map.getCenter();
  const canvas = map.getCanvas();
  const dpr = options.devicePixelRatio || window.devicePixelRatio || 1;

  return {
    width: Math.round((options.width || canvas.clientWidth) * dpr),
    height: Math.round((options.height || canvas.clientHeight) * dpr),
    devicePixelRatio: dpr,
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    tileSize: 512,
    coordinateSystem: options.coordinateSystem || "WGS84",
    bearing: map.getBearing(),
    pitch: map.getPitch()
  };
}

export function collectLeafletViewport(map, options = {}) {
  const center = map.getCenter();
  const size = map.getSize();
  const dpr = options.devicePixelRatio || window.devicePixelRatio || 1;

  return {
    width: Math.round((options.width || size.x) * dpr),
    height: Math.round((options.height || size.y) * dpr),
    devicePixelRatio: dpr,
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    tileSize: 256,
    coordinateSystem: options.coordinateSystem || "WGS84",
    bearing: 0,
    pitch: 0
  };
}

export function collectAMapViewport(map, options = {}) {
  const center = map.getCenter();
  const container = map.getContainer();
  const rect = container.getBoundingClientRect();
  const dpr = options.devicePixelRatio || window.devicePixelRatio || 1;
  const rotation = typeof map.getRotation === "function" ? map.getRotation() : 0;
  const pitch = typeof map.getPitch === "function" ? map.getPitch() : 0;

  return {
    width: Math.round((options.width || rect.width) * dpr),
    height: Math.round((options.height || rect.height) * dpr),
    devicePixelRatio: dpr,
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    tileSize: 256,
    coordinateSystem: options.coordinateSystem || "GCJ02",
    bearing: rotation,
    pitch
  };
}

export function collectBMapViewport(map, options = {}) {
  const center = map.getCenter();
  const container = map.getContainer();
  const rect = container.getBoundingClientRect();
  const dpr = options.devicePixelRatio || window.devicePixelRatio || 1;

  return {
    width: Math.round((options.width || rect.width) * dpr),
    height: Math.round((options.height || rect.height) * dpr),
    devicePixelRatio: dpr,
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    tileSize: 256,
    coordinateSystem: options.coordinateSystem || "BD09",
    bearing: 0,
    pitch: 0
  };
}
