const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = __dirname;
const WORK_DIR = path.join(ROOT, "assets", "work");

const PORTAL_ROUTES = new Map([
  ["/api/portal/login", require("./lib/handlers/login")],
  ["/api/portal/logout", require("./lib/handlers/logout")],
  ["/api/portal/session", require("./lib/handlers/session")],
  ["/api/portal/upload", require("./lib/handlers/upload")],
  ["/api/portal/commit", require("./lib/handlers/commit")],
]);
const THUMB_DIR = path.join(ROOT, ".cache", "thumbs");
const THUMB_WIDTH = 1200;
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "0.0.0.0";
const IMAGE_TYPES = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const ARTIST = "Satyanarayan Sharma";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

const dimensionCache = new Map();
let manifestCache = null;
let ffmpegReady = null;

function hasFfmpeg() {
  if (ffmpegReady === null) {
    try {
      const result = require("child_process").spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
      ffmpegReady = result.status === 0;
    } catch {
      ffmpegReady = false;
    }
  }
  return ffmpegReady;
}

let activeThumbs = 0;
const thumbQueue = [];

function pumpThumbs() {
  while (activeThumbs < 2 && thumbQueue.length > 0) {
    const job = thumbQueue.shift();
    activeThumbs += 1;
    job.run().then(job.resolve, job.reject).finally(() => {
      activeThumbs -= 1;
      pumpThumbs();
    });
  }
}

function makeThumb(source, destination) {
  return new Promise((resolve, reject) => {
    thumbQueue.push({
      resolve,
      reject,
      run: () => new Promise((done, fail) => {
        const child = require("child_process").spawn("ffmpeg", [
          "-nostdin", "-loglevel", "error", "-y",
          "-i", source,
          "-vf", `scale='min(${THUMB_WIDTH},iw)':-2:flags=lanczos`,
          "-frames:v", "1", "-q:v", "4",
          destination,
        ], { stdio: "ignore" });
        child.on("error", fail);
        child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
      }),
    });
    pumpThumbs();
  });
}

function thumbSrc(relative, mtimeMs) {
  const parts = relative.split("/").map(encodeURIComponent);
  return `/thumb/${parts.join("/")}?v=${Math.floor(mtimeMs)}`;
}

function readHead(file, length) {
  return new Promise((resolve, reject) => {
    fs.open(file, "r", (error, fd) => {
      if (error) return reject(error);
      const buffer = Buffer.alloc(length);
      fs.read(fd, buffer, 0, length, 0, (readError, bytesRead) => {
        fs.close(fd, () => {});
        if (readError) return reject(readError);
        resolve(buffer.subarray(0, bytesRead));
      });
    });
  });
}

function jpegOrientation(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    if (marker === 0xe1 && buffer.toString("latin1", offset + 4, offset + 10) === "Exif\0\0") {
      const tiff = offset + 10;
      if (tiff + 8 > buffer.length) return 1;
      const little = buffer.toString("latin1", tiff, tiff + 2) === "II";
      const read16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
      const read32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
      const ifd = tiff + read32(tiff + 4);
      if (ifd + 2 <= buffer.length) {
        const count = read16(ifd);
        for (let i = 0; i < count; i += 1) {
          const entry = ifd + 2 + i * 12;
          if (entry + 12 > buffer.length) break;
          if (read16(entry) === 0x0112) {
            const value = read16(entry + 8);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
      }
    }
    offset += 2 + length;
  }
  return 1;
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifSize(buffer) {
  if (buffer.length < 10) return null;
  if (buffer.toString("latin1", 0, 3) !== "GIF") return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function webpSize(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString("latin1", 0, 4) !== "RIFF") return null;
  if (buffer.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("latin1", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 ") {
    let offset = 20;
    while (offset + 10 < buffer.length) {
      if (buffer[offset] === 0x9d && buffer[offset + 1] === 0x01 && buffer[offset + 2] === 0x2a) {
        return {
          width: buffer.readUInt16LE(offset + 3) & 0x3fff,
          height: buffer.readUInt16LE(offset + 5) & 0x3fff,
        };
      }
      offset += 1;
    }
    return null;
  }
  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f) return null;
    const b = buffer;
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  return null;
}

async function imageSize(file, extension) {
  const head = await readHead(file, Math.min(2 * 1024 * 1024, (await fsp.stat(file)).size));
  let size = null;
  if (extension === ".png") size = pngSize(head);
  else if (extension === ".gif") size = gifSize(head);
  else if (extension === ".webp") size = webpSize(head);
  else size = jpegSize(head);

  if (!size || !size.width || !size.height) return null;

  if (extension === ".jpg" || extension === ".jpeg") {
    const orientation = jpegOrientation(head);
    if (orientation >= 5) {
      return { width: size.height, height: size.width };
    }
  }
  return size;
}

function titleFromName(name) {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/^\d{1,4}[\s._-]+/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return name.replace(/\.[^.]+$/, "");
  return base
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function encodeSrc(name, mtimeMs) {
  const parts = name.split("/").map(encodeURIComponent);
  return `assets/work/${parts.join("/")}?v=${Math.floor(mtimeMs)}`;
}

async function placeholderNames() {
  try {
    const raw = await fsp.readFile(path.join(WORK_DIR, ".placeholders.json"), "utf8");
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return new Set();
    return new Set(list.map((item) => path.basename(String(item.src))));
  } catch {
    return new Set();
  }
}

async function walk(dir, prefix = "") {
  const found = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...await walk(path.join(dir, entry.name), relative));
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!IMAGE_TYPES.has(extension)) continue;
    found.push({ name: relative, extension });
  }
  return found;
}

async function scanWorks() {
  const found = await walk(WORK_DIR);
  let files = found;

  const samples = await placeholderNames();
  if (samples.size > 0) {
    const real = files.filter((file) => !samples.has(file.name));
    if (real.length > 0) files = real;
  }

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  const signature = [];
  const works = [];

  for (const file of files) {
    const full = path.join(WORK_DIR, file.name);
    let stat;
    try {
      stat = await fsp.stat(full);
    } catch {
      continue;
    }
    signature.push(`${file.name}:${stat.size}:${stat.mtimeMs}`);

    const cacheKey = `${file.name}:${stat.size}:${stat.mtimeMs}`;
    let size = dimensionCache.get(cacheKey);
    if (size === undefined) {
      try {
        size = await imageSize(full, file.extension);
      } catch {
        size = null;
      }
      dimensionCache.set(cacheKey, size);
    }

    const title = titleFromName(path.basename(file.name));
    const original = encodeSrc(file.name, stat.mtimeMs);
    works.push({
      src: original,
      thumb: hasFfmpeg() ? thumbSrc(file.name, stat.mtimeMs) : original,
      title,
      width: size ? size.width : 0,
      height: size ? size.height : 0,
      alt: `${title}, artwork by ${ARTIST}`,
    });
  }

  return { signature: signature.join("|"), works };
}

async function getWorks() {
  const result = await scanWorks();
  if (manifestCache && manifestCache.signature === result.signature) {
    return manifestCache.works;
  }
  manifestCache = result;
  return result.works;
}

function send(response, status, body, type = "text/plain; charset=utf-8", cache = "no-cache") {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function serveFile(request, response, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep)) {
    send(response, 403, "Forbidden");
    return;
  }

  fsp.stat(file).then((stat) => {
    if (!stat.isFile()) throw Object.assign(new Error("not a file"), { code: "ENOENT" });
    const extension = path.extname(file).toLowerCase();
    const type = MIME[extension] || "application/octet-stream";
    const longCache = decoded.startsWith("/assets/work/") || decoded.startsWith("/assets/fonts/");
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": longCache ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(file).pipe(response);
  }).catch(() => {
    send(response, 404, "Not found");
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (PORTAL_ROUTES.has(pathname)) {
    await PORTAL_ROUTES.get(pathname)(request, response);
    return;
  }

  if (pathname === "/manage" || pathname === "/manage/") {
    serveFile(request, response, "/manage.html");
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed");
    return;
  }

  if (pathname.startsWith("/thumb/")) {
    try {
      const relative = decodeURIComponent(pathname.slice("/thumb/".length));
      const source = path.resolve(WORK_DIR, relative);
      if (!source.startsWith(WORK_DIR + path.sep)) {
        send(response, 403, "Forbidden");
        return;
      }
      const stat = await fsp.stat(source);
      if (!stat.isFile() || !hasFfmpeg()) throw new Error("not available");
      const extension = path.extname(source).toLowerCase();
      if (!IMAGE_TYPES.has(extension)) throw new Error("not an image");
      const key = require("crypto")
        .createHash("sha1")
        .update(`${relative}:${stat.size}:${stat.mtimeMs}:${THUMB_WIDTH}`)
        .digest("hex");
      const destination = path.join(THUMB_DIR, `${key}.jpg`);
      await fsp.mkdir(THUMB_DIR, { recursive: true });
      const exists = await fsp.stat(destination).then((item) => item.isFile()).catch(() => false);
      if (!exists) await makeThumb(source, destination);
      const thumbStat = await fsp.stat(destination);
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": thumbStat.size,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(destination).pipe(response);
    } catch {
      send(response, 404, "No thumbnail");
    }
    return;
  }

  if (pathname === "/api/works") {
    try {
      const works = await getWorks();
      if (request.method === "HEAD") {
        response.writeHead(200, { "Content-Type": MIME[".json"] });
        response.end();
        return;
      }
      send(response, 200, JSON.stringify(works), MIME[".json"]);
    } catch (error) {
      console.error(error);
      send(response, 500, JSON.stringify({ error: "Could not read the works folder." }), MIME[".json"]);
    }
    return;
  }

  serveFile(request, response, pathname);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other copy or run: PORT=5000 node server.js`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`Satyanarayan Sharma — site running at http://localhost:${PORT}`);
  console.log(`Photos folder: ${WORK_DIR}`);
});
