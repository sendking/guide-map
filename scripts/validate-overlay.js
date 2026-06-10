#!/usr/bin/env node
import fs from "node:fs";

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.manifest || !args.svg) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const manifest = JSON.parse(fs.readFileSync(args.manifest, "utf8"));
  const svg = fs.readFileSync(args.svg, "utf8");
  const svgSize = readSvgSize(svg);
  const expected = {
    width: manifest.viewport?.width,
    height: manifest.viewport?.height
  };

  const checks = [];
  checks.push(checkEqual("SVG width", svgSize.width, expected.width));
  checks.push(checkEqual("SVG height", svgSize.height, expected.height));
  checks.push(checkViewBox(svgSize, expected));

  if (args.screenshot) {
    const screenshotSize = readImageSize(args.screenshot);
    checks.push(checkEqual("Screenshot width", screenshotSize.width, expected.width));
    checks.push(checkEqual("Screenshot height", screenshotSize.height, expected.height));
  }

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.message}`);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
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
  node scripts/validate-overlay.js --manifest output/example-overlay.json --svg output/example-handdrawn.svg

Options:
  --screenshot <path>  Optional PNG/JPEG screenshot to verify dimensions against manifest
`);
}

function readSvgSize(svg) {
  const openTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!openTag) throw new Error("Could not find <svg> tag");

  const width = Number(openTag.match(/\bwidth="([^"]+)"/i)?.[1]);
  const height = Number(openTag.match(/\bheight="([^"]+)"/i)?.[1]);
  const viewBox = openTag
    .match(/\bviewBox="([^"]+)"/i)?.[1]
    ?.trim()
    .split(/\s+/)
    .map(Number);

  return { width, height, viewBox };
}

function checkEqual(label, actual, expected) {
  const ok = actual === expected;
  return {
    ok,
    label,
    message: ok ? `${actual}` : `expected ${expected}, got ${actual}`
  };
}

function checkViewBox(svgSize, expected) {
  const viewBox = svgSize.viewBox || [];
  const ok =
    viewBox.length === 4 &&
    viewBox[0] === 0 &&
    viewBox[1] === 0 &&
    viewBox[2] === expected.width &&
    viewBox[3] === expected.height;
  return {
    ok,
    label: "SVG viewBox",
    message: ok ? viewBox.join(" ") : `expected 0 0 ${expected.width} ${expected.height}, got ${viewBox.join(" ")}`
  };
}

function readImageSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (isPng(buffer)) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }
  if (isJpeg(buffer)) {
    return readJpegSize(buffer);
  }
  throw new Error("Only PNG and JPEG screenshots are supported by the validator");
}

function isPng(buffer) {
  return (
    buffer.length > 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

function isJpeg(buffer) {
  return buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function readJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + length;
  }
  throw new Error("Could not read JPEG dimensions");
}
