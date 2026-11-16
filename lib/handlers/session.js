"use strict";

const { CONFIG, isConfigured } = require("../config");
const { sessionFromRequest } = require("../auth");
const { sendJson, sendError, methodNotAllowed, audit } = require("../http");

module.exports = async function session(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    methodNotAllowed(response, ["GET", "HEAD"]);
    return;
  }

  if (!isConfigured()) {
    audit("portal_not_configured");
    sendError(response, 503, "This portal is not available right now.");
    return;
  }

  const current = sessionFromRequest(request);
  if (!current) {
    sendJson(response, 401, { authenticated: false });
    return;
  }

  sendJson(response, 200, {
    authenticated: true,
    expiresAt: current.exp,
    maxFileBytes: CONFIG.maxFileBytes,
    maxBatchFiles: CONFIG.maxBatchFiles,
  });
};
