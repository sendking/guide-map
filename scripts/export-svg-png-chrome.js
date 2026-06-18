#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const args = parseArgs(process.argv.slice(2));
if (!args.svg || !args.out) {
  console.error("Usage: node scripts/export-svg-png-chrome.js --svg input.svg --out output.png");
  process.exit(1);
}

const width = Number(args.width || 1600);
const height = Number(args.height || 1000);
const chrome = args.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = Number(args.port || 9333);
const svgPath = path.resolve(args.svg);
const svgText = fs.readFileSync(svgPath, "utf8");
const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgText).toString("base64")}`;
const htmlPath = path.join(os.tmpdir(), `guide-map-svg-wrapper-${Date.now()}.html`);
const htmlUrl = pathToFileURL(htmlPath).href;
const userDataDir = `/private/tmp/guide-map-chrome-${Date.now()}`;

fs.writeFileSync(
  htmlPath,
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body {
        width: ${width}px;
        height: ${height}px;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent;
      }
      canvas {
        display: block;
        width: ${width}px;
        height: ${height}px;
      }
    </style>
  </head>
  <body>
    <canvas id="map" width="${width}" height="${height}"></canvas>
    <script>
      globalThis.__SVG_DATA_URL__ = "${svgDataUrl}";
    </script>
  </body>
</html>
`,
  "utf8"
);

const chromeProcess = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ],
  { stdio: ["ignore", "ignore", "pipe"] }
);

try {
  const tab = await createTab(port, htmlUrl);
  const client = await connectWebSocket(tab.webSocketDebuggerUrl);

  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await client.send("Page.enable");
  await client.send("Page.navigate", { url: htmlUrl });
  await delay(1200);

  const result = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.getElementById("map");
        const context = canvas.getContext("2d", { alpha: true });
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png").slice("data:image/png;base64,".length));
      };
      image.onerror = () => reject(new Error("Failed to load SVG image"));
      image.src = globalThis.__SVG_DATA_URL__;
    })`
  });

  fs.writeFileSync(args.out, Buffer.from(result.result.value, "base64"));
  client.close();
  console.log(`PNG: ${args.out}`);
} finally {
  chromeProcess.kill("SIGTERM");
  try {
    fs.unlinkSync(htmlPath);
  } catch {
    // Temporary wrapper cleanup is best effort.
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    parsed[key] = value && !value.startsWith("--") ? value : true;
    if (parsed[key] === value) i += 1;
  }
  return parsed;
}

async function createTab(port, url) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await httpRequest(port, `/json/new?${encodeURIComponent(url)}`, "PUT");
      if (response.status === 200) return JSON.parse(response.data);

      const listResponse = await httpRequest(port, "/json/list", "GET");
      if (listResponse.status === 200) {
        const tabs = JSON.parse(listResponse.data);
        if (tabs[0]?.webSocketDebuggerUrl) return tabs[0];
      }
    } catch {
      // Chrome may still be starting.
    }
    await delay(100);
  }
  throw new Error("Chrome remote debugging did not start");
}

function httpRequest(port, path, method) {
  return new Promise((resolve, reject) => {
    const request = http
      .request({ host: "127.0.0.1", port, path, method }, (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode, data });
        });
      })
      .on("error", reject);
    request.end();
  });
}

async function connectWebSocket(wsUrl) {
  const url = new URL(wsUrl);
  const socket = net.connect(Number(url.port), url.hostname);
  const key = crypto.randomBytes(16).toString("base64");
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("connect", resolve);
  });

  socket.write(
    [
      `GET ${url.pathname} HTTP/1.1`,
      `Host: ${url.host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n")
  );

  let buffer = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      socket.off("data", onData);
      const header = buffer.subarray(0, headerEnd).toString();
      if (!header.startsWith("HTTP/1.1 101")) {
        reject(new Error(`WebSocket upgrade failed: ${header}`));
        return;
      }
      buffer = buffer.subarray(headerEnd + 4);
      resolve();
    }
    socket.on("data", onData);
    socket.once("error", reject);
  });

  let id = 0;
  const pending = new Map();

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parseFrames();
  });

  return {
    send(method, params = {}) {
      const messageId = ++id;
      writeFrame(socket, JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        setTimeout(() => {
          if (!pending.has(messageId)) return;
          pending.delete(messageId);
          reject(new Error(`CDP timeout: ${method}`));
        }, 10000);
      });
    },
    close() {
      socket.end();
    }
  };

  function parseFrames() {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      let length = second & 127;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const bigLength = buffer.readBigUInt64BE(2);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error("WebSocket frame is too large");
        }
        length = Number(bigLength);
        offset = 10;
      }

      const masked = Boolean(second & 128);
      const maskOffset = offset;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;

      let payload = buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((value, index) => value ^ mask[index % 4]));
      }
      buffer = buffer.subarray(offset + length);

      if ((first & 15) !== 1) continue;
      const message = JSON.parse(payload.toString());
      const handler = pending.get(message.id);
      if (!handler) continue;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
      else handler.resolve(message.result);
    }
  }
}

function writeFrame(socket, text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    throw new Error("Payload too large");
  }

  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4];
  }
  socket.write(Buffer.concat([header, mask, masked]));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
