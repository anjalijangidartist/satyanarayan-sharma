"use strict";

const path = require("path");
const { CONFIG } = require("./config");

function sanitizeFilename(name) {
  const original = path.basename(String(name || ""));
  const rawExtension = path.extname(original).toLowerCase();
  if (!CONFIG.allowedExtensions.includes(rawExtension)) {
    throw Object.assign(new Error("Unsupported photo type."), { status: 415 });
  }
  const extension = rawExtension === ".jpeg" ? ".jpg" : rawExtension;
  const stem = original
    .slice(0, original.length - path.extname(original).length)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, CONFIG.maxFilenameLength)
    .replace(/-+$/g, "");
  return `${stem || "artwork"}${extension}`;
}

function withSuffix(filename, suffix) {
  const extension = path.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  return `${stem}-${suffix}${extension}`;
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

function workPath(filename) {
  return `${CONFIG.workDirectory}/${filename}`;
}

function entryFor(workRelativePath, width, height) {
  const title = titleFromName(path.basename(workRelativePath));
  return {
    src: workRelativePath,
    title,
    width,
    height,
    alt: `${title}, artwork by Satyanarayan Sharma`,
  };
}

function stripQuery(src) {
  return String(src || "").split("?")[0];
}

function placeholderNames(text) {
  try {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) return new Set();
    return new Set(list.map((item) => path.basename(stripQuery(item && item.src))));
  } catch {
    return new Set();
  }
}

function updateWorksJson(existingText, additions, placeholderText) {
  let existing = [];
  try {
    const parsed = JSON.parse(existingText || "[]");
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    existing = [];
  }

  const addPaths = new Set(additions.map((item) => item.src));
  const kept = existing.filter((item) => item && !addPaths.has(stripQuery(item.src)));
  let combined = kept.concat(additions);

  const placeholders = placeholderNames(placeholderText);
  if (placeholders.size > 0) {
    const hasReal = combined.some((item) => !placeholders.has(path.basename(stripQuery(item.src))));
    if (hasReal) {
      combined = combined.filter((item) => !placeholders.has(path.basename(stripQuery(item.src))));
    }
  }

  combined.sort((a, b) => stripQuery(a.src).localeCompare(stripQuery(b.src), undefined, {
    numeric: true,
    sensitivity: "base",
  }));

  return {
    json: `${JSON.stringify(combined, null, 2)}\n`,
    count: combined.length,
  };
}

module.exports = {
  sanitizeFilename,
  withSuffix,
  titleFromName,
  workPath,
  entryFor,
  stripQuery,
  placeholderNames,
  updateWorksJson,
};
