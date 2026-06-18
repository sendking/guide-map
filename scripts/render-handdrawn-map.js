#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TILE_SIZE_DEFAULT = 512;
const EARTH_RADIUS = 6378245.0;
const EE = 0.00669342162296594323;

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.config || !args.data || !args.style) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const config = readJson(args.config);
  const geojson = readJson(args.data);
  const style = readJson(args.style);
  const viewport = normalizeViewport(config.viewport || config);
  const dataCoordinateSystem = normalizeCoordinateSystem(
    config.data?.coordinateSystem || viewport.coordinateSystem
  );
  const outputSvg = args.out || config.output?.svg || "output/handdrawn-map.svg";
  const outputManifest =
    args.manifest || config.output?.manifest || "output/overlay-manifest.json";
  const seed = String(config.render?.seed || config.name || "guide-map");

  if (viewport.bearing !== 0 || viewport.pitch !== 0) {
    console.warn(
      "[warn] Current MVP renders north-up, flat maps only. bearing/pitch were ignored. Use the native map camera matrix for rotated/tilted screenshots."
    );
  }

  ensureDir(path.dirname(outputSvg));
  ensureDir(path.dirname(outputManifest));

  const projection = createProjection(viewport);
  const renderStats = {
    featuresRead: geojson.features?.length || 0,
    featuresRendered: 0,
    featuresSkipped: 0,
    unsupportedGeometries: []
  };

  const sortedLayers = [...(style.layers || [])].sort(
    (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
  );
  const elementsByLayer = new Map(sortedLayers.map((layer) => [layer.id, []]));
  const fallbackElements = [];
  const clipBoundary = createClipBoundary({
    config,
    geojson,
    viewport,
    projection,
    dataCoordinateSystem
  });

  for (const feature of geojson.features || []) {
    if (!feature?.geometry) {
      renderStats.featuresSkipped += 1;
      continue;
    }

    const layer = findLayer(sortedLayers, feature);
    const target = layer ? elementsByLayer.get(layer.id) : fallbackElements;
    const featureElements = renderFeature({
      feature,
      layer: layer || style.defaultLayer || {},
      viewport,
      projection,
      dataCoordinateSystem,
      seed,
      featureIndex: renderStats.featuresRendered
    });

    if (featureElements.length === 0) {
      renderStats.featuresSkipped += 1;
      if (!renderStats.unsupportedGeometries.includes(feature.geometry.type)) {
        renderStats.unsupportedGeometries.push(feature.geometry.type);
      }
      continue;
    }

    target.push(...featureElements);
    renderStats.featuresRendered += 1;
  }

  const svg = buildSvg({
    width: viewport.width,
    height: viewport.height,
    style,
    config,
    clipBoundary,
    layerElements: [
      ...fallbackElements,
      ...sortedLayers.flatMap((layer) => elementsByLayer.get(layer.id) || [])
    ]
  });

  fs.writeFileSync(outputSvg, svg, "utf8");

  const bounds = screenBoundsToLngLatBounds(projection, viewport);
  const manifest = {
    name: config.name || "handdrawn-map",
    createdAt: new Date().toISOString(),
    files: {
      svg: outputSvg
    },
    viewport: {
      width: viewport.width,
      height: viewport.height,
      devicePixelRatio: viewport.devicePixelRatio,
      center: viewport.center,
      zoom: viewport.zoom,
      tileSize: viewport.tileSize,
      coordinateSystem: viewport.coordinateSystem,
      bearing: viewport.bearing,
      pitch: viewport.pitch,
      bounds: viewport.bounds
        ? {
            southwest: {
              longitude: roundCoord(viewport.bounds.west),
              latitude: roundCoord(viewport.bounds.south)
            },
            northeast: {
              longitude: roundCoord(viewport.bounds.east),
              latitude: roundCoord(viewport.bounds.north)
            }
          }
        : undefined
    },
    data: {
      coordinateSystem: dataCoordinateSystem
    },
    overlay: {
      type: "image",
      boundsCoordinateSystem: viewport.coordinateSystem,
      bounds,
      leafletBounds: [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east]
      ],
      opacity: 1
    },
    render: {
      geometryMode: config.render?.geometryMode || "exact-with-sketch",
      seed
    },
    stats: renderStats
  };

  fs.writeFileSync(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Rendered ${renderStats.featuresRendered}/${renderStats.featuresRead} features`);
  console.log(`SVG: ${outputSvg}`);
  console.log(`Manifest: ${outputManifest}`);
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
  node scripts/render-handdrawn-map.js --config config/viewport.example.json --data data/example-map.geojson --style styles/handdrawn.example.json

Options:
  --out <path>       Override SVG output path
  --manifest <path>  Override manifest output path
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
  const normalized = {
    width: positiveNumber(viewport.width, "viewport.width"),
    height: positiveNumber(viewport.height, "viewport.height"),
    devicePixelRatio: Number(viewport.devicePixelRatio || 1),
    center: viewport.center ? normalizeLngLat(viewport.center, "viewport.center") : null,
    zoom: viewport.zoom === undefined ? null : Number(viewport.zoom),
    tileSize: Number(viewport.tileSize || TILE_SIZE_DEFAULT),
    coordinateSystem: normalizeCoordinateSystem(viewport.coordinateSystem || "WGS84"),
    bearing: Number(viewport.bearing || 0),
    pitch: Number(viewport.pitch || 0),
    bounds: viewport.bounds
      ? normalizeBounds(viewport.bounds, viewport.coordinateSystem || "WGS84")
      : null
  };

  if (!normalized.bounds && !normalized.center) {
    throw new Error("viewport.center is required when viewport.bounds is not provided");
  }
  if (!normalized.bounds && !Number.isFinite(normalized.zoom)) {
    throw new Error("viewport.zoom must be a finite number");
  }
  if (!Number.isFinite(normalized.devicePixelRatio) || normalized.devicePixelRatio <= 0) {
    throw new Error("viewport.devicePixelRatio must be a positive number");
  }
  if (!Number.isFinite(normalized.tileSize) || normalized.tileSize <= 0) {
    throw new Error("viewport.tileSize must be a positive number");
  }

  return normalized;
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.round(number);
}

function normalizeCoordinateSystem(value) {
  const normalized = String(value || "WGS84").toUpperCase();
  if (!["WGS84", "GCJ02", "BD09"].includes(normalized)) {
    throw new Error(`Unsupported coordinate system: ${value}`);
  }
  return normalized;
}

function normalizeLngLat(value, label) {
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

function createProjection(viewport) {
  if (viewport.bounds) {
    return createBoundsProjection(viewport);
  }

  const worldSize = viewport.tileSize * 2 ** viewport.zoom;
  const centerWorld = lngLatToWorld(viewport.center, worldSize);

  return {
    worldSize,
    project(lngLat) {
      const world = lngLatToWorld(lngLat, worldSize);
      return [
        world[0] - centerWorld[0] + viewport.width / 2,
        world[1] - centerWorld[1] + viewport.height / 2
      ];
    },
    unproject(point) {
      const world = [
        point[0] + centerWorld[0] - viewport.width / 2,
        point[1] + centerWorld[1] - viewport.height / 2
      ];
      return worldToLngLat(world, worldSize);
    }
  };
}

function createBoundsProjection(viewport) {
  const west = viewport.bounds.west;
  const south = viewport.bounds.south;
  const east = viewport.bounds.east;
  const north = viewport.bounds.north;
  const worldSize = viewport.tileSize * 2 ** (viewport.zoom || 16);
  const nwWorld = lngLatToWorld([west, north], worldSize);
  const seWorld = lngLatToWorld([east, south], worldSize);
  const spanX = seWorld[0] - nwWorld[0];
  const spanY = seWorld[1] - nwWorld[1];

  if (spanX === 0 || spanY === 0) {
    throw new Error("viewport.bounds must describe a non-empty area");
  }

  return {
    worldSize,
    project(lngLat) {
      const world = lngLatToWorld(lngLat, worldSize);
      return [
        ((world[0] - nwWorld[0]) / spanX) * viewport.width,
        ((world[1] - nwWorld[1]) / spanY) * viewport.height
      ];
    },
    unproject(point) {
      const world = [
        nwWorld[0] + (point[0] / viewport.width) * spanX,
        nwWorld[1] + (point[1] / viewport.height) * spanY
      ];
      return worldToLngLat(world, worldSize);
    }
  };
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

function screenBoundsToLngLatBounds(projection, viewport) {
  if (viewport.bounds) {
    return {
      west: roundCoord(viewport.bounds.west),
      south: roundCoord(viewport.bounds.south),
      east: roundCoord(viewport.bounds.east),
      north: roundCoord(viewport.bounds.north)
    };
  }

  const nw = projection.unproject([0, 0]);
  const se = projection.unproject([viewport.width, viewport.height]);
  return {
    west: roundCoord(nw[0]),
    south: roundCoord(se[1]),
    east: roundCoord(se[0]),
    north: roundCoord(nw[1])
  };
}

function normalizeBounds(bounds, coordinateSystem) {
  const southwest = normalizeBoundsCorner(
    bounds.southwest || bounds.southWest || bounds.sw,
    "viewport.bounds.southwest"
  );
  const northeast = normalizeBoundsCorner(
    bounds.northeast || bounds.northEast || bounds.ne,
    "viewport.bounds.northeast"
  );
  const normalizedCoordinateSystem = normalizeCoordinateSystem(coordinateSystem);
  const sw = convertCoordinate(southwest, normalizedCoordinateSystem, normalizedCoordinateSystem);
  const ne = convertCoordinate(northeast, normalizedCoordinateSystem, normalizedCoordinateSystem);

  return {
    west: Math.min(sw[0], ne[0]),
    south: Math.min(sw[1], ne[1]),
    east: Math.max(sw[0], ne[0]),
    north: Math.max(sw[1], ne[1])
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

function roundCoord(value) {
  return Number(value.toFixed(8));
}

function findLayer(layers, feature) {
  return layers.find((layer) => layerMatchesFeature(layer, feature));
}

function createClipBoundary({ config, geojson, viewport, projection, dataCoordinateSystem }) {
  const clipConfig = config.render?.clipBoundary;
  if (!clipConfig?.enabled) return null;

  const boundaryFeature = findBoundaryFeature(geojson.features || [], clipConfig);
  if (!boundaryFeature) {
    throw new Error(`clipBoundary feature not found for ${JSON.stringify(clipConfig.match || {})}`);
  }

  const toScreen = (lngLat) => {
    const converted = convertCoordinate(
      normalizeLngLat(lngLat, "clip boundary coordinate"),
      dataCoordinateSystem,
      viewport.coordinateSystem
    );
    return projection.project(converted);
  };
  const pathData = geometryToPolygonPath(boundaryFeature.geometry, toScreen);
  if (!pathData) {
    throw new Error("clipBoundary feature must be a Polygon or MultiPolygon");
  }

  return {
    id: escapeId(clipConfig.id || "scenic-boundary"),
    pathData,
    feature: {
      name: boundaryFeature.properties?.name,
      osmId: boundaryFeature.properties?.osmId
    },
    outsideFill: clipConfig.outsideFill ?? "none",
    boundaryStroke: clipConfig.boundaryStroke || null
  };
}

function findBoundaryFeature(features, clipConfig) {
  const match = clipConfig.match || {};
  const candidates = features.filter((feature) => {
    if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) return false;
    return Object.entries(match).every(([property, accepted]) => {
      const values = Array.isArray(accepted) ? accepted : [accepted];
      const value =
        property.startsWith("osmTags.")
          ? feature.properties?.osmTags?.[property.slice("osmTags.".length)]
          : feature.properties?.[property];
      return values.includes(value);
    });
  });

  if (candidates.length > 0) return candidates[0];

  if (clipConfig.name) {
    return features.find(
      (feature) =>
        ["Polygon", "MultiPolygon"].includes(feature.geometry?.type) &&
        feature.properties?.name === clipConfig.name
    );
  }
  return null;
}

function geometryToPolygonPath(geometry, toScreen) {
  if (geometry.type === "Polygon") {
    return polygonPath(geometry.coordinates.map((ring) => ring.map(toScreen)));
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => polygonPath(polygon.map((ring) => ring.map(toScreen))))
      .join("");
  }
  return "";
}

function layerMatchesFeature(layer, feature) {
  const geometryTypes = layer.geometry || [];
  if (geometryTypes.length > 0 && !geometryTypes.includes(feature.geometry.type)) {
    return false;
  }

  const match = layer.match || {};
  return Object.entries(match).every(([property, accepted]) => {
    const values = Array.isArray(accepted) ? accepted : [accepted];
    return values.includes(feature.properties?.[property]);
  });
}

function renderFeature({
  feature,
  layer,
  viewport,
  projection,
  dataCoordinateSystem,
  seed,
  featureIndex
}) {
  const geometry = feature.geometry;
  const toScreen = (lngLat) => {
    const converted = convertCoordinate(
      normalizeLngLat(lngLat, "feature coordinate"),
      dataCoordinateSystem,
      viewport.coordinateSystem
    );
    return projection.project(converted);
  };
  const featureSeed = `${seed}:${featureIndex}:${feature.properties?.name || ""}`;

  switch (geometry.type) {
    case "Polygon":
      return renderPolygon(geometry.coordinates, layer, toScreen, featureSeed);
    case "MultiPolygon":
      return geometry.coordinates.flatMap((polygon, index) =>
        renderPolygon(polygon, layer, toScreen, `${featureSeed}:poly:${index}`)
      );
    case "LineString":
      return renderLine(geometry.coordinates, layer, toScreen, featureSeed);
    case "MultiLineString":
      return geometry.coordinates.flatMap((line, index) =>
        renderLine(line, layer, toScreen, `${featureSeed}:line:${index}`)
      );
    case "Point":
      return renderPoint(geometry.coordinates, layer, toScreen, feature, featureSeed);
    case "MultiPoint":
      return geometry.coordinates.flatMap((point, index) =>
        renderPoint(point, layer, toScreen, feature, `${featureSeed}:point:${index}`)
      );
    default:
      return [];
  }
}

function renderPolygon(rings, layer, toScreen, seed) {
  const projectedRings = rings.map((ring) => ring.map(toScreen));
  const exactPath = polygonPath(projectedRings);
  const elements = [];
  const fill = layer.fill || "none";
  const stroke = layer.stroke || "none";
  const strokeWidth = layer.strokeWidth ?? 1;

  elements.push(
    svgPath(exactPath, {
      fill,
      stroke,
      "stroke-width": strokeWidth,
      "stroke-linejoin": layer.lineJoin || "round",
      opacity: layer.opacity ?? 1
    })
  );

  if (layer.texture) {
    elements.push(
      svgPath(exactPath, {
        fill: `url(#texture-${escapeId(layer.texture)})`,
        stroke: "none",
        opacity: textureOpacity(layer.texture)
      })
    );
  }

  if (layer.sketch?.enabled) {
    const copies = layer.sketch.copies || 1;
    for (let i = 0; i < copies; i += 1) {
      const jittered = projectedRings.map((ring, ringIndex) =>
        jitterPoints(ring, layer.sketch.jitter || 0.5, `${seed}:sketch:${i}:${ringIndex}`)
      );
      elements.push(
        svgPath(polygonPath(jittered), {
          fill: "none",
          stroke,
          "stroke-width": Math.max(0.8, strokeWidth * 0.8),
          "stroke-linejoin": layer.lineJoin || "round",
          opacity: layer.sketch.opacity ?? 0.25
        })
      );
    }
  }

  return elements;
}

function renderLine(coordinates, layer, toScreen, seed) {
  const points = coordinates.map(toScreen);
  const exactPath = linePath(points);
  const elements = [];
  const lineAttrs = {
    fill: "none",
    "stroke-linecap": layer.lineCap || "round",
    "stroke-linejoin": layer.lineJoin || "round"
  };

  if (layer.casing) {
    elements.push(
      svgPath(exactPath, {
        ...lineAttrs,
        stroke: layer.casing.stroke || "#fff",
        "stroke-width": layer.casing.strokeWidth || (layer.strokeWidth || 1) + 4,
        opacity: layer.casing.opacity ?? 1
      })
    );
  }

  elements.push(
    svgPath(exactPath, {
      ...lineAttrs,
      stroke: layer.stroke || "#333",
      "stroke-width": layer.strokeWidth ?? 1,
      "stroke-dasharray": layer.dash ? layer.dash.join(" ") : undefined,
      opacity: layer.opacity ?? 1
    })
  );

  if (layer.sketch?.enabled) {
    const copies = layer.sketch.copies || 1;
    for (let i = 0; i < copies; i += 1) {
      elements.push(
        svgPath(linePath(jitterPoints(points, layer.sketch.jitter || 0.5, `${seed}:sketch:${i}`)), {
          ...lineAttrs,
          stroke: layer.stroke || "#333",
          "stroke-width": Math.max(0.8, (layer.strokeWidth ?? 1) * 0.75),
          "stroke-dasharray": layer.dash ? layer.dash.join(" ") : undefined,
          opacity: layer.sketch.opacity ?? 0.25
        })
      );
    }
  }

  return elements;
}

function renderPoint(coordinates, layer, toScreen, feature, seed) {
  const [x, y] = toScreen(coordinates);
  const elements = [];

  if (layer.symbol?.enabled) {
    elements.push(
      svgCircle(x, y, layer.symbol.radius || 4, {
        fill: layer.symbol.fill || "#c75d4d",
        stroke: layer.symbol.stroke || "#fff",
        "stroke-width": layer.symbol.strokeWidth ?? 1
      })
    );
    elements.push(
      svgCircle(
        x + randomBetween(`${seed}:dot:x`, -0.8, 0.8),
        y + randomBetween(`${seed}:dot:y`, -0.8, 0.8),
        Math.max(1.5, (layer.symbol.radius || 4) * 0.45),
        {
          fill: "#fff7e1",
          stroke: "none",
          opacity: 0.55
        }
      )
    );
  }

  if (layer.label) {
    const property = layer.label.property || "name";
    const text = feature.properties?.[property];
    if (text) {
      const fontSize = layer.label.fontSize || 16;
      const dx = layer.label.dx ?? 10;
      const dy = layer.label.dy ?? fontSize * 0.35;
      if (layer.label.stroke) {
        elements.push(
          svgText(x + dx, y + dy, text, {
            fill: layer.label.stroke,
            "font-family": layer.label.fontFamily || "serif",
            "font-size": fontSize,
            "font-weight": layer.label.fontWeight || 700,
            stroke: layer.label.stroke,
            "stroke-width": layer.label.strokeWidth ?? 3,
            "paint-order": "stroke",
            "stroke-linejoin": "round"
          })
        );
      }
      elements.push(
        svgText(x + dx, y + dy, text, {
          fill: layer.label.fill || "#333",
          "font-family": layer.label.fontFamily || "serif",
          "font-size": fontSize,
          "font-weight": layer.label.fontWeight || 700
        })
      );
    }
  }

  return elements;
}

function polygonPath(rings) {
  return rings
    .map((ring) => {
      if (ring.length === 0) return "";
      return `${moveTo(ring[0])}${ring.slice(1).map(lineTo).join("")}Z`;
    })
    .join("");
}

function linePath(points) {
  if (points.length === 0) return "";
  return `${moveTo(points[0])}${points.slice(1).map(lineTo).join("")}`;
}

function moveTo(point) {
  return `M${fmt(point[0])},${fmt(point[1])}`;
}

function lineTo(point) {
  return `L${fmt(point[0])},${fmt(point[1])}`;
}

function jitterPoints(points, amount, seed) {
  return points.map(([x, y], index) => [
    x + randomBetween(`${seed}:${index}:x`, -amount, amount),
    y + randomBetween(`${seed}:${index}:y`, -amount, amount)
  ]);
}

function randomBetween(seed, min, max) {
  const value = seededRandom(seed);
  return min + (max - min) * value;
}

function seededRandom(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function fmt(value) {
  return Number(value.toFixed(2));
}

function buildSvg({ width, height, style, config, clipBoundary, layerElements }) {
  const debugFrame = config.render?.showDebugFrame
    ? `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#f00" stroke-width="1"/>`
    : "";
  const paper = style.paper?.enabled
    ? `<rect width="100%" height="100%" filter="url(#paper-grain)" opacity="${style.paper.opacity ?? 0.15}"/>`
    : "";
  const clipDefs = clipBoundary
    ? `
    <clipPath id="${clipBoundary.id}">
      <path d="${escapeXml(clipBoundary.pathData)}"/>
    </clipPath>`
    : "";
  const clipAttr = clipBoundary ? ` clip-path="url(#${clipBoundary.id})"` : "";
  const outsideFill =
    clipBoundary && clipBoundary.outsideFill !== "none"
      ? `<rect width="100%" height="100%" fill="${escapeXml(clipBoundary.outsideFill)}"/>`
      : "";
  const boundaryStroke = clipBoundary?.boundaryStroke
    ? svgPath(clipBoundary.pathData, {
        fill: "none",
        stroke: clipBoundary.boundaryStroke.stroke || "#7fa56d",
        "stroke-width": clipBoundary.boundaryStroke.strokeWidth ?? 2,
        "stroke-linejoin": "round",
        opacity: clipBoundary.boundaryStroke.opacity ?? 0.85
      })
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(config.name || "handdrawn map")}">
  <defs>
    <filter id="paper-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="table" tableValues="0 0.22"/>
      </feComponentTransfer>
    </filter>
    <pattern id="texture-waves" width="26" height="18" patternUnits="userSpaceOnUse">
      <path d="M2 9 C7 4, 12 14, 17 9 S24 8, 26 9" fill="none" stroke="#4d8d95" stroke-width="1.2" stroke-linecap="round"/>
    </pattern>
    <pattern id="texture-leaf-dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="6" cy="7" r="1.4" fill="#729c64"/>
      <circle cx="16" cy="15" r="1.1" fill="#8eb27b"/>
      <path d="M11 20 q3 -5 6 0" fill="none" stroke="#7fa56d" stroke-width="1" stroke-linecap="round"/>
    </pattern>
    <pattern id="texture-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="12" stroke="#b58c63" stroke-width="1"/>
    </pattern>
    ${clipDefs}
  </defs>
  ${outsideFill}
  <g id="scenic-area"${clipAttr}>
    <rect width="100%" height="100%" fill="${escapeXml(style.background || "#f7efd8")}"/>
    ${paper}
    <g id="map-content">
      ${layerElements.join("\n      ")}
    </g>
  </g>
  ${boundaryStroke}
  ${debugFrame}
</svg>
`;
}

function textureOpacity(texture) {
  if (texture === "waves") return 0.22;
  if (texture === "leaf-dots") return 0.2;
  if (texture === "hatch") return 0.18;
  return 0.15;
}

function svgPath(d, attrs) {
  return `<path d="${escapeXml(d)}" ${attrsToString(attrs)}/>`;
}

function svgCircle(cx, cy, r, attrs) {
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" ${attrsToString(attrs)}/>`;
}

function svgText(x, y, text, attrs) {
  return `<text x="${fmt(x)}" y="${fmt(y)}" ${attrsToString(attrs)}>${escapeXml(text)}</text>`;
}

function attrsToString(attrs) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${escapeXml(String(value))}"`)
    .join(" ");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
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
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * Math.PI * 3000.0 / 180.0);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * Math.PI * 3000.0 / 180.0);
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006];
}

function bd09ToGcj02([lng, lat]) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000.0 / 180.0);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000.0 / 180.0);
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
