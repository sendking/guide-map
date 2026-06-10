#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.base || !args.overlay || !args.out) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const baseSvg = fs.readFileSync(args.base, "utf8");
  const overlaySvg = fs.readFileSync(args.overlay, "utf8");
  const baseSize = readSvgSize(baseSvg);
  const overlaySize = readSvgSize(overlaySvg);

  if (baseSize.width !== overlaySize.width || baseSize.height !== overlaySize.height) {
    throw new Error(
      `SVG sizes do not match: base ${baseSize.width}x${baseSize.height}, overlay ${overlaySize.width}x${overlaySize.height}`
    );
  }

  const baseInner = readSvgInner(baseSvg);
  const overlayInner = readSvgInner(overlaySvg);
  const composed = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${baseSize.width}" height="${baseSize.height}" viewBox="0 0 ${baseSize.width} ${baseSize.height}" role="img" aria-label="composed handdrawn map">
  <g id="base-map">
    ${baseInner}
  </g>
  <g id="attraction-overlay">
    ${overlayInner}
  </g>
</svg>
`;

  ensureDir(path.dirname(args.out));
  fs.writeFileSync(args.out, composed, "utf8");
  console.log(`Composed SVG: ${args.out}`);
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
  node scripts/compose-svg-overlays.js \\
    --base output/styles/xixi-jiangnan-guide.svg \\
    --overlay output/attractions/xixi-attractions-overlay.svg \\
    --out output/attractions/xixi-jiangnan-with-attractions.svg
`);
}

function readSvgSize(svg) {
  const openTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!openTag) throw new Error("Could not find <svg> tag");
  const width = Number(openTag.match(/\bwidth="([^"]+)"/i)?.[1]);
  const height = Number(openTag.match(/\bheight="([^"]+)"/i)?.[1]);
  return { width, height };
}

function readSvgInner(svg) {
  return svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .trim();
}

function ensureDir(dirPath) {
  if (!dirPath || dirPath === ".") return;
  fs.mkdirSync(dirPath, { recursive: true });
}
