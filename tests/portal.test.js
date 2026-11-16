"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { hashPassword } = require("../lib/auth");

const ROOT = path.resolve(__dirname, "..");
const PASSWORD = "correct horse battery staple";

let mock;
let mockUrl;
let app;
let appUrl;
let cookie = "";

const state = {
  branchCommit: "c0",
  commits: new Map(),
  trees: new Map(),
  blobs: new Map(),
  counter: 1,
  failNextUpdate: false,
};

function b64(value) {
  return Buffer.from(value).toString("base64");
}

function seed() {
  const placeholder = {
    src: "assets/work/01-untitled-study-I.jpg",
    title: "Untitled Study I",
    width: 1200,
    height: 1500,
    color: "#ece2cf",
  };
  const works = JSON.stringify([placeholder], null, 2);
  const placeholders = JSON.stringify([placeholder], null, 2);

  state.blobs.set("w0", b64(works));
  state.blobs.set("p0", b64(placeholders));
  state.blobs.set("e0", b64("existing"));
  state.commits.set("c0", { tree: "t0", parent: null, message: "Initial" });
  state.trees.set("t0", new Map([
    ["works.json", { path: "works.json", mode: "100644", type: "blob", sha: "w0" }],
    ["assets/work/.placeholders.json", { path: "assets/work/.placeholders.json", mode: "100644", type: "blob", sha: "p0" }],
    ["assets/work", { path: "assets/work", mode: "040000", type: "tree", sha: "sub" }],
    ["assets/work/existing.jpg", { path: "assets/work/existing.jpg", mode: "100644", type: "blob", sha: "e0" }],
  ]));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function respond(response, status, data) {
  const body = data === undefined ? "" : JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function nextSha(prefix) {
  const value = crypto.createHash("sha1").update(`${prefix}${state.counter}`).digest("hex");
  state.counter += 1;
  return value;
}

async function handleGitHub(request, response) {
  const url = new URL(request.url, "http://localhost");
  const auth = request.headers.authorization;
  if (auth !== "Bearer test-token") {
    respond(response, 401, { message: "Bad credentials" });
    return;
  }

  const repoMatch = /^\/repos\/owner\/repo/.test(url.pathname);
  if (!repoMatch) {
    respond(response, 404, { message: "Not Found" });
    return;
  }
  const route = url.pathname.replace("/repos/owner/repo", "");
  const bodyText = await readBody(request);
  const body = bodyText.length ? JSON.parse(bodyText.toString("utf8")) : {};

  if (request.method === "GET" && route === "/git/ref/heads/main") {
    respond(response, 200, { object: { sha: state.branchCommit } });
    return;
  }

  if (request.method === "GET" && route.startsWith("/git/commits/")) {
    const sha = route.slice("/git/commits/".length);
    const commit = state.commits.get(sha);
    if (!commit) return respond(response, 404, { message: "Not Found" });
    respond(response, 200, { sha, tree: { sha: commit.tree } });
    return;
  }

  if (request.method === "GET" && route.startsWith("/git/trees/")) {
    const sha = route.slice("/git/trees/".length);
    const tree = state.trees.get(sha);
    if (!tree) return respond(response, 404, { message: "Not Found" });
    respond(response, 200, { sha, truncated: false, tree: Array.from(tree.values()) });
    return;
  }

  if (request.method === "POST" && route === "/git/blobs") {
    assert.equal(body.encoding, "base64");
    const sha = nextSha("b");
    state.blobs.set(sha, body.content);
    respond(response, 201, { sha });
    return;
  }

  if (request.method === "GET" && route.startsWith("/git/blobs/")) {
    const sha = route.slice("/git/blobs/".length);
    const content = state.blobs.get(sha);
    if (content === undefined) return respond(response, 404, { message: "Not Found" });
    respond(response, 200, { sha, content, encoding: "base64" });
    return;
  }

  if (request.method === "POST" && route === "/git/trees") {
    const base = state.trees.get(body.base_tree);
    if (!base) return respond(response, 404, { message: "Base tree not found" });
    const merged = new Map(base);
    for (const entry of body.tree || []) {
      merged.set(entry.path, {
        path: entry.path,
        mode: entry.mode,
        type: entry.type,
        sha: entry.sha,
      });
    }
    const sha = nextSha("t");
    state.trees.set(sha, merged);
    respond(response, 201, { sha });
    return;
  }

  if (request.method === "POST" && route === "/git/commits") {
    const sha = nextSha("c");
    state.commits.set(sha, {
      tree: body.tree,
      parent: body.parents && body.parents[0] ? body.parents[0] : null,
      message: body.message,
      author: body.author,
    });
    respond(response, 201, { sha });
    return;
  }

  if (request.method === "PATCH" && route === "/git/refs/heads/main") {
    if (state.failNextUpdate) {
      state.failNextUpdate = false;
      respond(response, 422, { message: "Update is not a fast forward" });
      return;
    }
    const commit = state.commits.get(body.sha);
    if (!commit) return respond(response, 404, { message: "Commit not found" });
    if (commit.parent !== state.branchCommit) {
      respond(response, 422, { message: "Update is not a fast forward" });
      return;
    }
    state.branchCommit = body.sha;
    respond(response, 200, { object: { sha: body.sha } });
    return;
  }

  respond(response, 404, { message: "Not Found" });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status) return;
    } catch {
      // not ready yet
    }
    await sleep(50);
  }
  throw new Error("server did not start");
}

async function request(pathname, options = {}) {
  const response = await fetch(`${appUrl}${pathname}`, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { status: response.status, headers: response.headers, data, text };
}

function authHeaders(extra) {
  return { Cookie: cookie, ...extra };
}

before(async () => {
  seed();

  mock = http.createServer((request, response) => {
    handleGitHub(request, response).catch((error) => {
      respond(response, 500, { message: error.message });
    });
  });
  const mockPort = await listen(mock);
  mockUrl = `http://127.0.0.1:${mockPort}`;

  const probe = http.createServer();
  const appPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));

  const passwordHash = await hashPassword(PASSWORD);
  app = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(appPort),
      HOST: "127.0.0.1",
      SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
      PORTAL_PASSWORD_HASH: passwordHash,
      GITHUB_REPO: "owner/repo",
      GITHUB_BRANCH: "main",
      GITHUB_TOKEN: "test-token",
      GITHUB_API_URL: mockUrl,
      VERCEL: "",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stderr.on("data", (chunk) => process.stderr.write(chunk));
  app.stdout.on("data", () => {});

  appUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(`${appUrl}/api/portal/session`);
});

after(async () => {
  if (app) app.kill("SIGTERM");
  if (mock) await new Promise((resolve) => mock.close(resolve));
});

test("portal requires authentication and rejects bad passwords", async () => {
  const session = await request("/api/portal/session");
  assert.equal(session.status, 401);

  const photo = fs.readFileSync(path.join(ROOT, "assets/work/01-untitled-study-I.jpg"));
  const upload = await request("/api/portal/upload?name=test.jpg", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: photo,
  });
  assert.equal(upload.status, 401);

  const login = await request("/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong password value" }),
  });
  assert.equal(login.status, 401);
});

test("authorized login creates a secure session cookie", async () => {
  const login = await request("/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.ok, true);

  const setCookie = login.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /portal_session=/);
  cookie = setCookie.split(";")[0];

  const session = await request("/api/portal/session", { headers: authHeaders() });
  assert.equal(session.status, 200);
  assert.equal(session.data.authenticated, true);
});

test("manage page is served without exposing the dashboard", async () => {
  const page = await request("/manage");
  assert.equal(page.status, 200);
  assert.match(page.text, /Private upload/);
  assert.match(page.text, /dashboard-view/);
  assert.match(page.text, /hidden/);
});

test("invalid files are rejected by the server", async () => {
  const bad = await request("/api/portal/upload?name=notes.jpg", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "image/jpeg" }),
    body: Buffer.from("this is not an image"),
  });
  assert.equal(bad.status, 415);

  const tooLarge = Buffer.alloc(4_100_000, 0x41);
  const large = await request("/api/portal/upload?name=huge.jpg", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "image/jpeg" }),
    body: tooLarge,
  });
  assert.equal(large.status, 413);
});

test("existing names are never overwritten and names are sanitized", async () => {
  const photo = fs.readFileSync(path.join(ROOT, "assets/work/01-untitled-study-I.jpg"));

  const renamed = await request("/api/portal/upload?name=existing.jpg", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "image/jpeg" }),
    body: photo,
  });
  assert.equal(renamed.status, 200);
  assert.notEqual(renamed.data.path, "assets/work/existing.jpg");
  assert.equal(renamed.data.path, "assets/work/existing-2.jpg");

  const sanitized = await request("/api/portal/upload?name=H%C3%A9llo%20W%C3%B6rld!!.JPG", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "image/jpeg" }),
    body: photo,
  });
  assert.equal(sanitized.status, 200);
  assert.equal(sanitized.data.path, "assets/work/hello-world.jpg");

  state.uploaded = [renamed.data, sanitized.data];
});

test("batch commit creates one commit and updates the manifest", async () => {
  const beforeCommit = state.branchCommit;
  state.failNextUpdate = true;

  const commit = await request("/api/portal/commit", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      files: state.uploaded.map((item) => ({
        path: item.path,
        sha: item.sha,
        width: item.width,
        height: item.height,
      })),
    }),
  });

  assert.equal(commit.status, 200);
  assert.equal(commit.data.count, 2);
  assert.match(commit.data.message, /update in a few minutes/);

  const oldCommit = state.commits.get(beforeCommit);
  const newCommit = state.commits.get(commit.data.commit);
  assert.equal(newCommit.parent, beforeCommit);
  assert.equal(newCommit.message, "Add 2 work photos");

  const tree = state.trees.get(newCommit.tree);
  assert.ok(tree.has("assets/work/existing-2.jpg"));
  assert.ok(tree.has("assets/work/hello-world.jpg"));

  const worksField = tree.get("works.json");
  const works = JSON.parse(Buffer.from(state.blobs.get(worksField.sha), "base64").toString("utf8"));
  assert.equal(works.length, 2);
  assert.ok(works.every((item) => !item.src.includes("01-untitled-study-I")));
  assert.ok(works.some((item) => item.src === "assets/work/hello-world.jpg"));

  const again = await request("/api/portal/commit", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      files: state.uploaded.map((item) => ({
        path: item.path,
        sha: item.sha,
        width: item.width,
        height: item.height,
      })),
    }),
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.already, 2);
  assert.equal(again.data.commit, null);

  const conflict = await request("/api/portal/commit", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      files: [{
        path: "assets/work/hello-world.jpg",
        sha: "0".repeat(40),
        width: 1200,
        height: 1500,
      }],
    }),
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.data.conflicts, ["assets/work/hello-world.jpg"]);
});

test("logout clears the session", async () => {
  const logout = await request("/api/portal/logout", {
    method: "POST",
    headers: authHeaders(),
  });
  assert.equal(logout.status, 200);
  const setCookie = logout.headers.get("set-cookie") || "";
  assert.match(setCookie, /Max-Age=0/);

  const session = await request("/api/portal/session");
  assert.equal(session.status, 401);
});

test("login attempts are rate limited", async () => {
  const headers = {
    "Content-Type": "application/json",
    "X-Forwarded-For": "203.0.113.77",
  };
  let lastStatus = 0;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await request("/api/portal/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "wrong password value" }),
    });
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429);
});
