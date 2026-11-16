"use strict";

const crypto = require("crypto");
const { CONFIG, sessionSecret } = require("./config");
const { parseCookies } = require("./http");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function scrypt(password, salt, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, options.keylen, {
      N: options.N,
      r: options.r,
      p: options.p,
      maxmem: options.maxmem,
    }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

function parseHash(stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || N < 16384 || N > 1048576) return null;
  if (!Number.isInteger(r) || r < 8 || r > 32) return null;
  if (!Number.isInteger(p) || p < 1 || p > 8) return null;
  const salt = Buffer.from(parts[4], "base64");
  const hash = Buffer.from(parts[5], "base64");
  if (salt.length < 16 || hash.length < 32) return null;
  return { N, r, p, salt, hash, keylen: hash.length };
}

async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  const options = parsed
    ? { N: parsed.N, r: parsed.r, p: parsed.p, keylen: parsed.keylen, maxmem: 128 * 1024 * 1024 }
    : { ...SCRYPT };
  const salt = parsed ? parsed.salt : Buffer.alloc(16, 7);
  const expected = parsed ? parsed.hash : Buffer.alloc(SCRYPT.keylen, 9);

  let derived;
  try {
    derived = await scrypt(password, salt, options);
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function createSession(now = Date.now()) {
  const exp = Math.floor(now / 1000) + CONFIG.sessionMaxAgeSeconds;
  const payload = base64url(JSON.stringify({ v: 1, sub: "portal", exp }));
  return { token: `${payload}.${sign(payload)}`, exp };
}

function verifySession(token) {
  if (!token || !sessionSecret()) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || data.sub !== "portal") return null;
  if (!Number.isInteger(data.exp) || data.exp <= Math.floor(Date.now() / 1000)) return null;
  return data;
}

function sessionFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie);
  return verifySession(cookies[CONFIG.sessionCookie]);
}

function requireSession(request) {
  const session = sessionFromRequest(request);
  if (!session) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }
  return session;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  verifySession,
  sessionFromRequest,
  requireSession,
};
