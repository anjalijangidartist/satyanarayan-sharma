"use strict";

const fs = require("fs/promises");
const path = require("path");

const { ROOT, CONFIG } = require("./lib/config");
const { inspectImage } = require("./lib/image-info");
const { titleFromName, stripQuery } = require("./lib/works-manifest");

const ARTIST = "Satyanarayan Sharma";
const IMAGE_TYPES = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const WORK_DIR = path.join(ROOT, CONFIG.workDirectory);
const MANIFEST = path.join(ROOT, CONFIG.workManifest);
const PLACEHOLDERS = path.join(ROOT, CONFIG.placeholderManifest);
const TITLES = path.join(ROOT, "titles.json");

function readJson(file, fallback) {
  return fs.readFile(file, "utf8").then((text) => JSON.parse(text)).catch(() => fallback);
}

function gifSize(buffer) {
  if (buffer.length < 10) return null;
  if (buffer.toString("latin1", 0, 3) !== "GIF") return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

async function imageSize(file, extension) {
  const buffer = await fs.readFile(file);
  if (extension === ".gif") return gifSize(buffer);
  const info = inspectImage(buffer);
  return info ? { width: info.width, height: info.height } : null;
}

async function walk(dir, prefix = "") {
  const found = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
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

function placeholderMap(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    const name = path.basename(stripQuery(item && item.src));
    map.set(name, item);
  }
  return map;
}

function existingMap(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    if (!item) continue;
    const src = stripQuery(item.src);
    map.set(src, item);
  }
  return map;
}

async function main() {
  const placeholders = placeholderMap(await readJson(PLACEHOLDERS, []));
  const titles = await readJson(TITLES, {});
  const existing = existingMap(await readJson(MANIFEST, []));

  let files = await walk(WORK_DIR);
  if (placeholders.size > 0) {
    const real = files.filter((file) => !placeholders.has(file.name));
    if (real.length > 0) files = real;
  }

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  const works = [];
  for (const file of files) {
    const full = path.join(WORK_DIR, file.name);
    const src = `${CONFIG.workDirectory}/${file.name}`;
    const base = path.basename(file.name);

    let size = null;
    try {
      size = await imageSize(full, file.extension);
    } catch {
      size = null;
    }

    const previous = existing.get(src) || {};
    const meta = placeholders.get(file.name) || {};
    const title = titles[file.name] || previous.title || meta.title || titleFromName(base);
    const entry = {
      src,
      title,
      width: size ? size.width : 0,
      height: size ? size.height : 0,
    };
    if (previous.color || meta.color) entry.color = previous.color || meta.color;
    entry.alt = `${title}, artwork by ${ARTIST}`;
    works.push(entry);
  }

  await fs.writeFile(MANIFEST, `${JSON.stringify(works, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, MANIFEST)} with ${works.length} works`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
