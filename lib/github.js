"use strict";

const crypto = require("crypto");
const { githubRepo, githubBranch, githubApiUrl } = require("./config");

class GitHubError extends Error {
  constructor(status, message, details) {
    super(message);
    this.githubStatus = status;
    this.details = details;
  }
}

let tokenCache = { token: "", expiresAt: 0 };

function repoConfig() {
  const repo = githubRepo();
  const branch = githubBranch();
  if (!repo || !branch) throw new GitHubError(500, "GitHub repository is not configured.");
  return { repo, branch };
}

function privateKey() {
  const value = process.env.GITHUB_APP_PRIVATE_KEY || "";
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function appCredentials() {
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_INSTALLATION_ID;
  if (!appId || !installationId || !privateKey()) return null;
  return { appId, installationId, key: privateKey() };
}

function signedJwt(appId, key) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  })).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(input).sign(key, "base64url");
  return `${input}.${signature}`;
}

async function installationToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  const credentials = appCredentials();
  if (!credentials) throw new GitHubError(500, "GitHub authentication is not configured.");

  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const jwt = signedJwt(credentials.appId, credentials.key);
  const response = await fetch(
    `${githubApiUrl()}/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "satyanarayan-sharma-portal",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw new GitHubError(502, `GitHub installation token failed (${response.status}).`);
  }

  const data = await response.json();
  if (!data.token) throw new GitHubError(502, "GitHub installation token missing.");
  const expires = Date.parse(data.expires_at || "") || now + 50 * 60 * 1000;
  tokenCache = { token: data.token, expiresAt: expires };
  return tokenCache.token;
}

async function request(method, apiPath, body) {
  const token = await installationToken();
  const response = await fetch(`${githubApiUrl()}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "satyanarayan-sharma-portal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401) tokenCache = { token: "", expiresAt: 0 };
    const message = data && data.message ? String(data.message) : `GitHub request failed (${response.status}).`;
    throw new GitHubError(response.status, message, data);
  }

  return data;
}

async function getHead() {
  const { repo, branch } = repoConfig();
  const ref = await request("GET", `/repos/${repo}/git/ref/heads/${branch}`);
  const commitSha = ref && ref.object && ref.object.sha;
  if (!commitSha) throw new GitHubError(502, "GitHub branch is missing a commit.");
  const commit = await request("GET", `/repos/${repo}/git/commits/${commitSha}`);
  if (!commit || !commit.tree || !commit.tree.sha) {
    throw new GitHubError(502, "GitHub commit is missing a tree.");
  }
  return { repo, branch, refSha: ref.object.sha, commitSha, treeSha: commit.tree.sha };
}

async function getTree(treeSha) {
  const { repo } = repoConfig();
  const tree = await request("GET", `/repos/${repo}/git/trees/${treeSha}?recursive=1`);
  if (!tree || !Array.isArray(tree.tree)) throw new GitHubError(502, "GitHub tree is unavailable.");
  if (tree.truncated) throw new GitHubError(503, "Repository tree is too large for the portal.");
  const entries = new Map();
  for (const entry of tree.tree) {
    if (entry && entry.path) entries.set(entry.path, entry);
  }
  return entries;
}

async function createBlob(buffer) {
  const { repo } = repoConfig();
  const data = await request("POST", `/repos/${repo}/git/blobs`, {
    content: Buffer.from(buffer).toString("base64"),
    encoding: "base64",
  });
  if (!data || !data.sha) throw new GitHubError(502, "GitHub did not accept the photo.");
  return data.sha;
}

async function getBlobText(sha) {
  const { repo } = repoConfig();
  const data = await request("GET", `/repos/${repo}/git/blobs/${sha}`);
  if (!data || !data.content) return null;
  return Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
}

async function createTree(baseTreeSha, entries) {
  const { repo } = repoConfig();
  const data = await request("POST", `/repos/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: entries.map((entry) => ({
      path: entry.path,
      mode: "100644",
      type: "blob",
      sha: entry.sha,
    })),
  });
  if (!data || !data.sha) throw new GitHubError(502, "GitHub could not build the commit tree.");
  return data.sha;
}

async function createCommit(message, treeSha, parents) {
  const { repo } = repoConfig();
  const authorName = process.env.GIT_AUTHOR_NAME || "Artwork Portal";
  const authorEmail = process.env.GIT_AUTHOR_EMAIL || "portal@users.noreply.github.com";
  const data = await request("POST", `/repos/${repo}/git/commits`, {
    message,
    tree: treeSha,
    parents,
    author: { name: authorName, email: authorEmail },
    committer: { name: authorName, email: authorEmail },
  });
  if (!data || !data.sha) throw new GitHubError(502, "GitHub could not create the commit.");
  return data.sha;
}

async function updateBranch(commitSha) {
  const { repo, branch } = repoConfig();
  const data = await request("PATCH", `/repos/${repo}/git/refs/heads/${branch}`, {
    sha: commitSha,
    force: false,
  });
  if (!data || !data.object || !data.object.sha) {
    throw new GitHubError(502, "GitHub could not update the branch.");
  }
  return data.object.sha;
}

module.exports = {
  GitHubError,
  getHead,
  getTree,
  createBlob,
  getBlobText,
  createTree,
  createCommit,
  updateBranch,
};
