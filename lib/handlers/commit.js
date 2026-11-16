"use strict";

const path = require("path");
const { CONFIG, isConfigured, githubBranch } = require("../config");
const { requireSession } = require("../auth");
const { checkLimit } = require("../rate-limit");
const {
  HttpError,
  sendJson,
  sendError,
  methodNotAllowed,
  assertSameOrigin,
  readJson,
  hashIp,
  audit,
} = require("../http");
const { entryFor, updateWorksJson } = require("../works-manifest");
const {
  getHead,
  getTree,
  getBlobText,
  createBlob,
  createTree,
  createCommit,
  updateBranch,
} = require("../github");
const { handleError } = require("./utils");

const FILE_PATTERN = /^assets\/work\/([a-z0-9][a-z0-9._-]*\.(?:jpg|jpeg|png|webp))$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function validateFiles(body) {
  if (!body || !Array.isArray(body.files)) {
    throw new HttpError(400, "No photos were sent.");
  }
  if (body.files.length === 0) throw new HttpError(400, "No photos were sent.");
  if (body.files.length > CONFIG.maxBatchFiles) {
    throw new HttpError(400, `Please upload ${CONFIG.maxBatchFiles} photos or fewer at a time.`);
  }

  const seen = new Set();
  return body.files.map((item) => {
    const file = item || {};
    const filePath = String(file.path || "");
    const match = FILE_PATTERN.exec(filePath);
    if (!match) throw new HttpError(400, "A photo path was not valid.");
    if (path.posix.dirname(filePath) !== CONFIG.workDirectory) {
      throw new HttpError(400, "A photo path was not valid.");
    }
    if (seen.has(filePath.toLowerCase())) {
      throw new HttpError(400, "Two photos had the same name. Please rename one and try again.");
    }
    seen.add(filePath.toLowerCase());

    if (!SHA_PATTERN.test(String(file.sha || ""))) {
      throw new HttpError(400, "A photo upload was incomplete. Please retry it.");
    }
    const width = Number(file.width);
    const height = Number(file.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000) {
      throw new HttpError(400, "A photo size was not valid. Please retry it.");
    }

    return { path: filePath, sha: String(file.sha), width, height };
  });
}

module.exports = async function commit(request, response) {
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
      sendError(response, 429, "Too many requests. Please wait a little while and try again.", {
        "Retry-After": String(limit.retryAfter || CONFIG.apiWindowSeconds),
      });
      return;
    }

    const body = await readJson(request, 512 * 1024);
    const files = validateFiles(body);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const head = await getHead();
      const tree = await getTree(head.treeSha);

      const existing = new Map();
      for (const [treePath, entry] of tree.entries()) existing.set(treePath.toLowerCase(), entry);

      const blocked = [];
      const already = [];
      for (const file of files) {
        const entry = existing.get(file.path.toLowerCase());
        if (!entry) continue;
        if (entry.sha === file.sha) already.push(file);
        else blocked.push(file);
      }

      if (blocked.length > 0) {
        sendJson(response, 409, {
          error: "Some photos already exist. Rename them and try again.",
          conflicts: blocked.map((file) => file.path),
        });
        return;
      }

      const remaining = files.filter((file) => !already.includes(file));
      if (remaining.length === 0) {
        audit("portal_commit_already_saved", { ip, count: files.length });
        sendJson(response, 200, {
          ok: true,
          count: files.length,
          already: files.length,
          commit: null,
          branch: githubBranch(),
          message: "These photos were already saved. The website will update in a few minutes.",
        });
        return;
      }

      const worksEntry = tree.get(CONFIG.workManifest);
      const worksText = worksEntry ? await getBlobText(worksEntry.sha) : "[]";
      const placeholderEntry = tree.get(CONFIG.placeholderManifest);
      const placeholderText = placeholderEntry ? await getBlobText(placeholderEntry.sha) : "";
      const additions = remaining.map((file) => entryFor(file.path, file.width, file.height));
      const updated = updateWorksJson(worksText, additions, placeholderText);

      const worksSha = await createBlob(Buffer.from(updated.json, "utf8"));
      const treeSha = await createTree(head.treeSha, [
        ...remaining.map((file) => ({ path: file.path, sha: file.sha })),
        { path: CONFIG.workManifest, sha: worksSha },
      ]);

      const message = `Add ${remaining.length} work photo${remaining.length === 1 ? "" : "s"}`;
      const commitSha = await createCommit(message, treeSha, [head.commitSha]);

      try {
        await updateBranch(commitSha);
        audit("portal_commit_success", {
          ip,
          count: remaining.length,
          already: already.length,
          commit: commitSha,
          works: updated.count,
        });
        sendJson(response, 200, {
          ok: true,
          count: files.length,
          newCount: remaining.length,
          already: already.length,
          commit: commitSha,
          branch: githubBranch(),
          message: "Photos added. The website will update in a few minutes.",
        });
        return;
      } catch (error) {
        if (error.githubStatus === 422 || error.githubStatus === 409) {
          continue;
        }
        throw error;
      }
    }

    audit("portal_commit_conflict", { ip, count: files.length });
    sendError(response, 409, "The photo library changed while saving. Please try again.");
  } catch (error) {
    handleError(response, error, "portal_commit_error");
  }
};
