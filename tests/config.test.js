"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { githubRepo, githubBranch } = require("../lib/config");

function withEnv(name, value, fn) {
  const original = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

test("GitHub repo accepts common copy-paste forms", () => {
  for (const value of [
    "owner/repo",
    "owner/repo.git",
    "https://github.com/owner/repo",
    "https://github.com/owner/repo/",
    "https://github.com/owner/repo.git",
    "git@github.com:owner/repo.git",
    "github.com/owner/repo",
  ]) {
    withEnv("GITHUB_REPO", value, () => assert.equal(githubRepo(), "owner/repo", value));
  }
});

test("GitHub repo rejects invalid values", () => {
  for (const value of ["", "owner", "owner/repo/extra", "owner repo/repo", "../repo"]) {
    withEnv("GITHUB_REPO", value, () => assert.equal(githubRepo(), null, value));
  }
});

test("GitHub branch accepts common copy-paste forms", () => {
  for (const value of [
    "main",
    "refs/heads/main",
    "refs/remotes/origin/main",
    "origin/main",
    " main ",
  ]) {
    withEnv("GITHUB_BRANCH", value, () => assert.equal(githubBranch(), "main", value));
  }
});

test("GitHub branch rejects invalid values", () => {
  for (const value of ["main..backup", "bad branch", "/"]) {
    withEnv("GITHUB_BRANCH", value, () => assert.equal(githubBranch(), null, value));
  }
});
