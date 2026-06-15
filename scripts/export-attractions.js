#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const EARTH_RADIUS = 6378245.0;
const EE = 0.00669342162296594323;

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.in || !args.spec || !args.out) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const inputPath = args.in;
  const specPath = args.spec;
  const outputPath = args.out;
  const sourceCoordinateSystem = normalizeCoordinateSystem(args.sourceCoordinateSystem || "WGS84");
  const targetCoordinateSystem = normalizeCoordinateSystem(args.targetCoordinateSystem || "GCJ02");

  const geojson = readJson(inputPath);
  const spec = normalizeSpec(readJson(specPath), specPath);
  const featuresByName = groupFeaturesByName(geojson.features || []);
  const exportBoundary = buildExportBoundary(spec.exportBoundary, featuresByName, sourceCoordinateSystem);
  const attractions = [];
  const missingNames = [];
  const skippedOutsideBoundary = [];

  for (const item of spec.attractions) {
    const features = findMatchingFeatures(item, featuresByName);
    const manualCoordinate = normalizeOptionalCoordinate(item.coordinate, item.name);

    if (features.length === 0 && !manualCoordinate) {
      missingNames.push(item.name);
      continue;
    }

    const sourceCoordinate = manualCoordinate
      ? convertCoordinate(
          manualCoordinate,
          normalizeCoordinateSystem(item.coordinateSystem || spec.coordinateSystem || targetCoordinateSystem),
          sourceCoordinateSystem
        )
      : representativeCoordinate(features);

    const boundaryMatch = matchExportBoundary(sourceCoordinate, exportBoundary);
    if (exportBoundary.enabled && !boundaryMatch.inside && item.enforceBoundary !== false) {
      skippedOutsideBoundary.push(item.name);
      continue;
    }

    const coordinate = convertCoordinate(sourceCoordinate, sourceCoordinateSystem, targetCoordinateSystem);
    const sourceFeatureIds = features.map((feature) => feature.id).filter(Boolean);
    const sourceKinds = [...new Set(features.map((feature) => feature.properties?.kind).filter(Boolean))];
    const matchedNames = [...new Set(features.map((feature) => feature.properties?.name).filter(Boolean))];

    attractions.push({
      id: item.id || `${spec.idPrefix}-${String(attractions.length + 1).padStart(2, "0")}`,
      name: item.name,
      type: item.type || spec.defaultType,
      category: item.category || spec.defaultCategory,
      priority: item.priority ?? spec.defaultPriority,
      coordinate: roundCoordinate(coordinate),
      sourceCoordinate: roundCoordinate(sourceCoordinate),
      sourceFeatureIds,
      sourceKinds,
      matchedNames,
      boundaryMatch: boundaryMatch.inside ? boundaryMatch.name : null,
      pointMethod: manualCoordinate ? "manual-coordinate" : item.pointMethod || spec.pointMethod
    });
  }

  ensureDir(path.dirname(outputPath));

  const output = {
    name: spec.name,
    generatedAt: new Date().toISOString(),
    coordinateSystem: targetCoordinateSystem,
    sourceCoordinateSystem,
    source: {
      file: inputPath,
      spec: specPath,
      featureCollectionName: geojson.name || "geojson-export",
      method: "curated-spec-named-features-to-points"
    },
    exportBoundary: exportBoundary.output,
    stats: {
      candidateNames: spec.attractions.length,
      exportedAttractions: attractions.length,
      missingNames: missingNames.length,
      skippedOutsideBoundary: skippedOutsideBoundary.length
    },
    missingNames,
    skippedOutsideBoundary,
    attractions
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Exported ${attractions.length} attractions to ${outputPath}`);
  if (missingNames.length > 0) {
    console.log(`Missing ${missingNames.length} names: ${missingNames.join(", ")}`);
  }
  if (skippedOutsideBoundary.length > 0) {
    console.log(`Skipped ${skippedOutsideBoundary.length} outside boundary: ${skippedOutsideBoundary.join(", ")}`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/export-attractions.js \\
    --in data/xixi-wetland.osm.geojson \\
    --spec data/attractions/xixi-attractions.spec.json \\
    --out data/attractions/xixi-attractions.json \\
    --sourceCoordinateSystem WGS84 \\
    --targetCoordinateSystem GCJ02
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  if (!dirPath || dirPath === ".") return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeSpec(spec, specPath) {
  if (!Array.isArray(spec.attractions)) {
    throw new Error(`${specPath} must contain an attractions array`);
  }

  return {
    name: spec.name || path.basename(specPath, path.extname(specPath)),
    idPrefix: spec.idPrefix || "attraction",
    defaultType: spec.defaultType || "generic",
    defaultCategory: spec.defaultCategory || "scenic",
    defaultPriority: spec.defaultPriority ?? 2,
    pointMethod: spec.pointMethod || "bbox-center",
    coordinateSystem: spec.coordinateSystem,
    exportBoundary: spec.exportBoundary || null,
    attractions: spec.attractions.map((item, index) => {
      if (!item?.name) {
        throw new Error(`${specPath} attractions[${index}] must include name`);
      }
      return item;
    })
  };
}

function groupFeaturesByName(features) {
  const groups = new Map();
  for (const feature of features) {
    const name = feature?.properties?.name?.trim();
    if (!name) continue;
    const bucket = groups.get(name) || [];
    bucket.push(feature);
    groups.set(name, bucket);
  }
  return groups;
}

function findMatchingFeatures(item, featuresByName) {
  const names = [item.name, ...(item.aliases || [])].filter(Boolean);
  const features = [];
  const seen = new Set();

  for (const name of names) {
    for (const feature of featuresByName.get(name) || []) {
      const key = feature.id || JSON.stringify(feature.geometry);
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(feature);
    }
  }

  return features;
}

function representativeCoordinate(features) {
  const coordinates = features.flatMap((feature) => extractCoordinates(feature.geometry));
  if (coordinates.length === 0) {
    throw new Error("Cannot derive attraction point from empty geometry");
  }

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }

  return [(west + east) / 2, (south + north) / 2];
}

function buildExportBoundary(config, featuresByName, sourceCoordinateSystem) {
  if (!config) {
    return { enabled: false, matchers: [], output: null };
  }

  const matchers = [];

  for (const rawName of config.featureNames || []) {
    const name = String(rawName).trim();
    const features = featuresByName.get(name) || [];
    for (const feature of features) {
      if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) continue;
      matchers.push({
        type: "feature",
        name,
        featureId: feature.id,
        geometry: feature.geometry
      });
    }
  }

  for (const bounds of config.bounds || []) {
    const normalizedBounds = normalizeBoundaryBounds(bounds, sourceCoordinateSystem);
    matchers.push({
      type: "bounds",
      name: bounds.name || "bounds",
      bounds: normalizedBounds
    });
  }

  return {
    enabled: matchers.length > 0,
    matchers,
    output: {
      mode: "any",
      featureNames: config.featureNames || [],
      bounds: (config.bounds || []).map((bounds) => ({
        name: bounds.name || "bounds",
        coordinateSystem: normalizeCoordinateSystem(bounds.coordinateSystem || sourceCoordinateSystem),
        southwest: normalizeBoundsCorner(bounds.southwest || bounds.southWest || bounds.sw, `${bounds.name || "bounds"}.southwest`),
        northeast: normalizeBoundsCorner(bounds.northeast || bounds.northEast || bounds.ne, `${bounds.name || "bounds"}.northeast`)
      })),
      matchers: matchers.map((matcher) => ({
        type: matcher.type,
        name: matcher.name,
        featureId: matcher.featureId
      }))
    }
  };
}

function matchExportBoundary(point, exportBoundary) {
  if (!exportBoundary.enabled) return { inside: true, name: null };

  for (const matcher of exportBoundary.matchers) {
    if (matcher.type === "feature" && pointInGeometry(point, matcher.geometry)) {
      return { inside: true, name: matcher.name };
    }
    if (matcher.type === "bounds" && pointInBounds(point, matcher.bounds)) {
      return { inside: true, name: matcher.name };
    }
  }

  return { inside: false, name: null };
}

function normalizeBoundaryBounds(bounds, sourceCoordinateSystem) {
  const fromCoordinateSystem = normalizeCoordinateSystem(bounds.coordinateSystem || sourceCoordinateSystem);
  const southwest = normalizeBoundsCorner(bounds.southwest || bounds.southWest || bounds.sw, `${bounds.name || "bounds"}.southwest`);
  const northeast = normalizeBoundsCorner(bounds.northeast || bounds.northEast || bounds.ne, `${bounds.name || "bounds"}.northeast`);
  const sw = convertCoordinate(southwest, fromCoordinateSystem, sourceCoordinateSystem);
  const ne = convertCoordinate(northeast, fromCoordinateSystem, sourceCoordinateSystem);

  return {
    west: Math.min(sw[0], ne[0]),
    south: Math.min(sw[1], ne[1]),
    east: Math.max(sw[0], ne[0]),
    north: Math.max(sw[1], ne[1])
  };
}

function normalizeBoundsCorner(corner, label) {
  if (Array.isArray(corner)) {
    return normalizeRequiredCoordinate(corner, label);
  }
  if (corner && typeof corner === "object") {
    return normalizeRequiredCoordinate(
      [
        corner.longitude ?? corner.lng ?? corner.lon,
        corner.latitude ?? corner.lat
      ],
      label
    );
  }
  throw new Error(`${label} must be [lng, lat] or { longitude, latitude }`);
}

function normalizeRequiredCoordinate(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${label} must be [lng, lat]`);
  }
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`${label} must contain finite numbers`);
  }
  return [lng, lat];
}

function pointInBounds([lng, lat], bounds) {
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function pointInGeometry(point, geometry) {
  if (geometry.type === "Polygon") {
    return pointInPolygon(point, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }
  return false;
}

function pointInPolygon(point, rings) {
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((ring) => pointInRing(point, ring));
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function extractCoordinates(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat();
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2);
  }

  return [];
}

function normalizeOptionalCoordinate(value, name) {
  if (!value) return null;
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${name}.coordinate must be [lng, lat]`);
  }

  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`${name}.coordinate must contain finite numbers`);
  }
  return [lng, lat];
}

function roundCoordinate([lng, lat]) {
  return [roundCoord(lng), roundCoord(lat)];
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function normalizeCoordinateSystem(value) {
  const normalized = String(value || "WGS84").toUpperCase();
  if (!["WGS84", "GCJ02", "BD09"].includes(normalized)) {
    throw new Error(`Unsupported coordinate system: ${value}`);
  }
  return normalized;
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
