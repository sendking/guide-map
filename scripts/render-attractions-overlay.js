#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.manifest || !args.attractions || !args.out) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const manifest = readJson(args.manifest);
  const attractionData = readJson(args.attractions);
  const width = manifest.viewport.width;
  const height = manifest.viewport.height;
  const bounds = manifest.overlay.bounds;
  const coordinateSystem = attractionData.coordinateSystem || manifest.viewport.coordinateSystem;

  ensureDir(path.dirname(args.out));

  const elements = [];
  const stats = {
    attractionsRead: attractionData.attractions?.length || 0,
    attractionsRendered: 0,
    attractionsSkipped: 0
  };

  for (const attraction of attractionData.attractions || []) {
    const point = projectLngLat(attraction.coordinate, bounds, width, height);
    if (!point.inside && !args.includeOutside) {
      stats.attractionsSkipped += 1;
      continue;
    }

    elements.push(renderAttraction(attraction, point));
    stats.attractionsRendered += 1;
  }

  const svg = buildSvg({
    width,
    height,
    title: attractionData.name || "attractions overlay",
    elements
  });

  fs.writeFileSync(args.out, svg, "utf8");

  const outputManifest = {
    name: attractionData.name || "attractions-overlay",
    createdAt: new Date().toISOString(),
    files: {
      svg: args.out
    },
    viewport: manifest.viewport,
    overlay: {
      ...manifest.overlay,
      type: "svg-attractions"
    },
    attractions: {
      coordinateSystem,
      source: args.attractions
    },
    stats
  };

  if (args.overlayManifest) {
    ensureDir(path.dirname(args.overlayManifest));
    fs.writeFileSync(args.overlayManifest, `${JSON.stringify(outputManifest, null, 2)}\n`, "utf8");
  }

  console.log(`Rendered ${stats.attractionsRendered}/${stats.attractionsRead} attractions`);
  console.log(`SVG: ${args.out}`);
  if (args.overlayManifest) console.log(`Manifest: ${args.overlayManifest}`);
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
  node scripts/render-attractions-overlay.js \\
    --manifest output/styles/xixi-jiangnan-guide-overlay.json \\
    --attractions data/attractions/xixi-attractions.json \\
    --out output/attractions/xixi-attractions-overlay.svg \\
    --overlayManifest output/attractions/xixi-attractions-overlay.json
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  if (!dirPath || dirPath === ".") return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function projectLngLat(coordinate, bounds, width, height) {
  const [lng, lat] = coordinate;
  const x = ((lng - bounds.west) / (bounds.east - bounds.west)) * width;
  const y = ((bounds.north - lat) / (bounds.north - bounds.south)) * height;
  return {
    x,
    y,
    inside: lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north
  };
}

function renderAttraction(attraction, point) {
  if (attraction.type === "helium-balloon") {
    return renderHeliumBalloon(attraction, point);
  }
  return renderGenericMarker(attraction, point);
}

function renderHeliumBalloon(attraction, point) {
  const size = attraction.size || 140;
  const scale = size / 150;
  const x = round(point.x);
  const y = round(point.y);
  const id = escapeId(attraction.id || attraction.name);
  const label = attraction.label?.enabled
    ? renderLabel({
        x: x + (attraction.label.dx ?? 48) * scale,
        y: y + (attraction.label.dy ?? 62) * scale,
        text: attraction.label.text || attraction.name,
        scale
      })
    : "";

  return `<g id="${id}" class="attraction helium-balloon" transform="translate(${x} ${y}) scale(${round(scale)})">
      <ellipse cx="0" cy="96" rx="38" ry="10" fill="#6b7b5a" opacity="0.18"/>
      <path d="M-40 12 C-62 40, -54 84, -20 98 C16 113, 54 88, 54 42 C54 8, 30 -18, -5 -20 C-20 -21, -32 -10, -40 12Z" fill="#f3ead0" stroke="#75664c" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M-38 19 C-22 2, 18 -6, 43 22 C25 16, -13 14, -38 19Z" fill="#5fa778" opacity="0.88"/>
      <path d="M-37 70 C-14 82, 20 81, 47 67 C40 84, 22 99, -2 101 C-20 102, -33 91, -37 70Z" fill="#5a9b62" opacity="0.82"/>
      <path d="M-38 19 C-17 14, 21 15, 43 22" fill="none" stroke="#f8f1dc" stroke-width="4" stroke-linecap="round" opacity="0.9"/>
      <path d="M-36 68 C-11 80, 20 80, 46 67" fill="none" stroke="#eadfc4" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M-22 23 C-28 42, -26 66, -17 91 M-3 18 C-8 44, -8 70, -3 99 M17 20 C20 45, 18 70, 11 96 M35 31 C36 52, 31 75, 20 91" fill="none" stroke="#aa9a78" stroke-width="0.8" opacity="0.55"/>
      <path d="M-34 32 C-13 26, 14 26, 40 34 M-39 51 C-11 45, 17 45, 49 50" fill="none" stroke="#b7a787" stroke-width="0.8" opacity="0.45"/>
      <text x="-28" y="45" font-family="serif" font-size="12" font-weight="700" fill="#514232" transform="rotate(-8 -28 45)">西</text>
      <text x="-8" y="40" font-family="serif" font-size="12" font-weight="700" fill="#514232">溪</text>
      <text x="12" y="42" font-family="serif" font-size="12" font-weight="700" fill="#514232" transform="rotate(6 12 42)">且</text>
      <text x="31" y="49" font-family="serif" font-size="11" font-weight="700" fill="#514232" transform="rotate(12 31 49)">留</text>
      <path d="M-31 93 L-18 133 M-10 100 L-7 136 M18 96 L11 136 M42 81 L25 133" fill="none" stroke="#766b57" stroke-width="0.9" opacity="0.72"/>
      <path d="M-15 132 L24 132 L18 150 L-12 150Z" fill="#5d9986" stroke="#594c3f" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M-10 136 L19 136 M-6 143 L16 143" fill="none" stroke="#e6dcc7" stroke-width="1"/>
      <circle cx="-27" cy="21" r="2.4" fill="#e7ead4" opacity="0.9"/>
      <circle cx="-13" cy="18" r="1.8" fill="#e7ead4" opacity="0.9"/>
      <circle cx="5" cy="17" r="2" fill="#e7ead4" opacity="0.9"/>
      <circle cx="25" cy="21" r="2.2" fill="#e7ead4" opacity="0.9"/>
      <path d="M-45 91 C-69 100, -72 118, -53 126 M48 82 C72 88, 78 108, 64 121" fill="none" stroke="#789f64" stroke-width="2.2" stroke-linecap="round" opacity="0.5"/>
      ${label}
    </g>`;
}

function renderLabel({ x, y, text, scale }) {
  const fontSize = round(18 * scale);
  const paddingX = round(10 * scale);
  const width = Math.max(88 * scale, text.length * fontSize * 0.95);
  const height = 28 * scale;
  return `<g class="attraction-label" transform="translate(${round(x)} ${round(y)})">
        <rect x="0" y="${round(-height + 6 * scale)}" width="${round(width)}" height="${round(height)}" rx="${round(10 * scale)}" fill="#fff8df" stroke="#927b57" stroke-width="${round(1.5 * scale)}" opacity="0.94"/>
        <text x="${paddingX}" y="0" font-family="serif" font-size="${fontSize}" font-weight="700" fill="#5b4a34">${escapeXml(text)}</text>
      </g>`;
}

function renderGenericMarker(attraction, point) {
  const x = round(point.x);
  const y = round(point.y);
  const label = escapeXml(attraction.name || "景点");
  return `<g class="attraction generic" transform="translate(${x} ${y})">
      <circle cx="0" cy="0" r="12" fill="#d7924a" stroke="#fff7de" stroke-width="4"/>
      <text x="18" y="6" font-family="serif" font-size="18" font-weight="700" fill="#5b4a34">${label}</text>
    </g>`;
}

function buildSvg({ width, height, title, elements }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <filter id="attraction-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#5b4a34" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="none"/>
  <g id="attractions" filter="url(#attraction-soft-shadow)">
    ${elements.join("\n    ")}
  </g>
</svg>
`;
}

function round(value) {
  return Number(value.toFixed(2));
}

function escapeId(value) {
  return String(value || "attraction").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
