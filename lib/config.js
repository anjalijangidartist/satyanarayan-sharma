"use strict";

const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const CONFIG = {
  sessionCookie: "portal_session",
  sessionMaxAgeSeconds: 12 * 60 * 60,
  loginWindowSeconds: 15 * 60,
  loginMaxAttempts: 8,
  apiWindowSeconds: 60 * 60,
  apiMaxRequests: 600,
  maxFileBytes: 4 * 1000 * 1000,
  maxBatchFiles: 100,
  maxFilenameLength: 80,
  workDirectory: "assets/work",
  workManifest: "works.json",
  placeholderManifest: "assets/work/.placeholders.json",
  allowedExtensions: [".jpg", ".jpeg", ".png", ".webp"],
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

function sessionSecret() {
  const value = process.env.SESSION_SECRET || "";
  if (value.length < 32) return null;
  return value;
}

function passwordHash() {
  return process.env.PORTAL_PASSWORD_HASH || "";
}

function githubRepo() {
  const value = process.env.GITHUB_REPO || "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return null;
  return value;
}

function githubBranch() {
  const value = process.env.GITHUB_BRANCH || "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes("..")) return null;
  return value.replace(/^\/+|\/+$/g, "");
}

function githubApiUrl() {
  return (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
}

function isConfigured() {
  return Boolean(sessionSecret() && passwordHash() && githubRepo() && githubBranch());
}


module.exports = {
  ROOT,
  CONFIG,
  sessionSecret,
  passwordHash,
  githubRepo,
  githubBranch,
  githubApiUrl,
  isConfigured,
};
