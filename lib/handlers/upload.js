"use strict";

const path = require("path");
const { CONFIG, isConfigured } = require("../config");
const { requireSession } = require("../auth");
const { checkLimit } = require("../rate-limit");
const {
  HttpError,
  sendJson,
  sendError,
  methodNotAllowed,
  assertSameOrigin,
  readRawBody,
  hashIp,
  audit,
} = require("../http");
const { inspectImage, normalizeMime } = require("../image-info");
const { sanitizeFilename, withSuffix, workPath } = require("../works-manifest");
const { getHead, getTree, createBlob } = require("../github");
const { handleError } = require("./utils");

function requestUrl(request) {
  return new URL(request.url, `http://${request.headers.host || "localhost"}`);
}

module.exports = async function upload(request, response) {
  if (request.method !== "POST") {
    methodNotAllowed(response, ["POST"]);
    return;
  }

  try {
    assertSameOrigin(request);

    if (!isConfigured()) {
      audit("portal_not_configured");
      sendError(response, 503, "This portal is not available right now.");
      return;
    }

    requireSession(request);

    const ip = hashIp(request);
    const limit = await checkLimit(`portal:api:${ip}`, CONFIG.apiMaxRequests, CONFIG.apiWindowSeconds);
    if (!limit.allowed) {
      sendError(response, 429, "Too many uploads. Please wait a little while and try again.", {
        "Retry-After": String(limit.retryAfter || CONFIG.apiWindowSeconds),
      });
      return;
    }

    const name = requestUrl(request).searchParams.get("name") || "";
    const sanitized = sanitizeFilename(name);

    const declared = normalizeMime(request.headers["content-type"]);
    if (declared && declared !== "application/octet-stream" && !CONFIG.allowedMimeTypes.includes(declared)) {
      throw new HttpError(415, "Please choose a JPEG, PNG or WebP photo.");
    }

    const body = await readRawBody(request, CONFIG.maxFileBytes);
    if (body.length === 0) throw new HttpError(400, "The photo is empty. Please try again.");

    const info = inspectImage(body);
    if (!info) throw new HttpError(415, "This file is not a supported photo. Use JPEG, PNG or WebP.");
    if (declared && declared !== "application/octet-stream" && declared !== info.mime) {
      throw new HttpError(415, "The photo file does not match its type. Please try another file.");
    }
    if (!info.width || !info.height || info.width > 20000 || info.height > 20000) {
      throw new HttpError(422, "The photo size could not be read. Please try another file.");
    }

    const stem = sanitized.slice(0, sanitized.length - path.extname(sanitized).length);
    const filename = `${stem}${info.extension}`;

    const head = await getHead();
    const tree = await getTree(head.treeSha);
    const existing = new Set();
    for (const treePath of tree.keys()) existing.add(treePath.toLowerCase());

    let candidate = filename;
    let suffix = 2;
    while (existing.has(workPath(candidate).toLowerCase())) {
      candidate = withSuffix(filename, suffix);
      suffix += 1;
      if (suffix > 1000) throw new HttpError(409, "This photo name is already in use. Rename the file and try again.");
    }

    const finalPath = workPath(candidate);
    const sha = await createBlob(body);

    audit("portal_upload_blob", {
      ip,
      bytes: body.length,
      path: finalPath,
      renamed: candidate !== filename,
    });

    sendJson(response, 200, {
      path: finalPath,
      sha,
      width: info.width,
      height: info.height,
      size: body.length,
      renamed: candidate !== filename,
    });
  } catch (error) {
    handleError(response, error, "portal_upload_error");
  }
};
