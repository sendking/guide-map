#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const TILE_SIZE_DEFAULT = 512;
const EARTH_RADIUS = 6378245.0;
const EE = 0.00669342162296594323;

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.config || !args.out) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const config = readJson(args.config);
  const viewport = normalizeViewport(config.viewport || config);
  const bounds = viewportToBounds(viewport);
  const timeoutSeconds = Number(config.osm?.timeoutSeconds || 90);
  const query = buildOverpassQuery(bounds, timeoutSeconds, config.osm?.filters || {});

  ensureDir(path.dirname(args.out));

  console.log(
    `Fetching OSM data for bbox south=${bounds.south}, west=${bounds.west}, north=${bounds.north}, east=${bounds.east}`
  );

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "user-agent": "guide-map-handdrawn-workflow/0.1"
    },
    body: new URLSearchParams({ data: query })
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
  }

  const osm = await response.json();
  const geojson = osmToGeoJson(osm, {
    name: config.name || "osm-export",
    bounds,
    viewport
  });

  fs.writeFileSync(args.out, `${JSON.stringify(geojson, null, 2)}\n`, "utf8");
  console.log(`Wrote ${geojson.features.length} features to ${args.out}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = value;
        i += 1;
      }
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/fetch-osm-geojson.js --config config/xixi-wetland.viewport.json --out data/xixi-wetland.osm.geojson
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  if (!dirPath || dirPath === ".") return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeViewport(viewport) {
  return {
    width: positiveNumber(viewport.width, "viewport.width"),
    height: positiveNumber(viewport.height, "viewport.height"),
    devicePixelRatio: Number(viewport.devicePixelRatio || 1),
    center: normalizeLngLat(viewport.center, "viewport.center"),
    zoom: finiteNumber(viewport.zoom, "viewport.zoom"),
    tileSize: finiteNumber(viewport.tileSize || TILE_SIZE_DEFAULT, "viewport.tileSize"),
    coordinateSystem: normalizeCoordinateSystem(viewport.coordinateSystem || "WGS84"),
    bounds: viewport.bounds || null
  };
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be positive`);
  return Math.round(number);
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return number;
}

function normalizeLngLat(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${label} must be [lng, lat]`);
  }
  return [finiteNumber(value[0], `${label}[0]`), finiteNumber(value[1], `${label}[1]`)];
}

function normalizeCoordinateSystem(value) {
  const normalized = String(value || "WGS84").toUpperCase();
  if (!["WGS84", "GCJ02", "BD09"].includes(normalized)) {
    throw new Error(`Unsupported coordinate system: ${value}`);
  }
  return normalized;
}

function viewportToBounds(viewport) {
  if (viewport.bounds) {
    return normalizeBounds(viewport.bounds, viewport.coordinateSystem, "WGS84");
  }

  const centerWgs84 = convertCoordinate(viewport.center, viewport.coordinateSystem, "WGS84");
  const worldSize = viewport.tileSize * 2 ** viewport.zoom;
  const centerWorld = lngLatToWorld(centerWgs84, worldSize);
  const nwWorld = [
    centerWorld[0] - viewport.width / 2,
    centerWorld[1] - viewport.height / 2
  ];
  const seWorld = [
    centerWorld[0] + viewport.width / 2,
    centerWorld[1] + viewport.height / 2
  ];
  const nw = worldToLngLat(nwWorld, worldSize);
  const se = worldToLngLat(seWorld, worldSize);

  return {
    west: roundCoord(nw[0]),
    south: roundCoord(se[1]),
    east: roundCoord(se[0]),
    north: roundCoord(nw[1])
  };
}

function normalizeBounds(bounds, fromCoordinateSystem, toCoordinateSystem) {
  const southwest = normalizeBoundsCorner(
    bounds.southwest || bounds.southWest || bounds.sw,
    "viewport.bounds.southwest"
  );
  const northeast = normalizeBoundsCorner(
    bounds.northeast || bounds.northEast || bounds.ne,
    "viewport.bounds.northeast"
  );
  const sw = convertCoordinate(southwest, fromCoordinateSystem, toCoordinateSystem);
  const ne = convertCoordinate(northeast, fromCoordinateSystem, toCoordinateSystem);

  return {
    west: roundCoord(Math.min(sw[0], ne[0])),
    south: roundCoord(Math.min(sw[1], ne[1])),
    east: roundCoord(Math.max(sw[0], ne[0])),
    north: roundCoord(Math.max(sw[1], ne[1]))
  };
}

function normalizeBoundsCorner(corner, label) {
  if (Array.isArray(corner)) {
    return normalizeLngLat(corner, label);
  }
  if (corner && typeof corner === "object") {
    return normalizeLngLat(
      [
        corner.longitude ?? corner.lng ?? corner.lon,
        corner.latitude ?? corner.lat
      ],
      label
    );
  }
  throw new Error(`${label} must be [lng, lat] or { longitude, latitude }`);
}

function lngLatToWorld([lng, lat], worldSize) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = ((lng + 180) / 360) * worldSize;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return [x, y];
}

function worldToLngLat([x, y], worldSize) {
  const lng = (x / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lng, lat];
}

function roundCoord(value) {
  return Number(value.toFixed(8));
}

function buildOverpassQuery(bounds, timeoutSeconds, filters) {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const selectors = [];

  if (filters.includeRoads !== false) {
    selectors.push(`way["highway"](${bbox});`);
  }
  if (filters.includeWater !== false) {
    selectors.push(`way["natural"="water"](${bbox});`);
    selectors.push(`relation["natural"="water"](${bbox});`);
    selectors.push(`way["waterway"](${bbox});`);
    selectors.push(`relation["waterway"](${bbox});`);
  }
  if (filters.includeGreen !== false) {
    selectors.push(`way["leisure"~"park|garden|nature_reserve"](${bbox});`);
    selectors.push(`relation["leisure"~"park|garden|nature_reserve"](${bbox});`);
    selectors.push(`way["landuse"~"grass|forest|meadow|recreation_ground"](${bbox});`);
    selectors.push(`relation["landuse"~"grass|forest|meadow|recreation_ground"](${bbox});`);
    selectors.push(`way["natural"~"wood|wetland|grassland"](${bbox});`);
    selectors.push(`relation["natural"~"wood|wetland|grassland"](${bbox});`);
  }
  if (filters.includeBuildings !== false) {
    selectors.push(`way["building"](${bbox});`);
  }
  if (filters.includePoi !== false) {
    selectors.push(`node["tourism"](${bbox});`);
    selectors.push(`node["amenity"](${bbox});`);
    selectors.push(`node["leisure"](${bbox});`);
    selectors.push(`node["historic"](${bbox});`);
  }

  return `[out:json][timeout:${timeoutSeconds}];
(
  ${selectors.join("\n  ")}
);
out body;
>;
out skel qt;`;
}

function osmToGeoJson(osm, metadata) {
  const nodes = new Map();
  const ways = new Map();
  const relations = [];

  for (const element of osm.elements || []) {
    if (element.type === "node") {
      nodes.set(element.id, element);
    } else if (element.type === "way") {
      ways.set(element.id, element);
    } else if (element.type === "relation") {
      relations.push(element);
    }
  }

  const features = [];
  for (const way of ways.values()) {
    const feature = wayToFeature(way, nodes);
    if (feature) features.push(feature);
  }

  for (const relation of relations) {
    const feature = relationToFeature(relation, ways, nodes);
    if (feature) features.push(feature);
  }

  for (const node of nodes.values()) {
    if (!hasPoiTags(node.tags)) continue;
    features.push(nodeToPoiFeature(node));
  }

  return {
    type: "FeatureCollection",
    name: metadata.name,
    metadata: {
      source: "openstreetmap-overpass",
      generatedAt: new Date().toISOString(),
      bounds: metadata.bounds,
      viewport: metadata.viewport
    },
    features: dedupeFeatures(features).sort(compareFeatures)
  };
}

function wayToFeature(way, nodes) {
  if (!way.tags) return null;
  const coords = nodeRefsToCoordinates(way.nodes || [], nodes);
  if (coords.length < 2) return null;

  const kind = classifyTags(way.tags);
  if (!kind) return null;

  const isClosed = coords.length > 3 && sameCoordinate(coords[0], coords[coords.length - 1]);
  const polygonKind = ["water", "park", "building"].includes(kind);
  const geometry =
    polygonKind && isClosed
      ? { type: "Polygon", coordinates: [coords] }
      : { type: "LineString", coordinates: coords };

  return {
    type: "Feature",
    id: `way/${way.id}`,
    properties: propertiesFromTags(way.tags, kind, `way/${way.id}`),
    geometry
  };
}

function relationToFeature(relation, ways, nodes) {
  if (!relation.tags || relation.tags.type !== "multipolygon") return null;
  const kind = classifyTags(relation.tags);
  if (!["water", "park", "building"].includes(kind)) return null;

  const outerRings = [];
  const innerRings = [];

  for (const member of relation.members || []) {
    if (member.type !== "way") continue;
    const way = ways.get(member.ref);
    if (!way) continue;
    const coords = nodeRefsToCoordinates(way.nodes || [], nodes);
    if (coords.length < 4) continue;
    if (member.role === "inner") {
      innerRings.push(coords);
    } else {
      outerRings.push(coords);
    }
  }

  if (outerRings.length === 0) return null;

  return {
    type: "Feature",
    id: `relation/${relation.id}`,
    properties: propertiesFromTags(relation.tags, kind, `relation/${relation.id}`),
    geometry: {
      type: "MultiPolygon",
      coordinates: outerRings.map((outer) => [
        closeRing(outer),
        ...innerRings.map(closeRing)
      ])
    }
  };
}

function nodeRefsToCoordinates(refs, nodes) {
  return refs
    .map((ref) => nodes.get(ref))
    .filter(Boolean)
    .map((node) => [node.lon, node.lat]);
}

function nodeToPoiFeature(node) {
  return {
    type: "Feature",
    id: `node/${node.id}`,
    properties: propertiesFromTags(node.tags || {}, "poi", `node/${node.id}`),
    geometry: {
      type: "Point",
      coordinates: [node.lon, node.lat]
    }
  };
}

function classifyTags(tags = {}) {
  if (tags.natural === "water" || tags.waterway) return "water";
  if (tags.building) return "building";
  if (
    ["park", "garden", "nature_reserve"].includes(tags.leisure) ||
    ["grass", "forest", "meadow", "recreation_ground"].includes(tags.landuse) ||
    ["wood", "wetland", "grassland"].includes(tags.natural)
  ) {
    return "park";
  }
  if (tags.highway) {
    if (["footway", "path", "steps", "pedestrian", "track"].includes(tags.highway)) {
      return "path";
    }
    return "road";
  }
  if (hasPoiTags(tags)) return "poi";
  return null;
}

function hasPoiTags(tags = {}) {
  return Boolean(tags.tourism || tags.amenity || tags.leisure || tags.historic);
}

function propertiesFromTags(tags, kind, fallbackId) {
  return {
    kind,
    name: tags.name || tags["name:zh"] || tags["name:en"] || "",
    osmId: fallbackId,
    osmTags: tags
  };
}

function sameCoordinate(a, b) {
  return a && b && a[0] === b[0] && a[1] === b[1];
}

function closeRing(coords) {
  if (coords.length === 0 || sameCoordinate(coords[0], coords[coords.length - 1])) {
    return coords;
  }
  return [...coords, coords[0]];
}

function dedupeFeatures(features) {
  const seen = new Set();
  const deduped = [];
  for (const feature of features) {
    const key = feature.id || JSON.stringify(feature.geometry);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(feature);
  }
  return deduped;
}

function compareFeatures(a, b) {
  const order = {
    water: 10,
    park: 20,
    building: 30,
    path: 40,
    road: 50,
    poi: 90
  };
  return (order[a.properties?.kind] || 999) - (order[b.properties?.kind] || 999);
}

function convertCoordinate(lngLat, from, to) {
  if (from === to) return lngLat;

  if (from === "WGS84" && to === "GCJ02") return wgs84ToGcj02(lngLat);
  if (from === "GCJ02" && to === "WGS84") return gcj02ToWgs84(lngLat);
  if (from === "GCJ02" && to === "BD09") return gcj02ToBd09(lngLat);
  if (from === "BD09" && to === "GCJ02") return bd09ToGcj02(lngLat);
  if (from === "WGS84" && to === "BD09") return gcj02ToBd09(wgs84ToGcj02(lngLat));
  if (from === "BD09" && to === "WGS84") return gcj02ToWgs84(bd09ToGcj02(lngLat));

  throw new Error(`Unsupported coordinate transform: ${from} -> ${to}`);
}

function outOfChina([lng, lat]) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function wgs84ToGcj02(lngLat) {
  const [lng, lat] = lngLat;
  if (outOfChina(lngLat)) return lngLat;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((EARTH_RADIUS * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((EARTH_RADIUS / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}

function gcj02ToWgs84(lngLat) {
  if (outOfChina(lngLat)) return lngLat;
  const [gcjLng, gcjLat] = wgs84ToGcj02(lngLat);
  return [lngLat[0] * 2 - gcjLng, lngLat[1] * 2 - gcjLat];
}

function gcj02ToBd09([lng, lat]) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin((lat * Math.PI * 3000.0) / 180.0);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos((lng * Math.PI * 3000.0) / 180.0);
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006];
}

function bd09ToGcj02([lng, lat]) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin((y * Math.PI * 3000.0) / 180.0);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos((x * Math.PI * 3000.0) / 180.0);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}
