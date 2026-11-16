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
  const value = String(process.env.GITHUB_REPO || "")
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\/+$/g, "")
    .replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.includes("..")) return null;
  return value;
}

function githubBranch() {
  const value = String(process.env.GITHUB_BRANCH || "main")
    .trim()
    .replace(/^refs\/remotes\/origin\//i, "")
    .replace(/^refs\/heads\//i, "")
    .replace(/^origin\//i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!value || !/^[A-Za-z0-9._/-]+$/.test(value) || value.includes("..")) return null;
  return value;
}

function githubAuthConfigured() {
  if (process.env.GITHUB_TOKEN) return true;
  return Boolean(
    process.env.GITHUB_APP_ID
    && process.env.GITHUB_INSTALLATION_ID
    && process.env.GITHUB_APP_PRIVATE_KEY,
  );
}

function githubApiUrl() {
  return (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
}

function isConfigured() {
  return Boolean(sessionSecret() && passwordHash() && githubRepo() && githubBranch() && githubAuthConfigured());
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
