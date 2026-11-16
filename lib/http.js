"use strict";

const crypto = require("crypto");
const { CONFIG, sessionSecret } = require("./config");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function baseHeaders(extra) {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    ...extra,
  };
}

function sendJson(response, status, data, extra) {
  const body = JSON.stringify(data);
  response.writeHead(status, baseHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extra,
  }));
  response.end(body);
}

function sendError(response, status, message, extra) {
  sendJson(response, status, { error: message }, extra);
}

function methodNotAllowed(response, allowed) {
  sendError(response, 405, "Method not allowed.", { Allow: allowed.join(", ") });
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function isSecureRequest(request) {
  if (process.env.VERCEL) return true;
  const proto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return proto === "https" || Boolean(request.socket && request.socket.encrypted);
}

function serializeSessionCookie(token, maxAge) {
  return [
    `${CONFIG.sessionCookie}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    "Priority=High",
  ];
}

function setSessionCookie(request, response, token, maxAge) {
  const parts = serializeSessionCookie(token, maxAge);
  if (isSecureRequest(request)) parts.push("Secure");
  response.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(request, response) {
  const parts = [
    `${CONFIG.sessionCookie}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  response.setHeader("Set-Cookie", parts.join("; "));
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  const real = request.headers["x-real-ip"];
  if (real) return String(real).trim();
  return (request.socket && request.socket.remoteAddress) || "unknown";
}

function hashValue(value) {
  const secret = sessionSecret() || "unconfigured";
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex").slice(0, 32);
}

function hashIp(request) {
  return hashValue(clientIp(request));
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Request rejected.");
  }
  const expected = String(request.headers["x-forwarded-host"] || request.headers.host || "");
  if (!expected || host !== expected) throw new HttpError(403, "Request rejected.");
}

async function readRawBody(request, limit) {
  if (Buffer.isBuffer(request.body)) {
    if (request.body.length > limit) throw new HttpError(413, "This photo is too large.");
    return request.body;
  }
  if (typeof request.body === "string") {
    const buffer = Buffer.from(request.body);
    if (buffer.length > limit) throw new HttpError(413, "This photo is too large.");
    return buffer;
  }
  if (request.body && typeof request.body === "object") {
    throw new HttpError(400, "Unexpected request body.");
  }

  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    if (typeof request.resume === "function") request.resume();
    throw new HttpError(413, "This photo is too large.");
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new HttpError(413, "This photo is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, limit) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  const buffer = await readRawBody(request, limit);
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
}

function audit(event, fields) {
  const record = { event, at: new Date().toISOString(), ...fields };
  console.log(JSON.stringify(record));
}

module.exports = {
  HttpError,
  sendJson,
  sendError,
  methodNotAllowed,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  clientIp,
  hashIp,
  hashValue,
  assertSameOrigin,
  readRawBody,
  readJson,
  audit,
};
