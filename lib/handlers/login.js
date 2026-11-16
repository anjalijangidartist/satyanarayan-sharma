"use strict";

const { CONFIG, isConfigured, passwordHash } = require("../config");
const { verifyPassword, createSession } = require("../auth");
const { checkLimit, resetLimit } = require("../rate-limit");
const {
  HttpError,
  sendJson,
  sendError,
  methodNotAllowed,
  setSessionCookie,
  assertSameOrigin,
  readJson,
  hashIp,
  audit,
} = require("../http");
const { handleError } = require("./utils");

module.exports = async function login(request, response) {
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

    const ip = hashIp(request);
    const limitKey = `portal:login:${ip}`;
    const limit = await checkLimit(limitKey, CONFIG.loginMaxAttempts, CONFIG.loginWindowSeconds);
    if (!limit.allowed) {
      audit("portal_login_rate_limited", { ip });
      sendError(response, 429, "Too many attempts. Please wait a few minutes and try again.", {
        "Retry-After": String(limit.retryAfter || CONFIG.loginWindowSeconds),
      });
      return;
    }

    const body = await readJson(request, 8 * 1024);
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || password.length > 1024) {
      throw new HttpError(401, "Incorrect password. Please try again.");
    }

    const allowed = await verifyPassword(password, passwordHash());
    if (!allowed) {
      audit("portal_login_failure", { ip });
      sendError(response, 401, "Incorrect password. Please try again.");
      return;
    }

    await resetLimit(limitKey);
    const session = createSession();
    setSessionCookie(request, response, session.token, CONFIG.sessionMaxAgeSeconds);
    audit("portal_login_success", { ip });
    sendJson(response, 200, {
      ok: true,
      expiresAt: session.exp,
      maxFileBytes: CONFIG.maxFileBytes,
      maxBatchFiles: CONFIG.maxBatchFiles,
    });
  } catch (error) {
    handleError(response, error, "portal_login_error");
  }
};
